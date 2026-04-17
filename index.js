// ============================================================
// TELEGRAM BOT — ENTRY POINT
// ============================================================
require('dotenv').config();

const https = require('https');
const dns   = require('dns');

// Force IPv4 untuk koneksi stabil di Replit / slow internet
dns.setDefaultResultOrder('ipv4first');
const httpsAgent = new https.Agent({ family: 4, keepAlive: true, keepAliveMsecs: 30000, timeout: 120000 });
console.log('🌐 IPv4-only mode aktif');

// Validate required env vars
if (!process.env.BOT_TOKEN) { console.error('❌ BOT_TOKEN tidak ditemukan!'); process.exit(1); }
if (!process.env.OWNER_ID)  { console.error('❌ OWNER_ID tidak ditemukan!');  process.exit(1); }

const TelegramBot = require('node-telegram-bot-api');
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
      console.log(`⏳ Retry ${i+1}/${maxRetries} in ${delay/1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ============================================================
// STARTUP SEQUENCE
// ============================================================
async function start() {
  console.log('🚀 Starting bot...');

  // 1. Load admins from .env
  const admins = loadAdmins();
  console.log(`👑 Admins loaded: ${admins.join(', ')}`);

  // 2. Verify DB connection
  try {
    await db.pool.query('SELECT 1');
    console.log('✅ PostgreSQL connected');
  } catch (e) {
    console.error('❌ DB connection failed:', e.message);
    process.exit(1);
  }

  // 3. Clean expired timeouts on startup
  await db.cleanExpiredTimeouts().catch(() => {});

  // 4. Delete webhook, validate token
  try {
    await retryWithBackoff(() => bot.deleteWebHook(), 3, 2000);
    console.log('✅ Webhook cleared');
  } catch (_) {
    console.log('⚠️ Could not clear webhook — continuing anyway');
  }

  const me = await retryWithBackoff(() => bot.getMe(), 5, 3000);
  console.log(`✅ Connected as @${me.username} (ID: ${me.id})`);

  // 5. Register all handlers
  setupHandlers(bot);
  console.log('✅ Handlers registered');

  // 6. Start daily stats scheduler
  startDailyStats(bot);

  // 7. Start polling
  await bot.startPolling();
  console.log('🤖 Bot is running! 🚀');
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

async function shutdown() {
  console.log('\n🛑 Shutting down gracefully...');
  deleteTimers.forEach(t => clearTimeout(t));
  deleteTimers.clear();
  await bot.stopPolling().catch(() => {});
  await db.pool.end().catch(() => {});
  console.log('👋 Bot stopped');
  process.exit(0);
}

// ============================================================
// RUN
// ============================================================
start().catch(err => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});
