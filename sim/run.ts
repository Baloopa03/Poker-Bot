// Run the bot against scripted opponents and report results.
//   npx tsx sim/run.ts --hands 2000 --lineup station,nit [--reads off] [--players-bot solid]
import { OpponentModel } from "../src/opponents/model";
import { Game, type Seat } from "./game";
import { STYLES, bot } from "./strategies";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const hands = Number(args.get("hands") ?? 1000);
const lineup = (args.get("lineup") ?? "station,nit").split(",");
const useReads = args.get("reads") !== "off";
const heroStyle = args.get("hero") ?? "bot"; // "bot" or a scripted style, for a baseline
const sb = Number(args.get("sb") ?? 8);
const bb = Number(args.get("bb") ?? 15);
const stack = Number(args.get("stack") ?? 500);
const seed = Number(args.get("seed") ?? 7);

const model = new OpponentModel();
const seats: Seat[] = [
  { key: "hero", name: heroStyle === "bot" ? `Bot${useReads ? "" : " (no reads)"}` : `Hero:${heroStyle}`, strategy: heroStyle === "bot" ? bot(model, { useReads }) : STYLES[heroStyle](seed + 99), stack, net: 0, buyIns: 0 },
  ...lineup.map((style, i) => ({ key: `${style}${i}`, name: style, strategy: STYLES[style](seed + i * 11), stack, net: 0, buyIns: 0 })),
];
const game = new Game(seats, { sb, bb, startStack: stack, cashOutAbove: stack * 2, seed });

// Per-hand results for confidence intervals.
const perHand = new Map<string, number[]>(seats.map((s) => [s.key, []]));
game.observers.push((h, perspective) => {
  if (heroStyle === "bot") model.update(perspective("hero"));
  for (const p of h.players) {
    const res = h.result!;
    const delta = (res.won[p.key] ?? 0) + (res.refunded[p.key] ?? 0) - h.actions.filter((a) => a.key === p.key).reduce((x, a) => x + a.added, 0);
    perHand.get(p.key)!.push(delta / bb);
  }
});

const t0 = Date.now();
for (let i = 0; i < hands; i++) {
  game.playHand();
  if ((i + 1) % 250 === 0) process.stderr.write(`  ${i + 1}/${hands} hands (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}

console.log(`\n${hands} hands · ${seats.length}-handed · blinds ${sb}/${bb} · ${stack} stacks (${(stack / bb).toFixed(0)} BB) · reads ${useReads ? "on" : "off"}`);
for (const s of seats) {
  const xs = perHand.get(s.key)!;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  const ci = (1.96 * sd) / Math.sqrt(xs.length);
  console.log(`  ${s.name.padEnd(18)} ${(mean * 100).toFixed(1).padStart(7)} BB/100  (±${(ci * 100).toFixed(1)})   net ${s.net >= 0 ? "+" : ""}${s.net} chips`);
}
if (heroStyle === "bot") {
  console.log("\nWhat the bot learned:");
  for (const s of seats.slice(1)) {
    const p = model.profile(s.key, s.name, seats.length);
    const f = (x: number) => `${Math.round(x * 100)}%`;
    console.log(`  ${s.name.padEnd(10)} style "${p.style}" · VPIP ${f(p.stat("vpip"))} · raise pre ${f(p.stat("pfr"))} · fold to flop bet ${f(p.stat("foldToBetFlop"))} · bluff share ${f(p.stat("bluffShare"))}`);
  }
}
