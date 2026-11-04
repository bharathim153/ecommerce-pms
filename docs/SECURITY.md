# Security review

Reviewed in Phase 10 by reading the code, running the dependency audits, and writing tests for each control.
"Evidence" names the automated test that fails if the control regresses.

## Controls in place

| Area | Control | Evidence |
|---|---|---|
| **Authentication** | Passwords hashed (bcrypt, 12 rounds), 8+ chars with upper/lower/digit. Sanctum bearer tokens **expire after 7 days** (`SANCTUM_TOKEN_EXPIRATION`) and are revoked on logout, password change/reset and deactivation. | `AuthTest`, `SecurityTest::test_api_tokens_expire` |
| **Brute force** | Route throttle (10/min/IP) **plus** 5 failed sign-ins per account+IP per 5 min (even the right password is refused while locked). | `SecurityTest::test_repeated_wrong_passwords_lock…` |
| **Email OTP (MFA)** | 6-digit code, stored hashed, 10 min expiry, single use, 5 wrong tries lock it, 60 s resend cooldown. Turning MFA on/off needs the password. Admin can force it per user. | `AuthTest::test_mfa_*` |
| **Enumeration** | Same message for unknown email and wrong password; forgot-password and MFA-resend always answer the same. | `SecurityTest::test_login_does_not_reveal…` |
| **Authorization** | Every non-public route requires a token; every `/admin/*` route returns **403** to a customer. The role check runs *before* route-model binding so ids can't be probed. An automated audit enumerates all routes, so a new unprotected endpoint fails the build. | `SecurityTest::test_every_route…`, `…admin_route_rejects…` |
| **IDOR** | Orders, payments and confirmations are scoped to the owner (someone else's id → 404). | `PaymentsTest`, `DashboardAndProfileTest` |
| **Mass assignment** | Controllers use validated fields only; `role_id`, `is_active`, `email_verified_at` can't be set via register/profile/admin-user endpoints. | `SecurityTest::test_privileged_fields…` |
| **Payments** | Prices come from the database. Success is decided only by signature-verified webhooks or a server-to-gateway re-read, never by the browser. Amount **and** currency are checked; duplicates and replays are idempotent; a PayPal order id must belong to that order. Card data never touches this server (hosted Checkout / PayPal). | `PaymentsTest` (17 tests) |
| **Secrets** | Nothing is hard-coded. Gateway secrets live in env or are stored **encrypted** (Laravel `Crypt`) via the admin page and are never sent back to the browser (masked hint only). `.env*` are git-ignored; only `.env.example` is tracked. | `PaymentsTest::test_admin_settings_store_secrets_encrypted…` |
| **Webhooks** | Stripe: HMAC + 5-min timestamp tolerance. PayPal: verified through PayPal's API. Mailgun: HMAC + 10-min window. Unsigned → 400. | `SecurityTest::test_payment_webhooks_reject_unsigned…`, `CampaignsTest` |
| **XSS** | Rich text is whitelisted server-side with HTMLPurifier on save (no scripts, event handlers, `javascript:` URLs, iframes). Email previews render in a fully sandboxed iframe. Browser CSP (below) is the second layer. | `ProductImage/Template` tests, `CampaignsTest::test_template_html_is_sanitised…` |
| **Uploads** | Extension *and* MIME checked (JPG/PNG/WebP/GIF only; SVG and disguised PHP rejected), ≤5 MB, ≤5000×5000, random server-side file names, never executed (see nginx config). | `SecurityTest::test_uploads_reject…` |
| **SQL injection** | Eloquent bindings everywhere; `LIKE` input is escaped; sort columns are whitelisted; the few raw SQL fragments contain constants only. | code review |
| **CSRF** | Not applicable: authentication is a bearer token in a header, not a cookie. CORS allows only `FRONTEND_URL`. | `config/cors.php` |
| **Headers** | API: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store`, HSTS over HTTPS. Web: the same plus a production **CSP** (no framing, no plugins, connections only to our API, `form-action 'self'`). | `SecurityTest::test_api_responses_carry…`, `e2e/06-csp-production.mjs` |
| **Email compliance** | Explicit, un-pre-ticked opt-in at signup; consent confirmation required to add/import contacts; every email has an unsubscribe link, RFC 8058 one-click header and a postal-address footer; unsubscribes are honoured even after a campaign is queued; bounces/complaints are suppressed; admins can't re-subscribe anyone; unsubscribe is POST-only so link scanners can't trigger it. | `CampaignsTest` |
| **Seeding** | The production seeder **refuses** default/example admin credentials and never resets an existing admin's password. | `SecurityTest::test_production_seeding_refuses…` |
| **Dependencies** | `composer audit`: no advisories. `npm audit --omit=dev`: 0. | run in CI |

## Known limitations and recommendations

1. **Token in `localStorage`.** Simple and CSRF-proof, but any XSS could read it. Mitigations: server sanitising, sandboxed previews, CSP. A hardened alternative is an HttpOnly cookie via Sanctum's stateful SPA mode (needs same-site domains).
2. **CSP allows `'unsafe-inline'` scripts.** Next.js bootstrap scripts need it unless every page is rendered dynamically with a per-request nonce. The remaining directives still block framing, plugins, foreign form targets and off-site connections. `img-src` allows `https:` because admins can reference external images.
3. **Chrome runs with `--no-sandbox`** for PDF rendering (required in most containers). Input is only sanitised HTML and local files, but run the worker as an unprivileged user in a container/VM and keep Chrome patched.
4. **No malware scanning** of uploaded images, no image re-encoding (EXIF is preserved).
5. **Admin MFA is optional.** Strongly recommend enabling it for every admin (`PATCH /admin/users/{id} {"mfa_enabled": true}`).
6. **No audit log** of admin actions and no IP-based blocking beyond rate limits; add one before handling regulated data.
7. **Email delivery tracking** (delivered/bounced) works with Mailgun webhooks only. With SES-over-SMTP you only see sent/failed; add SNS bounce handling before sending to large cold lists.
8. **Rate limiter is a fixed per-minute window** shared across workers, so each minute starts with a short burst.
9. **Registration reveals whether an email is already registered** (standard trade-off for usability). Add CAPTCHA if abused.
10. **16 moderate `npm audit` findings** all come from one `minimatch` ReDoS inside the ESLint toolchain (dev dependency only, not shipped). The only fix is a breaking ESLint downgrade; revisit when `eslint-config-next` updates.
11. **Dates and "today" use the server time zone (UTC).** Fine for totals; show local time if you need per-region reporting.

## Before going live (checklist)

- [ ] `APP_ENV=production`, `APP_DEBUG=false`, a freshly generated `APP_KEY` (never reuse a dev key — stored secrets are encrypted with it; back it up).
- [ ] Unique strong DB password; DB user limited to this schema; DB not reachable from the internet.
- [ ] `ADMIN_EMAIL` / `ADMIN_PASSWORD` set to real values **before** `db:seed`; change both seeded demo logins (the customer demo account is not created in production).
- [ ] HTTPS everywhere (nginx example in `deploy/`), `FRONTEND_URL` and `APP_URL` use `https://`.
- [ ] Live Stripe/PayPal keys entered via env or the admin page, webhook endpoints registered with each provider and their signing secrets configured.
- [ ] Real mail provider configured; `CAMPAIGN_FOOTER_ADDRESS` is your genuine postal address; SPF/DKIM/DMARC set up for the sending domain.
- [ ] Queue workers under Supervisor; `storage/` and `bootstrap/cache` writable only by the app user.
- [ ] Backups for the database **and** `storage/app` (uploads, exports) and the `APP_KEY`.
- [ ] Re-run `composer audit` and `npm audit --omit=dev` at release time.
