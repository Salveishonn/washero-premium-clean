-- Ledger reconciliation shim.
-- Production version 20260927211749 inserted a synthetic Phase S healthcheck
-- booking that was later deleted through admin-delete-booking.
-- Replaying it would create fake business data.
select 1;
