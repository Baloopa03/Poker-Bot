# pokerpatio socket protocol (reverse-engineered)

Sources (recorder captures from a private lobby, 2026-10-11, game version `0.9.2.24`):
- `tests/fixtures/pokerpatio/heads-up-5-hands.json`: heads-up, blinds 5/10.
- `tests/fixtures/pokerpatio/3-handed-rebuy-cashout.json`: 3-handed, a blind
  change to 8/15, two busts and re-buys, and a cash-out.

The protocol isn't publicly documented. This is our best reading of it. This is our best reading of a protocol nobody has documented. Confirm it
against new captures.

## Connection

- `wss://gs2.pokerpatio.com/mp/socket.io/?EIO=4&transport=websocket`
  (Engine.IO v4 / Socket.IO v5, default namespace, WebSocket from the start
  with no polling).
- The page is `pokerpatio.com/mp?game=<roomId>`. The socket only shows up in
  DevTools if DevTools is open before the page loads.
- Handshake: `authentication` → `authenticated` → `room:join {roomId}` →
  `room:get` → `player:room:get_game_state` (ack carries a full `gmState`
  snapshot) → `player:room:get_this_player_full_cards_data` (ack carries
  **`playerPos` of the hero** plus their cards if a hand is in progress).

## Identifiers

| Thing | Format | Notes |
|---|---|---|
| Seat / position | `posType` / `playerPos`, e.g. `"s1"`, `"s2_v2"` | Stable per seat; this is the key to use everywhere |
| Player in-game id | `playerID` / `id`, small int (1, 2, …) | Used by actions, blinds and turns |
| Player account id | `userId`, a Firebase-style uid | Used by play-state, chat log and results |
| Card | `{uniqueID, cardID, suite, value, name}` | `suite` ∈ spades/hearts/diamonds/clubs; `value` ∈ 2–10, J, Q, K, A |
| Card (compact) | `"Kh"`, `"10h"`, `"2c"` | Chat game log. **Ten is written `10`, not `T`** |

`uniqueID` is a random per-deal id. The deck is sent face-down at the start of
each hand, and a card's face is only sent when the player is allowed to see it
(see below).

## Event flow of one hand

All of these are server → client `EVENT`s (`42["name", payload]`).

| Event | Payload (relevant fields) | Meaning |
|---|---|---|
| `admin:game:new_hand_started` | `settings`, `gameSettings.{small_blind,big_blind,defaultPlayerStack}` | New hand. **Read the blinds here every hand** |
| `room:lobby_stats_updated` | `playerStates[].{id,name,posType,stack,playState,totalBetsMade,stats}` | Stacks at hand start, then again near the end |
| `game:cards_deal_to_stack` (`dealer_stack`) | 52 face-down `uniqueID`s | Deck shuffled |
| `game:stage_began` / `game:stage_ended` | `stageType`: `set_blinds`, `deal_hands`, `pre_flop`, `flop`, `turn`, `river`, `showdown` | Street changes |
| `game:dealer_updated` | `dealerSeatPos`, `smallBlindSeatPos`, `bigBlindSeatPos`, `underTheGunSeatPos` (+ `…PlayerID`) | Positions for this hand |
| `game:small_blind_paid` / `game:big_blind_paid` | `{amount, playerId}` | Blinds posted |
| `game:cards_dealt_to_player` | `[{playerPos, cardData:{uniqueID}}]` × 2 per player | Who got which face-down card |
| `game:update_card_data` | `{cardData:{uniqueID,suite,value,…}, flipCard}` | A card's face is revealed. During `deal_hands` this only happens for **the hero's** two cards. Opponents' cards are only revealed at `showdown` |
| `game:player_turn_started` | `{playerID, playerPos, turnTimeDurationMS}` | Someone's turn. **If `playerPos` is the hero's seat → compute advice** |
| `player:game:action_taken` | `{playerID, playerPos, actionType, makeBetValue, wasServerAutoAction}` | An action happened (see below) |
| `game:player_turn_ended` | `{playerID, playerPos}` | |
| `player:game:player_play_state_changed` | `{userId, newPlayState}` | `playing`, `folded`, … |
| `game:cards_deal_to_stack` (`community_stack`) | face-up `cardData` | Board cards (flop ×3, turn, river) |
| `chat_message` (`msgType: "game_log"`) | `log.e` code, see below | Human-readable hand log (backup source) |
| `game:game_ended` | `endPopupData.gameResults.{winnersInfo, sidePotsWithWinners}` | Hand result, side pots, refunds |

### Actions

- `actionType` ∈ `fold`, `check`, `call`, `raise`. **An opening bet is also
  `raise`**, and an all-in call is just `call`. Detect all-ins from the stack
  reaching 0.
- **`makeBetValue` = chips this action added to the pot** (not the
  "raise to" total). Example: the SB has posted 5, then sends `raise`
  `raiseAmount:10` → `makeBetValue: 15` (calls 5 + raises 10, total 20).
- Outgoing (client → server) is `player:game:perform_action
  {actionType, raiseAmount?, playerID, playerPos}`, where `raiseAmount` is
  the amount *on top of* the call. **The advisor never sends this.**

