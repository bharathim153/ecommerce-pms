import { chromium } from "playwright-core";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const DB = { user: process.env.DB_USER ?? "pms", pass: process.env.DB_PASS ?? "", name: process.env.DB_NAME ?? "ecommerce_pms", host: process.env.DB_HOST ?? "127.0.0.1" };
const fixture = (f) => fileURLToPath(new URL("./fixtures/" + f, import.meta.url));

const S = process.argv[2] ?? process.env.E2E_OUT ?? tmpdir();
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
let fails = 0;
const ok = (c, s) => { console.log(c ? "PASS" : "FAIL", s); if (!c) fails++; };

await page.goto(WEB + "/admin/products");
await page.waitForURL(/\/login\?next=/); ok(true, "unauthenticated /admin/products redirects to login");
await page.fill("#f-email", "admin@example.com");
await page.fill("#f-password", "Admin@12345");
await page.click("button:has-text('Sign in')");
await page.waitForURL("**/admin/products"); ok(true, "login returns to /admin/products");
await page.locator("text=No products found").waitFor({timeout:8000}); ok(true, "empty state shown");

await page.click("text=Add product");
await page.waitForURL("**/admin/products/new");
await page.click("button:has-text('Create product')");
ok(await page.locator("text=Name is required.").isVisible(), "client validation: name required");
ok(await page.locator("text=SKU: letters").isVisible(), "client validation: sku");

await page.fill("#f-name", "E2E Widget");
await page.fill("#f-sku", "E2E-1");
await page.getByLabel("Price (USD)").fill("42.50");
await page.selectOption("#status", "published");

// editor
const ed = page.locator(".ProseMirror");
await ed.click();
await page.click("[aria-label='Heading 2']");
await page.keyboard.type("Specifications");
await page.keyboard.press("Enter");
await page.keyboard.type("Plain paragraph with ");
await page.click("[aria-label='Bold']");
await page.keyboard.type("bold");
await page.click("[aria-label='Bold']");
await page.keyboard.press("Enter");
await page.click("[aria-label='Insert table']");
await page.keyboard.type("Key");
await page.keyboard.press("Tab");
await page.keyboard.type("Value");
ok(await page.locator("[aria-label='Add row below']").isVisible(), "table toolbar appears inside a table");
await page.click("[aria-label='Add row below']");
const png = fixture("pic.png");
await page.setInputFiles("div[role=toolbar] input[type=file]", png);
await page.waitForSelector(".ProseMirror img"); ok(true, "inline image uploaded and inserted in editor");
ok((await page.locator(".ProseMirror table").count()) === 1, "table present in editor");

// product image (queued until save)
await page.setInputFiles("section input[type=file][multiple]", [png]);
ok(await page.locator("text=Uploads on save").isVisible(), "product image queued");

// preview
await page.click("button:has-text('Preview')");
ok(await page.locator("dialog[open] .rich-content table").isVisible(), "preview renders table");
await page.click("dialog[open] button:has-text('Close')");

await page.click("button:has-text('Create product')");
await page.waitForURL("**/admin/products", { timeout: 10000 }); ok(true, "saved and redirected to list");
await page.locator("td:has-text('E2E Widget')").waitFor(); ok(true, "product in list");
await page.locator("tbody img:visible").first().waitFor(); ok((await page.locator("tbody img:visible").count()) === 1, "list shows product thumbnail (image uploaded on save)");

// search / filter
await page.fill("[aria-label='Search products']", "nomatch-xyz");
await page.waitForSelector("text=No products found"); ok(true, "search with no match shows empty state");
await page.fill("[aria-label='Search products']", "e2e-1");
await page.waitForSelector("td:has-text('E2E Widget')"); ok(true, "search by SKU finds product");

// edit round-trip
await page.click("text=Edit");
await page.waitForURL(/\/admin\/products\/\d+$/);
await page.waitForSelector(".ProseMirror table");
const html = await page.locator(".ProseMirror").innerHTML();
ok(/<h2[^>]*>Specifications/.test(html) && /<strong>bold<\/strong>/.test(html), "heading + bold persisted after reload");
ok((await page.locator(".ProseMirror table tr").count()) === 4, "table with 4 rows persisted");
ok((await page.locator(".ProseMirror img").count()) === 1, "inline image persisted");
ok((await page.locator("section ul > li:visible").count()) === 1 && (await page.getByText("Primary", { exact: true }).locator("visible=true").count()) === 1, "exactly one image, marked primary");
await page.screenshot({ path: S + "/edit.png", fullPage: true });

// delete via list with confirm
await page.goto(WEB + "/admin/products");
await page.locator("tbody button:has-text('Delete')").click();
ok(await page.locator("dialog[open]").isVisible(), "confirm dialog opens");
await page.click("dialog[open] button:has-text('Delete')");
await page.waitForSelector("text=No products found"); ok(true, "product deleted");

console.log(errs.length ? "BROWSER ERRORS:\n" + errs.join("\n") : "no browser console errors");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
await b.close();
