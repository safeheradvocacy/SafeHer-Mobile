#!/usr/bin/env bash
# =============================================================================
# SafeSpace security assessment — evidence capture
#
# Re-runs every non-destructive live test from the assessment and writes
# timestamped output to evidence/. Produces the "scan reports" half of the
# submission's supporting evidence.
#
# SAFETY: read-only. No records are created, modified or deleted. No
# authenticated session is used. No real survivor data is touched.
#
# The Supabase publishable key is redacted from all saved output. It is a
# public client key by design, but there is no reason to commit it.
#
# Usage:   bash capture-evidence.sh
# =============================================================================
set -uo pipefail

HOST="safespace-administrative.vercel.app"
REDIRECT_HOST="safe-her-mobile.vercel.app"
SUPA="https://qhhcqehgwpzeycejgevk.supabase.co"
OUT="$(cd "$(dirname "$0")" && pwd)/evidence"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$OUT"

hdr() {
  echo "============================================================"
  echo "SafeSpace security assessment — evidence capture"
  echo "Test     : $1"
  echo "Target   : $2"
  echo "Captured : $STAMP (UTC)"
  echo "Method   : non-destructive, unauthenticated"
  echo "============================================================"
  echo
}

# Pull the publishable key from the live bundle so the script is self-contained.
# Never printed; used only as a request header, and redacted from all output.
BUNDLE_PATH=$(curl -sS --max-time 60 "https://$HOST/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
KEY=$(curl -sS --max-time 120 "https://$HOST$BUNDLE_PATH" | grep -oE 'sb_publishable_[A-Za-z0-9_-]{20,}' | head -1)
redact() { sed -E "s/sb_publishable_[A-Za-z0-9_-]+/sb_publishable_<REDACTED>/g; s/AIza[0-9A-Za-z_-]{30,}/AIza<REDACTED>/g"; }

if [ -z "${KEY:-}" ]; then
  echo "ERROR: could not extract the publishable key from the live bundle." >&2
  echo "The deployment may have changed. Evidence 03 and 04 will be skipped." >&2
fi

# -----------------------------------------------------------------------------
echo "[1/6] HTTP security headers..."
{
  hdr "HTTP security header inspection" "https://$HOST"
  echo "--- Canonical host redirect chain -------------------------------"
  curl -sSI -L --max-time 30 "https://$REDIRECT_HOST" 2>&1
  echo
  echo "--- Header presence summary -------------------------------------"
  H=$(curl -sSI --max-time 30 "https://$HOST/" 2>/dev/null)
  for h in Strict-Transport-Security Content-Security-Policy X-Frame-Options \
           X-Content-Type-Options Referrer-Policy Permissions-Policy; do
    if echo "$H" | grep -qi "^$h:"; then
      printf '  %-28s PRESENT  %s\n' "$h" "$(echo "$H" | grep -i "^$h:" | cut -d: -f2- | tr -d '\r' | sed 's/^ *//')"
    else
      printf '  %-28s ABSENT\n' "$h"
    fi
  done
  echo
  echo "--- Source map exposure check -----------------------------------"
  MAP=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "https://$HOST$BUNDLE_PATH.map")
  echo "  $BUNDLE_PATH.map -> HTTP $MAP   (403/404 = not exposed, expected)"
} 2>&1 | redact > "$OUT/01-http-security-headers.txt"

# -----------------------------------------------------------------------------
echo "[2/6] TLS configuration..."
{
  hdr "TLS protocol and certificate inspection" "$HOST:443"
  echo "--- Protocol support --------------------------------------------"
  for p in tls1 tls1_1 tls1_2 tls1_3; do
    if echo | timeout 15 openssl s_client -connect "$HOST:443" -servername "$HOST" "-$p" 2>/dev/null | grep -q "BEGIN CERTIFICATE"; then
      printf '  %-10s SUPPORTED\n' "$p"
    else
      printf '  %-10s rejected\n' "$p"
    fi
  done
  echo
  echo "--- Negotiated connection ---------------------------------------"
  echo | timeout 20 openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null \
    | grep -E '^\s*(Protocol|Cipher|Verification|Verify return code)'
  echo
  echo "--- Certificate -------------------------------------------------"
  echo | timeout 20 openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null \
    | openssl x509 -noout -issuer -subject -dates -ext subjectAltName 2>/dev/null
} 2>&1 | redact > "$OUT/02-tls-configuration.txt"

