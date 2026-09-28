-- Ledger reconciliation shim.
-- Production version 20260928120612 appended one operational gzip/base64 chunk
-- into private.washero_bundle_upload_chunks during whatsapp-tools assembly.
-- Scratch chunk DML is not portable schema state and must not replay.
select 1;
