// End-to-end check that "Save capture" survives a page reload: replay a
// capture, reload the page, replay it again, then save and count entries.
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


let rounds = 0;
let resolveDone;
let done = new Promise((r) => (resolveDone = r));
await page.routeWebSocket(/socket\.io/, async (ws) => {
  rounds++;
  for (const e of entries) {
    if (e.dir === "meta" || e.eio === "ping" || e.eio === "pong") continue;
    const frame = encode(e);
    ws.send(e.dir === "out" ? "PBTEST:" + frame : frame);
    await new Promise((r) => setTimeout(r, 2));
  }
  resolveDone();
});
await page.goto("https://pokerpatio.com/mp?game=ROOMID");
await done;
await page.waitForTimeout(500);
done = new Promise((r) => (resolveDone = r));
await page.reload();
await done;
await page.waitForTimeout(800);
await page.evaluate(() => document.getElementById("pokerbot-overlay").shadowRoot.querySelector('[data-tab="ledger"]').click());
const [dl] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => document.getElementById("pokerbot-overlay").shadowRoot.querySelector('[data-act="capture"]').click())]);
const saved = JSON.parse(readFileSync(await dl.path(), "utf8"));
const sent = entries.filter((e) => !(e.dir === "meta" || e.eio === "ping" || e.eio === "pong")).length;
console.log("rounds", rounds, "fixture packets", sent, "saved entries", saved.entries.length, "reload markers", saved.entries.filter((e) => e.event === "page-reload").length);
await ctx.close();
