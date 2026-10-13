import { type Card, cardsToString } from "./cards";
import { equity, riverEquityExact } from "./equity";
import { COMBOS as COMBO_CARDS, NUM_COMBOS, Range, classOf } from "./range";
import { equityVsRange, preflopComboStrengths, preflopEquityVsTop, preflopScores } from "./strength";
import { boardNotes, playingTheBoard, rangeComposition } from "./texture";
import { OpponentModel, type Profile } from "../opponents/model";
import { bettingSplit, boardStrengths, estimateRange, inTop, rangePercentiles, rangeWidth, respondToBet } from "../opponents/ranges";
import type { HandAction, PlayerState, Position, TableState } from "../tracker/types";

// The decision engine. Every legal option is scored by expected chips won
// relative to folding now, using each villain's estimated range, how often
// they fold to a bet of that size, whether they raise back, and how much
// equity hero realises when the hand goes on.

export type AdviceAction = "fold" | "check" | "call" | "bet" | "raise";

export interface AdviceOption {
  action: AdviceAction;
  /** Street total after the action (bets/raises), e.g. "raise to 45". */
  toTotal?: number;
  /** Chips hero adds now. */
  added: number;
  allIn: boolean;
  ev: number;
  label: string;
  /** Probability every villain folds (aggressive options). */
  foldProb?: number;
  /** Hero equity when called (aggressive options). */
  equityWhenCalled?: number;
  /** Rough variance of the result in chips², used by careful mode. */
  variance?: number;
  /** What the option is ranked by: EV, minus a risk charge in careful mode. */
  score?: number;
}

export interface VillainView {
  key: string;
  name: string;
  position?: Position;
  /** Estimated range width, 0..1 of all hands. */
  rangeWidth: number;
  style: string;
  hands: number;
  /** A few of the most likely hand classes. */
  likely: string[];
  /** What their range is made of on this board, e.g. [["flush", 0.38], …]. */
  composition: Array<[string, number]>;
}

export interface Advice {
  street: TableState["street"];
  best: AdviceOption;
  options: AdviceOption[];
  /** Hero equity vs all live villains' current ranges. */
  equity: number;
  toCall: number;
  pot: number;
  /** Equity needed to call (0 if nothing to call). */
  potOdds: number;
  reasons: string[];
  /** Plain notes about the board ("The 9♥ made a flush possible"). */
  boardNotes: string[];
  villains: VillainView[];
  heroCards: string;
  /** False while reads are mostly priors (few hands seen). */
  confident: boolean;
  usedReads: boolean;
}

export interface AdvisorOptions {
  iterations?: number;
  seed?: number;
  /**
   * false = ignore what's been learned about these players and treat everyone
   * as a typical player (default assumptions only).
   */
  useReads?: boolean;
  /**
   * Careful mode: chips of swing you're comfortable with. Options are ranked
   * by EV − variance / (2 × tolerance) (the standard mean–variance trade-off),
   * so small pots play as normal but big coin flips need a real edge.
   * Undefined = rank purely by expected chips (best long-run result).
   */
  riskTolerance?: number;
}

const POSTFLOP_ORDER: Record<Position, number> = { SB: 0, BB: 1, UTG: 2, MP: 3, CO: 4, BTN: 5 };
const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));
const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Ctx {
  s: TableState;
  hero: PlayerState;
  heroCards: [Card, Card];
  villains: PlayerState[];
  profiles: Profile[];
  ranges: Range[];
  headsUp: boolean;
  heroInPosition: boolean;
  toCall: number;
  bb: number;
  iterations: number;
  seed: number;
  preflop: boolean;
  /** Raises so far on this street (excluding blinds). */
  raises: number;
  heroWasPreflopAggressor: boolean;
  /** How opponents see you: your own profile (from the hands you've played). */
  heroProfile: Profile;
  dealt: number;
}

