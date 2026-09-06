# Architecture

## Goals

- Real Claude Code activity only; no simulated progress.
- Local, single user, zero cloud. `npm install && npm run dev`.
- Visual first: the planet *is* the status indicator.
- Extensible mappings so new event → reaction pairs never touch the renderer.

## Pieces

```
hooks/agent-universe-hook.mjs   zero-dependency forwarder run by Claude Code
scripts/install-hooks.mjs       merges hook config into ~/.claude/settings.json

server/src
  index.ts                      http server: /api/hook, /api/events, /api/stream (SSE), config, reset, mocks, static UI
  adapters/claudeCode.ts        raw hook payload → UniverseEvent[]  (the only Claude-Code-specific code)
  universe.ts                   sessions, status machine, mission detection, stale sweep, broadcast
  mappings.ts                   event → persistent PlanetState reaction table (+ personality bias)
  db.ts                         SQLite via node:sqlite
  names.ts                      seeded PRNG, planet names, personalities
  mock.ts                       pretend sessions that use the same adapter
  shared/types.ts               the normalized model shared with the client

client/src
  state/store.ts                SSE client + tiny external store for React
  universe/scene.ts             render loop, layout/orbits, camera, input, celebrations, background, star
  universe/planet.ts            one planet: sphere cache, projected structures, creatures, satellites, moons, rings
  universe/surface.ts           seeded terrain texture + sphere projection with 3-band lighting
  universe/effects.ts           particles and transient effects (lightning, meteors, rockets, ufos, beams, rings)
  universe/reactions.ts         event → transient effect table
  universe/sprites.ts           text-defined pixel sprites
  universe/palette.ts           world palettes
  audio/sound.ts                Web Audio synth with cooldowns
  ui/*.tsx                      HUD, focus panel, settings, museum, connect hint, toasts
```

## Data flow

1. Claude Code runs the hook (async) with JSON on stdin.
2. The hook trims large fields and POSTs to `127.0.0.1:4242/api/hook`, exiting 0 no matter what.
3. `adaptClaudeCodeHook` maps `hook_event_name` + `tool_name` + `tool_input`/`tool_response` to normalized events with an id of `session:hook:tool_use_id`, which makes redelivery idempotent (in-memory LRU + DB primary key).
4. `Universe.applyEvent` applies `mappings.ts` to the planet state (structures placed on a sphere by lat/lon, avoiding neighbours), updates status, attaches `built`/`broken`/`recovered` metadata so the client can animate the exact structure, persists, and broadcasts `{event, session}`.
5. Browsers receive a full snapshot on connect and incremental messages afterwards. The store updates React state, and the scene reacts through `reactions.ts`.

## Rendering

Canvas 2D into a low-resolution buffer (window / 3 px at "high" quality) that is upscaled with `image-rendering: pixelated`. This gives authentic chunky pixels, trivial CPU cost, and no WebGL complexity. A second, full-resolution canvas draws crisp text (labels, MISSION COMPLETE) in a pixel font.

Each planet has an equirectangular texture generated from its seed (value noise, sea level, ice caps, vegetation creeping over lowlands as `vegetation` grows). Every frame or two the sphere is projected into an `ImageData` of the on-screen diameter with three lighting bands lit from the direction of the star, night-side city glow proportional to `energy`, drifting clouds and scorched patches proportional to `damage`. Structures are lat/lon points projected onto the disc and drawn as upright sprites (rows appear bottom-up while under construction; damaged ones lose their roof and smoke).

Camera: world space is centred on the star; `view = {x, y, zoom}`; layout assigns orbit radii (one or two active rings, an outer dashed ring for resting/completed worlds), eases each planet toward an evenly spaced slot, and auto-fits zoom. Clicking a planet tweens the camera onto it.

Performance: the loop runs on requestAnimationFrame when visible and a 10 fps timer when the tab is hidden; sphere renders are cached; particles are capped by quality; planets far from the disc centre draw structures as single pixels.

## Lifecycle semantics

`Stop` (the agent finished responding) is treated as *task finished*: the planet celebrates and rests on the outer ring. A later `UserPromptSubmit` in the same session brings it back to the active ring ("reawakened"). `SessionEnd` archives it for good. Sessions that start and end without any activity are discarded. Active sessions with no signal for N minutes become *offline*; any new event revives them.

Mission complete fires when no active worlds remain and at least one world celebrated since the last mission, with a 90 s cooldown and a short delay so the individual celebration plays first.

## Extending

- New normalized event type: add it to `UniverseEventType`, map it in the adapter, add a row in `mappings.ts` (growth) and `reactions.ts` (effect).
- New structure: add a sprite to `sprites.ts` and include its kind in a reaction.
- New agent runtime: write another adapter producing `UniverseEvent`s, or post them to `/api/events`.
