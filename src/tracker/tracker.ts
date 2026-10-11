import { type Card, parseCard, parseSiteCard } from "../engine/cards";
import type { Packet } from "../adapter/pokerpatio/socketio";
import type {
  ActionType,
  HandAction,
  HandHistory,
  HandResult,
  LedgerEntry,
  PlayerState,
  Position,
  Street,
  TableState,
} from "./types";

// Turns pokerpatio socket packets into a TableState, a hand history per hand,
// and a session ledger. Only relies on events every seated player receives;
// admin-only events (stack edits, seat approvals, settings) are used when
// present but everything they carry is also recovered another way.

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const STREET_OF_STAGE: Record<string, Street> = {
  pre_flop: "preflop",
  flop: "flop",
  turn: "turn",
  river: "river",
  showdown: "showdown",
};

const seatNumber = (seat: string): number => Number(/^s(\d+)/.exec(seat)?.[1] ?? 99);
const validUid = (u: unknown): u is string => typeof u === "string" && u.length > 0 && u !== "[redacted]";

interface LedgerRow extends LedgerEntry {
  /** Stack we expect at the next hand start, if nothing is added or taken off. */
  expected?: number;
}

export interface TrackerEvents {
  update: (s: TableState) => void;
  heroTurn: (s: TableState) => void;
  handComplete: (h: HandHistory) => void;
}

export class Tracker {
  readonly state: TableState = {
    handNumber: 0,
    handActive: false,
    street: "idle",
    sb: 0,
    bb: 0,
    board: [],
    players: [],
    heroCards: [],
    currentBet: 0,
    lastRaiseSize: 0,
    pot: 0,
    actions: [],
    paused: false,
  };

  private readonly nameToUid = new Map<string, string>();
  private readonly uidToName = new Map<string, string>();
  private readonly cardSeat = new Map<number, string>();
  private readonly seenCardIds = new Set<number>();
  private readonly pendingAcks = new Map<number, string>();
  private readonly ledgerRows = new Map<string, LedgerRow>();
  private playState = new Map<string, string>();
  private boardIds = new Set<number>();
  private heroCardIds = new Set<number>();
  private descriptions: Record<string, string> = {};
  private serverPot: number | undefined;
  private readonly listeners: { [K in keyof TrackerEvents]: TrackerEvents[K][] } = {
    update: [],
    heroTurn: [],
    handComplete: [],
  };

  on<K extends keyof TrackerEvents>(event: K, fn: TrackerEvents[K]): void {
    this.listeners[event].push(fn);
  }

  private emit<K extends keyof TrackerEvents>(event: K, arg: Parameters<TrackerEvents[K]>[0]): void {
    for (const fn of this.listeners[event]) (fn as (a: typeof arg) => void)(arg);
  }

  // ---------- identity ----------

  private learn(name: unknown, uid: unknown): void {
    if (typeof name !== "string" || !validUid(uid)) return;
    if (this.nameToUid.get(name) === uid) return;
    this.nameToUid.set(name, uid);
    this.uidToName.set(uid, name);
    // Migrate anything keyed by name before we knew the account id.
    const oldKey = `name:${name}`;
    const row = this.ledgerRows.get(oldKey);
    if (row && !this.ledgerRows.has(uid)) {
      this.ledgerRows.delete(oldKey);
      this.ledgerRows.set(uid, { ...row, key: uid });
    }
    for (const p of this.state.players)
      if (p.key === oldKey) {
        p.key = uid;
        p.userId = uid;
      }
    for (const a of this.state.actions) if (a.key === oldKey) a.key = uid;
  }

  private keyFor(name: string, uid?: unknown): string {
    if (validUid(uid)) {
      this.learn(name, uid);
      return uid;
    }
    const known = this.nameToUid.get(name);
    return known ?? `name:${name}`;
  }

  private playerBySeat(seat: string | undefined): PlayerState | undefined {
    return seat ? this.state.players.find((p) => p.seat === seat) : undefined;
  }
  private playerById(id: number): PlayerState | undefined {
    return this.state.players.find((p) => p.id === id);
  }
  private playerByKey(key: string): PlayerState | undefined {
    return this.state.players.find((p) => p.key === key || p.userId === key);
  }