export function advise(s: TableState, learned: OpponentModel, opts: AdvisorOptions = {}): Advice | null {
  const useReads = opts.useReads ?? true;
  const model = useReads ? learned : new OpponentModel();
  const hero = s.players.find((p) => p.seat === s.heroSeat);
  if (!hero || s.heroCards.length !== 2 || hero.folded || !s.handActive || s.street === "showdown") return null;
  if (hero.stack <= 0) return null;
  const heroCards = s.heroCards as unknown as [Card, Card];
  const villains = s.players.filter((p) => p.key !== hero.key && p.inHand && !p.folded);
  if (!villains.length) return null;

  const dealt = s.players.filter((p) => p.inHand).length;
  const headsUp = dealt === 2;
  const profiles = villains.map((v) => model.profile(v.key, v.name, dealt));
  // Show your People names (e.g. "Isaiah") rather than tonight's guest name.
  const displayName = (i: number) => profiles[i].name || villains[i].name;
  const ranges = villains.map((v, i) =>
    estimateRange({ key: v.key, profile: profiles[i], position: v.position, headsUp, players: dealt, actions: s.actions, board: s.board, dead: heroCards }),
  );
  // Never let a read wipe a range out entirely.
  ranges.forEach((r, i) => {
    if (r.size() < 1) ranges[i] = Range.full().removeCards([...heroCards, ...s.board]);
  });

  const order = (p: PlayerState) => (headsUp ? (p.position === "SB" ? 1 : 0) : POSTFLOP_ORDER[p.position ?? "BB"]);
  const heroInPosition = villains.every((v) => order(hero) > order(v));
  const preflopRaisers = s.actions.filter((a) => a.street === "preflop" && (a.type === "raise" || a.type === "bet"));
  const ctx: Ctx = {
    s,
    hero,
    heroCards,
    villains,
    profiles,
    ranges,
    headsUp,
    heroInPosition,
    toCall: Math.min(s.currentBet - hero.committedStreet, hero.stack),
    bb: s.bb || 1,
    iterations: opts.iterations ?? 2500,
    seed: opts.seed ?? s.handNumber * 7919 + s.board.length * 31 + s.actions.length,
    preflop: s.street === "preflop",
    raises: s.actions.filter((a) => a.street === s.street && (a.type === "raise" || a.type === "bet")).length,
    heroWasPreflopAggressor: preflopRaisers.length > 0 && preflopRaisers[preflopRaisers.length - 1].key === hero.key,
    heroProfile: model.profile(hero.key, hero.name, dealt),
    dealt,
  };

  const eqAll = equityVs(ctx, ranges);
  const options = buildOptions(ctx, eqAll);
  const T = opts.riskTolerance;
  for (const o of options) o.score = T ? o.ev - (o.variance ?? 0) / (2 * T) : o.ev;
  options.sort((a, b) => b.score! - a.score!);
  const best = options[0];
  const bestByEv = options.reduce((x, y) => (y.ev > x.ev ? y : x));
  const carefulNote =
    T && bestByEv !== best
      ? [`Careful mode: ${best.label} instead of ${bestByEv.label} (${bestByEv.ev >= 0 ? "+" : ""}${fmt(bestByEv.ev)} chips) to avoid a big swing`]
      : [];

  const limpSpot = ctx.preflop && ctx.raises === 0;
  const potOdds = ctx.toCall > 0 && !limpSpot ? ctx.toCall / (s.pot + ctx.toCall) : 0;
  const villainViews: VillainView[] = villains.map((v, i) => ({
    key: v.key,
    name: displayName(i),
    position: v.position,
    rangeWidth: rangeWidth(ranges[i]),
    style: profiles[i].style,
    hands: profiles[i].hands,
    likely: likelyClasses(ranges[i], s.board.length >= 3 ? boardStrengths(s.board) : preflopComboStrengths()),
    composition: rangeComposition(ranges[i], s.board, heroCards),
  }));
  const notes = boardNotes(s.board);

  return {
    street: s.street,
    best,
    options,
    equity: eqAll,
    toCall: ctx.toCall,
    pot: s.pot,
    potOdds,
    reasons: [
      ...carefulNote,
      ...(useReads ? [] : ["Reads off: everyone treated as a typical player"]),
      ...boardReasons(ctx, villainViews, notes),
      ...explain(ctx, best, options, eqAll, potOdds),
    ],
    boardNotes: notes,
    villains: villainViews,
    heroCards: cardsToString(heroCards),
    confident: !useReads || profiles.every((p) => p.hands >= 100),
    usedReads: useReads,
  };
}

function equityVs(ctx: Ctx, ranges: Range[], salt = 0): number {
  const live = ranges.filter((r) => r.size() > 1e-6);
  if (!live.length) return 1;
  if (live.length === 1 && ctx.s.board.length === 5) return riverEquityExact(ctx.heroCards, ctx.s.board, live[0]).equity;
  try {
    return equity({ hero: ctx.heroCards, board: ctx.s.board, villains: live, iterations: ctx.iterations, seed: ctx.seed + salt }).equity;
  } catch {
    return 0.5;
  }
}

/**
 * Fraction of equity hero actually collects when the hand continues to later
 * streets. Position matters, and so does hand strength: strong hands win more
 * than their raw share (they get paid later), weak hands less (they get bet off
 * the pot). All-in or on the river, equity is exactly what you get.
 */
