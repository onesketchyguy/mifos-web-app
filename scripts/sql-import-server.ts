#!/usr/bin/env ts-node
/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/**
 * IvyTek SQL Import Server
 *
 * Local Hono HTTP server that receives staged IvyTek transaction data from the
 * Angular bulk importer and inserts rows directly into m_loan_transaction,
 * bypassing Fineract repayment automation.
 *
 * Start with:  npm run sql-server
 * Default port: 3001  (override with SQL_IMPORT_PORT env var)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

const PORT = parseInt(process.env['SQL_IMPORT_PORT'] || '3001', 10);
const NOTE_PREFIX = 'IvyTek SQL history import:';
const DETAILS_TABLE = 'c_transaction_details';
const IMPORT_NOTE_REPORT_NAME = 'IvyTek Transaction Import Note';
const IMPORT_NOTE_PARAMETER_NAME = 'TransactionId';
const IMPORT_NOTE_PARAMETER_VARIABLE = 'transactionId';
const DEFAULT_BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

interface DbConfig {
  host: string;
  port: number;
  dbname: string;
  user: string;
  password: string;
}

/** Shape sent from the Angular component for each SQL-ready transaction. */
interface SqlTransaction {
  loanId: number | null;
  sourceTransactionId: string;
  sourceExternalId: string;
  sourceLoanId: string;
  legacyLoanId: string;
  transactionDate: string;
  amount: string;
  principal: string;
  interest: string;
  paymentType: string;
  specialCode: string;
  historyType: string;
  description: string;
  voided: boolean;
  sourceComment: string;
  receiptNumber: string;
  checkNumber: string;
}

interface ImportRequest {
  db: DbConfig;
  transactions: SqlTransaction[];
  createdBy?: number;
  apply?: boolean;
}

/** Internal enriched record ready for DB insertion. */
interface ProcessedRecord {
  loanId: number;
  externalId: string;
  sourceTransactionId: string;
  sourceExternalId: string;
  sourceLoanId: string;
  legacyLoanId: string;
  transactionDate: Date;
  amount: string;
  principal: string | null;
  interest: string | null;
  paymentType: string;
  specialCode: string;
  historyType: string;
  description: string;
  sourceComment: string;
  receiptNumber: string;
  checkNumber: string;
  voided: boolean;
  transactionTypeEnum: number;
  note: string;
}

interface ReconciliationRow {
  metric: string;
  source: number | string;
  database: number | string;
  difference: number | string;
  status: 'Matched' | 'Needs Review' | 'Info';
}

interface ImportResponse {
  success: boolean;
  message: string;
  inserted: number;
  skipped: number;
  warnings: string[];
  reconciliation: ReconciliationRow[];
}

// ---------------------------------------------------------------------------
// Utility functions (TypeScript ports of the Python helpers)
// ---------------------------------------------------------------------------

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeCode(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const num = parseFloat(text);
  if (!isNaN(num) && isFinite(num)) {
    return Number.isInteger(num) ? String(Math.trunc(num)) : String(num);
  }
  return text;
}

function parseDecimalString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const negative = text.startsWith('(') && text.endsWith(')');
  const cleaned = text.replace(/[$,()]/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? String(-num) : String(num);
}

