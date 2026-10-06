# CS2Situation

A live radar for Counter-Strike 2 that runs in your browser.

A small C++ program reads the game's memory (read-only), packs what it finds into JSON, and pushes it over a WebSocket to a React app that draws the radar — every player, both teams, the bomb, and where each team is holding.

Nothing is injected into the game and nothing is written to it. Originally built for studying how CS2 exposes entity data through its schema system — the codebase is a learning project, not a cheat.

---

## About

CS2Situation started as a study project to understand the Source 2 / CS2 engine internals: schema offsets, entity handles, the game's service-layer architecture, and how game state is laid out in memory.

The C++ side only **reads** memory — `OpenProcess` is opened with `PROCESS_VM_READ | PROCESS_QUERY_INFORMATION`, and there are no write calls anywhere in the codebase. It is a learning tool for reverse engineering and data extraction, not a gameplay hack.

---

## Features

### Players

- One arrow per player, pointing where they are looking
- **HP ring** around every dot — green, yellow, or red depending on health
- **Low HP dots pulse** so a wounded player is easy to spot
- **Dead players** are greyed out with a skull and stay frozen at their last known position
- **Teammates can be dimmed** so enemies pop out of the map
- **Click any dot or roster card to follow** that player; `ESC` stops following
- **Labels** show name, HP, armor, and active weapon — on hover, always, or off

### Enemies

- Enemy dots are red; teammates use their own team color; you are yellow
- **⚠ AIMING AT YOU** banner when enemies have you in their crosshair (within a 15° cone at up to 2500 units) — their dot turns bright red too
- **Beep** when an enemy closes within 800 units
- **"Enemy spotted — \<area\>"** popup on an enemy's card the moment they enter a named area
- **Threat bar under the map** — one chip per area, redder as the count goes up, plus a "+N elsewhere" chip for anyone outside a named area. It reads `CLEAR` when no enemies are alive
- **Named areas on the map** (A Site, Long, Mid, …) fade out when no enemy is near

### The bomb

- **Orange badge** on the dot of whoever is carrying the C4
- **Dropped C4** — yellow pulsing beacon labelled `DROPPED`
- **Planted C4** — red flashing marker labelled `PLANTED`
- **Bomb timer** with the fuse and the defuse countdown, plus a 🔧 marker when you carry a defuser
- The marker turns **green once defused**

### Map and view

- **Auto-fit** zooms the map to the living players and crops the empty space
- **Rotate** the map in 90° steps (`R` or the on-map button) and **mirror** it horizontally
- **Radar opacity** slider
- **Fullscreen** the whole app (`F`) or just the map (`M`)
- Per-map radar images and coordinate bounds for **17 maps**

### Team panels

- T roster on the left, CT roster on the right
- Character portrait, name, money, health, and armor per player
- Weapon icons — primary, secondary, knife, grenades — with the active one highlighted
- Click a name to open that player's Steam profile
- Compact and full layouts, or hide the panels entirely

### Multi-device and sharing

- **Share** button lists the LAN addresses other devices on the same WiFi can open
- Each viewer picks their own player with the **"I am"** dropdown, so friendly/enemy logic is correct per viewer instead of per machine
- **Stale-data banner** appears if the C++ side stops sending, so frozen dots are never mistaken for real ones

### Settings

Every option is a toggle or slider, saved to `localStorage`. **Clean mode** is a one-click preset for a quieter map. **Reset** restores the defaults.

---

## Running it

