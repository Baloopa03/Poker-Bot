import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardsToString } from "../src/engine/cards";
import { Tracker } from "../src/tracker/tracker";
import type { HandHistory, TableState } from "../src/tracker/types";

function run(name: string) {
  const capture = JSON.parse(readFileSync(`tests/fixtures/pokerpatio/${name}`, "utf8"));
  const t = new Tracker();
  const hands: HandHistory[] = [];
  const heroTurns: Array<{ street: string; toCall: number; pot: number; board: string }> = [];
  t.on("handComplete", (h) => hands.push(h));
  t.on("heroTurn", (s: TableState) => {
    const hero = s.players.find((p) => p.seat === s.heroSeat)!;
    heroTurns.push({ street: s.street, toCall: s.currentBet - hero.committedStreet, pot: s.pot, board: cardsToString(s.board) });
  });
  for (const e of capture.entries) t.handle(e);
  return { t, hands, heroTurns };
}

const names = (h: HandHistory) => Object.fromEntries(h.players.map((p) => [p.key, p.name]));

describe("tracker: heads-up capture", () => {
  const { t, hands } = run("heads-up-5-hands.json");

  it("finishes 4 hands and matches every server pot", () => {
    expect(hands).toHaveLength(4);
    for (const h of hands) expect(h.result!.pot).toBe(h.result!.serverPot);
    expect(hands.map((h) => h.result!.pot)).toEqual([60, 790, 40, 20]);
  });

  it("reads hero cards, board and positions", () => {
    const h = hands[1];
    expect(cardsToString(h.heroCards!)).toBe("Ts Kc");
    expect(cardsToString(h.board)).toBe("Kh 2c 4s 5s Jd");
    expect(h.players.find((p) => p.name === "Jack")!.position).toBe("BB");
    expect(h.players.find((p) => p.name === "Test")!.position).toBe("SB");
    for (const x of hands) expect(x.board.length).toBeLessThanOrEqual(5);
  });

  it("classifies bets, raises and all-ins", () => {
    const h = hands[0];
    const n = names(h);
    expect(h.actions.map((a) => `${n[a.key]}:${a.type}:${a.added}`)).toEqual([
      "Jack:post:5", "Test:post:10", "Jack:call:5", "Test:check:0",
      "Test:check:0", "Jack:bet:10", "Test:raise:20", "Jack:call:10",
      "Test:check:0", "Jack:check:0", "Test:bet:335", "Jack:fold:0",
    ]);
    expect(h.actions[10].allIn).toBe(true);
  });

  it("records showdown cards of opponents only", () => {
    expect(Object.values(hands[1].result!.shown).map(cardsToString)).toEqual(["Js 2d"]);
    expect(hands[0].result!.shown).toEqual({});
  });

  it("keeps a balanced ledger", () => {
    const l = t.ledger();
    expect(l.reduce((x, r) => x + r.net, 0)).toBe(0);
  });
});

