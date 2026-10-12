import type { Card } from "../engine/cards";
import { COMBOS, NUM_COMBOS, Range } from "../engine/range";
import { comboStrengths, preflopComboStrengths } from "../engine/strength";
import type { HandAction, Position, Street } from "../tracker/types";
import { type Profile, betSpot, sizeRatio } from "./model";

// Estimate a villain's range by replaying their actions this hand. Each action
// re-weights every combo by how likely this player is to take that action with
// it, using their (prior-smoothed) stats. Thresholds are soft (sigmoid) so a
// read never removes a hand completely.

const SOFT = 0.045;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
// The blur scales with the slice: a "top 7%" read can't leak half the range in.
const soft = (frac: number) => Math.min(SOFT, Math.max(0.012, 0.25 * frac));
/** ~1 for the strongest `frac` of the range, ~0 below. */
export const inTop = (q: number, frac: number) => {
  const f = Math.min(Math.max(frac, 0.005), 1);
  return sigmoid((q - (1 - f)) / soft(f));
};
/** ~1 for the weakest `frac` of the range. */
export const inBottom = (q: number, frac: number) => {
  const f = Math.min(Math.max(frac, 0), 1);
  return sigmoid((f - q) / soft(f));
};

const strengthCache = new Map<string, Float64Array>();
export function boardStrengths(board: readonly Card[]): Float64Array {
  const k = board.join(",");
  let s = strengthCache.get(k);
  if (!s) {
    s = comboStrengths(board, [], board.length === 5 ? 1 : 40);
    if (strengthCache.size > 32) strengthCache.clear();
    strengthCache.set(k, s);
  }
  return s;
}

/** Percentile of each combo within the weighted range (0 = weakest, 1 = strongest). */
export function rangePercentiles(range: Range, strengths: Float64Array): Float64Array {
  const idx: number[] = [];
  for (let i = 0; i < NUM_COMBOS; i++) if (range.w[i] > 0 && strengths[i] >= 0) idx.push(i);
  idx.sort((a, b) => strengths[a] - strengths[b]);
  const total = idx.reduce((s, i) => s + range.w[i], 0);
  const q = new Float64Array(NUM_COMBOS);
  let cum = 0;
  for (let k = 0; k < idx.length; ) {
    // Equal strengths share a percentile.
    let j = k;
    let w = 0;
    while (j < idx.length && strengths[idx[j]] === strengths[idx[k]]) w += range.w[idx[j++]];
    const mid = total > 0 ? (cum + w / 2) / total : 0.5;
    for (let t = k; t < j; t++) q[idx[t]] = mid;
    cum += w;
    k = j;
  }
  return q;
}

function reweight(range: Range, fn: (i: number) => number): void {
  for (let i = 0; i < NUM_COMBOS; i++) if (range.w[i] > 0) range.w[i] *= Math.max(0, Math.min(1, fn(i)));
}

const boardAt = (board: readonly Card[], street: Street) =>
  board.slice(0, street === "flop" ? 3 : street === "turn" ? 4 : street === "river" || street === "showdown" ? 5 : 0);

/**
 * Fraction of hands a player opens from a position, from their overall
 * raise-first rate. Later positions open much wider; the multipliers spread a
 * player's average PFR across seats the way sound ranges do.
 */
const OPEN_FACTOR: Record<"3" | "6", Partial<Record<Position, number>>> = {
  "3": { BTN: 1.3, SB: 1.1, BB: 0.9 },
  "6": { UTG: 0.7, MP: 0.85, CO: 1.35, BTN: 2.1, SB: 1.6, BB: 0.9 },
};
function openFraction(profile: Profile, position: Position | undefined, players: number): number {
  const pfr = profile.stat("pfr");
  if (players <= 2) return Math.min(0.95, pfr * 1.6);
  const factor = OPEN_FACTOR[players <= 4 ? "3" : "6"][position ?? "BB"] ?? 1;
  return Math.min(0.95, pfr * factor);
}

/**
 * How much of a player's usual betting range still bets at this size: 1 at a
 * normal ~2/3-pot bet, shrinking for overbets (a 10x-pot shove is mostly the
 * very top of their range, or a bluff), slightly wider for small bets.
 */
export function sizeNarrowing(ratio: number): number {
  // Deliberately mild: people's bet sizes are only partly tied to hand
  // strength. A player's own showdowns (bluff share by size) add the rest.
  return Math.min(1.15, Math.max(0.4, Math.pow(1.66 / (1 + Math.max(0, ratio)), 0.4)));
}

/** Continue frequency vs a bet of `ratio` × pot, from a base frequency measured around 2/3 pot. */
export function sizeAdjustedContinue(base: number, ratio: number, refRatio = 0.66): number {
  const mdf = (r: number) => 1 / (1 + r);
  // Theory scales defence with 1/(1+ratio); real players react a bit less to size.
  return Math.min(0.97, Math.max(0.03, base * Math.pow(mdf(ratio) / mdf(refRatio), 0.85)));
}

