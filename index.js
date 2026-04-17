// ============================================================
// TELEGRAM BOT — ENTRY POINT v2.1
// ============================================================
require('dotenv').config();

const https = require('https');
const dns   = require('dns');

// Force IPv4 untuk koneksi stabil di Replit
dns.setDefaultResultOrder('ipv4first');
const httpsAgent = new https.Agent({
  family:          4,
  keepAlive:       true,
  keepAliveMsecs:  30000,
  timeout:         120000
});
console.log('🌐 IPv4-only mode aktif');

// ============================================================
// PROCESS-LEVEL ERROR HANDLERS
// Cegah bot crash karena unhandled rejection / exception
// ============================================================
process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err.message);
  console.error(err.stack);
  // Jangan exit — biarkan bot tetap jalan kecuali fatal
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason instanceof Error ? reason.message : String(reason));
  // Jangan exit — teruskan
});

// Validate required env vars
if (!process.env.BOT_TOKEN) { console.error('❌ BOT_TOKEN tidak ditemukan!'); process.exit(1); }
if (!process.env.OWNER_ID)  { console.error('❌ OWNER_ID tidak ditemukan!');  process.exit(1); }

const TelegramBot               = require('node-telegram-bot-api');
const { loadAdmins, deleteTimers } = require('./src/utils');
const { setupHandlers, startDailyStats } = require('./src/handlers');
const db = require('./src/db');

// ============================================================
// BOT INSTANCE
// ============================================================
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    interval:  3000,
    autoStart: false,
    params:    { timeout: 60 }
  },
  filepath: false,
  request: {
    agent:        httpsAgent,
    agentOptions: { keepAlive: true, keepAliveMsecs: 30000, timeout: 60000, family: 4 },
    forever:      true,
    timeout:      60000
  }
});

// ============================================================
// RETRY HELPER
// ============================================================
async function retryWithBackoff(fn, maxRetries = 5, initialDelay = 3000) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); } catch (err) {
      if (i === maxRetries - 1) throw err;
      const delay = initialDelay * Math.pow(2, i);
      console.log(`⏳ Retry ${i + 1}/${maxRetries} in ${delay / 1000}s... (${err.message})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ============================================================
// STARTUP SEQUENCE
// ============================================================
async function start() {
  console.log('🚀 Starting bot...');

  // 1. Load admins dari .env
  const admins = loadAdmins();
  console.log(`👑 Admins loaded (${admins.length}): ${admins.join(', ')}`);

  // 2. Verify DB connection dengan retry
  let dbReady = false;
  for (let i = 0; i < 5; i++) {
    try {
      await db.pool.query('SELECT 1');
      console.log('✅ PostgreSQL connected');
      dbReady = true;
      break;
    } catch (e) {
      console.error(`❌ DB connection attempt ${i + 1}/5:`, e.message);
      if (i < 4) await new Promise(r => setTimeout(r, 3000 * (i + 1)));
    }
  }
  if (!dbReady) { console.error('❌ DB tidak bisa connect setelah 5 percobaan'); process.exit(1); }

  // 3. Cleanup expired timeouts saat startup
  await db.cleanExpiredTimeouts().catch(e => console.warn('⚠️ cleanExpiredTimeouts:', e.message));
  console.log('✅ Expired timeouts cleaned');

  // 4. Periodik cleanup setiap jam (untuk 24/365 uptime)
  setInterval(async () => {
    try {
      await db.cleanExpiredTimeouts();
      const mem = process.memoryUsage();
      console.log(`🔄 Hourly cleanup OK | Heap: ${(mem.heapUsed/1024/1024).toFixed(1)}MB`);
    } catch (e) {
      console.warn('⚠️ Hourly cleanup error:', e.message);
    }
  }, 60 * 60 * 1000);

  // 5. Delete webhook, validate token
  try {
    await retryWithBackoff(() => bot.deleteWebHook(), 3, 2000);
    console.log('✅ Webhook cleared');
  } catch (_) {
    console.log('⚠️ Webhook clear gagal — lanjut');
  }

  const me = await retryWithBackoff(() => bot.getMe(), 5, 3000);
  console.log(`✅ Connected as @${me.username} (ID: ${me.id})`);

  // 6. Register all handlers
  setupHandlers(bot);
  console.log('✅ Handlers registered');

  // 7. Daily stats scheduler
  startDailyStats(bot);

  // 8. Start polling
  await bot.startPolling();
  console.log('🤖 Bot is running! 🚀');

  // 9. Memory usage log setiap 6 jam (deteksi memory leak)
  setInterval(() => {
    const mem = process.memoryUsage();
    const up  = process.uptime();
    console.log(
      `💓 Heartbeat | Uptime: ${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m | ` +
      `Heap: ${(mem.heapUsed/1024/1024).toFixed(1)}/${(mem.heapTotal/1024/1024).toFixed(1)} MB`
    );
  }, 6 * 60 * 60 * 1000);
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
async function shutdown(signal) {
  console.log(`\n🛑 Shutdown signal: ${signal}`);
  try {
    deleteTimers.forEach(t => clearTimeout(t));
    deleteTimers.clear();
    await bot.stopPolling();
    await db.pool.end();
    console.log('👋 Bot stopped gracefully');
  } catch (e) {
    console.error('❌ Shutdown error:', e.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ============================================================
// RUN
// ============================================================
start().catch(err => {
  console.error('❌ Fatal startup error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
