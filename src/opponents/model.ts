import type { Card } from "../engine/cards";
import { comboIndex } from "../engine/range";
import { comboStrengths } from "../engine/strength";
import type { HandHistory, Position, Street } from "../tracker/types";

// Per-player tendencies learned from hand histories, keyed by account so they
// survive re-buys. Every stat is shrunk towards a prior until there is enough
// data, so a handful of hands can't produce wild reads.

export type StatName =
  | "vpip"
  | "pfr"
  | "limp"
  | "steal"
  | "foldToSteal"
  | "threeBet"
  | "foldTo3Bet"
  | "callOpen"
  | "cbet"
  | "foldToCbet"
  | "foldToBetFlop"
  | "foldToBetTurn"
  | "foldToBetRiver"
  | "raiseVsBet"
  | "betWhenCheckedTo"
  | "wtsd"
  | "wonAtShowdown"
  | "bluffShare";

/** Table-size groups for preflop stats (how loose "normal" is depends on it). */
export type TableBucket = "hu" | "3" | "6";
export const bucketOf = (players: number): TableBucket => (players <= 2 ? "hu" : players <= 4 ? "3" : "6");

const PREFLOP_STATS = new Set<StatName>(["vpip", "pfr", "limp", "steal", "foldToSteal", "threeBet", "foldTo3Bet", "callOpen"]);

/**
 * Starting assumptions before we have data on someone: roughly what sound,
 * near-equilibrium play looks like. Preflop values depend on table size;
 * postflop defence follows minimum-defence frequency against a ~2/3-pot bet
 * (continue ~60%), and bluff share is the share of bets that are bluffs in a
 * balanced 2/3-pot betting range (~30%). [mean, strength in pseudo-hands].
 */
const PREFLOP_PRIORS: Record<TableBucket, Partial<Record<StatName, number>>> = {
  hu: { vpip: 0.75, pfr: 0.5, limp: 0.1, steal: 0.8, foldToSteal: 0.33, threeBet: 0.15, foldTo3Bet: 0.4, callOpen: 0.5 },
  "3": { vpip: 0.47, pfr: 0.36, limp: 0.08, steal: 0.55, foldToSteal: 0.45, threeBet: 0.13, foldTo3Bet: 0.45, callOpen: 0.3 },
  "6": { vpip: 0.25, pfr: 0.2, limp: 0.05, steal: 0.4, foldToSteal: 0.6, threeBet: 0.08, foldTo3Bet: 0.5, callOpen: 0.2 },
};

export const PRIORS: Record<StatName, [number, number]> = {
  vpip: [0.47, 12],
  pfr: [0.36, 12],
  limp: [0.08, 8],
  steal: [0.55, 8],
  foldToSteal: [0.45, 8],
  threeBet: [0.13, 10],
  foldTo3Bet: [0.45, 6],
  callOpen: [0.3, 8],
  cbet: [0.55, 8],
  foldToCbet: [0.4, 8],
  foldToBetFlop: [0.4, 8],
  foldToBetTurn: [0.4, 8],
  foldToBetRiver: [0.4, 8],
  raiseVsBet: [0.1, 10],
  betWhenCheckedTo: [0.4, 8],
  wtsd: [0.3, 8],
  wonAtShowdown: [0.5, 8],
  bluffShare: [0.3, 6],
};

export function prior(stat: StatName, bucket: TableBucket): [number, number] {
  const [mean, k] = PRIORS[stat];
  return [PREFLOP_PRIORS[bucket][stat] ?? mean, k];
}

const countKey = (stat: StatName, bucket: TableBucket) => (PREFLOP_STATS.has(stat) ? `${stat}@${bucket}` : stat);

export interface PlayerStats {
  key: string;
  name: string;
  hands: number;
  /** [hits, opportunities] per stat; preflop stats are stored per table size as "vpip@3". */
  counts: Record<string, [hits: number, opportunities: number]>;
  /** Other names this mate has played under. Any new account using one of these joins this profile. */
  aliasNames?: string[];
  /** Person name chosen by you (e.g. "Isaiah"); shown instead of the in-game name. */
  label?: string;
}

export interface Profile {
  key: string;
  name: string;
  hands: number;
  stat(name: StatName): number;
  /** Raw [hits, opportunities] for display. */
  raw(name: StatName): [number, number];
  foldToBet(street: Street): number;
  style: string;
}

const POSTFLOP: Street[] = ["flop", "turn", "river"];
const norm = (n: string) => n.trim().toLowerCase();

export class OpponentModel {
  readonly players = new Map<string, PlayerStats>();
  /** Merged accounts: alias key → the profile it now feeds. */
  readonly aliases = new Map<string, string>();

