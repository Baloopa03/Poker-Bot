# Poker Bot

An **advisor** for private No-Limit Hold'em games on pokerpatio.com. It reads
the table straight from the game's own data feed, learns how each of your mates
plays, and shows the best play, with its reasoning, in a panel on the table.
**It never clicks or acts for you.**

## Install (no coding needed)

1. On GitHub, open the repo, switch to the `claude/poker-bot-design-xpi1x8`
   branch (or `main` once it's merged), click **Code → Download ZIP** and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Remove any older copies: *Poker Bot (advisor)* or *Poker Bot Recorder*.
4. Click **Load unpacked** and choose the **`extension`** folder inside the
   unzipped repo (the one containing `manifest.json`).
5. Optional: click the puzzle-piece icon in Chrome's toolbar and pin ♠ Poker Bot.
6. Open (or refresh) your pokerpatio lobby. The **♠ Poker Bot** panel appears on
   the right. Drag it wherever suits you; it remembers the spot.

Updating: download again, replace the folder, click ↻ on the extension in
`chrome://extensions`, then refresh the game tab. What it has learned about your
mates is kept.

## Using it

- **Advice tab:** on your turn it shows the move, plus exactly what to type in
  pokerpatio's raise box (which counts the amount *on top of* the current bet),
  your win chance, the odds you need to call, and the main reasons. **Details**
  expands every option's expected chips and what each opponent probably holds.
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
- **⚙ Settings:** turn *Use reads on mates* off to get advice that treats
  everyone as a typical player. **Back up** or **Restore** everything the bot
  has learned (it lives in your browser, so back up before reinstalling Chrome).
- **Alt+B** hides or shows the panel. Drag it by its title bar; it remembers
  where you put it.

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
npx tsx scripts/diag-preflop.ts [stack]        # % of hands it raises/calls/folds in standard preflop spots
npx tsx scripts/diag-postflop.ts "Kh 2c 4s 5s Jd" [bet] [stack]   # what it does with every hand type in a spot
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
