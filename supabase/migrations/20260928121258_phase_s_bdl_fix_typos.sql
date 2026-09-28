-- Ledger reconciliation shim.
-- Production version 20260928121258 performed a one-off typo repair against
-- concatenated scratch chunks before the whatsapp-tools upsert.
-- Scratch assembly DML is not portable schema state and must not replay.
select 1;
