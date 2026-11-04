import { chromium } from "playwright-core";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const DB = { user: process.env.DB_USER ?? "pms", pass: process.env.DB_PASS ?? "", name: process.env.DB_NAME ?? "ecommerce_pms", host: process.env.DB_HOST ?? "127.0.0.1" };
const fixture = (f) => fileURLToPath(new URL("./fixtures/" + f, import.meta.url));

const WEB = process.env.WEB_URL ?? "http://localhost:3000", API = process.env.API_URL ?? "http://localhost:8000/api";
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const problems = [];
await p.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI}`)); });
p.on("pageerror", (e) => problems.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Framing .* violates/.test(m.text())) problems.push("console: " + m.text().slice(0, 160)); });
const visit = async (name, fn) => { try { await fn(); const v = await p.evaluate(() => window.__csp.splice(0)); console.log(v.length ? "FAIL" : "PASS", name, v.length ? JSON.stringify(v) : ""); if (v.length) problems.push(name); } catch (e) { console.log("FAIL", name, e.message.split("\n")[0]); problems.push(name); } };

// data for the pages
const tok = (await (await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email: "admin@example.com", password: "Admin@12345" }) })).json()).data.token;
const H = { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + tok };
await fetch(API + "/admin/products", { method: "POST", headers: H, body: JSON.stringify({ name: "CSP Product", sku: "CSP-1", price: 9.5, stock: 5, status: "published", description: "<h2>Hi</h2><table><tbody><tr><th>a</th><td>b</td></tr></tbody></table>" }) });
await fetch(API + "/admin/email/templates", { method: "POST", headers: H, body: JSON.stringify({ name: "CSP tpl", subject: "S", body_html: "<p style='color:#c00'>Hello</p>" }) });

await visit("home", async () => { await p.goto(WEB + "/"); await p.getByRole("heading", { name: "CSP Product" }).waitFor(); });
await visit("shop + product detail (rich text, table)", async () => { await p.goto(WEB + "/shop"); await p.getByText("CSP Product").first().click(); await p.locator(".rich-content table").waitFor(); });
await visit("login", async () => { await p.goto(WEB + "/login"); await p.fill("#f-email", "admin@example.com"); await p.fill("#f-password", "Admin@12345"); await p.click("button:has-text('Sign in')"); await p.waitForURL("**/admin"); });
await visit("admin dashboard (charts, inline SVG, API fetch)", async () => { await p.getByTestId("hero-revenue").waitFor(); await p.locator("section[aria-label='Revenue per day'] svg").first().waitFor(); });
await visit("product editor (TipTap, image upload)", async () => { await p.goto(WEB + "/admin/products/new"); await p.locator(".ProseMirror").click(); await p.keyboard.type("hello"); await p.locator("div[role=toolbar] input[type=file]").setInputFiles(fixture("pic.png")); await p.waitForSelector(".ProseMirror img"); });
await visit("email template preview (sandboxed srcdoc iframe)", async () => { await p.goto(WEB + "/admin/email/templates"); await p.getByText("CSP tpl").waitFor(); await p.getByRole("link", { name: "Edit" }).first().click(); await p.getByRole("button", { name: "Preview" }).click(); await p.frameLocator('iframe[title="Email preview"]').getByText("Hello").waitFor(); });
await visit("cart + checkout page", async () => { await p.goto(WEB + "/shop"); await p.getByText("CSP Product").first().click(); await p.getByRole("button", { name: "Add to cart" }).click(); await p.goto(WEB + "/checkout"); await p.getByText("Order summary").or(p.getByText("Total")).first().waitFor(); });
await visit("account area", async () => { await p.goto(WEB + "/account"); await p.getByRole("form", { name: "Profile" }).waitFor(); });
await visit("PDF export page (blob download)", async () => { await p.goto(WEB + "/admin/exports"); await p.getByRole("heading", { name: "PDF exports" }).waitFor(); });

// framing must be refused
const framed = await p.evaluate(async (u) => { const f = document.createElement("iframe"); f.src = u; document.body.appendChild(f); await new Promise((r) => setTimeout(r, 1500)); try { return f.contentDocument?.body?.innerHTML?.length ?? "blocked"; } catch { return "blocked"; } }, WEB + "/login");
console.log(framed === "blocked" || framed === 0 ? "PASS" : "FAIL", "site cannot be embedded in another page (clickjacking)", framed);
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "NO CSP VIOLATIONS, NO CONSOLE ERRORS\nALL PASSED");
await b.close();
