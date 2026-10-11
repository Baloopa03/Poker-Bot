import type { Card } from "./cards";
import { evaluate } from "./evaluator";
import { COMBOS, NUM_COMBOS, Range } from "./range";

/** Small fast seeded PRNG (mulberry32). */
export function rng(seed = Date.now()): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EquityInput {
  hero: readonly [Card, Card];
  board: readonly Card[];
  /** One range per live opponent. */
  villains: readonly Range[];
  /** Other known dead cards (e.g. folded hands shown). */
  dead?: readonly Card[];
  iterations?: number;
  seed?: number;
}

export interface EquityResult {
  /** Expected share of the pot, 0..1 (ties split). */
  equity: number;
  win: number;
  tie: number;
  samples: number;
}

/** Alias-free weighted sampler over the 1326 combos of a range. */
class ComboSampler {
  private readonly idx: Int32Array;
  private readonly cum: Float64Array;
  readonly total: number;
  constructor(range: Range, dead: Uint8Array) {
    const idx: number[] = [];
    const cum: number[] = [];
    let s = 0;
    for (let i = 0; i < NUM_COMBOS; i++) {
      const w = range.w[i];
      if (w <= 0) continue;
      const [a, b] = COMBOS[i];
      if (dead[a] || dead[b]) continue;
      s += w;
      idx.push(i);
      cum.push(s);
    }
    this.idx = Int32Array.from(idx);
    this.cum = Float64Array.from(cum);
    this.total = s;
  }
  sample(r: number): number {
    const x = r * this.total;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] > x) hi = mid;
      else lo = mid + 1;
    }
    return this.idx[lo];
  }
}

/**
 * Monte Carlo equity of hero vs one or more weighted ranges. Villain hands
 * that collide with each other are rejected and redrawn.
 */
export function equity(input: EquityInput): EquityResult {
  const { hero, board, villains } = input;
  const iterations = input.iterations ?? 20000;
  const random = rng(input.seed ?? (Date.now() ^ 0x9e3779b9));

  const dead = new Uint8Array(52);
  for (const c of [...hero, ...board, ...(input.dead ?? [])]) dead[c] = 1;

  const samplers = villains.map((v) => new ComboSampler(v, dead));
  if (samplers.some((s) => s.total <= 0)) throw new Error("A villain range is empty after removing dead cards");

  const stub: Card[] = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) stub.push(c);

  const seven = new Int32Array(7);
  const used = new Uint8Array(52);
  let won = 0;
  let tied = 0;
  let share = 0;
  let samples = 0;
  const villainCards: number[] = new Array(villains.length * 2);

  for (let it = 0; it < iterations; it++) {
    used.fill(0);
    // Draw villain hands without collisions.
    let ok = true;
    for (let v = 0; v < samplers.length; v++) {
      let tries = 0;
      for (;;) {
        const [a, b] = COMBOS[samplers[v].sample(random())];
        if (!used[a] && !used[b]) {
          used[a] = used[b] = 1;
          villainCards[2 * v] = a;
          villainCards[2 * v + 1] = b;
          break;
        }
        if (++tries > 100) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (!ok) continue;

    // Complete the board from the remaining stub.
    const runout: Card[] = board.slice();
    let guard = 0;
    while (runout.length < 5 && guard++ < 1000) {
      const c = stub[(random() * stub.length) | 0];
      if (used[c]) continue;
      used[c] = 1;
      runout.push(c);
    }
    if (runout.length < 5) continue;

    for (let i = 0; i < 5; i++) seven[2 + i] = runout[i];
    seven[0] = hero[0];
    seven[1] = hero[1];
    const heroScore = evaluate(seven);
    let best = heroScore;
    let tiesAtBest = 1;
    let heroBest = true;
    for (let v = 0; v < samplers.length; v++) {
      seven[0] = villainCards[2 * v];
      seven[1] = villainCards[2 * v + 1];
      const s = evaluate(seven);
      if (s > best) {
        best = s;
        tiesAtBest = 1;
        heroBest = false;
      } else if (s === best) tiesAtBest++;
    }
    samples++;
    if (heroBest && best === heroScore) {
      if (tiesAtBest === 1) {
        won++;
        share += 1;
      } else {
        tied++;
        share += 1 / tiesAtBest;
      }
    }
  }

  return { equity: share / samples, win: won / samples, tie: tied / samples, samples };
}

/**
 * Exact equity vs a single range on the river (no cards to come): every
 * villain combo is checked once, weighted.
 */
export function riverEquityExact(hero: readonly [Card, Card], board: readonly Card[], villain: Range): EquityResult {
  if (board.length !== 5) throw new Error("riverEquityExact needs a full board");
  const dead = new Uint8Array(52);
  for (const c of [...hero, ...board]) dead[c] = 1;
  const seven = Int32Array.from([hero[0], hero[1], ...board]);
  const heroScore = evaluate(seven);
  let total = 0;
  let win = 0;
  let tie = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = villain.w[i];
    if (w <= 0) continue;
    const [a, b] = COMBOS[i];
    if (dead[a] || dead[b]) continue;
    seven[0] = a;
    seven[1] = b;
    const s = evaluate(seven);
    total += w;
    if (heroScore > s) win += w;
    else if (heroScore === s) tie += w;
  }
  if (total <= 0) throw new Error("Villain range is empty");
  return { equity: (win + tie / 2) / total, win: win / total, tie: tie / total, samples: total };
}