export interface RangeContext {
  key: string;
  profile: Profile;
  position?: Position;
  headsUp: boolean;
  /** Players dealt in this hand. */
  players?: number;
  actions: readonly HandAction[];
  board: readonly Card[];
  /** Cards the villain cannot hold (hero's cards, board). */
  dead: readonly Card[];
}

export function estimateRange(ctx: RangeContext): Range {
  const { profile, key } = ctx;
  const range = Range.full().removeCards([...ctx.dead, ...ctx.board]);
  const pre = preflopComboStrengths();
  const vpip = profile.stat("vpip");
  const pfr = profile.stat("pfr");
  const threeBet = profile.stat("threeBet");
  const bluff = profile.stat("bluffShare");

  const preRaisers = ctx.actions.filter((a) => a.street === "preflop" && (a.type === "raise" || a.type === "bet"));
  const opener = preRaisers[0]?.key;
  const lastPreRaiser = preRaisers[preRaisers.length - 1]?.key;

  for (const a of ctx.actions) {
    if (a.key !== key || a.type === "post" || a.type === "fold") continue;

    if (a.street === "preflop") {
      const r = a.raisesBefore;
      switch (a.type) {
        case "call":
          if (r === 0) reweight(range, (i) => inTop(pre[i], vpip) * (1 - 0.6 * inTop(pre[i], pfr * 0.6)));
          else if (a.allIn || r >= 2) {
            const frac = opener === key ? pfr * (1 - profile.stat("foldTo3Bet")) : Math.max(0.05, threeBet * 0.8);
            reweight(range, (i) => inTop(pre[i], frac) * (1 - 0.4 * inTop(pre[i], frac * 0.3)));
          } else reweight(range, (i) => inTop(pre[i], Math.min(0.9, vpip * 0.85)) * (1 - 0.5 * inTop(pre[i], threeBet)));
          break;
        case "check":
          // Big blind checking its option: most strong hands would have raised.
          reweight(range, (i) => 1 - 0.7 * inTop(pre[i], pfr * 0.5));
          break;
        case "raise":
        case "bet":
          if (r === 0) reweight(range, (i) => inTop(pre[i], openFraction(profile, ctx.position, ctx.players ?? (ctx.headsUp ? 2 : 3))));
          else if (r === 1) reweight(range, (i) => Math.max(inTop(pre[i], Math.max(threeBet, 0.04)), 0.06 * bluff));
          else reweight(range, (i) => Math.max(inTop(pre[i], 0.035), 0.02));
          break;
      }
      continue;
    }

    // Postflop: rank combos within the current range on this street's board.
    const board = boardAt(ctx.board, a.street);
    if (board.length < 3) continue;
    const q = rangePercentiles(range, boardStrengths(board));
    const spot = betSpot(ctx.actions, a);
    const betFreq = spot === "cbet" ? profile.stat("cbet") : spot === "lead" ? profile.stat("lead") : profile.stat("betWhenCheckedTo");
    const raiseFreq = profile.stat("raiseVsBet");

    if (a.facing === 0 || a.type === "check" || a.type === "bet") {
      // How polarised a bet is depends on its size and on this player's sizing habits.
      const ratio = a.type === "bet" ? sizeRatio(a) : 0.66;
      const b = a.type === "bet" ? profile.bluffFor(ratio) : bluff;
      // Bigger bets come from a narrower, stronger slice of the range (plus bluffs).
      const freq = betFreq * sizeNarrowing(ratio);
      const polar = (i: number) => inTop(q[i], freq * (1 - b)) + 0.8 * inBottom(q[i], freq * b);
      // Leading out into the bettor: rare, and recreational players do it with
      // a spread of hands (strong ones more often, but medium hands and bluffs
      // too). One likelihood for both outcomes keeps the update consistent:
      // a check barely narrows, a lead shifts the range up without erasing
      // top pair. When checked to, betting is more strongly value + bluffs.
      const pLead = (i: number) => Math.min(1, (freq * (0.15 + 2.4 * q[i] ** 3)) / 0.75);
      if (spot === "lead") reweight(range, (i) => (a.type === "check" ? 1 - pLead(i) : Math.max(0.01, pLead(i))));
      else if (a.type === "check") reweight(range, (i) => Math.max(0.25, 1 - polar(i)));
      else reweight(range, (i) => Math.max(0.01, polar(i)));
    } else {
      const facingBet = a.type === "call" ? a.added : a.facing - (a.toTotal - a.added);
      const ratio = facingBet / Math.max(1, a.potBefore - facingBet);
      const cont = sizeAdjustedContinue(1 - profile.foldToBet(a.street), ratio);
      // Calling keeps everything good enough to continue; only the very top
      // (sets, two pair) is partly missing because those sometimes raise instead.
      if (a.type === "call") reweight(range, (i) => 0.01 + inTop(q[i], cont) * (1 - 0.5 * inTop(q[i], raiseFreq * 0.5)));
      else {
        const ratio = sizeRatio(a);
        const b = profile.bluffFor(ratio);
        const freq = Math.max(0.05, raiseFreq) * sizeNarrowing(ratio);
        reweight(range, (i) => Math.max(0.01, inTop(q[i], freq * (1 - b)) + 0.5 * inBottom(q[i], freq * b)));
      }
    }
  }
  return range;
}

