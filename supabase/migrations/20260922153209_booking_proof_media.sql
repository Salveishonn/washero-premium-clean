-- Booking wash-proof media (Phase 4A).
--
-- Private evidence store for operational completion photos.
-- Uploads go through operator-upload-booking-proof (service_role).
-- This migration does NOT change booking_status, booking_operations.phase,
-- or complete_wash. Proof is not yet mandatory.
--
-- ROLLBACK:
--   drop table if exists public.booking_proof_media;
--   delete from storage.buckets where id = 'booking-proofs';

-- ---------------------------------------------------------------------------
-- 1. Private storage bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'booking-proofs',
  'booking-proofs',
  false,
  8388608,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No storage.objects policies: browser clients do not read or write this bucket.
-- Service role used by operator-upload-booking-proof bypasses storage RLS.

-- ---------------------------------------------------------------------------
-- 2. booking_proof_media
-- ---------------------------------------------------------------------------
CREATE TABLE public.booking_proof_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  booking_id uuid NOT NULL
    -- Metadata cascade only. Deleting a booking does not remove Storage objects.
    REFERENCES public.bookings(id) ON DELETE CASCADE,

  uploaded_by_staff_id uuid NOT NULL
    REFERENCES public.admin_users(id) ON DELETE RESTRICT,

  proof_kind text NOT NULL,

  storage_bucket text NOT NULL,
  storage_path text NOT NULL,

  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,

  content_sha256 text NOT NULL,

  client_upload_id text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_proof_media_kind_check
    CHECK (proof_kind IN ('completion', 'before', 'incident')),
  CONSTRAINT booking_proof_media_size_check
    CHECK (size_bytes > 0),
  CONSTRAINT booking_proof_media_bucket_check
    CHECK (length(trim(storage_bucket)) > 0),
  CONSTRAINT booking_proof_media_path_check
    CHECK (length(trim(storage_path)) > 0),
  CONSTRAINT booking_proof_media_mime_check
    CHECK (length(trim(mime_type)) > 0),
  CONSTRAINT booking_proof_media_sha256_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT booking_proof_media_client_upload_id_check
    CHECK (
      length(trim(client_upload_id)) > 0
      AND length(client_upload_id) <= 200
    ),
  CONSTRAINT booking_proof_media_storage_path_key
    UNIQUE (storage_bucket, storage_path),
  CONSTRAINT booking_proof_media_client_upload_key
    UNIQUE (booking_id, client_upload_id)
  -- Intentionally no unique constraint on booking + proof kind: retakes/multiple
  -- evidence images use distinct client_upload_id values. Phase 4B selects qualifying proofs.
);

CREATE INDEX booking_proof_media_booking_created_idx
  ON public.booking_proof_media (booking_id, created_at DESC);

CREATE INDEX booking_proof_media_booking_kind_created_idx
  ON public.booking_proof_media (booking_id, proof_kind, created_at DESC);

COMMENT ON TABLE public.booking_proof_media IS
  'Operational wash-proof metadata. Files live in the private booking-proofs bucket. Multiple completion rows per booking are allowed; Phase 4B decides which qualify. ON DELETE CASCADE removes metadata only — storage objects are not auto-deleted.';

-- ---------------------------------------------------------------------------
-- 3. RLS + grants
-- No anon access. No authenticated SELECT/INSERT/UPDATE/DELETE.
-- Operator PWA does not query this table; reads will go through backend APIs.
-- service_role bypasses RLS for Edge Function writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.booking_proof_media ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_proof_media FROM PUBLIC;
REVOKE ALL ON TABLE public.booking_proof_media FROM anon;
REVOKE ALL ON TABLE public.booking_proof_media FROM authenticated;
GRANT ALL ON TABLE public.booking_proof_media TO service_role;
