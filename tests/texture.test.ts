import { describe, expect, it } from "vitest";
import { parseCards } from "../src/engine/cards";
import { Range, parseRange } from "../src/engine/range";
import { boardNotes, playingTheBoard, rangeComposition } from "../src/engine/texture";

const h = (s: string) => parseCards(s) as [number, number];

describe("board reading", () => {
  it("spots what the newest card changed", () => {
    expect(boardNotes(parseCards("Kh 7h 2c 9h"))).toContain("The 9♥ made a flush possible");
    expect(boardNotes(parseCards("Kh 7d 2c 7s"))[0]).toBe("The 7♠ paired the board: full houses are now possible");
    expect(boardNotes(parseCards("Ks 9d 2c Th"))).toContain("The 10♥ made a straight possible");
    expect(boardNotes(parseCards("Ks 9d 2c 8h"))).toEqual([]); // 8-9-K: no straight with two cards
    expect(boardNotes(parseCards("Ah Ad 7c"))).toContain("Paired board: full houses and trips are possible");
  });

  it("warns when your pair is really the board's", () => {
    expect(playingTheBoard(h("Kc 9d"), parseCards("Ah Ad 7c 4s"))).toBe("The pair is on the board, so everyone has it: your real hand is just K-high kicker");
    expect(playingTheBoard(h("7d 2c"), parseCards("Ah Ad Kc Ks Qh"))).toMatch(/playing the board/);
    expect(playingTheBoard(h("Ac 9d"), parseCards("Ah Kd 7c"))).toBeUndefined(); // a real pair
  });

  it("breaks a range down into hand types", () => {
    const comp = Object.fromEntries(rangeComposition(parseRange("KK, 99, AhQh, 87s, 32o"), parseCards("Kh 9h 6h")));
    expect(comp.set).toBeGreaterThan(0.2); // KK and 99 make sets
    expect(comp.flush).toBeGreaterThan(0); // AhQh
    expect(comp.draw).toBeGreaterThan(0); // 8-7 suited: straight / flush draws
    const pairs = Object.fromEntries(rangeComposition(parseRange("AA, KQo, 98s"), parseCards("Ks 9d 2c")));
    expect(Object.keys(pairs).sort()).toEqual(["overpair", "top pair", "weaker pair"]);
    const all = rangeComposition(Range.full(), parseCards("2c 7d Js"));
    expect(all.reduce((s, [, v]) => s + v, 0)).toBeCloseTo(1, 6);
  });
});
