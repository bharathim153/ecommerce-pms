import { chromium } from "playwright-core";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const DB = { user: process.env.DB_USER ?? "pms", pass: process.env.DB_PASS ?? "", name: process.env.DB_NAME ?? "ecommerce_pms", host: process.env.DB_HOST ?? "127.0.0.1" };
const fixture = (f) => fileURLToPath(new URL("./fixtures/" + f, import.meta.url));

import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
const S = process.argv[2] ?? process.env.E2E_OUT ?? tmpdir();
const API = process.env.API_URL ?? "http://localhost:8000/api", WEB = process.env.WEB_URL ?? "http://localhost:3000";
const sql = (q) => execFileSync("mysql", ["-h" + DB.host, "-u" + DB.user, ...(DB.pass ? ["-p" + DB.pass] : []), DB.name, "-Nse", q], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const errs = []; let fails = 0;
const ok = (c, s) => { console.log(c ? "PASS" : "FAIL", s); if (!c) fails++; };
const newPage = async () => { const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on("pageerror", (e) => errs.push("pageerror: " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/status of 50[23]|Failed to load resource/.test(m.text())) errs.push("console: " + m.text().slice(0, 200)); }); return p; };
const login = async (p, email, pw, to) => { await p.goto(WEB + "/login"); await p.fill("#f-email", email); await p.fill("#f-password", pw); await p.click("button:has-text('Sign in')"); await p.waitForURL(to); };

// ---- admin: payment settings page
const admin = await newPage();
await login(admin, "admin@example.com", "Admin@12345", "**/admin");
await admin.goto(WEB + "/admin/payment-settings");
await admin.getByText("Not configured").first().waitFor();
ok(true, "settings page shows gateways as not configured initially");
await admin.getByLabel("Secret key (sk_test_…)").fill("not-a-key");
await admin.getByRole("button", { name: "Save settings" }).click();
await admin.getByText("The selected").or(admin.getByText(/format is invalid/)).first().waitFor();
ok(true, "invalid Stripe key format rejected with a field error");
await admin.getByLabel("Secret key (sk_test_…)").fill("sk_test_e2edummy123456");
await admin.getByLabel("Webhook signing secret (whsec_…)").fill("whsec_e2etestsecret");
await admin.getByLabel("Client ID").fill("e2e-client-id");
await admin.getByLabel("Client secret").fill("e2e-client-secret-value");
await admin.getByRole("button", { name: "Save settings" }).click();
await admin.getByText("Saved ••••3456").waitFor();
ok(true, "saved; secret shown only as masked hint");
const html = await admin.content();
ok(!html.includes("sk_test_e2edummy123456") && !html.includes("e2e-client-secret-value") && !html.includes("whsec_e2etestsecret"), "no secret value present anywhere in the page DOM");
ok(sql("select count(*) from settings where value like '%e2edummy%' or value like '%e2e-client-secret%'") === "0", "secrets are encrypted at rest in the database");
ok((await admin.getByText("Live in checkout").count()) === 2, "both gateways now live in checkout");

// ---- create a published product through the API
const tok = (await (await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email: "admin@example.com", password: "Admin@12345" }) })).json()).data.token;
const mk = await (await fetch(API + "/admin/products", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ name: "E2E Gadget", sku: "E2E-PAY-1", price: 25, stock: 5, status: "published", description: "<h2>Details</h2><table><tbody><tr><th>Spec</th><td>Value</td></tr></tbody></table>" }) })).json();
const pid = mk.data.id;

// ---- customer shopping journey
const c = await newPage();
await c.goto(WEB + "/shop");
await c.getByText("E2E Gadget").first().click();
await c.waitForURL(/\/shop\/e2e-gadget/);
await c.locator(".rich-content table").waitFor({timeout:10000}); ok(true, "product detail renders the rich-text table");
await c.getByLabel("Quantity").fill("2");
await c.getByRole("button", { name: "Add to cart" }).click();
await c.goto(WEB + "/cart");
await c.getByText("Subtotal $50.00").waitFor(); ok(true, "cart shows 2 × $25.00 = $50.00");
await c.getByRole("link", { name: "Checkout" }).click();
await c.waitForURL(/\/login\?next=%2Fcheckout/); ok(true, "guest is sent to login, then back to checkout");
await c.fill("#f-email", "customer@example.com"); await c.fill("#f-password", "Customer@12345");
await c.click("button:has-text('Sign in')"); await c.waitForURL("**/checkout");
await c.getByText("Total").first().waitFor();
ok(await c.getByRole("button", { name: /Pay by card/ }).isVisible() && await c.getByRole("button", { name: /PayPal/ }).isVisible(), "checkout offers Stripe and PayPal");

