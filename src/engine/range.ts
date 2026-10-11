import { type Card, RANKS, makeCard, parseCards, rankOf, suitOf } from "./cards";

// A range is a weight (0..1) for each of the 1326 two-card combos.

export const NUM_COMBOS = 1326;
export const COMBOS: ReadonlyArray<readonly [Card, Card]> = (() => {
  const out: [Card, Card][] = [];
  for (let a = 51; a >= 0; a--) for (let b = a - 1; b >= 0; b--) out.push([a, b]);
  return out;
})();

const INDEX = new Int16Array(52 * 52).fill(-1);
COMBOS.forEach(([a, b], i) => {
  INDEX[a * 52 + b] = i;
  INDEX[b * 52 + a] = i;
});

export const comboIndex = (a: Card, b: Card): number => INDEX[a * 52 + b];

/** Hand class label such as "AA", "AKs", "T9o". */
export function classOf(a: Card, b: Card): string {
  const ra = rankOf(a);
  const rb = rankOf(b);
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  if (hi === lo) return RANKS[hi] + RANKS[lo];
  return RANKS[hi] + RANKS[lo] + (suitOf(a) === suitOf(b) ? "s" : "o");
}

export const CLASS_OF_COMBO: readonly string[] = COMBOS.map(([a, b]) => classOf(a, b));

/** All 169 classes in grid order (row = first rank, AA top-left). */
export const ALL_CLASSES: readonly string[] = (() => {
  const out: string[] = [];
  for (let i = 12; i >= 0; i--)
    for (let j = 12; j >= 0; j--) {
      if (i === j) out.push(RANKS[i] + RANKS[j]);
      else if (j < i) out.push(RANKS[i] + RANKS[j] + "s");
      else out.push(RANKS[j] + RANKS[i] + "o");
    }
  return out;
})();

export const CLASS_INDEX: ReadonlyMap<string, number[]> = (() => {
  const m = new Map<string, number[]>();
  CLASS_OF_COMBO.forEach((c, i) => {
    if (!m.has(c)) m.set(c, []);
    m.get(c)!.push(i);
  });
  return m;
})();

export class Range {
  readonly w: Float64Array;
  constructor(weights?: Float64Array) {
    this.w = weights ?? new Float64Array(NUM_COMBOS);
  }
  static full(): Range {
    return new Range(new Float64Array(NUM_COMBOS).fill(1));
  }
  static parse(text: string): Range {
    return parseRange(text);
  }
  clone(): Range {
    return new Range(Float64Array.from(this.w));
  }
  setClass(cls: string, weight: number): this {
    for (const i of CLASS_INDEX.get(cls) ?? []) this.w[i] = weight;
    return this;
  }
  classWeight(cls: string): number {
    const idx = CLASS_INDEX.get(cls) ?? [];
    let s = 0;
    for (const i of idx) s += this.w[i];
    return idx.length ? s / idx.length : 0;
  }
  /** Zero out combos that use any of these (dead) cards. */
  removeCards(dead: readonly Card[]): this {
    if (!dead.length) return this;
    const isDead = new Uint8Array(52);
    for (const c of dead) isDead[c] = 1;
    COMBOS.forEach(([a, b], i) => {
      if (isDead[a] || isDead[b]) this.w[i] = 0;
    });
    return this;
  }
  /** Sum of weights (number of weighted combos). */
  size(): number {
    let s = 0;
    for (let i = 0; i < NUM_COMBOS; i++) s += this.w[i];
    return s;
  }
  /** Fraction of all 1326 combos, 0..1. */
  fraction(): number {
    return this.size() / NUM_COMBOS;
  }
}

function pairRanks(from: number, to: number): string[] {
  const out: string[] = [];
  for (let r = Math.min(from, to); r <= Math.max(from, to); r++) out.push(RANKS[r] + RANKS[r]);
  return out;
}

const rankIdx = (ch: string): number => {
  const r = RANKS.indexOf(ch.toUpperCase());
  if (r < 0) throw new Error(`Bad rank: ${ch}`);
  return r;
};

/** Expand one token (without weight) into hand classes or explicit combos. */
function expandToken(tok: string): { classes?: string[]; combos?: number[] } {
  const t = tok.trim();
  if (!t) return {};
  if (/^(any|random|100%)$/i.test(t)) return { classes: [...ALL_CLASSES] };

  // Explicit combo like "AhKh" or "10h9h".
  if (/^([2-9TJQKA]|10)[cdhs]([2-9TJQKA]|10)[cdhs]$/i.test(t)) {
    const [a, b] = parseCards(t);
    return { combos: [comboIndex(a, b)] };
  }

  const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)(\+)?(?:-([2-9TJQKA])([2-9TJQKA])([so]?))?$/i.exec(t);
  if (!m) throw new Error(`Bad range token: ${tok}`);
  const [, a, b, kind, plus, a2, b2] = m;
  const ra = rankIdx(a);
  const rb = rankIdx(b);
  const suffixes = kind ? [kind.toLowerCase()] : ["s", "o"];

  if (ra === rb) {
    if (a2) return { classes: pairRanks(ra, rankIdx(a2)) };
    return { classes: plus ? pairRanks(ra, 12) : [RANKS[ra] + RANKS[ra]] };
  }

  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  let kickers: number[];
  if (a2) {
    const lo2 = Math.min(rankIdx(a2), rankIdx(b2));
    kickers = [];
    for (let k = Math.min(lo, lo2); k <= Math.max(lo, lo2); k++) kickers.push(k);
  } else if (plus) {
    kickers = [];
    for (let k = lo; k < hi; k++) kickers.push(k);
  } else kickers = [lo];

  const classes: string[] = [];
  for (const k of kickers) for (const s of suffixes) classes.push(RANKS[hi] + RANKS[k] + s);
  return { classes };
}

/**
 * Parse a range like "22+, A2s+, KTo+, QJs:0.5, AhKh".
 * `:w` sets a weight (0..1) for that token. Later tokens override earlier ones.
 */
export function parseRange(text: string): Range {
  const r = new Range();
  for (const raw of text.split(/[,\s]+/)) {
    if (!raw) continue;
    const [tok, wText] = raw.split(":");
    const weight = wText === undefined ? 1 : Number(wText);
    const { classes, combos } = expandToken(tok);
    for (const c of classes ?? []) r.setClass(c, weight);
    for (const i of combos ?? []) r.w[i] = weight;
  }
  return r;
}

/** Hero's specific hand as a one-combo range. */
export function singleCombo(a: Card, b: Card): Range {
  const r = new Range();
  r.w[comboIndex(a, b)] = 1;
  return r;
}

export { makeCard };