function parseSourceDate(value: unknown): Date | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  // YYYY-MM-DD or YYYY-MM-DD HH:MM:SS
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }

  // MM/DD/YYYY or M/D/YYYY
  const mdyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    const d = new Date(`${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }

  // "15 January 2020" / "15 Jan 2020"
  const d = new Date(text);
  if (!isNaN(d.getTime())) return d;

  return null;
}

function stableExternalId(sourceTransactionId: string): string {
  const candidate = `ivytek-txn-${sourceTransactionId.trim()}`;
  if (candidate.length <= 100) return candidate;
  const digest = createHash('sha256').update(sourceTransactionId, 'utf8').digest('hex').slice(0, 40);
  return `ivytek-txn-${digest}`;
}

function mapTransactionType(
  historyType: string,
  paymentType: string,
  specialCode: string,
  amount: string | null,
  voided: boolean
): number {
  const ht = normalizeText(historyType);
  const pt = normalizeText(paymentType);
  const sc = normalizeCode(specialCode);
  const amountNum = parseFloat(amount ?? '0') || 0;

  if (ht === 'legacydisbursementmarker') return 1;
  if (ht === 'repaymenthistory') return 2;
  if (voided || sc === '2') return 3;
  if (pt === 'charge' || sc === '1') return 17;
  if (pt === 'informational' || sc === '99') return 3;
  if (amountNum < 0) return 3;
  return 2;
}

function buildNote(rec: ProcessedRecord): string {
  if (rec.description) {
    return rec.description;
  }
  const parts = [
    `source transaction ${rec.sourceTransactionId}`,
    `legacy loan ${rec.legacyLoanId || '(blank)'}`,
    `source loan ${rec.sourceLoanId || '(blank)'}`,
    `payment type ${rec.paymentType || '(blank)'}`,
    `special code ${rec.specialCode || '(blank)'}`,
    `source amount ${rec.amount}`,
    `principal ${rec.principal ?? '(blank)'}`,
    `interest ${rec.interest ?? '(blank)'}`,
    `classification ${rec.historyType || '(blank)'}`
  ];
  if (rec.voided) parts.push('voided/reversed in IvyTek');
  if (rec.sourceComment) parts.push(`source comments ${rec.sourceComment}`);
  if (rec.receiptNumber) parts.push(`receipt ${rec.receiptNumber}`);
  if (rec.checkNumber) parts.push(`check ${rec.checkNumber}`);
  return `${NOTE_PREFIX} ${parts.join('; ')}`;
}

function processTransaction(txn: SqlTransaction): { record: ProcessedRecord | null; error: string | null } {
  if (!txn.sourceTransactionId) {
    return { record: null, error: 'missing source transaction id' };
  }
  if (txn.loanId === null || txn.loanId === undefined || isNaN(Number(txn.loanId))) {
    return { record: null, error: `missing loan id for txn ${txn.sourceTransactionId}` };
  }

  const amount = parseDecimalString(txn.amount);
  const transactionDate = parseSourceDate(txn.transactionDate);

  if (amount === null) {
    return {
      record: null,
      error: `missing or unsupported amount for txn ${txn.sourceTransactionId}`
    };
  }
  if (transactionDate === null) {
    return {
      record: null,
      error: `missing or unsupported date for txn ${txn.sourceTransactionId}`
    };
  }

  const principal = parseDecimalString(txn.principal);
  const interest = parseDecimalString(txn.interest);
  const voided = Boolean(txn.voided);

  const record: ProcessedRecord = {
    loanId: Number(txn.loanId),
    externalId: stableExternalId(txn.sourceTransactionId),
    sourceTransactionId: txn.sourceTransactionId,
    sourceExternalId: txn.sourceExternalId || '',
    sourceLoanId: txn.sourceLoanId || '',
    legacyLoanId: txn.legacyLoanId || '',
    transactionDate,
    amount,
    principal,
    interest,
    paymentType: txn.paymentType || '',
    specialCode: txn.specialCode || '',
    historyType: txn.historyType || '',
    description: txn.description || '',
    sourceComment: txn.sourceComment || '',
    receiptNumber: txn.receiptNumber || '',
    checkNumber: txn.checkNumber || '',
    voided,
    transactionTypeEnum: mapTransactionType(txn.historyType, txn.paymentType, txn.specialCode, amount, voided),
    note: ''
  };
  record.note = buildNote(record);

  return { record, error: null };
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

function valuesClause(rowCount: number, colCount: number, offset = 0): string {
  const rows: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const cols = Array.from({ length: colCount }, (_, c) => `$${offset + r * colCount + c + 1}`);
    rows.push(`(${cols.join(', ')})`);
  }
  return rows.join(', ');
}

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

async function ensureImportNoteTable(client: Client): Promise<void> {
  await client.query(`
    create table if not exists ${DETAILS_TABLE} (
      id bigint primary key,
      note text not null,
      created_on_utc timestamptz not null default current_timestamp
    )
  `);
}

async function ensureImportNoteReport(client: Client): Promise<void> {
  const reportSql = [
    `select cd.note as "Import Note"`,
    `from c_transaction_details cd`,
    `where cd.id = \${transactionId}`,
    `limit 1`
  ].join('\n');

  const reportResult = await client.query(
    `
    insert into stretchy_report (
      id, report_name, report_type, report_subtype, report_category,
      report_sql, description, core_report, use_report, self_service_user_report
    ) values (
      nextval('stretchy_report_id_seq'), $1, 'Table', null, 'Loan',
      $2, 'Read-only IvyTek imported transaction note lookup by transaction external id.',
      false, true, false
    )
    on conflict (report_name) do update set
      report_type = excluded.report_type,
      report_subtype = excluded.report_subtype,
      report_category = excluded.report_category,
      report_sql = excluded.report_sql,
      description = excluded.description,
      use_report = true
    returning id
    `,
    [
      IMPORT_NOTE_REPORT_NAME,
      reportSql
    ]
  );
  const reportId = reportResult.rows[0].id;

  const paramResult = await client.query(
    `
    insert into stretchy_parameter (
      id, parameter_name, parameter_variable, parameter_label,
      "parameter_displayType", "parameter_FormatType", parameter_default,
      special, "selectOne", "selectAll", parameter_sql, parent_id
    ) values (
      nextval('stretchy_parameter_id_seq'), $1, $2, 'Transaction Id',
      'text', 'string', 'n/a', null, null, null, null, null
    )
    on conflict (parameter_name) do update set
      parameter_variable = excluded.parameter_variable,
      parameter_label = excluded.parameter_label,
      "parameter_displayType" = excluded."parameter_displayType",
      "parameter_FormatType" = excluded."parameter_FormatType",
      parameter_default = excluded.parameter_default
    returning id
    `,
    [
      IMPORT_NOTE_PARAMETER_NAME,
      IMPORT_NOTE_PARAMETER_VARIABLE
    ]
  );
  const parameterId = paramResult.rows[0].id;

  await client.query(
    `
    insert into stretchy_report_parameter (id, report_id, parameter_id, report_parameter_name)
    values (nextval('stretchy_report_parameter_id_seq'), $1, $2, $3)
    on conflict (report_id, parameter_id) do update set
      report_parameter_name = excluded.report_parameter_name
    `,
    [
      reportId,
      parameterId,
      IMPORT_NOTE_PARAMETER_VARIABLE
    ]
  );
}

async function fetchExistingExternalIds(
  client: Client,
  externalIds: string[],
  batchSize: number
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const batch of chunks(externalIds, batchSize)) {
    const placeholders = batch.map((_, i) => `$${i + 1}`).join(', ');
    const result = await client.query(
      `select external_id from m_loan_transaction where external_id in (${placeholders})`,
      batch
    );
    result.rows.forEach((r: any) => existing.add(r.external_id));
  }
  return existing;
}

async function insertTransactions(
  client: Client,
  records: ProcessedRecord[],
  createdBy: number,
  batchSize: number
): Promise<{ inserted: number; idMap: Map<string, number> }> {
  let inserted = 0;
  const idMap = new Map<string, number>();

  for (const batch of chunks(records, batchSize)) {
    const params: unknown[] = [];
    for (const rec of batch) {
      params.push(
        rec.externalId,
        rec.loanId,
        rec.transactionTypeEnum,
        rec.transactionDate,
        rec.amount,
        rec.principal,
        rec.interest,
        null, // fee
        null, // penalty
        null, // overpayment
        null, // unrecognized
        null, // outstanding_balance
        rec.transactionDate, // submitted_on_date
        rec.voided,
        rec.voided ? rec.transactionDate : null // reversed_on_date
      );
    }
    const colCount = 15;
    const cbOffset = batch.length * colCount;
    params.push(createdBy, createdBy);

    const result = await client.query<{ id: number; external_id: string }>(
      `
      with src(
        external_id, loan_id, transaction_type_enum, transaction_date, amount,
        principal, interest, fee, penalty, overpayment, unrecognized,
        outstanding_balance, submitted_on_date, is_reversed, reversed_on_date
      ) as (
        values ${valuesClause(batch.length, colCount)}
      )
      insert into m_loan_transaction (
        id, loan_id, office_id, payment_detail_id, is_reversed, external_id,
        transaction_type_enum, transaction_date, amount, principal_portion_derived,
        interest_portion_derived, fee_charges_portion_derived,
        penalty_charges_portion_derived, overpayment_portion_derived,
        unrecognized_income_portion, outstanding_loan_balance_derived,
        submitted_on_date, manually_adjusted_or_reversed, created_date, created_by,
        last_modified_by, created_on_utc, last_modified_on_utc,
        charge_refund_charge_type, reversal_external_id, reversed_on_date
      )
      select
        nextval('m_loan_transaction_id_seq'),
        s.loan_id::bigint,
        coalesce(c.office_id, g.office_id, 1::bigint)::bigint,
        null,
        s.is_reversed::boolean,
        s.external_id::varchar,
        s.transaction_type_enum::smallint,
        s.transaction_date::date,
        s.amount::numeric,
        coalesce(s.principal::numeric, 0::numeric),
        coalesce(s.interest::numeric, 0::numeric),
        coalesce(s.fee::numeric, 0::numeric),
        coalesce(s.penalty::numeric, 0::numeric),
        coalesce(s.overpayment::numeric, 0::numeric),
        coalesce(s.unrecognized::numeric, 0::numeric),
        coalesce(s.outstanding_balance::numeric, 0::numeric),
        s.submitted_on_date::date,
        false,
        current_timestamp,
        $${cbOffset + 1},
        $${cbOffset + 2},
        current_timestamp,
        current_timestamp,
        null,
        null,
        s.reversed_on_date::date
      from src s
      join m_loan l on l.id = s.loan_id::bigint
      left join m_client c on c.id = l.client_id
      left join m_group g on g.id = l.group_id
      where not exists (
        select 1 from m_loan_transaction t where t.external_id = s.external_id::varchar
      )
      returning id, external_id
      `,
      params
    );
    for (const row of result.rows) {
      idMap.set(row.external_id, Number(row.id));
    }
    inserted += result.rowCount ?? 0;
  }
  return { inserted, idMap };
}

/** Looks up m_loan_transaction.id for already-imported rows by external_id. */
async function fetchIdsByExternalIds(
  client: Client,
  externalIds: string[],
  batchSize: number
): Promise<Map<string, number>> {
  const idMap = new Map<string, number>();
  for (const batch of chunks(externalIds, batchSize)) {
    const result = await client.query<{ id: number; external_id: string }>(
      `select id, external_id from m_loan_transaction where external_id = any($1::text[])`,
      [batch]
    );
    for (const row of result.rows) {
      idMap.set(row.external_id, Number(row.id));
    }
  }
  return idMap;
}

async function insertNotes(
  client: Client,
  entries: { transactionId: number; loanId: number; note: string }[],
  createdBy: number,
  batchSize: number
): Promise<number> {
  let inserted = 0;
  for (const batch of chunks(entries, batchSize)) {
    const params: unknown[] = [];
    for (const e of batch) params.push(e.transactionId, e.loanId, e.note);
    const noteOffset = batch.length * 3;
    params.push(createdBy, createdBy, `${NOTE_PREFIX}%`);

    const result = await client.query(
      `
      with src(transaction_id, loan_id, note) as (
        values ${valuesClause(batch.length, 3)}
      )
      insert into m_note (
        id, client_id, group_id, loan_id, loan_transaction_id, savings_account_id,
        savings_account_transaction_id, share_account_id, note_type_enum, note,
        created_date, created_by, lastmodified_date, last_modified_by,
        created_on_utc, last_modified_on_utc
      )
      select
        nextval('m_note_id_seq'),
        null, null,
        s.loan_id::bigint,
        s.transaction_id::bigint,
        null, null, null,
        300,
        s.note::varchar,
        current_timestamp,
        $${noteOffset + 1},
        current_timestamp,
        $${noteOffset + 2},
        current_timestamp,
        current_timestamp
      from src s
      where not exists (
        select 1 from m_note n
        where n.loan_transaction_id = s.transaction_id::bigint
          and n.note like $${noteOffset + 3}
      )
      `,
      params
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function insertImportNotes(
  client: Client,
  entries: { id: number; note: string }[],
  batchSize: number
): Promise<number> {
  let upserted = 0;
  for (const batch of chunks(entries, batchSize)) {
    const params: unknown[] = [];
    for (const e of batch) params.push(e.id, e.note);
    const result = await client.query(
      `insert into ${DETAILS_TABLE} (id, note)
       values ${valuesClause(batch.length, 2)}
       on conflict (id) do update set note = excluded.note`,
      params
    );
    upserted += result.rowCount ?? 0;
  }
  return upserted;
}

async function fetchDbTotals(
  client: Client,
  externalIds: string[],
  batchSize: number
): Promise<{
  count: number;
  loanCount: number;
  amount: number;
  principal: number;
  interest: number;
  reversedCount: number;
  noteCount: number;
  importNoteCount: number;
}> {
  const totals = {
    count: 0,
    loanCount: 0,
    amount: 0,
    principal: 0,
    interest: 0,
    reversedCount: 0,
    noteCount: 0,
    importNoteCount: 0
  };
  const loanIds = new Set<number>();

  for (const batch of chunks(externalIds, batchSize)) {
    const ph = batch.map((_, i) => `$${i + 1}`).join(', ');

    const countRes = await client.query(
      `select count(*),
              coalesce(sum(amount), 0::numeric),
              coalesce(sum(principal_portion_derived), 0::numeric),
              coalesce(sum(interest_portion_derived), 0::numeric),
              coalesce(sum(case when is_reversed then 1 else 0 end), 0::bigint)
       from m_loan_transaction where external_id in (${ph})`,
      batch
    );
    const [
      cnt,
      amt,
      pri,
      int_,
      rev
    ] = countRes.rows[0];
    totals.count += parseInt(cnt || 0);
    totals.amount += parseFloat(amt || 0);
    totals.principal += parseFloat(pri || 0);
    totals.interest += parseFloat(int_ || 0);
    totals.reversedCount += parseInt(rev || 0);

    const loanRes = await client.query(
      `select distinct loan_id from m_loan_transaction where external_id in (${ph})`,
      batch
    );
    loanRes.rows.forEach((r: any) => loanIds.add(r.loan_id));

    const noteRes = await client.query(
      `select count(*) from m_note n
       join m_loan_transaction t on t.id = n.loan_transaction_id
       where t.external_id in (${ph}) and n.note like $${batch.length + 1}`,
      [
        ...batch,
        `${NOTE_PREFIX}%`
      ]
    );
    totals.noteCount += parseInt(noteRes.rows[0].count || 0);
  }
  totals.loanCount = loanIds.size;

  // Import note table count (non-fatal if table absent)
  const tableCheck = await client.query(`select to_regclass($1)`, [DETAILS_TABLE]);
  if (tableCheck.rows[0].to_regclass) {
    const inRes = await client.query(`select count(*) from ${DETAILS_TABLE}`);
    totals.importNoteCount = parseInt(inRes.rows[0].count || 0);
  }

  return totals;
}

// ---------------------------------------------------------------------------
// Main import orchestration
// ---------------------------------------------------------------------------

async function runImport(req: ImportRequest): Promise<ImportResponse> {
  const { db, transactions, createdBy = 4, apply = false } = req;
  const warnings: string[] = [];

  // Process and validate incoming transaction rows
  const records: ProcessedRecord[] = [];
  for (const txn of transactions) {
    const { record, error } = processTransaction(txn);
    if (error) warnings.push(error);
    else if (record) records.push(record);
  }

  if (!records.length) {
    return {
      success: false,
      message: 'No valid transactions to import after validation.',
      inserted: 0,
      skipped: 0,
      warnings,
      reconciliation: []
    };
  }

  const client = new Client({
    host: db.host,
    port: db.port,
    database: db.dbname,
    user: db.user,
    password: db.password
  });

  await client.connect();

  try {
    // Phase 1: infrastructure — runs outside the main transaction so schema
    // migration and report SQL fixes persist even if reconciliation later fails.
    let importNoteTableReady = false;
    if (apply) {
      try {
        await ensureImportNoteTable(client);
        importNoteTableReady = true;
      } catch (e: any) {
        warnings.push(
          `Could not create import note table (${e.message}). Import note rows will be skipped — grant CREATE on schema public to the DB user to enable them.`
        );
      }

      if (importNoteTableReady) {
        try {
          await ensureImportNoteReport(client);
        } catch (e: any) {
          warnings.push(
            `Could not upsert IvyTek import note stretchy report: ${e.message}. Transactions will still be inserted.`
          );
        }
      }
    }

    // Phase 2: data insertion and reconciliation — rolled back as a unit if
    // totals don't match.
    await client.query('BEGIN');

    const externalIds = records.map((r) => r.externalId);
    const existingIds = await fetchExistingExternalIds(client, externalIds, DEFAULT_BATCH_SIZE);
    const toInsert = records.filter((r) => !existingIds.has(r.externalId));

    // Source-side totals for reconciliation
    const sourceAmount = records.reduce((s, r) => s + parseFloat(r.amount), 0);
    const sourcePrincipal = records.reduce((s, r) => s + parseFloat(r.principal ?? '0'), 0);
    const sourceInterest = records.reduce((s, r) => s + parseFloat(r.interest ?? '0'), 0);
    const sourceReversed = records.filter((r) => r.voided).length;
    const sourceLoanCount = new Set(records.map((r) => r.loanId)).size;

    let insertedCount = 0;
    let insertedIdMap = new Map<string, number>();

    if (apply) {
      const txResult = await insertTransactions(client, toInsert, createdBy, DEFAULT_BATCH_SIZE);
      insertedCount = txResult.inserted;
      insertedIdMap = txResult.idMap;
    }

    const dbTotals = await fetchDbTotals(client, externalIds, DEFAULT_BATCH_SIZE);

    const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

    const reconciliation: ReconciliationRow[] = [
      {
        metric: 'Transaction Count',
        source: records.length,
        database: dbTotals.count,
        difference: dbTotals.count - records.length,
        status: dbTotals.count === records.length ? 'Matched' : 'Needs Review'
      },
      {
        metric: 'Distinct Loan Count',
        source: sourceLoanCount,
        database: dbTotals.loanCount,
        difference: dbTotals.loanCount - sourceLoanCount,
        status: dbTotals.loanCount === sourceLoanCount ? 'Matched' : 'Needs Review'
      },
      {
        metric: 'Amount Total',
        source: sourceAmount.toFixed(2),
        database: dbTotals.amount.toFixed(2),
        difference: (dbTotals.amount - sourceAmount).toFixed(2),
        status: near(dbTotals.amount, sourceAmount) ? 'Matched' : 'Needs Review'
      },
      {
        metric: 'Principal Total',
        source: sourcePrincipal.toFixed(2),
        database: dbTotals.principal.toFixed(2),
        difference: (dbTotals.principal - sourcePrincipal).toFixed(2),
        status: near(dbTotals.principal, sourcePrincipal) ? 'Matched' : 'Needs Review'
      },
      {
        metric: 'Interest Total',
        source: sourceInterest.toFixed(2),
        database: dbTotals.interest.toFixed(2),
        difference: (dbTotals.interest - sourceInterest).toFixed(2),
        status: near(dbTotals.interest, sourceInterest) ? 'Matched' : 'Needs Review'
      },
      {
        metric: 'Reversed Count',
        source: sourceReversed,
        database: dbTotals.reversedCount,
        difference: dbTotals.reversedCount - sourceReversed,
        status: dbTotals.reversedCount === sourceReversed ? 'Matched' : 'Needs Review'
      },
      {
        metric: 'Notes (m_note)',
        source: records.length,
        database: dbTotals.noteCount,
        difference: dbTotals.noteCount - records.length,
        status: 'Info'
      },
      {
        metric: 'Import Note Table Rows',
        source: records.length,
        database: dbTotals.importNoteCount,
        difference: dbTotals.importNoteCount - records.length,
        status: 'Info'
      },
      {
        metric: 'Inserted This Run',
        source: records.length,
        database: insertedCount,
        difference: insertedCount - records.length,
        status: 'Info'
      },
      {
        metric: 'Skipped Existing',
        source: records.length,
        database: existingIds.size,
        difference: 0,
        status: 'Info'
      }
    ];

    const allMatch = reconciliation.filter((r) => r.status !== 'Info').every((r) => r.status === 'Matched');

    if (apply && allMatch) {
      await client.query('COMMIT');

      // Phase 3: write notes after commit using the IDs from RETURNING + existing lookup.
      // allIdMap keys are IvyTek external IDs; values are Fineract integer transaction IDs.
      let upsertedImportNoteCount = 0;
      let insertedNoteCount = 0;
      try {
        const skippedExternalIds = records.filter((r) => !insertedIdMap.has(r.externalId)).map((r) => r.externalId);
        const existingIdMap =
          skippedExternalIds.length > 0
            ? await fetchIdsByExternalIds(client, skippedExternalIds, DEFAULT_BATCH_SIZE)
            : new Map<string, number>();

        const allIdMap = new Map<string, number>([
          ...insertedIdMap,
          ...existingIdMap
        ]);

        // Build entries for all records we can map to a Fineract transaction ID.
        const mappedNoteEntries = records
          .filter((r) => allIdMap.has(r.externalId) && r.note)
          .map((r) => ({
            transactionId: allIdMap.get(r.externalId)!,
            loanId: r.loanId,
            note: r.note
          }));

        // Write to m_note (read by the Fineract notes API / UI).
        if (mappedNoteEntries.length > 0) {
          insertedNoteCount = await insertNotes(client, mappedNoteEntries, createdBy, DEFAULT_BATCH_SIZE);
        }

        // Also write to c_transaction_details (keyed by Fineract transaction ID).
        if (importNoteTableReady) {
          const detailEntries = records
            .filter((r) => r.note && allIdMap.has(r.externalId))
            .map((r) => ({ id: allIdMap.get(r.externalId)!, note: r.note }));
          upsertedImportNoteCount = await insertImportNotes(client, detailEntries, DEFAULT_BATCH_SIZE);
        }
      } catch (e: any) {
        warnings.push(`Post-commit note population failed: ${e.message}`);
      }

      return {
        success: true,
        message: `Committed ${insertedCount} transaction rows. Notes written: ${insertedNoteCount} (m_note), ${upsertedImportNoteCount} (c_transaction_details).`,
        inserted: insertedCount,
        skipped: existingIds.size,
        warnings,
        reconciliation
      };
    } else if (apply) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: 'Rolled back: reconciliation totals did not match. Review the table below.',
        inserted: 0,
        skipped: existingIds.size,
        warnings,
        reconciliation
      };
    } else {
      await client.query('ROLLBACK');
      return {
        success: true,
        message: `Dry run complete. ${records.length} transactions ready. Re-run with Apply to commit.`,
        inserted: 0,
        skipped: existingIds.size,
        warnings,
        reconciliation
      };
    }
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Hono server
// ---------------------------------------------------------------------------

const app = new Hono();

app.use(
  '*',
  cors({
    origin: [
      'http://localhost:4200',
      'http://localhost:4201'
    ],
    allowMethods: [
      'GET',
      'POST',
      'OPTIONS'
    ],
    allowHeaders: ['Content-Type']
  })
);

app.get('/api/ivytek/health', (c) => c.json({ status: 'ok', service: 'IvyTek SQL Import Server', port: PORT }));

// ---------------------------------------------------------------------------
// CSV parsing helpers for the file-upload endpoint
// ---------------------------------------------------------------------------

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (vals[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function csvVal(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

function csvDecimal(row: Record<string, string>, ...keys: string[]): string | null {
  return parseDecimalString(csvVal(row, ...keys));
}

function csvSumDecimals(row: Record<string, string>, keyGroups: string[][]): string | null {
  const values = keyGroups
    .map((keys) => {
      const v = csvDecimal(row, ...keys);
      return v === null ? null : parseFloat(v);
    })
    .filter((v): v is number => v !== null);
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return (Math.round(sum * 100) / 100).toFixed(2);
}

function csvBool(row: Record<string, string>, ...keys: string[]): boolean {
  const v = csvVal(row, ...keys).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function csvLegacyLoanId(row: Record<string, string>): string {
  return csvVal(
    row,
    'ws_loan_id',
    'WS_LOAN_ID',
    'wsLoanId',
    'WS_Loan_ID__c',
    'IvytekTestPkg__WS_Loan_ID__c',
    'IvytekTestPkg__Legacy_Loan_ID__c',
    'legacy_id',
    'legacy_loan_number',
    'LoanAccountNumber'
  );
}

function csvTransactionDate(row: Record<string, string>): string {
  return csvVal(
    row,
    'transaction_date',
    'IvytekTestPkg__Transaction_Date__c',
    'IvytekTestPkg__Day_Paid__c',
    'IvytekTestPkg__DayPaid__c',
    'IvytekTestPkg__DayPosted__c',
    'IvytekTestPkg__DatePaid__c',
    'DatePaid',
    'Date Paid',
    'IvytekTestPkg__DateLastPaid__c',
    'Date Last Paid'
  );
}

function csvHistoryType(row: Record<string, string>): string {
  const pt = normalizeText(csvVal(row, 'IvytekTestPkg__TypPay__c'));
  const sc = normalizeCode(csvVal(row, 'IvytekTestPkg__SpecialTransCode__c'));
  const amount =
    parseFloat(
      parseDecimalString(
        csvVal(row, 'selected_amount', 'amount_paid', 'component_total', 'IvytekTestPkg__AmountPaid__c')
      ) ?? '0'
    ) || 0;
  const voided =
    csvBool(row, 'IvytekTestPkg__Voided_Transaction__c', 'Voided', 'voided', 'reversed') || pt === 'void' || sc === '2';

  if (
    amount > 0 &&
    !voided &&
    pt !== 'informational' &&
    pt !== 'charge' &&
    pt !== 'bookaccruedinterest' &&
    sc !== '1' &&
    sc !== '99'
  ) {
    return 'Repayment history';
  }
  return 'Source transaction history';
}

/** Resolves legacyLoanId → Fineract loan id via m_loan.account_no lookup. */
async function lookupLoanIds(client: Client, legacyIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(legacyIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const res = await client.query<{ id: number; account_no: string }>(
    `SELECT id, account_no FROM m_loan WHERE account_no = ANY($1::text[])`,
    [unique]
  );
  const map = new Map<string, number>();
  for (const row of res.rows) map.set(row.account_no, row.id);
  return map;
}

/**
 * Builds a map from every identifier on each loan row (Salesforce ID, external ID, etc.)
 * to the accountNo (legacy loan ID / WS_Loan_ID__c) for that loan.  Used to cross-reference
 * transaction rows that reference a loan by SF ID rather than by account_no directly.
 */
function buildLoanIdentifierMap(loanRows: Record<string, string>[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of loanRows) {
    const accountNo = csvLegacyLoanId(row);
    if (!accountNo) continue;
    for (const id of [
      csvVal(row, 'Id'), // Salesforce record ID
      csvVal(row, 'IvytekTestPkg__ExternalID__c'), // Fineract external ID
      csvVal(row, 'IvytekTestPkg__LoanID__c'),
      csvVal(row, 'IvytekTestPkg__Loan__c'),
      accountNo
    ].filter(Boolean)) {
      map.set(id, accountNo);
    }
  }
  return map;
}

function csvRowToSqlTransaction(
  row: Record<string, string>,
  loanIdMap: Map<string, number>,
  loanIdentifierMap?: Map<string, string>
): SqlTransaction | null {
  let legacyLoanId = csvLegacyLoanId(row);
  let loanId = loanIdMap.get(legacyLoanId) ?? null;

  // Fall back: resolve via Salesforce/external loan reference through the loan CSV cross-reference
  if (loanId === null && loanIdentifierMap) {
    const sfRef = csvVal(row, 'IvytekTestPkg__LoanID__c', 'IvytekTestPkg__Loan__c', 'IvytekTestPkg__ExternalID__c');
    if (sfRef) {
      const resolvedAccountNo = loanIdentifierMap.get(sfRef);
      if (resolvedAccountNo) {
        legacyLoanId = resolvedAccountNo;
        loanId = loanIdMap.get(resolvedAccountNo) ?? null;
      }
    }
  }

  const sourceTransactionId = csvVal(row, 'Id');
  if (!sourceTransactionId) return null;

  return {
    loanId,
    sourceTransactionId,
    sourceExternalId: csvVal(row, 'IvytekTestPkg__ExternalID__c'),
    sourceLoanId: csvVal(row, 'sf_loan_id', 'IvytekTestPkg__LoanID__c', 'IvytekTestPkg__Loan__c', 'loan_id'),
    legacyLoanId,
    transactionDate: csvTransactionDate(row),
    amount: csvVal(row, 'selected_amount', 'amount_paid', 'component_total', 'IvytekTestPkg__AmountPaid__c'),
    principal: csvVal(
      row,
      'principal_paid',
      'principle_paid',
      'IvytekTestPkg__PrinciplePaid__c',
      'IvytekTestPkg__PrincipalPaid__c',
      'Principal Paid',
      'Principle Paid'
    ),
    interest:
      csvSumDecimals(row, [
        [
          'interest_paid',
          'IvytekTestPkg__InterestPaid__c',
          'Interest Paid'
        ],
        [
          'back_interest_paid',
          'IvytekTestPkg__BackInterestPaid__c',
          'Back Interest Paid'
        ],
        [
          'deferred_interest_paid',
          'IvytekTestPkg__DeferredInterestPaid__c',
          'Deferred Interest Paid'
        ]
      ]) ?? '',
    paymentType: csvVal(row, 'IvytekTestPkg__TypPay__c'),
    specialCode: csvVal(row, 'IvytekTestPkg__SpecialTransCode__c'),
    historyType: csvHistoryType(row),
    description: csvVal(row, 'IvytekTestPkg__Description__c'),
    voided: csvBool(row, 'IvytekTestPkg__Voided_Transaction__c', 'Voided', 'voided', 'reversed'),
    sourceComment: [
      csvVal(row, 'IvytekTestPkg__Note__c'),
      csvVal(row, 'IvytekTestPkg__CurrentNote__c'),
      csvVal(row, 'IvytekTestPkg__TopOfNote__c'),
      csvVal(row, 'IvytekTestPkg__Next_Payment_Note__c'),
      csvVal(row, 'IvytekTestPkg__CR_Special_Comment_Code__c')
    ]
      .filter(Boolean)
      .join(' | '),
    receiptNumber: csvVal(row, 'IvytekTestPkg__ReceiptNumber__c'),
    checkNumber: csvVal(row, 'IvytekTestPkg__Check_Number__c', 'IvytekTestPkg__CheckDisbursement__c')
  };
}

app.post('/api/ivytek/sql-import-csv', async (c) => {
  let formBody: Record<string, string | File>;
  try {
    formBody = await c.req.parseBody();
  } catch {
    return c.json({ success: false, message: 'Could not parse multipart form data.' }, 400);
  }

  const dbJson = formBody['db'];
  const csvFile = formBody['csv'];
  const apply = formBody['apply'] === 'true';
  const createdBy = parseInt(String(formBody['createdBy'] ?? '4'), 10) || 4;

  if (typeof dbJson !== 'string') return c.json({ success: false, message: 'Missing db config.' }, 400);
  if (!(csvFile instanceof File)) return c.json({ success: false, message: 'Missing csv file.' }, 400);

  let db: DbConfig;
  try {
    db = JSON.parse(dbJson);
  } catch {
    return c.json({ success: false, message: 'Invalid db config JSON.' }, 400);
  }
  if (!db?.host || !db?.dbname || !db?.user) {
    return c.json({ success: false, message: 'Missing required db fields: host, dbname, user.' }, 400);
  }

  let csvText: string;
  try {
    csvText = await csvFile.text();
  } catch {
    return c.json({ success: false, message: 'Could not read uploaded CSV file.' }, 400);
  }

  const rows = parseCsv(csvText);
  if (!rows.length) return c.json({ success: false, message: 'CSV file is empty or has no data rows.' }, 400);

  // Parse optional loan CSV to build a cross-reference from SF/external IDs → accountNo.
  const loanFile = formBody['loan'];
  let loanIdentifierMap: Map<string, string> | undefined;
  if (loanFile instanceof File) {
    try {
      const loanCsvText = await loanFile.text();
      const loanRows = parseCsv(loanCsvText);
      loanIdentifierMap = buildLoanIdentifierMap(loanRows);
    } catch {
      // Non-fatal — proceed without cross-reference enrichment
    }
  }

  // Resolve legacy loan IDs → Fineract loan IDs via a brief DB lookup connection.
  // Include all accountNos from the loan CSV so that SF-referenced loans are found even if
  // the transaction row only carries the Salesforce loan ID, not the legacy account_no directly.
  const lookupClient = new Client({
    host: db.host,
    port: db.port ?? 5432,
    database: db.dbname,
    user: db.user,
    password: db.password
  });

  let transactions: SqlTransaction[];
  const lookupWarnings: string[] = [];

  try {
    await lookupClient.connect();
    const directLegacyIds = rows.map((r) => csvLegacyLoanId(r)).filter(Boolean);
    const loanCsvAccountNos = loanIdentifierMap ? [...new Set(loanIdentifierMap.values())] : [];
    const allLookupIds = [
      ...new Set([
        ...directLegacyIds,
        ...loanCsvAccountNos
      ])
    ];
    const loanIdMap = await lookupLoanIds(lookupClient, allLookupIds);

    // Warn about direct legacy IDs that aren't in the DB (after cross-reference is applied
    // some of these may still resolve via loanIdentifierMap — tracked per-row below).
    transactions = rows
      .map((r) => csvRowToSqlTransaction(r, loanIdMap, loanIdentifierMap))
      .filter((t): t is SqlTransaction => t !== null);

    const unmappedIds = new Set(
      transactions
        .filter((t) => t.loanId === null)
        .map((t) => t.legacyLoanId)
        .filter(Boolean)
    );
    if (unmappedIds.size) {
      lookupWarnings.push(
        `${unmappedIds.size} legacy loan ID(s) not found in Fineract m_loan.account_no: ` +
          [...unmappedIds].slice(0, 10).join(', ') +
          (unmappedIds.size > 10 ? ' ...' : '')
      );
    }
    if (loanIdentifierMap) {
      lookupWarnings.push(`Loan cross-reference loaded: ${loanIdentifierMap.size} identifier(s) from loan CSV.`);
    }
  } catch (e: any) {
    return c.json({ success: false, message: `DB loan-lookup failed: ${e.message}` }, 500);
  } finally {
    await lookupClient.end().catch(() => {});
  }

  if (!transactions.length) {
    return c.json(
      {
        success: false,
        message: 'No importable transactions found in CSV after loan ID resolution.',
        warnings: lookupWarnings
      },
      400
    );
  }

  try {
    const result = await runImport({ db, transactions, createdBy, apply });
    result.warnings = [
      ...lookupWarnings,
      ...result.warnings
    ];
    return c.json(result);
  } catch (e: any) {
    console.error('CSV import error:', e);
    return c.json({ success: false, message: `Import failed: ${e.message}` }, 500);
  }
});

app.post('/api/ivytek/sql-import', async (c) => {
  let body: ImportRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Invalid JSON body.' }, 400);
  }

  if (!body?.db?.host || !body?.db?.dbname || !body?.db?.user) {
    return c.json({ success: false, message: 'Missing required database config: host, dbname, user.' }, 400);
  }
  if (!Array.isArray(body.transactions) || !body.transactions.length) {
    return c.json({ success: false, message: 'No transactions provided in request body.' }, 400);
  }

  try {
    const result = await runImport(body);
    return c.json(result);
  } catch (e: any) {
    console.error('Import error:', e);
    return c.json({ success: false, message: `Import failed: ${e.message}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// Repair-notes endpoint — fixes c_transaction_details without touching
// m_loan_transaction.  Safe to run against an already-imported dataset.
// ---------------------------------------------------------------------------

interface RepairNotesRequest {
  db: DbConfig;
  transactions: SqlTransaction[];
}

interface RepairNotesResponse {
  success: boolean;
  message: string;
  upserted: number;
  warnings: string[];
}

app.post('/api/ivytek/repair-notes', async (c) => {
  let body: RepairNotesRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Invalid JSON body.', upserted: 0, warnings: [] }, 400);
  }

  if (!body?.db?.host || !body?.db?.dbname || !body?.db?.user) {
    return c.json(
      { success: false, message: 'Missing required database config: host, dbname, user.', upserted: 0, warnings: [] },
      400
    );
  }
  if (!Array.isArray(body.transactions) || !body.transactions.length) {
    return c.json(
      { success: false, message: 'No transactions provided in request body.', upserted: 0, warnings: [] },
      400
    );
  }

  const warnings: string[] = [];
  const records: ProcessedRecord[] = [];
  for (const txn of body.transactions) {
    const { record, error } = processTransaction(txn);
    if (error) warnings.push(error);
    else if (record) records.push(record);
  }

  if (!records.length) {
    return c.json({ success: false, message: 'No valid transactions after validation.', upserted: 0, warnings }, 400);
  }

  const client = new Client({
    host: body.db.host,
    port: body.db.port,
    database: body.db.dbname,
    user: body.db.user,
    password: body.db.password
  });

  try {
    await client.connect();

    await ensureImportNoteTable(client);

    try {
      await ensureImportNoteReport(client);
    } catch (e: any) {
      warnings.push(`Could not upsert stretchy report: ${e.message}`);
    }

    const externalIds = records.map((r) => r.externalId);
    const idMap = await fetchIdsByExternalIds(client, externalIds, DEFAULT_BATCH_SIZE);

    const noteEntries = records
      .filter((r) => r.note && idMap.has(r.externalId))
      .map((r) => ({ id: idMap.get(r.externalId)!, note: r.note }));

    const upserted = await insertImportNotes(client, noteEntries, DEFAULT_BATCH_SIZE);

    return c.json({
      success: true,
      message: `Repaired ${upserted} import note row(s) in ${DETAILS_TABLE}.`,
      upserted,
      warnings
    } satisfies RepairNotesResponse);
  } catch (e: any) {
    console.error('Repair-notes error:', e);
    return c.json({ success: false, message: `Repair failed: ${e.message}`, upserted: 0, warnings }, 500);
  } finally {
    await client.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Write transaction note endpoint — saves a manual payment note to c_transaction_details.
// ---------------------------------------------------------------------------

app.post('/api/ivytek/write-transaction-note', async (c) => {
  let body: { transactionId?: number; note?: string; db?: any };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Invalid JSON body.' }, 400);
  }

  const { transactionId, note } = body;
  if (!transactionId || typeof transactionId !== 'number') {
    return c.json({ success: false, message: 'transactionId is required and must be a number.' }, 400);
  }
  if (!note || typeof note !== 'string' || !note.trim()) {
    return c.json({ success: false, message: 'note is required and must be a non-empty string.' }, 400);
  }

  const dbConfig = body.db || { host: 'localhost', port: 5432, dbname: 'fineract_default', user: 'root', password: '' };
  const client = new Client({
    host: dbConfig.host,
    port: dbConfig.port ?? 5432,
    database: dbConfig.dbname,
    user: dbConfig.user,
    password: dbConfig.password || ''
  });

  try {
    await client.connect();
    await ensureImportNoteTable(client);
    await client.query(
      `insert into ${DETAILS_TABLE} (id, note) values ($1, $2) on conflict (id) do update set note = excluded.note`,
      [
        transactionId,
        note.trim()
      ]
    );
    try {
      await ensureImportNoteReport(client);
    } catch (e: any) {
      console.warn('Could not upsert stretchy report:', e.message);
    }
    return c.json({ success: true, message: 'Transaction note saved.' });
  } catch (e: any) {
    console.error('write-transaction-note error:', e);
    return c.json({ success: false, message: `Failed to save transaction note: ${e.message}` }, 500);
  } finally {
    await client.end().catch(() => {});
  }
});

console.log(`IvyTek SQL Import Server starting on http://localhost:${PORT}`);
console.log(`  GET  http://localhost:${PORT}/api/ivytek/health`);
console.log(`  POST http://localhost:${PORT}/api/ivytek/sql-import       (JSON, pre-processed from Stage 3)`);
console.log(`  POST http://localhost:${PORT}/api/ivytek/sql-import-csv   (multipart CSV file upload)`);
console.log(
  `  POST http://localhost:${PORT}/api/ivytek/repair-notes     (fix c_transaction_details only, no txn insert)`
);

serve({ fetch: app.fetch, port: PORT });
