// Replay a recorder capture through the tracker and print each hand.
import { readFileSync } from "node:fs";
import { cardsToString } from "../src/engine/cards";
import { Tracker } from "../src/tracker/tracker";

const file = process.argv[2];
const capture = JSON.parse(readFileSync(file, "utf8"));
const t = new Tracker();
t.on("heroTurn", (s) => {
  const hero = s.players.find((p) => p.seat === s.heroSeat)!;
  const toCall = s.currentBet - hero.committedStreet;
  console.log(`   hero to act on ${s.street}: ${cardsToString(s.heroCards)} | board ${cardsToString(s.board) || "-"} | pot ${s.pot} | to call ${toCall} | stack ${hero.stack}`);
});
t.on("handComplete", (h) => {
  const names = Object.fromEntries(h.players.map((p) => [p.key, p.name]));
  const r = h.result!;
  console.log(`#${h.handNumber} ${h.sb}/${h.bb} ${h.players.map((p) => `${p.name}(${p.position},${p.startStack})`).join(" ")} hero ${cardsToString(h.heroCards ?? [])} board ${cardsToString(h.board)}`);
  console.log(`   ${h.actions.map((a) => `${names[a.key]}:${a.street[0]}:${a.type}${a.added ? " " + a.added : ""}${a.allIn ? "(AI)" : ""}`).join(", ")}`);
  console.log(`   pot ${r.pot} (server ${r.serverPot}) won ${JSON.stringify(Object.fromEntries(Object.entries(r.won).map(([k, v]) => [names[k], v])))} shown ${Object.entries(r.shown).map(([k, c]) => names[k] + " " + cardsToString(c)).join(", ")}`);
});
for (const e of capture.entries) t.handle(e);
console.log("Ledger:", t.ledger().map((l) => `${l.name}: in ${l.buyIns} out ${l.cashOuts} stack ${l.stack} net ${l.net}`).join(" | "));
