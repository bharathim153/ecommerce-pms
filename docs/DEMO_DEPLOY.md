# Public demo: Vercel (website) + Railway (API, MySQL, queue worker)

Vercel hosts only the Next.js website. The Laravel API needs PHP, MySQL, a long-running queue worker, Chromium and poppler, which Vercel/Netlify cannot run, so it goes in a container on Railway (Render/Fly/any Docker host work the same way). Total time ≈ 20 minutes.

> **Status:** the container files (`backend/Dockerfile`, `backend/docker/*`) were written but **not built or run by the author** — Docker was not usable on the development machine. Expect to read the first build log once. Everything *inside* the image (migrations, queue worker, PDF/Chrome, proxy/HTTPS handling) was tested separately on the host.

## What depends on what (do it in this order)

```
1. Railway: MySQL + API  ──►  gives you  https://<api>.up.railway.app
2. Vercel:  website      ──►  needs NEXT_PUBLIC_API_URL = the API URL,  gives you  https://<site>.vercel.app
3. Railway: set FRONTEND_URL = the Vercel URL and redeploy the API   (CORS + email links + Stripe return URLs)
4. Stripe / PayPal webhooks  ──►  point at https://<api>.up.railway.app/api/webhooks/...
```

## 1. API on Railway

1. railway.com → **New Project → Deploy from GitHub repo** (push this repo first), then in the service **Settings → Root Directory = `backend`**. Railway detects the `Dockerfile`.
2. In the same project **+ New → Database → MySQL**.
3. **Volume:** service → *Volumes* → mount at **`/var/www/html/storage/app`**. Without it, product images and generated PDFs disappear on every redeploy.
4. **Variables** on the API service (Railway lets you reference the database as `${{MySQL.…}}`):

| Variable | Value |
|---|---|
| `APP_KEY` | output of `php artisan key:generate --show` run locally (a **new** key, not your dev key) |
| `APP_URL` | `https://<api>.up.railway.app` (after Railway generates the domain: *Settings → Networking → Generate Domain*) |
| `FRONTEND_URL` | placeholder `https://example.vercel.app` for now; fixed in step 3 |
| `DB_HOST` / `DB_PORT` / `DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD` | `${{MySQL.MYSQLHOST}}` / `${{MySQL.MYSQLPORT}}` / `${{MySQL.MYSQLDATABASE}}` / `${{MySQL.MYSQLUSER}}` / `${{MySQL.MYSQLPASSWORD}}` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | your real admin address and a **12+ character** password. The production seeder refuses `@example.com` and default passwords |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | test keys are fine for a demo (or set them later in *Admin → Payment settings*) |
| `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | sandbox credentials |
| `MAIL_MAILER` + provider settings | see "Email" below |
| `CAMPAIGN_FOOTER_ADDRESS` | a postal address for the email footer |

   Already defaulted in the image: `APP_ENV=production`, `APP_DEBUG=false`, `TRUSTED_PROXIES=*`, `PDF_CHROME_PATH=/usr/bin/chromium`, logs to stderr, `PORT` (set by Railway).
5. Deploy. The entrypoint refuses to start if a required variable is missing and says which. It waits for MySQL, runs `migrate --force` and `db:seed --force` (creates roles, categories and your admin; never resets an existing admin), starts nginx, PHP-FPM and the queue worker.
6. Check: `curl https://<api>.up.railway.app/up` → 200, and `curl -s https://<api>.up.railway.app/api/categories` → JSON with the 4 seeded categories.

## 2. Website on Vercel

1. vercel.com → **Add New Project** → import the repo → **Root Directory = `frontend`** (framework: Next.js, Node 22).
2. **Environment Variables** (Production):
   - `NEXT_PUBLIC_API_URL` = `https://<api>.up.railway.app/api`  ← **baked in at build time**; it also becomes the CSP `connect-src`
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = your `pk_test_…`
3. Deploy. Note the URL, e.g. `https://my-demo.vercel.app`.

CLI alternative: `cd frontend && npx vercel login && npx vercel --prod` (then `vercel env add NEXT_PUBLIC_API_URL production` and redeploy so the build picks it up).

## 3. Tell the API where the website is

Set **`FRONTEND_URL=https://my-demo.vercel.app`** (exact origin, no trailing slash, no path) on the Railway service and redeploy. Until you do, the browser blocks every API call (CORS) and email links point nowhere. If you later add a custom domain, update it again.

## 4. Webhooks (so paid orders flip to *paid* even if the customer closes the tab)

- **Stripe** → Developers → Webhooks → endpoint `https://<api>.up.railway.app/api/webhooks/stripe`, events `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`; paste the signing secret into `STRIPE_WEBHOOK_SECRET`.
- **PayPal** → sandbox app → Webhooks → `https://<api>.up.railway.app/api/webhooks/paypal`, events `PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED`; put the Webhook ID in `PAYPAL_WEBHOOK_ID`.

## Email (read this — checkout depends on it)

Customers must **verify their email before they can check out**, and verification links and one-time codes are sent by email.
- **Private demo, quickest:** leave `MAIL_MAILER=log`. Mail is written to the Railway logs; open the service logs, find the "Verify email" link and open it. Works, but only you can use it.
- **Shareable demo:** use a real provider. Easiest: Brevo, Resend, Mailtrap or Gmail with an app password over SMTP:
  `MAIL_MAILER=smtp`, `MAIL_HOST`, `MAIL_PORT=587`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS` (an address your provider has verified).
  Mailgun gives delivered/bounced tracking (see DEPLOYMENT.md §7).

## Demo logins

Production mode does **not** create the demo accounts. Sign in with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`; register a customer through the site (and verify via the email step above). If you want a throwaway customer for the demo, register one normally, then use it for test purchases.

## Smoke test after deploying

1. Open the Vercel URL: home page lists categories; no CORS errors in the browser console.
2. Sign in as admin → dashboard loads. Create a product with an image (verifies the volume + `/storage` serving), set it *Published*.
3. Register a customer, verify, add the product to the cart, pay with Stripe card `4242 4242 4242 4242` → order becomes *paid*.
4. Admin → Products → tick items → **Export to PDF** → finishes and downloads (verifies Chromium + the worker inside the container).
5. Email → create a subscriber (yourself) → a campaign → **Send Campaign** (verifies the queue worker + mail).

## Costs and limits to know about

- Railway's free/trial tier sleeps or caps resources; PDF exports of ~1,400 pages need a few hundred MB RAM while Chromium runs (use ≥1 GB for the demo).
- The queue worker shares the container with the web server for the demo. For real traffic, run a second service from the same image with the start command `php artisan queue:work --timeout=7200` and remove the `[program:queue]` block (see `deploy/supervisor.conf.example`).
- Uploads and PDFs live on the volume only; back them up or treat the demo as disposable.