# -----------------------------------------------------------------------------
echo "[3/6] Edge Function authentication..."
if [ -n "${KEY:-}" ]; then
{
  hdr "Edge Function unauthenticated negative tests" "$SUPA/functions/v1/*"
  echo "Four request shapes per function. None should execute privileged logic."
  echo
  printf '%-26s %-8s %-12s %-8s %-12s\n' FUNCTION noAuth apikeyOnly badJWT keyAsBearer
  for fn in admin-user-metadata backup-create backup-restore create-admin-user \
            safeher-chatbot security-passcode send-push-notification; do
    a=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 -X POST "$SUPA/functions/v1/$fn" -H 'Content-Type: application/json' -d '{}')
    b=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 -X POST "$SUPA/functions/v1/$fn" -H "apikey: $KEY" -H 'Content-Type: application/json' -d '{}')
    c=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 -X POST "$SUPA/functions/v1/$fn" -H "apikey: $KEY" -H 'Authorization: Bearer not.a.real.token' -H 'Content-Type: application/json' -d '{}')
    d=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 -X POST "$SUPA/functions/v1/$fn" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{}')
    printf '%-26s %-8s %-12s %-8s %-12s\n' "$fn" "$a" "$b" "$c" "$d"
  done
  echo
  echo "--- Token validation proof (create-admin-user) ------------------"
  echo -n "  response: "
  curl -sS --max-time 25 -X POST "$SUPA/functions/v1/create-admin-user" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{}'
  echo
  echo
  echo "--- F-11: pre-auth action enumeration (backup-create) -----------"
  for act in validate download bogusaction anotherfake; do
    printf '  action=%-14s -> ' "$act"
    curl -sS --max-time 25 -X POST "$SUPA/functions/v1/backup-create" \
      -H "apikey: $KEY" -H 'Content-Type: application/json' \
      -d "{\"action\":\"$act\"}" -w ' [HTTP %{http_code}]\n'
  done
} 2>&1 | redact > "$OUT/03-edge-function-auth.txt"
fi

# -----------------------------------------------------------------------------
echo "[4/6] Unauthenticated table access..."
if [ -n "${KEY:-}" ]; then
{
  hdr "Unauthenticated REST read test — all 35 tables" "$SUPA/rest/v1/*"
  echo "Anon API key only. No user session. HTTP 200/206 with rows = exposed."
  echo
  printf '%-28s %-7s %s\n' TABLE HTTP RESULT
  for t in announcements audit_logs backup_schedule barangay_action_requests barangays \
           case_access_tokens case_assignments case_client_links case_referrals case_reports \
           case_services case_status_history chat_messages chat_sessions evidence \
           expert_support_requests faqs law_enforcement_referrals municipalities notifications \
           profile_photo_changes protected_access_grants push_tokens saved_reports \
           security_passcodes shelter_referrals shelter_requests shelters sos_alerts survivors \
           system_backups system_restores terms_acceptances user_profiles user_verifications; do
    r=$(curl -sS -w '\n%{http_code}' --max-time 20 "$SUPA/rest/v1/$t?select=*&limit=1" -H "apikey: $KEY" 2>/dev/null)
    code=$(echo "$r" | tail -1); body=$(echo "$r" | sed '$d')
    if { [ "$code" = "200" ] || [ "$code" = "206" ]; } && [ "$body" != "[]" ]; then
      res="DATA RETURNED"
    elif [ "$code" = "200" ] || [ "$code" = "206" ]; then
      res="empty"
    else
      res="denied"
    fi
    printf '%-28s %-7s %s\n' "$t" "$code" "$res"
  done
  echo
  echo "--- Denial mechanism (case_reports) -----------------------------"
  curl -sS --max-time 20 "$SUPA/rest/v1/case_reports?select=*&limit=1" -H "apikey: $KEY"
  echo
  echo
  echo "--- Scope of permitted public reads -----------------------------"
  echo -n "  municipalities total rows: "
  curl -sS -D - -o /dev/null --max-time 20 "$SUPA/rest/v1/municipalities?select=*" \
    -H "apikey: $KEY" -H 'Range: 0-0' -H 'Prefer: count=exact' 2>/dev/null \
    | grep -i '^content-range' | tr -d '\r'
  echo -n "  barangays total rows     : "
  curl -sS -D - -o /dev/null --max-time 20 "$SUPA/rest/v1/barangays?select=*" \
    -H "apikey: $KEY" -H 'Range: 0-0' -H 'Prefer: count=exact' 2>/dev/null \
    | grep -i '^content-range' | tr -d '\r'
} 2>&1 | redact > "$OUT/04-unauthenticated-table-access.txt"
fi