### Game-log codes (`chat_message.log.e`)

| `e` | Meaning | Fields |
|---|---|---|
| `df` / `dt` / `dr` | Flop / turn / river dealt | `cds: ["8c","4c","Jd"]` |
| `rs` | Showdown | |
| `hei` | Hand ended | `tp` total pot, `tr` rake |
| `ur` | Uncalled bet refunded | `pid` (userId), `amt` |
| `w` | Winner | `pid`, `amt`, `hnd` ("2 pair of Js and 2s", "uncontested_pot") |

### Checked against the capture

Hand 2: blinds 5/10. Preflop 20 + 20, flop 40 + 40, river Jack bets 545 and Test
calls 335 all-in. That's 1000 put in, minus 210 refunded = **790**, matching
`hei.tp: 790`. Our understanding of `makeBetValue` adds up.

## Hidden information

The lobby settings include `show_all_cards: false` and `debug_win_confidence:
false`. In this capture the server **did not** send any opponent card faces
before showdown, and folded or mucked hands were never revealed. The Adapter
must still only use: the hero's cards, board cards, and cards flipped during
`showdown`. Debug flags or any other leak must be ignored.

## Positions (3-handed, confirmed)

`game:dealer_updated` names every role directly: `dealerSeatPos` (BTN),
`smallBlindSeatPos`, `bigBlindSeatPos`. Three-handed, `underTheGunSeatPos` is
the BTN, who acts first preflop. Heads-up, the dealer is also the SB. Never
work positions out from seat numbers. Use this event.

## Identity: seat vs in-game id vs account

**A re-buy gives a player a new seat *and* a new in-game `playerID`.** In the
capture, Test2 was `id 3 @ s6`, busted, re-joined, and became `id 2 @ s2_v2`.
The only stable key is the account `userId` (also sent as `authUserId`).
Opponent stats must be keyed on `userId`, and resolved from `id`/`posType` via
the latest `room:lobby_stats_updated.playerStates` or
`seat_request_approved`. Display names also work as a fallback.

## Blinds changing

1. Admin sends `admin:room:update_game_settings` → server emits
   `admin:room:settings_updated` (full `settings`) and a chat log `e: "sc"`.
2. Takes effect at the next `admin:game:new_hand_started`
   (`gameSettings.small_blind/big_blind` = 8/15).

## Busting and re-buying

1. A player loses all chips → `player_play_state_changed: "bankrupted"`.
2. Too few players left → `admin:game:game_stopped
   {stopReason: "not_enough_playable_players"}`.
3. `player:game:was_unseated {userId, reason: "was_bankrupt"}` + chat `e: "ls"`.
4. Re-buy = ask for a seat again: `player:room:new_seat_request {playerState}`
   → admin approves → `admin:room:seat_request_approved
   {userId, seatPos, stack: 500}` + chat `e: "sap"`.
5. Admin presses start → `admin:game:game_started` and a new hand.

**Ledger:** each `seat_request_approved` (and the first seating) is a
**buy-in** of `stack`.

## Cash-outs and top-ups (admin stack edit)

The "cash out down to 500" is done by the admin editing a stack, here while
the game was paused mid-hand:
- `admin:game:game_paused` / `admin:game:game_unpaused {turnTimeLeft…}`
- `admin:room:player_edited {userId, stack: 530}` + chat `e: "pss"
  {amt: 530, ostk: 1530}` (new and old stack).
- `stack` is the chips **behind**. In the capture the hero had posted the
  15 BB, so 1530 behind → 530 behind = **cash-out of 1000**.

**Ledger:** `ostk − amt` > 0 is a cash-out; < 0 is a top-up (extra buy-in).
Net result = cash-outs + current stack − buy-ins.

## Multi-way all-in and side pots (checked)

Hand 3 of the 3-handed capture: Test2 shoves 925, Jack calls 267 (all-in),
Test calls 285 (all-in). That's 1500 in total. The uncalled 625 is refunded,
giving `hei.tp` **875**. Main pot 825 (3 × 275) goes to Jack, and side pot
#1 of 50 (2 × 25) goes to Test (`isp: true`, `wmpf: " side pot #1 "`). Our
pot maths matches the server.

When everyone is all-in, the remaining streets are dealt straight away with no
`player_turn_started`, then all live hands are revealed at `showdown`.

## Extra game-log codes

| `e` | Meaning | Fields |
|---|---|---|
| `sc` | Setting changed | `set`, `old`, `new` |
| `pss` | Admin set a player's stack | `pid`, `amt` (new), `ostk` (old) |
| `ls` | Player left their seat | `pid`, `rsn` (`was_bankrupt`) |
| `sap` | Seat approved | `pid`, `st` (seat) |
| `pcl` | Player joined the lobby | `pid` |

## Not seen yet

- Timeouts (`wasServerAutoAction: true`), sitting out, voluntarily showing
  cards, split pots, a player leaving mid-hand.
- Note: in both captures the recorder (v0.1.0) redacted `authUserId`. From
  v0.1.1 it keeps it.
