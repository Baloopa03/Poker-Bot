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
  createPerson(label) {
    const key = model.createPerson(label);
    peopleChanged();
    return key;
  },
  assign(nameKey, personKey) {
    model.merge(nameKey, personKey);
    peopleChanged();
  },
  removeName(personKey, name) {
    model.removeName(personKey, name);
    peopleChanged();
  },
  renamePerson(personKey, label) {
    model.setLabel(personKey, label);
    peopleChanged();
  },
  forget(key) {
    model.forget(key);
    peopleChanged();
  },
  exportData() {
    const data = { app: "poker-bot", version: 1, savedAt: new Date().toISOString(), model: model.toJSON(), settings: { useReads } };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    a.download = `poker-bot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importData(json) {
    try {
      const data = JSON.parse(json);
      if (data?.app !== "poker-bot" || !data.model) throw new Error("not a Poker Bot backup");
      model = OpponentModel.fromJSON(data.model);
      peopleChanged();
      alert("Backup restored.");
    } catch (e) {
      alert(`Couldn't restore: ${(e as Error).message}`);
    }
  },
  forgetEveryone() {
    model = new OpponentModel();
    peopleChanged();
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

function peopleChanged(): void {
  saveModel();
  recomputeAdvice();
  render();
}

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
  if (h.heroKey) model.markMe(h.heroKey, h.players.find((p) => p.key === h.heroKey)?.name);
  saveModel();
  saveLedger();
});

tracker.on("handShown", ({ history, key }) => {
  model.learnShown(history, key);
  saveModel();
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
