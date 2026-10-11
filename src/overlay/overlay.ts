import type { Advice } from "../engine/advisor";
import { cardsToString, type Card } from "../engine/cards";
import type { OpponentModel, StatName } from "../opponents/model";
import type { LedgerEntry, TableState } from "../tracker/types";

// The on-table panel: advice, opponent HUD and the night's ledger. Lives in a
// shadow root so the game's CSS can't touch it (and vice versa).

const CSS = `
:host { all: initial; }
.panel { position: fixed; top: 72px; right: 16px; width: 320px; max-height: calc(100vh - 96px); overflow: auto;
  z-index: 2147483646; font: 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; color: #e8eaed;
  background: rgba(22, 24, 29, 0.94); border: 1px solid #3a3f4b; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.45); }
.panel.min .body { display: none; }
.head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: move; user-select: none; border-bottom: 1px solid #2c313b; }
.title { font-weight: 700; letter-spacing: .2px; }
.status { margin-left: auto; font-size: 11px; color: #9aa0a6; }
.btn { background: #2c313b; color: #e8eaed; border: 1px solid #3a3f4b; border-radius: 6px; padding: 2px 8px; font: inherit; font-size: 12px; cursor: pointer; }
.btn:hover { background: #363c48; }
.tabs { display: flex; gap: 4px; padding: 8px 10px 0; }
.tab { flex: 1; text-align: center; padding: 4px 0; border-radius: 6px 6px 0 0; cursor: pointer; color: #9aa0a6; border-bottom: 2px solid transparent; }
.tab.on { color: #e8eaed; border-bottom-color: #8ab4f8; }
.pane { padding: 10px; display: none; }
.pane.on { display: block; }
.cards { font-size: 20px; font-weight: 700; letter-spacing: 1px; }
.board { color: #9aa0a6; margin-top: 2px; }
.s, .c { color: #e8eaed; } .h, .d { color: #f28b82; }
.d { color: #8ab4f8; } .c { color: #81c995; }
.rec { margin: 10px 0 6px; padding: 10px; border-radius: 8px; font-size: 18px; font-weight: 800; text-align: center; }
.rec.fold { background: #3c1f1f; color: #f28b82; }
.rec.check, .rec.call { background: #1f2c3c; color: #8ab4f8; }
.rec.bet, .rec.raise { background: #1f3527; color: #81c995; }
.rec.wait { background: #24272e; color: #9aa0a6; font-size: 14px; font-weight: 600; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 6px 0; }
.kpi { background: #24272e; border-radius: 6px; padding: 6px; text-align: center; }
.kpi b { display: block; font-size: 16px; }
.kpi span { font-size: 11px; color: #9aa0a6; }
ul { margin: 6px 0; padding-left: 18px; } li { margin: 2px 0; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
td, th { padding: 3px 4px; text-align: right; border-bottom: 1px solid #2c313b; white-space: nowrap; }
td:first-child, th:first-child { text-align: left; }
tr.best td { color: #81c995; font-weight: 700; }
.muted { color: #9aa0a6; font-size: 11px; }
.pos { color: #81c995; } .neg { color: #f28b82; }
.villain { margin: 4px 0; }
.row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9aa0a6; margin-bottom: 8px; cursor: pointer; }
.scroll { overflow-x: auto; }
select { background: #2c313b; color: #e8eaed; border: 1px solid #3a3f4b; border-radius: 4px; font: inherit; font-size: 11px; max-width: 90px; }
`;

const SUIT_CLASS = ["c", "d", "h", "s"];
const SUIT_SYMBOL = ["♣", "♦", "♥", "♠"];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function cardHtml(cards: readonly Card[]): string {
  return cards
    .map((c) => {
      const s = cardsToString([c]);
      return `<span class="${SUIT_CLASS[c & 3]}">${s[0]}${SUIT_SYMBOL[c & 3]}</span>`;
    })
    .join(" ");
}

export interface OverlayActions {
  resetLedger(): void;
  saveCapture(): void;
  setUseReads(on: boolean): void;
  /** Merge profile `fromKey` into `intoKey` (same mate, different account). */
  merge(fromKey: string, intoKey: string): void;
  /** Set the person name and the in-game names that belong to them. */
  editPerson(key: string, label: string, names: string[], removed: string[]): void;
}

