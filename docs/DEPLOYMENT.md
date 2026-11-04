# Deployment guide

A reference deployment on one Ubuntu 24.04 server (nginx + PHP-FPM + MySQL + Node). Everything here is also usable on separate hosts: the only coupling is the API URL, the queue worker's access to the same database and `storage/`, and Chrome for PDFs.

## 1. Requirements

| | Version | Notes |
|---|---|---|
| PHP | 8.3 | extensions: `mbstring xml curl zip gd intl pdo_mysql bcmath` (bcmath/intl are not required today but are standard for Laravel) |
| MySQL | 8.0+ | utf8mb4 |
| Node.js | 22 LTS | for `npm run build` / `npm start` |
| Composer | 2.x | |
| Chrome or Chromium | current | PDF rendering (`PDF_CHROME_PATH`) |
| poppler-utils | any | `pdfunite`, `pdfinfo` (PDF merge + page count) |
| nginx, Supervisor | | process management and TLS termination |

```bash
sudo apt install nginx supervisor mysql-server php8.3-fpm php8.3-{cli,mbstring,xml,curl,zip,gd,intl,mysql,bcmath} \
     poppler-utils composer certbot python3-certbot-nginx
# Chrome (or: sudo apt install chromium and set PDF_CHROME_PATH=chromium)
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo apt install ./google-chrome-stable_current_amd64.deb
# Node 22 via NodeSource or nvm
```

## 2. Database

```sql
CREATE DATABASE ecommerce_pms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pms'@'localhost' IDENTIFIED BY '<long random password>';
GRANT ALL ON ecommerce_pms.* TO 'pms'@'localhost';
```

## 3. Backend

```bash
sudo mkdir -p /var/www/pms && sudo chown $USER /var/www/pms
git clone <your repo> /var/www/pms && cd /var/www/pms/backend
composer install --no-dev --optimize-autoloader
cp .env.example .env && php artisan key:generate     # BACK UP the APP_KEY: stored gateway secrets are encrypted with it
```

Edit `.env` — the important production values (full list: `backend/.env.example`):

```ini
APP_ENV=production
APP_DEBUG=false
APP_URL=https://api.your-domain.com
FRONTEND_URL=https://www.your-domain.com
DB_DATABASE=ecommerce_pms
DB_USERNAME=pms
DB_PASSWORD=...

ADMIN_EMAIL=you@your-company.com          # required: the seeder refuses example/default credentials in production
ADMIN_PASSWORD=...                        # 12+ characters

QUEUE_CONNECTION=database                 # or redis (recommended at higher volume)
DB_QUEUE_RETRY_AFTER=7500                 # must exceed PDF_JOB_TIMEOUT (7200) or long exports run twice
SANCTUM_TOKEN_EXPIRATION=10080

STRIPE_SECRET_KEY=sk_live_...             # or enter in Admin → Payment settings (stored encrypted)
STRIPE_WEBHOOK_SECRET=whsec_...
PAYPAL_MODE=live
PAYPAL_CLIENT_ID=...  PAYPAL_CLIENT_SECRET=...  PAYPAL_WEBHOOK_ID=...

MAIL_MAILER=mailgun                       # see "Email provider"
MAIL_FROM_ADDRESS=no-reply@your-domain.com
CAMPAIGN_FOOTER_ADDRESS="Your Company, 1 Real Street, City, Country"
CAMPAIGN_EMAILS_PER_MINUTE=600            # stay inside your provider's limits; raise gradually while warming up a new domain
PDF_CHROME_PATH=/usr/bin/google-chrome
```

```bash
php artisan migrate --force
php artisan db:seed --force               # creates roles, categories and the admin from ADMIN_EMAIL/ADMIN_PASSWORD
php artisan storage:link
php artisan config:cache && php artisan route:cache && php artisan event:cache
sudo chown -R www-data:www-data storage bootstrap/cache && sudo chmod -R ug+rwX storage bootstrap/cache
```

PHP limits (`/etc/php/8.3/fpm/conf.d/90-pms.ini`): `upload_max_filesize=6M`, `post_max_size=55M`, `max_file_uploads=10`, `memory_limit=256M`.

> After **any** `.env` change run `php artisan config:cache` again and restart the queue workers (`sudo supervisorctl restart pms-queue:*`) — long-running workers keep the old config.

## 4. Frontend

```bash
cd /var/www/pms/frontend
cat > .env.local <<'EOT'
NEXT_PUBLIC_API_URL=https://api.your-domain.com/api
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
EOT
npm ci && npm run build
```

`NEXT_PUBLIC_*` values are baked in **at build time** — rebuild after changing them. The production CSP is derived from `NEXT_PUBLIC_API_URL`, so it must be the real API origin when you build.

## 5. nginx, TLS and processes