function realization(ctx: Ctx, allInNow: boolean, eq = 0.5): number {
  if (allInNow || ctx.s.street === "river") return 1;
  // Typical realisation (solver studies): in position ~100–110% of raw equity,
  // big blind out of position ~60–75%, small blind (worst seat) a bit lower.
  let base: number;
  if (ctx.preflop) base = ctx.heroInPosition ? 1.02 : ctx.hero.position === "SB" ? 0.7 : 0.84;
  else base = ctx.heroInPosition ? 1.0 : 0.85;
  // Strong hands over-realise, weak ones under-realise. Preflop the spread is
  // wider: weak offsuit hands get bet off the pot or dominated far more often.
  const byStrength = ctx.preflop ? Math.min(1.15, Math.max(0.72, 0.55 + 0.9 * eq)) : Math.min(1.12, Math.max(0.8, 0.75 + 0.5 * eq));
  return Math.min(1.15, base * byStrength);
}

/** How often this villain continues vs a ~2/3-pot bet / standard raise in the current spot. */
function baseContinue(ctx: Ctx, i: number): number {
  const p = ctx.profiles[i];
  const v = ctx.villains[i];
  if (ctx.preflop) {
    if (ctx.raises === 0) {
      // Hero opening or isolating: blinds defend at roughly 1 − fold-to-steal.
      // Blinds defend steals unequally when both are still in: the small blind
      // (out of position, big blind behind) defends about half as often as the big blind.
      const blindDefend = 1 - p.stat("foldToSteal");
      const defend =
        v.position === "BB"
          ? Math.min(0.9, blindDefend * (ctx.headsUp ? 1 : 1.1))
          : v.position === "SB" && !ctx.headsUp
            ? blindDefend * 0.55
            : v.position === "SB"
              ? blindDefend
              : p.stat("callOpen") + p.stat("threeBet");
      return Math.min(0.9, Math.max(0.1, defend));
    }
    if (ctx.raises === 1) return Math.min(0.9, Math.max(0.15, 1 - p.stat("foldTo3Bet")));
    return 0.45; // vs 4-bets: continue with a fair share of an already strong range
  }
  const cbet = ctx.s.street === "flop" && ctx.heroWasPreflopAggressor && ctx.raises === 0;
  return 1 - (cbet ? p.stat("foldToCbet") : p.foldToBet(ctx.s.street as "flop" | "turn" | "river"));
}

/**
 * EV of calling. Villains who already matched the bet are in for sure;
 * villains still to act behind us may fold or continue (enumerated).
 */
function callEV(ctx: Ctx, eqAll: number): number {
  if (ctx.preflop && ctx.raises === 0) return limpEV(ctx, eqAll);
  const { s, hero, villains, toCall } = ctx;
  const allIn = toCall >= hero.stack;
  const pending = villains.map((v, i) => i).filter((i) => !villains[i].allIn && villains[i].committedStreet < s.currentBet);
  // A call that leaves only a few chips behind is an all-in in all but name:
  // there is no later betting to under-realise equity against.
  const behind = hero.stack - toCall;
  const noMoreBetting = (pot: number) => allIn || behind <= 0.1 * pot;
  if (!pending.length) {
    const R = realization(ctx, noMoreBetting(s.pot + toCall) || villains.every((v) => v.allIn), eqAll);
    return R * eqAll * (s.pot + toCall) - toCall;
  }
  const heroTo = hero.committedStreet + toCall;
  const resp = pending.map((i) => {
    const v = villains[i];
    const callAmt = Math.max(0, Math.min(s.currentBet, v.committedStreet + v.stack) - v.committedStreet);
    const ratio = callAmt / Math.max(1, s.pot + toCall - callAmt);
    const base = ctx.preflop ? (ctx.raises <= 1 ? ctx.profiles[i].stat("callOpen") + ctx.profiles[i].stat("threeBet") : 0.3) : 1 - ctx.profiles[i].foldToBet(s.street as "flop");
    return { i, callAmt, ...respondToBet(ctx.ranges[i], s.board, ctx.profiles[i], ratio, Math.min(0.9, base)) };
  });
  let ev = 0;
  for (const { mask, prob } of continueScenarios(resp.map((r) => 1 - r.fold))) {
    const ranges = villains.map((_, i) => {
      const k = resp.findIndex((r) => r.i === i);
      if (k < 0) return ctx.ranges[i];
      return mask & (1 << k) ? resp[k].continuing : null;
    });
    const live = ranges.filter((r): r is Range => r !== null);
    const extra = resp.reduce((sum, r, k) => sum + (mask & (1 << k) ? Math.min(r.callAmt, Math.max(0, heroTo - villains[r.i].committedStreet)) : 0), 0);
    const eq = live.length === villains.length ? eqAll : equityVs(ctx, live, 101 + mask);
    // Nobody left who can still bet (everyone else in is all-in) also means no more betting.
    const othersAllIn = villains.every((v, i) => {
      if (ranges[i] === null) return true;
      const k = resp.findIndex((r) => r.i === i);
      return k < 0 ? v.allIn : v.committedStreet + v.stack <= heroTo;
    });
    const R = realization(ctx, noMoreBetting(s.pot + toCall + extra) || othersAllIn, eq);
    ev += prob * (R * eq * (s.pot + toCall + extra) - toCall);
  }
  return ev;
}

