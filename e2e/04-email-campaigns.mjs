import { chromium } from "playwright-core";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const DB = { user: process.env.DB_USER ?? "pms", pass: process.env.DB_PASS ?? "", name: process.env.DB_NAME ?? "ecommerce_pms", host: process.env.DB_HOST ?? "127.0.0.1" };
const fixture = (f) => fileURLToPath(new URL("./fixtures/" + f, import.meta.url));

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const S = process.argv[2] ?? process.env.E2E_OUT ?? tmpdir();
const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const sql = (q) => execFileSync("mysql", ["-h" + DB.host, "-u" + DB.user, ...(DB.pass ? ["-p" + DB.pass] : []), DB.name, "-Nse", q], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const errs = []; let fails = 0;
const ok = (c, s) => { console.log(c ? "PASS" : "FAIL", s); if (!c) fails++; };
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console: " + m.text().slice(0, 200)); });

await page.goto(WEB + "/login");
await page.fill("#f-email", "admin@example.com"); await page.fill("#f-password", "Admin@12345");
await page.click("button:has-text('Sign in')"); await page.waitForURL("**/admin");

// ---------- template
await page.goto(WEB + "/admin/email/templates");
await page.getByText("No templates yet").waitFor(); ok(true, "templates: empty state");
await page.getByRole("link", { name: "New template" }).click();
await page.getByRole("button", { name: "Create template" }).click();
ok(await page.getByText("Name is required.").isVisible() && await page.getByText("Subject is required.").isVisible(), "template: client validation");
await page.getByLabel("Template name").fill("Spring sale");
await page.getByLabel("Email subject").fill("Spring sale for {{name}}");
await page.locator(".ProseMirror").click();
await page.keyboard.type("Hello {{name}}, enjoy 20% off.");
await page.getByRole("tab", { name: "HTML" }).click();
const src = await page.getByLabel("HTML source").inputValue();
ok(/Hello \{\{name\}\}, enjoy 20% off\./.test(src), "template: visual edits carry over into the HTML tab");
await page.getByLabel("HTML source").fill(src + '<p style="color:#c00">Limited time</p><script>alert(1)</script>');
await page.getByRole("button", { name: "Preview" }).click();
const fr = page.frameLocator('iframe[title="Email preview"]');
await fr.getByText("Unsubscribe").waitFor({ timeout: 10000 });
ok(await fr.getByText("Hello there, enjoy 20% off.").isVisible(), "preview: merge tag rendered with sample data");
ok(await fr.getByText("Limited time").isVisible() && (await fr.locator("script").count()) === 0, "preview: styled content kept, <script> removed");
ok(await fr.getByText(/Your Company/).isVisible(), "preview: compliance footer (unsubscribe + address) always present");
ok((await page.locator('iframe[title="Email preview"]').getAttribute("sandbox")) === "", "preview iframe is fully sandboxed");
await page.locator("dialog[open] button:has-text('Close')").click();
await page.getByRole("button", { name: "Create template" }).click();
await page.waitForURL("**/admin/email/templates");
await page.getByText("Spring sale").first().waitFor(); ok(true, "template saved and listed");
ok(!sql("select body_html from email_templates limit 1").includes("<script"), "template stored sanitised");

// ---------- subscribers
await page.goto(WEB + "/admin/email/subscribers");
await page.getByText("No subscribers found").waitFor();
const addBtn = page.getByRole("button", { name: "Add", exact: true });
await page.getByLabel("Email", { exact: true }).fill("first@e2e.test");
ok(await addBtn.isDisabled(), "add subscriber blocked until consent is ticked");
await page.getByLabel(/This person agreed/).check();
await addBtn.click();
await page.getByRole("cell", { name: "first@e2e.test" }).waitFor(); ok(true, "subscriber added with consent");
await page.getByRole("button", { name: "Import CSV" }).click();
const importBtn = page.getByRole("button", { name: "Import", exact: true });
ok(await importBtn.isDisabled(), "import blocked until consent is ticked");
await page.getByLabel("CSV file").setInputFiles(fixture("subscribers.csv"));
await page.getByLabel(/I confirm everyone/).check();
await importBtn.click();
const imp = page.locator('section[aria-label="Import subscribers"] p[role=status]');
await imp.waitFor();
const msg = await imp.innerText();
ok(/Added 3\./.test(msg) && /1 invalid/.test(msg) && /1 duplicate/.test(msg), "import summary reports added/invalid/duplicates: " + msg);
ok(sql("select count(*) from email_subscribers where email like '%@e2e.test'") === "4", "import stored only the valid, unique rows (+ the one added by hand)");
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
await dl.saveAs(S + "/subs-export.csv");
const csv = readFileSync(S + "/subs-export.csv", "utf8");
ok(csv.startsWith("email,name,status") && csv.includes("first@e2e.test") && csv.includes("imp1@e2e.test"), "export CSV downloaded with data");
ok(!/(^|,)=cmd/.test(csv) && (!csv.includes("cmd@e2e.test") || csv.includes("'=cmd")), "export neutralises spreadsheet formulas");

// ---------- opt-in at registration + account preferences
const c2 = await (await b.newContext()).newPage();
await c2.goto(WEB + "/register");
await c2.getByLabel("Full name").fill("Opt Customer"); await c2.locator("#f-email").fill("optin@e2e.test");
await c2.getByLabel("Password", { exact: true }).fill("Passw0rdX"); await c2.getByLabel("Confirm password").fill("Passw0rdX");
ok(!(await c2.getByLabel(/Send me product news/).isChecked()), "registration: marketing checkbox is NOT pre-ticked");
await c2.getByLabel(/Send me product news/).check();
await c2.getByRole("button", { name: "Create account" }).click();
await c2.waitForURL("**/account");
await c2.waitForFunction(() => { const l = [...document.querySelectorAll("label")].find((x) => x.textContent.trim() === "Send me product news and offers"); return !!l && !l.querySelector("input").disabled; });
ok(sql("select is_subscribed from email_subscribers where email='optin@e2e.test'") === "1", "opt-in at registration created a subscriber");
ok(await c2.getByLabel("Send me product news and offers", { exact: true }).isChecked(), "account page reflects subscription");
await c2.getByLabel("Send me product news and offers", { exact: true }).click();
await c2.getByText("You have been unsubscribed.").first().waitFor();
ok(sql("select is_subscribed from email_subscribers where email='optin@e2e.test'") === "0", "account toggle unsubscribes");
await c2.getByLabel("Send me product news and offers", { exact: true }).click();
await c2.waitForTimeout(600);
ok(sql("select is_subscribed from email_subscribers where email='optin@e2e.test'") === "1", "account toggle resubscribes (by the user themselves)");

// ---------- campaign
await page.goto(WEB + "/admin/email/campaigns");
await page.getByText("No campaigns yet").waitFor();
await page.getByRole("link", { name: "New campaign" }).click();
await page.getByLabel("Start from").selectOption({ label: "Spring sale" });
await page.getByRole("button", { name: "Create draft" }).click();
await page.waitForURL(/\/admin\/email\/campaigns\/\d+$/);
await page.getByLabel("Subject").waitFor();
ok((await page.getByLabel("Subject").inputValue()) === "Spring sale for {{name}}", "campaign draft copied from template");
await page.getByLabel("Subject").fill("Big spring sale, {{name}}");
await page.getByRole("button", { name: "Send test to me" }).click();
await page.getByText(/Test email sent to admin@example.com/).first().waitFor({ timeout: 15000 }); ok(true, "test email goes to the admin's own address");

await page.getByRole("button", { name: "Send Campaign" }).first().click();
const dlg = page.locator("dialog[open]");
await dlg.getByText(/opted-in subscribers/).waitFor();
const dtxt = await dlg.innerText();
const expected = sql("select count(*) from email_subscribers where is_subscribed=1 and bounced_at is null");
ok(new RegExp(`email\\s+${expected}\\s+opted-in`).test(dtxt.replace(/\n/g, " ")), `confirmation dialog states the exact recipient count (${expected})`);
const go = dlg.getByRole("button", { name: "Send Campaign" });
ok(await go.isDisabled(), "final Send button disabled until the confirmation box is ticked");
await dlg.getByLabel(/I have previewed/).check();
await go.click();
await page.locator("span:has-text('completed')").first().waitFor({ timeout: 60000 }); ok(true, "campaign runs in the background and reaches 'completed'");
const sent = await page.locator("dt:has-text('sent') + dd").first().innerText();
ok(sent === expected, `sent count (${sent}) equals recipients (${expected})`);
await page.locator("tbody tr").nth(Number(expected) - 1).waitFor({ timeout: 15000 });
ok((await page.locator("tbody tr:visible").count()) === Number(expected), "delivery log lists every recipient");
ok(sql("select count(*) from email_campaign_logs where status='sent'") === expected && sql("select count(distinct subscriber_id) from email_campaign_logs") === expected, "DB: one 'sent' log per recipient, no duplicates");
await page.getByRole("button", { name: "Send Campaign" }).count().then((n) => ok(n === 0, "no Send button once sent (can't be sent twice from the UI)"));

// ---------- public unsubscribe
const tok = sql("select unsubscribe_token from email_subscribers where email='imp1@e2e.test'");
const anon = await (await b.newContext()).newPage();
await anon.goto(`${WEB}/unsubscribe?token=${tok}`);
await anon.getByText(/im•+@e2e\.test/).first().waitFor(); ok(true, "unsubscribe page shows a masked address");
ok(sql("select is_subscribed from email_subscribers where email='imp1@e2e.test'") === "1", "merely opening the link does not unsubscribe");
await anon.getByRole("button", { name: "Unsubscribe" }).click();
await anon.getByRole("status").filter({ hasText: "is unsubscribed" }).waitFor();
ok(sql("select is_subscribed from email_subscribers where email='imp1@e2e.test'") === "0", "clicking Unsubscribe opts the person out");
await anon.goto(`${WEB}/unsubscribe?token=garbage`); await anon.getByText(/not valid/).waitFor(); ok(true, "invalid token handled");

// next campaign must exclude the unsubscribed person
await page.goto(WEB + "/admin/email/campaigns/new");
await page.getByRole("button", { name: "Create draft" }).click();
await page.waitForURL(/\/admin\/email\/campaigns\/\d+$/);
await page.getByRole("button", { name: "Send Campaign" }).first().click();
const exp2 = sql("select count(*) from email_subscribers where is_subscribed=1 and bounced_at is null");
await page.locator("dialog[open]").getByText(/opted-in subscribers/).waitFor();
ok(Number(exp2) === Number(expected) - 1, `second campaign excludes the person who unsubscribed (${exp2} vs ${expected})`);
await page.locator("dialog[open] button:has-text('Cancel')").click();

console.log(errs.length ? "BROWSER ERRORS:\n" + errs.join("\n").slice(0, 900) : "no browser console errors");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
await b.close();
