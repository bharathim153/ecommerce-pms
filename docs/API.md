# REST API reference

Base URL: `http://localhost:8000/api` (production: `https://api.your-domain.com/api`).
Every route below is verified against the live route table by `tests/Feature/DocsTest.php`, so this file cannot silently go stale.

## Conventions

| | |
|---|---|
| **Format** | JSON in, JSON out. Send `Accept: application/json` and (for bodies) `Content-Type: application/json`. File uploads use `multipart/form-data`. |
| **Auth** | `Authorization: Bearer <token>` from `POST /auth/login`, `/auth/register` or `/auth/mfa/verify`. Tokens expire after `SANCTUM_TOKEN_EXPIRATION` minutes (default 7 days) and are revoked on logout, password change/reset and account deactivation. |
| **Roles** | `admin` and `customer`. Every `/admin/*` route needs an admin token (customers get **403**, anonymous callers **401**). |
| **Success** | `{ "success": true, "message": "...", "data": ... }` with 200/201/202. |
| **Errors** | `{ "success": false, "message": "...", "errors": { } }` (our controllers) or Laravel's `{ "message": "...", "errors": { "field": ["..."] } }` for **422** validation. |
| **Status codes** | 200 OK · 201 Created · 202 Accepted (queued work) · 400 bad signature · 401 unauthenticated · 402 payment not completed · 403 forbidden · 404 not found · 409 conflict (e.g. already paid/sent) · 422 validation · 429 throttled · 502 gateway error · 503 gateway disabled |
| **Pagination** | `?page=N&per_page=N` (max 100). Lists return `data.items` + `data.meta { current_page, last_page, total }`; a few return Laravel's raw paginator under `data`. |
| **Rate limits** | Auth endpoints 10/min/IP; sign-in also 5 failed attempts per account+IP per 5 min; public catalog 120/min; order creation 20/min; payment starts 10/min; campaign send 6/min; PDF export start 10/min. Exceeding returns **429**. |
| **Money** | Decimal strings with 2 places (`"39.98"`) and an ISO currency code. Amounts are always computed server-side. |

## Authentication & account

| Method | Path | Access | Purpose / key parameters |
|---|---|---|---|
| `POST` | `/auth/register` | public | `name, email, password, password_confirmation, marketing_opt_in?` → customer + token. Password: 8+ chars, upper+lower+digit. Sends a verification email. |
| `POST` | `/auth/login` | public | `email, password` → `{user, token}`, or `{mfa_required: true, email}` when email-OTP MFA is on (a code is emailed). 401 bad credentials, 403 disabled, 429 locked out. |
| `POST` | `/auth/mfa/verify` | public | `email, code` (6 digits) → `{user, token}`. Codes last 10 min, are single use and lock after 5 wrong tries. |
| `POST` | `/auth/mfa/resend` | public | `email` → new code. 60 s cooldown. Same reply whether or not the account exists. |
| `POST` | `/auth/forgot-password` | public | `email` → reset link emailed (always 200). |
| `POST` | `/auth/reset-password` | public | `token, email, password, password_confirmation`. Revokes all sessions. |
| `GET` | `/auth/email/verify/{id}/{hash}` | public (signed URL) | Emailed link; redirects to the frontend `/login?verified=1\|0`. Tampered/expired signature → 403. |
| `POST` | `/auth/email/resend` | customer/admin | Re-send the verification email (3/min). |
| `GET` | `/auth/me` | customer/admin | Current user `{id,name,email,role,mfa_enabled,email_verified,phone}`. |
| `POST` | `/auth/logout` | customer/admin | Revokes the current token. |
| `PATCH` | `/auth/profile` | customer/admin | `name, phone?`. Email/role cannot be changed here. |
| `PUT` | `/auth/password` | customer/admin | `current_password, password, password_confirmation`. Signs out other devices. |
| `PATCH` | `/auth/mfa` | customer/admin | `enabled, password` — turn email-OTP MFA on/off (password required). |
| `GET` | `/auth/marketing` | customer/admin | `{subscribed}` marketing-email preference. |
| `PATCH` | `/auth/marketing` | customer/admin | `subscribed` (bool). Only the user can opt themselves back in. |

## Storefront (public, read-only)

| Method | Path | Access | Purpose / key parameters |
|---|---|---|---|
| `GET` | `/categories` | public | Categories with `products_count` (published only). |
| `GET` | `/products` | public | Published products. `search, category (slug), min_price, max_price, sort (price_asc\|price_desc\|name), page, per_page≤48`. |
| `GET` | `/products/{slug}` | public | One published product incl. sanitised HTML `description` and `images`. Drafts/archived → 404. |
| `GET` | `/payment-methods` | public | `{currency, stripe: bool, paypal: bool}` — which gateways are live. |

## Orders & payments (signed-in customer; own orders only)