export class Overlay {
  private readonly root: ShadowRoot;
  private readonly panel: HTMLDivElement;
  private tab = "advice";
  private advice: Advice | null = null;
  private thinking = false;
  private useReads = true;

  constructor(private readonly actions: OverlayActions) {
    const host = document.createElement("div");
    host.id = "pokerbot-overlay";
    this.root = host.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${CSS}</style>
      <div class="panel">
        <div class="head"><span class="title">♠ Poker Bot</span><span class="status">waiting for game…</span>
          <button class="btn" data-act="min" title="Minimise (Alt+B)">–</button></div>
        <div class="body">
          <div class="tabs"><div class="tab on" data-tab="advice">Advice</div><div class="tab" data-tab="players">Players</div><div class="tab" data-tab="ledger">Ledger</div></div>
          <div class="pane on" data-pane="advice"></div>
          <div class="pane" data-pane="players"></div>
          <div class="pane" data-pane="ledger"></div>
        </div>
      </div>`;
    this.panel = this.root.querySelector(".panel")!;
    const mount = () => (document.body ?? document.documentElement).appendChild(host);
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);

    this.root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>("[data-tab]")?.dataset.tab;
      if (tab) this.showTab(tab);
      const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "min") this.panel.classList.toggle("min");
      if (act === "reset" && confirm("Reset the ledger for this lobby?")) this.actions.resetLedger();
      if (act === "capture") this.actions.saveCapture();
      if (act === "edit") this.editPerson(t.closest<HTMLElement>("[data-act]")!);
    });
    this.root.addEventListener("change", (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (t.dataset.act === "reads") this.actions.setUseReads((t as HTMLInputElement).checked);
      if (t.dataset.act === "merge" && t.value) {
        const from = t.dataset.key!;
        const fromName = t.dataset.name!;
        const intoName = (t as HTMLSelectElement).selectedOptions[0]?.textContent ?? t.value;
        if (confirm(`Merge ${fromName} into ${intoName}? Their history is combined and future hands from either account count as ${intoName}. This can't be undone.`))
          this.actions.merge(from, t.value);
        else t.value = "";
      }
    });
    window.addEventListener("keydown", (e) => {
      if (e.altKey && e.key.toLowerCase() === "b") this.panel.classList.toggle("min");
    });
    this.makeDraggable();
  }

  private editPerson(el: HTMLElement): void {
    const key = el.dataset.key!;
    const current = el.dataset.label ?? "";
    const names = (el.dataset.names ?? "").split("|").filter(Boolean);
    const label = prompt("Who is this? (e.g. Isaiah)", current || el.dataset.name || "");
    if (label === null) return;
    const list = prompt(
      `Names ${label || "they"} plays under, comma separated.\nAny guest using one of these names is counted as ${label || "this person"}.`,
      names.join(", "),
    );
    if (list === null) return;
    const next = list.split(",").map((n) => n.trim()).filter(Boolean);
    const removed = names.filter((n) => !next.some((m) => m.toLowerCase() === n.toLowerCase()));
    this.actions.editPerson(key, label, next, removed);
  }

  private makeDraggable(): void {
    const head = this.root.querySelector<HTMLElement>(".head")!;
    let dx = 0;
    let dy = 0;
    let dragging = false;
    head.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      dragging = true;
      const r = this.panel.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      this.panel.style.left = `${Math.max(0, e.clientX - dx)}px`;
      this.panel.style.top = `${Math.max(0, e.clientY - dy)}px`;
      this.panel.style.right = "auto";
    });
    window.addEventListener("mouseup", () => (dragging = false));
  }

  private showTab(tab: string): void {
    this.tab = tab;
    this.root.querySelectorAll<HTMLElement>("[data-tab]").forEach((el) => el.classList.toggle("on", el.dataset.tab === tab));
    this.root.querySelectorAll<HTMLElement>("[data-pane]").forEach((el) => el.classList.toggle("on", el.dataset.pane === tab));
  }

  private pane(name: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(`[data-pane="${name}"]`)!;
  }

  setStatus(text: string): void {
    this.root.querySelector(".status")!.textContent = text;
  }

  setThinking(on: boolean): void {
    this.thinking = on;
  }

  setAdvice(a: Advice | null): void {
    this.advice = a;
  }

  setUseReads(on: boolean): void {
    this.useReads = on;
  }

  render(s: TableState, model: OpponentModel, ledger: LedgerEntry[]): void {
    this.setStatus(s.handActive ? `hand ${s.handNumber} · ${s.street} · ${s.sb}/${s.bb}${s.paused ? " · paused" : ""}` : s.players.length ? "between hands" : "waiting for game…");
    this.renderAdvice(s);
    this.renderPlayers(s, model);
    this.renderLedger(ledger);
  }

  private renderAdvice(s: TableState): void {
    const hero = s.players.find((p) => p.seat === s.heroSeat);
    const heroTurn = !!hero && s.toActSeat === s.heroSeat;
    const a = heroTurn ? this.advice : null;
    let html = `<label class="toggle" title="Off: ignore what's been learned about your mates and treat everyone as a typical player">
      <input type="checkbox" data-act="reads" ${this.useReads ? "checked" : ""}> Use reads on mates</label>`;
    if (s.heroCards.length) html += `<div class="cards">${cardHtml(s.heroCards)}</div>`;
    html += `<div class="board">${s.board.length ? `Board ${cardHtml(s.board)}` : s.handActive ? "Preflop" : ""}${s.handActive ? ` · Pot ${s.pot}` : ""}</div>`;

    if (!s.handActive) html += `<div class="rec wait">Waiting for the next hand</div>`;
    else if (hero?.folded) html += `<div class="rec wait">Folded</div>`;
    else if (!heroTurn) html += `<div class="rec wait">Waiting for your turn</div>`;
    else if (!a) html += `<div class="rec wait">${this.thinking ? "Thinking…" : "Your turn"}</div>`;
    else {
      html += `<div class="rec ${a.best.action}">${esc(a.best.label)}</div>`;
      html += `<div class="kpis">
        <div class="kpi"><b>${pct(a.equity)}</b><span>win chance</span></div>
        <div class="kpi"><b>${a.toCall ? pct(a.potOdds) : "–"}</b><span>needed to call</span></div>
        <div class="kpi"><b>${a.toCall || 0}</b><span>to call</span></div></div>`;
      html += `<ul>${a.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
      html += `<table><tr><th>Option</th><th>EV (chips)</th></tr>${a.options
        .slice(0, 6)
        .map((o, i) => `<tr class="${i === 0 ? "best" : ""}"><td>${esc(o.label)}</td><td>${o.ev >= 0 ? "+" : ""}${o.ev.toFixed(1)}</td></tr>`)
        .join("")}</table>`;
      html += a.villains
        .map((v) => `<div class="villain"><b>${esc(v.name)}</b> <span class="muted">${v.position ?? ""} · top ${pct(v.rangeWidth)} · ${esc(v.style)}</span><br><span class="muted">${esc(v.likely.join(" "))}</span></div>`)
        .join("");
      if (!a.usedReads) html += `<div class="muted">Reads off: advice assumes typical opponents.</div>`;
      else if (!a.confident) html += `<div class="muted">Reads are still mostly default assumptions; they sharpen as hands are played.</div>`;
    }
    this.pane("advice").innerHTML = html;
  }

  private renderPlayers(s: TableState, model: OpponentModel): void {
    const heroKey = s.heroKey ? model.resolve(s.heroKey, s.players.find((p) => p.key === s.heroKey)?.name) : undefined;
    const keys: string[] = [];
    const add = (k: string, name?: string) => {
      const r = model.resolve(k, name);
      if (r !== heroKey && !keys.includes(r)) keys.push(r);
    };
    for (const p of s.players) if (p.seat !== s.heroSeat) add(p.key, p.name);
    for (const p of model.players.values()) add(p.key);
    const rows: Array<[string, StatName]> = [
      ["VPIP", "vpip"],
      ["Raise preflop", "pfr"],
      ["3-bet", "threeBet"],
      ["Fold to steal", "foldToSteal"],
      ["C-bet", "cbet"],
      ["Fold to c-bet", "foldToCbet"],
      ["Fold to flop bet", "foldToBetFlop"],
      ["Fold to turn bet", "foldToBetTurn"],
      ["Fold to river bet", "foldToBetRiver"],
      ["Raise vs bet", "raiseVsBet"],
      ["Bets when checked to", "betWhenCheckedTo"],
      ["Bluff share (shown)", "bluffShare"],
      ["Went to showdown", "wtsd"],
    ];
    if (!keys.length) {
      this.pane("players").innerHTML = `<div class="muted">No opponents seen yet.</div>`;
      return;
    }
    const dealt = Math.max(2, s.players.filter((p) => p.inHand).length || s.players.length);
    const profiles = keys.map((k) => model.profile(k, s.players.find((p) => p.key === k)?.name ?? k, dealt));
    const allNames = (k: string) => {
      const p = model.players.get(k);
      return p ? [...new Set([p.name, ...(p.aliasNames ?? [])])].filter((n) => n && n !== p.label) : [];
    };
    // With a person name set, list every in-game name; otherwise the old ones only.
    const aka = (k: string) => {
      const p = model.players.get(k);
      return allNames(k).filter((n) => p?.label || n !== p?.name);
    };
    let html = `<div class="scroll"><table><tr><th></th>${profiles
      .map((p) => `<th>${esc(p.name)}${aka(p.key).length ? `<br><span class="muted">${model.players.get(p.key)?.label ? "plays as" : "aka"} ${esc(aka(p.key).join(", "))}</span>` : ""}</th>`)
      .join("")}</tr>`;
    html += `<tr><td>Hands</td>${profiles.map((p) => `<td>${p.hands}</td>`).join("")}</tr>`;
    for (const [label, stat] of rows)
      html += `<tr><td>${label}</td>${profiles
        .map((p) => {
          const [, n] = p.raw(stat);
          return `<td title="${n} samples">${pct(p.stat(stat))}${n < 5 ? "*" : ""}</td>`;
        })
        .join("")}</tr>`;
    html += `<tr><td>Style</td>${profiles.map((p) => `<td>${esc(p.style.split(" (")[0])}</td>`).join("")}</tr>`;
    html += `<tr><td>Same person as…</td>${profiles
      .map(
        (p) => `<td><select data-act="merge" data-key="${esc(p.key)}" data-name="${esc(p.name)}"><option value="">–</option>${profiles
          .filter((o) => o.key !== p.key)
          .map((o) => `<option value="${esc(o.key)}">${esc(o.name)}</option>`)
          .join("")}</select></td>`,
      )
      .join("")}</tr>`;
    html += `<tr><td>Person</td>${profiles
      .map((p) => {
        const st = model.players.get(p.key);
        return `<td><button class="btn" data-act="edit" data-key="${esc(p.key)}" data-name="${esc(st?.name ?? p.name)}" data-label="${esc(st?.label ?? "")}" data-names="${esc(allNames(p.key).join("|"))}">Edit</button></td>`;
      })
      .join("")}</tr></table></div>`;
    html += `<div class="muted">Preflop numbers are for ${dealt <= 2 ? "heads-up" : dealt <= 4 ? "3–4 player" : "5+ player"} games. * fewer than 5 samples: mostly the default assumption. A guest who plays under a name already linked to someone is counted as that person automatically. Use <b>Edit</b> to give someone a name (e.g. Isaiah) and list the names they play under, or "Same person as…" to combine two columns.</div>`;
    this.pane("players").innerHTML = html;
  }

  private renderLedger(rows: LedgerEntry[]): void {
    let html = `<table><tr><th>Player</th><th>In</th><th>Out</th><th>Stack</th><th>Net</th></tr>`;
    for (const r of rows)
      html += `<tr><td>${esc(r.name)}</td><td>${r.buyIns}</td><td>${r.cashOuts}</td><td>${r.stack}</td><td class="${r.net >= 0 ? "pos" : "neg"}">${r.net >= 0 ? "+" : ""}${r.net}</td></tr>`;
    html += `</table><div class="muted">Net = cash-outs + stack − buy-ins. Re-buys and stack edits are picked up automatically.</div>
      <div class="row"><button class="btn" data-act="reset">Reset ledger</button><button class="btn" data-act="capture">Save capture (debug)</button></div>`;
    this.pane("ledger").innerHTML = html;
  }
}
