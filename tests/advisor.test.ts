import { describe, expect, it } from "vitest";
import { advise } from "../src/engine/advisor";
import { parseCards } from "../src/engine/cards";
import { OpponentModel } from "../src/opponents/model";
import type { HandAction, PlayerState, Position, Street, TableState } from "../src/tracker/types";

// Build a 3-handed table: hero on the button by default, blinds 8/15.
function player(key: string, seat: string, position: Position, stack: number, committed = 0): PlayerState {
  return { key, name: key, id: 0, seat, stack, startStack: stack + committed, committedStreet: committed, committedHand: committed, inHand: true, folded: false, allIn: false, cards: [], position };
}

function table(opts: {
  hero: string;
  board?: string;
  street?: Street;
  players: PlayerState[];
  actions?: Partial<HandAction>[];
  currentBet?: number;
  pot?: number;
}): TableState {
  const players = opts.players;
  const pot = opts.pot ?? players.reduce((s, p) => s + p.committedHand, 0);
  return {
    handNumber: 1,
    handActive: true,
    street: opts.street ?? "preflop",
    sb: 8,
    bb: 15,
    board: opts.board ? parseCards(opts.board) : [],
    players,
    heroSeat: players[0].seat,
    heroKey: players[0].key,
    heroCards: parseCards(opts.hero),
    currentBet: opts.currentBet ?? Math.max(...players.map((p) => p.committedStreet)),
    lastRaiseSize: 15,
    pot,
    actions: (opts.actions ?? []) as HandAction[],
    paused: false,
  };
}

const blinds = (): Partial<HandAction>[] => [
  { key: "sam", seat: "s2", street: "preflop", type: "post", added: 8, toTotal: 8, facing: 0, potBefore: 0, raisesBefore: 0 },
  { key: "jules", seat: "s3", street: "preflop", type: "post", added: 15, toTotal: 15, facing: 8, potBefore: 8, raisesBefore: 0 },
];

const unopenedButton = (hero: string) =>
  table({
    hero,
    players: [player("me", "s1", "BTN", 500), player("sam", "s2", "SB", 492, 8), player("jules", "s3", "BB", 485, 15)],
    actions: blinds(),
  });

const model = new OpponentModel();
const legal = (s: TableState, a: NonNullable<ReturnType<typeof advise>>) => {
  const hero = s.players[0];
  for (const o of a.options) {
    expect(o.added).toBeLessThanOrEqual(hero.stack);
    expect(o.added).toBeGreaterThanOrEqual(0);
    if (o.toTotal !== undefined && !o.allIn) expect(o.toTotal).toBeGreaterThanOrEqual(s.currentBet + Math.max(s.lastRaiseSize, s.bb));
  }
};

