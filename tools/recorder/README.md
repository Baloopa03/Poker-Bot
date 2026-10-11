# Poker Bot Recorder

A tiny Chrome extension that records pokerpatio's game messages and saves them
as a JSON file. We use the captures to work out the message format and as test
data for the bot.

## Install (once)

1. Download this repo (or just the `tools/recorder` folder) to your PC.
2. Go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `tools/recorder` folder.

## Record

1. Open pokerpatio and join your lobby. A red **● REC _n_ msgs · save** button
   appears in the bottom-left corner once the game connects.
2. Play a few hands. Ideally include a fold, a raise, a showdown and a
   re-buy.
3. Click the button to download `pokerpatio-capture-….json`.
4. Send the file to Claude (or commit it to `tests/fixtures/`).

## What it records

- Every socket.io packet, sent and received, over both WebSocket and HTTP
  long-polling, decoded into `{ event, args }`. Pings and pongs are skipped.
- It doesn't record keys that look like credentials (`token`, `auth`,
  `session`, `sid`, `email`, …). These are replaced with `[redacted]`, and
  query strings are stripped from socket URLs.
- Player names and chat **are** included, so only share captures with your mates.

It only listens. It never sends anything to the game or anywhere else.
