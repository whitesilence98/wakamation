import {
  clearOrphanListeners, exitOf, installSignalHandlers, isStopping, killTree, launch, npm,
  openTunnels, requireFreePort, stackEnv, stop, waitForStack,
} from "./share-lib.mjs";

installSignalHandlers();

// Production share: build once with the tunnel's wss endpoint baked in, then serve
// the compiled output. No HMR, no dev-only restrictions, no config reloads. The
// stack is still restarted in place if it exits, so the printed link keeps working.
try {
  await Promise.all([requireFreePort(3000), requireFreePort(2567)]);
  const links = await openTunnels();
  const env = { ...stackEnv(links), NODE_ENV: "production" };

  console.log("Building shared schema, server, and client. This takes a few minutes...");
  // Supervised so a normal build exit does not tear the tunnels down; the code is
  // inspected below and a failure ends the session instead of retrying.
  const build = npm(["run", "build"], { env, stdio: ["ignore", "pipe", "pipe"], supervised: true });
  const buildCode = await exitOf(build);
  if (isStopping()) process.exit(0);
  if (buildCode !== 0) throw new Error(`The production build failed (code ${buildCode}). Fix the error, then rerun npm run share:build.`);

  const serve = () => {
    // `next start` reads NEXT_PUBLIC_GAME_SERVER_URL from the build, but the game
    // server still needs ALLOWED_ORIGINS for WebSocket origin checks.
    const web = launch("node", ["node_modules/next/dist/bin/next", "start", "client", "--hostname", "127.0.0.1", "--port", "3000"], { env, stdio: ["ignore", "pipe", "pipe"], supervised: true });
    const game = launch("node", ["server/dist/index.js"], { env: { ...env, PORT: "2567" }, stdio: ["ignore", "pipe", "pipe"], supervised: true });
    // Report as soon as either one dies; the pair is killed together before respawn
    // so a half-dead stack never keeps a port.
    return Promise.race([exitOf(web), exitOf(game)]).then(() => {
      killTree(web);
      killTree(game);
      return Promise.all([exitOf(web), exitOf(game)]);
    });
  };

  let firstRun = true;
  for (;;) {
    const serving = serve();
    try {
      await waitForStack(Date.now() + 60_000);
    } catch (error) {
      console.error(error.message);
      throw new Error("The production servers did not become ready. Rerun the build with npm run build to inspect errors.");
    }
    if (firstRun) {
      console.log(`\nServing the production build. Share this link: ${links.app}\nGame endpoint: ${links.game}\nFirst load downloads about 141 MiB of models. Keep this terminal open.\n`);
      firstRun = false;
    }
    const [webCode, gameCode] = await serving;
    if (isStopping()) process.exit(0);
    console.error(`A server exited (web ${webCode}, game ${gameCode}). Restarting in 2s. Tunnel URLs are unchanged.`);
    clearOrphanListeners();
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
