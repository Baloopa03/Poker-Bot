# pokerpatio socket protocol (reverse-engineered)

Source: `tests/fixtures/pokerpatio/heads-up-5-hands.json`, a recorder capture
from a private heads-up lobby on 2026-10-11 (game version `0.9.2.24`, blinds
5/10). This is our best reading of a protocol nobody has documented. Confirm it
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

## Not seen yet (needs a 3-player capture)

- Three-handed positions (BTN / SB / BB). Heads-up, the dealer is also the SB.
- Re-buys and top-ups (where the stack increases between hands).
- Multi-way side pots, split pots, timeouts (`wasServerAutoAction: true`),
  sitting out, voluntarily showing cards.
- A blind change in the middle of a session.