describe("advisor", () => {
  it("raises aces and folds 72o on the button", () => {
    const aa = unopenedButton("As Ah");
    const a = advise(aa, model, { seed: 1 })!;
    expect(a.best.action).toBe("raise");
    legal(aa, a);
    expect(advise(unopenedButton("7c 2d"), model, { seed: 1 })!.best.action).toBe("fold");
  });

  it("never folds the nuts on the river and raises it", () => {
    const s = table({
      hero: "Ah Kh",
      board: "Qh Jh Th 2c 3d",
      street: "river",
      players: [player("me", "s1", "BTN", 400, 0), player("sam", "s2", "SB", 300, 60)],
      currentBet: 60,
      pot: 160,
      actions: [...blinds(), { key: "sam", seat: "s2", street: "river", type: "bet", added: 60, toTotal: 60, facing: 0, potBefore: 100, raisesBefore: 0 }],
    });
    s.players[0].committedHand = 50;
    const a = advise(s, model, { seed: 2 })!;
    expect(a.equity).toBe(1);
    expect(a.best.action).toBe("raise");
    legal(s, a);
  });

  it("folds a weak hand to an all-in with bad odds", () => {
    const s = table({
      hero: "8c 3d",
      board: "Ks Qs 7h",
      street: "flop",
      players: [player("me", "s1", "BTN", 470, 0), player("sam", "s2", "SB", 0, 470)],
      currentBet: 470,
      pot: 530,
      actions: [...blinds(), { key: "sam", seat: "s2", street: "flop", type: "bet", added: 470, toTotal: 470, facing: 0, potBefore: 60, raisesBefore: 0, allIn: true }],
    });
    s.players[1].allIn = true;
    const a = advise(s, model, { seed: 3 })!;
    expect(a.best.action).toBe("fold");
  });

  it("calls an all-in when the price is right", () => {
    // Pot 1000, 100 to call: needs ~9% equity; any two cards have more.
    const s = table({
      hero: "9c 8c",
      board: "Kd 7s 2h",
      street: "flop",
      players: [player("me", "s1", "BTN", 400, 0), player("sam", "s2", "SB", 0, 100)],
      currentBet: 100,
      pot: 1000,
      actions: [...blinds(), { key: "sam", seat: "s2", street: "flop", type: "bet", added: 100, toTotal: 100, facing: 0, potBefore: 900, raisesBefore: 0, allIn: true }],
    });
    s.players[1].allIn = true;
    expect(advise(s, model, { seed: 4 })!.best.action).toBe("call");
  });

  it("bets a strong made hand when checked to", () => {
    const s = table({
      hero: "Kd Kc",
      board: "Ks 7h 2c",
      street: "flop",
      players: [player("me", "s1", "BTN", 450), player("sam", "s2", "SB", 450)],
      currentBet: 0,
      pot: 100,
      actions: [...blinds(), { key: "sam", seat: "s2", street: "flop", type: "check", added: 0, toTotal: 0, facing: 0, potBefore: 100, raisesBefore: 0 }],
    });
    const a = advise(s, model, { seed: 5 })!;
    expect(a.best.action).toBe("bet");
    expect(a.equity).toBeGreaterThan(0.9);
  });

  it("returns nothing when it isn't a real decision", () => {
    const s = unopenedButton("As Ah");
    s.heroCards = [];
    expect(advise(s, model)).toBeNull();
  });

  it("decides within a time budget", () => {
    const t0 = performance.now();
    advise(unopenedButton("Ts 9s"), model, { seed: 6 });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("opponent model", () => {
  it("learns from hand histories and stays near priors early", () => {
    const m = new OpponentModel();
    const p = m.profile("x");
    expect(p.stat("vpip")).toBeCloseTo(0.5);
    for (let i = 0; i < 40; i++)
      m.update({
        handNumber: i,
        sb: 8,
        bb: 15,
        board: [],
        players: [
          { key: "x", name: "X", seat: "s1", startStack: 500, position: "BTN" },
          { key: "y", name: "Y", seat: "s2", startStack: 500, position: "SB" },
          { key: "z", name: "Z", seat: "s3", startStack: 500, position: "BB" },
        ],
        actions: [
          { key: "x", seat: "s1", street: "preflop", type: "raise", added: 38, toTotal: 38, facing: 15, potBefore: 23, allIn: false, raisesBefore: 0, auto: false },
          { key: "y", seat: "s2", street: "preflop", type: "fold", added: 0, toTotal: 8, facing: 38, potBefore: 61, allIn: false, raisesBefore: 1, auto: false },
          { key: "z", seat: "s3", street: "preflop", type: "fold", added: 0, toTotal: 15, facing: 38, potBefore: 61, allIn: false, raisesBefore: 1, auto: false },
        ],
      });
    const x = m.profile("x");
    expect(x.stat("pfr")).toBeGreaterThan(0.8);
    expect(x.stat("steal")).toBeGreaterThan(0.8);
    expect(m.profile("z").stat("foldToSteal")).toBeGreaterThan(0.8);
    const restored = OpponentModel.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    expect(restored.profile("x").stat("pfr")).toBeCloseTo(x.stat("pfr"));
  });
});

describe("profile merging and reads toggle", () => {
  const hand = (key: string, name: string, foldsPre: boolean) => ({
    handNumber: 1,
    sb: 8,
    bb: 15,
    board: [],
    players: [
      { key, name, seat: "s1", startStack: 500, position: "BTN" as const },
      { key: "me", name: "Me", seat: "s2", startStack: 500, position: "BB" as const },
    ],
    actions: [
      { key, seat: "s1", street: "preflop" as const, type: (foldsPre ? "fold" : "raise") as "fold" | "raise", added: foldsPre ? 0 : 38, toTotal: foldsPre ? 0 : 38, facing: 15, potBefore: 23, allIn: false, raisesBefore: 0, auto: false },
    ],
  });

  it("combines two accounts into one profile and routes future hands to it", () => {
    const m = new OpponentModel();
    for (let i = 0; i < 10; i++) m.update(hand("acct-a", "Sam", false));
    for (let i = 0; i < 10; i++) m.update(hand("acct-b", "Sammy", true));
    m.merge("acct-b", "acct-a");
    expect(m.players.has("acct-b")).toBe(false);
    expect(m.profile("acct-a").hands).toBe(20);
    expect(m.profile("acct-b").hands).toBe(20); // the old account resolves to the merged profile
    expect(m.players.get("acct-a")!.aliasNames).toContain("Sammy");
    m.update(hand("acct-b", "Sammy", true));
    expect(m.profile("acct-a").hands).toBe(21);
    const restored = OpponentModel.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    expect(restored.profile("acct-b").hands).toBe(21);
  });

  it("reads off gives the same advice as an empty model", () => {
    const learned = new OpponentModel();
    for (let i = 0; i < 60; i++) learned.update(hand("sam", "sam", true));
    const s = unopenedButton("Ts 9s");
    const off = advise(s, learned, { seed: 9, useReads: false })!;
    const fresh = advise(s, new OpponentModel(), { seed: 9 })!;
    expect(off.best.label).toBe(fresh.best.label);
    expect(off.usedReads).toBe(false);
    expect(off.options.map((o) => o.ev)).toEqual(fresh.options.map((o) => o.ev));
  });
});
