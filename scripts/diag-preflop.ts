// What does the advisor do preflop with every starting hand? Prints the share
// of hands it raises / calls / folds in standard spots (fresh model = defaults).
import { advise } from "../src/engine/advisor";
import { COMBOS, CLASS_INDEX, ALL_CLASSES } from "../src/engine/range";
import { OpponentModel } from "../src/opponents/model";
import type { HandAction, PlayerState, Position, TableState } from "../src/tracker/types";

const model = new OpponentModel();
const bb = 15, sb = 8, stack = Number(process.argv[2] ?? 500);
const P = (key: string, seat: string, position: Position, committed: number): PlayerState =>
  ({ key, name: key, id: 0, seat, stack: stack - committed, startStack: stack, committedStreet: committed, committedHand: committed, inHand: true, folded: false, allIn: false, cards: [], position });
const A = (key: string, seat: string, type: HandAction["type"], added: number, toTotal: number, facing: number, potBefore: number, raisesBefore: number): HandAction =>
  ({ key, seat, street: "preflop", type, added, toTotal, facing, potBefore, raisesBefore, allIn: false, auto: false });

function spot(name: string, players: PlayerState[], actions: HandAction[]) {
  const counts: Record<string, number> = {};
  const byClass: string[] = [];
  let n = 0;
  for (const cls of ALL_CLASSES) {
    const [a, b] = COMBOS[CLASS_INDEX.get(cls)![0]];
    const s: TableState = {
      handNumber: 1, handActive: true, street: "preflop", sb, bb, board: [], players: players.map((p) => ({ ...p })),
      heroSeat: players[0].seat, heroKey: players[0].key, heroCards: [a, b], toActSeat: players[0].seat,
      currentBet: Math.max(...players.map((p) => p.committedStreet)), lastRaiseSize: bb, pot: players.reduce((x, p) => x + p.committedHand, 0),
      actions, paused: false,
    };
    const adv = advise(s, model, { iterations: 1500, seed: 1 })!;
    const act = adv.best.action === "bet" ? "raise" : adv.best.action;
    const w = CLASS_INDEX.get(cls)!.length;
    counts[act] = (counts[act] ?? 0) + w;
    n += w;
    if (act !== "fold") byClass.push(act === "raise" ? cls : cls.toLowerCase());
  }
  const pct = (x = 0) => `${((x / n) * 100).toFixed(0)}%`;
  console.log(`${name.padEnd(34)} raise ${pct(counts.raise)} · call ${pct(counts.call)} · check ${pct(counts.check)} · fold ${pct(counts.fold)}`);
  if (process.env.VERBOSE) console.log("   " + byClass.join(" "));
}

const blinds3 = [A("sb", "s2", "post", sb, sb, 0, 0, 0), A("bb", "s3", "post", bb, bb, sb, sb, 0)];
spot("3-handed BTN, folded to me", [P("me", "s1", "BTN", 0), P("sb", "s2", "SB", sb), P("bb", "s3", "BB", bb)], blinds3);
spot("3-handed SB, BTN folded", [P("me", "s2", "SB", sb), P("bb", "s3", "BB", bb), { ...P("btn", "s1", "BTN", 0), folded: true }],
  [...blinds3.map((x) => (x.key === "sb" ? { ...x, key: "me" } : x)), A("btn", "s1", "fold", 0, 0, bb, sb + bb, 0)]);
spot("3-handed BB vs BTN open 2.5x", [P("me", "s3", "BB", bb), { ...P("btn", "s1", "BTN", 38) }, { ...P("sb", "s2", "SB", sb), folded: true }],
  [A("sb", "s2", "post", sb, sb, 0, 0, 0), A("me", "s3", "post", bb, bb, sb, sb, 0), A("btn", "s1", "raise", 38, 38, bb, sb + bb, 0), A("sb", "s2", "fold", 0, sb, 38, 61, 1)]);
spot("3-handed SB vs BTN open 2.5x", [P("me", "s2", "SB", sb), P("bb", "s3", "BB", bb), P("btn", "s1", "BTN", 38)],
  [A("me", "s2", "post", sb, sb, 0, 0, 0), A("bb", "s3", "post", bb, bb, sb, sb, 0), A("btn", "s1", "raise", 38, 38, bb, sb + bb, 0)]);
const hu = [A("me", "s1", "post", sb, sb, 0, 0, 0), A("bb", "s2", "post", bb, bb, sb, sb, 0)];
spot("Heads-up SB/button first in", [P("me", "s1", "SB", sb), P("bb", "s2", "BB", bb)], hu);
spot("Heads-up BB vs 2.5x open", [P("me", "s2", "BB", bb), P("sb", "s1", "SB", 38)],
  [A("sb", "s1", "post", sb, sb, 0, 0, 0), A("me", "s2", "post", bb, bb, sb, sb, 0), A("sb", "s1", "raise", 30, 38, bb, sb + bb, 0)]);
