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
.addrow { display: flex; gap: 6px; margin-bottom: 8px; }
.addrow input { flex: 1; background: #24272e; color: #e8eaed; border: 1px solid #3a3f4b; border-radius: 6px; padding: 4px 8px; font: inherit; }
.sect { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #9aa0a6; margin: 10px 0 4px; }
.person { border: 1px dashed #3a3f4b; border-radius: 8px; padding: 6px 8px; margin: 6px 0; }
.person.over { border-color: #8ab4f8; background: #1f2c3c; }
.phead { display: flex; align-items: center; gap: 6px; }
.phead .muted { margin-left: auto; }
.icon { background: none; border: 0; color: #9aa0a6; cursor: pointer; font-size: 13px; padding: 0 2px; }
.icon:hover { color: #e8eaed; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.chip { display: inline-flex; align-items: center; gap: 2px; background: #2c313b; border-radius: 12px; padding: 1px 4px 1px 8px; font-size: 12px; }
.x { background: none; border: 0; color: #9aa0a6; cursor: pointer; font-size: 13px; line-height: 1; }
.x:hover { color: #f28b82; }
.loose { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 6px; margin: 3px 0; background: #24272e; border-radius: 6px; cursor: grab; }
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
  /** Create a person (e.g. "Isaiah"); returns their key. */
  createPerson(label: string): string;
  /** Put an in-game name (and its history) under a person. */
  assign(nameKey: string, personKey: string): void;
  removeName(personKey: string, name: string): void;
  renamePerson(personKey: string, label: string): void;
  forget(key: string): void;
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
          <div class="tabs"><div class="tab on" data-tab="advice">Advice</div><div class="tab" data-tab="players">Stats</div><div class="tab" data-tab="people">People</div><div class="tab" data-tab="ledger">Ledger</div></div>
          <div class="pane on" data-pane="advice"></div>
          <div class="pane" data-pane="players"></div>
          <div class="pane" data-pane="people"></div>
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
      if (act === "min") {
        this.panel.classList.toggle("min");
        this.saveLayout();
      }
      if (act === "reset" && confirm("Reset the ledger for this lobby?")) this.actions.resetLedger();
      if (act === "capture") this.actions.saveCapture();
      const el = t.closest<HTMLElement>("[data-act]");
      if (act === "add-person") this.addPerson();
      if (act === "remove-name") this.actions.removeName(el!.dataset.key!, el!.dataset.name!);
      if (act === "rename") {
        const label = prompt("Rename this person:", el!.dataset.label ?? "");
        if (label?.trim()) this.actions.renamePerson(el!.dataset.key!, label.trim());
      }
      if (act === "forget" && confirm(`Forget ${el!.dataset.label} and everything learned about them?`)) this.actions.forget(el!.dataset.key!);
    });
    this.root.addEventListener("change", (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (t.dataset.act === "reads") this.actions.setUseReads((t as HTMLInputElement).checked);
      if (t.dataset.act === "assign" && t.value) {
        let person = t.value;
        if (person === "__new") {
          const label = prompt(`Who is ${t.dataset.name}? (e.g. Isaiah)`, "");
          if (!label?.trim()) {
            t.value = "";
            return;
          }
          person = this.actions.createPerson(label.trim());
        }
        this.actions.assign(t.dataset.key!, person);
      }
    });
    this.root.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if ((ke.target as HTMLElement).id === "pb-new-person" && ke.key === "Enter") this.addPerson();
      ke.stopPropagation(); // typing in the panel must not trigger game hotkeys
    });
    // Drag a name onto a person.
    this.root.addEventListener("dragstart", (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>("[data-drag]")?.dataset.drag;
      if (key) (e as DragEvent).dataTransfer?.setData("text/plain", key);
    });
    this.root.addEventListener("dragover", (e) => {
      const drop = (e.target as HTMLElement).closest<HTMLElement>("[data-drop]");
      if (drop) {
        e.preventDefault();
        drop.classList.add("over");
      }
    });
    this.root.addEventListener("dragleave", (e) => (e.target as HTMLElement).closest<HTMLElement>("[data-drop]")?.classList.remove("over"));
    this.root.addEventListener("drop", (e) => {
      const drop = (e.target as HTMLElement).closest<HTMLElement>("[data-drop]");
      const key = (e as DragEvent).dataTransfer?.getData("text/plain");
      if (!drop || !key) return;
      e.preventDefault();
      drop.classList.remove("over");
      if (key !== drop.dataset.drop) this.actions.assign(key, drop.dataset.drop!);
    });
    window.addEventListener("keydown", (e) => {
      if (e.altKey && e.key.toLowerCase() === "b") {
        this.panel.classList.toggle("min");
        this.saveLayout();
      }
    });
    this.makeDraggable();
    this.restoreLayout();
  }

  private saveLayout(): void {
    try {
      localStorage.setItem(
        "pokerbot:layout",
        JSON.stringify({ left: this.panel.style.left, top: this.panel.style.top, min: this.panel.classList.contains("min"), tab: this.tab }),
      );
    } catch {
      /* storage blocked: layout just isn't remembered */
    }
  }

  private restoreLayout(): void {
    try {
      const l = JSON.parse(localStorage.getItem("pokerbot:layout") ?? "null");
      if (!l) return;
      if (l.left && l.top && parseInt(l.left) < window.innerWidth - 60 && parseInt(l.top) < window.innerHeight - 40) {
        this.panel.style.left = l.left;
        this.panel.style.top = l.top;
        this.panel.style.right = "auto";
      }
      if (l.min) this.panel.classList.add("min");
      if (l.tab) this.showTab(l.tab);
    } catch {
      /* ignore */
    }
  }

  private addPerson(): void {
    const input = this.root.querySelector<HTMLInputElement>("#pb-new-person");
    const label = input?.value.trim();
    if (!label) return;
    this.actions.createPerson(label);
    input!.value = "";
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
    window.addEventListener("mouseup", () => {
      if (dragging) this.saveLayout();
      dragging = false;
    });
  }

  private showTab(tab: string): void {
    this.tab = tab;
    if (this.panel) this.saveLayout();
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
    this.renderPeople(model);
    this.renderLedger(ledger.map((r) => {
      const person = model.displayName(model.resolve(r.key, r.name));
      return { ...r, name: person && person !== r.key && person !== r.name ? `${person} (${r.name})` : r.name };
    }));
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
        <div class="kpi"><b>${a.potOdds ? pct(a.potOdds) : "–"}</b><span>needed to call</span></div>
        <div class="kpi"><b>${a.toCall || 0}</b><span>to call</span></div></div>`;
      html += `<ul>${a.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
      html += `<table><tr><th>Option</th><th>EV (chips)</th></tr>${a.options
        .slice(0, 6)
        .map((o, i) => `<tr class="${i === 0 ? "best" : ""}"><td>${esc(o.label)}</td><td>${o.ev >= 0 ? "+" : ""}${o.ev.toFixed(1)}</td></tr>`)
        .join("")}</table>`;
      html += a.villains
        .map((v) => {
          const width = v.likely[0] === "any two cards" ? "any hand" : `top ${pct(v.rangeWidth)} of hands`;
          const style = v.style.startsWith("unknown") ? "still learning" : v.style;
          const likely = v.likely[0] === "any two cards" ? "" : `<br><span class="muted">Likely: ${esc(v.likely.join(" "))}</span>`;
          return `<div class="villain"><b>${esc(v.name)}</b> <span class="muted">${v.position ?? ""} · ${width} · ${esc(style)}</span>${likely}</div>`;
        })
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
      if (r !== heroKey && !model.players.get(r)?.me && !keys.includes(r)) keys.push(r);
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
    html += `</table></div>`;
    html += `<div class="muted">Preflop numbers are for ${dealt <= 2 ? "heads-up" : dealt <= 4 ? "3–4 player" : "5+ player"} games. * fewer than 5 samples: mostly the default assumption. Use the People tab to put each mate's names under one person.</div>`;
    this.pane("players").innerHTML = html;
  }

  private peopleSig = "";
  private renderPeople(model: OpponentModel): void {
    const people = model.people();
    const loose = model.unassigned();
    // Only redraw when something changed, so typing a name isn't interrupted.
    const sig = JSON.stringify([people.map((p) => [p.key, p.label, p.hands, model.namesOf(p.key)]), loose.map((p) => [p.key, p.name, p.hands])]);
    if (sig === this.peopleSig) return;
    this.peopleSig = sig;
    const options = people.map((p) => `<option value="${esc(p.key)}">${esc(p.label!)}</option>`).join("");
    let html = `<div class="addrow"><input id="pb-new-person" placeholder="Add a person, e.g. Isaiah" autocomplete="off"><button class="btn" data-act="add-person">Add</button></div>`;
    html += `<div class="sect">People</div>`;
    if (!people.length) html += `<div class="muted">No people yet. Add your mates above, then drag their names onto them.</div>`;
    for (const p of people) {
      const names = model.namesOf(p.key);
      html += `<div class="person" data-drop="${esc(p.key)}">
        <div class="phead"><b>${esc(p.label!)}</b><span class="muted">${p.hands} hands</span>
          <button class="icon" title="Rename" data-act="rename" data-key="${esc(p.key)}" data-label="${esc(p.label!)}">✎</button>
          <button class="icon" title="Forget" data-act="forget" data-key="${esc(p.key)}" data-label="${esc(p.label!)}">🗑</button></div>
        <div class="chips">${
          names.length
            ? names.map((n) => `<span class="chip">${esc(n)}<button class="x" title="Not ${esc(p.label!)}" data-act="remove-name" data-key="${esc(p.key)}" data-name="${esc(n)}">×</button></span>`).join("")
            : `<span class="muted">Drag names here</span>`
        }</div></div>`;
    }
    html += `<div class="sect">Names not assigned yet</div>`;
    if (!loose.length) html += `<div class="muted">Every opponent name is assigned.</div>`;
    for (const p of loose)
      html += `<div class="loose" draggable="true" data-drag="${esc(p.key)}"><span>⠿ ${esc(p.name)} <span class="muted">${p.hands} hands</span></span>
        <select data-act="assign" data-key="${esc(p.key)}" data-name="${esc(p.name)}"><option value="">Add to…</option>${options}<option value="__new">New person…</option></select></div>`;
    html += `<div class="muted">A name you've assigned is recognised automatically on future nights. Removing a name stops future games counting towards that person; stats already combined stay.</div>`;
    this.pane("people").innerHTML = html;
  }

  private renderLedger(rows: LedgerEntry[]): void {
    let html = `<table><tr><th>Player</th><th>In</th><th>Out</th><th>Stack</th><th>Net</th></tr>`;
    for (const r of rows)
      html += `<tr><td>${esc(r.name)}</td><td>${r.buyIns}</td><td>${r.cashOuts}</td><td>${r.stack}</td><td class="${r.net >= 0 ? "pos" : "neg"}">${r.net >= 0 ? "+" : ""}${r.net}</td></tr>`;
    html += `</table><div class="muted">Net = cash-outs + stack − buy-ins. Re-buys and stack edits are picked up automatically.</div>
      <div class="row"><button class="btn" data-act="reset">Reset ledger</button><button class="btn" data-act="capture" title="Saves tonight's game data so a misread hand can be checked">Save capture</button></div>`;
    this.pane("ledger").innerHTML = html;
  }
}
