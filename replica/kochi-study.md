# Kochi Fable implementation study

Inspected C:/shajmil/GTA-Kochi-Fable-main/GTA-Kochi-Fable-main on 2026-10-23.

## Verified technology

package.json: Vite 8, Three.js 0.186.1, plain JavaScript ES modules, local Fontsource Malayalam fonts. No application backend or database. Vite is development/build tooling.

main.js constructs Game and reports bootstrap errors. Game.js coordinates focused classes for rendering, audio, world, entities and HUD. The renderer owns a delta-time animation loop. AudioManager creates Web Audio nodes after a user gesture. Quality.js caps pixel density and provides low/medium/high settings. HUD.js binds real DOM controls to game state. World meshes are procedural; assets and licenses have separate documentation.

## Adaptation

The user selected Next.js rather than Angular in the updated brief. Use a static Next.js export and strict TypeScript. React replaces direct DOM HUD writes. Keep a small Game controller, Stage renderer and AudioManager, rather than importing the much larger open-world architecture. Create original procedural microphone, speakers and palm stage; no city assets or source are copied. Cap rendering pixel density, use delta time, dispose GPU resources, and retain a usable HTML game when WebGL is unavailable.

Supabase supplies anonymous identity, room metadata, private realtime channels and private recording storage. There is no custom application server, API route, Socket.IO server or AI service. The host coordinates timed phases. Local scoring is a measurable approximation and can be manipulated by a modified client.

The attached Guided Game Builder workflow is adapted to the already-defined brief: summarize requirements, make the core loop playable, expand, test, deliver. No repeated discovery interview or unrelated character movement.
