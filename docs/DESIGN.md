# Poker Bot — Design

An **advisor** for our private 3-player No-Limit Hold'em games on pokerpatio.com.
It reads the table from the browser, works out the best play, and shows it in an
overlay. **It never clicks anything; you make every decision.**

## 1. Goals and non-goals

**Goals**
- Read the game state automatically: hole cards, board, pot, stacks, positions and actions.
- Recommend fold, check, call or raise (with a size), and explain why.
- Learn each mate's tendencies over time and exploit them.
- Show win chance (equity), pot odds and a short reason in an overlay.
- Log every hand so we can review and improve the bot.

**Non-goals**
- Clicking buttons or acting automatically.
- Using anything you couldn't see as a player. If the site happens to send opponents'
  hole cards or the deck to the browser, we ignore them. The bot only uses what's on
  your screen plus what it remembers from past hands.
- Perfect GTO play. Against two known opponents, exploiting their habits beats
  theory.

## 2. Architecture

Everything runs inside a Chrome (Manifest V3) extension written in TypeScript.

```
 pokerpatio.com tab
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  ┌─────────────┐   raw events   ┌─────────────┐   GameState          │
│  │  Adapter    │ ─────────────▶ │  Tracker    │ ──────────┐          │
│  │ (the eyes)  │                │ (hand state │           │          │
│  │ DOM / WS    │                │  + history) │           ▼          │
│  └─────────────┘                └──────┬──────┘   ┌──────────────┐   │
│                                        │ actions  │   Engine     │   │
│                                        ▼          │  (the brain) │   │
│                                 ┌─────────────┐   │  web worker  │   │
│                                 │ Opponent    │──▶│              │   │
│                                 │ Model       │   └──────┬───────┘   │
│                                 │ (stats DB)  │          │ Advice    │
│                                 └─────────────┘          ▼           │
│                                                   ┌──────────────┐   │
│                                                   │ Overlay UI   │   │
│                                                   │ (the mouth)  │   │
│                                                   └──────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

| Module | Job | Depends on the site? |
|---|---|---|
| **Adapter** | Turns pokerpatio's page or network messages into neutral `TableEvent`s | **Yes**, and it's the only module that does |
| **Tracker** | Builds a `GameState` from events, detects new hands and writes the hand history | No |
| **Opponent Model** | Keeps per-player stats and estimates each player's likely hand range | No |
| **Engine** | Equity simulation, EV of each option, sizing, exploit adjustments | No |
| **Overlay** | Floating panel with the recommendation, equity, pot odds and opponent HUD | Barely (only positioning) |

Keeping all pokerpatio-specific code in the Adapter means that if the site changes,
or we play somewhere else, we only rewrite one module. The Engine can be tested
entirely offline.

## 3. Core data model

```ts
type Card = `${Rank}${Suit}`;            // "As", "Td", "7h"
type Street = "preflop" | "flop" | "turn" | "river";
type Position = "BTN" | "SB" | "BB";     // 3-handed

interface PlayerState {
  id: string;            // stable name/seat id of the mate
  seat: number;
  position: Position;
  stack: number;
  committed: number;     // chips put in on this street
  folded: boolean;
  allIn: boolean;
}

interface GameState {
  handId: string;
  street: Street;
  heroId: string;
  heroCards: [Card, Card] | null;
  board: Card[];
  pot: number;
  bigBlind: number;
  players: PlayerState[];
  toAct: string | null;
  actions: Action[];     // full action log for this hand
}

interface Action {
  playerId: string;
  street: Street;
  type: "post" | "fold" | "check" | "call" | "bet" | "raise" | "allin";
  amount: number;
}