  static fromJSON(data: unknown): OpponentModel {
    const m = new OpponentModel();
    // v1 stored a bare array of players; v2 stores { players, aliases }.
    const d = data as { players?: PlayerStats[]; aliases?: Record<string, string> } | PlayerStats[] | null;
    const players = Array.isArray(d) ? d : (d?.players ?? []);
    for (const p of players) {
      if (!p?.key) continue;
      // Older saves kept preflop stats without a table size: those were 3-handed games.
      for (const k of Object.keys(p.counts ?? {}))
        if (PREFLOP_STATS.has(k as StatName)) {
          p.counts[`${k}@3`] = p.counts[k];
          delete p.counts[k];
        }
      m.players.set(p.key, p);
    }
    if (!Array.isArray(d)) for (const [a, b] of Object.entries(d?.aliases ?? {})) m.aliases.set(a, b);
    return m;
  }
  toJSON(): { players: PlayerStats[]; aliases: Record<string, string> } {
    return { players: [...this.players.values()], aliases: Object.fromEntries(this.aliases) };
  }

  /**
   * The profile key a player's hands are recorded under. Follows merges, and
   * (because guests get a fresh account whenever they like) links an unknown
   * account to an existing profile that has played under the same name.
   */
  resolve(key: string, name?: string): string {
    let k = key;
    for (let i = 0; i < 10 && this.aliases.has(k); i++) k = this.aliases.get(k)!;
    if (this.players.has(k) || !name) return k;
    const owner = this.findByName(name);
    if (owner && owner !== k) {
      this.aliases.set(k, owner);
      return owner;
    }
    return k;
  }

  /** Profile that uses this name (person name, current name or a known alias), case-insensitive. */
  findByName(name: string): string | undefined {
    const n = norm(name);
    if (!n) return undefined;
    for (const p of this.players.values())
      if (norm(p.label ?? "") === n || norm(p.name) === n || p.aliasNames?.some((a) => norm(a) === n)) return p.key;
    return undefined;
  }

  /** Display name: your label for the person if set, else their latest in-game name. */
  displayName(key: string): string {
    const p = this.players.get(this.resolve(key));
    return p?.label || p?.name || key;
  }

  /** Name a person (e.g. "Isaiah"). Also merges any other profile already using that name. */
  setLabel(key: string, label: string): void {
    const k = this.resolve(key);
    const p = this.players.get(k);
    if (!p) return;
    const clean = label.trim();
    p.label = clean || undefined;
    if (clean) this.addName(k, clean);
  }

  /** Tie another in-game name to this person: past profiles with it merge in, future accounts with it join automatically. */
  addName(key: string, name: string): void {
    const k = this.resolve(key);
    const p = this.players.get(k);
    const clean = name.trim();
    if (!p || !clean) return;
    for (const other of [...this.players.values()])
      if (other.key !== k && (norm(other.name) === norm(clean) || norm(other.label ?? "") === norm(clean) || other.aliasNames?.some((a) => norm(a) === norm(clean))))
        this.merge(other.key, k);
    if (norm(p.name) !== norm(clean) && !p.aliasNames?.some((a) => norm(a) === norm(clean))) p.aliasNames = [...(p.aliasNames ?? []), clean];
  }

  /** Stop treating a name as this person (e.g. two mates both used "Test" once). Past stats stay. */
  removeName(key: string, name: string): void {
    const p = this.players.get(this.resolve(key));
    if (!p) return;
    p.aliasNames = p.aliasNames?.filter((a) => norm(a) !== norm(name));
    // The latest in-game name also links accounts; fall back to the person name.
    if (norm(p.name) === norm(name)) p.name = p.label || p.aliasNames?.[0] || p.name;
  }

  /**
   * Merge `fromKey`'s history into `intoKey` (same mate, different account or
   * device). Future hands from either account go to `intoKey`.
   */
  merge(fromKey: string, intoKey: string): void {
    const from = this.resolve(fromKey);
    const into = this.resolve(intoKey);
    if (from === into) return;
    const a = this.players.get(from);
    const b = this.stats(into, this.players.get(into)?.name ?? into);
    if (a) {
      b.hands += a.hands;
      for (const [stat, [hits, opps]] of Object.entries(a.counts)) {
        const c = (b.counts[stat] ??= [0, 0]);
        c[0] += hits;
        c[1] += opps;
      }
      b.aliasNames = [...new Set([...(b.aliasNames ?? []), a.name, ...(a.aliasNames ?? [])])].filter((n) => n !== b.name);
      this.players.delete(from);
    }
    this.aliases.set(from, into);
  }

