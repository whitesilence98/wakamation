# Wakamation

Next.js / React Three Fiber / Rapier client, Colyseus 0.16 authoritative server, shared TypeScript schema and movement simulation. Node.js 20.9+ required.

## Start

```sh
npm install
python -I scripts/extract-forest.py "assets-source/Stylized Nature MegaKit[Standard].zip" assets-source/forest-selected client/public/models/forest
npm run dev
```

Run the extraction once; it refuses to overwrite existing directories. The source ZIP must be present locally. Prepared forest models/textures stay outside Git, like the existing character models; include `client/public/models/` when deploying.

Open http://127.0.0.1:3000 in two tabs. WASD/arrows move, Shift runs, Space jumps. Server: http://localhost:2567/health.

```text
client/
  public/models/characters/axolot/axolot.glb     # mesh, texture, Walk clip
  public/models/characters/axolot/clips/run.glb     # matching rig's Run clip only
  public/models/characters/gawr/scene.gltf         # model, Idle and Walk clips
  public/models/characters/gawr/scene.bin          # external geometry/animation data
  public/models/characters/gawr/textures/         # two original PNG textures
  src/components/character-clips.ts # procedural in-place Jump pose
  src/app/                       # Next.js App Router, status HUD
  src/network/GameProvider.tsx   # join/rejoin, snapshot refs, membership
  src/components/
    GameScene.tsx                # Canvas, ground, Rapier, follow camera
    Character.tsx                # independent skeletons, animation fades, fallback
    LocalCharacter.tsx           # keyboard, fixed-step prediction, reconciliation
    RemoteCharacter.tsx          # frame-rate-independent interpolation
server/src/
  index.ts                       # WebSocket/HTTP transport, origin checks
  rooms/GameRoom.ts              # validated inputs, 20 Hz authoritative simulation
shared/src/
  schema/GameState.ts             # Player + MapSchema state
  movement.ts                    # inputs, validation, deterministic movement
```

## Ember Harbor prototype: The Bell (disabled)

Temporarily disabled: no festival HUD, lantern props, rounds, interactions, or rewards in normal rooms. Movement, multiplayer, customization, and voice remain available. Prototype code and tests are retained for later rework.

The retained prototype works as follows:

- First gathering starts 60 seconds after the room is created; a 10-second countdown precedes each 90-second round.
- Four marked lanterns spawn on walkable ground near the center. Approach an unlit lantern, press **E** or the on-screen button. Each flame lasts 12 seconds.
- Together, accumulate **120 lantern-seconds** before time runs out. Several lit lanterns contribute simultaneously.
- Contributors earn 5 Embers plus 2 per lighting, with a 10-Ember success bonus. Results last 15 seconds before the next cycle.
- Server validates range, ground height, timing, rate limits, and duplicate requests. Client cannot submit scores or rewards.

**Prototype limits:** Embers exist only for the current connection; reconnecting resets them. No persistence, fishing, housing, opt-in lobby, original harbor map, or 50-player scaling yet. The short event cadence is for playtesting.

## Share for a quick test

Install cloudflared on Windows (already installed on this development machine):

```powershell
winget install --id Cloudflare.cloudflared --exact --source winget
```

Stop existing client/server processes using ports 3000/2567, then run from the project root:

```sh
npm run share
```

The launcher creates two temporary Cloudflare tunnels over HTTP/2, configures the game endpoint/origin, and starts the development stack. It prints the sharing link after the local frontend and game health endpoint are ready; external tunnel connectivity is not verified automatically. Keep the terminal and computer running; Ctrl+C stops the stack and tunnels. Each run generates new URLs. No Cloudflare account, login, or domain is required.

Within one session the printed URLs stay valid. If the development stack exits or crashes, the launcher restarts it with the same tunnels and the link keeps working; it gives up and exits after five consecutive failures. Editing `client/next.config.mjs` makes Next restart its own server, so the link briefly returns errors while port 3000 re-binds.

