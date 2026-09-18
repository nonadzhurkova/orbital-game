// Perf check under 4x CPU throttling (devtools-style), per level.
// Usage: node scripts/perf.mjs
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const url = `http://localhost:3000${process.env.NOBLOOM ? "?nobloom" : ""}`;
await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000));

const cdp = await page.createCDPSession();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

const readFps = async (ms) => {
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 300));
    const d = await page.evaluate(() => window.__orbitalDebug);
    if (d) samples.push(d.fps);
  }
  return samples.reduce((a, b) => a + b, 0) / samples.length;
};

const cx = 640, cy = 400;
const aimDragFps = async () => {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy - 40, { steps: 5 });
  const fps = await readFps(2000); // prediction recomputes while held
  await page.mouse.move(cx, cy, { steps: 3 }); // tiny dv: cancels on release
  await page.mouse.up();
  return fps;
};

for (const lvl of [1, 5]) {
  await page.keyboard.press(String(lvl));
  await new Promise((r) => setTimeout(r, 1200));
  const idle = await readFps(2000);
  const aiming = await aimDragFps();
  console.log(
    `level ${lvl} (4x throttle): idle ${idle.toFixed(1)} fps, aim-drag ${aiming.toFixed(1)} fps`,
  );
}
await browser.close();
