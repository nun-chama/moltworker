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

    // 1. Kill all processes
    await killAllMoltbotProcesses(sandbox);
    console.log('[RESET] Processes killed');

    // 2. Wipe config directories (local)
    await sandbox.startProcess('rm -rf /root/.openclaw /root/.clawdbot');
    console.log('[RESET] Local config wiped');

    // 3. Wipe R2 backup (if mounted at /data/moltbot)
    // We try to remove the specific backup directories to avoid unmounting issues
    await sandbox.startProcess('rm -rf /data/moltbot/openclaw /data/moltbot/clawdbot /data/moltbot/.last-sync /data/moltbot/openclaw.json /data/moltbot/clawdbot.json');
    console.log('[RESET] R2 backup wiped (attempted)');

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

export { publicRoutes };