For a stable link that does not hot-reload run `npm run share:build` instead. It opens the same temporary tunnels, builds once with the tunnel's `wss://` endpoint baked into the client, then serves the production output with `next start` and the compiled game server. No file watching and no dev-only restrictions, and the stack is restarted in place if a server exits, so the printed link stays usable. Any code change needs the command to be restarted, which also builds again and produces new URLs; the build happens before the first link is printed, so expect several minutes.

Both ports need exclusive use. If a port is busy, the launcher reports listener details where available: stop the old terminal with Ctrl+C, or check the reported command before using `taskkill /pid <PID> /T /F` on Windows. It never automatically stops unrelated listeners.

**Public links, no authentication:** this exposes the development server and game, not a private or production deployment. Confirm rights before distributing character assets. Forest models use the kit's CC0 license. Do not expose sensitive development data. A custom executable location can be supplied through `CLOUDFLARED_PATH` if the installer location/PATH is unavailable.

## Verify

```sh
npm test                         # movement + Bell logic + self-contained two-client Bell integration
npx tsx tests/model-check.mts      # model size, bone animation, Idle hold, jump clip binding
npm run typecheck
npm run build
npm run test:network              # requires running server
npx playwright test              # requires running app + Microsoft Edge
```

## Names and nearby voice

Players join as **Gaylord**. Edit the name field and press Enter or click elsewhere to save; there is no Save button. Blank names restore the default. Names are limited to 24 Unicode code points, are not unique, and appear above every avatar. Your selection survives automatic reconnects in the current page, not a page reload.

Drag the **Hue tint** slider to rotate your avatar's hue, or click the round swatch beside it for an exact colour. **Use default** restores your session-derived hue. Selection syncs to other players and survives automatic reconnects in the current page, not reloads. This rotates the original texture's hue, not an exact repaint: saturation/brightness remain from the art. Changes update material uniforms without rebuilding the animated model.

The panel collapses from the chevron in its header; the choice is remembered for the tab session only. The top-right gear opens **Graphics settings**, including on mobile. Map/help icons remain decorative.

## Graphics settings

Changes apply immediately, without reconnecting. Preferences are saved in this browser's local storage when available; Reset defaults restores Balanced. Opening the dialog releases movement and push-to-talk; Escape or Close returns to the game.

| Preset | View distance | Resolution | Avatar shadows | Decorative foliage |
| --- | --- | --- | --- | --- |
| Low | 30 units | Performance (0.75× DPR) | Off | 25% |
| Balanced (default) | 54 units | Standard (1× DPR) | On | 100% |
| High | 80 units | HD (device DPR, capped at 2×) | On | 100% |

Individual controls allow a Custom combination. View distance adjusts fog and camera clipping, not playable bounds. HD increases render pixels, not texture quality; on a 1× display it matches Standard. Foliage density affects only decorative bushes, grass, flowers and ferns; blocking trees, rocks and authoritative collision remain unchanged. Vegetation shadows stay disabled; avatar shadows use a 1024² map. Higher settings cost GPU time; frame-rate improvement is not measured.

A compact preferences/sampling check is available as `npx tsx tests/graphics-settings-check.mts`; run only when verification is requested.

## Nearby voice

Click **Enable voice** to grant microphone access and receive nearby audio. Hold **V** or the on-screen talk button to transmit; release to mute. Typing in a field, changing tabs, losing window focus, disabling voice, or disconnecting releases push-to-talk. The overhead microphone icon follows detected speech while transmitting, not movement speed. Everyone can see the indicator, including voice-disabled players; it is a cosmetic client-reported flag, not verified speech.

Voice pairs connect within 12 world units, remain connected until 15 units to avoid boundary churn, and fade to silence by 15. Each player supports at most six symmetric nearby voice connections; the HUD reports capacity limits. Enable voice on both sides, use headphones, and keep browser microphone permission enabled. Reconnecting the game turns voice off; enable it again explicitly. Failed connections show an error; disabling/re-enabling voice retries them.