  // ---------- ledger ----------

  private ledgerRow(key: string, name: string): LedgerRow {
    let row = this.ledgerRows.get(key);
    if (!row) {
      row = { key, name, buyIns: 0, cashOuts: 0, stack: 0, net: 0 };
      this.ledgerRows.set(key, row);
    }
    row.name = name;
    return row;
  }

  private adjust(row: LedgerRow, diff: number): void {
    if (diff > 0) row.buyIns += diff;
    else if (diff < 0) row.cashOuts -= diff;
  }

  /** Compare a stack seen between hands with what we expected; the difference is a re-buy, top-up or cash-out. */
  private reconcile(p: PlayerState): void {
    const row = this.ledgerRow(p.key, p.name);
    const total = p.stack + p.committedHand;
    if (row.expected === undefined) {
      if (row.buyIns === 0 && row.cashOuts === 0) row.buyIns = total;
      else this.adjust(row, total - row.stack);
    } else if (total !== row.expected) this.adjust(row, total - row.expected);
    row.expected = total;
    row.stack = total;
  }

  /** Room id from our own `room:join`, used to keep a ledger per lobby. */
  roomId: string | undefined;

  /** Full ledger rows (including expected stacks) so a reload can carry on. */
  exportLedger(): Array<LedgerEntry & { expected?: number }> {
    return [...this.ledgerRows.values()].map((r) => ({ ...r }));
  }

  restoreLedger(rows: Array<LedgerEntry & { expected?: number }>): void {
    for (const r of rows) if (r?.key) this.ledgerRows.set(r.key, { ...r });
  }

  resetLedger(): void {
    this.ledgerRows.clear();
    for (const p of this.state.players) this.reconcile(p);
  }

  ledger(): LedgerEntry[] {
    for (const p of this.state.players) {
      const row = this.ledgerRows.get(p.key);
      if (row) row.stack = p.stack + p.committedHand;
    }
    return [...this.ledgerRows.values()].map(({ expected: _e, ...r }) => ({ ...r, net: r.cashOuts + r.stack - r.buyIns }));
  }

  // ---------- packet entry point ----------

  handle(p: Packet): void {
    if (p.dir === "out") {
      if (p.ack !== undefined && p.event) this.pendingAcks.set(p.ack, p.event);
      if (p.event === "player:game:perform_action") this.setHero((p.args?.[0] as Any)?.playerPos);
      if (p.event === "room:join") this.roomId = (p.args?.[0] as Any)?.roomId ?? this.roomId;
      return;
    }
    if (p.dir !== "in") return;
    if (p.sio === "ACK" && p.ack !== undefined) {
      const ev = this.pendingAcks.get(p.ack);
      this.pendingAcks.delete(p.ack);
      if (ev) this.onAck(ev, (p.data as unknown[]) ?? []);
      return;
    }
    if (!p.event) return;
    this.onEvent(p.event, (p.args?.[0] ?? {}) as Any);
  }

  private onAck(event: string, data: unknown[]): void {
    if (event === "player:room:get_game_state") {
      const gm = (data[0] as Any)?.gmState;
      if (!gm) return;
      this.applyBlinds(gm.gameSettings?.small_blind, gm.gameSettings?.big_blind);
      if (Array.isArray(gm.players)) this.syncPlayers(gm.players);
    } else if (event === "player:room:get_this_player_full_cards_data") {
      const info = data.find((d) => d && typeof d === "object") as Any;
      if (!info) return;
      this.setHero(info.playerPos);
      for (const cd of info.playerCardsData ?? []) {
        const c = this.siteCard(cd?.cardData ?? cd);
        if (c !== undefined && !this.state.heroCards.includes(c)) this.state.heroCards.push(c);
      }
      for (const cd of info.communityCardsData ?? []) {
        const c = this.siteCard(cd?.cardData ?? cd);
        if (c !== undefined && !this.state.board.includes(c)) this.state.board.push(c);
      }
    }
  }

  private siteCard(cd: Any): Card | undefined {
    if (!cd?.suite || cd.value === undefined) return undefined;
    try {
      return parseSiteCard(String(cd.suite), String(cd.value));
    } catch {
      return undefined;
    }
  }

