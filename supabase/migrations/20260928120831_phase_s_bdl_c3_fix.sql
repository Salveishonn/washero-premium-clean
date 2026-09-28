-- Ledger reconciliation shim.
-- Production version 20260928120831 replaced a malformed scratch chunk used
-- only for whatsapp-tools bundle assembly.
-- Scratch chunk DML is not portable schema state and must not replay.
select 1;
