-- Diagnostic: see what we have before migrating.
-- Note: the old c_transaction_details schema stores the Fineract transaction ID in "id"
-- and the IvyTek string in "transaction_external_id".
SELECT 'c_transaction_details rows' AS label, COUNT(*) AS count
  FROM c_transaction_details WHERE note IS NOT NULL AND note <> ''
UNION ALL
SELECT 'm_note IvyTek rows already', COUNT(*)
  FROM m_note WHERE note LIKE 'IvyTek SQL history import:%';

-- Migrate: copy notes from c_transaction_details into m_note.
-- cd.id IS the Fineract integer transaction ID (confirmed by non-sequential gap values).
-- Safe to run multiple times — the NOT EXISTS guard prevents duplicates.
INSERT INTO m_note (
  id, client_id, group_id, loan_id, loan_transaction_id,
  savings_account_id, savings_account_transaction_id, share_account_id,
  note_type_enum, note,
  created_date, created_by, lastmodified_date, last_modified_by,
  created_on_utc, last_modified_on_utc
)
SELECT
  nextval('m_note_id_seq'),
  null, null,
  t.loan_id,
  t.id,
  null, null, null,
  300,
  cd.note,
  now(), 4, now(), 4, now(), now()
FROM c_transaction_details cd
JOIN m_loan_transaction t ON t.id = cd.id
WHERE cd.note IS NOT NULL AND length(cd.note) > 0
  AND NOT EXISTS (
    SELECT 1 FROM m_note n
    WHERE n.loan_transaction_id = t.id
      AND n.note LIKE 'IvyTek SQL history import:%'
  );

-- Confirm how many notes are now in m_note.
SELECT 'm_note IvyTek rows after migration' AS label, COUNT(*) AS count
  FROM m_note WHERE note LIKE 'IvyTek SQL history import:%';