/**
 * Limping (or completing the small blind). Players still to act, including
 * the big blind who has the option, can raise; we then usually give up the
 * limp. Otherwise we see a flop against the hands that didn't raise.
 */
function limpEV(ctx: Ctx, eqAll: number): number {
  const { s, villains, toCall } = ctx;
  const pre = preflopComboStrengths();
  let pNoRaise = 1;
  const passive: Range[] = [];
  villains.forEach((v, i) => {
    const acted = s.actions.some((a) => a.key === v.key && a.street === "preflop" && a.type !== "post");
    if (acted || v.allIn) {
      passive.push(ctx.ranges[i]);
      return;
    }
    // Raise-over-a-limp frequency: roughly their preflop raise rate.
    const frac = Math.min(0.5, ctx.profiles[i].stat("pfr") * 0.9);
    const q = rangePercentiles(ctx.ranges[i], pre);
    const checks = new Range(Float64Array.from(ctx.ranges[i].w, (w, k) => w * (1 - inTop(q[k], frac))));
    const total = ctx.ranges[i].size();
    pNoRaise *= total > 0 ? checks.size() / total : 1;
    passive.push(checks);
  });
  const eq = passive.every((r, i) => r === ctx.ranges[i]) ? eqAll : equityVs(ctx, passive, 307);
  const noRaise = realization(ctx, false, eq) * eq * (s.pot + toCall) - toCall;
  return pNoRaise * noRaise + (1 - pNoRaise) * -toCall;
}

function buildOptions(ctx: Ctx, eqAll: number): AdviceOption[] {
  const { s, hero, toCall } = ctx;
  const out: AdviceOption[] = [];
  const maxTo = hero.committedStreet + hero.stack;
  const allInNow = (added: number) => added >= hero.stack;

  // Passive options.
  if (toCall <= 0) {
    out.push({ action: "check", added: 0, allIn: false, ev: checkEV(ctx, eqAll), label: "Check", variance: eqAll * (1 - eqAll) * s.pot ** 2 * 0.5 });
  } else {
    out.push({ action: "fold", added: 0, allIn: false, ev: 0, label: "Fold" });
    const limp = ctx.preflop && ctx.raises === 0;
    const label = allInNow(toCall)
      ? `Call all-in (${toCall})`
      : limp
        ? hero.position === "SB" && s.currentBet - hero.committedStreet < ctx.bb ? `Complete ${toCall}` : `Limp ${toCall}`
        : `Call ${toCall}`;
    out.push({ action: "call", added: toCall, allIn: allInNow(toCall), ev: callEV(ctx, eqAll), label, variance: eqAll * (1 - eqAll) * (s.pot + toCall) ** 2 });
  }

  // Aggressive options.
  const canRaise = hero.stack > toCall && ctx.villains.some((v) => !v.allIn && v.stack > 0);
  if (!canRaise) return out;
  const minTo = s.currentBet > 0 ? s.currentBet + Math.max(s.lastRaiseSize, ctx.bb) : ctx.bb;
  const targets = new Set<number>();
  // Round what you type into the raise box (amount on top of the current bet)
  // to a tidy multiple of 5, never below a legal raise.
  const step = ctx.bb >= 10 ? 5 : 1;
  const tidy = (t: number) => {
    let to = s.currentBet + Math.round((t - s.currentBet) / step) * step;
    if (to < minTo) to = s.currentBet + Math.ceil((minTo - s.currentBet) / step) * step;
    return Math.min(maxTo, to);
  };
  for (const t of sizeTargets(ctx)) {
    const to = tidy(t);
    if (to > s.currentBet) targets.add(to);
  }
  targets.add(maxTo);
  // Bets within ~12% of all-in: just shove instead.
  for (const t of [...targets]) if (t !== maxTo && maxTo - t < 0.12 * maxTo) targets.delete(t);

  const biggestVillain = Math.max(...ctx.villains.map((v) => v.committedStreet + v.stack));
  for (const to of [...targets].sort((a, b) => a - b)) {
    const o = aggressiveEV(ctx, to);
    // Fold estimates for bets far beyond pot size are extrapolations: demand a margin.
    const risk = Math.min(to, biggestVillain) - hero.committedStreet;
    const overPot = Math.max(0, risk - (s.pot + toCall));
    // Mild risk aversion: near-ties go to the smaller, more robust size. Huge
    // overbets with streets still to come also cost the value of being paid
    // off later by worse hands, which the one-street model doesn't see.
    const streetsLeft = s.street === "flop" ? 2 : s.street === "turn" ? 1 : 0;
    o.ev -= 0.015 * Math.max(0, risk) + 0.04 * overPot + 0.03 * streetsLeft * Math.max(0, overPot - (s.pot + toCall));
    const action: AdviceAction = s.currentBet > 0 ? "raise" : "bet";
    const isAllIn = to >= maxTo;
    const sizeNote = ctx.preflop ? `${fmt(to / ctx.bb)} BB` : `${Math.round(((to - s.currentBet) / Math.max(1, s.pot + toCall)) * 100)}% pot`;
    out.push({
      action,
      toTotal: to,
      added: to - hero.committedStreet,
      allIn: isAllIn,
      ev: o.ev,
      foldProb: o.foldProb,
      equityWhenCalled: o.eqCalled,
      variance:
        (1 - o.foldProb) * o.eqCalled * (1 - o.eqCalled) * (s.pot + 2 * Math.max(0, risk)) ** 2 +
        o.foldProb * (1 - o.foldProb) * (s.pot + Math.max(0, risk)) ** 2,
      label: isAllIn ? `All-in (${to})` : `${action === "bet" ? "Bet" : "Raise to"} ${to} (${sizeNote})`,
    });
  }
  return out;
}