  private setHero(seat: unknown): void {
    if (typeof seat !== "string" || !seat) return;
    this.state.heroSeat = seat;
    this.state.heroKey = this.playerBySeat(seat)?.key ?? this.state.heroKey;
  }

  private applyBlinds(sb: unknown, bb: unknown): void {
    if (typeof sb === "number" && sb > 0) this.state.sb = sb;
    if (typeof bb === "number" && bb > 0) this.state.bb = bb;
  }

  private onEvent(ev: string, a: Any): void {
    const s = this.state;
    switch (ev) {
      case "room:get":
        for (const u of Object.values<Any>(a?.data?.players ?? {})) this.learn(u.username, u.userId);
        break;

      case "admin:room:settings_updated": {
        const b = a?.settings?.blind_sizes?.[0];
        if (b && !s.handActive) this.applyBlinds(b.sb, b.bb);
        break;
      }
      case "admin:game:new_hand_started":
        this.applyBlinds(a?.gameSettings?.small_blind, a?.gameSettings?.big_blind);
        break;

      case "room:lobby_stats_updated":
        if (Array.isArray(a?.playerStates)) this.syncPlayers(a.playerStates);
        break;

      case "player:game:player_play_state_changed": {
        const p = this.playerByKey(a.userId);
        if (validUid(a.userId)) this.playState.set(a.userId, a.newPlayState);
        if (p && a.newPlayState === "folded") p.folded = true;
        break;
      }

      case "admin:room:seat_request_approved": {
        const name = this.uidToName.get(a.userId) ?? String(a.userId);
        const key = this.keyFor(name, a.userId);
        const existing = this.playerBySeat(a.seatPos);
        if (existing && existing.key !== key) s.players.splice(s.players.indexOf(existing), 1);
        const p = existing?.key === key ? existing : this.newPlayer(key, name, -1, a.seatPos, a.stack);
        if (!s.players.includes(p)) s.players.push(p);
        p.stack = a.stack;
        this.reconcile(p);
        break;
      }

      case "player:game:was_unseated": {
        const p = this.playerByKey(a.userId);
        if (p) {
          this.ledgerRow(p.key, p.name).expected = p.stack;
          s.players.splice(s.players.indexOf(p), 1);
        }
        break;
      }

      case "admin:room:player_edited":
        this.stackEdited(a.userId, a.stack);
        break;

      case "admin:game:game_paused":
        s.paused = true;
        break;
      case "admin:game:game_unpaused":
        s.paused = false;
        break;

      case "game:stage_began":
        this.stageBegan(a.stageType);
        break;

      case "game:dealer_updated":
        s.buttonSeat = a.dealerSeatPos;
        s.sbSeat = a.smallBlindSeatPos;
        s.bbSeat = a.bigBlindSeatPos;
        this.assignPositions();
        break;

      case "game:small_blind_paid":
      case "game:big_blind_paid": {
        const p = this.playerById(a.playerId);
        if (!p) break;
        this.commit(p, a.amount, "post", false);
        const isBig = ev === "game:big_blind_paid";
        if (p.stack > 0) this.applyBlinds(isBig ? undefined : a.amount, isBig ? a.amount : undefined);
        if (isBig) {
          s.currentBet = Math.max(s.currentBet, p.committedStreet);
          s.lastRaiseSize = Math.max(s.bb, a.amount);
        } else s.currentBet = Math.max(s.currentBet, p.committedStreet);
        break;
      }

      case "game:cards_dealt_to_player":
        for (const d of Array.isArray(a) ? a : []) {
          this.cardSeat.set(d.cardData?.uniqueID, d.playerPos);
          const p = this.playerBySeat(d.playerPos);
          if (p) p.inHand = true;
        }
        break;

      case "game:update_card_data":
        this.cardRevealed(a.cardData);
        break;

      case "game:cards_deal_to_stack":
        for (const d of Array.isArray(a) ? a : []) {
          if (d?.emitData?.stackID !== "community_stack") continue;
          const cd = d.emitData.cardData;
          if (this.boardIds.has(cd?.uniqueID)) continue;
          const c = this.siteCard(cd);
          if (c === undefined) continue;
          this.boardIds.add(cd.uniqueID);
          if (!s.board.includes(c)) s.board.push(c);
        }
        break;

      case "game:player_turn_started":
        s.toActSeat = a.playerPos;
        this.emit("update", s);
        if (s.heroSeat && a.playerPos === s.heroSeat) this.emit("heroTurn", s);
        return;

      case "game:player_turn_ended":
        s.toActSeat = undefined;
        break;

      case "player:game:action_taken":
        this.actionTaken(a);
        break;

      case "game:game_ended":
        this.handEnded(a);
        return;

      case "chat_message":
        this.chat(a);
        break;

      case "historical_messages":
        for (const m of Array.isArray(a) ? a : []) {
          this.learn(m?.username, m?.userId);
          this.learn(m?.log?.nick, m?.log?.pid);
        }
        break;
    }
    this.emit("update", s);
  }

