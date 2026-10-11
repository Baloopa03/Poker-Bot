// Scripted opponent styles for the simulator, plus the bot itself.
import { advise } from "../src/engine/advisor";
import { equity, rng } from "../src/engine/equity";
import { Range, classOf } from "../src/engine/range";
import { preflopScores } from "../src/engine/strength";
import { OpponentModel } from "../src/opponents/model";
import type { PlayerState, TableState } from "../src/tracker/types";
import type { Decision, Strategy } from "./game";

const ANY = Range.full();

interface Spot {
  pre: number; // preflop percentile of our hand (1 = AA)
  strength: number; // postflop strength vs a random hand (preflop: same as pre)
  toCall: number;
  pot: number;
  potOdds: number;
  raises: number; // bets/raises this street
  street: TableState["street"];
  bet: (fractionOfPot: number) => Decision;
  raise: (multipleOfBet: number) => Decision;
}

function spot(s: TableState, me: PlayerState): Spot {
  const [a, b] = s.heroCards;
  const pre = preflopScores().get(classOf(a, b))!;
  const strength = s.board.length >= 3 ? equity({ hero: [a, b], board: s.board, villains: [ANY], iterations: 300, seed: s.handNumber * 7 + s.board.length }).equity : pre;
  const toCall = Math.max(0, s.currentBet - me.committedStreet);
  const raises = s.actions.filter((x) => x.street === s.street && (x.type === "bet" || x.type === "raise")).length;
  return {
    pre,
    strength,
    toCall,
    pot: s.pot,
    potOdds: toCall / Math.max(1, s.pot + toCall),
    raises,
    street: s.street,
    bet: (f) => ({ type: "raise", to: s.currentBet + Math.max(s.bb, f * (s.pot + toCall)) }),
    raise: (m) => ({ type: "raise", to: Math.max(s.currentBet * m, s.currentBet + s.bb) }),
  };
}

const passive = (x: Spot): Decision => (x.toCall > 0 ? { type: "fold" } : { type: "check" });

/** Plays lots of hands, calls almost anything, only raises the nuts. */
export const callingStation =
  (seed = 1): Strategy =>
  (s, me) => {
    const r = rng(seed + s.handNumber * 97 + s.actions.length);
    const x = spot(s, me);
    if (x.street === "preflop") {
      if (x.pre > 0.95 && x.raises < 2) return x.raise(3);
      if (x.pre > 0.3 || x.toCall <= s.bb) return x.toCall ? { type: "call" } : { type: "check" };
      return passive(x);
    }
    if (x.toCall === 0) return x.strength > 0.88 && r() < 0.6 ? x.bet(0.5) : { type: "check" };
    if (x.strength > 0.96 && x.raises < 2) return x.raise(2.5);
    if (x.strength > 0.3 || x.potOdds < 0.2) return { type: "call" };
    return { type: "fold" };
  };

/** Only plays strong hands and gives up easily. */
export const nit =
  (seed = 2): Strategy =>
  (s, me) => {
    const x = spot(s, me);
    void seed;
    if (x.street === "preflop") {
      if (x.raises === 0 && x.pre > 0.85) return x.raise(2.5);
      if (x.pre > 0.95) return x.raise(3);
      if (x.pre > 0.9 && x.raises <= 1) return { type: "call" };
      return passive(x);
    }
    if (x.toCall === 0) return x.strength > 0.78 ? x.bet(0.66) : { type: "check" };
    if (x.strength > 0.93 && x.raises < 2) return x.raise(2.5);
    if (x.strength > 0.78) return { type: "call" };
    return { type: "fold" };
  };

/** Raises and bluffs constantly. */
export const maniac =
  (seed = 3): Strategy =>
  (s, me) => {
    const r = rng(seed + s.handNumber * 131 + s.actions.length);
    const x = spot(s, me);
    if (x.street === "preflop") {
      if (x.raises <= 2 && (x.pre > 0.7 || (x.pre > 0.35 && r() < 0.6))) return x.raise(3);
      if (x.pre > 0.3) return x.toCall ? { type: "call" } : { type: "check" };
      return passive(x);
    }
    if (x.toCall === 0) return r() < 0.7 ? x.bet(0.75) : { type: "check" };
    if (x.raises < 3 && (x.strength > 0.8 || r() < 0.2)) return x.raise(2.5);
    if (x.strength > 0.4 || r() < 0.25) return { type: "call" };
    return { type: "fold" };
  };

/** A reasonable regular: position-aware opens, value bets, some bluffs, pot-odds calls. */
export const solid =
  (seed = 4): Strategy =>
  (s, me) => {
    const r = rng(seed + s.handNumber * 173 + s.actions.length);
    const x = spot(s, me);
    const dealt = s.players.filter((p) => p.inHand).length;
    if (x.street === "preflop") {
      const open = dealt <= 2 ? 0.8 : me.position === "BTN" ? 0.5 : me.position === "SB" ? 0.45 : dealt <= 4 ? 0.35 : 0.2;
      if (x.raises === 0) return x.pre > 1 - open ? x.raise(2.5) : x.toCall <= 0 ? { type: "check" } : { type: "fold" };
      if (x.pre > 0.93 || (x.raises === 1 && x.pre > 0.85 && r() < 0.5)) return x.raise(3);
      if (x.pre > (x.raises === 1 ? 0.7 : 0.88)) return { type: "call" };
      return passive(x);
    }
    if (x.toCall === 0) {
      if (x.strength > 0.72) return x.bet(0.66);
      if (x.strength < 0.3 && r() < 0.3) return x.bet(0.5);
      return { type: "check" };
    }
    const ratio = x.toCall / Math.max(1, x.pot - x.toCall);
    if (x.strength > 0.92 && x.raises < 2) return x.raise(2.5);
    if (x.strength > 0.55 + 0.15 * Math.min(ratio, 2)) return { type: "call" };
    return { type: "fold" };
  };

/** The bot: whatever the advisor recommends, learning opponents as it goes. */
export function bot(model: OpponentModel, opts: { useReads?: boolean; iterations?: number } = {}): Strategy {
  return (s) => {
    const a = advise(s, model, { iterations: opts.iterations ?? 700, useReads: opts.useReads });
    if (!a) return { type: "check" };
    const b = a.best;
    if (b.action === "bet" || b.action === "raise") return { type: "raise", to: b.toTotal };
    return { type: b.action };
  };
}

export const STYLES: Record<string, (seed: number) => Strategy> = { station: callingStation, nit, maniac, solid };
