# Poker Bot

An **advisor** for private No-Limit Hold'em games on pokerpatio.com. It reads
the table straight from the game's own data feed, learns how each of your mates
plays, and shows the best play, with its reasoning, in a panel on the table.
**It never clicks or acts for you.**

## Install (no coding needed)

1. Download this repo: green **Code** button → **Download ZIP**, then unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the **`extension`** folder inside the
   unzipped repo (the one containing `manifest.json`).
4. Open (or refresh) your pokerpatio lobby. A **♠ Poker Bot** panel appears on
   the right.

Updating: download again, replace the folder, then click the ↻ reload icon on
the extension in `chrome://extensions` and refresh the game tab.

## Using it

- **Advice tab:** on your turn it shows the recommended action and size, your
  win chance against each opponent's likely hands, the pot odds, why it chose
  this play, the expected value (EV) of every option, and what it thinks each
  opponent holds.
- **Ledger tab:** buy-ins, re-buys, cash-outs, current stack and net result for
  everyone in the lobby. It works whether or not you're the lobby admin.
- **Use reads on mates** (Advice tab): switch off to ignore everything learned
  about your mates and get advice that treats everyone as a typical player.
- **Stats tab:** each mate's tendencies (how often they play hands, raise,
  fold to bets, bluff…). An asterisk means there's still too little data.
- **People tab:** type a mate's real name ("Isaiah") and click **Add**. Every
  in-game name you've played against is listed under *Names not assigned yet*.
  Drag a name onto a person, or use its **Add to…** menu, and all its history
  joins that person. From then on, any guest using one of those names counts as
  that person on future nights. **×** removes a name, ✎ renames, 🗑 forgets.
  You are never listed.
- **Shown hands:** when a mate chooses to show after a hand (after folding, or
  after winning without a showdown), the bot uses it to check how often they bluff.
- **Alt+B** hides or shows the panel. Drag it by its title bar.

What it learns about your mates is saved in your browser and carries over
between nights, so it gets sharper the more you play. The ledger is saved per
lobby for the night, so a page refresh doesn't lose it.

## How it works

`page.js` copies the game's socket.io messages (read-only). `content.js` turns
them into the table state (`src/tracker`), updates each opponent's profile
(`src/opponents`), estimates their ranges, and scores every legal option by
expected chips won (`src/engine/advisor.ts`). See [docs/DESIGN.md](docs/DESIGN.md)
and [docs/PROTOCOL.md](docs/PROTOCOL.md).

The bot only uses what you could see yourself: your cards, the board, everyone's
actions and cards shown at showdown.

## Development

```sh
npm install
npm test            # unit tests: evaluator, equity, tracker vs real captures, advisor
npm run typecheck
npm run build       # rebuilds ./extension
node scripts/e2e.mjs                          # loads the extension in Chromium and replays a capture
npx tsx scripts/advise-replay.ts <capture>    # prints the advice for every decision in a capture
```

### Simulator

`sim/` is a separate test bench, not part of the extension. It deals real
hands (blinds, side pots, re-buys) and the bot plays through the same advisor
against scripted styles: `station`, `nit`, `maniac`, `solid`.

```sh
npx tsx sim/run.ts --hands 5000 --lineup station,nit            # bot vs a calling station and a nit
npx tsx sim/run.ts --hands 5000 --lineup station,nit --reads off # same, ignoring reads
npx tsx sim/run.ts --hands 5000 --lineup station,nit --hero solid # a scripted regular in the bot's seat, for comparison
```

`tools/recorder/` is a standalone capture extension. The main extension can
also save a capture from the Ledger tab ("Save capture"), which is handy for
reporting a misread hand.
