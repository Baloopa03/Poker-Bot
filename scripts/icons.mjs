// Render assets/icon.svg to the PNG sizes Chrome wants (run once; output is committed).
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
const svg = readFileSync("assets/icon.svg", "utf8");
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage();
mkdirSync("assets/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `assets/icons/icon${size}.png`, omitBackground: true });
}
await browser.close();