await c.getByRole("button", { name: /Pay by card/ }).click();
const alert = c.locator("p[role=alert]");
await alert.waitFor({ timeout: 30000 });
const atxt = await alert.innerText(); console.log("   alert text:", atxt); ok(/Could not start the card payment/.test(atxt), "fake Stripe key -> friendly error, no crash (no real gateway to talk to)");
const orderId = sql("select max(id) from product_orders");
ok(sql(`select status from product_orders where id=${orderId}`) === "pending" && sql(`select count(*) from payments where order_id=${orderId} and status='failed'`) === "1", "order stays pending; the failed attempt is recorded, not left dangling");
ok(sql(`select total from product_orders where id=${orderId}`) === "50.00", "server computed the total from DB prices");

// ---- simulate Stripe's signed webhook (the real signature check runs on the live API)
sql(`insert into payments (order_id,provider,provider_reference,amount,currency,status,created_at,updated_at) values (${orderId},'stripe','cs_e2e_${orderId}',50.00,'USD','pending',now(),now())`);
const evt = { id: "evt_e2e_" + orderId, object: "event", type: "checkout.session.completed", data: { object: { id: "cs_e2e_" + orderId, object: "checkout.session", payment_status: "paid", amount_total: 5000, currency: "usd", payment_intent: "pi_e2e_" + orderId } } };
const body = JSON.stringify(evt), t = Math.floor(Date.now() / 1000);
const sig = (secret) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
const post = (s) => fetch(API + "/webhooks/stripe", { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": s }, body });
ok((await post(sig("whsec_wrong"))).status === 400 && sql(`select status from product_orders where id=${orderId}`) === "pending", "webhook with wrong signature -> 400, order untouched");
const good = await post(sig("whsec_e2etestsecret"));
ok(good.status === 200 && sql(`select status from product_orders where id=${orderId}`) === "paid", "webhook with valid signature -> order paid");
ok(sql(`select paid_at is not null from product_orders where id=${orderId}`) === "1" && sql(`select stock from products where id=${pid}`) === "3", "paid_at recorded and stock decremented 5 -> 3");
await post(sig("whsec_e2etestsecret"));
ok(sql(`select stock from products where id=${pid}`) === "3", "replayed webhook does not double-decrement stock");

// ---- result pages
await c.goto(`${WEB}/checkout/success?order=${orderId}&provider=stripe`);
await c.getByText("Payment successful").waitFor({ timeout: 15000 }); ok(true, "success page confirms the paid order from the server");
await c.goto(`${WEB}/checkout/success?order=999999&provider=stripe`);
await c.getByText(/not found|No query results|Not Found/i).first().waitFor({ timeout: 10000 }); ok(true, "success page for someone else's / missing order shows an error, not a fake success");
await c.goto(`${WEB}/checkout/failure?order=${orderId}`);
ok(await c.getByText("Payment not completed").isVisible() && await c.getByRole("link", { name: "Try again" }).isVisible(), "failure page offers retry");

// ---- admin orders
await admin.goto(WEB + "/admin/orders");
await admin.locator("td span:has-text('paid')").first().waitFor();
await admin.getByRole("button", { name: "Details" }).first().click();
await admin.getByText(/Payments:.*stripe succeeded/).waitFor({ timeout: 10000 });
ok(await admin.getByText(/E2E Gadget/).first().isVisible(), "admin orders list shows the paid order, its items and its payments");

console.log(errs.length ? "BROWSER ERRORS:\n" + errs.join("\n").slice(0, 900) : "no unexpected browser console errors");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
await b.close();
