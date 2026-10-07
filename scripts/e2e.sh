#!/usr/bin/env bash
# Drives the TypeScript SDK, the CLI and the Python SDK against the real API
# code (apps/api/scripts/local-api.mts: local Mongo, local Redis db 9).
# Monorepo only. Build the TypeScript package first (cd typescript && npm run build).
#
#   devkit/scripts/e2e.sh          everything but a real upload
#   devkit/scripts/e2e.sh --r2     also uploads a 1×1 PNG to the real R2 bucket
set -euo pipefail
# grep without -q, and commands expected to fail captured first: pipefail would
# read an early-closed pipe or their exit code as the check failing

DEVKIT="$(cd "$(dirname "$0")/.." && pwd)"
API="$DEVKIT/../apps/api"
export LOCAL_API_INFO="$(mktemp -d)/local-api.json"
R2=""
if [[ "${1:-}" == "--r2" ]]; then R2="--r2"; export E2E_R2=1; fi

(cd "$API" && exec npx tsx scripts/local-api.mts --port 4893 $R2) > "$LOCAL_API_INFO.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; rm -rf "${XDG_CONFIG_HOME:-/nonexistent-dir}"' EXIT
for _ in $(seq 1 60); do [[ -s "$LOCAL_API_INFO" ]] && break; sleep 0.5; done
[[ -s "$LOCAL_API_INFO" ]] || { cat "$LOCAL_API_INFO.log"; exit 1; }

URL=$(node -p "require('$LOCAL_API_INFO').url")
KEY=$(node -p "require('$LOCAL_API_INFO').apiKey")
FAILED=0
ok() { echo "ok   $1"; }
ko() { echo "FAIL $1"; FAILED=1; }

echo "── TypeScript SDK"
if node --test --test-reporter=tap "$DEVKIT/typescript/test/e2e.mjs" > "$LOCAL_API_INFO.ts" 2>&1; then
  ok "TypeScript SDK suite ($(grep -c '^ok' "$LOCAL_API_INFO.ts") tests, $(grep -c '# SKIP' "$LOCAL_API_INFO.ts") skipped)"
else
  cat "$LOCAL_API_INFO.ts"; ko "TypeScript SDK suite"
fi

echo "── CLI"
export XDG_CONFIG_HOME="$(mktemp -d)"
unset BREAKREACH_API_KEY
B=(node "$DEVKIT/typescript/dist/cli.js")
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log(($1)(v))})"; }

echo "$KEY" | "${B[@]}" login --base-url "$URL" > /dev/null && ok "login reads the key from stdin" || ko "login"
[[ "$(stat -f %Lp "$XDG_CONFIG_HOME/breakreach/config.json" 2>/dev/null || stat -c %a "$XDG_CONFIG_HOME/breakreach/config.json")" == "600" ]] && ok "config file is 600" || ko "config file mode"
"${B[@]}" whoami | grep northbeam > /dev/null && ok "whoami lists the workspace" || ko "whoami"
[[ "$("${B[@]}" accounts --json | json 'v=>v.accounts.length')" == "3" ]] && ok "accounts --json" || ko "accounts"
[[ "$("${B[@]}" post "CLI draft" --to x --draft --json | json 'v=>v.post.status')" == "draft" ]] && ok "post --draft" || ko "post --draft"
[[ "$(echo "From stdin" | "${B[@]}" post - --to instagram --draft --json | json 'v=>v.post.accounts[0]')" == "instagram (northbeam.coffee)" ]] && ok "post - reads stdin, --to by platform" || ko "post from stdin"
[[ "$("${B[@]}" post "Named" --to "linkedin:Northbeam Coffee" --draft --at "2026-12-01 10:30" --json | json 'v=>v.post.scheduledAt')" == "2026-12-01T09:30:00.000Z" ]] && ok "--to platform:name, --draft --at in the workspace timezone" || ko "--at"
OUT=$("${B[@]}" post "Twice" --to x --draft --idempotency-key cli-1 --json | json 'v=>v.post.id'); AGAIN=$("${B[@]}" post "Twice" --to x --draft --idempotency-key cli-1 --json | json 'v=>v.post.id')
[[ -n "$OUT" && "$OUT" == "$AGAIN" ]] && ok "--idempotency-key replays" || ko "--idempotency-key"
ID=$("${B[@]}" post "Hello from the CLI" --to x,linkedin --next-slot --json | json 'v=>v.post.status+" "+v.post.id')
[[ "$ID" == scheduled* ]] && ok "post --next-slot on two accounts" || ko "post --next-slot ($ID)"
"${B[@]}" delete "${ID#scheduled }" | grep "won't publish" > /dev/null && ok "delete" || ko "delete"
"${B[@]}" next-slot | grep "Europe/Paris" > /dev/null && ok "next-slot" || ko "next-slot"
"${B[@]}" posts --status draft | grep "CLI draft" > /dev/null && ok "posts --status draft" || ko "posts"
set +e
"${B[@]}" post "No time" --to x > /dev/null 2>&1; [[ $? == 2 ]] && ok "post without a time: usage error" || ko "post without a time"
OUT=$("${B[@]}" post "Nope" --to tiktok --draft 2>&1); grep "No tiktok account" <<< "$OUT" > /dev/null && ok "unknown platform lists the accounts" || ko "unknown platform"
echo hi > "$XDG_CONFIG_HOME/notes.txt"
OUT=$("${B[@]}" upload "$XDG_CONFIG_HOME/notes.txt" 2>&1); grep "Error 400: Unsupported file type .txt" <<< "$OUT" > /dev/null && ok "upload reports the API's error" || ko "upload error"
if [[ -n "$R2" ]]; then
  node -e "require('fs').writeFileSync('$XDG_CONFIG_HOME/pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'))"
  "${B[@]}" upload "$XDG_CONFIG_HOME/pixel.png" | grep "^https://.*\.png$" > /dev/null && ok "upload a photo" || ko "upload a photo"
fi
"${B[@]}" logout > /dev/null; "${B[@]}" accounts > /dev/null 2>&1; [[ $? == 2 ]] && ok "logout forgets the key" || ko "logout"
OUT=$(BREAKREACH_API_KEY=br_wrong BREAKREACH_BASE_URL="$URL" "${B[@]}" accounts 2>&1); grep "Error 401" <<< "$OUT" > /dev/null && ok "bad key: 401 with a login hint" || ko "bad key"
set -e

echo "── Python SDK"
(cd "$DEVKIT/python" && PYTHONPATH=src python3 -m unittest discover -s tests 2>&1 | tail -3) && ok "Python SDK suite" || ko "Python SDK suite"

exit $FAILED