describe("tracker: 3-handed capture with re-buys and a cash-out", () => {
  const { t, hands, heroTurns } = run("3-handed-rebuy-cashout.json");

  it("matches every server pot, including a 3-way side pot", () => {
    expect(hands).toHaveLength(6);
    for (const h of hands) expect(h.result!.pot).toBe(h.result!.serverPot);
    const h3 = hands[2];
    const n = names(h3);
    const won = Object.fromEntries(Object.entries(h3.result!.won).map(([k, v]) => [n[k], v]));
    expect(won).toEqual({ Jack: 825, Test: 50, Test2: 0 });
  });

  it("picks up the blind change and 3-handed positions", () => {
    expect(hands.every((h) => h.sb === 8 && h.bb === 15)).toBe(true);
    const pos = Object.fromEntries(hands[0].players.map((p) => [p.name, p.position]));
    expect(pos).toEqual({ Jack: "BTN", Test: "SB", Test2: "BB" });
  });

  it("follows players across re-buys by account, not seat", () => {
    const keys = new Set(hands.flatMap((h) => h.players.filter((p) => p.name === "Test2").map((p) => p.key)));
    expect(keys.size).toBe(1);
    expect(hands[4].players.find((p) => p.name === "Test2")!.seat).toBe("s2_v2");
    expect(hands[0].players.find((p) => p.name === "Test2")!.seat).toBe("s6");
  });

  it("builds the session ledger: re-buys and the 1000 cash-out", () => {
    const l = Object.fromEntries(t.ledger().map((r) => [r.name, r]));
    expect(l.Jack).toMatchObject({ buyIns: 215, cashOuts: 1000, stack: 459, net: 1244 });
    expect(l.Test).toMatchObject({ buyIns: 1285, cashOuts: 0, stack: 470, net: -815 });
    expect(l.Test2).toMatchObject({ buyIns: 1000, cashOuts: 0, stack: 571, net: -429 });
  });

  it("works out stacks and cash-outs without admin-only events", () => {
    const capture = JSON.parse(readFileSync("tests/fixtures/pokerpatio/3-handed-rebuy-cashout.json", "utf8"));
    const t2 = new Tracker();
    const hands2: HandHistory[] = [];
    t2.on("handComplete", (h) => hands2.push(h));
    for (const e of capture.entries) {
      if (e.event?.startsWith("admin:")) continue;
      if (e.event === "chat_message" && ["pss", "sap", "sc"].includes(e.args?.[0]?.log?.e)) continue;
      t2.handle(e);
    }
    expect(hands2).toHaveLength(6);
    for (const h of hands2) expect(h.result!.pot).toBe(h.result!.serverPot);
    const l = Object.fromEntries(t2.ledger().map((r) => [r.name, r]));
    expect(l.Jack).toMatchObject({ buyIns: 215, cashOuts: 1000, net: 1244 });
    expect(l.Test).toMatchObject({ buyIns: 1285, net: -815 });
    expect(hands2.every((h) => h.bb === 15)).toBe(true);
  });

  it("reports the right price when it is the hero's turn", () => {
    expect(heroTurns[0]).toMatchObject({ street: "preflop", toCall: 15, pot: 23 });
    const facingShove = heroTurns.find((x) => x.toCall === 440)!;
    expect(facingShove).toMatchObject({ street: "turn", pot: 485, board: "3s 6h Ts 9d" });
  });
});

describe("tracker: cards shown after the hand", () => {
  it("records a voluntary show after an uncontested pot and feeds the opponent model", async () => {
    const { OpponentModel } = await import("../src/opponents/model");
    const capture = JSON.parse(readFileSync("tests/fixtures/pokerpatio/heads-up-5-hands.json", "utf8"));
    const entries = capture.entries as any[];
    const end = entries.findIndex((e) => e.event === "game:game_ended");
    const dealt = entries.find((e) => e.event === "game:cards_dealt_to_player").args[0];
    const testIds = dealt.filter((d: any) => d.playerPos === "s2_v2").map((d: any) => d.cardData.uniqueID);
    // Test bet the river and Jack folded; now Test shows 7h 2c (a bluff).
    const show = [
      { dir: "in", event: "game:update_card_data", args: [{ cardData: { uniqueID: testIds[0], suite: "hearts", value: "7" }, flipCard: true }] },
      { dir: "in", event: "game:update_card_data", args: [{ cardData: { uniqueID: testIds[1], suite: "clubs", value: "3" }, flipCard: true }] },
    ];
    const t = new Tracker();
    const m = new OpponentModel();
    const shown: string[] = [];
    t.on("handComplete", (h) => m.update(h));
    t.on("handShown", ({ history, key }) => {
      shown.push(cardsToString(history.result!.shown[key]));
      m.learnShown(history, key);
    });
    for (const e of [...entries.slice(0, end + 1), ...show]) t.handle(e);
    expect(shown).toEqual(["7h 3c"]);
    expect(t.state.heroCards.map((c) => c)).not.toContain(undefined);
    const test = [...m.players.values()].find((p) => p.name === "Test")!;
    // Two bets that hand (flop raise, river bet): the river one was a pure bluff.
    expect(test.counts.bluffShare).toEqual([1, 2]);
  });
});
