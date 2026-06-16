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
const NOTE_TABLE = 'c_txn_note';
const NOTE_PREFIX = 'IvyTek SQL history import:';

// Retained after each successful import so the note endpoints can serve reads/writes.
let _lastDbConfig = null;
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

function resolvePaymentTypeName(typPay, description) {
  const mifosTypes = [
    { name: 'PENSION', keys: [
        'pension',
        'pensionpayment'
      ] },
    { name: 'PAYROLL', keys: [
        'payroll',
        'payrollpayment'
      ] },
    { name: 'PERCAPITA', keys: [
        'percapita',
        'percapitapayment',
        'percapitapay',
        'percap'
      ] },
    { name: 'REFUND', keys: [
        'refund',
        'repaymentadjustmentrefund'
      ] },
    { name: 'REG PAYMENT', keys: [
        'regpayment',
        'repaymentadjustmentchargeback',
        'regularpayment'
      ] }
  ];
  const normalize = (v) =>
    String(v || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  for (const candidate of [
    typPay,
    description
  ]
    .map(normalize)
    .filter(Boolean)) {
    const match = mifosTypes.find((pt) => pt.keys.some((k) => candidate.includes(k) || k.includes(candidate)));
    if (match) return match.name;
  }
  return 'REG PMNT';
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
    .replace(/\\highlight\d*/g, '')
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
    paymentType: resolvePaymentTypeName(
      csvVal(row, 'IvytekTestPkg__TypPay__c'),
      csvVal(row, 'IvytekTestPkg__Description__c')
    ),
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
  return rec.description || '';
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

function valuesClause(rowCount, colCount, offset = 0, types = null) {
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const cols = Array.from({ length: colCount }, (_, c) => {
      const p = `$${offset + r * colCount + c + 1}`;
      return types && types[c] ? `${p}::${types[c]}` : p;
    });
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

async function ensureNoteTable(client) {
  await client.query(`
    create table if not exists ${NOTE_TABLE} (
      id bigserial primary key,
      loan_id bigint not null references m_loan(id),
      transaction_id decimal(19,6),
      note varchar(1000)
    )
  `);
  await client.query(`
    do $$ begin
      if not exists (
        select 1 from pg_constraint
        where conrelid = '${NOTE_TABLE}'::regclass and contype = 'u'
          and conname = '${NOTE_TABLE}_loan_txn_unique'
      ) then
        alter table ${NOTE_TABLE}
          add constraint ${NOTE_TABLE}_loan_txn_unique unique (loan_id, transaction_id);
      end if;
    end $$
  `);
}

async function insertIvyTekNotes(client, records, batchSize) {
  let upserted = 0;
  const noteRecords = records.filter((r) => r.note);
  for (const batch of chunks(noteRecords, batchSize)) {
    const params = [];
    for (const rec of batch) params.push(rec.externalId, rec.note);
    const res = await client.query(
      `
      with src(external_id, note) as (values ${valuesClause(batch.length, 2)})
      insert into ${NOTE_TABLE} (loan_id, transaction_id, note)
      select t.loan_id, t.id, s.note
      from src s
      join m_loan_transaction t on t.external_id = s.external_id::varchar
      on conflict (loan_id, transaction_id) do update set note = excluded.note
      `,
      params
    );
    upserted += res.rowCount ?? 0;
  }
  return upserted;
}

async function upsertPaymentDetails(client, records) {
  const processable = records.filter((r) => r.paymentType && r.externalId);
  if (!processable.length) return 0;

  // 1. Resolve payment type names → IDs (one query)
  const uniqueNames = [...new Set(processable.map((r) => r.paymentType))];
  const ptPh = uniqueNames.map((_, i) => `$${i + 1}`).join(', ');
  const ptRes = await client.query(`SELECT id, value FROM m_payment_type WHERE value IN (${ptPh})`, uniqueNames);
  const paymentTypeIdMap = new Map(
    ptRes.rows.map((r) => [
      r.value,
      Number(r.id)
    ])
  );
  if (!paymentTypeIdMap.size) return 0;

  const withType = processable.filter((r) => paymentTypeIdMap.has(r.paymentType));
  if (!withType.length) return 0;

  // 2. Batch-fetch existing payment_detail_id for all records (one query)
  const extIds = withType.map((r) => r.externalId);
  const txRes = await client.query(
    `SELECT external_id, payment_detail_id FROM m_loan_transaction
     WHERE external_id = ANY($1::text[])`,
    [extIds]
  );
  const existingPdMap = new Map(
    txRes.rows.map((r) => [
      r.external_id,
      r.payment_detail_id ? Number(r.payment_detail_id) : null
    ])
  );

  const toUpdate = withType.filter((r) => existingPdMap.get(r.externalId));
  const toInsert = withType.filter((r) => !existingPdMap.get(r.externalId));

  // 3. Batch-update existing payment_detail rows (one query)
  if (toUpdate.length) {
    await client.query(
      `UPDATE m_payment_detail pd
       SET payment_type_id = t.pt_id,
           receipt_number  = t.rcpt,
           check_number    = t.chk
       FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::text[])
            AS t(pd_id, pt_id, rcpt, chk)
       WHERE pd.id = t.pd_id`,
      [
        toUpdate.map((r) => existingPdMap.get(r.externalId)),
        toUpdate.map((r) => paymentTypeIdMap.get(r.paymentType)),
        toUpdate.map((r) => r.receiptNumber || null),
        toUpdate.map((r) => r.checkNumber || null)
      ]
    );
  }

  // 4. Batch-insert new payment_detail rows, using bank_number as a temporary
  //    external_id carrier so we can link them back without per-row round trips.
  if (toInsert.length) {
    await client.query(
      `INSERT INTO m_payment_detail
         (payment_type_id, account_number, check_number, routing_code, receipt_number, bank_number)
       SELECT pt_id, null, chk, null, rcpt, ext_id
       FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[])
            AS t(pt_id, chk, rcpt, ext_id)`,
      [
        toInsert.map((r) => paymentTypeIdMap.get(r.paymentType)),
        toInsert.map((r) => r.checkNumber || null),
        toInsert.map((r) => r.receiptNumber || null),
        toInsert.map((r) => r.externalId)
      ]
    );

    // Link new rows back to their transactions via bank_number = external_id
    await client.query(
      `UPDATE m_loan_transaction txn
       SET payment_detail_id = pd.id
       FROM m_payment_detail pd
       WHERE pd.bank_number = txn.external_id
         AND txn.external_id = ANY($1::text[])
         AND txn.payment_detail_id IS NULL`,
      [toInsert.map((r) => r.externalId)]
    );

    // Clear the temporary bank_number values
    await client.query(
      `UPDATE m_payment_detail SET bank_number = null
       WHERE bank_number = ANY($1::text[])`,
      [toInsert.map((r) => r.externalId)]
    );
  }

  return withType.length;
}

async function insertTransactions(client, records, createdBy, batchSize) {
  // Uses UNNEST with typed arrays — avoids CTE VALUES null-type-inference issues
  // that cause "could not determine data type of parameter $N" in PostgreSQL.
  let inserted = 0,
    updated = 0;
  for (const batch of chunks(records, batchSize)) {
    const externalIds = batch.map((r) => r.externalId);
    const loanIds = batch.map((r) => r.loanId);
    const typeEnums = batch.map((r) => r.transactionTypeEnum);
    const dates = batch.map((r) => r.transactionDate);
    const amounts = batch.map((r) => r.amount);
    const principals = batch.map((r) => r.principal ?? null);
    const interests = batch.map((r) => r.interest ?? null);
    const isReversed = batch.map((r) => r.voided);

    const unnest = `unnest(
        $1::varchar[], $2::bigint[], $3::smallint[], $4::date[],
        $5::numeric[], $6::numeric[], $7::numeric[], $8::boolean[]
      ) as s(external_id, loan_id, transaction_type_enum, transaction_date,
             amount, principal, interest, is_reversed)`;

    // INSERT uses $9=created_by and $10=last_modified_by; UPDATE only needs $9=last_modified_by
    const insertParams = [
      externalIds,
      loanIds,
      typeEnums,
      dates,
      amounts,
      principals,
      interests,
      isReversed,
      createdBy,
      createdBy
    ];
    const updateParams = [
      externalIds,
      loanIds,
      typeEnums,
      dates,
      amounts,
      principals,
      interests,
      isReversed,
      createdBy
    ];

    const insertResult = await client.query(
      `
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
        s.loan_id,
        coalesce(c.office_id, g.office_id, 1::bigint)::bigint,
        null,
        s.is_reversed,
        s.external_id,
        s.transaction_type_enum,
        s.transaction_date,
        s.amount,
        coalesce(s.principal, 0::numeric),
        coalesce(s.interest, 0::numeric),
        0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
        s.transaction_date,
        false,
        current_timestamp,
        $9::bigint, $10::bigint,
        current_timestamp, current_timestamp,
        null, null,
        case when s.is_reversed then s.transaction_date else null end
      from ${unnest}
      join m_loan l on l.id = s.loan_id
      left join m_client c on c.id = l.client_id
      left join m_group g on g.id = l.group_id
      where not exists (
        select 1 from m_loan_transaction t where t.external_id = s.external_id
      )`,
      insertParams
    );
    inserted += insertResult.rowCount ?? 0;

    const updateResult = await client.query(
      `
      update m_loan_transaction t set
        transaction_type_enum            = s.transaction_type_enum,
        transaction_date                 = s.transaction_date,
        amount                           = s.amount,
        principal_portion_derived        = coalesce(s.principal, 0::numeric),
        interest_portion_derived         = coalesce(s.interest, 0::numeric),
        fee_charges_portion_derived      = 0::numeric,
        penalty_charges_portion_derived  = 0::numeric,
        overpayment_portion_derived      = 0::numeric,
        unrecognized_income_portion      = 0::numeric,
        outstanding_loan_balance_derived = 0::numeric,
        submitted_on_date                = s.transaction_date,
        is_reversed                      = s.is_reversed,
        reversed_on_date                 = case when s.is_reversed then s.transaction_date else null end,
        last_modified_by                 = $9::bigint,
        last_modified_on_utc             = current_timestamp
      from ${unnest}
      where t.external_id = s.external_id`,
      updateParams
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
    params.push(createdBy, `${NOTE_PREFIX}%`);
    await client.query(
      `
      with src(external_id, note) as (values ${valuesClause(batch.length, 2)}),
      updated as (
        update m_note n
        set note = s.note::varchar,
            lastmodified_date = current_timestamp,
            last_modified_by = $${noteOffset + 1},
            last_modified_on_utc = current_timestamp
        from src s
        join m_loan_transaction t on t.external_id = s.external_id::varchar
        where n.loan_transaction_id = t.id and n.note like $${noteOffset + 2}
        returning n.loan_transaction_id
      )
      insert into m_note (
        id, client_id, group_id, loan_id, loan_transaction_id, savings_account_id,
        savings_account_transaction_id, share_account_id, note_type_enum, note,
        created_date, created_by, lastmodified_date, last_modified_by,
        created_on_utc, last_modified_on_utc
      )
      select nextval('m_note_id_seq'), null, null, t.loan_id, t.id,
        null, null, null, 300, s.note::varchar,
        current_timestamp, $${noteOffset + 1},
        current_timestamp, $${noteOffset + 1},
        current_timestamp, current_timestamp
      from src s
      join m_loan_transaction t on t.external_id = s.external_id::varchar
      where not exists (
        select 1 from m_note n where n.loan_transaction_id = t.id
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
  const tableCheck = await client.query('select to_regclass($1) as tbl', [NOTE_TABLE]);
  if (tableCheck.rows[0].tbl) {
    for (const batch of chunks(externalIds, batchSize)) {
      const ph = batch.map((_, i) => `$${i + 1}`).join(', ');
      const inRes = await client.query(
        `select count(*)::bigint as note_count
         from ${NOTE_TABLE} n
         join m_loan_transaction t on t.id = n.transaction_id::bigint
         where t.external_id in (${ph})`,
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
  _lastDbConfig = { host: db.host, port: db.port ?? 5432, dbname: db.dbname, user: db.user, password: db.password };
  try {
    // Phase 1: DDL runs outside the main transaction so the table survives a
    // reconciliation rollback and is available immediately on re-runs.
    let noteTableReady = false;
    if (apply) {
      try {
        await ensureNoteTable(client);
        noteTableReady = true;
      } catch (e) {
        warnings.push(`Could not create ${NOTE_TABLE} (${e.message}). Grant CREATE on schema public to enable it.`);
      }
    }

    // Phase 2: transaction data — rolled back as a unit if totals don't match.
    await client.query('BEGIN');
    const externalIds = records.map((r) => r.externalId);
    const sourceAmount = records.reduce((s, r) => s + parseFloat(r.amount), 0);
    const sourcePrincipal = records.reduce((s, r) => s + parseFloat(r.principal ?? '0'), 0);
    const sourceInterest = records.reduce((s, r) => s + parseFloat(r.interest ?? '0'), 0);
    const sourceReversed = records.filter((r) => r.voided).length;
    const sourceLoanCount = new Set(records.map((r) => r.loanId)).size;
    let insertedCount = 0,
      updatedCount = 0;

    if (apply) {
      const upsertResult = await insertTransactions(client, records, createdBy, DEFAULT_BATCH_SIZE);
      insertedCount = upsertResult.inserted;
      updatedCount = upsertResult.updated;

      // Update payment types within the same transaction so they commit or roll back
      // together with the financial data. SAVEPOINT isolates any schema/permission
      // failure so it logs a warning without aborting the whole transaction.
      await client.query('SAVEPOINT sp_payment_details');
      try {
        const pdCount = await upsertPaymentDetails(client, records);
        if (pdCount > 0) warnings.push(`Payment details: ${pdCount} transaction(s) linked.`);
        await client.query('RELEASE SAVEPOINT sp_payment_details');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_payment_details');
        await client.query('RELEASE SAVEPOINT sp_payment_details');
        warnings.push(`Payment detail update failed (non-fatal): ${e.message}`);
      }
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
      {
        metric: 'Import Note Table Rows',
        source: records.filter((r) => r.note).length,
        database: dbTotals.importNoteCount,
        difference: dbTotals.importNoteCount - records.filter((r) => r.note).length,
        status: 'Info'
      },
      { metric: 'Inserted This Run', source: '-', database: insertedCount, difference: 0, status: 'Info' },
      { metric: 'Updated This Run', source: '-', database: updatedCount, difference: 0, status: 'Info' }
    ];
    const allMatch = reconciliation.filter((r) => r.status !== 'Info').every((r) => r.status === 'Matched');

    if (apply && allMatch) {
      await client.query('COMMIT');

      // Phase 3: write notes after the main commit so note failures never roll
      // back transaction data, and re-runs always refresh existing note rows.
      if (noteTableReady) {
        try {
          await insertIvyTekNotes(client, records, DEFAULT_BATCH_SIZE);
        } catch (e) {
          warnings.push(`Note table update failed: ${e.message}`);
        }
      }

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

const MAX_NOTE_LEN = 1000;

function splitNote(fullText) {
  if (fullText.length <= MAX_NOTE_LEN) return [fullText];
  // Reserve 10 chars for the " (NN/NN)" suffix; handles up to 99 parts.
  const chunkSize = MAX_NOTE_LEN - 10;
  const rawChunks = [];
  for (let i = 0; i < fullText.length; i += chunkSize) {
    rawChunks.push(fullText.slice(i, i + chunkSize).trimEnd());
  }
  const n = rawChunks.length;
  return rawChunks.map((c, idx) => `${c} (${idx + 1}/${n})`);
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
    const rawCreatedDate = (row['CreatedDate'] || '').trim() || null;
    const parts = splitNote(body);
    for (let p = 0; p < parts.length; p++) {
      const partSourceId = parts.length > 1 ? `${sourceId}-p${p + 1}` : sourceId;
      records.push({ sourceId: partSourceId, parentId, loanId: null, note: parts[p], createdDate, rawCreatedDate });
    }
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
        coalesce($4::date, current_timestamp::date), $3,
        coalesce($4::date, current_timestamp::date), $3,
        coalesce($5::timestamptz, current_timestamp), current_timestamp
      ) returning id
    `,
      [
        record.loanId,
        record.note,
        createdBy,
        record.createdDate ?? null,
        record.rawCreatedDate ?? null
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

async function runFeedPostImport({ db, feedPostCsvText, loanCsvText, createdBy = 4, apply = false }) {
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

  // Build ParentId → legacy account number map from the loan CSV when provided.
  // FeedPost ParentId = Salesforce loan object Id, which appears as the Id column
  // in IvyTekTestPkg__Loan_C.csv. buildLoanIdentifierMap keys that Id to account_no.
  const loanIdentifierMap = loanCsvText ? buildLoanIdentifierMap(parseCsv(loanCsvText)) : null;
  if (loanIdentifierMap)
    warnings.push(`Loan cross-reference: ${loanIdentifierMap.size} identifier(s) loaded from loan CSV.`);

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

    const uniqueParentIds = [...new Set(parsedRecords.map((r) => r.parentId))];

    // Resolve parentIds to legacy account numbers via the loan CSV map, then
    // look up m_loan.id by account_no. Fall back to direct external_id / account_no
    // lookup for any parentId not found in the map.
    const resolvedAccountNos = loanIdentifierMap
      ? uniqueParentIds.map((id) => loanIdentifierMap.get(id)).filter(Boolean)
      : uniqueParentIds;
    const directIds = loanIdentifierMap ? uniqueParentIds.filter((id) => !loanIdentifierMap.has(id)) : [];

    const loanLookup = new Map();
    if (resolvedAccountNos.length) {
      const accountNoMap = await lookupLoanIds(client, resolvedAccountNos);
      for (const parentId of uniqueParentIds) {
        const accountNo = loanIdentifierMap?.get(parentId);
        if (accountNo) {
          const loanId = accountNoMap.get(accountNo);
          if (loanId !== undefined) loanLookup.set(parentId, loanId);
        }
      }
    }
    if (directIds.length) {
      const fallback = await lookupLoansByParentId(client, directIds, DEFAULT_BATCH_SIZE);
      fallback.forEach((loanId, parentId) => loanLookup.set(parentId, loanId));
    }

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

  const { db, apply = false, createdBy = 4, feedPostCsvText, loanCsvText } = body;
  if (!db?.host || !db?.dbname || !db?.user)
    return jsonResponse(res, 400, { success: false, message: 'Missing required db fields: host, dbname, user.' });
  if (!feedPostCsvText)
    return jsonResponse(res, 400, {
      success: false,
      message: 'FeedPost CSV body is missing or empty (feedPostCsvText field not sent).'
    });

  console.log(`[IvyTek FeedPost] received feedPostCsvText: ${feedPostCsvText.length} bytes`);
  const fpRows = parseCsv(feedPostCsvText);
  if (!fpRows.length)
    return jsonResponse(res, 400, {
      success: false,
      message: `FeedPost CSV is empty or has no data rows (received ${feedPostCsvText.length} bytes). Check that the correct file was selected and the directory was re-picked after any folder change.`
    });

  try {
    const result = await runFeedPostImport({ db, feedPostCsvText, loanCsvText, createdBy, apply });
    jsonResponse(res, 200, result);
  } catch (e) {
    console.error('[IvyTek FeedPost] Import error:', e);
    jsonResponse(res, 500, {
      success: false,
      message: `FeedPost import failed: ${e.message}`,
      error: pgErrorDetail(e)
    });
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function pgErrorDetail(e) {
  const detail = { message: e.message };
  if (e.code) detail.pgCode = e.code;
  if (e.detail) detail.pgDetail = e.detail;
  if (e.hint) detail.pgHint = e.hint;
  if (e.position) detail.pgPosition = e.position;
  if (e.where) detail.pgWhere = e.where;
  if (e.schema) detail.pgSchema = e.schema;
  if (e.table) detail.pgTable = e.table;
  if (e.column) detail.pgColumn = e.column;
  if (e.constraint) detail.pgConstraint = e.constraint;
  return detail;
}

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
  if (!csvText)
    return jsonResponse(res, 400, {
      success: false,
      message: 'Transaction CSV body is missing or empty (csvText field not sent).'
    });

  const csvFileName = body.csvFileName || '(unknown)';
  console.log(`[IvyTek SQL-CSV] "${csvFileName}" received ${csvText.length} bytes`);
  console.log(`[IvyTek SQL-CSV] first 300 chars: ${csvText.slice(0, 300).replace(/\n/g, '\\n')}`);
  const rows = parseCsv(csvText);
  if (!rows.length)
    return jsonResponse(res, 400, {
      success: false,
      message: `Transaction CSV "${csvFileName}" is empty or has no data rows (received ${csvText.length} bytes, file reports ${body.csvFileSizeOnDisk ?? '?'} bytes on disk). First 200 chars: ${csvText.slice(0, 200)}`
    });

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
    jsonResponse(res, 500, { success: false, message: `Import failed: ${e.message}`, error: pgErrorDetail(e) });
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
    if (req.url?.startsWith('/api/ivytek/loan-notes') && req.method === 'GET') {
      if (!_lastDbConfig) return jsonResponse(res, 200, []);
      const loanId = new URL(req.url, 'http://localhost').searchParams.get('loanId');
      if (!loanId) return jsonResponse(res, 400, { error: 'loanId required' });
      const nc = new Client({
        host: _lastDbConfig.host,
        port: _lastDbConfig.port,
        database: _lastDbConfig.dbname,
        user: _lastDbConfig.user,
        password: _lastDbConfig.password
      });
      try {
        await nc.connect();
        const tbl = await nc.query('select to_regclass($1) as t', [NOTE_TABLE]);
        if (!tbl.rows[0].t) return jsonResponse(res, 200, []);
        const result = await nc.query(
          `SELECT id, loan_id, transaction_id::bigint AS transaction_id, note FROM ${NOTE_TABLE} WHERE loan_id = $1`,
          [loanId]
        );
        return jsonResponse(res, 200, result.rows);
      } catch (e) {
        return jsonResponse(res, 500, { error: e.message });
      } finally {
        await nc.end().catch(() => {});
      }
    }
    if (req.url === '/api/ivytek/loan-note' && req.method === 'POST') {
      if (!_lastDbConfig) return jsonResponse(res, 503, { error: 'No DB config. Run an import first.' });
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return jsonResponse(res, 400, { error: 'Invalid JSON' });
      }
      const { loanId, transactionId, rowId, note } = body;
      const nc = new Client({
        host: _lastDbConfig.host,
        port: _lastDbConfig.port,
        database: _lastDbConfig.dbname,
        user: _lastDbConfig.user,
        password: _lastDbConfig.password
      });
      try {
        await nc.connect();
        await ensureNoteTable(nc);
        if (rowId) {
          await nc.query(`UPDATE ${NOTE_TABLE} SET note = $1 WHERE id = $2`, [
            note,
            rowId
          ]);
        } else {
          await nc.query(
            `INSERT INTO ${NOTE_TABLE} (loan_id, transaction_id, note) VALUES ($1, $2, $3)
             ON CONFLICT (loan_id, transaction_id) DO UPDATE SET note = excluded.note`,
            [
              loanId,
              transactionId,
              note
            ]
          );
        }
        return jsonResponse(res, 200, { success: true });
      } catch (e) {
        return jsonResponse(res, 500, { error: e.message });
      } finally {
        await nc.end().catch(() => {});
      }
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