  private stats(key: string, name: string): PlayerStats {
    let s = this.players.get(key);
    if (!s) {
      s = { key, name, hands: 0, counts: {} };
      this.players.set(key, s);
    }
    if (s.name !== name) {
      // Remember the previous display name so the mate stays recognisable.
      s.aliasNames = [...new Set([...(s.aliasNames ?? []), s.name])].filter((n) => n !== name);
      s.name = name;
    }
    return s;
  }

  private bucket: TableBucket = "3";
  private bump(s: PlayerStats, stat: StatName, hit: boolean): void {
    const c = (s.counts[countKey(stat, this.bucket)] ??= [0, 0]);
    c[1]++;
    if (hit) c[0]++;
  }

  /** Smoothed tendencies; `tablePlayers` = how many were dealt in (preflop stats depend on it). */
  profile(key: string, name = key, tablePlayers = 3): Profile {
    key = this.resolve(key, name);
    const bucket = bucketOf(tablePlayers);
    const s = this.players.get(key) ?? { key, name, hands: 0, counts: {} };
    const stat = (n: StatName): number => {
      const [mean, k] = prior(n, bucket);
      const [hits, opps] = s.counts[countKey(n, bucket)] ?? [0, 0];
      return (hits + mean * k) / (opps + k);
    };
    const foldToBet = (street: Street) =>
      street === "turn" ? stat("foldToBetTurn") : street === "river" ? stat("foldToBetRiver") : stat("foldToBetFlop");
    const vpip = stat("vpip");
    const pfr = stat("pfr");
    const fold = (stat("foldToBetFlop") + stat("foldToBetTurn") + stat("foldToBetRiver")) / 3;
    let style = "unknown (few hands)";
    if (s.hands >= 15) {
      // Compare with what's normal for this table size.
      const [nv] = prior("vpip", bucket);
      const loose = vpip - nv;
      const aggr = pfr / Math.max(0.01, vpip);
      if (loose > 0.1 && aggr > 0.65) style = "maniac";
      else if (loose > 0.12 && fold < 0.3) style = "calling station";
      else if (loose < -0.12) style = aggr > 0.6 ? "tight-aggressive" : "nit";
      else if (loose > 0.08) style = aggr > 0.55 ? "loose-aggressive" : "loose-passive";
      else style = aggr < 0.45 ? "passive" : "solid";
    }
    return {
      key,
      name: s.label || s.name || name,
      hands: s.hands,
      stat,
      raw: (n) => (s.counts[countKey(n, bucket)] ?? [0, 0]) as [number, number],
      foldToBet,
      style,
    };
  }