  private chat(m: Any): void {
    this.learn(m?.username, m?.userId);
    const log = m?.log;
    if (m?.msgType !== "game_log" || !log) return;
    this.learn(log.nick, log.pid);
    switch (log.e) {
      case "pss":
        this.stackEdited(log.pid, log.amt);
        break;
      case "hei":
        this.serverPot = log.tp;
        break;
      case "w":
        if (typeof log.hnd === "string") this.descriptions[this.keyFor(log.nick ?? "", log.pid)] = log.hnd;
        break;
      case "sc":
        try {
          const nv = typeof log.new === "string" ? JSON.parse(log.new) : log.new;
          if (!this.state.handActive && nv?.[0]) this.applyBlinds(nv[0].sb, nv[0].bb);
        } catch {
          /* ignore */
        }
        break;
      case "df":
      case "dt":
      case "dr":
        // Board backup: only used if the card events were missed.
        if (this.state.handActive && Array.isArray(log.cds)) {
          const expected = log.e === "df" ? 3 : log.e === "dt" ? 4 : 5;
          if (this.state.board.length < expected)
            for (const t of log.cds) {
              const c = parseCard(String(t));
              if (!this.state.board.includes(c)) this.state.board.push(c);
            }
        }
        break;
    }
  }

  private stackEdited(uid: unknown, amount: unknown): void {
    if (!validUid(uid) || typeof amount !== "number") return;
    const p = this.playerByKey(uid);
    if (!p) return;
    const diff = amount - p.stack;
    if (diff === 0) return;
    const row = this.ledgerRow(p.key, p.name);
    this.adjust(row, diff);
    p.stack = amount;
    row.expected = p.stack + p.committedHand;
    if (p.stack > 0) p.allIn = false;
  }

  private newPlayer(key: string, name: string, id: number, seat: string, stack: number): PlayerState {
    return {
      key,
      userId: validUid(key) && !key.startsWith("name:") ? key : undefined,
      name,
      id,
      seat,
      stack,
      startStack: stack,
      committedStreet: 0,
      committedHand: 0,
      inHand: false,
      folded: false,
      allIn: false,
      cards: [],
    };
  }

  /** Authoritative list of seated players (from lobby stats or a game-state snapshot). */
  private syncPlayers(list: Any[]): void {
    const s = this.state;
    const seen = new Set<string>();
    for (const ps of list) {
      if (!ps?.posType || typeof ps.name !== "string") continue;
      const key = this.keyFor(ps.name, ps.authUserId);
      seen.add(ps.posType);
      let p = this.playerBySeat(ps.posType);
      if (p && p.key !== key) {
        s.players.splice(s.players.indexOf(p), 1);
        p = undefined;
      }
      if (!p) {
        p = this.newPlayer(key, ps.name, ps.id, ps.posType, ps.stack);
        s.players.push(p);
      }
      p.id = ps.id;
      p.name = ps.name;
      if (s.handActive && typeof ps.totalBetsMade === "number") {
        // Mid-hand snapshot. Our chip accounting matches the server's, so any
        // difference is a stack edit we did not see (e.g. a cash-out while
        // someone else is admin).
        const diff = ps.stack + ps.totalBetsMade - (p.stack + p.committedHand);
        if (diff !== 0) {
          const row = this.ledgerRow(p.key, p.name);
          this.adjust(row, diff);
          row.expected = (row.expected ?? 0) + diff;
        }
        p.committedHand = ps.totalBetsMade;
      }
      p.stack = ps.stack;
      if (ps.playState) this.playState.set(key, ps.playState);
      if (!s.handActive) {
        p.committedHand = 0;
        p.committedStreet = 0;
        p.startStack = p.stack;
        this.reconcile(p);
      }
    }
    for (const p of [...s.players]) if (!seen.has(p.seat)) s.players.splice(s.players.indexOf(p), 1);
    s.players.sort((x, y) => seatNumber(x.seat) - seatNumber(y.seat));
    if (s.heroSeat) s.heroKey = this.playerBySeat(s.heroSeat)?.key ?? s.heroKey;
    this.recomputePot();
  }

