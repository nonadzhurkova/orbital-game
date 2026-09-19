// Verifies the drag tip actually LOCKS onto a viable green dot: small jitters
// in drag position near a viable magnitude should all resolve to the exact
// same aim magnitude (debug.aimMag), not drift with pixel-perfect grid math.
import puppeteer from "puppeteer-core";

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
// Known-viable heading from engine tests (offset up-right from the target).
await page.mouse.move(cx + 150, cy - 55, { steps: 20 });
await new Promise((r) => setTimeout(r, 900)); // let snapDots populate

const mags = [];
for (const dx of [149, 150, 151, 150, 149, 151, 150]) {
  await page.mouse.move(cx + dx, cy - 55, { steps: 3 });
  await new Promise((r) => setTimeout(r, 150));
  const d = await page.evaluate(() => window.__orbitalDebug);
  mags.push(d?.aimMag ?? null);
}
console.log("aim magnitudes across small jitters:", mags.map((m) => m?.toFixed(2)));
const distinct = new Set(mags.filter((m) => m !== null).map((m) => m.toFixed(2)));
console.log("distinct values:", distinct.size, "(1 means the tip locked onto one dot)");

await page.mouse.up();
await page.keyboard.press("Escape");
console.log("CONSOLE ERRORS:", errors.length ? errors : "none");
await browser.close();