/** Candidate "to" amounts for bets and raises in this spot. */
function sizeTargets(ctx: Ctx): number[] {
  const { s, bb } = ctx;
  if (ctx.preflop) {
    if (ctx.raises === 0) {
      const limpers = s.actions.filter((a) => a.street === "preflop" && a.type === "call").length;
      if (limpers > 0) return [bb * (3.5 + limpers), bb * (4.5 + limpers)];
      const open = ctx.hero.position === "SB" && !ctx.headsUp ? 3 : 2.5;
      return [bb * open, bb * (open + 1)];
    }
    const mult = ctx.heroInPosition ? 3 : 3.8;
    return [s.currentBet * mult, s.currentBet * (mult + 1)];
  }
  const potAfterCall = s.pot + ctx.toCall;
  if (s.currentBet === 0) return [0.33, 0.5, 0.75, 1, 1.5].map((f) => f * s.pot);
  // Raises: "to" = current bet + fraction of the pot after calling.
  return [0.75, 1.1].map((f) => s.currentBet + f * potAfterCall);
}

/**
 * EV of checking. Heads-up with the opponent still to act, model their reply:
 * they bet their strong hands plus some bluffs (by their stats) and we then
 * call or fold against that betting range; otherwise the hand checks through.
 */
function checkEV(ctx: Ctx, eqAll: number): number {
  const { s, hero } = ctx;
  if (s.street === "river" && ctx.heroInPosition) return eqAll * s.pot; // checks down
  if (ctx.preflop) return realization(ctx, false, eqAll) * eqAll * s.pot;
  const v = ctx.villains[0];
  if (ctx.villains.length === 1 && !ctx.heroInPosition && !v.allIn && v.stack > 0) {
    const lastPreRaiser = [...s.actions].reverse().find((a) => a.street === "preflop" && (a.type === "raise" || a.type === "bet"))?.key;
    const isCbet = s.street === "flop" && lastPreRaiser === v.key;
    const split = bettingSplit(ctx.ranges[0], s.board, ctx.profiles[0], isCbet);
    const bet = Math.min(Math.round(0.66 * s.pot), v.stack, hero.stack);
    const eqVsBet = split.betting.size() > 1e-6 ? equityVs(ctx, [split.betting], 211) : 0;
    const eqVsCheck = split.checking.size() > 1e-6 ? equityVs(ctx, [split.checking], 223) : eqAll;
    const facingBet = Math.max(0, realization(ctx, bet >= hero.stack, eqVsBet) * eqVsBet * (s.pot + 2 * bet) - bet);
    const checkedThrough = (s.street === "river" ? 1 : realization(ctx, false, eqVsCheck)) * eqVsCheck * s.pot;
    return split.betProb * facingBet + (1 - split.betProb) * checkedThrough;
  }
  // In position (free card) or multiway: discounted share of the pot.
  const R = realization(ctx, false, eqAll) * (ctx.heroInPosition ? 1 : 0.93);
  return R * eqAll * s.pot;
}

interface AggResult {
  ev: number;
  foldProb: number;
  eqCalled: number;
}

/**
 * Opponents' equity against the range they put you on after this bet. They
 * read a bet as small, medium or large rather than to the chip, so one
 * calculation per size band is enough (cached per decision).
 */
