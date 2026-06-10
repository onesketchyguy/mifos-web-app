/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * IvyTek SQL Import — inline Node.js HTTP server.
 * Required by proxy.conf.js so it starts automatically with ng serve.
 * Accepts JSON bodies (files as text strings) to avoid multipart complexity.
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const { Client } = require('pg');

const PORT = parseInt(process.env['SQL_IMPORT_PORT'] || '3001', 10);
const NOTE_PREFIX = 'IvyTek SQL history import:';
const DETAILS_TABLE = 'c_transaction_details';
const DEFAULT_BATCH_SIZE = 500;
const FEEDPOST_NOTE_PREFIX = 'IvyTek FeedPost import:';
const FEEDPOST_TRACKING_TABLE = 'm_ivytek_imported_feedpost_note';
const NOTE_TYPE_LOAN = 200;

// ---------------------------------------------------------------------------
// Request body helpers
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function jsonResponse(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(data);
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

function splitCsvLine(line) {
  const result = [];
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

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = splitCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (vals[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function csvVal(row, ...keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

function parseDecimalString(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const negative = text.startsWith('(') && text.endsWith(')');
  const cleaned = text.replace(/[$,()]/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? String(-num) : String(num);
}

function csvDecimal(row, ...keys) {
  return parseDecimalString(csvVal(row, ...keys));
}

function csvSumDecimals(row, keyGroups) {
  const values = keyGroups
    .map((keys) => {
      const v = csvDecimal(row, ...keys);
      return v === null ? null : parseFloat(v);
    })
    .filter((v) => v !== null);
  if (!values.length) return null;
  return (Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100).toFixed(2);
}

function csvBool(row, ...keys) {
  const v = csvVal(row, ...keys).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function csvLegacyLoanId(row) {
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

function csvTransactionDate(row) {
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

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeCode(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const num = parseFloat(text);
  if (!isNaN(num) && isFinite(num)) return Number.isInteger(num) ? String(Math.trunc(num)) : String(num);
  return text;
}

function csvHistoryType(row) {
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
  )
    return 'Repayment history';
  return 'Source transaction history';
}

// ---------------------------------------------------------------------------
// HTML stripping
// ---------------------------------------------------------------------------

const _HTML_BLOCK_TAGS = new Set([
  'p',
  'div',
  'br',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'tr',
  'blockquote',
  'hr'
]);

function stripHtml(value) {
  if (!value) return '';
  let text = String(value)
    .replace(/<(\/?)(\w+)[^>]*>/g, (_, _slash, tag) => (_HTML_BLOCK_TAGS.has(tag.toLowerCase()) ? '\n' : ''))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
  const lines = text.split('\n').map((l) => l.trim());
  const cleaned = [];
  let prevBlank = false;
  for (const line of lines) {
    const blank = !line;
    if (blank && prevBlank) continue;
    cleaned.push(line);
    prevBlank = blank;
  }
  return cleaned.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Loan ID helpers
// ---------------------------------------------------------------------------

function buildLoanIdentifierMap(loanRows) {
  const map = new Map();
  for (const row of loanRows) {
    const accountNo = csvLegacyLoanId(row);
    if (!accountNo) continue;
    for (const id of [
      csvVal(row, 'Id'),
      csvVal(row, 'IvytekTestPkg__ExternalID__c'),
      csvVal(row, 'IvytekTestPkg__LoanID__c'),
      csvVal(row, 'IvytekTestPkg__Loan__c'),
      accountNo
    ].filter(Boolean)) map.set(id, accountNo);
  }
  return map;
}

async function lookupLoanIds(client, legacyIds) {
  const unique = [...new Set(legacyIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const res = await client.query('SELECT id, account_no FROM m_loan WHERE account_no = ANY($1::text[])', [unique]);
  const map = new Map();
  for (const row of res.rows) map.set(row.account_no, Number(row.id));
  return map;
}

function csvRowToSqlTransaction(row, loanIdMap, loanIdentifierMap) {
  let legacyLoanId = csvLegacyLoanId(row);
  let loanId = loanIdMap.get(legacyLoanId) ?? null;

  if (loanId === null && loanIdentifierMap) {
    const sfRef = csvVal(row, 'IvytekTestPkg__LoanID__c', 'IvytekTestPkg__Loan__c', 'IvytekTestPkg__ExternalID__c');
    if (sfRef) {
      const resolved = loanIdentifierMap.get(sfRef);
      if (resolved) {
        legacyLoanId = resolved;
        loanId = loanIdMap.get(resolved) ?? null;
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

// ---------------------------------------------------------------------------
// Transaction processing
// ---------------------------------------------------------------------------

function parseSourceDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  const mdyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    const d = new Date(`${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d;
}

function stableExternalId(sourceTransactionId) {
  const candidate = `ivytek-txn-${sourceTransactionId.trim()}`;
  if (candidate.length <= 100) return candidate;
  return `ivytek-txn-${crypto.createHash('sha256').update(sourceTransactionId, 'utf8').digest('hex').slice(0, 40)}`;
}

function mapTransactionType(historyType, paymentType, specialCode, amount, voided) {
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

function buildNote(rec) {
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
  if (rec.description) parts.push(`description ${rec.description}`);
  if (rec.sourceComment) parts.push(`source comments ${rec.sourceComment}`);
  if (rec.receiptNumber) parts.push(`receipt ${rec.receiptNumber}`);
  if (rec.checkNumber) parts.push(`check ${rec.checkNumber}`);
  return `${NOTE_PREFIX} ${parts.join('; ')}`;
}

function processTransaction(txn) {
  if (!txn.sourceTransactionId) return { record: null, error: 'missing source transaction id' };
  if (txn.loanId === null || txn.loanId === undefined || isNaN(Number(txn.loanId)))
    return { record: null, error: `missing loan id for txn ${txn.sourceTransactionId}` };
  const amount = parseDecimalString(txn.amount);
  const transactionDate = parseSourceDate(txn.transactionDate);
  if (amount === null) return { record: null, error: `missing/unsupported amount for txn ${txn.sourceTransactionId}` };
  if (transactionDate === null)
    return { record: null, error: `missing/unsupported date for txn ${txn.sourceTransactionId}` };
  const principal = parseDecimalString(txn.principal);
  const interest = parseDecimalString(txn.interest);
  const voided = Boolean(txn.voided);
  const rec = {
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
  rec.note = buildNote(rec);
  return { record: rec, error: null };
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

function valuesClause(rowCount, colCount, offset = 0) {
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const cols = Array.from({ length: colCount }, (_, c) => `$${offset + r * colCount + c + 1}`);
    rows.push(`(${cols.join(', ')})`);
  }
  return rows.join(', ');
}

function chunks(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

async function ensureDetailsTable(client) {
  await client.query(`
    create table if not exists ${DETAILS_TABLE} (
      id bigserial primary key,
      transaction_external_id varchar(100) not null unique,
      note text not null,
      created_on_utc timestamptz not null default current_timestamp
    )
  `);
}

async function insertTransactionDetails(client, records, batchSize) {
  let upserted = 0;
  for (const batch of chunks(records, batchSize)) {
    const params = [];
    for (const rec of batch) params.push(rec.externalId, rec.description || '');
    const result = await client.query(
      `
      insert into ${DETAILS_TABLE} (transaction_external_id, note)
      values ${valuesClause(batch.length, 2)}
      on conflict (transaction_external_id) do update set note = excluded.note
    `,
      params
    );
    upserted += result.rowCount ?? 0;
  }
  return upserted;
}

async function insertTransactions(client, records, createdBy, batchSize) {
  let inserted = 0,
    updated = 0;
  for (const batch of chunks(records, batchSize)) {
    const params = [];
    for (const rec of batch) {
      params.push(
        rec.externalId,
        rec.loanId,
        rec.transactionTypeEnum,
        rec.transactionDate,
        rec.amount,
        rec.principal,
        rec.interest,
        null,
        null,
        null,
        null,
        null,
        rec.transactionDate,
        rec.voided,
        rec.voided ? rec.transactionDate : null
      );
    }
    const colCount = 15;
    const cbOffset = batch.length * colCount;
    params.push(createdBy, createdBy);
    const cte = `with src(
        external_id, loan_id, transaction_type_enum, transaction_date, amount,
        principal, interest, fee, penalty, overpayment, unrecognized,
        outstanding_balance, submitted_on_date, is_reversed, reversed_on_date
      ) as (values ${valuesClause(batch.length, colCount)})`;

    const insertResult = await client.query(
      `
      ${cte}
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
        current_timestamp, current_timestamp,
        null, null,
        s.reversed_on_date::date
      from src s
      join m_loan l on l.id = s.loan_id::bigint
      left join m_client c on c.id = l.client_id
      left join m_group g on g.id = l.group_id
      where not exists (
        select 1 from m_loan_transaction t where t.external_id = s.external_id::varchar
      )`,
      params
    );
    inserted += insertResult.rowCount ?? 0;

    const updateResult = await client.query(
      `
      ${cte}
      update m_loan_transaction t set
        transaction_type_enum       = s.transaction_type_enum::smallint,
        transaction_date            = s.transaction_date::date,
        amount                      = s.amount::numeric,
        principal_portion_derived   = coalesce(s.principal::numeric, 0::numeric),
        interest_portion_derived    = coalesce(s.interest::numeric, 0::numeric),
        fee_charges_portion_derived = coalesce(s.fee::numeric, 0::numeric),
        penalty_charges_portion_derived  = coalesce(s.penalty::numeric, 0::numeric),
        overpayment_portion_derived      = coalesce(s.overpayment::numeric, 0::numeric),
        unrecognized_income_portion      = coalesce(s.unrecognized::numeric, 0::numeric),
        outstanding_loan_balance_derived = coalesce(s.outstanding_balance::numeric, 0::numeric),
        submitted_on_date           = s.submitted_on_date::date,
        is_reversed                 = s.is_reversed::boolean,
        reversed_on_date            = s.reversed_on_date::date,
        last_modified_by            = $${cbOffset + 2},
        last_modified_on_utc        = current_timestamp
      from src s
      where t.external_id = s.external_id::varchar`,
      params
    );
    updated += updateResult.rowCount ?? 0;
  }
  return { inserted, updated };
}

async function insertNotes(client, records, createdBy, batchSize) {
  for (const batch of chunks(records, batchSize)) {
    const params = [];
    for (const rec of batch) params.push(rec.externalId, rec.note);
    const noteOffset = batch.length * 2;
    params.push(createdBy, createdBy, `${NOTE_PREFIX}%`);
    await client.query(
      `
      with src(external_id, note) as (values ${valuesClause(batch.length, 2)})
      insert into m_note (
        id, client_id, group_id, loan_id, loan_transaction_id, savings_account_id,
        savings_account_transaction_id, share_account_id, note_type_enum, note,
        created_date, created_by, lastmodified_date, last_modified_by,
        created_on_utc, last_modified_on_utc
      )
      select nextval('m_note_id_seq'), null, null, t.loan_id, t.id,
        null, null, null, 300, s.note::varchar,
        current_timestamp, $${noteOffset + 1},
        current_timestamp, $${noteOffset + 2},
        current_timestamp, current_timestamp
      from src s
      join m_loan_transaction t on t.external_id = s.external_id::varchar
      where not exists (
        select 1 from m_note n
        where n.loan_transaction_id = t.id and n.note like $${noteOffset + 3}
      )`,
      params
    );
  }
}

async function fetchDbTotals(client, externalIds, batchSize) {
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
  const loanIds = new Set();
  for (const batch of chunks(externalIds, batchSize)) {
    const ph = batch.map((_, i) => `$${i + 1}`).join(', ');
    const countRes = await client.query(
      `select count(*)::bigint                                                   as row_count,
              coalesce(sum(amount), 0::numeric)                                  as total_amount,
              coalesce(sum(principal_portion_derived), 0::numeric)               as total_principal,
              coalesce(sum(interest_portion_derived), 0::numeric)                as total_interest,
              coalesce(sum(case when is_reversed then 1 else 0 end), 0::bigint)  as reversed_count
       from m_loan_transaction where external_id in (${ph})`,
      batch
    );
    const r = countRes.rows[0];
    totals.count += parseInt(r.row_count || 0);
    totals.amount += parseFloat(r.total_amount || 0);
    totals.principal += parseFloat(r.total_principal || 0);
    totals.interest += parseFloat(r.total_interest || 0);
    totals.reversedCount += parseInt(r.reversed_count || 0);
    const loanRes = await client.query(
      `select distinct loan_id from m_loan_transaction where external_id in (${ph})`,
      batch
    );
    loanRes.rows.forEach((row) => loanIds.add(row.loan_id));
    const noteRes = await client.query(
      `select count(*)::bigint as note_count from m_note n
       join m_loan_transaction t on t.id = n.loan_transaction_id
       where t.external_id in (${ph}) and n.note like $${batch.length + 1}`,
      [
        ...batch,
        `${NOTE_PREFIX}%`
      ]
    );
    totals.noteCount += parseInt(noteRes.rows[0].note_count || 0);
  }
  totals.loanCount = loanIds.size;
  const tableCheck = await client.query('select to_regclass($1) as tbl', [DETAILS_TABLE]);
  if (tableCheck.rows[0].tbl) {
    for (const batch of chunks(externalIds, batchSize)) {
      const ph = batch.map((_, i) => `$${i + 1}`).join(', ');
      const inRes = await client.query(
        `select count(*)::bigint as note_count from ${DETAILS_TABLE} where transaction_external_id in (${ph})`,
        batch
      );
      totals.importNoteCount += parseInt(inRes.rows[0].note_count || 0);
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Main import orchestration
// ---------------------------------------------------------------------------

async function runImport({ db, transactions, createdBy = 4, apply = false }) {
  const warnings = [];
  const records = [];
  for (const txn of transactions) {
    const { record, error } = processTransaction(txn);
    if (error) warnings.push(error);
    else if (record) records.push(record);
  }
  if (!records.length)
    return {
      success: false,
      message: 'No valid transactions to import after validation.',
      inserted: 0,
      skipped: 0,
      warnings,
      reconciliation: []
    };

  const client = new Client({
    host: db.host,
    port: db.port ?? 5432,
    database: db.dbname,
    user: db.user,
    password: db.password
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const externalIds = records.map((r) => r.externalId);
    const sourceAmount = records.reduce((s, r) => s + parseFloat(r.amount), 0);
    const sourcePrincipal = records.reduce((s, r) => s + parseFloat(r.principal ?? '0'), 0);
    const sourceInterest = records.reduce((s, r) => s + parseFloat(r.interest ?? '0'), 0);
    const sourceReversed = records.filter((r) => r.voided).length;
    const sourceLoanCount = new Set(records.map((r) => r.loanId)).size;
    let insertedCount = 0,
      updatedCount = 0,
      detailsTableReady = false;

    if (apply) {
      try {
        await ensureDetailsTable(client);
        detailsTableReady = true;
      } catch (e) {
        warnings.push(`Could not create ${DETAILS_TABLE} (${e.message}). Grant CREATE on schema public to enable it.`);
      }
      const upsertResult = await insertTransactions(client, records, createdBy, DEFAULT_BATCH_SIZE);
      insertedCount = upsertResult.inserted;
      updatedCount = upsertResult.updated;
      if (detailsTableReady) await insertTransactionDetails(client, records, DEFAULT_BATCH_SIZE);
    }

    const dbTotals = await fetchDbTotals(client, externalIds, DEFAULT_BATCH_SIZE);
    const near = (a, b) => Math.abs(a - b) < 0.005;
    const reconciliation = [
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
      { metric: 'Notes', source: '-', database: dbTotals.noteCount, difference: 0, status: 'Info' },
      {
        metric: 'Transaction Details Rows',
        source: records.length,
        database: dbTotals.importNoteCount,
        difference: dbTotals.importNoteCount - records.length,
        status: detailsTableReady ? (dbTotals.importNoteCount === records.length ? 'Matched' : 'Needs Review') : 'Info'
      },
      { metric: 'Inserted This Run', source: '-', database: insertedCount, difference: 0, status: 'Info' },
      { metric: 'Updated This Run', source: '-', database: updatedCount, difference: 0, status: 'Info' }
    ];
    const allMatch = reconciliation.filter((r) => r.status !== 'Info').every((r) => r.status === 'Matched');

    if (apply && allMatch) {
      await client.query('COMMIT');
      return {
        success: true,
        message: `Committed: ${insertedCount} inserted, ${updatedCount} updated.`,
        inserted: insertedCount,
        updated: updatedCount,
        warnings,
        reconciliation
      };
    } else if (apply) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: 'Rolled back: reconciliation totals did not match. Review the table below.',
        inserted: 0,
        updated: 0,
        warnings,
        reconciliation
      };
    } else {
      await client.query('ROLLBACK');
      return {
        success: true,
        message: `Dry run complete. ${records.length} transactions ready. Re-run with Apply to commit.`,
        inserted: 0,
        updated: 0,
        warnings,
        reconciliation
      };
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// FeedPost notes import
// ---------------------------------------------------------------------------

function parseSourceDateString(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const mdyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}`;
  return null;
}

function parseFeedPostCsv(text) {
  const rows = parseCsv(text);
  const records = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sourceId = (row['Id'] || '').trim();
    const parentId = (row['ParentId'] || row['ParentID'] || '').trim();
    const rawBody = (row['Body'] || '').trim();
    if (!sourceId) {
      errors.push(`CSV row ${i + 2}: missing Id`);
      continue;
    }
    if (!parentId) {
      errors.push(`CSV row ${i + 2}: missing ParentId`);
      continue;
    }
    if (!rawBody) continue;
    const body = stripHtml(rawBody);
    if (!body) continue;
    const createdDate = parseSourceDateString(row['CreatedDate'] || '');
    const header = `${FEEDPOST_NOTE_PREFIX} source ${sourceId}${createdDate ? `; created ${createdDate}` : ''}`;
    records.push({ sourceId, parentId, loanId: null, note: `${header}\n${body}` });
  }
  return { records, errors };
}

async function ensureFeedPostTrackingTable(client) {
  await client.query(`
    create table if not exists ${FEEDPOST_TRACKING_TABLE} (
      id bigserial primary key,
      note_id bigint not null unique references m_note(id) on delete cascade,
      source_id varchar(100) not null unique,
      parent_id varchar(100) not null,
      created_on_utc timestamptz not null default current_timestamp
    )
  `);
  await client.query(
    `create index if not exists idx_${FEEDPOST_TRACKING_TABLE}_parent_id on ${FEEDPOST_TRACKING_TABLE}(parent_id)`
  );
}

async function lookupLoansByParentId(client, parentIds, batchSize) {
  const lookup = new Map();
  const unique = [...new Set(parentIds.filter(Boolean))];
  if (!unique.length) return lookup;
  for (const batch of chunks(unique, batchSize)) {
    const ph = batch.map((_, i) => `$${i + 1}`).join(', ');
    const res = await client.query(`select id, external_id from m_loan where external_id in (${ph})`, batch);
    res.rows.forEach((r) => lookup.set(r.external_id, Number(r.id)));
  }
  const unresolved = unique.filter((id) => !lookup.has(id));
  if (unresolved.length) {
    for (const batch of chunks(unresolved, batchSize)) {
      const ph = batch.map((_, i) => `$${i + 1}`).join(', ');
      const res = await client.query(`select id, account_no from m_loan where account_no in (${ph})`, batch);
      res.rows.forEach((r) => lookup.set(r.account_no, Number(r.id)));
    }
  }
  return lookup;
}

async function fetchExistingFeedPostSourceIds(client, sourceIds, batchSize) {
  const existing = new Set();
  const tableCheck = await client.query('select to_regclass($1) as tbl', [FEEDPOST_TRACKING_TABLE]);
  if (!tableCheck.rows[0].tbl) return existing;
  for (const batch of chunks(sourceIds, batchSize)) {
    const ph = batch.map((_, i) => `$${i + 1}`).join(', ');
    const res = await client.query(
      `select source_id from ${FEEDPOST_TRACKING_TABLE} where source_id in (${ph})`,
      batch
    );
    res.rows.forEach((r) => existing.add(r.source_id));
  }
  return existing;
}

async function fetchFeedPostDbNoteCount(client, sourceIds, batchSize) {
  const tableCheck = await client.query('select to_regclass($1) as tbl', [FEEDPOST_TRACKING_TABLE]);
  if (!tableCheck.rows[0].tbl) return 0;
  let count = 0;
  for (const batch of chunks(sourceIds, batchSize)) {
    const ph = batch.map((_, i) => `$${i + 1}`).join(', ');
    const res = await client.query(
      `select count(*)::bigint as cnt from ${FEEDPOST_TRACKING_TABLE} where source_id in (${ph})`,
      batch
    );
    count += parseInt(res.rows[0].cnt || 0);
  }
  return count;
}

async function insertFeedPostNotes(client, records, createdBy) {
  let inserted = 0;
  for (const record of records) {
    const noteRes = await client.query(
      `
      insert into m_note (
        id, client_id, group_id, loan_id, loan_transaction_id, savings_account_id,
        savings_account_transaction_id, share_account_id, note_type_enum, note,
        created_date, created_by, lastmodified_date, last_modified_by,
        created_on_utc, last_modified_on_utc
      ) values (
        nextval('m_note_id_seq'),
        null, null, $1, null, null, null, null,
        ${NOTE_TYPE_LOAN}, $2,
        current_timestamp, $3, current_timestamp, $3,
        current_timestamp, current_timestamp
      ) returning id
    `,
      [
        record.loanId,
        record.note,
        createdBy
      ]
    );
    await client.query(`insert into ${FEEDPOST_TRACKING_TABLE} (note_id, source_id, parent_id) values ($1, $2, $3)`, [
      noteRes.rows[0].id,
      record.sourceId,
      record.parentId
    ]);
    inserted++;
  }
  return inserted;
}

async function runFeedPostImport({ db, feedPostCsvText, createdBy = 4, apply = false }) {
  const { records: parsedRecords, errors } = parseFeedPostCsv(feedPostCsvText);
  const warnings = [...errors];

  if (!parsedRecords.length) {
    return {
      success: false,
      message: 'No FeedPost rows with a non-empty body were found.',
      inserted: 0,
      skipped: 0,
      warnings,
      reconciliation: []
    };
  }

  const client = new Client({
    host: db.host,
    port: db.port ?? 5432,
    database: db.dbname,
    user: db.user,
    password: db.password
  });
  await client.connect();
  try {
    await client.query('BEGIN');

    const loanLookup = await lookupLoansByParentId(
      client,
      [...new Set(parsedRecords.map((r) => r.parentId))],
      DEFAULT_BATCH_SIZE
    );
    const unmatched = [];
    const records = [];
    for (const rec of parsedRecords) {
      const loanId = loanLookup.get(rec.parentId);
      if (loanId === undefined) unmatched.push(rec.parentId);
      else records.push({ ...rec, loanId });
    }
    if (unmatched.length)
      warnings.push(
        `${unmatched.length} ParentId(s) not matched to a loan: ${[...new Set(unmatched)].slice(0, 10).join(', ')}${unmatched.length > 10 ? ' ...' : ''}`
      );

    if (!records.length) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: 'No FeedPost records could be matched to a loan.',
        inserted: 0,
        skipped: 0,
        warnings,
        reconciliation: []
      };
    }

    const sourceIds = records.map((r) => r.sourceId);
    const existingIds = await fetchExistingFeedPostSourceIds(client, sourceIds, DEFAULT_BATCH_SIZE);
    const toInsert = records.filter((r) => !existingIds.has(r.sourceId));

    let insertedCount = 0;
    if (apply) {
      await ensureFeedPostTrackingTable(client);
      insertedCount = await insertFeedPostNotes(client, toInsert, createdBy);
    }

    const dbCount = await fetchFeedPostDbNoteCount(client, sourceIds, DEFAULT_BATCH_SIZE);
    const reconciliation = [
      {
        metric: 'Note Count',
        source: records.length,
        database: dbCount,
        difference: dbCount - records.length,
        status: dbCount === records.length ? 'Matched' : 'Needs Review'
      },
      {
        metric: 'Inserted This Run',
        source: records.length,
        database: insertedCount,
        difference: insertedCount - records.length,
        status: 'Info'
      },
      { metric: 'Skipped Existing', source: records.length, database: existingIds.size, difference: 0, status: 'Info' }
    ];
    const allMatch = reconciliation.filter((r) => r.status !== 'Info').every((r) => r.status === 'Matched');

    if (apply && allMatch) {
      await client.query('COMMIT');
      return {
        success: true,
        message: `Committed ${insertedCount} FeedPost note rows.`,
        inserted: insertedCount,
        skipped: existingIds.size,
        warnings,
        reconciliation
      };
    } else if (apply) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: 'Rolled back: note count did not match source count.',
        inserted: 0,
        skipped: existingIds.size,
        warnings,
        reconciliation
      };
    } else {
      await client.query('ROLLBACK');
      return {
        success: true,
        message: `Dry run: ${records.length} FeedPost notes ready (${existingIds.size} already imported). Re-run with Apply to commit.`,
        inserted: 0,
        skipped: existingIds.size,
        warnings,
        reconciliation
      };
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

async function handleFeedPostImport(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(res, 400, { success: false, message: 'Invalid JSON body.' });
  }

  const { db, apply = false, createdBy = 4, feedPostCsvText } = body;
  if (!db?.host || !db?.dbname || !db?.user)
    return jsonResponse(res, 400, { success: false, message: 'Missing required db fields: host, dbname, user.' });
  if (!feedPostCsvText)
    return jsonResponse(res, 400, { success: false, message: 'Missing feedPostCsvText in request body.' });

  try {
    const result = await runFeedPostImport({ db, feedPostCsvText, createdBy, apply });
    jsonResponse(res, 200, result);
  } catch (e) {
    console.error('[IvyTek FeedPost] Import error:', e);
    jsonResponse(res, 500, { success: false, message: `FeedPost import failed: ${e.message}` });
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

async function handleSqlImportCsv(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(res, 400, { success: false, message: 'Invalid JSON body.' });
  }

  const { db, apply = false, createdBy = 4, csvText, loanCsvText } = body;
  if (!db?.host || !db?.dbname || !db?.user)
    return jsonResponse(res, 400, { success: false, message: 'Missing required db fields: host, dbname, user.' });
  if (!csvText) return jsonResponse(res, 400, { success: false, message: 'Missing csvText in request body.' });

  const rows = parseCsv(csvText);
  if (!rows.length) return jsonResponse(res, 400, { success: false, message: 'CSV is empty or has no data rows.' });

  let loanIdentifierMap;
  if (loanCsvText) {
    try {
      loanIdentifierMap = buildLoanIdentifierMap(parseCsv(loanCsvText));
    } catch {}
  }

  const lookupWarnings = [];
  let transactions;
  const lookupClient = new Client({
    host: db.host,
    port: db.port ?? 5432,
    database: db.dbname,
    user: db.user,
    password: db.password
  });
  try {
    await lookupClient.connect();
    const directLegacyIds = rows.map((r) => csvLegacyLoanId(r)).filter(Boolean);
    const loanCsvAccountNos = loanIdentifierMap ? [...new Set(loanIdentifierMap.values())] : [];
    const loanIdMap = await lookupLoanIds(lookupClient, [
      ...new Set([
        ...directLegacyIds,
        ...loanCsvAccountNos
      ])
    ]);

    transactions = rows.map((r) => csvRowToSqlTransaction(r, loanIdMap, loanIdentifierMap)).filter((t) => t !== null);
    const unmapped = new Set(
      transactions
        .filter((t) => t.loanId === null)
        .map((t) => t.legacyLoanId)
        .filter(Boolean)
    );
    if (unmapped.size)
      lookupWarnings.push(
        `${unmapped.size} legacy loan ID(s) not found in m_loan.account_no: ${[...unmapped].slice(0, 10).join(', ')}${unmapped.size > 10 ? ' ...' : ''}`
      );
    if (loanIdentifierMap)
      lookupWarnings.push(`Loan cross-reference: ${loanIdentifierMap.size} identifier(s) loaded from loan CSV.`);
  } catch (e) {
    return jsonResponse(res, 500, { success: false, message: `DB loan-lookup failed: ${e.message}` });
  } finally {
    await lookupClient.end().catch(() => {});
  }

  if (!transactions.length)
    return jsonResponse(res, 400, {
      success: false,
      message: 'No importable transactions found after loan ID resolution.',
      warnings: lookupWarnings
    });

  try {
    const result = await runImport({ db, transactions, createdBy, apply });
    result.warnings = [
      ...lookupWarnings,
      ...result.warnings
    ];
    jsonResponse(res, 200, result);
  } catch (e) {
    console.error('[IvyTek SQL] Import error:', e);
    jsonResponse(res, 500, { success: false, message: `Import failed: ${e.message}` });
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function startInlineServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }
    if (req.url === '/api/ivytek/health') {
      return jsonResponse(res, 200, { status: 'ok', service: 'IvyTek SQL Import (inline)' });
    }
    if (req.url === '/api/ivytek/sql-import-csv' && req.method === 'POST') {
      return handleSqlImportCsv(req, res);
    }
    if (req.url === '/api/ivytek/feedpost-import' && req.method === 'POST') {
      return handleFeedPostImport(req, res);
    }
    jsonResponse(res, 404, { message: 'Not found' });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[IvyTek SQL] Port ${PORT} already in use — another instance may be running.`);
    } else {
      console.error('[IvyTek SQL] Server error:', err);
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[IvyTek SQL] Inline import server listening on http://127.0.0.1:${PORT}`);
  });

  return server;
}

module.exports = { startInlineServer };