```bash
sudo cp /var/www/pms/deploy/nginx.conf.example /etc/nginx/sites-available/pms   # edit the domain names
sudo ln -s /etc/nginx/sites-available/pms /etc/nginx/sites-enabled/ && sudo nginx -t
sudo certbot --nginx -d api.your-domain.com -d your-domain.com -d www.your-domain.com
sudo systemctl reload nginx

sudo cp /var/www/pms/deploy/supervisor.conf.example /etc/supervisor/conf.d/pms.conf
sudo supervisorctl reread && sudo supervisorctl update && sudo supervisorctl status
```

`pms-queue` (2 processes) runs PDF exports and email campaigns; `pms-web` runs `next start`. Add a third queue process if campaigns are large — the send rate limit is shared by all workers, so more workers help only up to `CAMPAIGN_EMAILS_PER_MINUTE`.

## 6. Payment providers

**Stripe** (Dashboard → Developers):
1. API keys → copy the secret key (`sk_live_…`/`sk_test_…`) into `.env` or Payment settings.
2. Webhooks → *Add endpoint* `https://api.your-domain.com/api/webhooks/stripe`, events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. Copy the signing secret (`whsec_…`).
3. Local development: `stripe listen --forward-to localhost:8000/api/webhooks/stripe` prints a temporary `whsec_`. Test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 9995` (declined).

**PayPal** (developer.paypal.com → Apps & Credentials):
1. *Sandbox*: create a Business and a Personal (buyer) sandbox account, create an app, copy Client ID + Secret, set `PAYPAL_MODE=sandbox`. Switch to *Live* credentials and `PAYPAL_MODE=live` at launch.
2. Webhooks → add `https://api.your-domain.com/api/webhooks/paypal` (needs a public HTTPS URL; use ngrok locally) with events `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`; copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID`.

You can enter all of these in **Admin → Payment settings**, which shows which are configured and which source (env or admin) is active.

## 7. Email provider

- **Mailgun (recommended — gives delivered/bounced tracking):** `MAIL_MAILER=mailgun`, `MAILGUN_DOMAIN`, `MAILGUN_SECRET`, `MAILGUN_ENDPOINT` (`api.eu.mailgun.net` for EU). Add the webhook `https://api.your-domain.com/api/webhooks/mailgun` for *Delivered* and *Permanent failure* and *Complained*; put the HTTP webhook signing key in `MAILGUN_WEBHOOK_SIGNING_KEY`.
- **Amazon SES (SMTP):** `MAIL_MAILER=smtp`, `MAIL_HOST=email-smtp.<region>.amazonaws.com`, `MAIL_PORT=587`, `MAIL_SCHEME=tls`-style settings per Laravel docs, `MAIL_USERNAME/PASSWORD` = SES SMTP credentials. You get *sent/failed* only; add SNS → bounce handling before large sends.
- For either: verify the sending domain, configure SPF, DKIM and DMARC, start with low volume, and keep `CAMPAIGN_EMAILS_PER_MINUTE` within the provider's quota.

## 8. Operations

| Task | Command |
|---|---|
| Deploy an update | `git pull && composer install --no-dev -o && php artisan migrate --force && php artisan config:cache route:cache && (cd ../frontend && npm ci && npm run build) && sudo supervisorctl restart pms-queue:* pms-web` |
| See queue health | `php artisan queue:failed`, `tail -f /var/log/pms-queue.log`, Admin → PDF exports / Campaigns |
| Retry a failed job | `php artisan queue:retry all` (PDF exports also have a Retry button) |
| Application logs | `backend/storage/logs/laravel.log` (rotate with logrotate) |
| Backups | nightly `mysqldump ecommerce_pms` + `storage/app` + the `.env`/`APP_KEY` |
| Clean old exports | delete in Admin → PDF exports (files are in `storage/app/private/exports`) |
| Health check | `GET /up` on the API returns 200 |

## 9. Troubleshooting

| Symptom | Likely cause |
|---|---|
| PDF export stuck on *queued* / campaign stuck on *sending* | no queue worker running (`supervisorctl status`), or it started before `.env` changed |
| PDF export *failed*: "Chrome failed to produce a PDF" | wrong `PDF_CHROME_PATH`, or Chrome can't start as `www-data` (try running the command by hand as that user) |
| Images missing in site/PDF | `php artisan storage:link` not run, or nginx `/storage/` location missing |
| Payment succeeds at Stripe but order stays *pending* | webhook not reaching the API (check the endpoint URL and the signing secret; Stripe's dashboard shows delivery attempts). The success page also confirms server-side, so customers are rarely affected |
| `CORS` errors in the browser | `FRONTEND_URL` must equal the site origin exactly (scheme + host, no trailing slash); re-run `config:cache` |
| Browser console shows CSP violations | the build used a different `NEXT_PUBLIC_API_URL` than the live API origin; rebuild |
| Emails not sent in production | still on `MAIL_MAILER=log`, or provider credentials wrong (see delivery log "Detail" column) |
