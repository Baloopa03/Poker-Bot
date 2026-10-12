# Poker Bot — Design

An **advisor** for our private 3-player No-Limit Hold'em games on pokerpatio.com.
It reads the table from the browser, works out the best play, and shows it in an
overlay. **It never clicks anything; you make every decision.**

## Status (2026-10-11)

| Milestone | State |
|---|---|
| M0 Recon | ✅ socket.io protocol documented (PROTOCOL.md), two captures saved as fixtures |
| M1 Engine core | ✅ evaluator (checked against all 2,598,960 five-card hands), Monte Carlo + exact river equity, ranges |
| M2 Adapter + Tracker | ✅ table state, hand histories and ledger. Every pot matches the server in both captures, and it works without admin events |
| M3 Overlay + advice | ✅ MV3 extension in `extension/`, with Advice / Players / Ledger tabs, tested end to end in Chromium against a replayed capture |
| M4 Opponent model | ✅ per-account stats with priors, Bayesian range narrowing, exploit-driven fold equity |
| M5 Simulator + tuning | ⏳ next: self-play simulator vs scripted opponent styles, then tuning from real sessions |

**Implementation notes, where the code differs from the plan above:**
- Preflop is decided by the same EV engine as postflop (fold equity from
  fold-to-steal / fold-to-3-bet, equity vs estimated ranges, realisation
  factors by position), not by fixed charts. Hand rankings come from a
  precomputed equity table (`src/engine/preflop-equity.json`).