  // ---------- hand flow ----------

  private stageBegan(stageType: string): void {
    const s = this.state;
    if (stageType === "set_blinds") return this.startHand();
    const street = STREET_OF_STAGE[stageType];
    if (!street) return;
    if (street !== "preflop" && street !== "showdown") {
      for (const p of s.players) p.committedStreet = 0;
      s.currentBet = 0;
      s.lastRaiseSize = s.bb;
    }
    s.street = street;
    s.toActSeat = undefined;
  }

  private startHand(): void {
    const s = this.state;
    s.handNumber++;
    s.handActive = true;
    s.street = "preflop";
    s.board = [];
    s.heroCards = [];
    s.actions = [];
    s.currentBet = 0;
    s.lastRaiseSize = s.bb;
    s.toActSeat = undefined;
    s.lastResult = undefined;
    this.descriptions = {};
    this.serverPot = undefined;
    this.cardSeat.clear();
    this.seenCardIds.clear();
    this.boardIds.clear();
    this.heroCardIds.clear();
    for (const p of s.players) {
      p.startStack = p.stack;
      p.committedHand = 0;
      p.committedStreet = 0;
      p.folded = false;
      p.allIn = false;
      p.cards = [];
      const ps = this.playState.get(p.key);
      p.inHand = p.stack > 0 && (ps === undefined || ps === "playing");
    }
    this.recomputePot();
  }

  private assignPositions(): void {
    const s = this.state;
    const live = s.players.filter((p) => p.inHand || p.seat === s.sbSeat || p.seat === s.bbSeat || p.seat === s.buttonSeat);
    for (const p of s.players) p.position = undefined;
    if (!s.buttonSeat || live.length < 2) return;
    const sorted = live.slice().sort((a, b) => seatNumber(a.seat) - seatNumber(b.seat));
    const btn = sorted.findIndex((p) => p.seat === s.buttonSeat);
    if (btn < 0) return;
    // Order after the button: SB, BB, then UTG… with the button last.
    const order = [...sorted.slice(btn + 1), ...sorted.slice(0, btn + 1)];
    if (order.length === 2) {
      const btnP = order[1];
      btnP.position = "SB";
      order[0].position = "BB";
      return;
    }
    const labels: Position[] = ["SB", "BB"];
    const middle = order.length - 3;
    const mids: Position[] = middle <= 0 ? [] : middle === 1 ? ["UTG"] : middle === 2 ? ["UTG", "CO"] : ["UTG", ...Array(middle - 2).fill("MP"), "CO"];
    labels.push(...mids, "BTN");
    order.forEach((p, i) => (p.position = labels[i]));
  }

  private commit(p: PlayerState, amount: number, type: ActionType, auto: boolean): HandAction {
    const s = this.state;
    const facing = s.currentBet;
    const potBefore = s.pot;
    const raisesBefore = s.actions.filter((a) => a.street === s.street && (a.type === "bet" || a.type === "raise")).length;
    const added = Math.max(0, Math.min(amount, p.stack));
    p.stack -= added;
    p.committedStreet += added;
    p.committedHand += added;
    if (p.stack === 0 && added > 0) p.allIn = true;
    const action: HandAction = {
      key: p.key,
      seat: p.seat,
      street: s.street === "idle" ? "preflop" : s.street,
      type,
      added,
      toTotal: p.committedStreet,
      facing,
      potBefore,
      allIn: p.allIn && added > 0,
      raisesBefore,
      auto,
    };
    s.actions.push(action);
    this.recomputePot();
    return action;
  }

