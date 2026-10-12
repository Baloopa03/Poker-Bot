// Precompute each starting hand's all-in equity against the top W% of hands
// (by preflop score), for a few widths (written to src/engine/preflop-vs-top.json).
// Used for "is my hand good enough to call this re-raise at this price?".
import { writeFileSync } from "node:fs";
import { evaluate } from "../src/engine/evaluator";
import { rng } from "../src/engine/equity";
import { ALL_CLASSES, CLASS_INDEX, CLASS_OF_COMBO, COMBOS, NUM_COMBOS } from "../src/engine/range";
import { preflopScores } from "../src/engine/strength";

export const WIDTHS = [0.03, 0.06, 0.1, 0.15, 0.22, 0.3, 0.45, 0.65, 1];
const trials = Number(process.argv[2] ?? 6000);
const random = rng(2027);
const scores = preflopScores();
const seven = new Int32Array(7);
const out: Record<string, number[]> = {};
for (const cls of ALL_CLASSES) out[cls] = [];
for (const w of WIDTHS) {
  const top = [];
  for (let i = 0; i < NUM_COMBOS; i++) if (scores.get(CLASS_OF_COMBO[i])! >= 1 - w) top.push(i);
  for (const cls of ALL_CLASSES) {
    const [a, b] = COMBOS[CLASS_INDEX.get(cls)![0]];
    const live = top.filter((i) => { const [c, d] = COMBOS[i]; return c !== a && c !== b && d !== a && d !== b; });
    let share = 0;
    for (let t = 0; t < trials; t++) {
      const [c, d] = COMBOS[live[(random() * live.length) | 0]];
      const used = new Uint8Array(52);
      used[a] = used[b] = used[c] = used[d] = 1;
      for (let k = 0; k < 5; k++) { let x; do x = (random() * 52) | 0; while (used[x]); used[x] = 1; seven[2 + k] = x; }
      seven[0] = a; seven[1] = b;
      const h = evaluate(seven);
      seven[0] = c; seven[1] = d;
      const v = evaluate(seven);
      share += h > v ? 1 : h === v ? 0.5 : 0;
    }
    out[cls].push(Math.round((share / trials) * 1000) / 1000);
  }
}
writeFileSync("src/engine/preflop-vs-top.json", JSON.stringify({ widths: WIDTHS, equity: out }) + "\n");
console.log("72o", out["72o"], "\nAA", out.AA, "\n63o", out["63o"], "\nA5o", out.A5o);