- Opponents continue against bets by a mix of frequency (their stats) and
  absolute hand strength (people don't fold top pair to a small bet), and the
  advisor applies a mild risk penalty so near-ties go to the smaller, more
  robust size.
- All work runs in the content script (about 10–150 ms per decision). No
  worker or background page is needed.

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
- **Fourth capture (recorder, 2026-10-11): success.** The full game feed is
  plain JSON over socket.io at `wss://gs2.pokerpatio.com/mp/socket.io/`.
  It includes the hero's cards, the board, every action with exact chip
  amounts, blinds, stacks, positions and results. Opponent cards are only
  revealed at showdown. The full event reference is in
  [`PROTOCOL.md`](PROTOCOL.md), and the capture is saved at
  `tests/fixtures/pokerpatio/heads-up-5-hands.json`. **Approach A (WebSocket
  tap) is confirmed.**
- Telemetry is a backup signal at best. Never rely on it for game state.

Either way the Adapter outputs neutral events (`HandStarted`, `HoleCards`,
`PlayerAction`, `BoardDealt`, `Showdown`, `HandEnded`) and the rest of the
bot never touches pokerpatio code.

## 5. The Engine (the brain) — as implemented

> This section describes what `src/engine/advisor.ts`, `src/opponents/*` and
> `src/engine/strength.ts` actually do. (The original plan had a simpler
> one-street formula; it was replaced.)

All EVs are **chips won relative to folding now**. `pot` always includes every
chip already committed, including the bet you face. `R` is equity realisation.

### 5.1 Hand evaluation and equity
- Exact 5–7 card evaluator (checked against all 2,598,960 five-card hands).
- Equity vs weighted ranges: Monte Carlo (≈2,500 samples) on flop/turn, exact
  enumeration heads-up on the river.
- `equityVsRange`: for every possible opponent hand, its equity against a
  whole range, with exact card removal (blockers). Used to decide who calls.

### 5.2 The option formulas
```
EV(fold)  = 0
EV(call)  = R · eq · (pot + call) − call
            (pot already holds their bet: you pay `call` once, win the pot plus your call)
            players still to act behind are enumerated: each folds or continues
EV(limp)  = P(nobody raises) · [R · eq_vs_checkers · (pot + call) − call] + P(raise) · (−call)
EV(check) heads-up out of position: model their reply —
            P(bet) · max(0, R · eq_vs_betting · (pot + 2b) − b) + P(check) · R · eq_vs_checkers · pot
          in position / river: R · eq · pot (river checked behind = showdown)
EV(bet/raise to x), enumerating which opponents continue (independent):
            all fold:            + pot
            one caller c:        (1 − P(raise)) · [R · eq_vs_flatters · final_pot − risk]
                                 + P(raise) · max(−risk, R · eq_vs_raisers · pot_if_called − total_risk)
            several callers:     R · eq_vs_continuers · final_pot − risk   (side-pot caps applied)
```
- `risk` is capped by the largest stack that can call (side-pot logic).
- Small penalties keep near-ties on the smaller size: 1.5% of chips risked,
  plus 4% of anything over pot, plus 3% per street left of anything over 2× pot
  (overbets forfeit the value of being paid later, which one street can't see).
- Optional **careful mode** ranks by `EV − variance / (2 · tolerance)`
  (mean–variance trade-off; tolerance 2,000 chips), so big coin flips need a
  real edge while small pots play normally.

### 5.3 Equity realisation `R`
Solver studies put in-position players at ~100–110% of raw equity and the big
blind at ~60–75%. The bot uses a base by seat (preflop: IP 1.02, BB 0.84, SB
0.70; postflop: IP 1.0, OOP 0.85), scaled by hand strength (strong hands
over-realise, weak ones under-realise; steeper preflop), ×0.96 per extra
caller, and exactly 1 when all-in or on the river.

### 5.4 Who calls a bet (fold equity)
Each opponent hand's probability of continuing is a 50/50 blend of:
1. **Pot odds vs what your bet represents:** its equity against the range a
   player would put *you* on after this bet (`perceivedHeroRange`, from your
   own profile), vs the price `need = call / (pot + your bet + call)`, shifted
   by how sticky this player is.
2. **Their actual habits:** their fold-to-bet record on this street (scaled
   gently for size), plus "decent hands rarely fold".

Preflop, fold-to-steal / fold-to-3-bet are measured at standard sizes, so a
size is judged relative to the standard size for that spot. In 3-handed pots
the small blind defends steals about half as often as the big blind.

### 5.5 Preflop
No fixed charts: the same EV machinery decides open/limp/call/3-bet/shove.
Checked against researched ranges (`scripts/diag-preflop.ts`): 3-handed button
opens ≈45%, big blind defends ≈58% vs a 2.5× open, small blind vs button
mostly 3-bet-or-fold; heads-up button ≈95% played, big blind defends ≈66%.
Bet amounts are rounded so the raise-box amount is a multiple of 5.

## 6. Opponent model (the exploit part)

**Stats tracked per person** (People tab links guest names to people): VPIP,
PFR, limp, steal, fold to steal, 3-bet, fold to 3-bet, call vs open, c-bet,
fold to c-bet, fold to bet (flop/turn/river), raise vs bet, bet when checked
to, lead (betting into the aggressor), WTSD, won at showdown, bluff share
(overall and by bet size, learned from shown hands, including hands shown
after folding). Preflop stats are kept per table size (heads-up, 3–4, 5+).

**Small samples:** each stat is blended with a theory-based default. The
default's weight (25–40 pseudo-observations) follows how slowly each stat
stabilises in practice, so a handful of hands can't swing the advice.

**Range estimation:** each action re-weights every hand by how likely this
player is to take it:
- Checking *to the bettor* barely narrows (almost everyone does it);
  checking when checked to removes some strong hands (but traps remain).
- Bets are value from the top plus bluffs from the bottom. Bet size is only a
  mild signal unless this player's showdowns show their sizes mean something.
- Calls keep everything good enough to continue; only sets/two pair are
  partly missing (they sometimes raise).

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
  net result per player. It's built from seat approvals (buy-ins) and admin
  stack edits (cash-outs), keyed on `userId` because re-buys change seat and
  in-game id.

**Open**
- (none: the 3-handed, re-buy and cash-out capture is in; see PROTOCOL.md)
- (none beyond the capture)