**Connectivity/privacy:** microphones need HTTPS or localhost. Audio uses browser-native peer-to-peer WebRTC, not the Colyseus WebSocket or Cloudflare HTTP tunnels. The default STUN URL is `stun:stun.l.google.com:19302`; optionally set build-time `NEXT_PUBLIC_VOICE_STUN_URL` to another STUN endpoint. No TURN relay is configured: restrictive NAT/firewalls can prevent voice even when gameplay works. Reliable cross-network voice needs a TURN service with short-lived server-issued credentials; larger groups need an SFU rather than increasing the mesh limit.

Enabling voice shares transmitted audio with peers and may reveal network addresses. Proximity is a gameplay convenience, not a privacy boundary; modified clients could ignore disconnect/mute instructions. This app does not record or transcribe audio, but cannot prevent recipients from recording it. Do not transmit sensitive conversations.

A small social validation check is available as `npx tsx tests/social-check.mts`; run only when verification is requested.

## Model

Choose **Axolot** or **Gawr** under Customization → Character. Axolot is the initial default. The server validates and synchronizes selections; the selector and avatar reflect confirmed state. Changes are limited to once per second; a rejected rapid change displays a retry hint. The last confirmed selection survives automatic reconnects within this page, not reloads. Name, hue, position and movement remain unchanged when switching. Restart client/server together after this schema update.

Character assets are grouped under `client/public/models/characters/axolot/` and `client/public/models/characters/gawr/`; the axolot mesh/rig itself is unchanged.

Loader uses `/models/characters/axolot/axolot.glb` (walking model, about 22 MB) plus `/models/characters/axolot/clips/run.glb` (about 60 KB). Run tracks bind by bone name to each independent skeleton; the carrier mesh is not rendered. Models are fitted to 1.35 world units. Model forward is assumed +Z.

`walking_man` maps to Walk; `running` maps to Run, with 0.25-second cross-fades and matching normalized cycle phases between Walk/Run. Locomotion playback runs at 1.8 / 1.35 speed to compensate for the smaller avatar. Idle holds the first walking pose. Jump uses a small procedural knee/arm tuck, returns to its starting pose, and adds no root motion; playback matches the simulated airtime, with a short landing blend. If Run fails, Walk is used; if the main model fails, a capsule renders. Local action changes appear in HTML `data-clip` for browser checks.

Gawr loads `/models/characters/gawr/scene.gltf`, its sibling `scene.bin` (approximately 34.6 MiB), and two PNGs in `textures/`. Its 28,968 triangles are fewer than axolot's, but morph/animation data still makes the download large. `idle` maps to Idle, `ParadeWalk` to Walk at the authored speed; the resource clip is excluded. Running reuses Walk; jumping retains the current action while shared physics supplies the arc. No axolot-specific Run or procedural Jump tracks are applied to this rig. Both models use independent skeletons/materials, height fitting, grounding and hue tinting; a capsule appears during a model switch/load failure. Facing, bounds and animations have not been visually verified.