**Requirements** — [Node.js](https://nodejs.org/en/download), [Visual Studio Community](https://visualstudio.microsoft.com/vs/community/), [vcpkg](https://vcpkg.io/en/).

**1. Front end and bridge**

```bash
cd webapp
npm install
npm run dev
```

`npm run dev` starts both the WebSocket bridge (port `22006`) and the Vite dev server. Open `http://localhost:5173`.

**2. C++ side** — open `usermode/cs2situation.sln`, build with `Ctrl+Shift+B`, and run the resulting binary. **It must run as administrator** — it needs permission to open the game process for reading.

The page will sit on "waiting for data" until the binary is running and a match is loaded.

**Configuration** — `usermode/config.json` holds `m_ip`, the address the bridge publishes to:

```json
{ "m_ip": "localhost" }
```

Leave it as `localhost` for local use. Change it to your LAN address to serve other machines; the bridge listens on port `22006` and the front end connects to the same host it was served from.

---

## How it works

```
  cs2.exe
     │
     │  ReadProcessMemory  (read-only)
     ▼
┌─────────────────────────┐
│  usermode  (C++)        │   10 Hz loop
│                         │   walks 1024 entity slots
│  entity → features      │   builds a nlohmann::json
└───────────┬─────────────┘   payload
            │  ws://localhost:22006/cs2situation
            ▼
┌─────────────────────────┐
│  webapp/ws  (Node)      │   fans out to every open browser
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  webapp/src  (React)    │   10 Hz render
└─────────────────────────┘
```

The C++ side walks the entity list, resolves a handful of fields, and serialises the result. Everything visual lives in the browser, so the UI can be changed without recompiling anything in C++.

### The payload

One JSON object per tick, roughly:

```jsonc
{
  "m_map": "de_dust2",
  "m_local_team": 2,
  "m_players": [
    {
      "m_idx": 41, "m_is_local": false, "m_name": "…",
      "m_team": 3, "m_color": 1,
      "m_health": 87, "m_is_dead": false,
      "m_armor": 100, "m_money": 4200,
      "m_has_helmet": true, "m_has_defuser": false, "m_has_bomb": false,
      "m_model_name": "ctm_st6_variantf", "m_steam_id": "76561198…",
      "m_position": { "x": 1240.5, "y": -380.2 },
      "m_eye_angle": 133.0,
      "m_weapons": {
        "m_primary": "ak47", "m_secondary": "glock",
        "m_active": "ak47",
        "m_melee": [], "m_utilities": ["flashbang"]
      }
    }
  ],
  "m_bomb": {
    "x": 0, "y": 0, "m_state": "planted",
    "m_blow_time": 31.4, "m_defuse_time": 9.8,
    "m_is_defused": false, "m_is_defusing": true
  }
}
```

`m_bomb.m_state` is `carried`, `dropped`, or `planted`. Everything the UI draws comes from this object — there is no second data source.

---

## Notes on the implementation

### Schema offsets

CS2 exposes named fields, but the offsets are not compile-time constants. `src/core/schema.hpp` hashes the field path and resolves it at startup:

```cpp
SCHEMA_ADD_FIELD(int32_t, m_iHealth, "C_BaseEntity->m_iHealth");
```

The path is FNV-1a hashed and looked up in a table parsed out of the client binary.

### Entity walking

`f::get_player_info()` loops over the 1024 entity slots, skips invalid handles, and dispatches on the class name: `CCSPlayerController` becomes a player, `C_C4` and `C_PlantedC4` become bomb state. Class names are cached by pointer, because allocating a `std::string` per entity per tick was measurable overhead.

### Bomb detection

The obvious approach — read the C4's owner handle and match it against each player's pawn — is wrong in a way that is hard to see. Two bugs cancelled out into intermittent failure:

1. `m_hOwnerEntity` was declared as a **pointer**, so it read 8 bytes from a field that is really a **4-byte entity handle**. The handle packs its entry index into the low 15 bits with a serial bit above that, so the mask meant to recover the entry index kept the serial bit too, and stopped matching the pawn handle about half the time.
2. The "is it dropped?" test was `owner == nullptr`. A dropped weapon's owner handle is `0xffffffff`, so the test never fired and a bomb on the ground reported itself as carried.

When the carrier was only sometimes identified, the front end had no badge to draw and fell back to a standalone marker at the C4's own position. That marker looked dropped, but the C4's scene node trails whoever holds it — so it drifted around the map.

The fix drops the owner handle entirely and reads the answer out of data already being fetched. `f::players::get_weapons()` was already walking each player's inventory, so:

```cpp
case e_weapon_type::c4:
    m_player_data["m_has_bomb"] = true;
    break;
```

If the C4 is in someone's inventory, they are the carrier. State is then resolved once after the scan:

| Condition | `m_state` |
|---|---|
| A player's inventory contains the C4 | `carried` |
| A `C_PlantedC4` is ticking | `planted` |
| A `C_C4` exists but nobody holds it | `dropped` |

All three flags reset at the top of every tick, so a carrier can never survive a round change.

### Crash safety

Service pointers are only valid during certain game states — menus, warmup, round transitions. Dereferencing them unguarded is what used to take the process down, so each one is checked:

```cpp
const auto money_services = player->m_pInGameMoneyServices();
m_player_data["m_money"] = money_services ? money_services->m_iAccount() : 0;
```

Two subtler issues came with it:

- **`get_scene_origin()` / `get_vec_origin()` return by value.** They are built from a schema read that produces a temporary, so returning a `const T&` to it dangles as soon as the caller's expression ends.
- **JSON reads are type-checked.** `nlohmann::json::get<T>()` throws on a missing or wrongly-typed key, and its internal asserts are compiled out in Release builds — so a payload mismatch would become undefined behaviour instead of a clean failure. Every payload read goes through checked helpers.

### Performance

Two hot paths were causing game stutter:

- **`find_pattern()` is throttled.** It copies the whole client module and scans it byte by byte. Retrying a failed map-name lookup every tick at 10 Hz was the single biggest cause of lag; it now retries at most once every 5 seconds and the result is `.has_value()`-checked.
- **Class names are cached** by pointer in a `std::unordered_map` behind a mutex, capped at 4096 entries.

On the front end, per-map callout counts are memoised into a single pass over (callouts × players) per tick. Computing them inline per element was O(n·m) per render and dominated CPU at 10 Hz.

### Positioning

`getRadarPosition(mapData, position)` converts world coordinates into a 0–1 percentage over the map image using the bounds in `webapp/public/data/<map>/data.json`. Every dot, line, and the bomb marker share this one function, so they cannot drift apart.

### The transform trap

Player dots are sized from `img.offsetWidth` / `img.offsetHeight`, **not** `getBoundingClientRect()`. `getBoundingClientRect()` returns post-transform dimensions, and since `#radar` carries a rotate and auto-fit `transform`, using it applied that transform a second time and scattered the dots. `offsetWidth` is layout size and is unaffected.

### Visibility is one function

Whether a dot renders is decided by a single `dotVisible(player)` predicate that both the dot list and the bomb marker consult. That is what guarantees the C4 badge on a carrier and the standalone bomb marker can never appear at the same time.

### Map-only fullscreen

`M` (or the corner button) fullscreens `#radar-viewport` alone, not the page. One rule makes that work:

```css
#radar-viewport:fullscreen > #radar { min-width: 0 !important; }
```

Without it the square container stretched to the full viewport width, `object-fit: contain` letterboxed the image, and dots positioned from the image width drifted off the visible map.

### The threat bar

Lives **outside** the map box as a sibling, directly beneath it. It is not inside `#radar-viewport` — that container is `overflow-hidden`, so anything positioned inside it is clipped.

Chips stay on one line and scroll horizontally rather than wrapping, since a second row would push the square map and shrink it. A `ResizeObserver` measures real overflow and only applies the edge-fade mask when the strip genuinely overflows.

### Settings

Persisted to `localStorage`. Saved values are merged **over** the defaults rather than replacing them, so a new option added later gets its default instead of `undefined`:

```js
{ ...DEFAULT_SETTINGS, ...JSON.parse(saved) }
```

---

## Project layout

```
cs2situation/
├── usermode/
│   └── src/
│       ├── core/       schema offset resolution
│       ├── sdk/        entity and handle wrappers
│       ├── features/   features.cpp, players.cpp, bomb.cpp  ← the scan
│       └── utils/      memory, pattern scanning, hashing, config
└── webapp/
    ├── ws/             WebSocket bridge (port 22006)
    ├── public/
    │   ├── data/       per-map radar images, backgrounds, coordinate bounds
    │   └── assets/     character portraits, weapon icons, fonts
    └── src/
        ├── components/ radar, player, bomb, playercard, settings, bombtimer
        └── utilities/  coordinate conversion, per-map callouts
```

Build output (`release*/`, `dist/`, `node_modules/`, `vcpkg_installed/`) and `.pdb` debug symbols are git-ignored — the symbols embed absolute local paths and are ~17 MB each.

---

## Known limitations

- **Named areas cover 11 of the 17 maps.** Callouts exist for `cs_italy`, `cs_office`, `de_ancient`, `de_anubis`, `de_dust2`, `de_inferno`, `de_mirage`, `de_nuke`, `de_overpass`, `de_thera`, `de_vertigo`. On `cs_agency`, `de_cache`, `de_golden`, `de_grail`, `de_palacio`, and `de_train` the radar renders normally but has no area names or threat chips.
- **Area counting uses a fixed radius** around each callout rather than the engine's own place name, so a player near the edge of two areas is attributed to whichever centre is closer.
- The front end has no build-time dependency on the C++ side, but the bridge must be running — without it the page renders an empty map.
- Reading another process's memory needs administrator rights and will be blocked by some anti-cheat setups.

---
