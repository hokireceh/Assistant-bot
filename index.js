const { Bot, session } = require('grammy');
const { autoRetry } = require('@grammyjs/auto-retry');
require('dotenv').config();

const https = require('https');
const dns   = require('dns');

dns.setDefaultResultOrder('ipv4first');
const httpsAgent = new https.Agent({
  family:          4,
  keepAlive:       true,
  keepAliveMsecs:  30000,
  timeout:         120000
});
console.log('🌐 IPv4-only mode aktif');

process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason instanceof Error ? reason.message : String(reason));
});

if (!process.env.BOT_TOKEN) { console.error('❌ BOT_TOKEN tidak ditemukan!'); process.exit(1); }
if (!process.env.OWNER_ID)  { console.error('❌ OWNER_ID tidak ditemukan!');  process.exit(1); }

const { loadAdmins, deleteTimers } = require('./src/utils');
const { setupHandlers, startDailyStats } = require('./src/handlers');
const db = require('./src/db');

const bot = new Bot(process.env.BOT_TOKEN, {
  client: {
    timeoutSeconds: 120,
    agent: httpsAgent,
    apiRoot: process.env.TELEGRAM_API_URL || undefined,
  }
});

// Backward compat: bot.api juga accessible via bot.telegram
bot.telegram = bot.api;

// Auto-retry untuk 429 rate limits & transient network errors
bot.api.config.use(autoRetry({
  maxRetryAttempts: 3,
  retryOnInternalServer: true,
}));

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

async function start() {
  console.log('🚀 Starting bot...');

  const admins = loadAdmins();
  console.log(`👑 Admins loaded (${admins.length}): ${admins.join(', ')}`);

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

  await db.cleanExpiredTimeouts().catch(e => console.warn('⚠️ cleanExpiredTimeouts:', e.message));
  console.log('✅ Expired timeouts cleaned');

  setInterval(async () => {
    try {
      await db.cleanExpiredTimeouts();
      const mem = process.memoryUsage();
      console.log(`🔄 Hourly cleanup OK | Heap: ${(mem.heapUsed/1024/1024).toFixed(1)}MB`);
    } catch (e) {
      console.warn('⚠️ Hourly cleanup error:', e.message);
    }
  }, 60 * 60 * 1000);

  // Delete webhook, validate token
  try {
    await retryWithBackoff(() => bot.api.deleteWebhook({ drop_pending_updates: true }), 3, 2000);
    console.log('✅ Webhook cleared');
  } catch (_) {
    console.log('⚠️ Webhook clear gagal — lanjut');
  }

  const me = await retryWithBackoff(() => bot.api.getMe(), 5, 3000);
  console.log(`✅ Connected as @${me.username} (ID: ${me.id})`);

  // Session middleware (in-memory)
  bot.use(session({ initial: () => ({}) }));

  // Register all handlers
  setupHandlers(bot);
  console.log('✅ Handlers registered');

  // Register bot commands
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Mulai bot & lihat menu' },
      { command: 'help',  description: 'Panduan penggunaan bot' }
    ]);
    console.log('✅ Bot commands registered');
  } catch (e) {
    console.warn('⚠️ setMyCommands gagal:', e.message);
  }

  try {
    await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } });
    console.log('✅ Menu button set');
  } catch (e) {
    console.warn('⚠️ setChatMenuButton gagal:', e.message);
  }

  // Daily stats scheduler
  startDailyStats(bot);

  // Global error handler
  bot.catch((err) => {
    const msg = err.message || '';
    const ignorable = [
      'message is not modified',
      'message to edit not found',
      'query is too old',
      'MESSAGE_ID_INVALID',
      "Bad Request: message can't be edited",
    ];
    if (ignorable.some(s => msg.includes(s))) return;
    // Log ALL non-ignorable errors, even polling errors
    console.error('❌ Bot error:', msg.substring(0, 300));
    if (err.ctx) console.log('   update:', err.ctx.update?.update_id);
  });

  // Mulai polling dengan retry jika 409 Conflict (sisa koneksi lama)
  const startOpts = {
    dropPendingUpdates: true,
    onStart: () => {
      console.log(`🤖 Bot is running! 🚀`);
    },
  };
  for (let i = 0; i < 5; i++) {
    try {
      const delay = i === 0 ? 2000 : 8000;
      if (i > 0) console.log(`🔄 Polling attempt ${i + 1}/5 after ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      await bot.api.deleteWebhook({ drop_pending_updates: true });
      await bot.start(startOpts);
      return;
    } catch (err) {
      const is409 = err.message?.includes('409');
      console.log(`⚠️ Polling ${is409 ? 'conflict (409)' : 'error'}: ${err.message}`);
      if (i === 4) {
        console.error('❌ Polling gagal setelah 5 percobaan — bot tidak menerima update');
        console.error('💡 Pastikan hanya ada SATU instance bot ini yang berjalan');
        return;
      }
    }
  }

  // Memory usage log setiap 6 jam
  setInterval(() => {
    const mem = process.memoryUsage();
    const up  = process.uptime();
    console.log(
      `💓 Heartbeat | Uptime: ${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m | ` +
      `Heap: ${(mem.heapUsed/1024/1024).toFixed(1)}/${(mem.heapTotal/1024/1024).toFixed(1)} MB`
    );
  }, 6 * 60 * 60 * 1000);
}

async function shutdown(signal) {
  console.log(`\n🛑 Shutdown signal: ${signal}`);
  try {
    deleteTimers.forEach(t => clearTimeout(t));
    deleteTimers.clear();
    await bot.stop();
    await db.pool.end();
    console.log('👋 Bot stopped gracefully');
  } catch (e) {
    console.error('❌ Shutdown error:', e.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start().catch(err => {
  console.error('❌ Fatal startup error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
