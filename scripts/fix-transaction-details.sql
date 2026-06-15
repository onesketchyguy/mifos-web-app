-- Fix the IvyTek Transaction Import Note stretchy report so notes show on the transactions tab.
-- Run once in pgAdmin or psql.  Safe to re-run.

DO $$
DECLARE
  v_report_id  bigint;
  v_param_id   bigint;
BEGIN
  INSERT INTO stretchy_report (
    id, report_name, report_type, report_subtype, report_category,
    report_sql, description, core_report, use_report, self_service_user_report
  ) VALUES (
    nextval('stretchy_report_id_seq'),
    'IvyTek Transaction Import Note',
    'Table', NULL, 'Loan',
    'select note as "Import Note"'            || chr(10) ||
    'from c_transaction_details'              || chr(10) ||
    'where id = ${transactionId}'             || chr(10) ||
    'limit 1',
    'IvyTek imported transaction note lookup by Fineract transaction ID.',
    false, true, false
  )
  ON CONFLICT (report_name) DO UPDATE SET
    report_sql  = EXCLUDED.report_sql,
    use_report  = true
  RETURNING id INTO v_report_id;

  INSERT INTO stretchy_parameter (
    id, parameter_name, parameter_variable, parameter_label,
    "parameter_displayType", "parameter_FormatType", parameter_default,
    special, "selectOne", "selectAll", parameter_sql, parent_id
  ) VALUES (
    nextval('stretchy_parameter_id_seq'),
    'TransactionId', 'transactionId', 'Transaction Id',
    'text', 'string', 'n/a', NULL, NULL, NULL, NULL, NULL
  )
  ON CONFLICT (parameter_name) DO UPDATE SET
    parameter_variable = 'transactionId'
  RETURNING id INTO v_param_id;

  INSERT INTO stretchy_report_parameter (id, report_id, parameter_id, report_parameter_name)
  VALUES (nextval('stretchy_report_parameter_id_seq'), v_report_id, v_param_id, 'transactionId')
  ON CONFLICT (report_id, parameter_id) DO UPDATE SET
    report_parameter_name = 'transactionId';

  RAISE NOTICE 'Done: report_id=%, param_id=%', v_report_id, v_param_id;
END $$;
