// End-to-end check: load the built extension in Chromium, serve a stand-in
// pokerpatio page, and replay a recorded capture through a mocked game socket.
import { chromium } from "playwright";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixture = process.argv[2] ?? "tests/fixtures/pokerpatio/3-handed-rebuy-cashout.json";
const shotDir = process.argv[3] ?? ".";
const entries = JSON.parse(readFileSync(fixture, "utf8")).entries;

const SIO = { CONNECT: 0, DISCONNECT: 1, EVENT: 2, ACK: 3 };
const EIO = { open: 0, close: 1, ping: 2, pong: 3, message: 4 };
function encode(e) {
  if (e.eio !== "message") return `${EIO[e.eio]}${e.data === undefined ? "" : JSON.stringify(e.data)}`;
  const head = `4${SIO[e.sio]}${e.ns ? e.ns + "," : ""}${e.ack ?? ""}`;
  if (e.sio === "EVENT") return head + JSON.stringify([e.event, ...(e.args ?? [])]);
  return head + (e.data === undefined ? "" : JSON.stringify(e.data));
}

const ext = resolve("extension");
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pb-")), {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1280, height: 860 },
});
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error" || m.text().includes("poker-bot")) console.log("[page]", m.text()); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.route("https://pokerpatio.com/**", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><body style="background:#0b5a2a;height:100vh;margin:0;font:16px sans-serif;color:#fff">
      <h1 style="padding:24px">Fake pokerpatio table</h1>
      <script>
        const ws = new WebSocket("wss://gs2.pokerpatio.com/mp/socket.io/?EIO=4&transport=websocket");
        ws.onmessage = (e) => { if (typeof e.data === "string" && e.data.startsWith("PBTEST:")) ws.send(e.data.slice(7)); };
      </script></body></html>`,
  }),
);

const stopAt = Number(process.env.STOP_AT ?? Infinity);
let resolveDone;
const done = new Promise((r) => (resolveDone = r));
await page.routeWebSocket(/socket\.io/, async (ws) => {
  for (const e of entries) {
    if (e.t > stopAt) break;
    if (e.dir === "meta" || e.eio === "ping" || e.eio === "pong") continue;
    const frame = encode(e);
    ws.send(e.dir === "out" ? "PBTEST:" + frame : frame);
    await new Promise((r) => setTimeout(r, 4));
  }
  resolveDone();
});

await page.goto("https://pokerpatio.com/mp?game=ROOMID");
await done;
await page.waitForTimeout(800);
const text = await page.evaluate(() => document.getElementById("pokerbot-overlay")?.shadowRoot?.querySelector(".panel")?.innerText ?? "NO OVERLAY");
console.log(text);
if (process.env.DETAILS) await page.evaluate(() => document.getElementById("pokerbot-overlay").shadowRoot.querySelector("details")?.setAttribute("open", ""));
await page.screenshot({ path: join(shotDir, "e2e-advice.png") });
await page.click('[data-act="settings"]');
await page.waitForTimeout(100);
await page.screenshot({ path: join(shotDir, "e2e-settings.png") });
await page.click('[data-act="close-settings"]');
for (const tab of ["players", "ledger"]) {
  await page.evaluate((t) => document.getElementById("pokerbot-overlay").shadowRoot.querySelector(`[data-tab="${t}"]`).click(), tab);
  await page.waitForTimeout(100);
  await page.screenshot({ path: join(shotDir, `e2e-${tab}.png`) });
  console.log(`--- ${tab} ---\n` + (await page.evaluate(() => document.getElementById("pokerbot-overlay").shadowRoot.querySelector(".pane.on").innerText)));
}
if (process.env.PEOPLE) {
  // Exercise the People tab like a user would.
  await page.click('[data-tab="people"]');
  for (const name of ["Isaiah", "Justin"]) {
    await page.fill("#pb-new-person", name);
    await page.click('[data-act="add-person"]');
    await page.waitForTimeout(100);
  }
  const isaiah = await page.getAttribute('.person:has-text("Isaiah")', "data-drop");
  await page.selectOption('.loose:has-text("Test2") select', isaiah);
  await page.waitForTimeout(150);
  await page.dragAndDrop('.loose:has-text("Test")', '.person:has-text("Justin")');
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shotDir, "e2e-people.png") });
  console.log("--- people ---\n" + (await page.evaluate(() => document.getElementById("pokerbot-overlay").shadowRoot.querySelector(".pane.on").innerText)));
}
await ctx.close();
