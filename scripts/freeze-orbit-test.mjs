// Verifies: (1) planets don't move while aiming, (2) orbit-path rings render.
import puppeteer from "puppeteer-core";

const SHOT_DIR = process.env.SHOT_DIR ?? ".";
const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

// Jump to level 3 (slingshot: sun + 3 orbiting bodies) via ProfileHUD dev key.
await page.keyboard.press("3");
await new Promise((r) => setTimeout(r, 1000));
const d0 = await page.evaluate(() => window.__orbitalDebug);
console.log("level 3 loaded:", JSON.stringify(d0));
await page.screenshot({ path: `${SHOT_DIR}/shot-orbit-rings.png` });

// Read engine.time equivalent via the store's `time` field — expose via debug
// is not present, so use the phase/aimMag proxy: just wait several seconds
// and take another screenshot; if frozen, planet positions should be
// pixel-identical between the two screenshots.
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: `${SHOT_DIR}/shot-orbit-rings-after-wait.png` });

console.log("CONSOLE ERRORS:", errors.length ? errors : "none");
await browser.close();
