import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { MOLTBOT_PORT } from '../config';
import { findExistingMoltbotProcess, killAllMoltbotProcesses } from '../gateway';

/**
 * Public routes - NO Cloudflare Access authentication required
 *
 * These routes are mounted BEFORE the auth middleware is applied.
 * Includes: health checks, static assets, and public API endpoints.
 */
const publicRoutes = new Hono<AppEnv>();

// GET /sandbox-health - Health check endpoint
publicRoutes.get('/sandbox-health', (c) => {
  return c.json({
    status: 'ok',
    service: 'moltbot-sandbox',
    gateway_port: MOLTBOT_PORT,
  });
});

// GET /logo.png - Serve logo from ASSETS binding
publicRoutes.get('/logo.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /logo-small.png - Serve small logo from ASSETS binding
publicRoutes.get('/logo-small.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /api/status - Public health check for gateway status (no auth required)
publicRoutes.get('/api/status', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const process = await findExistingMoltbotProcess(sandbox);
    if (!process) {
      return c.json({ ok: false, status: 'not_running' });
    }

    // Process exists, check if it's actually responding
    // Try to reach the gateway with a short timeout
    try {
      await process.waitForPort(18789, { mode: 'tcp', timeout: 5000 });
      return c.json({ ok: true, status: 'running', processId: process.id });
    } catch {
      return c.json({ ok: false, status: 'not_responding', processId: process.id });
    }
  } catch (err) {
    return c.json({
      ok: false,
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /_admin/assets/* - Admin UI static assets (CSS, JS need to load for login redirect)
// Assets are built to dist/client with base "/_admin/"
publicRoutes.get('/_admin/assets/*', async (c) => {
  const url = new URL(c.req.url);
  // Rewrite /_admin/assets/* to /assets/* for the ASSETS binding
  const assetPath = url.pathname.replace('/_admin/assets/', '/assets/');
  const assetUrl = new URL(assetPath, url.origin);
  return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
});

// POST /reset-factory-defaults - DANGER: Wipe all data and restart
// This is a temporary endpoint to fix corrupted state where config is missing but gateway is running.
publicRoutes.all('/reset-factory-defaults', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    console.log('[RESET] Initiating factory reset...');

    // 1. Wipe config directories (local) - Do this FIRST to ensure config is gone even if kill fails
    try {
      await sandbox.startProcess('rm -rf /root/.openclaw /root/.clawdbot');
      console.log('[RESET] Local config wiped');
    } catch (e) {
      console.error('[RESET] Failed to wipe local config:', e);
    }

    // 2. Wipe R2 backup (if mounted at /data/moltbot)
    try {
      await sandbox.startProcess('rm -rf /data/moltbot/openclaw /data/moltbot/clawdbot /data/moltbot/.last-sync /data/moltbot/openclaw.json /data/moltbot/clawdbot.json');
      console.log('[RESET] R2 backup wiped (attempted)');
    } catch (e) {
      console.error('[RESET] Failed to wipe R2 backup:', e);
    }

    // 3. Kill all processes (might timeout if many processes)
    await killAllMoltbotProcesses(sandbox);
    console.log('[RESET] Processes killed');

    return c.json({
      status: 'ok',
      message: 'Factory reset initiated. Gateway will restart and onboard freshly on next request.'
    });
  } catch (err) {
    console.error('[RESET] Failed:', err);
    return c.json({
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error'
    }, 500);
  }
});

// GET /diagnose - Diagnose current state (Config, Env, Files)
publicRoutes.get('/diagnose', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    // 1. Check config content
    const configProc = await sandbox.startProcess('cat /root/.openclaw/openclaw.json');
    const configLogs = await configProc.getLogs();

    // 2. Check env vars
    const envProc = await sandbox.startProcess('env');
    const envLogs = await envProc.getLogs();

    // 3. Check R2 mount and local config dir
    const lsR2Proc = await sandbox.startProcess('ls -la /data/moltbot');
    const lsR2Logs = await lsR2Proc.getLogs();

    const lsLocalProc = await sandbox.startProcess('ls -la /root/.openclaw');
    const lsLocalLogs = await lsLocalProc.getLogs();

    return c.json({
      config: configLogs.stdout,
      env: envLogs.stdout,
      lsR2: lsR2Logs.stdout,
      lsLocal: lsLocalLogs.stdout,
      envConfig: c.env.MOLTBOT_GATEWAY_TOKEN ? 'Has TOKEN env' : 'No TOKEN env'
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

export { publicRoutes };