const heroEqCache = new WeakMap<Ctx, Map<string, Float64Array>>();
function heroRangeEquity(ctx: Ctx, to: number): Float64Array {
  const { s, hero } = ctx;
  const allIn = to >= hero.committedStreet + hero.stack;
  const ratio = (to - s.currentBet) / Math.max(1, s.pot + ctx.toCall);
  const band = allIn ? "allin" : ratio < 0.45 ? "small" : ratio < 0.9 ? "medium" : "large";
  let cache = heroEqCache.get(ctx);
  if (!cache) heroEqCache.set(ctx, (cache = new Map()));
  let eq = cache.get(band);
  if (!eq) {
    const rep = band === "allin" ? to : Math.round(s.currentBet + (band === "small" ? 0.33 : band === "medium" ? 0.66 : 1.25) * (s.pot + ctx.toCall));
    eq = equityVsRange(s.board, perceivedHeroRange(ctx, Math.min(rep, hero.committedStreet + hero.stack)));
    cache.set(band, eq);
  }
  return eq;
}

/** The range opponents put you on after you bet/raise to `to` (they can't see your cards). */
function perceivedHeroRange(ctx: Ctx, to: number): Range {
  const { s, hero } = ctx;
  const facing = s.currentBet;
  const raisesBefore = s.actions.filter((a) => a.street === s.street && (a.type === "bet" || a.type === "raise")).length;
  const action: HandAction = {
    key: hero.key,
    seat: hero.seat,
    street: s.street as HandAction["street"],
    type: facing > 0 ? "raise" : "bet",
    added: to - hero.committedStreet,
    toTotal: to,
    facing,
    potBefore: s.pot,
    allIn: to >= hero.committedStreet + hero.stack,
    raisesBefore,
    auto: false,
  };
  const r = estimateRange({
    key: hero.key,
    profile: ctx.heroProfile,
    position: hero.position,
    headsUp: ctx.headsUp,
    players: ctx.dealt,
    actions: [...s.actions, action],
    board: s.board,
    dead: [],
  });
  return r.size() >= 1 ? r : Range.full().removeCards(s.board);
}

