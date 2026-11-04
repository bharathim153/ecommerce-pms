#!/usr/bin/env bash
# Runs every browser suite against a RUNNING stack, resetting data between suites.
#
#   prerequisites: MySQL up and migrated+seeded, API on :8000 (php artisan serve), frontend on :3000,
#                  Google Chrome/Chromium, poppler-utils, and `npm install` run inside e2e/.
#   WARNING: this deletes products, orders, campaigns, subscribers and exports from the database it points at.
#            Run it against a development database, never production.
#
#   env: DB_USER (pms) DB_PASS DB_NAME (ecommerce_pms) DB_HOST CHROME_PATH WEB_URL API_URL E2E_OUT
set -u
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"; BACK="$ROOT/backend"
export DB_USER="${DB_USER:-pms}" DB_NAME="${DB_NAME:-ecommerce_pms}" DB_HOST="${DB_HOST:-127.0.0.1}" DB_PASS="${DB_PASS:-}"
export E2E_OUT="${E2E_OUT:-$(mktemp -d)}"
MYSQL=(mysql -h"$DB_HOST" -u"$DB_USER" ${DB_PASS:+-p"$DB_PASS"} "$DB_NAME")
sql() { "${MYSQL[@]}" "$@" 2>/dev/null; }

reset() {
  sql -e "DELETE FROM webhook_events; DELETE FROM payments; DELETE FROM order_items; DELETE FROM product_orders;
          DELETE FROM product_images; DELETE FROM products; DELETE FROM pdf_exports;
          DELETE FROM email_campaign_logs; DELETE FROM email_campaigns; DELETE FROM email_templates; DELETE FROM email_subscribers;
          DELETE FROM settings; DELETE FROM jobs; DELETE FROM job_batches; DELETE FROM failed_jobs; DELETE FROM personal_access_tokens;
          DELETE FROM users WHERE email LIKE '%@e2e.test';
          UPDATE users SET name='Demo Customer', phone=NULL WHERE email='customer@example.com';"
  (cd "$BACK" && php artisan cache:clear >/dev/null 2>&1)
}
stop_worker() { pkill -f "artisan queue:work" 2>/dev/null; sleep 1; }
start_worker() { stop_worker; (cd "$BACK" && MAIL_MAILER="${1:-log}" nohup php artisan queue:work --sleep=1 --timeout=7200 >"$E2E_OUT/worker.log" 2>&1 &); sleep 2; }

declare -a RESULTS; FAILED=0
run() {  # run <label> <script> [worker-mailer] [seed-command]   (seed runs AFTER the reset)
  local label="$1" script="$2"; reset; [ -n "${4:-}" ] && eval "$4"
  [ -n "${3:-}" ] && start_worker "$3" || stop_worker
  echo "=== $label"
  local out; out="$(timeout 600 node "$script" "$E2E_OUT" 2>&1)"; local code=$?
  echo "$out" | grep -E "^(PASS|FAIL)" | sed 's/^/   /'
  if echo "$out" | grep -q "ALL PASSED" && [ $code -eq 0 ]; then RESULTS+=("PASS  $label"); else RESULTS+=("FAIL  $label"); FAILED=1; echo "$out" | tail -15; fi
}

run "01 products + rich-text editor"        01-products.mjs
run "02 large PDF export (queued)"          02-pdf-export.mjs  log  "(cd \"$BACK\" && php artisan pms:demo-products 20 --purge >/dev/null 2>&1)"
(cd "$BACK" && php artisan pms:demo-products 0 --purge >/dev/null 2>&1)
run "03 payments (Stripe/PayPal flows)"     03-payments.mjs
run "04 email campaigns (queued, bulk)"     04-email-campaigns.mjs array
reset; sql < fixtures/seed-dashboard.sql
echo "=== 05 dashboard + customer account"
out="$(timeout 600 node 05-dashboard-and-account.mjs "$E2E_OUT" 2>&1)"; echo "$out" | grep -E "^(PASS|FAIL)" | sed 's/^/   /'
if echo "$out" | grep -q "ALL PASSED"; then RESULTS+=("PASS  05 dashboard + customer account"); else RESULTS+=("FAIL  05 dashboard + customer account"); FAILED=1; echo "$out" | tail -15; fi

if curl -sI "${WEB_URL:-http://localhost:3000}/login" | grep -qi "content-security-policy"; then
  run "06 production CSP smoke" 06-csp-production.mjs
else
  RESULTS+=("SKIP  06 production CSP smoke (start the frontend with 'npm run build && npm start' to include it)")
fi

stop_worker; reset
echo; echo "================ SUMMARY"; printf '%s\n' "${RESULTS[@]}"
exit $FAILED