interface Advice {
  action: "fold" | "check" | "call" | "bet" | "raise";
  amount?: number;
  equity: number;        // 0..1 vs estimated ranges
  potOdds: number;       // price to call
  evByOption: Record<string, number>;
  reasons: string[];     // e.g. "Dave folds to c-bets 70% — bet small"
}
```

## 4. The Adapter (reading pokerpatio)

**Step 0 is recon:** we need to see how pokerpatio sends game data to the browser.
Open a game, press F12, and check:
1. **Network → WS tab.** If there's a WebSocket with JSON messages (deal, bet,
   board), that's the best source because it's structured and exact.
2. **Elements tab.** Otherwise, find the HTML for the cards, pot and stacks
   (class names, `data-*` attributes, image filenames for cards).

Then pick one of two approaches:

- **A. WebSocket tap (preferred).** Inject a small page script that wraps
  `window.WebSocket` so we get a copy of every incoming message, then map
  those messages to `TableEvent`s. Exact numbers, and no polling.
- **B. DOM scraping (fallback).** Use a `MutationObserver` on the table element
  and parse cards, pot, stacks and the action log from the HTML.

**Recon so far (bot-lobby HAR, 2026-10-11):**
- The HAR contained only GameAnalytics telemetry (`api.gameanalytics.com`),
  with no game-state traffic. It recorded UI events such as
  `UIAction:call`, `UIAction:check`, `Start:Game:HandStarted` and
  `Complete:PlayerMadeBet` (score = chips bet), but no cards, board or pot.
- The game client is build `0.9.2.25`, loaded in an iframe
  (`PlayOrigin:Iframe:pokerpatio.com`).
- The capture used the Fetch/XHR filter, which hides WebSocket traffic.
  Bot games may also run entirely in the browser with no server traffic.
- A second capture (screenshot, "All" filter) showed only 9 GameAnalytics
  requests, all `(blocked)` by an ad or privacy blocker. Because there were
  no page, script or socket requests at all, recording started after the
  page loaded. **Chrome only lists connections opened while DevTools is open**,
  so the game's socket wasn't captured.
- Public sources (site pages, AlternativeTo, MalwareTips, search) don't
  describe the transport or name the developer. Only a capture will show it.
- **Still needed:** open DevTools *before* loading the lobby (or reload with
  it open), use the **Socket** filter (newer Chrome's name for "WS"), click
  the connection and open its **Messages** tab for a few hands. If nothing
  appears under Socket, check **All** for `eventsource`, long-polling
  (`socket.io/?EIO=`, Firebase `.lp?`) or WebRTC.
- **Third capture (screenshots, 2026-10-11): the transport is socket.io.**
  The game page is `pokerpatio.com/mp?game=<lobby id>`, loaded by
  `mp_bundle.js`, and it opens `socket.io/?EIO=4&transport=…` (Engine.IO v4 /
  Socket.IO v5). Game events should therefore look like
  `42["eventName", {...}]`. The DevTools Messages list was empty after one
  hand, though. Either the panel wasn't showing frames, or the traffic went
  over long-polling (XHR) or a worker.
- To capture reliably without DevTools, `tools/recorder/` is a tiny
  extension that wraps `WebSocket` and the socket.io XHR at `document_start`,
  decodes Engine.IO/Socket.IO packets, redacts credential-like keys and
  saves a JSON capture. The real Adapter (approach A) will reuse this tap.
- Telemetry is a backup signal at best. Never rely on it for game state.

Either way the Adapter outputs neutral events (`HandStarted`, `HoleCards`,
`PlayerAction`, `BoardDealt`, `Showdown`, `HandEnded`) and the rest of the
bot never touches pokerpatio code.

## 5. The Engine (the brain)

### 5.1 Hand evaluation and equity
- A fast 7-card hand evaluator (lookup-table based).
- **Monte Carlo equity:** deal random opponent hands *weighted by their
  estimated ranges*, run out the board about 5–20k times in a web worker, and
  return our win/tie probability. The target is under 100 ms per decision.

### 5.2 Preflop
- Starting ranges for each position, tuned for **3-handed** play (much wider
  than full-ring play), stored as editable 13×13 grids in JSON.
- Separate charts for open, call vs open, 3-bet and push/fold when short-stacked
  (under about 12 BB).
- Exploit adjustments widen or tighten these based on opponent stats (§6).
- **Our usual game:** 8/15 blinds, $500 starting stacks, so we start about
  **33 BB deep**. That's shallow: stack-to-pot ratios are low and all-in
  decisions come up often, so push/fold and commitment logic matter more
  than deep-stack play. Blinds and stacks can change, so the engine works
  in big blinds read from the live state, never in hard-coded dollar amounts.

### 5.3 Postflop
For each legal option (fold, check/call, bet or raise at a few sizes such as
33%, 66%, 100% and all-in):

```
EV(fold)  = 0
EV(call)  = equity × (pot + call) − call
EV(bet x) = P(fold) × pot
          + (1 − P(fold)) × [equity_when_called × (pot + 2x) − x]
