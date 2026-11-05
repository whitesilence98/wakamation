# Wakamation

Next.js / React Three Fiber / Rapier client, Colyseus 0.16 authoritative server, shared TypeScript schema and movement simulation. Node.js 20.9+ required.

## Start

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000 in two tabs. WASD/arrows move, Shift runs. Server: http://localhost:2567/health.

```text
client/
  public/models/character.glb     # mesh, texture, Walk clip
  public/models/clips/run.glb     # matching rig's Run clip only
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

Both ports need exclusive use. If a port is busy, the launcher reports listener details where available: stop the old terminal with Ctrl+C, or check the reported command before using `taskkill /pid <PID> /T /F` on Windows. It never automatically stops unrelated listeners.

**Public links, no authentication:** this exposes the development server and game, not a private or production deployment. Confirm rights before distributing the study-only map or character. First load downloads about 141 MiB over your upload connection. Do not expose sensitive development data. A custom executable location can be supplied through `CLOUDFLARED_PATH` if the installer location/PATH is unavailable.

## Verify

```sh
npm test                         # pure movement + input validation
npx tsx tests/model-check.mts      # model size, actual bone animation, Idle hold
npm run typecheck
npm run build
npm run test:network              # requires running server
npx playwright test              # requires running app + Microsoft Edge
```

## Model

Loader uses `/models/character.glb` (walking model, about 22 MB) plus `/models/clips/run.glb` (about 60 KB). The run file supplies animation tracks only: matching bone names bind them to each character's independent cloned skeleton. Its placeholder mesh is never rendered. Geometry/materials are shared; models are fitted to 1.35 world units. Model forward is assumed +Z.

`walking_man` maps to Walk; `running` maps to Run, with 0.25-second cross-fades and matching normalized cycle phases between Walk/Run. Locomotion playback runs at 1.8 / 1.35 speed to compensate for the smaller avatar; this preserves the previous stride-to-speed ratio, not exact foot locking. No real Idle exists in this pack: Idle holds the first walking pose. If the run file fails, running uses Walk; if the main model fails, a capsule renders. Local action changes appear in the HTML `data-clip` attribute for browser checks. Movement clips must be **in-place**, not root-motion.

Unused downloads were preserved under root `assets-source/`, outside the web root: base, rigged, running, walking-armature, attack, summoner-rift. The original walking model is now `character.glb`, not duplicated. The attack contains baked root drift and is not wired into movement.

## Map

`/models/summoner-rift.glb` replaces the arena/grid at 5× source scale. Its playable plateau is centered around X/Z zero and translated down 86 units. Players spawn in clear space, searching outward from center with at least 1.2 units of initial separation. Movement stays within ±45 units, away from the decorative outer geometry. The third-person camera follows a smoothed player anchor, independent of animation bobbing. Drag to orbit horizontally/vertically; scroll to zoom. The view does not automatically recenter. WASD/arrows use the current camera direction, including while dragging during movement.

Server movement and client prediction share a generated 0.5-unit collision grid, with a 0.35-unit player radius and swept axis-separated wall sliding. The generator samples ground, rasterizes body-height obstacles, and blocks missing ground, steep transitions, and borders. This is an approximate walkability mask, not exact mesh physics: decorative geometry can overblock paths or leave classification errors. Height remains `y = 0`; uneven surfaces may clip feet. No jumping, player-player collision, or camera collision is included. Existing sessions must reconnect after collision data changes so they receive a clear spawn.

Regenerate after changing the map asset or its placement: `node scripts/build-collision.mjs`. The script writes `shared/src/collision-data.ts`; normal shared compilation then supplies identical data to client and server. The server never loads the full GLB.

The unmodified map is about 119 MiB, with 99 embedded textures. Source backup remains in `assets-source/`. Embedded credit: Jenioss, “[for study only] Summoner rift 3d export”, [source](https://sketchfab.com/3d-models/for-study-only-summoner-rift-3d-export-ac0a9c6676e34d1ebb184d8e93443c77), [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). Keep this use for local study; verify rights before public distribution or commercial use.

**308,367 triangles per avatar is too expensive for crowds.** No compression or decimation was applied. Reduce to roughly 15–20k triangles or provide distance LODs before scaling player counts; profile target devices.

## Synchronization contract

Clients send `{ seq, forward, right, run }`, never positions or elapsed time. Each input represents **one 50 ms simulation step**. The server consumes at most one queued input per player per tick, normalizes diagonals, bounds the arena, acknowledges `lastProcessedSeq`, rejects malformed/non-finite inputs and limits backlog/message rate. No queued input means idle: disconnected or background tabs do not keep moving.

Clients predict the same fixed steps, remove acknowledged inputs, reset to authoritative state and replay the remainder. Rendering is smoothed separately. Remote snapshots use exponential lerp and shortest-angle yaw interpolation, snapping on large corrections. This is latest-snapshot smoothing, not buffered interpolation.

Shared schemas compile with `tsc` using legacy decorators and `useDefineForClassFields: false`. Browser code imports schema **types** only and movement via a decorator-free subpath. Runtime state constructors come from Colyseus reflection.

## Configuration

Server environment: `PORT` (2567), `ALLOWED_ORIGINS` (comma-separated; defaults `http://localhost:3000,http://127.0.0.1:3000`). Client: `NEXT_PUBLIC_GAME_SERVER_URL`, e.g. `wss://game.example.com`. Default derives ws/wss from the page host on port 2567. Set build-time client environment for deployments. Dev Next.js binds to loopback.

## Deploy: one VPS + Docker

Deployment files are provided, not yet tested or deployed. Use a Linux VPS with Docker Engine and the Compose plugin installed; start around 2 vCPU / 4 GB RAM for building this demo. This is not a measured capacity guarantee.

**Before exposing the app:** verify distribution rights for the study-only map and character. Nothing here adds authentication or makes the demo private. For a private demo, restrict access using a VPN or an appropriate access gateway on both hostnames. Anyone who can reach it can join; origin checks are not access control.

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

- Flat-height movement with approximate shared obstacle collision; no jumping or player collisions. Rapier provides a local floor/proxy, not server movement authority. Use shared terrain heights or a shared physics simulation when gameplay needs exact geometry.
- No persistent account/authentication, saves, combat, matchmaking across processes, or interest management. 32 players per room. Origin checks are not authentication; non-browser clients may omit Origin. Deploy behind TLS, request size/rate limits; add authentication before public persistent play.
- Automatic retry joins a **new session** with a new spawn; not transparent session restoration.
- Hidden tabs stop new input; bounded queued input may finish first. Long render stalls intentionally do not replay wall-clock time.
- Animation cross-fades require the actual matching clips. Skinned-model WebGL performance and visual animation correctness require testing the target devices and final art.
