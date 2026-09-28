-- Ledger reconciliation shim.
-- Production version 20260928121336 dropped private.washero_bundle_upload_chunks
-- after chunk assembly. That table was operational scratch state only.
-- The durable desired state is absence; replaying CREATE then DROP is unnecessary.
select 1;