```
- `P(fold)` comes from the opponent model (their fold-to-bet stat at this street and size).
- `equity_when_called` uses the opponent's range after narrowing it to the hands that continue.
- Recommend the option with the highest EV. Show the runner-up when it's close.

This is a deliberately simple one-street model. We can add multi-street
lookahead later if it isn't strong enough.

## 6. Opponent model (the exploit part)

We only play two opponents, so the bot gets very good data on them quickly.

**Stats tracked per player** (saved in IndexedDB, kept across sessions):
| Stat | Meaning |
|---|---|
| VPIP | % of hands they voluntarily put money in |
| PFR | % of hands they raise preflop |
| 3-bet % | how often they re-raise |
| Fold to 3-bet | |
| C-bet % / Fold to c-bet | betting the flop after raising preflop, and folding to it |
| Aggression factor | (bets + raises) / calls |
| WTSD / W$SD | how often they reach showdown, and how often they win there |
| Bet sizing tells | e.g. "big bet on the river = strong 85% of the time" |

**Range estimation:** start each opponent at "any two cards". On each action,
re-weight every possible hand by how likely that player is to take that action
with it. Their stats decide how much we narrow it: a loose player's raise
narrows less than a tight player's. Hands they show down are stored to check
and calibrate these guesses.

**Small samples:** blend each stat with a sensible default (prior) until we
have enough hands, so a few hands don't skew the advice. The HUD shows the
sample size.

## 7. Overlay UI

A draggable panel on the table:
```
┌──────────────────────────────┐
│  ▶ RAISE to 2,400 (66% pot)  │
│  Equity 58%  ·  Pot odds 25% │
│  EV: raise +410 · call +180  │
│  • Sam folds to c-bet 72%    │
│  • Board favours your range  │
├──────────────────────────────┤
│ Sam   VPIP 48 PFR 12 AF 0.8  │
│ Jules VPIP 31 PFR 24 AF 2.9  │
└──────────────────────────────┘
```
Keyboard toggle to hide it, and a "details" view showing the full EV table and
estimated ranges.

## 8. Testing

- **Unit tests:** hand evaluator (checked against known results), pot and
  side-pot maths, equity (checked against published values, e.g. AA vs KK ≈ 82%).
- **Adapter fixtures:** save real WebSocket/DOM captures from recon and
  replay them in tests, so site changes are caught immediately.
- **Simulator:** a local 3-player game where the bot plays against scripted
  opponent types (calling station, nit, maniac) to check that the exploits
  actually win chips.
- **Hand review:** export hand histories so we can see where the bot's
  advice was wrong.

## 9. Repo layout (planned)

```
src/
  adapter/pokerpatio/   # site-specific: ws tap, dom parser, event mapping
  tracker/              # GameState builder, hand history
  engine/
    cards.ts evaluator.ts equity.worker.ts preflop/ postflop.ts
  opponents/            # stats, priors, range weighting, storage
  overlay/              # UI panel
  extension/            # manifest.json, content script, background
sim/                    # offline 3-player simulator
tests/
docs/
```
Tooling: TypeScript, Vite (extension build), Vitest (tests).

## 10. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Recon** | We know whether pokerpatio uses WebSocket or DOM, with sample captures saved in `tests/fixtures/` |
| **M1** | **Engine core** | Card types, evaluator and Monte Carlo equity work, with tests passing. A small web page where you type cards in and get equity |
| **M2** | **Adapter + Tracker** | The extension logs a correct `GameState` to the console during a real game |
| **M3** | **Overlay + basic advice** | Preflop charts + pot-odds/equity advice shown live |
| **M4** | **Opponent model** | Stats persist across sessions, ranges narrow, exploit-based EV |
| **M5** | **Simulator + tuning** | The bot beats scripted opponents in the sim, and we tune it from real hand reviews |

## 11. Decisions and open questions

**Decided**
- Format: No-Limit Hold'em, 3 players, usually 8/15 blinds with $500 stacks
  (blinds and stacks occasionally change).
- Data source: WebSocket feed (the player confirmed it streams real-time events).
- All three players agreed to use helper tools.
- Browser: Chrome (the HAR came from Chrome on Windows).

- **It's a cash game.** Players re-buy when they bust and settle up at the end
  (net = cash-outs + final stack − buy-ins). Players often cash out down to
  $500 once they reach about $1,000, so effective stacks usually sit between
  33 and 67 BB. The bot maximises **chip EV**, the average number of chips
  each decision wins or loses. Survival doesn't matter and there's no
  tournament maths, but decisions use the **effective stack** (the smaller
  of the stacks involved).
- **Extra feature:** a session ledger that tracks buy-ins, cash-outs and
  net result per player.

**Open**
- WebSocket message format: needs a private-lobby WS capture (§4).
- (none beyond the capture)
