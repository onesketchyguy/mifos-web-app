/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * IvyTek SQL Import Server — plain Node.js HTTP server.
 * Started automatically by proxy.conf.js when ng serve runs, so no separate
 * npm process is needed. Can also run standalone via `npm run sql-server`.
 * Accepts JSON bodies (files as text strings) to avoid multipart complexity.
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const { Client } = require('pg');

// Loaded-at marker: this module is require()d once by proxy.conf.js when ng serve
// starts and is NEVER hot-reloaded — edits to this file do nothing until ng serve
// is fully restarted. The health endpoint compares this against the file's mtime
// so a stale process is detectable instead of silently running old code.
const CODE_LOADED_AT = new Date();

const PORT = parseInt(process.env['SQL_IMPORT_PORT'] || '3001', 10);
const NOTE_TABLE = 'c_txn_note';
const NOTE_PREFIX = 'IvyTek SQL history import:';

// Retained after each successful import so the note endpoints can serve reads/writes.
let _lastDbConfig = null;
const DEFAULT_BATCH_SIZE = 500;
const FEEDPOST_NOTE_PREFIX = 'IvyTek FeedPost import:';
const FEEDPOST_TRACKING_TABLE = 'm_ivytek_imported_feedpost_note';
const NOTE_TYPE_LOAN = 200;
const ACCRUAL_TRACK_TABLE = 'm_ivytek_interest_accrual';

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
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into raw rows respecting quoted fields that may contain literal newlines.
  // The naive split('\n') approach truncates multi-paragraph Body fields at the
  // first newline inside a quoted value.
  const rawRows = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if (ch === '\n' && !inQuotes) {
      rawRows.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) rawRows.push(current);

  if (rawRows.length < 2) return [];
  const headers = splitCsvLine(rawRows[0]);
  const rows = [];
  for (let i = 1; i < rawRows.length; i++) {
    const line = rawRows[i].trim();
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
    checkNumber: csvVal(row, 'IvytekTestPkg__Check_Number__c', 'IvytekTestPkg__CheckDisbursement__c'),
    // Interest accrual fields for legacy loans (IvyTek)
    perDiemInterestRate: csvDecimal(row, 'IvytekTestPkg__Per_Diem_Interest_Rate__c') ?? undefined,
    accruedInterestAll: csvDecimal(row, 'IvytekTestPkg__AccruedInterestAll__c') ?? undefined,
    currentDueDate: csvVal(row, 'IvytekTestPkg__CurrentDueDate__c') || undefined,
    originalDisbursementDate:
      csvVal(
        row,
        'IvytekTestPkg__LoanDate__c',
        'IvytekTestPkg__SetUpDate__c',
        'IvytekTestPkg__OriginalDisbursementDate__c',
        'IvytekTestPkg__DateOriginated__c'
      ) || undefined
  };
}

// ---------------------------------------------------------------------------
// Transaction processing
// ---------------------------------------------------------------------------

/**
 * Applies the two-digit-year (Y2K) window: IvyTek exports carry dates without
 * century digits, and some parse paths keep them as literal first-century years
 * (e.g. 0094) — window them to 19xx/20xx.
 */
function applyCenturyWindow(date) {
  const year = date.getFullYear();
  if (year >= 0 && year < 100) {
    const windowed = new Date(date);
    windowed.setFullYear(year + (year >= 50 ? 1900 : 2000));
    return windowed;
  }
  return date;
}

function parseSourceDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00`);
    if (!isNaN(d.getTime())) return applyCenturyWindow(d);
  }
  // M/D/YYYY or M/D/YY (two-digit years windowed to 19xx/20xx)
  const mdyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (mdyMatch) {
    let year = parseInt(mdyMatch[3], 10);
    if (mdyMatch[3].length <= 2) year += year >= 50 ? 1900 : 2000;
    const d = new Date(
      `${String(year).padStart(4, '0')}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}T00:00:00`
    );
    if (!isNaN(d.getTime())) return applyCenturyWindow(d);
  }
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : applyCenturyWindow(d);
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
    note: '',
    perDiemInterestRate: parseDecimalString(txn.perDiemInterestRate),
    accruedInterestAll: parseDecimalString(txn.accruedInterestAll),
    currentDueDate: parseSourceDate(txn.currentDueDate),
    originalDisbursementDate: parseSourceDate(txn.originalDisbursementDate)
  };
  rec.note = buildNote(rec);
  return { record: rec, error: null };
}

// ---------------------------------------------------------------------------
// Interest accrual reconciliation for legacy loans
// ---------------------------------------------------------------------------

/**
 * Calculates when Fineract should start charging interest so that, as of the
 * reconciliation date (the IvyTek export date), accrued interest equals the
 * IvyTek-reported AccruedInterestAll:
 *   days_accrued = AccruedInterestAll / Per_Diem_Interest_Rate
 *   interest_charged_from_date = reconciliation_date - days_accrued
 *
 * The start date is deliberately NOT clamped back to the earliest imported
 * transaction. Loans older than February 2021 have no transaction history
 * before that point, and anchoring interest there made Fineract accrue
 * phantom interest across the whole history gap.
 */
function analyzeLoanInterestSchedules(records, reconciliationDate) {
  const loanMap = new Map();
  for (const rec of records) {
    if (!loanMap.has(rec.loanId)) loanMap.set(rec.loanId, []);
    loanMap.get(rec.loanId).push(rec);
  }

  const loanUpdates = [];
  const validations = [];
  const toIso = (d) => (d && !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : '(invalid date)');

  for (const [
    loanId,
    loanRecords
  ] of loanMap) {
    const withAccrualData = loanRecords.find((r) => r.perDiemInterestRate && r.accruedInterestAll !== null);
    if (!withAccrualData) continue;

    const perDiem = parseFloat(withAccrualData.perDiemInterestRate);
    const accrued = parseFloat(withAccrualData.accruedInterestAll);
    const anchorDate = reconciliationDate ?? withAccrualData.currentDueDate;
    if (isNaN(perDiem) || perDiem <= 0 || isNaN(accrued) || accrued < 0 || !anchorDate) continue;

    const sorted = [...loanRecords].sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
    const firstTxnDate = sorted[0].transactionDate;
    const originalDate = withAccrualData.originalDisbursementDate;
    // Disbursement markers (transaction_type_enum 1) mirror the loan's origination and
    // move with it; only real history rows (repayments etc.) pin the origination date.
    const markerRecords = loanRecords.filter((r) => r.transactionTypeEnum === 1);
    const realRecords = loanRecords.filter((r) => r.transactionTypeEnum !== 1);

    const daysAccrued = Math.round(accrued / perDiem);
    let interestStartDate = new Date(anchorDate);
    interestStartDate.setDate(interestStartDate.getDate() - daysAccrued);
    // IvyTek computes AccruedInterestAll from origination dates stored without century
    // digits, so ancient results (e.g. year 0094) are Y2K artifacts — window them back
    // into 19xx/20xx. Anything still outside a sane range means corrupt accrual data.
    interestStartDate = applyCenturyWindow(interestStartDate);
    if (isNaN(interestStartDate.getTime()) || interestStartDate.getFullYear() < 1900) {
      validations.push({
        loanId,
        legacyLoanId: withAccrualData.legacyLoanId,
        originalDisbursementDate: withAccrualData.originalDisbursementDate
          ? toIso(withAccrualData.originalDisbursementDate)
          : null,
        firstTransactionDate: toIso(sorted[0].transactionDate),
        earliestTransactionDate: toIso(sorted[0].transactionDate),
        daysAccrued,
        perDiemRate: withAccrualData.perDiemInterestRate,
        accruedInterest: withAccrualData.accruedInterestAll,
        currentDueDate: withAccrualData.currentDueDate ? toIso(withAccrualData.currentDueDate) : null,
        reconciliationDate: reconciliationDate ? toIso(reconciliationDate) : null,
        correctedOriginationDate: null,
        newDisbursementDate: null,
        status: 'skipped',
        message: `Accrual data implies ${daysAccrued} day(s) of interest (start ${toIso(interestStartDate)}) — likely corrupt AccruedInterestAll/PerDiem; loan left unchanged.`
      });
      continue;
    }

    let newDisbursementDate = null;
    let originationReason = '';
    if (originalDate && interestStartDate.getTime() < originalDate.getTime()) {
      // Accrual window reaches back past the recorded origination: move origination
      // back so Fineract has room to accrue (interest_charged_from >= disbursement).
      const oneDayBeforeFirstTxn = new Date(firstTxnDate);
      oneDayBeforeFirstTxn.setDate(oneDayBeforeFirstTxn.getDate() - 1);
      newDisbursementDate =
        interestStartDate.getTime() < oneDayBeforeFirstTxn.getTime() ? interestStartDate : oneDayBeforeFirstTxn;
      originationReason = 'origination moved back to cover the accrual window';
    } else if (!realRecords.length && originalDate && interestStartDate.getTime() > originalDate.getTime()) {
      // Never-paid loan (only disbursement markers): nothing pins the old origination,
      // so move it forward to the accrual start — the same date stage 2 now uses at
      // loan creation. Fineract then accrues from origination to the reconciliation
      // date = exactly AccruedInterestAll.
      newDisbursementDate = interestStartDate;
      originationReason = 'origination moved forward to the accrual start (no repayment history pins it)';
    }

    const reason = `Interest reconciled to ${toIso(anchorDate)}: ${daysAccrued} accrual day(s) for $${accrued.toFixed(2)} outstanding at $${perDiem.toFixed(4)}/day`;
    const note = newDisbursementDate
      ? `Original origination date: ${originalDate ? toIso(originalDate) : 'unknown'}. Disbursement moved to ${toIso(newDisbursementDate)} and interest charged from ${toIso(interestStartDate)} — ${originationReason} (${reason})`
      : `Interest charged from ${toIso(interestStartDate)} (${reason})`;

    loanUpdates.push({
      loanId,
      interestChargedFromDate: toIso(interestStartDate),
      newDisbursementDate: newDisbursementDate ? toIso(newDisbursementDate) : null,
      // Origination moved backward implies submitted/approved dates must follow it down.
      moveLifecycleDates:
        !!newDisbursementDate && !!originalDate && newDisbursementDate.getTime() < originalDate.getTime(),
      markerExternalIds: newDisbursementDate ? markerRecords.map((r) => r.externalId) : [],
      note
    });

    // Keep marker transactions on the moved origination date, both for rows being
    // inserted this run and for rows already imported by a previous run.
    if (newDisbursementDate) {
      for (const marker of markerRecords) {
        marker.transactionDate = new Date(newDisbursementDate);
      }
    }

    validations.push({
      loanId,
      legacyLoanId: withAccrualData.legacyLoanId,
      originalDisbursementDate: originalDate ? toIso(originalDate) : null,
      firstTransactionDate: toIso(firstTxnDate),
      earliestTransactionDate: toIso(firstTxnDate),
      daysAccrued,
      perDiemRate: withAccrualData.perDiemInterestRate,
      accruedInterest: withAccrualData.accruedInterestAll,
      currentDueDate: withAccrualData.currentDueDate ? toIso(withAccrualData.currentDueDate) : null,
      reconciliationDate: reconciliationDate ? toIso(reconciliationDate) : null,
      correctedOriginationDate: toIso(interestStartDate),
      newDisbursementDate: newDisbursementDate ? toIso(newDisbursementDate) : null,
      status: 'updated',
      message: note
    });
  }

  return { loanUpdates, validations };
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

/**
 * Detects the m_loan date column names in the connected database. Stock Apache
 * Fineract uses disbursedon_date / interest_calculated_from_date, while some
 * forks carry disbursement_date / interest_charged_from_date — resolving the
 * real names at runtime keeps the origination updates from aborting the import
 * transaction with a column-does-not-exist error.
 */
async function detectLoanDateColumns(client) {
  const res = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'm_loan'
       AND table_schema = current_schema()`
  );
  const cols = new Set(res.rows.map((r) => r.column_name));
  return {
    interestChargedFromColumn: [
        'interest_charged_from_date',
        'interest_calculated_from_date'
      ].find((c) => cols.has(c)) ?? null,
    disbursementColumns: [
      'disbursement_date',
      'disbursedon_date',
      'expected_disbursedon_date'
    ].filter((c) => cols.has(c)),
    lifecycleColumns: [
      'submittedon_date',
      'approvedon_date'
    ].filter((c) => cols.has(c))
  };
}