function aggressiveEV(ctx: Ctx, to: number): AggResult {
  const { s, hero, villains } = ctx;
  const added = to - hero.committedStreet;
  // Size of the bet a villain faces relative to the pot before it (what they see as "x% pot").
  const ratioAt = (target: number, v: PlayerState) => {
    const capTo = Math.min(target, v.committedStreet + v.stack);
    const callAmt = Math.max(0, capTo - v.committedStreet);
    const potBeforeBet = s.pot + (capTo - hero.committedStreet) - callAmt;
    return callAmt / Math.max(1, potBeforeBet);
  };
  const ratioFor = (v: PlayerState) => ratioAt(to, v);

  // Postflop, opponents decide by asking "is my hand good enough against what
  // this bet says they have, at this price?" Preflop, their stats are measured
  // against standard sizes, so a size is judged relative to the standard one.
  const vsHero = ctx.preflop ? preflopEquityVsTop(perceivedHeroRange(ctx, to).fraction()) : heroRangeEquity(ctx, to);
  const stdTo = ctx.preflop ? Math.min(hero.committedStreet + hero.stack, Math.max(s.currentBet + ctx.bb, sizeTargets(ctx)[0])) : to;
  const resp = villains.map((v, i) => {
    if (v.allIn || v.stack === 0) return { fold: 0, continuing: ctx.ranges[i], raising: new Range(), canAct: false };
    const capTo = Math.min(to, v.committedStreet + v.stack);
    const callAmt = Math.max(0, capTo - v.committedStreet);
    const need = callAmt / Math.max(1, s.pot + (capTo - hero.committedStreet) + callAmt);
    const refRatio = ctx.preflop ? ratioAt(stdTo, v) : undefined;
    const committed = v.committedHand / Math.max(1, v.committedHand + v.stack);
    const r = respondToBet(ctx.ranges[i], s.board, ctx.profiles[i], ratioFor(v), baseContinue(ctx, i), { refRatio, vsBettor: vsHero, need, committed });
    return { ...r, canAct: true };
  });

  // Enumerate which villains continue (independence assumption).
  let ev = 0;
  let allFold = 0;
  let eqCalledSum = 0;
  let eqCalledW = 0;
  for (const { mask, prob } of continueScenarios(resp.map((r) => 1 - r.fold))) {
    if (mask === 0) {
      allFold = prob;
      ev += prob * s.pot;
      continue;
    }
    const callers = villains.map((v, i) => i).filter((i) => mask & (1 << i));
    // Hero can only lose what the biggest caller can match.
    const cap = Math.max(...callers.map((i) => villains[i].committedStreet + villains[i].stack));
    const heroTo = Math.min(to, cap);
    const heroAdded = heroTo - hero.committedStreet;
    const callerAdds = callers.reduce((sum, i) => sum + Math.max(0, Math.min(heroTo, villains[i].committedStreet + villains[i].stack) - villains[i].committedStreet), 0);
    const finalPot = s.pot + heroAdded + callerAdds;
    const heroAllIn = heroAdded >= hero.stack || hero.stack - heroAdded <= 0.1 * finalPot;
    const everyoneAllIn = heroAllIn || callers.every((i) => villains[i].committedStreet + villains[i].stack <= heroTo);
    // Each extra caller makes it harder to realise equity.
    const multiway = 1 - 0.04 * (callers.length - 1);
    const R = (eq: number) => realization(ctx, everyoneAllIn, eq) * multiway;

    let scenarioEV: number;
    if (callers.length === 1 && resp[callers[0]].canAct && !everyoneAllIn) {
      // Single caller who might raise back.
      const i = callers[0];
      const v = villains[i];
      const contW = resp[i].continuing.size();
      const raiseW = Math.min(contW, resp[i].raising.size());
      const pRaise = contW > 0 ? raiseW / contW : 0;
      const flatRange = new Range(Float64Array.from(resp[i].continuing.w, (w, k) => Math.max(0, w - resp[i].raising.w[k])));
      const eqFlat = flatRange.size() > 1e-6 ? equityVs(ctx, [flatRange], mask * 13 + to) : 0.5;
      const callEV = R(eqFlat) * eqFlat * finalPot - heroAdded;
      let raisedEV = -heroAdded;
      if (pRaise > 0.01) {
        const villainMax = v.committedStreet + v.stack;
        const reraiseTo = Math.min(villainMax, Math.max(heroTo * 3, heroTo + s.pot));
        const jam = reraiseTo >= villainMax * 0.6 ? villainMax : reraiseTo;
        const heroTotal = Math.min(jam, hero.committedStreet + hero.stack);
        const eqVsRaise = equityVs(ctx, [resp[i].raising], mask * 17 + to);
        const potIfCalled = s.pot + (heroTotal - hero.committedStreet) + (Math.min(heroTotal, villainMax) - v.committedStreet);
        const Rr = realization(ctx, heroTotal >= hero.committedStreet + hero.stack || jam >= villainMax, eqVsRaise);
        raisedEV = Math.max(-heroAdded, Rr * eqVsRaise * potIfCalled - (heroTotal - hero.committedStreet));
      }
      scenarioEV = (1 - pRaise) * callEV + pRaise * raisedEV;
      eqCalledSum += prob * eqFlat;
    } else {
      const eq = equityVs(ctx, callers.map((i) => resp[i].continuing), mask * 19 + to);
      scenarioEV = R(eq) * eq * finalPot - heroAdded;
      eqCalledSum += prob * eq;
    }
    eqCalledW += prob;
    ev += prob * scenarioEV;
  }
  return { ev, foldProb: allFold, eqCalled: eqCalledW > 0 ? eqCalledSum / eqCalledW : 0 };
}

/**
 * Which villains continue, as bitmasks with probabilities (independent players).
 * Exact for up to 4 villains; at bigger tables, every case with at most two
 * callers is exact and the rest is lumped into one "three or more call" case.
 */
export function continueScenarios(cont: number[]): Array<{ mask: number; prob: number }> {
  const n = cont.length;
  const probOf = (mask: number) => {
    let p = 1;
    for (let i = 0; i < n; i++) p *= mask & (1 << i) ? cont[i] : 1 - cont[i];
    return p;
  };
  const out: Array<{ mask: number; prob: number }> = [];
  if (n <= 4) {
    for (let mask = 0; mask < 1 << n; mask++) {
      const prob = probOf(mask);
      if (prob >= 1e-4) out.push({ mask, prob });
    }
    return out;
  }
  let covered = 0;
  const push = (mask: number) => {
    const prob = probOf(mask);
    covered += prob;
    if (prob >= 1e-4) out.push({ mask, prob });
  };
  push(0);
  for (let i = 0; i < n; i++) push(1 << i);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) push((1 << i) | (1 << j));
  const rest = 1 - covered;
  if (rest >= 1e-4) {
    const order = cont.map((c, i) => [c, i] as const).sort((a, b) => b[0] - a[0]);
    let mask = 0;
    order.forEach(([c, i], k) => {
      if (k < 3 || c >= 0.3) mask |= 1 << i;
    });
    out.push({ mask, prob: rest });
  }
  return out;
}