  private resolveHistory(h: HandHistory): HandHistory {
    const names = new Map(h.players.map((p) => [p.key, p.name]));
    const r = (k: string) => this.resolve(k, names.get(k));
    const remap = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [r(k), v]));
    return {
      ...h,
      heroKey: h.heroKey && r(h.heroKey),
      players: h.players.map((p) => ({ ...p, key: r(p.key) })),
      actions: h.actions.map((a) => ({ ...a, key: r(a.key) })),
      result: h.result && {
        ...h.result,
        won: remap(h.result.won),
        refunded: remap(h.result.refunded),
        shown: remap(h.result.shown),
        descriptions: remap(h.result.descriptions),
      },
    };
  }

  /** Learn from one finished hand. */
  update(hand: HandHistory): void {
    const h = this.resolveHistory(hand);
    this.bucket = bucketOf(h.players.length);
    const pos = new Map<string, Position | undefined>(h.players.map((p) => [p.key, p.position]));
    const stats = new Map(h.players.map((p) => [p.key, this.stats(p.key, p.name)]));
    for (const s of stats.values()) s.hands++;

    // ---- preflop ----
    const pre = h.actions.filter((a) => a.street === "preflop" && a.type !== "post");
    let raises = 0;
    let opener: string | undefined;
    let lastRaiser: string | undefined;
    const acted = new Set<string>();
    const vpip = new Set<string>();
    const pfr = new Set<string>();
    for (const a of pre) {
      const s = stats.get(a.key);
      if (!s) continue;
      const first = !acted.has(a.key);
      acted.add(a.key);
      const aggressive = a.type === "raise" || a.type === "bet";
      if (a.type === "call" || aggressive) vpip.add(a.key);
      if (aggressive) pfr.add(a.key);

      if (raises === 0 && first) {
        const limpOpp = pos.get(a.key) !== "BB";
        if (limpOpp) this.bump(s, "limp", a.type === "call");
        const p = pos.get(a.key);
        if ((p === "BTN" || p === "SB") && pre.slice(0, pre.indexOf(a)).every((x) => x.type === "fold"))
          this.bump(s, "steal", aggressive);
      } else if (raises === 1 && a.key !== opener) {
        this.bump(s, "threeBet", aggressive);
        if (!aggressive) this.bump(s, "callOpen", a.type === "call");
        const op = opener ? pos.get(opener) : undefined;
        const me = pos.get(a.key);
        if ((op === "BTN" || op === "SB") && (me === "SB" || me === "BB") && first) this.bump(s, "foldToSteal", a.type === "fold");
      } else if (raises === 2 && a.key === opener) {
        this.bump(s, "foldTo3Bet", a.type === "fold");
      }
      if (aggressive) {
        raises++;
        if (raises === 1) opener = a.key;
        lastRaiser = a.key;
      }
    }
    for (const [key, s] of stats) {
      if (!acted.has(key)) continue; // e.g. a walk in the big blind: no decision made
      this.bump(s, "vpip", vpip.has(key));
      this.bump(s, "pfr", pfr.has(key));
    }

    // ---- postflop ----
    const foldedPre = new Set(pre.filter((a) => a.type === "fold").map((a) => a.key));
    const sawFlop = h.board.length >= 3 ? [...stats.keys()].filter((k) => !foldedPre.has(k) && h.actions.some((a) => a.key === k)) : [];
    for (const street of POSTFLOP) {
      const acts = h.actions.filter((a) => a.street === street);
      let betSeen = false;
      let cbetMade = false;
      for (const a of acts) {
        const s = stats.get(a.key);
        if (!s) continue;
        const aggressive = a.type === "bet" || a.type === "raise";
        if (!betSeen) {
          if (street === "flop" && a.key === lastRaiser) this.bump(s, "cbet", aggressive);
          else this.bump(s, "betWhenCheckedTo", aggressive);
          if (aggressive && street === "flop" && a.key === lastRaiser) cbetMade = true;
        } else {
          const fs: StatName = street === "flop" ? "foldToBetFlop" : street === "turn" ? "foldToBetTurn" : "foldToBetRiver";
          this.bump(s, fs, a.type === "fold");
          this.bump(s, "raiseVsBet", a.type === "raise");
          if (cbetMade && street === "flop" && a.key !== lastRaiser) this.bump(s, "foldToCbet", a.type === "fold");
        }
        if (aggressive) betSeen = true;
      }
    }

    // ---- showdown ----
    const shown = h.result?.shown ?? {};
    const atShowdown = new Set(Object.keys(shown));
    if (h.heroKey && h.heroCards?.length === 2 && Object.keys(shown).length) atShowdown.add(h.heroKey);
    for (const k of sawFlop) {
      const s = stats.get(k)!;
      const went = atShowdown.has(k);
      this.bump(s, "wtsd", went);
      if (went) this.bump(s, "wonAtShowdown", (h.result?.won[k] ?? 0) > 0);
    }

    // Bluff evidence: how strong were shown hands when they bet or raised?
    for (const [key, cards] of Object.entries(shown)) this.bluffEvidence(h, key, cards);
  }

  /** Learn from cards a player showed after the hand (folded or uncontested). */
  learnShown(hand: HandHistory, key: string): void {
    const h = this.resolveHistory(hand);
    const k = this.resolve(key, hand.players.find((p) => p.key === key)?.name);
    const cards = h.result?.shown[k];
    if (cards) this.bluffEvidence(h, k, cards);
  }

  private bluffEvidence(h: HandHistory, key: string, cards: readonly Card[]): void {
    this.bucket = bucketOf(h.players.length);
    const s = this.players.get(key);
    if (!s || cards.length !== 2) return;
    for (const street of POSTFLOP) {
      const bets = h.actions.filter((a) => a.key === key && a.street === street && (a.type === "bet" || a.type === "raise"));
      if (!bets.length) continue;
      const board = h.board.slice(0, street === "flop" ? 3 : street === "turn" ? 4 : 5);
      if (board.length < 3) continue;
      const strength = handStrength(cards as [Card, Card], board);
      for (let i = 0; i < bets.length; i++) this.bump(s, "bluffShare", strength < 0.45);
    }
  }
}

const strengthCache = new Map<string, Float64Array>();
/** Strength percentile (0..1) of a specific hand on a board, vs a random hand. */
export function handStrength(cards: readonly [Card, Card], board: readonly Card[]): number {
  const k = board.join(",");
  let st = strengthCache.get(k);
  if (!st) {
    st = comboStrengths(board);
    if (strengthCache.size > 64) strengthCache.clear();
    strengthCache.set(k, st);
  }
  return st[comboIndex(cards[0], cards[1])];
}
