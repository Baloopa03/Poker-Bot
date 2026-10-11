// A small but complete No-Limit Hold'em cash-game engine for testing the bot:
// blinds, betting rounds, min-raises, all-ins, side pots, showdowns, re-buys.
// Each decision is handed to a strategy as the same TableState the extension
// builds from the real game, from that player's point of view.
import { type Card, fullDeck } from "../src/engine/cards";
import { evaluate, describe } from "../src/engine/evaluator";
import { rng } from "../src/engine/equity";
import type { ActionType, HandAction, HandHistory, PlayerState, Position, Street, TableState } from "../src/tracker/types";

export interface Decision {
  type: "fold" | "check" | "call" | "raise";
  /** Street total to raise/bet to. */
  to?: number;
}

export type Strategy = (state: TableState, me: PlayerState) => Decision;

export interface Seat {
  key: string;
  name: string;
  strategy: Strategy;
  stack: number;
  /** Chips won minus chips bought in, over the session. */
  net: number;
  buyIns: number;
}

interface Live extends PlayerState {
  hole: Card[];
  acted: boolean;
}

export interface GameConfig {
  sb: number;
  bb: number;
  startStack: number;
  /** Re-buy to startStack when a player busts; cap stacks (cash out above) like the home game. */
  cashOutAbove?: number;
  seed?: number;
}

export class Game {
  private readonly random: () => number;
  private button = 0;
  handNumber = 0;
  readonly observers: Array<(h: HandHistory, perspectiveOf: (key: string) => HandHistory) => void> = [];

  constructor(
    readonly seats: Seat[],
    readonly cfg: GameConfig,
  ) {
    this.random = rng(cfg.seed ?? 1);
    for (const s of seats) {
      s.stack = cfg.startStack;
      s.buyIns = cfg.startStack;
      s.net = 0;
    }
  }