/** Applies one loan's interest/origination reconciliation to m_loan (+ marker txns). */
async function applyLoanInterestUpdate(client, update, loanCols, warnings) {
  const assignments = [];
  const params = [];
  if (loanCols.interestChargedFromColumn) {
    params.push(update.interestChargedFromDate);
    assignments.push(`${loanCols.interestChargedFromColumn} = $${params.length}`);
  }
  if (update.newDisbursementDate) {
    for (const col of loanCols.disbursementColumns) {
      params.push(update.newDisbursementDate);
      assignments.push(`${col} = $${params.length}`);
    }
    if (update.moveLifecycleDates) {
      for (const col of loanCols.lifecycleColumns) {
        params.push(update.newDisbursementDate);
        assignments.push(`${col} = $${params.length}`);
      }
    }
  }
  if (!assignments.length) {
    warnings.push(`Loan ${update.loanId}: no matching m_loan date columns found — interest reconciliation skipped.`);
    return;
  }

  params.push(update.loanId);
  await client.query(`UPDATE m_loan SET ${assignments.join(', ')} WHERE id = $${params.length}`, params);

  // Re-date already-imported disbursement markers to the moved origination date.
  if (update.newDisbursementDate && update.markerExternalIds.length) {
    await client.query(
      `UPDATE m_loan_transaction
       SET transaction_date = $1, submitted_on_date = $1
       WHERE external_id = ANY($2::text[])`,
      [
        update.newDisbursementDate,
        update.markerExternalIds
      ]
    );
  }
}

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

// Resolved names the import may create in m_payment_type when the organisation
// hasn't defined them yet. The plain REG PMNT default is deliberately absent:
// unmatched regular repayments simply keep no payment detail.
const AUTO_CREATE_PAYMENT_TYPES = new Map([
  [
    'PENSION',
    'Pension'
  ],
  [
    'PAYROLL',
    'Payroll'
  ],
  [
    'PERCAPITA',
    'Percap'
  ]
]);

async function createPaymentType(client, value) {
  const columns = await getTableColumns(client, 'm_payment_type');
  const posRes = await client.query('SELECT COALESCE(MAX(order_position), 0) + 1 AS pos FROM m_payment_type');
  const desired = {
    value,
    description: `Created by IvyTek SQL import for ${value} transactions`,
    is_cash_payment: false,
    order_position: Number(posRes.rows[0].pos),
    is_system_defined: false
  };
  const cols = [];
  const params = [];
  for (const [
    col,
    val
  ] of Object.entries(desired)) {
    if (!columns.has(col)) continue;
    cols.push(col);
    params.push(val);
  }
  const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
  const res = await client.query(
    `INSERT INTO m_payment_type (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    params
  );
  return Number(res.rows[0].id);
}

async function upsertPaymentDetails(client, records, warnings = []) {
  const processable = records.filter((r) => r.paymentType && r.externalId);
  if (!processable.length) return 0;

  // 1. Resolve payment type names → IDs. Names come from resolvePaymentTypeName
  //    ('PENSION', 'PAYROLL', …) while the organisation's m_payment_type rows may
  //    be capitalised or worded differently ('Pension', 'Per Capita'), so match on
  //    normalized text instead of exact equality. Missing Pension/Payroll/Percap
  //    rows are created; anything else unmatched is skipped with a warning.
  const uniqueNames = [...new Set(processable.map((r) => r.paymentType))];
  const ptRes = await client.query('SELECT id, value FROM m_payment_type');
  const dbTypes = ptRes.rows.map((r) => ({
    id: Number(r.id),
    value: String(r.value),
    norm: normalizeText(r.value)
  }));
  const paymentTypeIdMap = new Map();
  for (const name of uniqueNames) {
    const norm = normalizeText(name);
    if (!norm) continue;
    const match =
      dbTypes.find((t) => t.norm === norm) ||
      dbTypes.find((t) => t.norm.length >= 3 && (t.norm.includes(norm) || norm.includes(t.norm)));
    if (match) {
      paymentTypeIdMap.set(name, match.id);
      if (match.norm !== norm) warnings.push(`Payment types: "${name}" mapped to existing type "${match.value}".`);
    } else if (AUTO_CREATE_PAYMENT_TYPES.has(name)) {
      const value = AUTO_CREATE_PAYMENT_TYPES.get(name);
      const id = await createPaymentType(client, value);
      dbTypes.push({ id, value, norm: normalizeText(value) });
      paymentTypeIdMap.set(name, id);
      warnings.push(`Payment types: created "${value}" in m_payment_type (none matched "${name}").`);
    } else {
      const count = processable.filter((r) => r.paymentType === name).length;
      warnings.push(
        `Payment types: no m_payment_type row matches "${name}" — ${count} transaction(s) keep no payment type.`
      );
    }
  }
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

async function runImport({ db, transactions, createdBy = 4, apply = false, reconciliationDate = null }) {
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

  // Reconcile interest accrual to the reconciliation date (IvyTek export date).
  const parsedReconciliationDate = parseSourceDate(reconciliationDate);
  if (reconciliationDate && !parsedReconciliationDate) {
    warnings.push(
      `Could not parse reconciliationDate "${reconciliationDate}" — falling back to CurrentDueDate anchors.`
    );
  }
  if (!parsedReconciliationDate && records.some((r) => r.perDiemInterestRate && r.accruedInterestAll !== null)) {
    warnings.push(
      "No reconciliation date provided; interest accrual windows are anchored to each loan's CurrentDueDate, " +
        'which is stale for delinquent loans. Pass the IvyTek export date for exact reconciliation.'
    );
  }
  const { loanUpdates, validations } = analyzeLoanInterestSchedules(records, parsedReconciliationDate);
  if (loanUpdates.length) {
    warnings.push(
      `${loanUpdates.length} loan(s) will have interest_charged_from_date reconciled` +
        (parsedReconciliationDate ? ` to ${reconciliationDate}` : '') +
        ' so Fineract does not accrue interest across the pre-import history gap.'
    );
  }

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

    // Reconcile interest start and origination dates before inserting transactions.
    if (apply && loanUpdates.length) {
      const loanCols = await detectLoanDateColumns(client);
      if (!loanCols.interestChargedFromColumn) {
        warnings.push(
          'm_loan has no interest-charged-from column (checked interest_charged_from_date, interest_calculated_from_date) — only origination dates will be updated.'
        );
      }
      for (const update of loanUpdates) {
        await applyLoanInterestUpdate(client, update, loanCols, warnings);
        await client.query(
          `INSERT INTO m_note (id, client_id, group_id, loan_id, loan_transaction_id, savings_account_id,
            savings_account_transaction_id, share_account_id, note_type_enum, note,
            created_date, created_by, lastmodified_date, last_modified_by,
            created_on_utc, last_modified_on_utc)
           VALUES (nextval('m_note_id_seq'), NULL, NULL, $1, NULL, NULL, NULL, NULL, ${NOTE_TYPE_LOAN}, $2,
            current_timestamp, $3, current_timestamp, $3, current_timestamp, current_timestamp)`,
          [
            update.loanId,
            update.note,
            createdBy
          ]
        );
      }
    }

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
        const pdCount = await upsertPaymentDetails(client, records, warnings);
        if (pdCount > 0) warnings.push(`Payment details: ${pdCount} transaction(s) linked to a payment type.`);
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
        message: `Committed: ${insertedCount} inserted, ${updatedCount} updated. Interest reconciled for ${loanUpdates.length} loan(s).`,
        inserted: insertedCount,
        updated: updatedCount,
        warnings,
        reconciliation,
        interestAccrualValidation: validations
      };
    } else if (apply) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: 'Rolled back: reconciliation totals did not match. Review the table below.',
        inserted: 0,
        updated: 0,
        warnings,
        reconciliation,
        interestAccrualValidation: validations
      };
    } else {
      await client.query('ROLLBACK');
      return {
        success: true,
        message: `Dry run complete. ${records.length} transactions ready. Will reconcile interest accrual for ${loanUpdates.length} loan(s). Re-run with Apply to commit.`,
        inserted: 0,
        updated: 0,
        warnings,
        reconciliation,
        interestAccrualValidation: validations
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

function splitByDatePrefix(fullText) {
  const startsWithDate = (s) => /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[\s:]/.test(s.trimStart());

  // 1. Try newline-based split first (HTML was stripped from <p> tags into \n).
  const paragraphs = fullText.split('\n').filter((p) => p.trim());
  if (paragraphs.filter(startsWithDate).length > 1) {
    const notes = [];
    let current = '';
    for (const para of paragraphs) {
      if (startsWithDate(para) && current.trim()) {
        notes.push(current.trim());
        current = para;
      } else {
        current = current ? current + '\n' + para : para;
      }
    }
    if (current.trim()) notes.push(current.trim());
    if (notes.length > 1) return notes;
  }

  // 2. Inline split: the text is one flat string with no newlines.
  //    A new note starts when a date appears after ". " or ". INITIALS "
  //    (end-of-sentence + optional 1-3 uppercase letter initials).
  //    This avoids splitting on dates inside content like:
  //      "MATURITY DATE FROM 9-13-41 TO 6-13-54"  (no preceding period)
  //      "NEXT PAYMENT DUE DATE: 4-10-22,"         (preceded by ":", not ".")
  //      "dated 11-09-23."                          (preceded by lowercase word)
  //      "DUE DATE TO 8-18-24 TO CORRECT"           (preceded by "TO")
  const dateRegex = /\.\s+(?:[A-Z]{1,3}\s+)?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[\s:])/g;
  const splitPoints = [];
  let match;
  while ((match = dateRegex.exec(fullText)) !== null) {
    // The date portion starts at the end of the full match minus the captured date group
    splitPoints.push(match.index + match[0].length - match[1].length);
  }

  if (splitPoints.length === 0) return [fullText];

  const notes = [];
  let last = 0;
  for (const sp of splitPoints) {
    const part = fullText.substring(last, sp).trim();
    if (part) notes.push(part);
    last = sp;
  }
  const tail = fullText.substring(last).trim();
  if (tail) notes.push(tail);
  return notes.length > 1 ? notes : [fullText];
}

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

function extractNoteDatePrefix(note) {
  // Match a date at the very start of the note: M/D/YY, MM-DD-YY, etc.
  const match = note.trimStart().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})[\s:]/);
  if (!match) return null;
  let [
    ,
    month,
    day,
    year
  ] = match;
  if (year.length === 2) year = parseInt(year, 10) < 30 ? `20${year}` : `19${year}`;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
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
    const feedPostCreatedDate = parseSourceDateString(row['CreatedDate'] || '');
    const feedPostRawCreatedDate = (row['CreatedDate'] || '').trim() || null;
    const createdById = (row['CreatedById'] || row['CreatedByID'] || '').trim() || null;

    // First, split by date prefixes if multiple dated notes are present
    const dateBasedSplits = splitByDatePrefix(body);
    for (let d = 0; d < dateBasedSplits.length; d++) {
      const noteBody = dateBasedSplits[d];
      // Use the date embedded in the note text when present, fall back to FeedPost date
      const noteDatePrefix = extractNoteDatePrefix(noteBody);
      const createdDate = noteDatePrefix ?? feedPostCreatedDate;
      const rawCreatedDate = noteDatePrefix ?? feedPostRawCreatedDate;
      // Then split by length if necessary
      const lengthParts = splitNote(noteBody);
      for (let p = 0; p < lengthParts.length; p++) {
        let partSourceId = sourceId;
        if (dateBasedSplits.length > 1) partSourceId += `-d${d + 1}`;
        if (lengthParts.length > 1) partSourceId += `-p${p + 1}`;
        records.push({
          sourceId: partSourceId,
          parentId,
          loanId: null,
          note: lengthParts[p],
          createdDate,
          rawCreatedDate,
          createdById
        });
      }
    }
  }
  return { records, errors };
}

/**
 * Parses a Users CSV (Salesforce export) and returns a map of SF user ID → { firstName, lastName, alias }.
 * @param {string} text
 * @returns {Map<string, {firstName: string, lastName: string, alias: string}>}
 */
function parseSalesforceUsersCsv(text) {
  const rows = parseCsv(text);
  const map = new Map();
  for (const row of rows) {
    const id = (row['Id'] || '').trim();
    const firstName = (row['FirstName'] || '').trim();
    const lastName = (row['LastName'] || '').trim();
    const alias = (row['Alias'] || '').trim();
    if (id && (firstName || lastName)) map.set(id, { firstName, lastName, alias });
  }
  return map;
}

/**
 * Looks up Mifos user IDs by first+last name from m_appuser.
 * Returns a map keyed by "firstname|lastname" (lower-case) → Mifos user ID.
 * @param {import('pg').Client} client
 * @param {Array<{firstName: string, lastName: string}>} users
 * @returns {Promise<Map<string, number>>}
 */
async function lookupMifosUsersByName(client, users) {
  const lookup = new Map();
  if (!users.length) return lookup;
  for (const { firstName, lastName } of users) {
    const key = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`;
    if (lookup.has(key)) continue;
    const res = await client.query(
      `select id from m_appuser where lower(firstname) = lower($1) and lower(lastname) = lower($2) limit 1`,
      [
        firstName,
        lastName
      ]
    );
    if (res.rows.length) lookup.set(key, Number(res.rows[0].id));
  }
  return lookup;
}

