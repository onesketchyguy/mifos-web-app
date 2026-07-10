-- Registers three read-only "Table" reports used by the web app to load the
-- Loans list, Clients list, and Tribal Loan Payments/Management screens in a
-- single query each, instead of one API call per row (the old per-row
-- enrichment made 100-250 requests per page, and the tribal screens made one
-- datatable request per loan in the whole system).
--
-- Run against the Fineract PostgreSQL database, e.g.:
--   psql -h <db-host> -U <db-user> -d <fineract-db> -f scripts/register-list-reports.sql
--
-- Safe to run multiple times — reports are upserted and grants are idempotent.
-- The web app falls back to the old per-row loading if these reports are
-- missing, so nothing breaks before this is applied.
--
-- Note: the TribalLoanData report is only registered if the "Tribal Loan
-- Data" loan datatable exists (it is looked up in x_registered_table), so
-- re-run this script after creating that datatable.

-- ---------------------------------------------------------------------------
-- LoanListSummary: one row per loan with every column the loans list shows.
-- Dates are compared against the Fineract business date (falls back to the
-- database date if the business date table is empty).
-- ---------------------------------------------------------------------------
INSERT INTO stretchy_report (report_name, report_type, report_category, report_sql, description, core_report, use_report)
VALUES (
  'LoanListSummary',
  'Table',
  'Loan',
  $loanlist$
WITH today AS (
  SELECT COALESCE((SELECT bd.date FROM m_business_date bd WHERE bd.type = 'BUSINESS_DATE'), CURRENT_DATE) AS d
),
sched AS (
  SELECT s.loan_id,
         MIN(CASE WHEN NOT COALESCE(s.completed_derived, false) THEN s.duedate END) AS next_due_date,
         MIN(CASE WHEN NOT COALESCE(s.completed_derived, false) AND s.duedate <= t.d THEN s.duedate END) AS overdue_since,
         SUM(CASE WHEN NOT COALESCE(s.completed_derived, false) AND s.duedate <= t.d THEN
               (COALESCE(s.principal_amount, 0) - COALESCE(s.principal_completed_derived, 0) - COALESCE(s.principal_writtenoff_derived, 0))
             + (COALESCE(s.interest_amount, 0) - COALESCE(s.interest_completed_derived, 0) - COALESCE(s.interest_waived_derived, 0) - COALESCE(s.interest_writtenoff_derived, 0))
             + (COALESCE(s.fee_charges_amount, 0) - COALESCE(s.fee_charges_completed_derived, 0) - COALESCE(s.fee_charges_waived_derived, 0) - COALESCE(s.fee_charges_writtenoff_derived, 0))
             + (COALESCE(s.penalty_charges_amount, 0) - COALESCE(s.penalty_charges_completed_derived, 0) - COALESCE(s.penalty_charges_waived_derived, 0) - COALESCE(s.penalty_charges_writtenoff_derived, 0))
             ELSE 0 END) AS amount_now_due
  FROM m_loan_repayment_schedule s
  CROSS JOIN today t
  GROUP BY s.loan_id
)
SELECT l.id AS "id",
       l.account_no AS "accountNo",
       l.external_id AS "externalId",
       l.client_id AS "clientId",
       c.display_name AS "clientName",
       l.group_id AS "groupId",
       g.display_name AS "groupName",
       COALESCE(c.office_id, g.office_id) AS "officeId",
       COALESCE(co.name, go.name) AS "officeName",
       rev.enum_value AS "status",
       COALESCE(sched.overdue_since, sched.next_due_date) AS "currentDueDate",
       l.total_outstanding_derived AS "balanceNow",
       COALESCE(aging.total_overdue_derived, NULLIF(sched.amount_now_due, 0)) AS "amountNowDue",
       COALESCE(aging.interest_overdue_derived, l.interest_outstanding_derived) AS "projectedAccruedInterest",
       l.annual_nominal_interest_rate AS "interestRate",
       lastpay.amount AS "amountLast",
       COALESCE(l.expected_maturedon_date, l.maturedon_date) AS "maturityDate",
       CASE WHEN COALESCE(aging.overdue_since_date_derived, sched.overdue_since) IS NOT NULL
            THEN GREATEST(t.d - COALESCE(aging.overdue_since_date_derived, sched.overdue_since), 0)
            END AS "daysLate"
FROM m_loan l
CROSS JOIN today t
LEFT JOIN m_client c ON c.id = l.client_id
LEFT JOIN m_group g ON g.id = l.group_id
LEFT JOIN m_office co ON co.id = c.office_id
LEFT JOIN m_office go ON go.id = g.office_id
LEFT JOIN r_enum_value rev ON rev.enum_name = 'loan_status_id' AND rev.enum_id = l.loan_status_id
LEFT JOIN m_loan_arrears_aging aging ON aging.loan_id = l.id
LEFT JOIN sched ON sched.loan_id = l.id
LEFT JOIN LATERAL (
  SELECT tr.amount
  FROM m_loan_transaction tr
  WHERE tr.loan_id = l.id AND NOT tr.is_reversed AND tr.transaction_type_enum = 2
  ORDER BY tr.transaction_date DESC, tr.id DESC
  LIMIT 1
) lastpay ON true
ORDER BY l.id
$loanlist$,
  'All loans with the computed columns shown on the loans list page, in one query.',
  false,
  true
)
ON CONFLICT (report_name) DO UPDATE
  SET report_sql = EXCLUDED.report_sql,
      description = EXCLUDED.description,
      report_type = EXCLUDED.report_type,
      report_category = EXCLUDED.report_category;