Gawr attribution: **Seafoam**, “Smol(ler) Gura - Gawr Gura, HoloMyth”, [source](https://sketchfab.com/3d-models/smoller-gura-gawr-gura-holomyth-3329b7c37a694fd19295e7f68d3471f8), [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Attribution is required; commercial use is restricted. Original asset files/metadata are retained; runtime changes include fitting and hue tint. The local source remains in `assets-source/smoller_gura_-_gawr_gura_holomyth/`. The four required files were copied preserving relative paths into the ignored gawr public folder; include that folder when deploying, subject to asset rights.

A compact character ID/clip-mapping check is available as `npx tsx tests/character-selection-check.mts`; run only when verification is requested.

Unused downloads remain under root `assets-source/`, outside the web root. The old `npm run clips` attack-to-jump extractor is retained for asset experiments only; its generated `jump.glb` is no longer loaded or required for builds. Replace the procedural pose with a rig-matched authored jump when available.

## Map

A code-built forest replaces the bedroom: 80 × 80 playable units on flat ground at `y = 0`, a central spawn clearing, looping dirt path, mixed trees, rocks, bushes, ferns, grass and flowers. Vegetation continues beyond the playable boundary, with distance fog. The old map assets remain locally but are not loaded.

`shared/src/forest.ts` defines a fixed-seed layout, model scales and circular trunk/rock footprints. Client rendering and server collision use that same layout. Trees and large rocks block movement; small foliage is decorative. Static vegetation is instanced per source mesh/material in 12-unit spatial chunks, allowing off-screen chunks to be frustum-culled. Decorative foliage stops rendering beyond two-thirds of the selected view distance from its chunk bounds (36 units at Balanced); some cutoff popping may be visible. Original textures and foliage alpha masks are retained. Vegetation does not cast or receive shadows; avatar ground shadows and render resolution follow Graphics settings. These graphics tradeoffs do not change placements or authoritative collision; no measured FPS improvement is claimed. The Standard kit uses ordinary PBR materials, not the promotional engine-specific stylized shaders.

Collision is a 0.5-unit occupancy grid derived automatically at module load, with a 0.35-unit player radius and swept axis-separated wall sliding. No map collision generation command is needed. The mask is conservative, not exact mesh physics. Ground stays flat; jumps cannot clear blocked cells or land on props. No hills, player-player collision or camera collision. Restart the client/server together and reconnect existing sessions after layout changes so prediction, authority and spawn positions agree.

Players spawn outward from the clearing center with at least 1.2 units of separation. The third-person camera follows a smoothed player anchor, independent of animation bobbing. Drag to orbit; scroll to zoom. WASD/arrows use the current camera direction; Shift runs and Space jumps.

Forest assets: Quaternius **Stylized Nature MegaKit Standard**, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The extraction command in Start prepares eight selected glTF models, matching buffers, textures and `License_Standard.txt` (26 files, approximately 14.7 MiB uncompressed). Assets are kept in `client/public/models/forest/`, ignored by Git. Scale/density/shadows and runtime performance have not been visually verified.

The old study-only map is unused; its source licensing still applies if reused: Jenioss, “[for study only] Summoner rift 3d export”, [source](https://sketchfab.com/3d-models/for-study-only-summoner-rift-3d-export-ac0a9c6676e34d1ebb184d8e93443c77), [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). Verify rights before distributing any unused source assets.

**Axolot's 308,367 triangles per avatar are too expensive for crowds.** No compression or decimation was applied. Reduce to roughly 15–20k triangles or provide distance LODs before scaling player counts; profile target devices.

## Synchronization contract

Clients send `{ seq, forward, right, run, jump? }`, never positions or elapsed time. Each input represents **one 50 ms simulation step**. The server consumes at most one queued input per player per tick, normalizes diagonals, bounds the arena, acknowledges `lastProcessedSeq`, rejects malformed/non-finite inputs and limits backlog/message rate. `jump` is an edge-triggered takeoff flag: the server ignores it unless the player is on the floor, and holding Space does not queue repeated jumps. No queued input means idle in the horizontal plane: disconnected or background tabs do not keep moving, though an in-flight jump is still resolved to the floor.

Vertical motion is simulated from shared constants on both sides (`JUMP_HEIGHT` apex, `JUMP_AIRTIME` feel, derived `GRAVITY`/`JUMP_SPEED`), so heights are never sent; only `vy` is replicated for remote smoothing. The current hop rises **0.8 units** over a **0.6-second** airborne arc; local and remote visuals smooth vertical motion between simulation updates.

Clients predict the same fixed steps, remove acknowledged inputs, reset to authoritative state and replay the remainder. Rendering is smoothed separately. Remote snapshots use exponential lerp and shortest-angle yaw interpolation, snapping on large corrections. This is latest-snapshot smoothing, not buffered interpolation.

Shared schemas compile with `tsc` using legacy decorators and `useDefineForClassFields: false`. Browser code imports schema **types** only and movement via a decorator-free subpath. Runtime state constructors come from Colyseus reflection.

## Configuration

Server environment: `PORT` (2567), `ALLOWED_ORIGINS` (comma-separated; defaults `http://localhost:3000,http://127.0.0.1:3000`). Client: `NEXT_PUBLIC_GAME_SERVER_URL`, e.g. `wss://game.example.com`. Default derives ws/wss from the page host on port 2567. Set build-time client environment for deployments. Dev Next.js binds to loopback.

## Deploy: one VPS + Docker

Deployment files are provided, not yet tested or deployed. Use a Linux VPS with Docker Engine and the Compose plugin installed; start around 2 vCPU / 4 GB RAM for building this demo. This is not a measured capacity guarantee.

**Before exposing the app:** verify distribution rights for the character assets. Forest assets use CC0; the unused study-only map is not loaded. Nothing here adds authentication or makes the demo private. For a private demo, restrict access using a VPN or an appropriate access gateway on both hostnames. Anyone who can reach it can join; origin checks are not access control.

1. Create DNS A records `play.your-domain.com` and `game.your-domain.com`, both pointing to the VPS. Allow TCP 80/443 through the firewall; preserve SSH access. Do not expose ports 3000/2567. Only configure AAAA records if IPv6 reaches this VPS too.
2. Install Docker using the [official instructions](https://docs.docker.com/engine/install/ubuntu/), including the Compose plugin. Upload the project, including `client/public/models/`. From your local project directory, for example:

   ```sh
   ssh user@YOUR_VPS_IP 'mkdir -p ~/wakamation'
   rsync -av --exclude=node_modules --exclude=.next --exclude=dist \
     --exclude=assets-source --exclude=.git --exclude=.claude \
     --exclude='.env*' --exclude='*.log' ./ user@YOUR_VPS_IP:~/wakamation/
   scp .env.example user@YOUR_VPS_IP:~/wakamation/.env.example
   ```

   `rsync` requires a Unix shell/WSL with rsync installed on both machines. SFTP is an alternative; include root dotfiles, especially `.dockerignore`.

3. On the VPS:

   ```sh
   cd ~/wakamation
   cp .env.example .env
   nano .env
   ```

   Set hostnames only, with no scheme/path:

   ```dotenv
   APP_HOST=play.your-domain.com
   GAME_HOST=game.your-domain.com
   ```

4. After resolving asset rights/access restrictions, launch:

   ```sh
   docker compose up -d --build
   ```

   Caddy obtains TLS certificates and proxies HTTPS/WSS. Only Caddy publishes host ports. Build-time `NEXT_PUBLIC_GAME_SERVER_URL` becomes `wss://GAME_HOST`; runtime `ALLOWED_ORIGINS` becomes `https://APP_HOST`. Changing either hostname requires rebuilding/recreating the services.

5. Optional verification, when requested:

   ```sh
   docker compose ps
   docker compose logs --tail=100 web game caddy
   curl -I https://play.your-domain.com
   curl https://game.your-domain.com/health
   ```

   Open the app in two tabs and confirm multiplayer. The first visit downloads about 141 MiB of GLBs, plus application code; allow time for the map.

Updates: upload changed files, then rerun `docker compose up -d --build`. Game-server restarts disconnect players and discard in-memory rooms. Keep one game replica; multiple replicas need additional Colyseus infrastructure. Caddy certificates persist in named volumes; do not remove them with `down -v` during routine updates. The initial image deliberately retains build tools and source for workspace reliability; prune dependencies/use standalone output when image size matters.

## Deliberate limits

- Flat-floor movement with approximate shared obstacle collision and a vertical jump arc; no player collisions. Jumping is purely vertical: the 2D walkability mask is height-independent, so a jump cannot clear a blocked cell. Rapier provides a local floor/proxy, not server movement authority. Use shared terrain heights or a shared physics simulation when gameplay needs exact geometry.
- No persistent account/authentication, saves, combat, matchmaking across processes, or interest management. 32 players per room. Origin checks are not authentication; non-browser clients may omit Origin. Deploy behind TLS, request size/rate limits; add authentication before public persistent play.
- Automatic retry joins a **new session** with a new spawn; not transparent session restoration.
- Hidden tabs stop new input; bounded queued input may finish first. Long render stalls intentionally do not replay wall-clock time.
- Animation cross-fades require the actual matching clips. Skinned-model WebGL performance and visual animation correctness require testing the target devices and final art.
