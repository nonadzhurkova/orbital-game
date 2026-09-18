// Quick check: does switching levels (Pixi scene rebuild) work?
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
  protocolTimeout: 30000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000));
for (const lvl of ["2", "5", "1"]) {
  console.log("pressing", lvl);
  await page.keyboard.press(lvl);
  await new Promise((r) => setTimeout(r, 2500));
  const d = await page.evaluate(() => window.__orbitalDebug);
  console.log("  ->", JSON.stringify(d));
}
console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
