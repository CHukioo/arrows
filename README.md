# Arrows

A browser clone of the "Arrows – Puzzle Escape" mobile game, built with pure
HTML/CSS/JS and a small Express backend. No ads, no login.

## How to play

The board is filled with winding arrows. Tap an arrow and it shoots off the
board in the direction its head points — but only if no other arrow lies in
its escape path. Tapping a blocked arrow costs one heart (you have 3 per
level). Clear the whole board to finish the level.

- **Infinite levels** — level N is generated deterministically from its
  number, so every player gets the same board.
- **Difficulties** — Extra Easy, Easy, Medium, Hard, Super Hard, mixed along
  the way (gentle ramp at the start, gradually skewing harder).
- **Lives** — you start with 5. Failing a level costs one life; one life
  regenerates every 30 minutes (up to 5). Redeem codes give extra lives.
- **Score** — each cleared level awards points based on difficulty plus a
  bonus for hearts you kept.

## Run

```bash
npm install
npm start          # http://localhost:3000
```

Players are identified by a UUID generated in the browser and kept in
`localStorage` — no registration. All data is stored in `server/data/db.json`.

## Extra-life codes

Codes are 6 characters (letters + digits) and can be redeemed **once per
player**. On the very first start the server prints 5 starter codes to the
console.

Create more codes:

```bash
# while the server is stopped:
npm run codes -- 10 3        # 10 codes, +3 lives each

# or while it runs, via the admin API (default key: arrows-admin, override with ADMIN_KEY env):
curl -X POST http://localhost:3000/api/admin/codes \
  -H "Content-Type: application/json" \
  -d '{"key":"arrows-admin","count":10,"lives":3}'

# list codes + redemption counts:
curl "http://localhost:3000/api/admin/codes?key=arrows-admin"
```

## Groups

Any player can create a group (gets a 6-character join code) and friends join
with that code. Each group has its own leaderboard next to the global one.

## Project layout

```
public/            static frontend (served by Express)
  js/difficulty.js shared difficulty/scoring module (also used by the server)
  js/gen.js        deterministic level generator
  js/game.js       canvas game engine
  js/main.js       screens, state, API wiring
server/
  index.js         Express API + static hosting
  store.js         JSON file persistence
  tools/           make-codes.js, test-gen.js
  data/db.json     created at first run
```

`npm run test:gen` checks that generated levels are solvable and
deterministic (500 levels by default).
