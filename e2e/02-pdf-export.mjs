import { chromium } from "playwright-core";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const DB = { user: process.env.DB_USER ?? "pms", pass: process.env.DB_PASS ?? "", name: process.env.DB_NAME ?? "ecommerce_pms", host: process.env.DB_HOST ?? "127.0.0.1" };
const fixture = (f) => fileURLToPath(new URL("./fixtures/" + f, import.meta.url));

import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
const S = process.argv[2] ?? process.env.E2E_OUT ?? tmpdir();
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
let fails = 0;
const ok = (c, s) => { console.log(c ? "PASS" : "FAIL", s); if (!c) fails++; };

await page.goto(WEB + "/login");
await page.fill("#f-email", "admin@example.com"); await page.fill("#f-password", "Admin@12345");
await page.click("button:has-text('Sign in')"); await page.waitForURL("**/admin");
await page.goto(WEB + "/admin/products");
await page.locator("tbody tr").first().waitFor();

ok(await page.getByRole("button", { name: /Export selected/ }).isDisabled(), "Export selected is disabled with nothing selected");
await page.locator("tbody input[type=checkbox]").nth(0).check();
await page.locator("tbody input[type=checkbox]").nth(1).check();
const btn = page.getByRole("button", { name: /Export selected \(2\)/ });
ok(await btn.isEnabled(), "Export selected (2) enabled after ticking two rows");

// selection survives paging
await page.getByRole("button", { name: "Next", exact: true }).click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: "Previous", exact: true }).click();
await page.waitForTimeout(800);
ok(await page.getByRole("button", { name: /Export selected \(2\)/ }).isEnabled(), "selection persists across pages");

await page.getByRole("button", { name: /Export selected \(2\)/ }).click();
ok(await page.locator("dialog[open]:has-text('Export to PDF?')").isVisible(), "confirmation dialog shown");
await page.locator("dialog[open] button:has-text('Start export')").click();
await page.waitForURL("**/admin/exports"); ok(true, "redirected to exports page");

const row = page.locator("tbody tr").first();
await row.locator("text=Selected").waitFor();
ok(true, "new export listed at the top as 'Selected (2)'");
await row.getByText("completed").waitFor({ timeout: 60000 }); ok(true, "export reaches 'completed' via polling");
ok(await row.locator("[role=progressbar][aria-valuenow='100']").count() === 1, "progress bar at 100%");

const [dl] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: "Download" }).click()]);
const file = S + "/ui-download.pdf";
await dl.saveAs(file);
const head = readFileSync(file).subarray(0, 5).toString();
ok(head === "%PDF-", "downloaded file is a PDF (" + statSync(file).size + " bytes)");
const pages = Number(execFileSync("pdfinfo", [file]).toString().match(/Pages:\s+(\d+)/)[1]);
const text = execFileSync("pdftotext", [file, "-"]).toString();
const names = (text.match(/^Demo Product \d+/gm) || []).length;
ok(names === 2, `PDF contains exactly the 2 selected products (found ${names}, ${pages} pages)`);

await page.screenshot({ path: S + "/exports.png" });
await page.goto(WEB + "/admin/products");
await page.locator("tbody tr").first().waitFor();
await page.getByRole("button", { name: "Export all to PDF" }).click();
ok(await page.locator("dialog[open]:has-text('Every product')").isVisible(), "export-all confirmation explains scope");
await page.locator("dialog[open] button:has-text('Cancel')").click();
await page.waitForTimeout(300);
ok(await page.locator("dialog[open]").count() === 0, "cancel closes dialog without starting an export");

console.log(errs.length ? "BROWSER ERRORS:\n" + errs.join("\n").slice(0, 800) : "no browser console errors");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
await b.close();