-- ---------------------------------------------------------------------------
-- ClientListSummary: one row per client with the metrics the clients list
-- shows (entity id, loan officer, active/overdue balances, arrears, counts).
-- Loan status 300 = Active. Entity ID matches the same identifier names the
-- web app looks for: EntityID / Entity Id / entity_id.
-- ---------------------------------------------------------------------------
INSERT INTO stretchy_report (report_name, report_type, report_category, report_sql, description, core_report, use_report)
VALUES (
  'ClientListSummary',
  'Table',
  'Client',
  $clientlist$
WITH today AS (
  SELECT COALESCE((SELECT bd.date FROM m_business_date bd WHERE bd.type = 'BUSINESS_DATE'), CURRENT_DATE) AS d
),
loan_metrics AS (
  SELECT l.client_id,
         COUNT(*) FILTER (WHERE l.loan_status_id = 300) AS active_loans_count,
         SUM(l.total_outstanding_derived) FILTER (WHERE l.loan_status_id = 300) AS active_balance,
         SUM(aging.total_overdue_derived) FILTER (WHERE l.loan_status_id = 300) AS overdue_balance,
         MAX(CASE WHEN l.loan_status_id = 300 THEN t.d - aging.overdue_since_date_derived END) AS days_in_arrears
  FROM m_loan l
  CROSS JOIN today t
  LEFT JOIN m_loan_arrears_aging aging ON aging.loan_id = l.id
  WHERE l.client_id IS NOT NULL
  GROUP BY l.client_id
)
SELECT c.id AS "id",
       ident.document_key AS "entityIdNumber",
       staff.display_name AS "loanOfficer",
       COALESCE(lm.active_balance, 0) AS "activeBalance",
       COALESCE(lm.overdue_balance, 0) AS "overdueBalance",
       COALESCE(lm.days_in_arrears, 0) AS "daysInArrears",
       COALESCE(lm.active_loans_count, 0) AS "activeLoansCount"
FROM m_client c
LEFT JOIN m_staff staff ON staff.id = c.staff_id
LEFT JOIN loan_metrics lm ON lm.client_id = c.id
LEFT JOIN LATERAL (
  SELECT ci.document_key
  FROM m_client_identifier ci
  JOIN m_code_value cv ON cv.id = ci.document_type_id
  WHERE ci.client_id = c.id
    AND lower(regexp_replace(cv.code_value, '[_\s-]', '', 'g')) = 'entityid'
  ORDER BY ci.id
  LIMIT 1
) ident ON true
ORDER BY c.id
$clientlist$,
  'All clients with the metrics shown on the clients list page, in one query.',
  false,
  true
)
ON CONFLICT (report_name) DO UPDATE
  SET report_sql = EXCLUDED.report_sql,
      description = EXCLUDED.description,
      report_type = EXCLUDED.report_type,
      report_category = EXCLUDED.report_category;

