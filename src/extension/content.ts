// Extension content script (isolated world): receives decoded game packets
// from page.ts, keeps the table state, learns opponents and shows advice.
import type { Packet } from "../adapter/pokerpatio/socketio";
import { advise } from "../engine/advisor";
import { OpponentModel } from "../opponents/model";
import { Overlay } from "../overlay/overlay";
import { Tracker } from "../tracker/tracker";

const MODEL_KEY = "pb:model";
const SETTINGS_KEY = "pb:settings";
const LEDGER_PREFIX = "pb:ledger:";
const LEDGER_MAX_AGE_MS = 16 * 3600 * 1000;
const CAPTURE_LIMIT = 20000;

const tracker = new Tracker();
let model = new OpponentModel();
const capture: Packet[] = [];
const started = Date.now();
let ledgerRestored = false;
let useReads = true;

const overlay = new Overlay({
  resetLedger() {
    tracker.resetLedger();
    saveLedger();
    render();
  },
  saveCapture() {
    const redact = (k: string, v: unknown) => (/token|^auth$|authorization|pass|secret|cookie|session|jwt|email|^sid$/i.test(k) ? "[redacted]" : v);
    const blob = new Blob([JSON.stringify({ recorder: "extension", startedAt: new Date(started).toISOString(), entries: capture }, redact, 1)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pokerpatio-capture-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  setUseReads(on) {
    useReads = on;
    overlay.setUseReads(on);
    storage?.set({ [SETTINGS_KEY]: { useReads } });
    recomputeAdvice();
  },
  editPerson(key, label, names, removed) {
    for (const n of removed) model.removeName(key, n);
    for (const n of names) model.addName(key, n);
    model.setLabel(key, label);
    saveModel();
    recomputeAdvice();
    render();
  },
  merge(fromKey, intoKey) {
    model.merge(fromKey, intoKey);
    saveModel();
    recomputeAdvice();
    render();
  },
});

const storage = typeof chrome !== "undefined" ? chrome.storage?.local : undefined;

storage?.get([MODEL_KEY, SETTINGS_KEY]).then((v) => {
  if (v[MODEL_KEY]) model = OpponentModel.fromJSON(v[MODEL_KEY]);
  const settings = v[SETTINGS_KEY] as { useReads?: boolean } | undefined;
  if (settings?.useReads === false) {
    useReads = false;
    overlay.setUseReads(false);
  }
  render();
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveModel(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage?.set({ [MODEL_KEY]: model.toJSON() }), 1000);
}
function saveLedger(): void {
  if (!tracker.roomId) return;
  storage?.set({ [LEDGER_PREFIX + tracker.roomId]: { savedAt: Date.now(), rows: tracker.exportLedger() } });
}
async function restoreLedger(): Promise<void> {
  if (ledgerRestored || !tracker.roomId || !storage) return;
  ledgerRestored = true;
  const key = LEDGER_PREFIX + tracker.roomId;
  const v = await storage.get(key);
  const saved = v[key] as { savedAt: number; rows: ReturnType<Tracker["exportLedger"]> } | undefined;
  if (saved && Date.now() - saved.savedAt < LEDGER_MAX_AGE_MS) tracker.restoreLedger(saved.rows);
}

let renderQueued = false;
function render(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    overlay.render(tracker.state, model, tracker.ledger());
  });
}

let adviceToken = 0;
function recomputeAdvice(): void {
  const s = tracker.state;
  if (!s.heroSeat || s.toActSeat !== s.heroSeat) return;
  const token = ++adviceToken;
  overlay.setAdvice(null);
  overlay.setThinking(true);
  render();
  // Let the panel paint "Thinking…" before the (≈50–150 ms) calculation.
  setTimeout(() => {
    if (token !== adviceToken) return;
    try {
      overlay.setAdvice(advise(tracker.state, model, { useReads }));
    } catch (e) {
      console.warn("[poker-bot] advice failed", e);
    }
    overlay.setThinking(false);
    render();
  }, 30);
}
tracker.on("heroTurn", recomputeAdvice);

tracker.on("handComplete", (h) => {
  model.update(h);
  saveModel();
  saveLedger();
});

tracker.on("update", () => render());

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "pokerbot-page") return;
  const packet = e.data.packet as Packet;
  if (capture.length < CAPTURE_LIMIT) capture.push({ ...packet, t: Date.now() - started });
  const hadRoom = tracker.roomId;
  tracker.handle(packet);
  if (!hadRoom && tracker.roomId) void restoreLedger().then(render);
  if (packet.event === "player:game:action_taken" || packet.event === "game:player_turn_ended") adviceToken++;
});