function likelyClasses(range: Range, strengths: Float64Array): string[] {
  const agg = new Map<string, { w: number; n: number; st: number }>();
  for (let i = 0; i < NUM_COMBOS; i++) {
    const w = range.w[i];
    if (w <= 0) continue;
    const [a, b] = COMBO_CARDS[i];
    const c = classOf(a, b);
    const e = agg.get(c) ?? { w: 0, n: 0, st: 0 };
    e.w += w;
    e.n++;
    e.st += strengths[i] * w;
    agg.set(c, e);
  }
  const rows = [...agg.entries()].map(([c, e]) => ({ c, avg: e.w / e.n, st: e.st / e.w }));
  const maxAvg = Math.max(0, ...rows.map((r) => r.avg));
  if (rows.length > 120 && rows.every((r) => r.avg > 0.9 * maxAvg)) return ["any two cards"];
  return rows
    .filter((r) => r.avg >= 0.5 * maxAvg)
    .sort((x, y) => y.st - x.st)
    .slice(0, 8)
    .map((r) => r.c);
}

/**
 * Board-aware reasons that go first: a warning when your hand is really the
 * board, and when someone bets or raises, what that most likely means given
 * the card that just came.
 */
function boardReasons(ctx: Ctx, villains: VillainView[], notes: string[]): string[] {
  const out: string[] = [];
  const board = playingTheBoard(ctx.heroCards, ctx.s.board);
  if (board) out.push(board);
  if (ctx.preflop) return out;
  const aggressor = [...ctx.s.actions].reverse().find((a) => a.street === ctx.s.street && (a.type === "bet" || a.type === "raise"));
  if (aggressor && ctx.toCall > 0) {
    const v = villains.find((x) => x.key === aggressor.key);
    if (v?.composition.length) {
      const top = v.composition.filter(([, share]) => share >= 0.08).slice(0, 4);
      const what = top.map(([k, share]) => `${k} ${pct(share)}`).join(", ");
      const last = ctx.s.board[ctx.s.board.length - 1];
      const lastText = cardsToString([last]).replace(/^T/, "10").replace(/[cdhs]$/, (x) => ({ c: "♣", d: "♦", h: "♥", s: "♠" })[x]!);
      const card = ctx.s.board.length > 3 ? `After the ${lastText}, ` : "";
      out.push(`${card}${v.name}'s ${aggressor.type} most likely means: ${what}`);
    }
  }
  if (notes[0] && !out.some((r) => r.includes(notes[0]))) out.push(notes[0]);
  return out;
}

function explain(ctx: Ctx, best: AdviceOption, options: AdviceOption[], eqAll: number, potOdds: number): string[] {
  const reasons: string[] = [];
  const names = ctx.profiles.map((p, i) => p.name || ctx.villains[i].name).join(" & ");
  reasons.push(`Win chance ${pct(eqAll)} vs ${names}'s likely hands`);
  if (ctx.toCall > 0 && !(ctx.preflop && ctx.raises === 0)) reasons.push(`Calling ${ctx.toCall} into ${ctx.s.pot} needs ${pct(potOdds)}`);
  if (ctx.preflop) {
    const cls = classOf(ctx.heroCards[0], ctx.heroCards[1]);
    const rank = preflopScores().get(cls) ?? 0;
    reasons.push(`${cls} is a top ${pct(1 - rank + 0.005)} starting hand`);
  }
  if (best.action === "bet" || best.action === "raise") {
    if (best.foldProb !== undefined) reasons.push(`They fold about ${pct(best.foldProb)} of the time to this size`);
    const eqc = best.equityWhenCalled;
    if (eqc !== undefined) {
      if (ctx.preflop) reasons.push(`When called you have ${pct(eqc)} equity${ctx.heroInPosition ? " and position" : ""}`);
      else if (eqc >= 0.5) reasons.push(`Value: ${pct(eqc)} vs the hands that call`);
      else if (eqc >= 0.25) reasons.push(`Semi-bluff: ${pct(eqc)} when called, plus fold equity`);
      else reasons.push(`Bluff: profit comes from folds (${pct(eqc)} when called)`);
    }
  }
  for (let i = 0; i < ctx.villains.length; i++) {
    const p = ctx.profiles[i];
    if (p.hands < 10) continue;
    const street = ctx.s.street;
    const f = ctx.preflop ? null : p.foldToBet(street as "flop");
    if (f !== null && (f > 0.6 || f < 0.3)) reasons.push(`${p.name} folds to ${street} bets ${pct(f)} (${p.style})`);
    else if (p.style !== "balanced" && !p.style.startsWith("unknown")) reasons.push(`${p.name}: ${p.style}`);
  }
  const second = options.find((o) => o !== best);
  if (second) reasons.push(`Expected ${best.ev >= 0 ? "+" : ""}${fmt(best.ev)} chips, next best is ${second.label} at ${second.ev >= 0 ? "+" : ""}${fmt(second.ev)}`);
  return reasons;
}