| Method | Path | Access | Purpose / key parameters |
|---|---|---|---|
| `GET` | `/orders` | customer/admin | Your orders, newest first. |
| `POST` | `/orders` | customer/admin | `items: [{product_id, quantity}]`. Requires a verified email. Prices, names and totals come from the database; unpublished/out-of-stock lines → 422 with per-line errors. |
| `GET` | `/orders/{order}` | customer/admin | Order with items and payments. Someone else's order → 404. |
| `POST` | `/orders/{order}/pay/stripe` | customer/admin | → `{url}`: redirect the browser to Stripe-hosted Checkout. 409 if already paid, 503 if disabled. |
| `POST` | `/orders/{order}/stripe/confirm` | customer/admin | Server re-reads the Checkout Session from Stripe and returns the order. Call from the success page; never trust the redirect alone. |
| `POST` | `/orders/{order}/pay/paypal` | customer/admin | → `{approve_url, paypal_order_id}`: redirect to PayPal. |
| `POST` | `/orders/{order}/paypal/capture` | customer/admin | `paypal_order_id` — captures after approval. The id must belong to *this* order; amount and currency are verified. 402 if not completed. |

## Gateway & provider callbacks (no login; authenticity = signature)

| Method | Path | Access | Purpose / key parameters |
|---|---|---|---|
| `POST` | `/webhooks/stripe` | public (Stripe signature) | `Stripe-Signature` verified against `STRIPE_WEBHOOK_SECRET`; handles checkout.session.completed/expired, async payment events, charge.refunded. Idempotent by event id. |
| `POST` | `/webhooks/paypal` | public (PayPal signature) | Verified through PayPal's verify-webhook-signature API; handles PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED. Idempotent. |
| `POST` | `/webhooks/mailgun` | public (HMAC signature) | Delivered / permanent-bounce / complaint events → updates delivery logs and suppresses bounced or complaining addresses. |
| `GET` | `/unsubscribe/{token}` | public (token) | Masked address + current status for the unsubscribe page. Never changes state. |
| `POST` | `/unsubscribe/{token}` | public (token) | Unsubscribes. Also serves RFC 8058 one-click `List-Unsubscribe-Post`. Idempotent. |
| `POST` | `/resubscribe/{token}` | public (token) | The subscriber opts themselves back in. |

## Admin — dashboard, users, settings

| Method | Path | Access | Purpose / key parameters |
|---|---|---|---|
| `GET` | `/admin/dashboard` | admin | `?days=7\|30\|90` → totals, per-day revenue/orders series, orders by status, payment stats, recent orders/customers, PDF and campaign summaries. |
| `GET` | `/admin/users` | admin | `search, role, per_page` — paginated users. |
| `PATCH` | `/admin/users/{user}` | admin | `mfa_enabled?, is_active?` (cannot deactivate yourself; deactivating revokes tokens). |
| `GET` | `/admin/payment-settings` | admin | Gateway configuration. Secrets are **never** returned, only a masked hint and the source (`env`/`admin`). |
| `PUT` | `/admin/payment-settings` | admin | `currency, stripe_enabled, stripe_secret_key (sk_…), stripe_webhook_secret (whsec_…), paypal_enabled, paypal_mode, paypal_client_id, paypal_client_secret, paypal_webhook_id`. Blank secret = keep; `__clear__` removes an override. Secrets are stored encrypted. |
| `GET` | `/admin/orders` | admin | `status, search (order number), page`. |
| `GET` | `/admin/orders/{order}` | admin | Order with customer, items, payments and any payment flag. |

## Admin — catalog

| Method | Path | Access | Purpose / key parameters |
|---|---|---|---|
| `GET` | `/admin/products` | admin | `search (name/SKU), status, category_id, sort (id\|name\|sku\|price\|stock\|status\|created_at\|updated_at), direction, page, per_page≤100`. |
| `POST` | `/admin/products` | admin | `name, sku (unique, [A-Za-z0-9._-]), price, status (draft\|published\|archived), stock?, category_id?, short_description?, description? (HTML, sanitised server-side)`. |
| `GET` | `/admin/products/{product}` | admin | Full product with images. |
| `PUT/PATCH` | `/admin/products/{product}` | admin | Same fields as create. |
| `DELETE` | `/admin/products/{product}` | admin | Soft-deletes the product and removes its image files. |
| `POST` | `/admin/products/{product}/images` | admin | `images[]` (≤10 files; JPG/PNG/WebP/GIF, ≤5 MB, ≤5000×5000). First image becomes primary. SVG and disguised scripts are rejected. |
| `PATCH` | `/admin/products/{product}/images/{image}/primary` | admin | Make this the primary image. |
| `DELETE` | `/admin/products/{product}/images/{image}` | admin | Remove an image (a new primary is chosen if needed). |
| `POST` | `/admin/uploads/image` | admin | `image` — inline image for the rich-text editor; returns `{url}`. |
| `POST` | `/admin/categories` | admin | `name` (unique); slug is generated. |
| `PUT/PATCH` | `/admin/categories/{category}` | admin | `name`. |
| `DELETE` | `/admin/categories/{category}` | admin | Products in it become uncategorised. |

