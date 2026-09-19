// Verifies: level persistence across reload, level-select panel (lock state,
// jump), and the aim snap-dot ladder while dragging.
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
page.on("response", (res) => { if (res.status() >= 400) errors.push(`HTTP ${res.status()} ${res.url()}`); });

await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

// --- Aim snap-dot ladder ---
const cx = 640, cy = 400;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 140, cy - 60, { steps: 12 });
await new Promise((r) => setTimeout(r, 150));
await page.screenshot({ path: `${SHOT_DIR}/shot-snap-dots.png` });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 200));
await page.keyboard.press("Escape"); // cancel, don't actually launch

// --- Level select panel ---
// Click the level name button (opens the level-select overlay).
const levelBtn = await page.$('button[aria-label="Change level"]');
if (levelBtn) await levelBtn.click();
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${SHOT_DIR}/shot-level-select.png` });

// Jump to level 3 (should be locked, since nothing's been won yet).
const buttons = await page.$$("button");
let level3Locked = null;
for (const b of buttons) {
  const t = await b.evaluate((el) => el.textContent || "");
  if (t.trim() === "3") {
    level3Locked = await b.evaluate((el) => el.disabled);
    break;
  }
}
console.log("level 3 locked initially:", level3Locked);

// Jump to level 2 (should be locked too, since level 1 isn't won).
let level2Locked = null;
for (const b of buttons) {
  const t = await b.evaluate((el) => el.textContent || "");
  if (t.trim() === "2") {
    level2Locked = await b.evaluate((el) => el.disabled);
    break;
  }
}
console.log("level 2 locked initially:", level2Locked);

await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 300));

// --- Level persistence across reload ---
// Manually bump localStorage progress to simulate having played level 2,
// then set the last-played level and reload to confirm it's restored.
await page.evaluate(() => {
  localStorage.setItem(
    "orbital-golf-progress",
    JSON.stringify({
      state: { lastLevelIndex: 2, bestStars: { 0: 3, 1: 2 } },
      version: 0,
    }),
  );
});
await page.reload({ waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1500));
const debugAfterReload = await page.evaluate(() => window.__orbitalDebug);
console.log("debug after reload (should reflect level 3 bodies):", JSON.stringify(debugAfterReload));
await page.screenshot({ path: `${SHOT_DIR}/shot-restored-level.png` });

// Confirm level select now shows levels 1-3 unlocked (bestStars had 0,1 won).
const levelBtn2 = await page.$('button[aria-label="Change level"]');
if (levelBtn2) await levelBtn2.click();
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${SHOT_DIR}/shot-level-select-unlocked.png` });

console.log("CONSOLE ERRORS:", errors.length ? errors : "none");
await browser.close();
