# Testing

## 1. Backend (PHPUnit) — 61 tests

```bash
cd backend
php artisan test                 # everything
php artisan test --filter=PaymentsTest
```

Covers authentication/OTP/password reset, authorization of every route, payments (Stripe webhook signatures are real HMACs; PayPal HTTP is faked), email campaigns (batching, dedupe, opt-out, Mailgun events), dashboard maths, uploads, headers, token expiry and API-docs/route parity.

> The tests run against the database in `.env` and wrap each test in a transaction that is rolled back, so they leave no data behind. Because the project's dev setup has no SQLite driver we reuse MySQL. **Better:** create a separate schema and point tests at it:
> ```sql
> CREATE DATABASE ecommerce_pms_test; GRANT ALL ON ecommerce_pms_test.* TO 'pms'@'localhost';
> ```
> ```bash
> cp .env .env.testing && sed -i 's/^DB_DATABASE=.*/DB_DATABASE=ecommerce_pms_test/' .env.testing
> php artisan migrate --env=testing --seed && php artisan test
> ```
> (then change `DB_DATABASE` in `phpunit.xml` to match.) The suites need the seeded roles and `admin@example.com` user.

## 2. Frontend static checks

```bash
cd frontend
npx tsc --noEmit        # types
npm run lint
npm run build           # production build must compile
```

## 3. Browser end-to-end (Playwright driving real Chrome)

Six suites in `e2e/` exercise the actual UI against the actual API, database and queue worker:

| Suite | What it proves |
|---|---|
| `01-products` | login redirect, validation, TipTap editor (table, inline image), image upload, preview, search/filter, edit round-trip, delete confirm |
| `02-pdf-export` | selecting products across pages, confirm dialog, background export with progress, download is a real PDF containing exactly the selection |
| `03-payments` | admin payment settings (secrets masked + encrypted), cart → checkout, friendly gateway errors, signed webhook marks order paid (wrong signature rejected), stock decrement, success/failure pages, admin orders |
| `04-email-campaigns` | templates (visual/HTML, sandboxed preview), consent-gated subscriber add/import, export, signup opt-in, **Send Campaign** confirmation, background send, delivery log, public unsubscribe excludes the person from the next campaign |
| `05-dashboard-and-account` | KPI and chart numbers against seeded data (hover, keyboard, table view, range filter), mobile overflow, storefront home, profile/orders/security, other users can't see your order |
| `06-csp-production` | every key page loads under the production CSP with zero violations; the site cannot be framed |

```bash
# prerequisites: MySQL migrated+seeded; API running (php artisan serve); frontend running on :3000;
#                Google Chrome; poppler-utils.  For suite 06 serve the production build:
#                (cd frontend && npm run build && npm start)
cd e2e && npm install
DB_USER=pms DB_PASS=... DB_NAME=ecommerce_pms ./run-all.sh
```

`run-all.sh` **deletes products, orders, campaigns, subscribers and exports** between suites — use a development database. It starts and stops its own queue workers and prints a PASS/FAIL summary. Individual suites can be run with `node 04-email-campaigns.mjs` after resetting data by hand. Useful env vars: `CHROME_PATH`, `WEB_URL`, `API_URL`, `E2E_OUT` (where screenshots/downloads go).

## 4. Manual smoke test (5 minutes)

1. Sign in as `admin@example.com` → dashboard loads; create a product with a table and an image; set status Published.
2. Open `/shop` as a visitor → the product appears; add to cart; checkout asks you to sign in.
3. In **Payment settings** paste Stripe test keys / PayPal sandbox credentials; buy with card `4242 4242 4242 4242`; the order turns *paid* and stock drops. (With `stripe listen --forward-to localhost:8000/api/webhooks/stripe` the webhook path is exercised too.)
4. Products → tick a few → **Export selected to PDF** → PDF exports page shows progress, then Download.
5. Email → Subscribers → add yourself → New campaign → Preview → Send test to me → **Send Campaign**; click the unsubscribe link in the mail and confirm you are excluded from the next send.
6. `php artisan pms:demo-products 280` then **Export all** — a ~1,400-page PDF in under a minute; `php artisan pms:demo-products 0 --purge` removes the demo data.

## What is NOT covered

- Live Stripe/PayPal/Mailgun/SES calls (gateways are faked or signed locally). Do one real sandbox purchase and one real campaign send before launch.
- Load testing beyond the measured 3,000-recipient campaign and 1,401-page PDF.
- Browsers other than Chrome; screen readers (keyboard and ARIA basics are implemented and spot-tested).
