import { type Card, RANKS, rankOf, suitOf } from "./cards";
import { CATEGORY_NAMES, Category, categoryOf, evaluate } from "./evaluator";
import { COMBOS, NUM_COMBOS, type Range } from "./range";

// Plain-language board reading: what the board makes possible, what the
// newest card changed, whether your hand is really just the board, and what
// an opponent's range is made of.

const SUIT_NAMES = ["clubs", "diamonds", "hearts", "spades"];
const SUIT_SYMBOL = ["♣", "♦", "♥", "♠"];
const pretty = (c: Card) => `${RANKS[rankOf(c)] === "T" ? "10" : RANKS[rankOf(c)]}${SUIT_SYMBOL[suitOf(c)]}`;

interface Features {
  paired: boolean;
  trips: boolean;
  maxSuit: number;
  flushSuit: number;
  straightPossible: boolean;
}

function features(board: readonly Card[]): Features {
  const counts = new Array(13).fill(0);
  const suits = new Array(4).fill(0);
  let mask = 0;
  for (const c of board) {
    counts[rankOf(c)]++;
    suits[suitOf(c)]++;
    mask |= 1 << rankOf(c);
  }
  // Any 5-rank window holding 3+ board ranks makes a straight possible with two hole cards.
  let straightPossible = false;
  const low = (mask & (1 << 12) ? 1 : 0) | ((mask & 0x1fff) << 1); // index 0 = ace-low, 1..13 = 2..A
  for (let start = 0; start <= 9; start++) {
    let n = 0;
    for (let k = 0; k < 5; k++) if (low & (1 << (start + k))) n++;
    if (n >= 3) straightPossible = true;
  }
  const maxSuit = Math.max(...suits);
  return {
    paired: counts.some((n) => n >= 2),
    trips: counts.some((n) => n >= 3),
    maxSuit,
    flushSuit: suits.indexOf(maxSuit),
    straightPossible,
  };
}

/** Short notes about the board, most important first (empty preflop). */
export function boardNotes(board: readonly Card[]): string[] {
  if (board.length < 3) return [];
  const f = features(board);
  const notes: string[] = [];
  const prev = board.length > 3 ? features(board.slice(0, -1)) : undefined;
  const last = board[board.length - 1];
  // What the newest card changed.
  if (prev) {
    if (f.maxSuit >= 3 && prev.maxSuit < 3) notes.push(`The ${pretty(last)} made a flush possible`);
    else if (f.maxSuit === 4 && prev.maxSuit === 3) notes.push(`The ${pretty(last)} put four ${SUIT_NAMES[f.flushSuit]} out: one ${SUIT_SYMBOL[f.flushSuit]} makes a flush`);
    if (f.paired && !prev.paired) notes.push(`The ${pretty(last)} paired the board: full houses are now possible`);
    if (f.straightPossible && !prev.straightPossible) notes.push(`The ${pretty(last)} made a straight possible`);
  }
  if (!notes.length) {
    if (f.maxSuit >= 3) notes.push(`${f.maxSuit} ${SUIT_NAMES[f.flushSuit]} on board: flush possible`);
    if (f.trips) notes.push("Trips on the board: everyone shares them, kickers and full houses decide");
    else if (f.paired) notes.push("Paired board: full houses and trips are possible");
    if (f.straightPossible && f.maxSuit < 3) notes.push("Straight possible");
  }
  return notes;
}

function boardCategory(board: readonly Card[]): Category {
  if (board.length === 5) return categoryOf(evaluate(board));
  const counts = new Array(13).fill(0);
  for (const c of board) counts[rankOf(c)]++;
  const pairs = counts.filter((n) => n === 2).length;
  if (counts.some((n) => n === 4)) return Category.Quads;
  if (counts.some((n) => n === 3)) return Category.Trips;
  if (pairs >= 2) return Category.TwoPair;
  if (pairs === 1) return Category.Pair;
  return Category.HighCard;
}

/**
 * Warn when the hand is really just the board ("the pair of aces is on the
 * board, everyone has it").
 */