## Admin — PDF export (background jobs)

| Method | Path | Access | Purpose / key parameters |
|---|---|---|---|
| `POST` | `/admin/pdf-exports` | admin | `scope: "all"` or `scope: "selected", product_ids: [...]` → **202** with the export record. Max 3 running per user (429). |
| `GET` | `/admin/pdf-exports` | admin | History, newest first. |
| `GET` | `/admin/pdf-exports/{pdfExport}` | admin | `status (queued\|processing\|completed\|failed), progress 0-100, processed_products, total_products, page_count, size_bytes, error`. Poll this. |
| `GET` | `/admin/pdf-exports/{pdfExport}/download` | admin | Streams the PDF (409 until completed). |
| `POST` | `/admin/pdf-exports/{pdfExport}/retry` | admin | Re-queue a failed export; finished chunks are reused. |
| `DELETE` | `/admin/pdf-exports/{pdfExport}` | admin | Deletes the record and file (409 while running). |

## Admin — email campaigns

| Method | Path | Access | Purpose / key parameters |
|---|---|---|---|
| `GET` | `/admin/email/templates` | admin | List (`search`). |
| `POST` | `/admin/email/templates` | admin | `name, subject, body_html` (HTML is sanitised; merge tags `{{name}} {{email}} {{app_name}} {{unsubscribe_url}}`). |
| `GET` | `/admin/email/templates/{template}` | admin | One template. |
| `PUT/PATCH` | `/admin/email/templates/{template}` | admin | Update. |
| `DELETE` | `/admin/email/templates/{template}` | admin | Delete (campaigns keep their own copy). |
| `POST` | `/admin/email/preview` | admin | `subject?, body_html` → exactly the HTML a recipient receives (sanitised, merge tags, compliance footer). |
| `GET` | `/admin/email/subscribers` | admin | `search, status (subscribed\|unsubscribed\|bounced)` + counts. |
| `POST` | `/admin/email/subscribers` | admin | `email, name?, consent_confirmed: true`. 409 if the person exists or opted out. |
| `PUT/PATCH` | `/admin/email/subscribers/{subscriber}` | admin | `name?, is_subscribed?` — admins can unsubscribe but never re-subscribe someone. |
| `DELETE` | `/admin/email/subscribers/{subscriber}` | admin | Delete. |
| `POST` | `/admin/email/subscribers/import` | admin | multipart `file` (CSV, ≤5 MB, ≤20,000 rows), `consent_confirmed`. Returns `{added, already_exists, invalid, duplicate_in_file}`. Never alters existing rows. |
| `GET` | `/admin/email/subscribers/export` | admin | CSV download (`?status=`); spreadsheet formulas are neutralised. |
| `GET` | `/admin/email/campaigns` | admin | List with delivery counts. |
| `POST` | `/admin/email/campaigns` | admin | `template_id` **or** `subject + body_html` → draft (content is copied). |
| `GET` | `/admin/email/campaigns/recipients` | admin | `{eligible}` — how many people a send would reach now. |
| `GET` | `/admin/email/campaigns/{campaign}` | admin | Campaign with counts `{queued,sent,delivered,failed,bounced,skipped}`. Poll while `status = sending`. |
| `PUT/PATCH` | `/admin/email/campaigns/{campaign}` | admin | Edit a **draft** (`subject, body_html`); otherwise 409. |
| `DELETE` | `/admin/email/campaigns/{campaign}` | admin | Delete (cancel a running one first). |
| `POST` | `/admin/email/campaigns/{campaign}/test` | admin | Sends one copy to the signed-in admin's own address only. |
| `POST` | `/admin/email/campaigns/{campaign}/send` | admin | `confirm: true` → **202**. Atomically draft→sending exactly once (second call 409); work is queued in batches. |
| `POST` | `/admin/email/campaigns/{campaign}/cancel` | admin | Stops a running campaign; unsent recipients are marked `skipped`. |
| `GET` | `/admin/email/campaigns/{campaign}/logs` | admin | Per-recipient delivery log (`status` filter): queued, sent, delivered, failed, bounced, skipped. |

## Example: checkout with Stripe

```bash
# 1. sign in
curl -s localhost:8000/api/auth/login -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"email":"customer@example.com","password":"Customer@12345"}'            # → data.token

# 2. create the order (server prices it)
curl -s localhost:8000/api/orders -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"items":[{"product_id":1,"quantity":2}]}'                               # → data.id, data.total

# 3. get the hosted checkout URL and send the browser there
curl -s -X POST localhost:8000/api/orders/$ORDER/pay/stripe -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json'

# 4. after Stripe redirects back, the page asks the server to confirm (Stripe's webhook also marks it paid)
curl -s -X POST localhost:8000/api/orders/$ORDER/stripe/confirm -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json'
```
