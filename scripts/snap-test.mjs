// Verifies solvability-filtered snap dots render and don't tank fps.
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

const cx = 640, cy = 400;
await page.mouse.move(cx, cy);
await page.mouse.down();
// Level 1's target is to the right; a dead-straight line is a collision
// course at every speed (verified in engine tests) — offset up a bit so
// some magnitudes land in the viable capture band, like a player slightly
// missing dead-center would.
await page.mouse.move(cx + 150, cy - 55, { steps: 15 });
// Let the throttled snap-dot recompute fire (180ms window) — give it a
// full second since each candidate is a real short sim.
await new Promise((r) => setTimeout(r, 1000));
const d1 = await page.evaluate(() => window.__orbitalDebug);
console.log("fps during drag (snap dots computing):", d1?.fps.toFixed(1));
await page.screenshot({ path: `${SHOT_DIR}/shot-snap-dots-filtered.png` });

// Nudge direction slightly to trigger a recompute, hold, check fps again.
await page.mouse.move(cx + 155, cy - 35, { steps: 5 });
await new Promise((r) => setTimeout(r, 400));
const d2 = await page.evaluate(() => window.__orbitalDebug);
console.log("fps after re-aim:", d2?.fps.toFixed(1));

await page.mouse.up();
await page.keyboard.press("Escape");

console.log("CONSOLE ERRORS:", errors.length ? errors : "none");
await browser.close();
