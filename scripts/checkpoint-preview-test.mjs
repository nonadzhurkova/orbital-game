// Verifies checkpoint dots appear while AIMING (before Launch is pressed).
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

const cx = 640, cy = 400;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 150, cy - 55, { steps: 20 }); // known-viable heading
await new Promise((r) => setTimeout(r, 900)); // let checkpoints populate
const beforeLaunch = await page.evaluate(() => window.__orbitalDebug);
console.log("BEFORE launch (still dragging, not yet released):", JSON.stringify(beforeLaunch));
await page.screenshot({ path: `${SHOT_DIR}/shot-checkpoint-preview.png` });
await page.mouse.up(); // sets pendingAim, still not launched
await new Promise((r) => setTimeout(r, 700));
const pendingState = await page.evaluate(() => window.__orbitalDebug);
console.log("AFTER release, aim pending (not launched):", JSON.stringify(pendingState));
await page.screenshot({ path: `${SHOT_DIR}/shot-checkpoint-pending.png` });

console.log("CONSOLE ERRORS:", errors.length ? errors : "none");
await browser.close();
