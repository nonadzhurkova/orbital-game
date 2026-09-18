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
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push("PAGEERROR: " + err.message));
page.on("response", (res) => {
  if (res.status() >= 400) errors.push(`HTTP ${res.status()} ${res.url()}`);
});

await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${SHOT_DIR}/shot-1-initial.png` });

// Drag from screen center (probe is followed by camera => near center) to aim.
const cx = 640, cy = 400;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(cx + i * 12, cy - i * 4);
  await new Promise((r) => setTimeout(r, 40));
}
await page.screenshot({ path: `${SHOT_DIR}/shot-2-aiming.png` });
await page.mouse.up();
// Two-step aiming: release sets the aim, Enter commits the launch.
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: `${SHOT_DIR}/shot-2c-aim-set.png` });
await page.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 120));
const justAfterLaunch = await page.evaluate(() => window.__orbitalDebug);
console.log("after launch:", JSON.stringify(justAfterLaunch));
await page.screenshot({ path: `${SHOT_DIR}/shot-2b-launch.png` });
await new Promise((r) => setTimeout(r, 2900));
await page.screenshot({ path: `${SHOT_DIR}/shot-3-flying.png` });

// Speed up to see an outcome.
const buttons = await page.$$("button");
for (const b of buttons) {
  const t = await b.evaluate((el) => el.textContent);
  if (t === "10x") { await b.click(); break; }
}
await new Promise((r) => setTimeout(r, 5000));
await page.screenshot({ path: `${SHOT_DIR}/shot-4-later.png` });

const debug = await page.evaluate(() => window.__orbitalDebug);
console.log("final debug:", JSON.stringify(debug));
console.log("CONSOLE ERRORS:", errors.length ? errors : "none");
await browser.close();
