// River/turn bet-sizing check: for every hand hero could hold in a spot, what
// does the advisor do, grouped by what the hand is on the board?
import { advise } from "../src/engine/advisor";
import { parseCards } from "../src/engine/cards";
import { COMBOS, NUM_COMBOS } from "../src/engine/range";
import { rangeComposition } from "../src/engine/texture";
import { Range } from "../src/engine/range";
import { OpponentModel } from "../src/opponents/model";
import type { HandAction, PlayerState, Street, TableState } from "../src/tracker/types";

const boardText = process.argv[2] ?? "Kh 2c 4s 5s Jd";
const facingBet = Number(process.argv[3] ?? 0); // villain bet on this street (0 = checked to us)
const stackLeft = Number(process.argv[4] ?? 545);
const board = parseCards(boardText);
const street: Street = board.length === 3 ? "flop" : board.length === 4 ? "turn" : "river";
const model = new OpponentModel();
const pot0 = 120;

const A = (key: string, st: Street, type: HandAction["type"], added: number, toTotal: number, facing: number, potBefore: number, raisesBefore = 0): HandAction =>
  ({ key, seat: key === "me" ? "s1" : "s2", street: st, type, added, toTotal, facing, potBefore, raisesBefore, allIn: false, auto: false });
const actions: HandAction[] = [
  A("me", "preflop", "post", 5, 5, 0, 0), A("v", "preflop", "post", 10, 10, 5, 5),
  A("me", "preflop", "raise", 20, 25, 10, 15), A("v", "preflop", "call", 15, 25, 25, 40, 1),
];
const streets: Street[] = ["flop", "turn", "river"];
let pot = 50;
for (const st of streets.slice(0, streets.indexOf(street))) {
  actions.push(A("v", st, "check", 0, 0, 0, pot), A("me", st, "bet", 35, 35, 0, pot), A("v", st, "call", 35, 35, 35, pot + 35));
  pot += 70;
}
actions.push(A("v", street, facingBet ? "bet" : "check", facingBet, facingBet, 0, pot));
const groups = new Map<string, Record<string, number>>();
for (let i = 0; i < NUM_COMBOS; i++) {
  const [a, b] = COMBOS[i];
  if (board.includes(a) || board.includes(b)) continue;
  const single = new Range(); single.w[i] = 1;
  const [[kind]] = rangeComposition(single, board);
  const players: PlayerState[] = [
    { key: "me", name: "me", id: 1, seat: "s1", stack: stackLeft, startStack: 0, committedStreet: 0, committedHand: pot / 2, inHand: true, folded: false, allIn: false, cards: [], position: "SB" },
    { key: "v", name: "v", id: 2, seat: "s2", stack: stackLeft - facingBet, startStack: 0, committedStreet: facingBet, committedHand: pot / 2 + facingBet, inHand: true, folded: false, allIn: false, cards: [], position: "BB" },
  ];
  const s: TableState = { handNumber: 1, handActive: true, street, sb: 5, bb: 10, board, players, heroSeat: "s1", heroKey: "me", heroCards: [a, b], toActSeat: "s1",
    currentBet: facingBet, lastRaiseSize: Math.max(10, facingBet), pot: pot + facingBet, actions, paused: false };
  const adv = advise(s, model, { iterations: 400, seed: i })!;
  const act = adv.best.allIn ? "ALL-IN" : adv.best.action === "bet" || adv.best.action === "raise" ? `${adv.best.action}` : adv.best.action;
  const g = groups.get(kind) ?? {};
  g[act] = (g[act] ?? 0) + 1;
  groups.set(kind, g);
}
console.log(`${street} ${boardText} · pot ${pot + facingBet} · ${facingBet ? `facing ${facingBet}` : "checked to us"} · ${stackLeft} behind`);
for (const [kind, g] of [...groups.entries()].sort()) {
  const n = Object.values(g).reduce((x, y) => x + y, 0);
  console.log(`  ${kind.padEnd(14)} ${Object.entries(g).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round((v / n) * 100)}%`).join(" · ")}`);
}
