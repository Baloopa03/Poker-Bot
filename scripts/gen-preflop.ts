// Precompute each starting hand's equity vs 1 and 2 random hands (written to src/engine/preflop-equity.json).
import { writeFileSync } from "node:fs";
import { evaluate } from "../src/engine/evaluator";
import { rng } from "../src/engine/equity";
import { ALL_CLASSES, CLASS_INDEX, COMBOS } from "../src/engine/range";

const trials = Number(process.argv[2] ?? 30000);
const random = rng(2026);
const seven = new Int32Array(7);
const out: Record<string, [number, number]> = {};
for (const cls of ALL_CLASSES) {
  const [a, b] = COMBOS[CLASS_INDEX.get(cls)![0]];
  const res: number[] = [];
  for (const opps of [1, 2]) {
    let share = 0;
    for (let t = 0; t < trials; t++) {
      const used = new Uint8Array(52);
      used[a] = used[b] = 1;
      const draw = () => { for (;;) { const c = (random() * 52) | 0; if (!used[c]) { used[c] = 1; return c; } } };
      const vs: number[] = [];
      for (let o = 0; o < opps * 2; o++) vs.push(draw());
      for (let k = 0; k < 5; k++) seven[2 + k] = draw();
      seven[0] = a; seven[1] = b;
      const h = evaluate(seven);
      let best = 0, ties = 0;
      for (let o = 0; o < opps; o++) {
        seven[0] = vs[2 * o]; seven[1] = vs[2 * o + 1];
        const v = evaluate(seven);
        if (v > best) { best = v; ties = 0; }
        if (v === best) ties++;
      }
      share += h > best ? 1 : h === best ? 1 / (ties + 1) : 0;
    }
    res.push(Math.round((share / trials) * 10000) / 10000);
  }
  out[cls] = res as [number, number];
}
writeFileSync("src/engine/preflop-equity.json", JSON.stringify(out) + "\n");
console.log("AA", out.AA, "AKs", out.AKs, "AQs", out.AQs, "72o", out["72o"], "22", out["22"]);