  private actionTaken(a: Any): void {
    const s = this.state;
    const p = this.playerBySeat(a.playerPos) ?? this.playerById(a.playerID);
    if (!p) return;
    const raw = String(a.actionType);
    const amount = Number(a.makeBetValue) || 0;
    const facing = s.currentBet;
    let type: ActionType;
    if (raw === "fold") type = "fold";
    else if (raw === "check") type = "check";
    else if (raw === "call") type = "call";
    else {
      const toTotal = p.committedStreet + amount;
      type = toTotal <= facing ? "call" : facing === 0 ? "bet" : "raise";
    }
    const action = this.commit(p, type === "fold" || type === "check" ? 0 : amount, type, Boolean(a.wasServerAutoAction));
    if (type === "fold") p.folded = true;
    if (type === "bet" || type === "raise") {
      const raiseSize = action.toTotal - facing;
      if (raiseSize >= s.lastRaiseSize) s.lastRaiseSize = raiseSize;
      s.currentBet = Math.max(s.currentBet, action.toTotal);
    }
  }

  private cardRevealed(cd: Any): void {
    const s = this.state;
    const uid = cd?.uniqueID;
    const seat = this.cardSeat.get(uid);
    const card = this.siteCard(cd);
    if (!seat || card === undefined) return;
    const p = this.playerBySeat(seat);
    // Before showdown the server only reveals our own cards.
    if (s.street !== "showdown") {
      if (!s.heroSeat) this.setHero(seat);
      if (seat === s.heroSeat && !this.heroCardIds.has(uid)) {
        this.heroCardIds.add(uid);
        s.heroCards.push(card);
      }
    }
    if (p && !this.seenCardIds.has(uid)) {
      this.seenCardIds.add(uid);
      p.cards.push(card);
    }
  }

  private handEnded(a: Any): void {
    const s = this.state;
    const res = a?.endPopupData?.gameResults;
    const result: HandResult = { won: {}, refunded: {}, pot: 0, shown: {}, descriptions: this.descriptions };
    for (const [uid, info] of Object.entries<Any>(res?.winnersInfo ?? {})) {
      const p = this.playerBySeat(info?.playerData?.posType) ?? this.playerByKey(uid);
      if (!p) continue;
      this.learn(p.name, uid);
      const won = Number(info.wonAmount) || 0;
      const refund = Number(info.refundUncalledBetsAmount) || 0;
      result.won[p.key] = (result.won[p.key] ?? 0) + won;
      result.refunded[p.key] = (result.refunded[p.key] ?? 0) + refund;
      p.stack += won + refund;
    }
    let committed = 0;
    for (const p of s.players) {
      committed += p.committedHand;
      if (p.inHand && p.cards.length === 2 && p.seat !== s.heroSeat) result.shown[p.key] = p.cards.slice();
    }
    const refunds = Object.values(result.refunded).reduce((x, y) => x + y, 0);
    result.pot = committed - refunds;
    if (this.serverPot !== undefined) result.serverPot = this.serverPot;
    s.lastResult = result;

    const history: HandHistory = {
      handNumber: s.handNumber,
      sb: s.sb,
      bb: s.bb,
      heroKey: s.heroSeat ? this.playerBySeat(s.heroSeat)?.key : undefined,
      heroCards: s.heroCards.slice(),
      board: s.board.slice(),
      players: s.players
        .filter((p) => p.committedHand > 0 || p.inHand)
        .map(({ key, name, seat, startStack, position }) => ({ key, name, seat, startStack, position })),
      actions: s.actions.slice(),
      result,
    };

    for (const p of s.players) {
      p.committedHand = 0;
      p.committedStreet = 0;
      const row = this.ledgerRow(p.key, p.name);
      row.expected = p.stack;
      row.stack = p.stack;
    }
    s.handActive = false;
    s.street = "idle";
    s.toActSeat = undefined;
    s.currentBet = 0;
    this.recomputePot();
    this.emit("handComplete", history);
    this.emit("update", s);
  }

  private recomputePot(): void {
    this.state.pot = this.state.players.reduce((x, p) => x + p.committedHand, 0);
  }
}

export function replay(packets: Iterable<Packet>, tracker = new Tracker()): Tracker {
  for (const p of packets) tracker.handle(p);
  return tracker;
}
