// Replay a capture and print the advisor's recommendation at every hero decision.
import { readFileSync } from "node:fs";
import { advise } from "../src/engine/advisor";
import { cardsToString } from "../src/engine/cards";
import { OpponentModel } from "../src/opponents/model";
import { Tracker } from "../src/tracker/tracker";

const capture = JSON.parse(readFileSync(process.argv[2], "utf8"));
const t = new Tracker();
const model = new OpponentModel();
t.on("handComplete", (h) => model.update(h));
t.on("heroTurn", (s) => {
  const t0 = performance.now();
  const a = advise(s, model);
  const ms = performance.now() - t0;
  if (!a) return;
  console.log(`#${s.handNumber} ${s.street} ${a.heroCards} | ${cardsToString(s.board) || "-"} | pot ${a.pot} call ${a.toCall} → ${a.best.label}  (${ms.toFixed(0)}ms)`);
  console.log("   " + a.options.map((o) => `${o.label}: ${o.ev.toFixed(1)}`).join(" | "));
  console.log("   " + a.reasons.join("; "));
  console.log("   " + a.villains.map((v) => `${v.name} top ${(v.rangeWidth * 100).toFixed(0)}% [${v.likely.join(" ")}]`).join(" ; "));
});
for (const e of capture.entries) t.handle(e);