-- ---------------------------------------------------------------------------
-- TribalLoanData: one row per loan with its "Tribal Loan Data" datatable row
-- serialized as JSON. The web app matches the datatable's percap / pension /
-- payroll columns by name on the client side (column names vary between
-- environments), so the report does not need to know them. The physical
-- datatable name is resolved from x_registered_table at registration time.
-- ---------------------------------------------------------------------------
DO $tribal$
DECLARE
  tribal_table text;
  tribal_sql text;
BEGIN
  SELECT registered_table_name INTO tribal_table
  FROM x_registered_table
  WHERE application_table_name = 'm_loan'
    AND lower(regexp_replace(registered_table_name, '[^a-zA-Z0-9]', '', 'g')) = 'triballoandata'
  LIMIT 1;

  IF tribal_table IS NULL THEN
    RAISE NOTICE 'Tribal Loan Data loan datatable not found in x_registered_table; skipping TribalLoanData report registration. Re-run this script after creating the datatable.';
    RETURN;
  END IF;

  tribal_sql := format($sql$
SELECT l.id AS "id",
       l.account_no AS "accountNo",
       l.external_id AS "externalId",
       COALESCE(c.display_name, g.display_name) AS "borrowerName",
       rev.enum_value AS "status",
       CASE WHEN l.loan_status_id = 300 THEN 'true' ELSE 'false' END AS "active",
       l.total_outstanding_derived AS "balanceNow",
       td.fields AS "tribalData"
FROM m_loan l
LEFT JOIN m_client c ON c.id = l.client_id
LEFT JOIN m_group g ON g.id = l.group_id
LEFT JOIN r_enum_value rev ON rev.enum_name = 'loan_status_id' AND rev.enum_id = l.loan_status_id
LEFT JOIN LATERAL (
  SELECT (to_jsonb(t) - 'id' - 'loan_id' - 'created_at' - 'updated_at')::text AS fields
  FROM %I t
  WHERE t.loan_id = l.id
  LIMIT 1
) td ON true
ORDER BY l.id
$sql$, tribal_table);

  INSERT INTO stretchy_report (report_name, report_type, report_category, report_sql, description, core_report, use_report)
  VALUES (
    'TribalLoanData',
    'Table',
    'Loan',
    tribal_sql,
    'All loans with their Tribal Loan Data datatable row as JSON, in one query.',
    false,
    true
  )
  ON CONFLICT (report_name) DO UPDATE
    SET report_sql = EXCLUDED.report_sql,
        description = EXCLUDED.description,
        report_type = EXCLUDED.report_type,
        report_category = EXCLUDED.report_category;

  INSERT INTO m_permission (grouping, code, entity_name, action_name, can_maker_checker)
  SELECT 'report', 'READ_TribalLoanData', 'TribalLoanData', 'READ', false
  WHERE NOT EXISTS (SELECT 1 FROM m_permission WHERE code = 'READ_TribalLoanData');

  INSERT INTO m_role_permission (role_id, permission_id)
  SELECT r.id, p.id
  FROM m_role r
  CROSS JOIN m_permission p
  WHERE p.code = 'READ_TribalLoanData'
    AND NOT EXISTS (
      SELECT 1 FROM m_role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
    );
END $tribal$;

-- Permissions: registering via SQL (instead of the reports API) does not
-- create the READ permissions, so add them and grant to every role. The
-- reports expose the same data the list pages already show.
INSERT INTO m_permission (grouping, code, entity_name, action_name, can_maker_checker)
SELECT 'report', 'READ_LoanListSummary', 'LoanListSummary', 'READ', false
WHERE NOT EXISTS (SELECT 1 FROM m_permission WHERE code = 'READ_LoanListSummary');

INSERT INTO m_permission (grouping, code, entity_name, action_name, can_maker_checker)
SELECT 'report', 'READ_ClientListSummary', 'ClientListSummary', 'READ', false
WHERE NOT EXISTS (SELECT 1 FROM m_permission WHERE code = 'READ_ClientListSummary');

INSERT INTO m_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM m_role r
CROSS JOIN m_permission p
WHERE p.code IN ('READ_LoanListSummary', 'READ_ClientListSummary')
  AND NOT EXISTS (
    SELECT 1 FROM m_role_permission rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- Show what got registered.
SELECT report_name, report_type, report_category FROM stretchy_report
WHERE report_name IN ('LoanListSummary', 'ClientListSummary', 'TribalLoanData');
