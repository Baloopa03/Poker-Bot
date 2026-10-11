// Cards are ints 0..51: rank * 4 + suit. Rank 0 = deuce .. 12 = ace.

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";

export type Card = number;

export const rankOf = (c: Card): number => c >> 2;
export const suitOf = (c: Card): number => c & 3;
export const makeCard = (rank: number, suit: number): Card => rank * 4 + suit;

const SUIT_WORDS: Record<string, number> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };

/** Parse "Ah", "Td", "10h" (pokerpatio style) into a card. */
export function parseCard(text: string): Card {
  const t = text.trim();
  const rankText = t.slice(0, -1).toUpperCase();
  const suitText = t.slice(-1).toLowerCase();
  const rank = rankText === "10" ? 8 : RANKS.indexOf(rankText);
  const suit = SUITS.indexOf(suitText);
  if (rankText.length !== 1 && rankText !== "10") throw new Error(`Bad card: ${text}`);
  if (rank < 0 || suit < 0) throw new Error(`Bad card: ${text}`);
  return makeCard(rank, suit);
}

/** Parse pokerpatio's `{suite: "spades", value: "10"}` card data. */
export function parseSiteCard(suite: string, value: string): Card {
  const suit = SUIT_WORDS[suite.toLowerCase()];
  if (suit === undefined) throw new Error(`Bad suite: ${suite}`);
  return parseCard(`${value}${SUITS[suit]}`);
}

export function parseCards(text: string): Card[] {
  const t = text.replace(/[\s,]/g, "");
  const out: Card[] = [];
  for (let i = 0; i < t.length; ) {
    const len = t.startsWith("10", i) ? 3 : 2;
    out.push(parseCard(t.slice(i, i + len)));
    i += len;
  }
  return out;
}

export const cardToString = (c: Card): string => RANKS[rankOf(c)] + SUITS[suitOf(c)];
export const cardsToString = (cs: readonly Card[]): string => cs.map(cardToString).join(" ");

export function fullDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}
