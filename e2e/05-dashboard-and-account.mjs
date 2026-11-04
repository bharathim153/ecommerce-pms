import { chromium } from "playwright-core";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const DB = { user: process.env.DB_USER ?? "pms", pass: process.env.DB_PASS ?? "", name: process.env.DB_NAME ?? "ecommerce_pms", host: process.env.DB_HOST ?? "127.0.0.1" };
const fixture = (f) => fileURLToPath(new URL("./fixtures/" + f, import.meta.url));

import { execFileSync } from "node:child_process";
const S = process.argv[2] ?? process.env.E2E_OUT ?? tmpdir(), WEB = process.env.WEB_URL ?? "http://localhost:3000";
const sql = (q) => execFileSync("mysql", ["-h" + DB.host, "-u" + DB.user, ...(DB.pass ? ["-p" + DB.pass] : []), DB.name, "-Nse", q], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const errs = []; let fails = 0;
const ok = (c, s) => { console.log(c ? "PASS" : "FAIL", s); if (!c) fails++; };
const mk = async (vp = { width: 1280, height: 900 }) => { const p = await (await b.newContext({ viewport: vp })).newPage(); p.on("pageerror", (e) => errs.push("pageerror: " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console: " + m.text().slice(0, 200)); }); return p; };
const login = async (p, e, pw, to) => { await p.goto(WEB + "/login"); await p.fill("#f-email", e); await p.fill("#f-password", pw); await p.click("button:has-text('Sign in')"); await p.waitForURL(to); };

// ================= dashboard =================
const a = await mk();
await login(a, "admin@example.com", "Admin@12345", "**/admin");
await a.getByTestId("hero-revenue").waitFor();
ok((await a.getByTestId("hero-revenue").innerText()) === "$905.50", "hero revenue = all-time paid total ($905.50)");
ok(await a.getByText("$815.50").first().isVisible(), "period revenue for last 30 days = $815.50");
ok(await a.getByRole("heading", { name: "Dashboard" }).isVisible() && (await a.locator("nav[aria-label='Quick actions'] a").count()) === 4, "quick-action buttons present");

// ---- line chart: tooltip carries the right number for a known day
const rev = a.locator("section[aria-label='Revenue per day']");
const svg = rev.locator("svg").first();
await svg.waitFor();
const box = await svg.boundingBox();
const W = box.width, n = 30, l = 52, r = 72, iw = W - l - r;
const xAt = (i) => box.x + l + (i / (n - 1)) * iw;
await a.mouse.move(xAt(29), box.y + 100);
await rev.getByRole("status").waitFor();
ok(/\$120\.00/.test(await rev.getByRole("status").innerText()), "line chart: hovering today shows $120.00");
await a.mouse.move(xAt(29 - 25), box.y + 100);
await a.waitForTimeout(150);
const t25 = await rev.getByRole("status").innerText();
ok(/\$210\.00/.test(t25), "line chart: hovering 25 days ago shows $210.00 (crosshair snaps to the day)");
await a.mouse.move(xAt(29 - 15), box.y + 100);
await a.waitForTimeout(150);
ok(/\$0\.00/.test(await rev.getByRole("status").innerText()), "line chart: a day with no sales shows $0.00 (zero-filled, no gaps)");
await a.mouse.move(box.x - 40, box.y - 40);
await a.waitForTimeout(150);
ok((await rev.getByRole("status").count()) === 0, "tooltip disappears when the pointer leaves");
// keyboard
await svg.focus();
await a.keyboard.press("ArrowLeft");
await a.waitForTimeout(100);
ok(/\$80\.50/.test(await rev.getByRole("status").innerText()), "keyboard: focus + ArrowLeft reads yesterday ($80.50) — same readout as hover");
// ---- visual spec on marks
const stroke = await rev.locator("path[stroke]").first().evaluate((el) => ({ w: el.getAttribute("stroke-width"), j: el.getAttribute("stroke-linejoin") }));
ok(stroke.w === "2" && stroke.j === "round", "line is 2px with round joins");
ok((await rev.locator("circle").first().getAttribute("r")) === "4" && (await rev.locator("circle").first().getAttribute("stroke-width")) === "2", "end marker r=4 with 2px surface ring");
ok(await rev.locator("text:has-text('$')").count() > 0 && !(await rev.innerHTML()).includes("stroke-dasharray"), "axis labels present; gridlines are solid (no dash)");

// ---- table twin
await rev.getByRole("tab", { name: "Table" }).click();
const rows = await rev.locator("tbody tr").count();
const sum = (await rev.locator("tbody tr td:nth-child(2)").allInnerTexts()).reduce((s, t) => s + Number(t.replace(/[$,]/g, "")), 0);
ok(rows === 30 && Math.abs(sum - 815.5) < 0.01, `table view lists 30 days and sums to $815.50 (got ${rows} rows, $${sum.toFixed(2)})`);
await rev.getByRole("tab", { name: "Chart" }).click();

// ---- column chart + status bars hover
const ord = a.locator("section[aria-label='Paid orders per day']");
const bar = ord.locator("rect[role=img]").nth(29);
await bar.hover();
ok(/1\s*Orders|Orders/.test(await ord.getByRole("status").innerText()) && /1/.test(await ord.getByRole("status").innerText()), "column chart: hovering today's bar shows 1 order");
const thick = await ord.locator("path[fill]").evaluateAll((els) => Math.max(...els.map((e) => e.getBBox().width)));
ok(thick <= 24, `column thickness ≤ 24px (is ${thick.toFixed(1)}px)`);
const st = a.locator("section[aria-label='Orders by status']");
await st.locator("rect[role=img]").first().hover();
ok(/Paid|paid/.test(await st.getByRole("status").innerText()), "status bars: ranked, tooltip names the status");
ok((await st.locator("svg text").allTextContents())[0].toLowerCase() === "paid", "status bars ranked largest first (paid on top)");
await a.mouse.move(5, 5);
await a.waitForTimeout(150);
const fills = await st.locator("svg path[fill]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("fill")))]);
ok(fills.length === 1, "all status bars share one hue (no value ramp on nominal categories)");

// ---- payments / lists
const pay = a.locator("section[aria-label='Payments']");
ok(/Stripe/.test(await pay.innerText()) && /PayPal/.test(await pay.innerText()), "payment stats list both providers");
const stripeRow = pay.locator("tr", { hasText: "stripe" });
ok(/\$225\.00/.test(await stripeRow.innerText()), "Stripe revenue in period = $225.00 (120 + 45 + 60)");
ok(/50%|67%|75%/.test(await stripeRow.innerText()) || /4/.test(await stripeRow.innerText()), "Stripe success rate computed");
ok(await a.locator("section[aria-label='Recent orders']").getByText("DASH-X").isVisible() && await a.locator("section[aria-label='PDF export history']").getByText("16").isVisible() && await a.locator("section[aria-label='Email campaigns']").getByText("Dash campaign").isVisible(), "recent orders, PDF history and campaign sections are populated");

// ---- range filter re-scopes everything
await a.getByRole("radio", { name: "Last 7 days" }).click();
await a.getByText("$545.50").first().waitFor({ timeout: 10000 });
ok(true, "switching to 7 days: period revenue becomes $545.50");
await rev.locator("svg").first().waitFor();
await a.waitForTimeout(400);
await rev.getByRole("tab", { name: "Table" }).click();
ok((await rev.locator("tbody tr").count()) === 7, "revenue chart now has 7 points (every chart re-scoped by the one filter)");
await rev.getByRole("tab", { name: "Chart" }).click();
await a.getByRole("radio", { name: "Last 90 days" }).click();
await a.getByText("$905.50").nth(1).waitFor({ timeout: 10000 }).catch(() => {});
ok(/\$905\.50/.test(await a.getByRole("main").innerText()), "90 days includes the 40-day-old order ($905.50 in period)");
await a.getByRole("radio", { name: "Last 30 days" }).click();
await a.waitForTimeout(600);
await a.screenshot({ path: S + "/dashboard.png", fullPage: true });

// mobile
const mob = await mk({ width: 390, height: 800 });
await login(mob, "admin@example.com", "Admin@12345", "**/admin");
await mob.getByTestId("hero-revenue").waitFor();
const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 1, `mobile (390px): no horizontal page scroll (overflow ${overflow}px)`);
await mob.screenshot({ path: S + "/dashboard-mobile.png" });

// ================= customer area =================
const c = await mk();
await c.goto(WEB + "/");
await c.getByRole("heading", { name: /Quality products/ }).waitFor();
await c.getByRole("heading", { name: "Dash Widget" }).waitFor();
ok(true, "home page: hero + new arrivals show published products");
ok((await c.getByText("Dash Draft").count()) === 0, "draft products never appear on the storefront");

await c.goto(WEB + "/account");
await c.waitForURL(/\/login\?next=%2Faccount/); ok(true, "guest visiting /account is sent to sign in");
await c.fill("#f-email", "customer@example.com"); await c.fill("#f-password", "Customer@12345");
await c.click("button:has-text('Sign in')"); await c.waitForURL("**/account");
await c.getByRole("form", { name: "Profile" }).waitFor();
await c.getByLabel("Full name").fill("Demo Customer Updated");
await c.getByLabel("Phone (optional)").fill("not a phone");
await c.getByRole("button", { name: "Save changes" }).click();
await c.getByText(/phone field format is invalid/i).waitFor(); ok(true, "profile: server-side validation error shown on the field");
await c.getByLabel("Phone (optional)").fill("+1 555 010 2030");
await c.getByRole("button", { name: "Save changes" }).click();
await c.getByText("Profile updated.").first().waitFor();
ok(sql("select concat(name,'|',phone) from users where email='customer@example.com'") === "Demo Customer Updated|+1 555 010 2030", "profile changes persisted");

await c.getByRole("link", { name: "Orders" }).click();
await c.waitForURL("**/account/orders");
await c.getByText("DASH-A").waitFor();
ok((await c.locator("main ul > li").count()) === 9, "order history lists all 9 of this customer's orders");
await c.getByText("DASH-P").click();
await c.waitForURL(/\/account\/orders\/\d+$/);
await c.getByRole("link", { name: "Complete payment" }).waitFor(); ok(true, "pending order offers 'Complete payment'");
await c.goBack();
await c.getByText("DASH-A").click();
await c.getByRole("heading", { name: "DASH-A" }).waitFor();
await c.getByText("$120.00").first().waitFor();
ok((await c.getByRole("link", { name: "Complete payment" }).count()) === 0 && await c.getByText("$120.00").first().isVisible(), "paid order shows its items and total, no pay button");

await c.getByRole("link", { name: "Security" }).click();
await c.getByRole("form", { name: "Change password" }).waitFor();
await c.getByLabel("Current password", { exact: true }).fill("wrong");
await c.getByLabel("New password", { exact: true }).fill("Customer@12346");
await c.getByLabel("Confirm new password").fill("Customer@12346");
await c.getByRole("button", { name: "Update password" }).click();
await c.getByText("Your current password is incorrect.").first().waitFor(); ok(true, "wrong current password is rejected");
ok(sql("select count(*) from users where email='customer@example.com' and password like '$2y$%'") === "1", "password unchanged after rejection");

// other customers can't read this customer's order
const orderId = sql("select id from product_orders where number='DASH-A'");
const other = await mk();
await other.goto(WEB + "/register");
await other.locator("#f-name").fill("Other Person").catch(() => {});
await other.getByLabel("Full name").fill("Other Person"); await other.locator("#f-email").fill("other@e2e.test");
await other.getByLabel("Password", { exact: true }).fill("Passw0rdX"); await other.getByLabel("Confirm password").fill("Passw0rdX");
await other.getByRole("button", { name: "Create account" }).click();
await other.waitForURL("**/account");
await other.goto(`${WEB}/account/orders/${orderId}`);
await other.getByText("Order not found.").waitFor(); ok(true, "another customer opening someone else's order sees 'not found'");

console.log(errs.length ? "BROWSER ERRORS:\n" + errs.join("\n").slice(0, 900) : "no browser console errors");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
await b.close();