  private shuffle(): Card[] {
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i--) {
      const j = (this.random() * (i + 1)) | 0;
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  playHand(): void {
    const { sb, bb } = this.cfg;
    this.handNumber++;
    // Re-buys and cash-outs between hands.
    for (const s of this.seats) {
      if (s.stack <= 0) {
        s.stack = this.cfg.startStack;
        s.buyIns += this.cfg.startStack;
      }
      if (this.cfg.cashOutAbove && s.stack >= this.cfg.cashOutAbove) s.stack = this.cfg.startStack; // the excess stays in s.net via settle()
    }
    const n = this.seats.length;
    this.button = (this.button + 1) % n;
    const deck = this.shuffle();
    const players: Live[] = this.seats.map((s, i) => ({
      key: s.key,
      name: s.name,
      id: i + 1,
      seat: `s${i + 1}`,
      stack: s.stack,
      startStack: s.stack,
      committedStreet: 0,
      committedHand: 0,
      inHand: true,
      folded: false,
      allIn: false,
      cards: [],
      hole: [deck.pop()!, deck.pop()!],
      acted: false,
    }));
    // Seats in order starting after the button: SB, BB, …, BTN.
    const order = [...players.slice(this.button + 1), ...players.slice(0, this.button + 1)];
    assignPositions(order);
    const sbP = n === 2 ? order[1] : order[0];
    const bbP = n === 2 ? order[0] : order[1];

    const state: TableState = {
      handNumber: this.handNumber,
      handActive: true,
      street: "preflop",
      sb,
      bb,
      board: [],
      players,
      buttonSeat: order[n - 1].seat,
      sbSeat: sbP.seat,
      bbSeat: bbP.seat,
      heroCards: [],
      currentBet: 0,
      lastRaiseSize: bb,
      pot: 0,
      actions: [],
      paused: false,
    };

    const commit = (p: Live, amount: number, type: ActionType): void => {
      const facing = state.currentBet;
      const raisesBefore = state.actions.filter((a) => a.street === state.street && (a.type === "bet" || a.type === "raise")).length;
      const added = Math.min(amount, p.stack);
      const potBefore = state.pot;
      p.stack -= added;
      p.committedStreet += added;
      p.committedHand += added;
      state.pot += added;
      if (p.stack === 0 && added > 0) p.allIn = true;
      state.actions.push({ key: p.key, seat: p.seat, street: state.street as Street, type, added, toTotal: p.committedStreet, facing, potBefore, allIn: p.allIn && added > 0, raisesBefore, auto: false });
    };

    commit(sbP, sb, "post");
    commit(bbP, bb, "post");
    state.currentBet = Math.max(sbP.committedStreet, bbP.committedStreet);

    const live = () => players.filter((p) => !p.folded);
    const canAct = () => players.filter((p) => !p.folded && !p.allIn);

    const bettingRound = (first: Live[]): void => {
      for (const p of players) p.acted = false;
      let idx = 0;
      let guard = 0;
      while (guard++ < 500) {
        if (live().length <= 1) return;
        const actors = canAct();
        if (actors.length === 0) return;
        // Everyone else is all-in and nothing is left to call: no more betting.
        if (actors.length === 1 && actors[0].committedStreet >= state.currentBet) return;
        if (actors.every((p) => p.acted && p.committedStreet === state.currentBet)) return;
        const p = first[idx % first.length];
        idx++;
        if (p.folded || p.allIn) continue;
        if (p.acted && p.committedStreet === state.currentBet) continue;
        this.decide(state, p, commit);
      }
    };

    // Preflop: first to act is after the big blind (heads-up: the button/SB).
    const preOrder = n === 2 ? [order[1], order[0]] : [...order.slice(2), order[0], order[1]];
    bettingRound(preOrder);

    const streets: Array<[Street, number]> = [
      ["flop", 3],
      ["turn", 1],
      ["river", 1],
    ];
    for (const [street, count] of streets) {
      if (live().length <= 1) break;
      state.street = street;
      for (let i = 0; i < count; i++) state.board.push(deck.pop()!);
      for (const p of players) p.committedStreet = 0;
      state.currentBet = 0;
      state.lastRaiseSize = bb;
      if (canAct().length >= 2) bettingRound(n === 2 ? [order[0], order[1]] : order);
    }

    // ---- settle ----
    state.street = "showdown";
    const result = settle(players, state.board);
    for (const p of players) {
      p.stack += (result.won[p.key] ?? 0) + (result.refunded[p.key] ?? 0);
    }
    for (const [i, s] of this.seats.entries()) {
      const before = s.stack;
      s.stack = players[i].stack;
      s.net += s.stack - before;
    }

    const base: HandHistory = {
      handNumber: this.handNumber,
      sb,
      bb,
      board: state.board.slice(),
      players: players.map(({ key, name, seat, startStack, position }) => ({ key, name, seat, startStack, position })),
      actions: state.actions,
      result,
    };
    const perspective = (key: string): HandHistory => {
      const me = players.find((p) => p.key === key)!;
      const shown = Object.fromEntries(Object.entries(result.shown).filter(([k]) => k !== key));
      return { ...base, heroKey: key, heroCards: me.hole.slice(), result: { ...result, shown } };
    };
    for (const o of this.observers) o(base, perspective);
  }

  private decide(state: TableState, p: Live, commit: (p: Live, amount: number, type: ActionType) => void): void {
    const view: TableState = {
      ...state,
      players: state.players.map((q) => ({ ...q, cards: [] })),
      heroSeat: p.seat,
      heroKey: p.key,
      heroCards: p.hole.slice(),
      toActSeat: p.seat,
    };
    const seat = this.seats.find((s) => s.key === p.key)!;
    let d: Decision;
    try {
      d = seat.strategy(view, view.players.find((q) => q.seat === p.seat)!);
    } catch (e) {
      console.error("strategy error", e);
      d = { type: "fold" };
    }
    const toCall = Math.min(state.currentBet - p.committedStreet, p.stack);
    const maxTo = p.committedStreet + p.stack;
    const othersCanAct = state.players.some((q) => q !== p && !q.folded && !q.allIn);
    if (d.type === "raise" && (p.stack <= toCall || !othersCanAct)) d = { type: toCall > 0 ? "call" : "check" };
    if (d.type === "check" && toCall > 0) d = { type: "fold" };
    if (d.type === "fold" && toCall <= 0) d = { type: "check" };

    if (d.type === "fold") {
      p.folded = true;
      commit(p, 0, "fold");
    } else if (d.type === "check") commit(p, 0, "check");
    else if (d.type === "call") commit(p, toCall, "call");
    else {
      const minTo = state.currentBet + Math.max(state.lastRaiseSize, state.bb);
      let to = Math.round(Math.max(minTo, d.to ?? minTo));
      if (to > maxTo || maxTo - to < state.bb) to = maxTo;
      const facing = state.currentBet;
      commit(p, to - p.committedStreet, facing === 0 ? "bet" : "raise");
      const size = p.committedStreet - facing;
      if (size >= state.lastRaiseSize) state.lastRaiseSize = size;
      if (p.committedStreet > state.currentBet) {
        state.currentBet = p.committedStreet;
        for (const q of state.players as Live[]) if (q !== p) q.acted = false;
      }
    }
    p.acted = true;
  }
}

function assignPositions(order: PlayerState[]): void {
  const n = order.length;
  if (n === 2) {
    order[1].position = "SB";
    order[0].position = "BB";
    return;
  }
  const mids = n - 3;
  const labels: Position[] = ["SB", "BB", ...(mids <= 0 ? [] : mids === 1 ? ["UTG"] : mids === 2 ? ["UTG", "CO"] : ["UTG", ...Array(mids - 2).fill("MP"), "CO"]), "BTN"] as Position[];
  order.forEach((p, i) => (p.position = labels[i]));
}

/** Award the pot(s): side pots by contribution level, ties split, uncalled chips refunded. */
export function settle(players: Array<PlayerState & { hole: Card[] }>, board: Card[]) {
  const won: Record<string, number> = {};
  const refunded: Record<string, number> = {};
  const shown: Record<string, Card[]> = {};
  const descriptions: Record<string, string> = {};
  const contenders = players.filter((p) => !p.folded);
  const scores = new Map<string, number>();
  const showdown = contenders.length > 1 && board.length === 5;
  if (showdown)
    for (const p of contenders) {
      const sc = evaluate([...p.hole, ...board]);
      scores.set(p.key, sc);
      shown[p.key] = p.hole.slice();
      descriptions[p.key] = describe(sc);
    }
  const levels = [...new Set(players.map((p) => p.committedHand).filter((x) => x > 0))].sort((a, b) => a - b);
  let prev = 0;
  let pot = 0;
  for (const level of levels) {
    const payers = players.filter((p) => p.committedHand >= level);
    const layer = (level - prev) * payers.length;
    prev = level;
    const eligible = contenders.filter((p) => p.committedHand >= level);
    if (payers.length === 1 && eligible.length === 1 && eligible[0] === payers[0]) {
      refunded[payers[0].key] = (refunded[payers[0].key] ?? 0) + layer;
      continue;
    }
    pot += layer;
    let winners = eligible;
    if (showdown && eligible.length > 1) {
      const best = Math.max(...eligible.map((p) => scores.get(p.key)!));
      winners = eligible.filter((p) => scores.get(p.key) === best);
    }
    if (!winners.length) winners = contenders;
    const share = Math.floor(layer / winners.length);
    winners.forEach((w, i) => (won[w.key] = (won[w.key] ?? 0) + share + (i === 0 ? layer - share * winners.length : 0)));
  }
  return { won, refunded, pot, shown, descriptions };
}