/**
 * Builds a map of 2-letter initials → Mifos user ID for fallback matching in note text.
 * Uses the Alias column's first two characters (upper-cased) when available, otherwise
 * falls back to first letter of firstName + first letter of lastName.
 * @param {Map<string, {firstName: string, lastName: string, alias: string}>} sfUserMap
 * @param {Map<string, number>} mifosNameMap keyed by "firstname|lastname"
 * @returns {Map<string, number>} initials (upper-case) → Mifos user ID
 */
function buildInitialsMap(sfUserMap, mifosNameMap) {
  const map = new Map();
  for (const { firstName, lastName, alias } of sfUserMap.values()) {
    const key = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`;
    const mifosId = mifosNameMap.get(key);
    if (!mifosId) continue;
    const initials = alias
      ? alias.slice(0, 2).toUpperCase()
      : `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
    if (initials.length === 2 && !map.has(initials)) map.set(initials, mifosId);
  }
  return map;
}

/**
 * Tries to find a user ID by scanning the note text for 2-letter initials.
 * Looks for a pattern like " DS" or "DS " near the end of the text, surrounded by non-alpha chars.
 * @param {string} note
 * @param {Map<string, number>} initialsMap
 * @returns {number|null}
 */
function findUserByInitialsInNote(note, initialsMap) {
  // Match standalone 2-letter uppercase sequences not surrounded by letters
  const matches = note.matchAll(/(?<![A-Za-z])([A-Z]{2})(?![A-Za-z])/g);
  for (const match of matches) {
    const id = initialsMap.get(match[1]);
    if (id !== undefined) return id;
  }
  return null;
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
    const recordCreatedBy = record.resolvedCreatedBy ?? createdBy;
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
        recordCreatedBy,
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

async function runFeedPostImport({
  db,
  feedPostCsvText,
  loanCsvText,
  createdBy = 4,
  salesforceUsersCsvText = null,
  apply = false
}) {
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

    // Resolve Salesforce users → Mifos user IDs for per-note attribution.
    const sfUserMap = salesforceUsersCsvText ? parseSalesforceUsersCsv(salesforceUsersCsvText) : new Map();
    let mifosNameMap = new Map();
    let initialsMap = new Map();
    if (sfUserMap.size) {
      const uniqueUsers = [
        ...new Set([...sfUserMap.values()].map((u) => `${u.firstName.toLowerCase()}|${u.lastName.toLowerCase()}`))
      ].map((key) => {
        const [
          firstName,
          lastName
        ] = key.split('|');
        return { firstName, lastName };
      });
      mifosNameMap = await lookupMifosUsersByName(client, uniqueUsers);
      initialsMap = buildInitialsMap(sfUserMap, mifosNameMap);
      warnings.push(`User map: ${sfUserMap.size} SF user(s) loaded, ${mifosNameMap.size} resolved to Mifos user(s).`);
    }

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
      else {
        let resolvedCreatedBy = null;
        if (sfUserMap.size) {
          // 1. Try to resolve by CreatedById from the FeedPost CSV
          if (rec.createdById && sfUserMap.has(rec.createdById)) {
            const { firstName, lastName } = sfUserMap.get(rec.createdById);
            resolvedCreatedBy = mifosNameMap.get(`${firstName.toLowerCase()}|${lastName.toLowerCase()}`) ?? null;
          }
          // 2. Fallback: scan the note text for 2-letter initials from the Alias column
          if (!resolvedCreatedBy && initialsMap.size) {
            resolvedCreatedBy = findUserByInitialsInNote(rec.note, initialsMap);
          }
        }
        records.push({ ...rec, loanId, resolvedCreatedBy });
      }
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

  const { db, apply = false, createdBy = 4, feedPostCsvText, loanCsvText, salesforceUsersCsvText = null } = body;
  if (!db?.host || !db?.dbname || !db?.user)
    return jsonResponse(res, 400, { success: false, message: 'Missing required db fields: host, dbname, user.' });
  if (!feedPostCsvText)
    return jsonResponse(res, 400, {
      success: false,
      message: 'FeedPost CSV body is missing or empty (feedPostCsvText field not sent).'
    });

  console.log(`[IvyTek FeedPost] received feedPostCsvText: ${feedPostCsvText.length} bytes`);
  if (salesforceUsersCsvText)
    console.log(`[IvyTek FeedPost] received salesforceUsersCsvText: ${salesforceUsersCsvText.length} bytes`);
  const fpRows = parseCsv(feedPostCsvText);
  if (!fpRows.length)
    return jsonResponse(res, 400, {
      success: false,
      message: `FeedPost CSV is empty or has no data rows (received ${feedPostCsvText.length} bytes). Check that the correct file was selected and the directory was re-picked after any folder change.`
    });

  try {
    const result = await runFeedPostImport({
      db,
      feedPostCsvText,
      loanCsvText,
      createdBy,
      salesforceUsersCsvText,
      apply
    });
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
// ContentVersion attachment resolve
// ---------------------------------------------------------------------------

function parseContentVersionCsv(text) {
  const rows = parseCsv(text);
  const records = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const versionId = (row['Id'] || '').trim();
    const contentDocumentId = (row['ContentDocumentId'] || '').trim();
    if (!versionId && !contentDocumentId) {
      errors.push(`CSV row ${i + 2}: missing both Id and ContentDocumentId`);
      continue;
    }
    const parentId = (
      row['LinkedEntityId'] ||
      row['FirstPublishLocationId'] ||
      row['ParentId'] ||
      row['IvytekTestPkg__Loan__c'] ||
      ''
    ).trim();
    if (!parentId) {
      errors.push(`CSV row ${i + 2} (Id=${versionId}): no loan reference field found`);
      continue;
    }
    const title = (row['Title'] || row['PathOnClient'] || versionId || contentDocumentId).trim();
    const fileType = (row['FileType'] || row['File_Type'] || row['FileExtension'] || '').trim().replace(/^\./, '');
    records.push({ versionId, contentDocumentId, parentId, title, fileType });
  }
  return { records, errors };
}

async function runContentVersionResolve({ db, contentVersionCsvText, loanCsvText }) {
  const { records: parsedRecords, errors } = parseContentVersionCsv(contentVersionCsvText);
  const warnings = [...errors];

  if (!parsedRecords.length) {
    return { success: false, message: 'No valid ContentVersion records found.', records: [], warnings };
  }

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
  _lastDbConfig = { host: db.host, port: db.port ?? 5432, dbname: db.dbname, user: db.user, password: db.password };
  try {
    const uniqueParentIds = [...new Set(parsedRecords.map((r) => r.parentId))];
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

    const resolved = [];
    const unmatched = [];
    for (const rec of parsedRecords) {
      const loanId = loanLookup.get(rec.parentId);
      if (loanId === undefined) unmatched.push(rec.parentId);
      else resolved.push({ ...rec, loanId });
    }
    if (unmatched.length) {
      warnings.push(
        `${unmatched.length} parent ID(s) not matched to a loan: ${[...new Set(unmatched)].slice(0, 10).join(', ')}${unmatched.length > 10 ? ' ...' : ''}`
      );
    }

    return {
      success: true,
      message: `Resolved ${resolved.length} of ${parsedRecords.length} ContentVersion records to loans.`,
      records: resolved,
      warnings
    };
  } finally {
    await client.end();
  }
}

async function handleContentVersionResolve(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(res, 400, { success: false, message: 'Invalid JSON body.' });
  }

  const { db, contentVersionCsvText, loanCsvText } = body;
  if (!db?.host || !db?.dbname || !db?.user)
    return jsonResponse(res, 400, { success: false, message: 'Missing required db fields: host, dbname, user.' });
  if (!contentVersionCsvText)
    return jsonResponse(res, 400, { success: false, message: 'contentVersionCsvText is required.' });

  const rows = parseCsv(contentVersionCsvText);
  if (!rows.length) return jsonResponse(res, 400, { success: false, message: 'ContentVersion CSV has no data rows.' });

  try {
    const result = await runContentVersionResolve({ db, contentVersionCsvText, loanCsvText });
    jsonResponse(res, 200, result);
  } catch (e) {
    console.error('[IvyTek ContentVersion] Resolve error:', e);
    jsonResponse(res, 500, {
      success: false,
      message: `ContentVersion resolve failed: ${e.message}`,
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

  const { db, apply = false, createdBy = 4, csvText, loanCsvText, reconciliationDate = null } = body;
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
    const result = await runImport({ db, transactions, createdBy, apply, reconciliationDate });
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
// JSON transaction import — same as handleSqlImportCsv but skips CSV parsing;
// the caller (Angular bulk importer) has already resolved loan IDs client-side.
// ---------------------------------------------------------------------------

async function handleSqlImport(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(res, 400, { success: false, message: 'Invalid JSON body.' });
  }

  if (!body?.db?.host || !body?.db?.dbname || !body?.db?.user)
    return jsonResponse(res, 400, { success: false, message: 'Missing required database config: host, dbname, user.' });
  if (!Array.isArray(body.transactions) || !body.transactions.length)
    return jsonResponse(res, 400, { success: false, message: 'No transactions provided in request body.' });

  try {
    const result = await runImport(body);
    jsonResponse(res, 200, result);
  } catch (e) {
    console.error('[IvyTek SQL] Import error:', e);
    jsonResponse(res, 500, { success: false, message: `Import failed: ${e.message}`, error: pgErrorDetail(e) });
  }
}

// ---------------------------------------------------------------------------
// Schedule-fix — corrects repayment schedules for pre-2021 legacy loans whose
// Fineract-recalculated installments don't match IvyTek's tracked accrual.
// ---------------------------------------------------------------------------

async function rebuildRepaymentSchedule(client, loans, apply, reconciliationDate = null) {
  const rows = [];
  let installmentsUpdated = 0;
  const warnings = [];
  // Installments are split into past/current relative to the reconciliation date
  // (IvyTek export date) — the date the source accrual snapshot is true for.
  const parsedAsOf = parseSourceDate(reconciliationDate);
  if (!parsedAsOf) {
    warnings.push(
      reconciliationDate
        ? `Could not parse reconciliationDate "${reconciliationDate}" — using today instead.`
        : 'No reconciliation date provided — installments are split around today instead of the export date.'
    );
  }
  const asOfDate = parsedAsOf ?? new Date();
  asOfDate.setHours(0, 0, 0, 0);

  const loanCols = await detectLoanDateColumns(client);
  if (!loanCols.interestChargedFromColumn) {
    warnings.push(
      'm_loan has no interest-charged-from column (checked interest_charged_from_date, interest_calculated_from_date) — origination-date rows will be skipped.'
    );
  }

  for (const loan of loans) {
    const loanId = Number(loan.loanId);
    if (!loanId || isNaN(loanId)) {
      warnings.push(`Skipping loan with invalid ID: ${loan.loanId}`);
      continue;
    }

    const accrued = parseFloat(loan.accruedInterestAll);
    const currentDueDate = parseSourceDate(loan.currentDueDate);

    if (isNaN(accrued) || accrued < 0) {
      warnings.push(`Loan ${loanId}: invalid accruedInterestAll "${loan.accruedInterestAll}", skipping`);
      continue;
    }
    if (!currentDueDate) {
      warnings.push(`Loan ${loanId}: invalid currentDueDate "${loan.currentDueDate}", skipping`);
      continue;
    }

    let scheduleRes;
    try {
      scheduleRes = await client.query(
        `SELECT id, duedate, interest_amount,
                interest_completed_derived, interest_waived_derived, completed_derived
         FROM m_loan_repayment_schedule
         WHERE loan_id = $1
         ORDER BY duedate ASC`,
        [loanId]
      );
    } catch (e) {
      warnings.push(`Loan ${loanId}: failed to fetch schedule — ${e.message}`);
      continue;
    }

    if (!scheduleRes.rows.length) {
      warnings.push(`Loan ${loanId}: no installments found in m_loan_repayment_schedule`);
      continue;
    }

    const uncompleted = scheduleRes.rows.filter((r) => !r.completed_derived);
    if (!uncompleted.length) {
      warnings.push(`Loan ${loanId}: all installments already completed — nothing to fix`);
      continue;
    }

    const currentDueMs = currentDueDate.getTime();
    const currentInstallment = uncompleted.reduce((closest, r) => {
      const rDue = new Date(r.duedate).getTime();
      const closestDue = new Date(closest.duedate).getTime();
      return Math.abs(rDue - currentDueMs) < Math.abs(closestDue - currentDueMs) ? r : closest;
    });

    const pastUncompleted = uncompleted.filter((r) => {
      const due = new Date(r.duedate);
      due.setHours(0, 0, 0, 0);
      return due < asOfDate && r.id !== currentInstallment.id;
    });

    for (const inst of pastUncompleted) {
      const fineractInterest = parseFloat(inst.interest_amount ?? '0');
      const alreadyWaived = parseFloat(inst.interest_waived_derived ?? '0');
      const alreadyCompleted = parseFloat(inst.interest_completed_derived ?? '0');
      const toWaive = Math.max(0, fineractInterest - alreadyCompleted - alreadyWaived);

      const row = {
        loanId,
        legacyLoanId: loan.legacyLoanId ?? '',
        installmentId: inst.id,
        dueDate: new Date(inst.duedate).toISOString().split('T')[0],
        type: 'past-waive',
        fineractInterest: fineractInterest.toFixed(2),
        ivytekInterest: '0.00',
        interestAdjustment: (-toWaive).toFixed(2),
        action: toWaive > 0 ? `Waive $${toWaive.toFixed(2)} unallocated interest` : 'No waiver needed',
        status: 'pending'
      };

      if (apply && toWaive > 0) {
        try {
          await client.query(
            `UPDATE m_loan_repayment_schedule
             SET interest_waived_derived = coalesce(interest_waived_derived, 0) + $1
             WHERE id = $2`,
            [
              toWaive.toFixed(6),
              inst.id
            ]
          );
          row.status = 'applied';
          installmentsUpdated++;
        } catch (e) {
          row.status = 'error';
          row.error = e.message;
          warnings.push(`Loan ${loanId} installment ${inst.id}: waiver failed — ${e.message}`);
        }
      } else {
        row.status = apply ? 'applied' : 'pending';
      }
      rows.push(row);
    }

    const fineractCurrentInterest = parseFloat(currentInstallment.interest_amount ?? '0');
    const currentDueDateStr = currentDueDate.toISOString().split('T')[0];
    const existingDueDateStr = new Date(currentInstallment.duedate).toISOString().split('T')[0];

    const currentRow = {
      loanId,
      legacyLoanId: loan.legacyLoanId ?? '',
      installmentId: currentInstallment.id,
      dueDate: existingDueDateStr,
      type: 'current-correct',
      fineractInterest: fineractCurrentInterest.toFixed(2),
      ivytekInterest: accrued.toFixed(2),
      interestAdjustment: (accrued - fineractCurrentInterest).toFixed(2),
      action: `Set interest_amount=$${accrued.toFixed(2)}, duedate=${currentDueDateStr}`,
      status: 'pending'
    };

    if (apply) {
      try {
        await client.query(
          `UPDATE m_loan_repayment_schedule
           SET interest_amount = $1,
               recalculated_interest_component = false
           WHERE id = $2`,
          [
            accrued.toFixed(6),
            currentInstallment.id
          ]
        );
        if (existingDueDateStr !== currentDueDateStr) {
          await client.query(
            `UPDATE m_loan_repayment_schedule
             SET duedate = $1
             WHERE id = $2`,
            [
              currentDueDateStr,
              currentInstallment.id
            ]
          );
        }
        currentRow.dueDate = currentDueDateStr;
        currentRow.status = 'applied';
        installmentsUpdated++;
      } catch (e) {
        currentRow.status = 'error';
        currentRow.error = e.message;
        warnings.push(`Loan ${loanId} current installment ${currentInstallment.id}: update failed — ${e.message}`);
      }
    }
    rows.push(currentRow);

    if (loan.correctedOriginationDate && loanCols.interestChargedFromColumn) {
      const interestCol = loanCols.interestChargedFromColumn;
      const originRow = {
        loanId,
        legacyLoanId: loan.legacyLoanId ?? '',
        installmentId: 0,
        dueDate: loan.correctedOriginationDate,
        type: 'origination-date',
        fineractInterest: '',
        ivytekInterest: '',
        interestAdjustment: '',
        action: `Set m_loan.${interestCol} = ${loan.correctedOriginationDate}`,
        status: 'pending'
      };
      if (apply) {
        try {
          await client.query(`UPDATE m_loan SET ${interestCol} = $1 WHERE id = $2`, [
            loan.correctedOriginationDate,
            loanId
          ]);
          originRow.status = 'applied';
        } catch (e) {
          originRow.status = 'error';
          originRow.error = e.message;
          warnings.push(`Loan ${loanId}: ${interestCol} update failed — ${e.message}`);
        }
      }
      rows.push(originRow);
    }
  }

  return { rows, installmentsUpdated, warnings };
}

// ---------------------------------------------------------------------------
// Loan-state-sync — full-SQL reconciliation. Writes IvyTek source truth directly
// into every table the REST pipeline would normally maintain (m_loan derived
// summary/date columns, m_loan_repayment_schedule, m_loan_arrears_aging) so
// Fineract never has to compute interest, arrears, or balances for migrated
// loans. The REST stage only creates the loan shell; this makes it exact.
// ---------------------------------------------------------------------------

/** Fetches the actual column names of a table in the connected database. */
async function getTableColumns(client, tableName) {
  const res = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = current_schema()`,
    [tableName]
  );
  return new Set(res.rows.map((r) => r.column_name));
}

/** Builds "col = $n" assignments from a desired-value map, keeping only real columns. */
function buildFilteredAssignments(desired, columns, params) {
  const assignments = [];
  for (const [
    col,
    value
  ] of Object.entries(desired)) {
    if (!columns.has(col) || value === undefined) continue;
    params.push(value);
    assignments.push(`${col} = $${params.length}`);
  }
  return assignments;
}

/** Inserts a row from a desired-value map, keeping only real columns. */
async function insertFilteredRow(client, tableName, desired, columns) {
  const cols = [];
  const params = [];
  for (const [
    col,
    value
  ] of Object.entries(desired)) {
    if (!columns.has(col) || value === undefined) continue;
    params.push(value);
    cols.push(col);
  }
  const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
  await client.query(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`, params);
}

const LOAN_STATUS_ACTIVE = 300;
const LOAN_STATUS_CLOSED_OBLIGATIONS_MET = 600;

/**
 * Applies one loan's source-truth state. Runs inside the caller's transaction;
 * the caller wraps each loan in a SAVEPOINT so one failure doesn't kill the batch.
 *
 * interestOutstanding in `loan` is IvyTek's AccruedInterestAll — a snapshot true as
 * of the reconciliation (export) date. Two things keep this correct after import:
 * (1) we project it forward here, at the source per-diem rate, to asOfDate so the
 * written balance reflects today, not a stale export-date snapshot; and (2) we anchor
 * interest_charged_from_date at the corrected accrual-start date (not true origination)
 * so that if Fineract's own interest engine later recalculates this loan, it continues
 * accruing correctly on its own instead of reproducing the phantom pre-2021 interest
 * problem this migration path exists to avoid. Whether that recalculation actually runs
 * automatically depends on the loan product's interest-recalculation configuration —
 * verify against a real test loan before relying on it for a whole batch.
 */
async function syncLoanState(
  client,
  loan,
  cols,
  reconciliationDate,
  createdBy,
  asOfDate = null,
  batchAnchorDate = null
) {
  const actions = [];
  const toIso = (d) => (d && !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : null);
  const num = (v) => {
    const n = parseFloat(parseDecimalString(v) ?? '');
    return isNaN(n) ? null : n;
  };

  // Resolve the Fineract loan
  const lookup = await client.query(
    `SELECT id, loan_status_id FROM m_loan WHERE account_no = $1 OR external_id = $2 LIMIT 1`,
    [
      String(loan.legacyLoanId ?? ''),
      String(loan.externalId ?? '')
    ]
  );
  if (!lookup.rows.length) {
    throw new Error(`No m_loan row found for account_no "${loan.legacyLoanId}" / external_id "${loan.externalId}"`);
  }
  const loanId = Number(lookup.rows[0].id);

  const origination = toIso(parseSourceDate(loan.originationDate));
  const maturity = toIso(parseSourceDate(loan.maturityDate));
  const currentDue = toIso(parseSourceDate(loan.currentDueDate));
  const lastPayment = toIso(parseSourceDate(loan.lastPaymentDate));
  const closedDate = toIso(parseSourceDate(loan.closedDate));
  const reconciliation = toIso(reconciliationDate);

  const principalOriginal = num(loan.principalOriginal) ?? 0;
  const principalOutstanding = Math.max(0, num(loan.principalOutstanding) ?? 0);
  const principalPaid = Math.max(0, num(loan.principalPaid) ?? Math.max(0, principalOriginal - principalOutstanding));
  const interestPaid = Math.max(0, num(loan.interestPaid) ?? 0);
  const annualRate = num(loan.annualInterestRatePercent);
  const amountOverdue = num(loan.amountOverdue);
  const closed = !!loan.closed;

  // Per-diem in DOLLARS per day. IvyTek's Per_Diem_Interest_Rate__c holds the daily
  // RATE (e.g. 0.00013699 = 5%/365), NOT a dollar amount — using it raw made every
  // projection add fractions of a cent and freeze interest at the export snapshot.
  const perDiemResolved = resolvePerDiemDollars(loan);
  const perDiem = perDiemResolved.amount;
  if (perDiemResolved.note) {
    actions.push(perDiemResolved.note);
  }
  const interestOutstandingAtSnapshot = Math.max(0, num(loan.interestOutstanding) ?? 0);

  // The accrual snapshot implies its own date: last payment + accrued/per-diem days.
  // IvyTek's stored AccruedInterestAll lags the live screen (an internal job updates
  // it), so the CSV can be days staler than the date it was exported on.
  let impliedSnapshotDate = null;
  if (lastPayment && perDiem && perDiem > 0 && interestOutstandingAtSnapshot > 0) {
    const implied = parseSourceDate(lastPayment);
    if (implied) {
      implied.setDate(implied.getDate() + Math.round(interestOutstandingAtSnapshot / perDiem));
      impliedSnapshotDate = toIso(implied);
    }
  }

  // Interest anchor: the date the accrued value is actually TRUE for. Per-loan implied
  // date wins when it agrees with the batch anchor (±7 days, guards against loans with
  // irregular accrual); otherwise the batch anchor (median implied across the import,
  // or the entered export date). The entered date still governs arrears comparisons.
  let interestAnchorDate = batchAnchorDate ?? reconciliationDate ?? null;
  if (impliedSnapshotDate) {
    const own = parseSourceDate(impliedSnapshotDate);
    if (own && (!interestAnchorDate || Math.abs(own.getTime() - interestAnchorDate.getTime()) / 86400000 <= 7)) {
      interestAnchorDate = own;
    }
  }
  const interestAnchor = toIso(interestAnchorDate);
  if (interestAnchor && reconciliation && interestAnchor !== reconciliation) {
    actions.push(
      `interest anchored to data-implied snapshot ${interestAnchor} (entered export date ${reconciliation})`
    );
  }

  // Project accrued interest from the anchor forward to asOfDate at the per-diem rate.
  // Skipped for closed loans — nothing accrues past closure.
  let interestOutstanding = interestOutstandingAtSnapshot;
  let daysProjected = 0;
  if (
    !closed &&
    perDiem &&
    perDiem > 0 &&
    interestAnchorDate &&
    !isNaN(interestAnchorDate.getTime()) &&
    asOfDate &&
    !isNaN(asOfDate.getTime()) &&
    asOfDate.getTime() > interestAnchorDate.getTime()
  ) {
    daysProjected = Math.round((asOfDate.getTime() - interestAnchorDate.getTime()) / 86400000);
    interestOutstanding += perDiem * daysProjected;
  } else if (!closed && interestOutstandingAtSnapshot > 0 && daysProjected === 0) {
    // Say WHY nothing was projected — a silent zero here froze interest at the
    // export-date snapshot once already; never let that be invisible again.
    const reason =
      !perDiem || perDiem <= 0
        ? 'no per-diem rate in source and no annual rate to derive one'
        : !interestAnchorDate || isNaN(interestAnchorDate.getTime())
          ? 'no anchor/reconciliation date'
          : `as-of date ${toIso(asOfDate)} is not after anchor ${interestAnchor}`;
    actions.push(`interest NOT projected past snapshot: ${reason}`);
    console.warn(`[IvyTek SQL] loan ${loanId} ("${loan.legacyLoanId}"): interest NOT projected — ${reason}`);
  }

  // IvyTek carries Back Interest Due in its own bucket; Mifos has a single interest
  // field, so it joins the outstanding total here — AFTER the anchor/projection math,
  // which must run on the pure per-diem accrual only.
  const backInterestDue = Math.max(0, num(loan.backInterestDue) ?? 0);
  if (!closed && backInterestDue > 0) {
    interestOutstanding += backInterestDue;
    actions.push(`back interest due $${backInterestDue.toFixed(2)} added to outstanding interest`);
  }

  const interestCharged = interestPaid + interestOutstanding;

  if (!origination) {
    throw new Error(`Loan ${loanId}: missing/unparseable origination date "${loan.originationDate}"`);
  }

  // Corrected interest-charged-from date: anchor minus however many accrual days
  // IvyTek's AccruedInterestAll implies (days_accrued = accrued / perDiem — same
  // trick as getIvyTekOriginationDateCorrection in the REST/non-full-SQL import path).
  // For loans with payment history this lands exactly on the last payment date.
  // Origination/disbursement dates above stay at the TRUE source dates for audit purposes;
  // only this anchor moves, so that if Fineract's own interest engine ever recalculates
  // this loan going forward, it accrues from the correct starting point instead of the
  // loan's true — often decades-old — origination.
  let interestChargedFrom = origination;
  if (
    perDiem &&
    perDiem > 0 &&
    interestOutstandingAtSnapshot > 0 &&
    interestAnchorDate &&
    !isNaN(interestAnchorDate.getTime())
  ) {
    const daysAccrued = Math.round(interestOutstandingAtSnapshot / perDiem);
    let accrualStart = new Date(interestAnchorDate);
    accrualStart.setDate(accrualStart.getDate() - daysAccrued);
    accrualStart = applyCenturyWindow(accrualStart);
    const accrualStartIso = toIso(accrualStart);
    if (accrualStartIso && accrualStart.getFullYear() >= 1900 && accrualStartIso >= origination) {
      interestChargedFrom = accrualStartIso;
    }
  }

  // --- m_loan: lifecycle dates, terms, and every derived summary column -----
  const loanDesired = {
    submittedon_date: origination,
    approvedon_date: origination,
    expected_disbursedon_date: origination,
    disbursedon_date: origination,
    disbursement_date: origination,
    interest_calculated_from_date: interestChargedFrom,
    interest_charged_from_date: interestChargedFrom,
    expected_maturedon_date: maturity ?? undefined,
    maturedon_date: maturity ?? undefined,
    principal_amount: principalOriginal,
    principal_amount_proposed: principalOriginal,
    approved_principal: principalOriginal,
    annual_nominal_interest_rate: annualRate ?? undefined,
    nominal_interest_rate_per_period: annualRate ?? undefined,
    principal_disbursed_derived: principalOriginal,
    principal_repaid_derived: principalPaid,
    principal_outstanding_derived: closed ? 0 : principalOutstanding,
    interest_charged_derived: interestCharged,
    interest_repaid_derived: interestPaid,
    interest_outstanding_derived: closed ? 0 : interestOutstanding,
    total_expected_repayment_derived: principalOriginal + interestCharged,
    total_repayment_derived: principalPaid + interestPaid,
    total_outstanding_derived: closed ? 0 : principalOutstanding + interestOutstanding,
    total_expected_costofloan_derived: interestCharged,
    total_costofloan_derived: interestPaid,
    loan_status_id: closed ? LOAN_STATUS_CLOSED_OBLIGATIONS_MET : LOAN_STATUS_ACTIVE,
    closedon_date: closed ? (closedDate ?? lastPayment ?? reconciliation) : null
  };
  if (daysProjected > 0) {
    const projectedNote =
      `interest projected ${daysProjected} day(s) past snapshot (${interestAnchor}) to ${toIso(asOfDate)} ` +
      `at $${perDiem.toFixed(4)}/day (+$${(perDiem * daysProjected).toFixed(2)} -> $${interestOutstanding.toFixed(2)})`;
    actions.push(projectedNote);
    console.log(`[IvyTek SQL] loan ${loanId} ("${loan.legacyLoanId}"): ${projectedNote}`);
  }
  if (interestChargedFrom !== origination) {
    actions.push(`interest_charged_from_date anchored to ${interestChargedFrom} (true origination ${origination})`);
  }

  const loanParams = [];
  const loanAssignments = buildFilteredAssignments(loanDesired, cols.loan, loanParams);
  if (loanAssignments.length) {
    loanParams.push(loanId);
    await client.query(`UPDATE m_loan SET ${loanAssignments.join(', ')} WHERE id = $${loanParams.length}`, loanParams);
    actions.push(`m_loan: ${loanAssignments.length} column(s) set from source`);
  }

  // --- m_loan_repayment_schedule: rebuilt from source truth -----------------
  await client.query(`DELETE FROM m_loan_repayment_schedule WHERE loan_id = $1`, [loanId]);
  const now = new Date();
  const auditColumns = {
    createdby_id: createdBy,
    created_date: now,
    lastmodifiedby_id: createdBy,
    lastmodified_date: now,
    created_by: createdBy,
    last_modified_by: createdBy,
    created_on_utc: now,
    last_modified_on_utc: now
  };
  let installment = 0;
  const paidDueDate = lastPayment ?? currentDue ?? maturity ?? reconciliation ?? origination;
  if (principalPaid > 0 || interestPaid > 0 || closed) {
    installment += 1;
    await insertFilteredRow(
      client,
      'm_loan_repayment_schedule',
      {
        loan_id: loanId,
        fromdate: origination,
        duedate: paidDueDate,
        installment,
        principal_amount: principalPaid,
        principal_completed_derived: principalPaid,
        interest_amount: interestPaid,
        interest_completed_derived: interestPaid,
        completed_derived: true,
        obligations_met_on_date: paidDueDate,
        recalculated_interest_component: false,
        ...auditColumns
      },
      cols.schedule
    );
  }
  if (!closed && (principalOutstanding > 0 || interestOutstanding > 0)) {
    installment += 1;
    await insertFilteredRow(
      client,
      'm_loan_repayment_schedule',
      {
        loan_id: loanId,
        fromdate: installment > 1 ? paidDueDate : origination,
        duedate: currentDue ?? maturity ?? reconciliation ?? paidDueDate,
        installment,
        principal_amount: principalOutstanding,
        principal_completed_derived: 0,
        interest_amount: interestOutstanding,
        interest_completed_derived: 0,
        completed_derived: false,
        recalculated_interest_component: false,
        ...auditColumns
      },
      cols.schedule
    );
  }
  actions.push(`schedule: rebuilt with ${installment} installment(s)`);

  // --- disbursement transactions re-dated to the true origination -----------
  const disb = await client.query(
    `UPDATE m_loan_transaction SET transaction_date = $1, submitted_on_date = $1
     WHERE loan_id = $2 AND transaction_type_enum = 1`,
    [
      origination,
      loanId
    ]
  );
  if (disb.rowCount) actions.push(`disbursement txn(s) re-dated to ${origination} (${disb.rowCount})`);

  // --- m_loan_arrears_aging: source-truth arrears, or none ------------------
  await client.query(`DELETE FROM m_loan_arrears_aging WHERE loan_id = $1`, [loanId]);
  const isOverdue =
    !closed &&
    currentDue !== null &&
    reconciliation !== null &&
    currentDue < reconciliation &&
    principalOutstanding + interestOutstanding > 0;
  if (isOverdue) {
    const overdueTotal =
      amountOverdue !== null && amountOverdue > 0 ? amountOverdue : principalOutstanding + interestOutstanding;
    const interestOverdue = Math.min(overdueTotal, interestOutstanding);
    const principalOverdue = Math.max(0, overdueTotal - interestOverdue);
    await insertFilteredRow(
      client,
      'm_loan_arrears_aging',
      {
        loan_id: loanId,
        principal_overdue_derived: principalOverdue,
        interest_overdue_derived: interestOverdue,
        fee_charges_overdue_derived: 0,
        penalty_charges_overdue_derived: 0,
        total_overdue_derived: overdueTotal,
        overdue_since_date_derived: currentDue
      },
      cols.arrears
    );
    actions.push(`arrears aging: overdue ${overdueTotal.toFixed(2)} since ${currentDue}`);
  } else {
    actions.push('arrears aging: cleared (not overdue per source)');
  }

  // --- daily accrual registration -------------------------------------------
  // The hourly tick re-projects tracked loans to the current date so interest
  // keeps reconciling to "today" every day, not just at import time. The stored
  // date is the interest ANCHOR (data-implied snapshot), so the tick's
  // base + per_diem × days(today − anchor) matches this sync's math exactly.
  if (!closed && perDiem && perDiem > 0 && interestAnchor) {
    await client.query(
      `INSERT INTO ${ACCRUAL_TRACK_TABLE}
         (loan_id, per_diem, base_interest, reconciliation_date, last_projected_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (loan_id) DO UPDATE SET
         per_diem = EXCLUDED.per_diem,
         base_interest = EXCLUDED.base_interest,
         reconciliation_date = EXCLUDED.reconciliation_date,
         last_projected_date = EXCLUDED.last_projected_date`,
      [
        loanId,
        perDiem.toFixed(6),
        // Back interest rides in the tick's base as a constant offset — the per-diem
        // projection on top of it stays anchored to the pure accrual snapshot.
        (interestOutstandingAtSnapshot + backInterestDue).toFixed(6),
        interestAnchor,
        toIso(asOfDate) ?? interestAnchor
      ]
    );
    actions.push('registered for daily interest accrual');
  } else {
    await client.query(`DELETE FROM ${ACCRUAL_TRACK_TABLE} WHERE loan_id = $1`, [loanId]);
  }

  return { loanId, actions, impliedSnapshotDate };
}

/**
 * Resolves a loan's per-diem interest in DOLLARS per day, with a note describing
 * the derivation. IvyTek's Per_Diem_Interest_Rate__c holds the daily RATE
 * (annual rate ÷ 365, e.g. 0.00013699 for 5%), while its "Per Diem Amount" —
 * the dollars — is rate × outstanding principal. The unit is detected by
 * checking whether the field value sits closer to the predicted rate or the
 * predicted dollar amount; without an annual rate to predict from, a value
 * under $0.05/day whose implied accrual span exceeds 100 years is treated as
 * a rate. Falls back to ACT/365 (principal × annual rate ÷ 365) when the
 * field is absent. Returns { amount: null } when underivable.
 */
function resolvePerDiemDollars(loan) {
  const num = (v) => {
    const n = parseFloat(parseDecimalString(v) ?? '');
    return isNaN(n) ? null : n;
  };
  const raw = num(loan.perDiemInterestRate);
  const principalOutstanding = num(loan.principalOutstanding);
  const annualRate = num(loan.annualInterestRatePercent);
  const accrued = num(loan.interestOutstanding);
  const hasPrincipal = principalOutstanding !== null && principalOutstanding > 0;

  if (raw !== null && raw > 0) {
    let isRate;
    if (annualRate !== null && annualRate > 0 && hasPrincipal) {
      const predictedRate = annualRate / 36500;
      const predictedDollars = principalOutstanding * predictedRate;
      isRate = Math.abs(raw - predictedRate) < Math.abs(raw - predictedDollars);
    } else {
      const daysImplied = accrued !== null && accrued > 0 ? accrued / raw : null;
      isRate = raw < 0.05 && (daysImplied === null || daysImplied > 36500);
    }
    if (!isRate) {
      return { amount: raw, note: `per-diem $${raw.toFixed(4)}/day (source field)` };
    }
    if (hasPrincipal) {
      // The stored rate is rounded (0.00013699 vs 5/36500 = 0.000136986…); when it's
      // just the annual rate ÷ 365, prefer the exact derivation — this reproduces
      // IvyTek's own Per Diem Amount to the cent instead of drifting a cent high.
      const predictedRate = annualRate !== null && annualRate > 0 ? annualRate / 36500 : null;
      const rateToUse = predictedRate && Math.abs(raw - predictedRate) / predictedRate < 0.005 ? predictedRate : raw;
      const amount = rateToUse * principalOutstanding;
      return {
        amount,
        note: `per-diem $${amount.toFixed(4)}/day (source rate ${raw} × outstanding principal)`
      };
    }
    // Rate-form but nothing to scale it by — fall through to the ACT/365 derivation.
  }

  if (annualRate !== null && annualRate > 0 && hasPrincipal) {
    const amount = (principalOutstanding * (annualRate / 100)) / 365;
    return { amount, note: `per-diem $${amount.toFixed(4)}/day (ACT/365 from ${annualRate}% annual)` };
  }
  return { amount: null, note: null };
}

/**
 * Best-effort snapshot date implied by a loan's own accrual data:
 * last payment + accrued ÷ per-diem days. Returns null when underivable.
 */
function impliedAccrualSnapshotDate(loan) {
  const num = (v) => {
    const n = parseFloat(parseDecimalString(v) ?? '');
    return isNaN(n) ? null : n;
  };
  const base = num(loan.interestOutstanding);
  const perDiem = resolvePerDiemDollars(loan).amount;
  const lastPayment = parseSourceDate(loan.lastPaymentDate);
  if (!lastPayment || !perDiem || perDiem <= 0 || base === null || base <= 0) return null;
  const implied = new Date(lastPayment);
  implied.setDate(implied.getDate() + Math.round(base / perDiem));
  implied.setHours(0, 0, 0, 0);
  return isNaN(implied.getTime()) ? null : implied;
}

async function handleLoanStateSync(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(res, 400, { success: false, message: 'Invalid JSON body.', rows: [], warnings: [] });
  }

  if (!body?.db?.host || !body?.db?.dbname || !body?.db?.user)
    return jsonResponse(res, 400, {
      success: false,
      message: 'Missing required database config: host, dbname, user.',
      rows: [],
      warnings: []
    });
  if (!Array.isArray(body.loans) || !body.loans.length)
    return jsonResponse(res, 400, {
      success: false,
      message: 'No loans provided in request body.',
      rows: [],
      warnings: []
    });

  const apply = body.apply ?? false;
  const createdBy = parseInt(String(body.createdBy ?? '4'), 10) || 4;
  const reconciliationDate = parseSourceDate(body.reconciliationDate);
  const warnings = [];
  if (!reconciliationDate) {
    warnings.push("No reconciliationDate provided — arrears comparisons use each loan's data only where possible.");
  }
  // Interest is always projected to the server's wall-clock today — deliberately NOT
  // caller-controllable. Accepting an asOfDate let a stale browser bundle send the
  // Fineract tenant business date (which lags the wall clock on this instance) and
  // silently zero the projection, freezing interest at the export snapshot.
  const asOfDate = new Date();
  asOfDate.setHours(0, 0, 0, 0);

  const client = new Client({
    host: body.db.host,
    port: body.db.port ?? 5432,
    database: body.db.dbname,
    user: body.db.user,
    password: body.db.password
  });

  const rows = [];
  let synced = 0;
  try {
    await client.connect();
    const cols = {
      loan: await getTableColumns(client, 'm_loan'),
      schedule: await getTableColumns(client, 'm_loan_repayment_schedule'),
      arrears: await getTableColumns(client, 'm_loan_arrears_aging')
    };
    if (!cols.loan.size) throw new Error('m_loan table not found in this database/schema.');
    if (!cols.arrears.size) warnings.push('m_loan_arrears_aging table not found — arrears step will be skipped.');

    // Accrual tracking table + cached DB config power the hourly interest tick.
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${ACCRUAL_TRACK_TABLE} (
         loan_id BIGINT PRIMARY KEY,
         per_diem NUMERIC(19, 6) NOT NULL,
         base_interest NUMERIC(19, 6) NOT NULL,
         reconciliation_date DATE NOT NULL,
         last_projected_date DATE
       )`
    );
    _lastDbConfig = {
      host: body.db.host,
      port: body.db.port ?? 5432,
      dbname: body.db.dbname,
      user: body.db.user,
      password: body.db.password
    };

    // Batch interest anchor: the median of the dates each loan's accrual data implies
    // for itself. IvyTek's stored AccruedInterestAll lags the live screen, so the CSV
    // can be days staler than its export date — anchoring at the entered date would
    // then leave EVERY loan short by a constant per-diem × N that never closes.
    let batchAnchorDate = reconciliationDate;
    const impliedTimes = body.loans
      .map(impliedAccrualSnapshotDate)
      .filter(Boolean)
      .map((d) => d.getTime())
      .sort((a, b) => a - b);
    if (impliedTimes.length) {
      const median = new Date(impliedTimes[Math.floor(impliedTimes.length / 2)]);
      const daysOff = reconciliationDate
        ? Math.round((reconciliationDate.getTime() - median.getTime()) / 86400000)
        : null;
      // Trust the data over the entered date when they disagree by 2+ days (but cap at
      // 45 — a bigger gap means something else is wrong and should be looked at).
      if (daysOff === null || (Math.abs(daysOff) >= 2 && Math.abs(daysOff) <= 45)) {
        batchAnchorDate = median;
        if (daysOff !== null) {
          const medianIso = median.toISOString().split('T')[0];
          warnings.unshift(
            `EXPORT DATA IS STALE: the CSV's accrued-interest values are true as of ${medianIso} ` +
              `(median implied by ${impliedTimes.length} loan(s): last payment + accrued÷per-diem), which is ` +
              `${Math.abs(daysOff)} day(s) ${daysOff > 0 ? 'before' : 'after'} the entered export date (${body.reconciliationDate}). ` +
              `Interest was automatically anchored to ${medianIso} and projected to today from there.`
          );
        }
      }
    }

    await client.query('BEGIN');
    for (const loan of body.loans) {
      const row = {
        legacyLoanId: loan.legacyLoanId ?? '',
        externalId: loan.externalId ?? '',
        loanId: null,
        actions: '',
        status: 'pending'
      };
      await client.query('SAVEPOINT sp_loan_sync');
      try {
        const result = await syncLoanState(
          client,
          loan,
          cols,
          reconciliationDate,
          createdBy,
          asOfDate,
          batchAnchorDate
        );
        row.loanId = result.loanId;
        row.actions = result.actions.join('; ');
        row.status = apply ? 'applied' : 'ready';
        synced += 1;
        await client.query('RELEASE SAVEPOINT sp_loan_sync');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_loan_sync');
        await client.query('RELEASE SAVEPOINT sp_loan_sync');
        row.status = 'error';
        row.error = e.message;
        warnings.push(`Loan "${loan.legacyLoanId}": ${e.message}`);
      }
      rows.push(row);
    }

    if (apply) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }

    const verb = apply ? 'Applied' : 'Dry run —';
    return jsonResponse(res, 200, {
      success: true,
      message: `${verb} full-SQL state sync for ${synced} of ${body.loans.length} loan(s).`,
      loansProcessed: body.loans.length,
      loansSynced: synced,
      warnings,
      rows
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[IvyTek SQL] loan-state-sync error:', e);
    return jsonResponse(res, 500, {
      success: false,
      message: `Loan state sync failed: ${e.message}`,
      error: pgErrorDetail(e),
      rows,
      warnings
    });
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Daily interest accrual tick — keeps migrated loans reconciled to *today*,
// every day, not just at import time. syncLoanState registers each active loan
// in m_ivytek_interest_accrual with its per-diem rate, base (export-date)
// interest, and reconciliation date. This recomputes outstanding interest as
//   base_interest + per_diem × days(today − reconciliation_date)
// and rewrites the same m_loan / schedule / arrears values the sync writes.
// Recomputed from base (not incremental), so re-running any number of times a
// day — or after days of downtime — always lands on the same correct value.
// Loans with any real transaction after the reconciliation date are skipped
// permanently: from that point Fineract's own payment processing owns them.
// ---------------------------------------------------------------------------

async function runInterestAccrualTick(dbConfig) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().split('T')[0];
  const summary = { asOf: todayIso, projected: 0, upToDate: 0, skippedRealActivity: 0, rows: [] };

  const client = new Client({
    host: dbConfig.host,
    port: dbConfig.port ?? 5432,
    database: dbConfig.dbname,
    user: dbConfig.user,
    password: dbConfig.password
  });
  await client.connect();
  try {
    const tableExists = await client.query('select to_regclass($1) as t', [ACCRUAL_TRACK_TABLE]);
    if (!tableExists.rows[0].t) return summary;

    const tracked = await client.query(
      `SELECT a.loan_id, a.per_diem, a.base_interest, a.reconciliation_date, a.last_projected_date,
              l.loan_status_id, l.principal_amount, l.principal_outstanding_derived,
              l.interest_repaid_derived, l.interest_outstanding_derived
       FROM ${ACCRUAL_TRACK_TABLE} a
       JOIN m_loan l ON l.id = a.loan_id`
    );
    if (!tracked.rows.length) return summary;

    const loanCols = await getTableColumns(client, 'm_loan');
    await client.query('BEGIN');
    for (const t of tracked.rows) {
      const loanId = Number(t.loan_id);
      if (Number(t.loan_status_id) !== LOAN_STATUS_ACTIVE) {
        await client.query(`DELETE FROM ${ACCRUAL_TRACK_TABLE} WHERE loan_id = $1`, [loanId]);
        continue;
      }
      const lastProjected = t.last_projected_date ? new Date(t.last_projected_date) : null;
      if (lastProjected && lastProjected.toISOString().split('T')[0] >= todayIso) {
        summary.upToDate++;
        continue;
      }

      const realActivity = await client.query(
        `SELECT 1 FROM m_loan_transaction
         WHERE loan_id = $1 AND transaction_type_enum <> 1
           AND transaction_date > $2 AND COALESCE(is_reversed, false) = false
         LIMIT 1`,
        [
          loanId,
          t.reconciliation_date
        ]
      );
      if (realActivity.rows.length) {
        summary.skippedRealActivity++;
        continue;
      }

      const perDiem = parseFloat(t.per_diem);
      const baseInterest = parseFloat(t.base_interest);
      const reconDate = new Date(t.reconciliation_date);
      reconDate.setHours(0, 0, 0, 0);
      if (isNaN(perDiem) || perDiem <= 0 || isNaN(baseInterest) || isNaN(reconDate.getTime())) continue;

      const days = Math.max(0, Math.round((today.getTime() - reconDate.getTime()) / 86400000));
      const target = baseInterest + perDiem * days;
      const interestRepaid = parseFloat(t.interest_repaid_derived ?? '0') || 0;
      const principalOutstanding = parseFloat(t.principal_outstanding_derived ?? '0') || 0;
      const principalOriginal = parseFloat(t.principal_amount ?? '0') || 0;
      const previousOutstanding = parseFloat(t.interest_outstanding_derived ?? '0') || 0;
      const delta = target - previousOutstanding;

      const desired = {
        interest_outstanding_derived: target,
        interest_charged_derived: interestRepaid + target,
        total_outstanding_derived: principalOutstanding + target,
        total_expected_repayment_derived: principalOriginal + interestRepaid + target,
        total_expected_costofloan_derived: interestRepaid + target
      };
      const params = [];
      const assignments = buildFilteredAssignments(desired, loanCols, params);
      if (assignments.length) {
        params.push(loanId);
        await client.query(`UPDATE m_loan SET ${assignments.join(', ')} WHERE id = $${params.length}`, params);
      }
      await client.query(
        `UPDATE m_loan_repayment_schedule SET interest_amount = $1
         WHERE loan_id = $2 AND completed_derived = false`,
        [
          target.toFixed(6),
          loanId
        ]
      );
      if (delta !== 0) {
        await client.query(
          `UPDATE m_loan_arrears_aging
           SET interest_overdue_derived = COALESCE(interest_overdue_derived, 0) + $1,
               total_overdue_derived = COALESCE(total_overdue_derived, 0) + $1
           WHERE loan_id = $2`,
          [
            delta.toFixed(6),
            loanId
          ]
        );
      }
      await client.query(`UPDATE ${ACCRUAL_TRACK_TABLE} SET last_projected_date = $1 WHERE loan_id = $2`, [
        todayIso,
        loanId
      ]);

      summary.projected++;
      summary.rows.push({ loanId, days, interestOutstanding: target.toFixed(2) });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end().catch(() => {});
  }

  if (summary.projected || summary.skippedRealActivity) {
    console.log(
      `[IvyTek SQL] accrual tick @ ${todayIso}: ${summary.projected} loan(s) projected to today, ` +
        `${summary.upToDate} already current, ${summary.skippedRealActivity} skipped (post-migration activity)`
    );
  }
  return summary;
}

async function handleInterestAccrualTick(req, res) {
  let body = {};
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return jsonResponse(res, 400, { success: false, message: 'Invalid JSON body.' });
  }
  const db = body?.db?.host ? body.db : _lastDbConfig;
  if (!db) {
    return jsonResponse(res, 503, {
      success: false,
      message: 'No DB config available — run an import/sync first or pass db in the body.'
    });
  }
  try {
    const summary = await runInterestAccrualTick(db);
    return jsonResponse(res, 200, { success: true, ...summary });
  } catch (e) {
    console.error('[IvyTek SQL] accrual tick error:', e);
    return jsonResponse(res, 500, { success: false, message: `Accrual tick failed: ${e.message}` });
  }
}

async function handleScheduleFix(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(res, 400, {
      success: false,
      message: 'Invalid JSON body.',
      loansProcessed: 0,
      installmentsUpdated: 0,
      warnings: [],
      rows: []
    });
  }

  if (!body?.db?.host || !body?.db?.dbname || !body?.db?.user)
    return jsonResponse(res, 400, {
      success: false,
      message: 'Missing required database config: host, dbname, user.',
      loansProcessed: 0,
      installmentsUpdated: 0,
      warnings: [],
      rows: []
    });
  if (!Array.isArray(body.loans) || !body.loans.length)
    return jsonResponse(res, 400, {
      success: false,
      message: 'No loans provided in request body.',
      loansProcessed: 0,
      installmentsUpdated: 0,
      warnings: [],
      rows: []
    });

  const apply = body.apply ?? false;
  const client = new Client({
    host: body.db.host,
    port: body.db.port ?? 5432,
    database: body.db.dbname,
    user: body.db.user,
    password: body.db.password
  });

  try {
    await client.connect();
    if (apply) await client.query('BEGIN');

    const { rows, installmentsUpdated, warnings } = await rebuildRepaymentSchedule(
      client,
      body.loans,
      apply,
      body.reconciliationDate ?? null
    );

    if (apply) await client.query('COMMIT');

    const verb = apply ? 'Applied' : 'Dry run —';
    jsonResponse(res, 200, {
      success: true,
      message: `${verb} ${installmentsUpdated} installment update(s) across ${body.loans.length} loan(s).`,
      loansProcessed: body.loans.length,
      installmentsUpdated,
      warnings,
      rows
    });
  } catch (e) {
    if (apply) await client.query('ROLLBACK').catch(() => {});
    console.error('[IvyTek SQL] schedule-fix error:', e);
    jsonResponse(res, 500, {
      success: false,
      message: `Schedule fix failed: ${e.message}`,
      error: pgErrorDetail(e),
      loansProcessed: 0,
      installmentsUpdated: 0,
      warnings: [],
      rows: []
    });
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Interest-rate-fix — SQL fallback for Stage 6 REST restoration failures. When
// a loan is already approved/disbursed/closed, Fineract's REST API returns
// HTTP 403 for interest-rate changes, so this writes the correct nominal rate
// directly to m_loan instead.
// ---------------------------------------------------------------------------

async function handleInterestRateFix(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(res, 400, {
      success: false,
      message: 'Invalid JSON body.',
      loansProcessed: 0,
      rows: [],
      warnings: []
    });
  }

  if (!body?.db?.host || !body?.db?.dbname || !body?.db?.user)
    return jsonResponse(res, 400, {
      success: false,
      message: 'Missing required database config: host, dbname, user.',
      loansProcessed: 0,
      rows: [],
      warnings: []
    });
  if (!Array.isArray(body.loans) || !body.loans.length)
    return jsonResponse(res, 400, {
      success: false,
      message: 'No loans provided in request body.',
      loansProcessed: 0,
      rows: [],
      warnings: []
    });

  const apply = body.apply ?? false;
  const client = new Client({
    host: body.db.host,
    port: body.db.port ?? 5432,
    database: body.db.dbname,
    user: body.db.user,
    password: body.db.password
  });

  const rows = [];
  const warnings = [];
  let loansUpdated = 0;

  try {
    await client.connect();
    if (apply) await client.query('BEGIN');

    for (const loan of body.loans) {
      const loanId = Number(loan.loanId);
      if (!loanId || isNaN(loanId)) {
        warnings.push(`Skipping loan with invalid ID: ${loan.loanId}`);
        continue;
      }

      const annualRate = Number(loan.annualRatePercent);
      if (isNaN(annualRate) || annualRate <= 0) {
        warnings.push(`Loan ${loanId}: invalid annualRatePercent "${loan.annualRatePercent}", skipping`);
        rows.push({
          loanId,
          legacyLoanId: loan.legacyLoanId || '',
          previousAnnualRate: '',
          newAnnualRate: String(loan.annualRatePercent),
          previousPerPeriodRate: '',
          newPerPeriodRate: '',
          status: 'skipped',
          note: `Invalid annualRatePercent: ${loan.annualRatePercent}`
        });
        continue;
      }

      const repaymentsPerYear = Number(loan.numberOfRepaymentsPerYear ?? 12);
      const perPeriodRate = annualRate / repaymentsPerYear;

      const { rows: existing } = await client.query(
        `SELECT annual_nominal_interest_rate, nominal_interest_rate_per_period FROM m_loan WHERE id = $1`,
        [loanId]
      );

      if (!existing.length) {
        warnings.push(`Loan ${loanId}: not found in m_loan, skipping`);
        rows.push({
          loanId,
          legacyLoanId: loan.legacyLoanId || '',
          previousAnnualRate: '',
          newAnnualRate: annualRate.toFixed(6),
          previousPerPeriodRate: '',
          newPerPeriodRate: perPeriodRate.toFixed(6),
          status: 'skipped',
          note: 'Loan not found in m_loan'
        });
        continue;
      }

      const prev = existing[0];
      const prevAnnual = parseFloat(prev.annual_nominal_interest_rate);

      if (Math.abs(prevAnnual - annualRate) < 0.0001) {
        rows.push({
          loanId,
          legacyLoanId: loan.legacyLoanId || '',
          previousAnnualRate: prev.annual_nominal_interest_rate,
          newAnnualRate: annualRate.toFixed(6),
          previousPerPeriodRate: prev.nominal_interest_rate_per_period,
          newPerPeriodRate: perPeriodRate.toFixed(6),
          status: 'skipped',
          note: 'Rate already correct'
        });
        continue;
      }

      if (apply) {
        await client.query(
          `UPDATE m_loan
           SET nominal_interest_rate_per_period = $1,
               annual_nominal_interest_rate     = $2
           WHERE id = $3`,
          [
            perPeriodRate,
            annualRate,
            loanId
          ]
        );
      }

      loansUpdated++;
      rows.push({
        loanId,
        legacyLoanId: loan.legacyLoanId || '',
        previousAnnualRate: prev.annual_nominal_interest_rate,
        newAnnualRate: annualRate.toFixed(6),
        previousPerPeriodRate: prev.nominal_interest_rate_per_period,
        newPerPeriodRate: perPeriodRate.toFixed(6),
        status: apply ? 'applied' : 'pending'
      });
    }

    if (apply) await client.query('COMMIT');

    const verb = apply ? 'Applied' : 'Dry run —';
    jsonResponse(res, 200, {
      success: true,
      message: `${verb} interest rate correction for ${loansUpdated} of ${body.loans.length} loan(s).`,
      loansProcessed: body.loans.length,
      loansUpdated,
      warnings,
      rows
    });
  } catch (e) {
    if (apply) await client.query('ROLLBACK').catch(() => {});
    console.error('[IvyTek SQL] interest-rate-fix error:', e);
    jsonResponse(res, 500, {
      success: false,
      message: `Interest rate fix failed: ${e.message}`,
      error: pgErrorDetail(e),
      loansProcessed: 0,
      loansUpdated: 0,
      warnings,
      rows
    });
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Bulk delete — truncates all transactional/portfolio data (offices, users,
// and configuration tables are left intact). Mirrors the manual SQL script
// used to reset a Fineract instance between test/demo runs.
// ---------------------------------------------------------------------------

// Loan/transaction/accounting data — always cleared regardless of keepClients.
// TRUNCATE ... CASCADE on these also empties any other Fineract table with an
// FK pointing at them (rescheduling, guarantors, etc.) even though it isn't
// named here — that's intentional and matches the original manual script.
const BULK_DELETE_LOAN_TABLES = [
  'acc_gl_journal_entry',
  'm_account_transfer_transaction',
  'm_account_transfer_details',
  'm_payment_detail',
  'm_loan_arrears_aging',
  'm_loan_overdue_installment_charge',
  'm_loan_charge_paid_by',
  'm_loan_transaction_repayment_schedule_mapping',
  'm_loan_transaction',
  'm_loan_repayment_schedule',
  'm_loan_charge',
  'm_loan_collateral',
  'm_loan_topup',
  'm_loan',
  'm_portfolio_account_associations'
];

// Client/group identity data — only cleared when keepClients is false.
const BULK_DELETE_CLIENT_TABLES = [
  'm_client_identifier',
  'm_client_non_person',
  'm_client_attendance',
  'm_client',
  'm_group_client',
  'm_group'
];

async function tableExists(client, table) {
  const res = await client.query('select to_regclass($1) as t', [table]);
  return !!res.rows[0].t;
}

async function tableHasColumn(client, table, column) {
  const res = await client.query(
    'select 1 from information_schema.columns where table_name = $1 and column_name = $2',
    [
      table,
      column
    ]
  );
  return res.rowCount > 0;
}

async function truncateIfExists(client, table) {
  if (!(await tableExists(client, table))) return false;
  await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
  return true;
}

async function handleBulkDelete(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(res, 400, { success: false, message: 'Invalid JSON body.' });
  }

  const db = body?.db;
  const keepClients = !!body?.keepClients;
  if (!db?.host || !db?.dbname || !db?.user) {
    return jsonResponse(res, 400, {
      success: false,
      message: 'Missing required database config: host, dbname, user.'
    });
  }

  const client = new Client({
    host: db.host,
    port: db.port ?? 5432,
    database: db.dbname,
    user: db.user,
    password: db.password
  });

  const truncated = [];
  const missing = [];
  const preserved = [];
  const warnings = [];
  let notesPreserved = 0;
  let calendarInstancesRemoved = 0;

  try {
    await client.connect();
    await client.query('BEGIN');

    // m_note has FK columns to both m_loan/m_loan_transaction and m_client/m_group,
    // so TRUNCATE ... CASCADE on the loan tables below empties m_note entirely, not
    // just the loan-related rows. Snapshot the client/group-owned notes first so
    // they can be restored once the loan-side wipe is done.
    let canPreserveNotes = false;
    if (keepClients && (await tableExists(client, 'm_note'))) {
      const hasLoanCols =
        (await tableHasColumn(client, 'm_note', 'loan_id')) &&
        (await tableHasColumn(client, 'm_note', 'loan_transaction_id'));
      if (hasLoanCols) {
        await client.query(`
          CREATE TEMP TABLE _bulk_delete_kept_notes ON COMMIT DROP AS
          SELECT * FROM m_note WHERE loan_id IS NULL AND loan_transaction_id IS NULL
        `);
        canPreserveNotes = true;
      } else {
        warnings.push(
          'm_note has an unexpected schema — notes could not be selectively preserved and were fully cleared.'
        );
      }
    }

    for (const table of BULK_DELETE_LOAN_TABLES) {
      (await truncateIfExists(client, table)) ? truncated.push(table) : missing.push(table);
    }

    // Re-run explicitly: harmless no-op if the cascade above already emptied it.
    (await truncateIfExists(client, 'm_note')) ? truncated.push('m_note') : missing.push('m_note');

    // m_document has no real FK (entity_type/entity_id is polymorphic), so it's
    // never touched by the CASCADE above — handle it directly.
    if (await tableExists(client, 'm_document')) {
      if (keepClients && (await tableHasColumn(client, 'm_document', 'entity_type'))) {
        await client.query(`DELETE FROM m_document WHERE entity_type = 'loans'`);
        preserved.push('m_document (client/group documents kept, loan documents removed)');
      } else {
        await client.query('TRUNCATE TABLE m_document RESTART IDENTITY CASCADE');
        truncated.push('m_document');
      }
    } else {
      missing.push('m_document');
    }

    // m_calendar_instance is also polymorphic (entity_id/entity_type_enum can point
    // to a client, group, loan, or savings account), so it has no real FK to m_loan
    // and is never touched by the CASCADE above either. Left behind, stale rows for
    // a reused loan id (m_loan is TRUNCATE ... RESTART IDENTITY, so ids get reused
    // across runs) accumulate across resets. Fineract looks up a loan's recalculation
    // calendar expecting exactly one row, so leftover duplicates make every later
    // disbursement on that loan id fail with a data-integrity/non-unique-result error.
    // Entity types 3/6/7 are the loan-only ones (loan, recalculation rest detail,
    // recalculation compounding detail) — client/group/center/savings types are untouched.
    if (await tableExists(client, 'm_calendar_instance')) {
      const removedRes = await client.query(
        'DELETE FROM m_calendar_instance WHERE entity_type_enum IN (3, 6, 7) RETURNING id'
      );
      calendarInstancesRemoved = removedRes.rowCount ?? 0;
      truncated.push(`m_calendar_instance (${calendarInstancesRemoved} loan-related row(s) removed)`);
      if (await tableExists(client, 'm_calendar')) {
        await client.query('DELETE FROM m_calendar WHERE id NOT IN (SELECT calendar_id FROM m_calendar_instance)');
      }
    } else {
      missing.push('m_calendar_instance');
    }

    if (keepClients) {
      preserved.push(...BULK_DELETE_CLIENT_TABLES);
    } else {
      for (const table of BULK_DELETE_CLIENT_TABLES) {
        (await truncateIfExists(client, table)) ? truncated.push(table) : missing.push(table);
      }
    }

    if (canPreserveNotes) {
      const restoreRes = await client.query('INSERT INTO m_note SELECT * FROM _bulk_delete_kept_notes');
      notesPreserved = restoreRes.rowCount ?? 0;
      if (notesPreserved > 0) {
        await client.query(`SELECT setval('m_note_id_seq', (SELECT COALESCE(MAX(id), 1) FROM m_note))`);
      }
    }

    await client.query('COMMIT');
    jsonResponse(res, 200, {
      success: true,
      message:
        `Truncated ${truncated.length} table(s).` +
        ` Removed ${calendarInstancesRemoved} stale loan calendar instance(s).` +
        (keepClients ? ` Kept clients/groups and ${notesPreserved} client/group note(s).` : '') +
        (missing.length ? ` ${missing.length} table(s) not present in this database.` : ''),
      truncated,
      preserved,
      missing,
      notesPreserved,
      calendarInstancesRemoved,
      warnings
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[IvyTek SQL] bulk-delete error:', e);
    jsonResponse(res, 500, {
      success: false,
      message: `Bulk delete failed: ${e.message}`,
      error: pgErrorDetail(e),
      truncated,
      preserved,
      missing,
      warnings
    });
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function startServer() {
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
      let codeModifiedAt = null;
      let stale = false;
      try {
        codeModifiedAt = fs.statSync(__filename).mtime;
        stale = codeModifiedAt.getTime() > CODE_LOADED_AT.getTime();
      } catch {
        // File unreadable (moved/deleted) — report health without staleness info.
      }
      return jsonResponse(res, 200, {
        status: 'ok',
        service: 'IvyTek SQL Import Server',
        codeLoadedAt: CODE_LOADED_AT.toISOString(),
        codeModifiedAt: codeModifiedAt ? codeModifiedAt.toISOString() : null,
        stale,
        ...(stale ? { warning: 'sql-import-server.js changed after load — restart ng serve to pick it up.' } : {})
      });
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
    if (req.url === '/api/ivytek/sql-import' && req.method === 'POST') {
      return handleSqlImport(req, res);
    }
    if (req.url === '/api/ivytek/loan-state-sync' && req.method === 'POST') {
      return handleLoanStateSync(req, res);
    }
    if (req.url === '/api/ivytek/interest-accrual-tick' && req.method === 'POST') {
      return handleInterestAccrualTick(req, res);
    }
    if (req.url === '/api/ivytek/schedule-fix' && req.method === 'POST') {
      return handleScheduleFix(req, res);
    }
    if (req.url === '/api/ivytek/interest-rate-fix' && req.method === 'POST') {
      return handleInterestRateFix(req, res);
    }
    if (req.url === '/api/ivytek/feedpost-import' && req.method === 'POST') {
      return handleFeedPostImport(req, res);
    }
    if (req.url === '/api/ivytek/content-version-resolve' && req.method === 'POST') {
      return handleContentVersionResolve(req, res);
    }
    if (req.url === '/api/ivytek/bulk-delete' && req.method === 'POST') {
      return handleBulkDelete(req, res);
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
    console.log(`[IvyTek SQL] Import server listening on http://127.0.0.1:${PORT}`);
  });

  // Hourly heartbeat for the daily accrual tick. Needs DB credentials, which are
  // cached after any import/sync request — until then each firing is a no-op, and
  // per-loan work only happens once per calendar day (recomputed from base, so
  // downtime or repeat runs can never drift the numbers).
  setInterval(
    () => {
      if (!_lastDbConfig) return;
      runInterestAccrualTick(_lastDbConfig).catch((e) => console.error('[IvyTek SQL] accrual tick failed:', e.message));
    },
    60 * 60 * 1000
  );

  return server;
}

// Pure helpers exported for tests — requiring this module does NOT start the server.
module.exports = { startServer, resolvePerDiemDollars, impliedAccrualSnapshotDate };

if (require.main === module) startServer();
