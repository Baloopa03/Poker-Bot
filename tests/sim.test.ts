import { describe, expect, it } from "vitest";
import { parseCards } from "../src/engine/cards";
import { Game, settle } from "../sim/game";
import { STYLES } from "../sim/strategies";

const p = (key: string, committed: number, hole: string, folded = false) =>
  ({ key, name: key, id: 0, seat: key, stack: 0, startStack: 0, committedStreet: 0, committedHand: committed, inHand: true, folded, allIn: false, cards: [], hole: parseCards(hole) }) as any;

describe("simulator engine", () => {
  it("splits side pots and refunds uncalled chips", () => {
    // A all-in 100, B and C 300 each; C has the best hand, A beats B.
    const board = parseCards("2c 7d 9h Jc 3s");
    const r = settle([p("A", 100, "9s 9d"), p("B", 300, "Kd Qd"), p("C", 300, "Js Jd")], board);
    expect(r.won).toEqual({ C: 700 });
    const r2 = settle([p("A", 100, "Js Jd"), p("B", 300, "9s 9d"), p("C", 300, "Kd Qd")], board);
    expect(r2.won).toEqual({ A: 300, B: 400 }); // A wins main 300, B side 400
    const r3 = settle([p("A", 50, "2d 3d"), p("B", 400, "Kd Qd", false), p("C", 20, "4h 5h", true)], board);
    expect(r3.refunded.B).toBe(350); // uncalled part of B's bet
  });

  it("conserves chips over many hands of scripted play", () => {
    for (const lineup of [["station", "nit", "maniac"], ["solid", "maniac"], ["station", "nit", "maniac", "solid", "solid", "station"]]) {
      const seats = lineup.map((s, i) => ({ key: `${s}${i}`, name: s, strategy: STYLES[s](i), stack: 0, net: 0, buyIns: 0 }));
      const g = new Game(seats, { sb: 8, bb: 15, startStack: 500, seed: 3 });
      let netSum = 0;
      for (let i = 0; i < 300; i++) g.playHand();
      for (const s of seats) netSum += s.net;
      expect(netSum).toBe(0);
    }
  }, 60000);
});
