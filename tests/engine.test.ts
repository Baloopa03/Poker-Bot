import { describe as suite, expect, it } from "vitest";
import { cardToString, parseCard, parseCards, parseSiteCard } from "../src/engine/cards";
import { Category, categoryOf, describe, evaluate } from "../src/engine/evaluator";
import { equity, riverEquityExact } from "../src/engine/equity";
import { ALL_CLASSES, CLASS_INDEX, NUM_COMBOS, Range, parseRange, singleCombo } from "../src/engine/range";

const ev = (s: string) => evaluate(parseCards(s));
const hand = (s: string) => parseCards(s) as [number, number];

suite("cards", () => {
  it("parses both notations", () => {
    expect(cardToString(parseCard("10h"))).toBe("Th");
    expect(cardToString(parseCard("Th"))).toBe("Th");
    expect(cardToString(parseSiteCard("spades", "10"))).toBe("Ts");
    expect(cardToString(parseSiteCard("diamonds", "A"))).toBe("Ad");
    expect(parseCards("Ah 10c 2d").map(cardToString)).toEqual(["Ah", "Tc", "2d"]);
  });
});

suite("evaluator", () => {
  it("counts every 5-card hand category exactly", () => {
    const counts = new Array(9).fill(0);
    const c = new Int32Array(5);
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let d = b + 1; d < 52; d++)
          for (let e = d + 1; e < 52; e++)
            for (let f = e + 1; f < 52; f++) {
              c[0] = a; c[1] = b; c[2] = d; c[3] = e; c[4] = f;
              counts[categoryOf(evaluate(c))]++;
            }
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
  });

  it("orders hands correctly", () => {
    expect(ev("As Ks Qs Js Ts 2c 3d")).toBeGreaterThan(ev("9s 9h 9d 9c Ah 2c 3d"));
    expect(ev("Ah 2c 3d 4s 5h Kd Qc")).toBeLessThan(ev("2c 3d 4s 5h 6h Kd Qc")); // wheel < six-high
    expect(categoryOf(ev("Ah 2c 3d 4s 5h Kd Qc"))).toBe(Category.Straight);
    expect(ev("Ah Ad Kc Kd 2s 2h 7c")).toBe(ev("Ah Ad Kc Kd 7c 3s 4h")); // third pair irrelevant
    expect(ev("Ah Ad Ks 9d 7c 3s 2h")).toBeGreaterThan(ev("Ah Ad Qs Jd 9c 3s 2h")); // kicker
    expect(ev("7h 7d 7s 2c 2d 2h Kc")).toBeGreaterThan(ev("7h 7d 7s 2c 2d Kh Qc") - 1); // trips+trips = full house
    expect(categoryOf(ev("7h 7d 7s 2c 2d 2h Kc"))).toBe(Category.FullHouse);
    expect(describe(ev("Kh Kd 7s 7c 2d"))).toBe("two pair, Ks and 7s");
  });
});

suite("ranges", () => {
  it("has 169 classes covering 1326 combos", () => {
    expect(ALL_CLASSES.length).toBe(169);
    let n = 0;
    for (const v of CLASS_INDEX.values()) n += v.length;
    expect(n).toBe(NUM_COMBOS);
  });
  it("parses range notation", () => {
    expect(parseRange("22+").size()).toBe(78);
    expect(parseRange("A2s+").size()).toBe(48);
    expect(parseRange("KTo+").size()).toBe(36);
    expect(parseRange("AK").size()).toBe(16);
    expect(parseRange("T9s-T6s").size()).toBe(16);
    expect(parseRange("55-77").size()).toBe(18);
    expect(parseRange("AhKh").size()).toBe(1);
    expect(parseRange("QJs:0.5").size()).toBe(2);
    expect(parseRange("any").size()).toBe(1326);
  });
});

suite("equity", () => {
  it("AA vs KK preflop is about 82%", () => {
    const r = equity({ hero: hand("As Ah"), board: [], villains: [parseRange("KK")], iterations: 40000, seed: 1 });
    expect(r.equity).toBeGreaterThan(0.80);
    expect(r.equity).toBeLessThan(0.84);
  });
  it("AKs vs QQ is roughly a coin flip (~46%)", () => {
    const r = equity({ hero: hand("As Ks"), board: [], villains: [parseRange("QQ")], iterations: 40000, seed: 2 });
    expect(r.equity).toBeGreaterThan(0.44);
    expect(r.equity).toBeLessThan(0.48);
  });
  it("AA vs two random hands is about 73%", () => {
    const r = equity({ hero: hand("As Ah"), board: [], villains: [Range.full(), Range.full()], iterations: 40000, seed: 3 });
    expect(r.equity).toBeGreaterThan(0.71);
    expect(r.equity).toBeLessThan(0.755);
  });
  it("made flush on the river beats everything but bigger flushes/boats", () => {
    const board = parseCards("2h 7h Jh Kc 3s");
    const r = riverEquityExact(hand("Ah 4h"), board, Range.full());
    expect(r.equity).toBeGreaterThan(0.99);
    const nuts = riverEquityExact(hand("Ah 4h"), board, singleCombo(...hand("Qh Th")));
    expect(nuts.equity).toBe(1);
  });
});