# -----------------------------------------------------------------------------
echo "[5/6] Dependency audit..."
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
{
  hdr "Dependency vulnerability audit" "admin/ and mobile/ package manifests"
  for proj in admin mobile; do
    echo "################ $proj — FULL DEPENDENCY TREE ################"
    (cd "$ROOT/$proj" && npm audit 2>&1 | tail -25)
    echo
    echo "################ $proj — PRODUCTION TREE ONLY ################"
    (cd "$ROOT/$proj" && npm audit --omit=dev 2>&1 | tail -12)
    echo
  done
} 2>&1 | redact > "$OUT/05-dependency-audit.txt"

# -----------------------------------------------------------------------------
echo "[6/6] Static source checks..."
{
  hdr "Static source and schema checks" "repository source tree"
  echo "--- RLS enablement vs table definitions (migration files) -------"
  cd "$ROOT/supabase"
  grep -hoE 'create table if not exists public\.[a-z_]+' ./*.sql | sed 's/create table if not exists public\.//' | sort -u > /tmp/_t.txt
  grep -hoE 'alter table public\.[a-z_]+ enable row level security' ./*.sql | sed -E 's/alter table public\.([a-z_]+).*/\1/' | sort -u > /tmp/_r.txt
  echo "  tables defined        : $(wc -l < /tmp/_t.txt)"
  echo "  tables with RLS enable: $(wc -l < /tmp/_r.txt)"
  echo "  defined WITHOUT RLS   : $(comm -23 /tmp/_t.txt /tmp/_r.txt | wc -l)"
  comm -23 /tmp/_t.txt /tmp/_r.txt | sed 's/^/     /'
  echo
  echo "--- Service-role key references in client source ----------------"
  cd "$ROOT"
  n=$(grep -rniE 'service_role|SUPABASE_SERVICE_ROLE_KEY' admin/src mobile/src 2>/dev/null | wc -l)
  echo "  occurrences in admin/src + mobile/src: $n   (expected 0)"
  echo "  Edge Functions using it (expected, server-side):"
  grep -rl 'SERVICE_ROLE' supabase/functions --include=*.ts 2>/dev/null | sed 's/^/     /'
  echo
  echo "--- Hardcoded secret patterns in source -------------------------"
  m=$(grep -rniE 'AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{20,}|-----BEGIN (RSA|PRIVATE|OPENSSH) PRIVATE KEY-----' \
      --include=*.ts --include=*.tsx --include=*.js --include=*.json --include=*.sql \
      admin/src mobile/src supabase 2>/dev/null | wc -l)
  echo "  matches: $m   (expected 0)"
  echo
  echo "--- Dangerous constructs ----------------------------------------"
  d=$(grep -rn 'dangerouslySetInnerHTML\|eval(\|new Function(' admin/src mobile/src 2>/dev/null | grep -v '^\s*\*' | wc -l)
  echo "  dangerouslySetInnerHTML / eval / new Function: $d"
  grep -rn 'dangerouslySetInnerHTML\|eval(\|new Function(' admin/src mobile/src 2>/dev/null | sed 's/^/     /' | head -5
} 2>&1 | redact > "$OUT/06-static-source-checks.txt"

# -----------------------------------------------------------------------------
echo
echo "Evidence written to: $OUT"
ls -1 "$OUT" | sed 's/^/  /'
echo
echo "All captures are read-only. No records were created, modified or deleted."
