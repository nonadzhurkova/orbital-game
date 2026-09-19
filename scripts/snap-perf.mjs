// Perf check for snap-dot computation on the heaviest level (binary stars).
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

// Jump to level 5 via the ProfileHUD dev shortcut (key "5").
await page.keyboard.press("5");
await new Promise((r) => setTimeout(r, 1000));

const cx = 640, cy = 400;
await page.mouse.move(cx, cy);
await page.mouse.down();
const samples = [];
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(cx + i * 8, cy - i * 5, { steps: 2 });
  await new Promise((r) => setTimeout(r, 60));
  const d = await page.evaluate(() => window.__orbitalDebug);
  if (d) samples.push(d.fps);
}
await page.mouse.up();
await page.keyboard.press("Escape");

const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
const min = Math.min(...samples);
console.log(`level 5 drag fps: avg=${avg.toFixed(1)} min=${min.toFixed(1)}`);
await browser.close();
