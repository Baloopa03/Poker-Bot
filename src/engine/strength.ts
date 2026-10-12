import type { Card } from "./cards";
import { evaluate } from "./evaluator";
import { rng } from "./equity";
import preflopEquity from "./preflop-equity.json";
import { ALL_CLASSES, CLASS_INDEX, CLASS_OF_COMBO, COMBOS, NUM_COMBOS } from "./range";

/**
 * Strength of every combo on a board: the probability it beats a random hand,
 * averaged over sampled runouts (exact on the river). Draws get credit
 * naturally because future cards are sampled. Dead combos get -1.
 */
export function comboStrengths(board: readonly Card[], dead: readonly Card[] = [], runouts = 48, seed = 7): Float64Array {
  const out = new Float64Array(NUM_COMBOS).fill(-1);
  const isDead = new Uint8Array(52);
  for (const c of [...board, ...dead]) isDead[c] = 1;
  const live: number[] = [];
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [a, b] = COMBOS[i];
    if (!isDead[a] && !isDead[b]) live.push(i);
  }
  for (const i of live) out[i] = 0;

  const need = 5 - board.length;
  const samples = need === 0 ? 1 : runouts;
  const random = rng(seed);
  const stub: Card[] = [];
  for (let c = 0; c < 52; c++) if (!isDead[c]) stub.push(c);

  const seven = new Int32Array(7);
  const scores = new Float64Array(NUM_COMBOS);
  const blocked = new Int32Array(NUM_COMBOS);
  const order: number[] = [];
  for (let s = 0; s < samples; s++) {
    const runout = board.slice();
    const used = new Uint8Array(52);
    while (runout.length < 5) {
      const c = stub[(random() * stub.length) | 0];
      if (used[c]) continue;
      used[c] = 1;
      runout.push(c);
    }
    for (let k = 0; k < 5; k++) seven[2 + k] = runout[k];
    order.length = 0;
    for (const i of live) {
      const [a, b] = COMBOS[i];
      if (used[a] || used[b]) continue;
      seven[0] = a;
      seven[1] = b;
      scores[i] = evaluate(seven);
      order.push(i);
    }
    order.sort((x, y) => scores[x] - scores[y]);
    // Percentile with ties split.
    const n = order.length;
    for (let lo = 0; lo < n; ) {
      let hi = lo;
      while (hi + 1 < n && scores[order[hi + 1]] === scores[order[lo]]) hi++;
      const pct = (lo + hi) / 2 / Math.max(1, n - 1);
      for (let k = lo; k <= hi; k++) out[order[k]] += pct;
      lo = hi + 1;
    }
    // Combos blocked by this runout are averaged over the runouts they survive.
    for (const i of live) {
      const [a, b] = COMBOS[i];
      if (used[a] || used[b]) blocked[i]++;
    }
  }
  for (const i of live) {
    const valid = samples - blocked[i];
    out[i] = valid > 0 ? out[i] / valid : 0.5;
  }
  return out;
}

let preflopCache: Map<string, number> | undefined;

/** Equity of each starting hand vs [1, 2] random hands (precomputed by scripts/gen-preflop.ts). */
export const PREFLOP_EQUITY = preflopEquity as unknown as Record<string, [number, number]>;

/**
 * Preflop playability percentile per hand class, 0..1 (AA = top). Blends
 * equity against one and two random hands (the multiway number rewards
 * suited and connected hands), with a small nudge for suitedness and
 * connectedness, which matter more in real play than all-in equity shows.
 */
export function preflopScores(): Map<string, number> {
  if (preflopCache) return preflopCache;
  const raw = new Map<string, number>();
  for (const cls of ALL_CLASSES) {
    const [e1, e2] = PREFLOP_EQUITY[cls];
    let score = (e1 + 1.5 * e2) / 2.5;
    if (cls.endsWith("s")) score += 0.01;
    if (cls.length === 3) {
      const gap = RANK_ORDER.indexOf(cls[0]) - RANK_ORDER.indexOf(cls[1]);
      score += gap === 1 ? 0.012 : gap === 2 ? 0.006 : 0;
    }
    raw.set(cls, score);
  }
  // Convert to a percentile weighted by combo count (top hand = 1).
  const sorted = [...raw.entries()].sort((x, y) => y[1] - x[1]);
  let cum = 0;
  preflopCache = new Map();
  for (const [cls] of sorted) {
    const n = CLASS_INDEX.get(cls)!.length;
    preflopCache.set(cls, 1 - (cum + n / 2) / NUM_COMBOS);
    cum += n;
  }
  return preflopCache;
}