/**
 * Split a range by how it responds to a bet of `ratio` × pot, given how often
 * this player continues against a ~2/3-pot bet in this spot (`baseContinue`).
 * Returns the fold probability and the continuing / raising sub-ranges.
 */
export interface RespondOptions {
  /** Bet size the base frequency was measured at (preflop: the standard size for this spot). */
  refRatio?: number;
  /**
   * Postflop: each combo's equity against the range the bettor is perceived to
   * have, plus the equity the price demands. When given, calls are decided the
   * way people decide them: "is my hand good enough against what they show?"
   */
  vsBettor?: Float64Array;
  need?: number;
}

export function respondToBet(range: Range, board: readonly Card[], profile: Profile, ratio: number, baseContinue: number, opts: RespondOptions = {}) {
  const preflop = board.length < 3;
  const strengths = preflop ? preflopComboStrengths() : boardStrengths(board);
  const raiseFreq = Math.min(0.5, profile.stat("raiseVsBet"));
  const continuing = new Range();
  const raising = new Range();
  let total = 0;
  let kept = 0;

  // Frequency view: this player's real fold-to-bet record (scaled for size),
  // plus "decent hands don't fold". Always computed.
  const q = rangePercentiles(range, strengths);
  const cont = sizeAdjustedContinue(baseContinue, ratio, opts.refRatio);
  const sticky = (baseContinue - 0.6) * 0.25;
  const rel = opts.refRatio !== undefined ? Math.max(0, ratio / Math.max(0.05, opts.refRatio) - 1) : ratio;
  const tau = preflop
    ? Math.min(0.97, 0.8 + 0.05 * Math.log2(1 + rel) - sticky)
    : Math.min(0.93, 0.6 + 0.1 * Math.log2(1 + ratio) - sticky);
  const byFreq = (i: number) => 1 - (1 - inTop(q[i], cont)) * (1 - sigmoid((strengths[i] - tau) / 0.04));

  // Pot-odds view (postflop): "is my hand good enough against what this bet
  // represents, at this price?" Real people only half play like this; they
  // also make curiosity calls, so the two views are blended.
  const rational = !preflop && opts.vsBettor && opts.need !== undefined;
  const shift = (baseContinue - 0.6) * 0.5;
  const eqQ = rational ? rangePercentiles(range, opts.vsBettor!) : q;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = range.w[i];
    if (w <= 0) continue;
    total += w;
    const c = rational ? 0.5 * byFreq(i) + 0.5 * sigmoid((opts.vsBettor![i] - opts.need! + shift) / 0.06) : byFreq(i);
    continuing.w[i] = w * c;
    kept += w * c;
    raising.w[i] = w * Math.min(c, inTop(eqQ[i], raiseFreq * Math.max(cont, 0.3)));
  }
  return { fold: total > 0 ? 1 - kept / total : 1, continuing, raising, continueFreq: total > 0 ? kept / total : 0 };
}

/**
 * Split a range into the hands that bet when checked to and those that check,
 * using the player's bet frequency and bluff share (value from the top,
 * bluffs from the bottom).
 */
export function bettingSplit(range: Range, board: readonly Card[], profile: Profile, isCbet: boolean) {
  const q = rangePercentiles(range, boardStrengths(board));
  const betFreq = isCbet ? profile.stat("cbet") : profile.stat("betWhenCheckedTo");
  const bluff = profile.stat("bluffShare");
  const betting = new Range();
  const checking = new Range();
  let total = 0;
  let bet = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = range.w[i];
    if (w <= 0) continue;
    const pBet = Math.min(1, inTop(q[i], betFreq * (1 - bluff)) + 0.8 * inBottom(q[i], betFreq * bluff));
    betting.w[i] = w * pBet;
    checking.w[i] = w * (1 - pBet);
    total += w;
    bet += w * pBet;
  }
  return { betProb: total > 0 ? bet / total : 0, betting, checking };
}

/** Share of all 1326 combos in a range (by weight), e.g. for display "top 23%". */
export function rangeWidth(range: Range): number {
  let s = 0;
  for (let i = 0; i < NUM_COMBOS; i++) s += range.w[i];
  return s / NUM_COMBOS;
}

export { COMBOS };