export function playingTheBoard(hero: readonly [Card, Card], board: readonly Card[]): string | undefined {
  if (board.length < 3) return undefined;
  const heroScore = evaluate([...hero, ...board]);
  const cat = categoryOf(heroScore);
  if (board.length === 5 && heroScore === evaluate(board)) return "You're playing the board: your cards don't improve it, so everyone left at least ties";
  const bcat = boardCategory(board);
  if (cat === bcat && (cat === Category.Pair || cat === Category.TwoPair || cat === Category.Trips)) {
    const kicker = Math.max(rankOf(hero[0]), rankOf(hero[1]));
    const shared = cat === Category.Pair ? "pair" : cat === Category.TwoPair ? "two pair" : "trips";
    return `The ${shared} is on the board, so everyone has it: your real hand is just ${RANKS[kicker] === "T" ? "10" : RANKS[kicker]}-high kicker`;
  }
  return undefined;
}

/** What a range is made of on this board, e.g. [["flush", 0.38], ["two pair", 0.21], …]. */
export function rangeComposition(range: Range, board: readonly Card[], dead: readonly Card[] = []): Array<[string, number]> {
  if (board.length < 3) return [];
  const isDead = new Uint8Array(52);
  for (const c of [...board, ...dead]) isDead[c] = 1;
  const seven = Int32Array.from([0, 0, ...board]);
  const totals = new Map<string, number>();
  let sum = 0;
  const bcat = boardCategory(board);
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = range.w[i];
    if (w <= 0) continue;
    const [a, b] = COMBOS[i];
    if (isDead[a] || isDead[b]) continue;
    seven[0] = a;
    seven[1] = b;
    const cat = categoryOf(evaluate(seven, 2 + board.length));
    let label: string;
    if (cat <= bcat && cat <= Category.Pair) {
      // No made hand beyond the board: is it at least a draw?
      label = board.length < 5 && hasDraw([a, b], board) ? "draw" : "no pair";
    } else if (cat === Category.Pair) label = pairKind([a, b], board);
    else if (cat === Category.Trips) label = rankCount([a, b], board) ? "set" : "trips";
    else label = CATEGORY_NAMES[cat];
    totals.set(label, (totals.get(label) ?? 0) + w);
    sum += w;
  }
  if (sum <= 0) return [];
  return [...totals.entries()]
    .map(([k, v]) => [k, v / sum] as [string, number])
    .sort((x, y) => y[1] - x[1]);
}

/** Overpair / top pair / weaker pair, the distinction that matters when facing a bet. */
function pairKind(hole: [Card, Card], board: readonly Card[]): string {
  const top = Math.max(...board.map(rankOf));
  const [r1, r2] = hole.map(rankOf);
  if (r1 === r2) return r1 > top ? "overpair" : "weaker pair";
  const paired = board.some((c) => rankOf(c) === r1) ? r1 : r2;
  return paired === top ? "top pair" : "weaker pair";
}

/** Pocket pair that hit the board (a "set") rather than one card matching a paired board ("trips"). */
function rankCount(hole: [Card, Card], board: readonly Card[]): boolean {
  return rankOf(hole[0]) === rankOf(hole[1]) && board.some((c) => rankOf(c) === rankOf(hole[0]));
}

/** Flush draw or open-ended / double-gutter straight draw using at least one hole card. */
function hasDraw(hole: [Card, Card], board: readonly Card[]): boolean {
  const cards = [...hole, ...board];
  for (let s = 0; s < 4; s++) {
    const n = cards.filter((c) => suitOf(c) === s).length;
    if (n === 4 && hole.some((c) => suitOf(c) === s)) return true;
  }
  const ranks = new Set(cards.map(rankOf));
  if (ranks.has(12)) ranks.add(-1);
  const holeRanks = hole.map(rankOf);
  for (let start = -1; start <= 8; start++) {
    const window = [0, 1, 2, 3, 4].map((k) => start + k);
    const have = window.filter((r) => ranks.has(r)).length;
    const usesHole = window.some((r) => holeRanks.includes(r) || (r === -1 && holeRanks.includes(12)));
    if (have === 4 && usesHole) return true;
  }
  return false;
}
