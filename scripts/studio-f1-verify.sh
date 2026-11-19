#!/usr/bin/env bash
# Applies the AI Studio F1 migration + checks inside ONE transaction and rolls it back.
# Usage: scripts/studio-f1-verify.sh [project-ref]
set -euo pipefail
REF="${1:-domslcbxgqbylmciqrxt}"
OUT="$(mktemp -d)/studio_f1_verify_combined.sql"
{ echo "begin;"; cat supabase/migrations/20261118200000_ai_studio_foundation.sql; echo;
  cat supabase/tests/studio_f1_verify.sql; echo; echo "select 'STUDIO F1 VERIFY: ALL CHECKS PASSED' as result, (select count(*) from public.admin_users where active and role = 'operator') as operators_tested;"; echo "rollback;"; } > "$OUT"
npx --yes supabase db query --remote="$REF" -f "$OUT" --yes