const RANK_ORDER = "23456789TJQKA";

/** Preflop strength percentile per combo (1 = best). */
export function preflopComboStrengths(): Float64Array {
  const s = preflopScores();
  return Float64Array.from(CLASS_OF_COMBO, (c) => s.get(c)!);
}

/** Hand classes making up the top `fraction` of all combos. */
export function topClasses(fraction: number): string[] {
  const s = preflopScores();
  return ALL_CLASSES.filter((c) => s.get(c)! >= 1 - fraction);
}

/**
 * For every combo, its chance of beating a hand drawn from `range` on this
 * board (ties count half), with exact card removal, averaged over the
 * remaining cards: exact on the river, an even spread of rivers on the turn,
 * sampled turn+river pairs on the flop. This is what a
 * player compares with their pot odds when deciding whether to call.
 */
export function equityVsRange(board: readonly Card[], range: { w: Float64Array }, flopRunouts = 16, seed = 11): Float64Array {
  const out = new Float64Array(NUM_COMBOS);
  const isDead = new Uint8Array(52);
  for (const c of board) isDead[c] = 1;
  const runouts: Card[][] = [];
  if (board.length === 5) runouts.push([]);
  else if (board.length === 4) {
    // Every 3rd remaining card: an even spread of 16 rivers (full enumeration is 46).
    const live: Card[] = [];
    for (let c = 0; c < 52; c++) if (!isDead[c]) live.push(c);
    for (let k = 0; k < live.length; k += 3) runouts.push([live[k]]);
  } else {
    const random = rng(seed);
    const stub: Card[] = [];
    for (let c = 0; c < 52; c++) if (!isDead[c]) stub.push(c);
    for (let k = 0; k < flopRunouts; k++) {
      const a = stub[(random() * stub.length) | 0];
      let b = a;
      while (b === a) b = stub[(random() * stub.length) | 0];
      runouts.push([a, b]);
    }
  }
  const seven = new Int32Array(7);
  const scores = new Float64Array(NUM_COMBOS);
  const counted = new Float64Array(NUM_COMBOS);
  for (const extra of runouts) {
    const full = [...board, ...extra];
    for (let k = 0; k < 5; k++) seven[2 + k] = full[k];
    const used = new Uint8Array(52);
    for (const c of full) used[c] = 1;
    const heroIdx: number[] = [];
    for (let i = 0; i < NUM_COMBOS; i++) {
      const [a, b] = COMBOS[i];
      if (used[a] || used[b]) {
        scores[i] = -1;
        continue;
      }
      seven[0] = a;
      seven[1] = b;
      scores[i] = evaluate(seven);
      if (range.w[i] > 0) heroIdx.push(i);
    }
    heroIdx.sort((x, y) => scores[x] - scores[y]);
    const sc = heroIdx.map((i) => scores[i]);
    const cum: number[] = [];
    let total = 0;
    for (const i of heroIdx) cum.push((total += range.w[i]));
    if (total <= 0) continue;
    // Range hands holding each card, for exact card removal (blockers).
    const byCard: number[][] = Array.from({ length: 52 }, () => []);
    for (const i of heroIdx) {
      const [a, b] = COMBOS[i];
      byCard[a].push(i);
      byCard[b].push(i);
    }
    const below = (v: number, strict: boolean) => {
      // weight of range hands with score < v (strict) or <= v
      let lo = 0;
      let hi = sc.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (strict ? sc[mid] < v : sc[mid] <= v) lo = mid + 1;
        else hi = mid;
      }
      return lo === 0 ? 0 : cum[lo - 1];
    };
    for (let i = 0; i < NUM_COMBOS; i++) {
      const v = scores[i];
      if (v < 0) continue;
      let lt = below(v, true);
      let le = below(v, false);
      let tot = total;
      // Remove range hands that share a card with this one.
      const [a, b] = COMBOS[i];
      for (const card of [a, b])
        for (const j of byCard[card]) {
          if (card === b && (COMBOS[j][0] === a || COMBOS[j][1] === a)) continue; // counted once via `a`
          const w = range.w[j];
          tot -= w;
          if (scores[j] < v) lt -= w;
          if (scores[j] <= v) le -= w;
        }
      if (tot <= 1e-9) continue;
      out[i] += (lt + (le - lt) / 2) / tot;
      counted[i]++;
    }
  }
  for (let i = 0; i < NUM_COMBOS; i++) out[i] = counted[i] > 0 ? out[i] / counted[i] : 0;
  return out;
}
