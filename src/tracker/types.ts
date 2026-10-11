import type { Card } from "../engine/cards";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
export type Position = "BTN" | "SB" | "BB" | "UTG" | "MP" | "CO";
export type ActionType = "post" | "fold" | "check" | "call" | "bet" | "raise";

export interface PlayerState {
  /** Stable identity across re-buys: account userId, or "name:<name>" if unknown. */
  key: string;
  userId?: string;
  name: string;
  /** In-game id for this seating (changes on re-buy). */
  id: number;
  seat: string;
  /** Chips behind (not yet committed). */
  stack: number;
  /** Stack when the current hand started. */
  startStack: number;
  committedStreet: number;
  committedHand: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Cards we legitimately know: hero's own, or shown at showdown. */
  cards: Card[];
  position?: Position;
}

export interface HandAction {
  key: string;
  seat: string;
  street: Street;
  type: ActionType;
  /** Chips added by this action. */
  added: number;
  /** Player's total commitment on this street after the action. */
  toTotal: number;
  /** Highest commitment on the street before this action. */
  facing: number;
  /** Pot (all commitments) before this action. */
  potBefore: number;
  allIn: boolean;
  /** Number of bets/raises on this street before this action (0 = unopened). */
  raisesBefore: number;
  auto: boolean;
}

export interface HandResult {
  /** Amount won (excluding refunds) and refunded per player key. */
  won: Record<string, number>;
  refunded: Record<string, number>;
  /** Pot after uncalled bets were returned. */
  pot: number;
  /** Pot reported by the server's hand log (`hei.tp`), when received. */
  serverPot?: number;
  shown: Record<string, Card[]>;
  descriptions: Record<string, string>;
}

export interface HandHistory {
  handNumber: number;
  sb: number;
  bb: number;
  heroKey?: string;
  heroCards?: Card[];
  board: Card[];
  players: Array<Pick<PlayerState, "key" | "name" | "seat" | "startStack" | "position">>;
  actions: HandAction[];
  result?: HandResult;
}

export interface LedgerEntry {
  key: string;
  name: string;
  buyIns: number;
  cashOuts: number;
  /** Latest known chips (behind + in the current pot). */
  stack: number;
  /** cashOuts + stack − buyIns. */
  net: number;
}

export interface TableState {
  handNumber: number;
  handActive: boolean;
  street: Street | "idle";
  sb: number;
  bb: number;
  board: Card[];
  players: PlayerState[];
  buttonSeat?: string;
  sbSeat?: string;
  bbSeat?: string;
  heroSeat?: string;
  heroKey?: string;
  heroCards: Card[];
  toActSeat?: string;
  /** Highest street commitment. */
  currentBet: number;
  /** Size of the last full raise on this street (for min-raise). */
  lastRaiseSize: number;
  /** All chips committed this hand. */
  pot: number;
  actions: HandAction[];
  lastResult?: HandResult;
  paused: boolean;
}
