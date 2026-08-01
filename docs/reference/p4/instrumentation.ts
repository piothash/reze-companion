/**
 * Next.js instrumentation hook — runs ONCE per server process at boot.
 *
 * This entry file is bundled for EVERY runtime (nodejs, edge), so it must not
 * reference Node APIs directly — the edge bundler statically analyzes it and
 * rejects process.on / process.uptime / memoryUsage. All Node-only crash
 * handling lives in instrumentation-node.ts behind a dynamic import that only
 * executes on the nodejs runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { installCrashHandlers } = await import("./instrumentation-node")
  installCrashHandlers()
  // Telegram remote command console: no-ops unless TELEGRAM_BOT_TOKEN and
  // TELEGRAM_CHAT_ID are configured. Fully isolated from the trading path.
  const { startTelegramConsole } = await import("./lib/v2/engine/telegram-console")
  startTelegramConsole()

  // ARC Phase 2 (R-1) — BOOT THE ENGINE AT PROCESS START.
  // The engine singleton used to be constructed lazily by the first HTTP
  // request that touched an engine route. Its constructor is what runs
  // maybeAutoResume() (re-ignition after a PM2 restart / crash / deploy), so
  // on a headless VPS with no dashboard open the bot stayed DOWN after every
  // restart until a human loaded a page — indistinguishable from "the bot
  // stopped by itself". Constructing here makes restart recovery automatic.
  // Never during `next build` (prerender workers must not open the ledger or
  // start feeds).
  if (process.env.NEXT_PHASE === "phase-production-build") return
  try {
    const { getEngine } = await import("./lib/v2/engine/engine")
    getEngine()
  } catch (e) {
    console.error(`[BOOT] engine construction failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  }
}
