# Product Management & E-Commerce System

A full-stack web application: **Next.js 16** (React 19, TypeScript, Tailwind 4) storefront and admin console on a **Laravel 13** REST API with **MySQL**, background queues, Stripe + PayPal payments, large server-side PDF export and bulk email campaigns.

| | |
|---|---|
| **Customers** | browse products (rich text, tables, images) · cart · pay by card (Stripe) or PayPal · order history · profile, password, optional email-OTP two-step sign-in · email preferences |
| **Admins** | dashboard (KPIs, charts, payment/PDF/campaign stats) · product management with a TipTap rich-text editor · categories · orders · payment settings · **PDF export of selected/all products (1,000+ pages, queued)** · email templates, subscribers and **Send Campaign** to thousands of opted-in customers |
| **Security** | role-based access, expiring tokens, brute-force lockout, signed webhooks, server-side sanitising, CSP — see [docs/SECURITY.md](docs/SECURITY.md) |

## Quick start (development)

Requirements: PHP 8.3 (+ mbstring, xml, curl, zip, gd, pdo_mysql), Composer, Node 22, MySQL 8, Google Chrome/Chromium and `poppler-utils` (PDF export).

```bash
# 1. database
sudo mysql -e "CREATE DATABASE ecommerce_pms CHARACTER SET utf8mb4; CREATE USER 'pms'@'localhost' IDENTIFIED BY 'choose-a-password'; GRANT ALL ON ecommerce_pms.* TO 'pms'@'localhost';"

# 2. backend (API on :8000)
cd backend
composer install
cp .env.example .env            # set DB_PASSWORD; leave the rest for now
php artisan key:generate
php artisan migrate --seed      # tables + roles, categories, demo admin and customer
php artisan storage:link
php artisan serve               # terminal 1
php artisan queue:work          # terminal 2 - REQUIRED for PDF exports and email campaigns

# 3. frontend (site on :3000)
cd ../frontend
npm install
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:8000/api
npm run dev                     # terminal 3
```

Open <http://localhost:3000>. Demo logins (created by the seeder in non-production only): `admin@example.com` / `Admin@12345` and `customer@example.com` / `Customer@12345`.

With the default `MAIL_MAILER=log`, emails (verification links, OTP codes, campaigns) are written to `backend/storage/logs/laravel.log`.

### Turning on payments and email
Add **Stripe test keys** and **PayPal sandbox** credentials in `backend/.env` or in *Admin → Payment settings*, and a mail provider (Mailgun/SES) for real delivery. Step by step: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-payment-providers).

### Try the big PDF export
```bash
php artisan pms:demo-products 280     # ~1,400 pages of demo data (with tables and images)
# Admin → Products → "Export all to PDF" → PDF exports page → Download   (~20 s here)
php artisan pms:demo-products 0 --purge
```

## Documentation

| | |
|---|---|
| [docs/API.md](docs/API.md) | every REST endpoint (kept in sync with the routes by a test) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | server setup, env, nginx/Supervisor, Stripe/PayPal/Mailgun/SES, operations, troubleshooting |
| [docs/SECURITY.md](docs/SECURITY.md) | controls and evidence, known limitations, go-live checklist |
| [docs/DEMO_DEPLOY.md](docs/DEMO_DEPLOY.md) | **public demo in ~20 min: Vercel (site) + Railway (API/MySQL/worker)** |
| [docs/TESTING.md](docs/TESTING.md) | running the 61 backend tests and 6 browser suites, manual smoke test |
| `deploy/`, `backend/Dockerfile` | nginx + Supervisor templates; production container image for the API |

## Architecture

```
backend/                     Laravel API (stateless, bearer tokens via Sanctum)
  app/Http/Controllers/Api/       thin controllers (Admin/ subfolder = admin-only)
  app/Services/                   Payments/ (Stripe, PayPal, settings, idempotent order state)
                                  Pdf/ (Chrome renderer, HTML builder, image resolver)
                                  Campaigns/ (renderer, sender)   HtmlSanitizer
  app/Jobs/                       ProcessPdfExport, SendCampaignChunk
  database/migrations, seeders    14 required tables + settings, webhook_events
  routes/api.php                  all routes; tests/ = 61 PHPUnit tests
frontend/                    Next.js App Router
  src/app/(shop)                  storefront, cart, checkout, account
  src/app/(auth)                  login, register, password reset
  src/app/admin                   admin console (client-guarded; the API enforces roles)
  src/components, context, lib    UI, auth/cart/toast providers, API client, charts
e2e/                         Playwright browser suites + run-all.sh
docs/  deploy/               documentation and deployment templates
```

**How the heavy parts work**
- **PDF:** a queued job renders products in chunks of 20 to separate PDFs with headless Chrome (continuous page numbers via a CSS counter offset), then joins them with `pdfunite`. Memory stays flat (~60 MB worker); a crashed job resumes from finished chunks; progress is polled by the UI. Measured: 280 products → 1,401 pages, 10 MB, ~20 s.
- **Payments:** the server prices the order; the customer is redirected to Stripe Checkout or PayPal; the order becomes *paid* only via signature-verified webhooks or a server-to-gateway re-read, with amount/currency checks and idempotency at every step.
- **Campaigns:** *Send Campaign* atomically moves a draft to *sending* (once), creates one log row per eligible subscriber, and queues batches of 25 behind a shared rate limit. Each recipient is claimed with an atomic update, so retries and duplicate jobs can't double-send; opt-outs made after queueing are honoured. Measured: 3,000 recipients, two workers, 0 duplicates.

## Status

All ten build phases are complete: scaffold → schema → auth API → frontend foundation → products & editor → PDF export → payments → email campaigns → dashboard & customer area → security review, tests and docs.

**Verified:** 61 PHPUnit tests (392 assertions) and 6 Playwright suites, plus `composer audit` / `npm audit --omit=dev` clean.
**Not verified (needs your credentials):** live Stripe, PayPal and Mailgun/SES calls — the integrations are tested with signed local webhooks and faked HTTP. Do one real sandbox purchase and one real campaign send before launch ([docs/TESTING.md](docs/TESTING.md#what-is-not-covered)).

## Known limitations
No dark mode · tokens live in `localStorage` (mitigated by CSP/sanitising) · delivered/bounced tracking is Mailgun-only · admin MFA is optional · no audit log. Full list with recommendations: [docs/SECURITY.md](docs/SECURITY.md#known-limitations-and-recommendations).
