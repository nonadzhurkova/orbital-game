// End-to-end: help overlay renders, autopilot solves level 1 in the browser.
import puppeteer from "puppeteer-core";

const SHOT_DIR = process.env.SHOT_DIR ?? ".";
const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
  protocolTimeout: 60000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000));

// Help overlay.
await page.click('button[aria-label="How to play"]');
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${SHOT_DIR}/shot-help.png` });
await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 400));


// Autopilot on level 1.
await page.click('button[aria-label="Toggle autopilot"]');
let phase = "";
const t0 = Date.now();
let midShot = false;
while (Date.now() - t0 < 150000) {
  await new Promise((r) => setTimeout(r, 1000));
  const d = await page.evaluate(() => window.__orbitalDebug);
  phase = d?.phase ?? "?";
  if (!midShot && phase === "flying") {
    midShot = true;
    await page.screenshot({ path: `${SHOT_DIR}/shot-auto-flying.png` });
  }
  if (phase === "won" || phase === "lost") break;
}
console.log("autopilot result:", phase, `(${((Date.now() - t0) / 1000).toFixed(0)}s wall)`);
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${SHOT_DIR}/shot-auto-end.png` });

// Expand the flight log and screenshot it.
try {
  const buttons = await page.$$("button");
  for (const b of buttons) {
    const t = await b.evaluate((el) => el.textContent || "");
    if (t.includes("LOG") || t.toUpperCase().includes("AUTO") || t.includes("Launch")) {
      await b.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${SHOT_DIR}/shot-log.png` });
} catch (e) {
  console.log("log screenshot skipped:", e.message);
}
console.log("CONSOLE ERRORS:", errors.length ? errors : "none");
await browser.close();
if (phase !== "won") process.exit(1);
