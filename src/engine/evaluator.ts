import { type Card, RANKS } from "./cards";

// Hand strength as one comparable integer: higher wins.
// Layout: category << 20 | five 4-bit rank slots (most significant first).

export const enum Category {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES = [
  "high card",
  "pair",
  "two pair",
  "three of a kind",
  "straight",
  "flush",
  "full house",
  "four of a kind",
  "straight flush",
];

const score = (cat: number, r1 = 0, r2 = 0, r3 = 0, r4 = 0, r5 = 0) =>
  (cat << 20) | (r1 << 16) | (r2 << 12) | (r3 << 8) | (r4 << 4) | r5;

/** Highest rank of a straight contained in a 13-bit rank mask, or -1. */
function straightHigh(mask: number): number {
  for (let hi = 12; hi >= 4; hi--) {
    const need = 0x1f << (hi - 4);
    if ((mask & need) === need) return hi;
  }
  // Wheel: A-2-3-4-5.
  return (mask & 0x100f) === 0x100f ? 3 : -1;
}

/** Top `n` ranks set in `mask`, descending. */
function topRanks(mask: number, n: number): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
  return out;
}

const suitMasks = new Int32Array(4);
const counts = new Int32Array(13);

/** Evaluate the best 5-card hand from 5 to 7 cards. */
export function evaluate(cards: ArrayLike<Card>, len = cards.length): number {
  suitMasks.fill(0);
  counts.fill(0);
  let rankMask = 0;
  for (let i = 0; i < len; i++) {
    const c = cards[i];
    const r = c >> 2;
    suitMasks[c & 3] |= 1 << r;
    counts[r]++;
    rankMask |= 1 << r;
  }

  for (let s = 0; s < 4; s++) {
    const m = suitMasks[s];
    if (popcount(m) >= 5) {
      const sf = straightHigh(m);
      if (sf >= 0) return score(Category.StraightFlush, sf);
      const [a, b, c, d, e] = topRanks(m, 5);
      return score(Category.Flush, a, b, c, d, e);
    }
  }

  let quad = -1;
  let trip1 = -1;
  let trip2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = counts[r];
    if (n === 4) quad = r;
    else if (n === 3) {
      if (trip1 < 0) trip1 = r;
      else if (trip2 < 0) trip2 = r;
    } else if (n === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
    }
  }

  if (quad >= 0) return score(Category.Quads, quad, topRanks(rankMask & ~(1 << quad), 1)[0]);
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) return score(Category.FullHouse, trip1, Math.max(trip2, pair1));
  const st = straightHigh(rankMask);
  if (st >= 0) return score(Category.Straight, st);
  if (trip1 >= 0) {
    const [a, b] = topRanks(rankMask & ~(1 << trip1), 2);
    return score(Category.Trips, trip1, a, b);
  }
  if (pair2 >= 0) {
    const [k] = topRanks(rankMask & ~(1 << pair1) & ~(1 << pair2), 1);
    return score(Category.TwoPair, pair1, pair2, k);
  }
  if (pair1 >= 0) {
    const [a, b, c] = topRanks(rankMask & ~(1 << pair1), 3);
    return score(Category.Pair, pair1, a, b, c);
  }
  const [a, b, c, d, e] = topRanks(rankMask, 5);
  return score(Category.HighCard, a, b, c, d, e);
}

function popcount(x: number): number {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export const categoryOf = (s: number): Category => s >> 20;

/** Human description, e.g. "two pair, Ks and 7s". */
export function describe(s: number): string {
  const cat = categoryOf(s);
  const r1 = RANKS[(s >> 16) & 15];
  const r2 = RANKS[(s >> 12) & 15];
  switch (cat) {
    case Category.StraightFlush:
      return r1 === "A" ? "royal flush" : `straight flush, ${r1} high`;
    case Category.Quads:
      return `four ${r1}s`;
    case Category.FullHouse:
      return `full house, ${r1}s full of ${r2}s`;
    case Category.Flush:
      return `flush, ${r1} high`;
    case Category.Straight:
      return `straight, ${r1} high`;
    case Category.Trips:
      return `three ${r1}s`;
    case Category.TwoPair:
      return `two pair, ${r1}s and ${r2}s`;
    case Category.Pair:
      return `pair of ${r1}s`;
    default:
      return `${r1} high`;
  }
}
