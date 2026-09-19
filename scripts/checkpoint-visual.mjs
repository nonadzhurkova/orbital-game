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
await page.mouse.move(cx + 150, cy - 15, { steps: 20 }); // shallow, viable angle
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: `${SHOT_DIR}/shot-checkpoint-visual-aiming.png` });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 300));
await page.keyboard.press("Enter"); // commit launch
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${SHOT_DIR}/shot-checkpoint-visual-flying.png` });

console.log("CONSOLE ERRORS:", errors.length ? errors : "none");
await browser.close();
