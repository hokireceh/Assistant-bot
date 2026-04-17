const db        = require('./db');
const ai        = require('./ai');
const kb        = require('./keyboards');
const { OWNER_ID, AI_ENABLED, AI_MODELS, GUARD_MODEL } = require('./config');
const {
  isAdmin, isOwner, getAdmins, checkRateLimit,
  isTimedOut, getTimeoutRemaining,
  autoDeleteMessage, entitiesToHTML, createPagination
} = require('./utils');

// ============================================================
// PENDING ACTIONS STATE (multi-step flows)
// TTL: 10 menit — auto-expire jika user tidak melanjutkan
// ============================================================
const pendingActions = new Map(); // userId -> { action, data, expiresAt }

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 menit

// Cleanup expired pending actions setiap 5 menit
setInterval(() => {
  const now = Date.now();
  for (const [uid, p] of pendingActions.entries()) {
    if (p.expiresAt && now > p.expiresAt) {
      pendingActions.delete(uid);
    }
  }
}, 5 * 60 * 1000);

function setPending(userId, action, data = {}) {
  pendingActions.set(userId, { action, data, expiresAt: Date.now() + PENDING_TTL_MS });
}

// ============================================================
// CACHED BOT ID — diisi satu kali saat setupHandlers
// ============================================================
let cachedBotId = null;

// ============================================================
// RESERVED ! COMMANDS — tidak diteruskan ke AI
// ============================================================
const RESERVED_BANG = new Set(['aireset', 'aistats', 'health', 'notifstats', 'status', 'export', 'list', 'add', 'del', 'info', 'search', 'clone', 'rename']);

// ============================================================
// NOTIF STATS (shared dengan ai.js)
// ============================================================
const notifStats = ai.notificationStats;

// ============================================================
// HELPER: send / edit main menu
// ============================================================
async function sendMainMenu(bot, chatId, userId, editMsgId = null) {
  const text = `🤖 *Menu Utama*\n\nSelamat datang! Pilih menu yang kamu butuhkan.`;
  const opts = { parse_mode: 'Markdown', reply_markup: kb.mainMenuKeyboard(userId) };
  if (editMsgId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: editMsgId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

// ============================================================
// HELPER: send / edit filter menu
// ============================================================
async function sendFilterMenu(bot, chatId, userId, editMsgId = null) {
  const count = await db.getFilterCount();
  const text  = `🎯 *Filter Manager*\n\n📦 Total filter: *${count}*\n\nPilih aksi:`;
  const opts  = { parse_mode: 'Markdown', reply_markup: kb.filterMenuKeyboard(userId) };
  if (editMsgId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: editMsgId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

// ============================================================
// HELPER: build filter list page
// ============================================================
async function buildFilterListText(page) {
  const names = await db.getFilterNames();
  if (names.length === 0) {
    return { text: '📭 Belum ada filter. Tambah filter via menu ➕.', total: 0, page: 1 };
  }
  const { items, total, page: p } = createPagination(names, page, 15);
  const start    = (p - 1) * 15;
  const listText = items.map((n, i) => `${start + i + 1}. \`!${n}\``).join('\n');
  return {
    text: `🎯 *Daftar Filter (${names.length} total) — Halaman ${p}/${total}:*\n\n${listText}`,
    total, page: p
  };
}

// ============================================================
// HELPER: send filter content (trigger)
// ============================================================
async function sendFilter(bot, chatId, filter) {
  // Build inline keyboard from saved buttons
  let replyMarkup = null;
  if (filter.buttons && filter.buttons.length > 0) {
    replyMarkup = {
      inline_keyboard: filter.buttons.map(row =>
        row.map(btn => ({
          text:          btn.text,
          url:           btn.url            || undefined,
          callback_data: btn.callback_data  || undefined
        }))
      )
    };
  }

  const entities         = filter.entities;
  const caption_entities = filter.caption_entities;
  const rawText          = filter.text || '';

  // Text message formatting
  let formattedText  = rawText;
  let textParseMode  = null;
  if (entities && entities.length > 0) {
    formattedText = entitiesToHTML(rawText, entities);
    textParseMode = 'HTML';
  }

  // Caption formatting (for media)
  let formattedCaption = rawText;
  let captionParseMode = null;
  if (rawText.trim().length > 0) {
    if (caption_entities && caption_entities.length > 0) {
      formattedCaption = entitiesToHTML(rawText, caption_entities);
      captionParseMode = 'HTML';
    } else if (entities && entities.length > 0) {
      formattedCaption = entitiesToHTML(rawText, entities);
      captionParseMode = 'HTML';
    }
  }

  const captionOpts = () => {
    const o = {};
    if (formattedCaption && formattedCaption.trim()) {
      o.caption = formattedCaption;
      if (captionParseMode) o.parse_mode = captionParseMode;
    }
    if (replyMarkup) o.reply_markup = replyMarkup;
    return o;
  };

  if      (filter.photo)     await bot.sendPhoto    (chatId, filter.photo,     captionOpts());
  else if (filter.video)     await bot.sendVideo    (chatId, filter.video,     captionOpts());
  else if (filter.animation) await bot.sendAnimation(chatId, filter.animation, captionOpts());
  else if (filter.document)  await bot.sendDocument (chatId, filter.document,  captionOpts());
  else if (filter.audio)     await bot.sendAudio    (chatId, filter.audio,     captionOpts());
  else if (filter.voice)     await bot.sendVoice    (chatId, filter.voice,     captionOpts());
  else if (filter.sticker) {
    await bot.sendSticker(chatId, filter.sticker);
    if (formattedText && formattedText.trim()) {
      const o = {};
      if (textParseMode) o.parse_mode = textParseMode;
      await bot.sendMessage(chatId, formattedText, o);
    }
  } else if (formattedText && formattedText.trim()) {
    const o = {};
    if (textParseMode) o.parse_mode = textParseMode;
    if (replyMarkup)   o.reply_markup = replyMarkup;
    await bot.sendMessage(chatId, formattedText, o);
  }
}

// ============================================================
// HELPER: notify critical error to owner (fire-and-forget)
// ============================================================
function notifyCriticalError(bot, errorMsg, context = {}) {
  if (!OWNER_ID) return;
  const msg =
    `🚨 *Critical Error*\n\n` +
    `⏰ ${new Date().toLocaleString('id-ID')}\n` +
    `❌ \`${String(errorMsg).substring(0, 200)}\`\n` +
    `${context.chatId     ? `💬 Chat: ${context.chatId}\n`     : ''}` +
    `${context.userId     ? `👤 User: ${context.userId}\n`     : ''}` +
    `${context.filterName ? `🎯 Filter: ${context.filterName}` : ''}`;
  bot.sendMessage(OWNER_ID, msg, { parse_mode: 'Markdown' })
    .then(() => notifStats.alertsSent++)
    .catch(() => {});
}

// ============================================================
// INLINE KEYBOARD HELPER: cancel row
// ============================================================
function cancelRow(target = 'filter_menu') {
  return { inline_keyboard: [[{ text: '❌ Batal', callback_data: target }]] };
}

// ============================================================
// SETUP ALL HANDLERS
// ============================================================
function setupHandlers(bot) {

  // Cache bot ID once on startup — never call getMe() per-message (BUG-002 fix)
  bot.getMe().then(me => {
    cachedBotId = me.id;
    console.log(`✅ Cached bot ID: ${cachedBotId} (@${me.username})`);
  }).catch(err => console.error('❌ getMe failed:', err.message));

  // ==========================================================
  // /start
  // ==========================================================
  bot.onText(/\/start/, async (msg) => {
    const chatId    = msg.chat.id;
    const userId    = msg.from.id;
    const firstName = msg.from.first_name || 'User';
    autoDeleteMessage(bot, chatId, msg.message_id, 1);

    if (!isAdmin(userId)) {
      await db.trackUserAccess(userId, msg.from.username, msg.from.first_name, msg.from.last_name)
        .catch(() => {});
      const r = await bot.sendMessage(chatId, '❌ Bot ini hanya untuk admin!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    // Persistent reply keyboard (menu di bawah)
    await bot.sendMessage(chatId,
      `👋 Halo *${firstName}*! Menu keyboard aktif di bawah~`,
      { parse_mode: 'Markdown', reply_markup: kb.adminMenuKeyboard() }
    );
    await sendMainMenu(bot, chatId, userId);
  });

  // ==========================================================
  // /help
  // ==========================================================
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    autoDeleteMessage(bot, chatId, msg.message_id, 1);

    if (!isAdmin(userId)) {
      await db.trackUserAccess(userId, msg.from.username, msg.from.first_name, msg.from.last_name)
        .catch(() => {});
      const r = await bot.sendMessage(chatId, '❌ Bot ini hanya untuk admin!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    const help =
      `📖 *Panduan Bot*\n\n` +
      `🎯 *Filter* (via menu 🎯 Kelola Filter):\n` +
      `• ➕ Tambah — reply ke pesan sumber, ketik nama filter\n` +
      `• 🗑️ Hapus — ketik nama filter\n` +
      `• 📋 Daftar — pagination 15/halaman\n` +
      `• 🔍 Cari — cari by keyword\n` +
      `• 📋 Clone — ketik: \`asal tujuan\`\n` +
      `• ✏️ Rename — ketik: \`lama baru\`\n` +
      `${isOwner(userId) ? '• 💾 Export — backup JSON (owner only)\n' : ''}` +
      `\n💡 *Trigger filter:*\n` +
      `Ketik \`!namafilter\` atau langsung \`namafilter\`\n\n` +
      `${AI_ENABLED ? '🤖 *AI Hoki:*\n• Private: langsung chat\n• Group: reply ke bot\n\n' : ''}` +
      `⏱️ *Timeout:* /timeout <menit> (reply ke user)\n\n` +
      `⌨️ *Shortcut* (menu keyboard di bawah):\n` +
      `📋 Menu Utama | 🎯 Filter | 📊 Status`;

    const r = await bot.sendMessage(chatId, help, {
      parse_mode: 'Markdown',
      reply_markup: kb.backKeyboard('main_menu')
    });
    autoDeleteMessage(bot, chatId, r.message_id, 15);
  });

  // ==========================================================
  // /timeout — membutuhkan reply ke user target
  // ==========================================================
  bot.onText(/\/timeout(?:@\w+)?\s+(\d+)/, async (msg, match) => {
    const chatId  = msg.chat.id;
    const userId  = msg.from.id;
    const minutes = parseInt(match[1]);
    autoDeleteMessage(bot, chatId, msg.message_id, 3);

    if (!isAdmin(userId)) {
      await db.trackUserAccess(userId, msg.from.username, msg.from.first_name, msg.from.last_name)
        .catch(() => {});
      const r = await bot.sendMessage(chatId, '❌ Hanya admin yang bisa timeout user!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }
    if (!msg.reply_to_message) {
      const r = await bot.sendMessage(chatId, '⚠️ Reply ke pesan user yang mau di-timeout!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }
    if (minutes < 1 || minutes > 1440) {
      const r = await bot.sendMessage(chatId, '⚠️ Durasi timeout: 1–1440 menit (max 24 jam)');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    const targetId = msg.reply_to_message.from?.id;
    if (!targetId) {
      const r = await bot.sendMessage(chatId, '⚠️ Tidak bisa baca user ID target!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }
    if (targetId === OWNER_ID || isAdmin(targetId)) {
      const r = await bot.sendMessage(chatId, '❌ Tidak bisa timeout admin/owner!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    await db.setSpamTimeout(targetId, Date.now() + minutes * 60 * 1000);
    const r = await bot.sendMessage(chatId,
      `⏱️ *User di-timeout!*\n👤 ID: \`${targetId}\`\n⏰ Durasi: ${minutes} menit`,
      { parse_mode: 'Markdown' }
    );
    autoDeleteMessage(bot, chatId, r.message_id, 5);
  });

  // ==========================================================
  // !aireset — owner only (via text command)
  // Tetap sebagai teks agar mudah diakses; dilindungi dari AI
  // ==========================================================
  bot.onText(/^!aireset$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    autoDeleteMessage(bot, chatId, msg.message_id, 3);
    if (!isOwner(userId)) return;
    ai.resetAIStats();
    const r = await bot.sendMessage(chatId, '✅ AI stats & conversations berhasil di-reset!');
    autoDeleteMessage(bot, chatId, r.message_id, 5);
  });

  // ==========================================================
  // CALLBACK QUERY — semua inline button
  // Dibungkus try/catch agar error tidak crash bot
  // ==========================================================
  bot.on('callback_query', async (query) => {
    const chatId    = query.message.chat.id;
    const messageId = query.message.message_id;
    const userId    = query.from.id;
    const data      = query.data;

    // Jawab callback agar Telegram tidak tampilkan "loading"
    // Khusus filter_export: jawab dengan text custom sebelum proses
    if (data !== 'filter_export') {
      await bot.answerCallbackQuery(query.id).catch(() => {});
    }

    if (!isAdmin(userId)) return;

    try {
      await handleCallback(bot, chatId, messageId, userId, query.id, data);
    } catch (err) {
      console.error('❌ Callback error:', data, err.message);
      bot.sendMessage(chatId, `⚠️ Error: \`${err.message.substring(0, 100)}\``, { parse_mode: 'Markdown' })
        .catch(() => {});
    }
  });

  // ==========================================================
  // MESSAGE HANDLER
  // ==========================================================
  bot.on('message', async (msg) => {
    if (!msg.from) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text   = msg.text || '';

    // Slash commands sudah ditangani onText di atas
    if (text.startsWith('/')) return;

    // Skip reserved bang commands — ditangani onText masing-masing
    if (text.startsWith('!')) {
      const cmd = text.substring(1).split(/\s+/)[0].toLowerCase();
      if (RESERVED_BANG.has(cmd)) return;
    }

    // Gate non-admin — track dan silent reject
    if (!isAdmin(userId)) {
      // Hanya track jika terlihat mencoba trigger filter
      const pName = text.startsWith('!') ? text.substring(1).trim().toLowerCase() : text.trim().toLowerCase();
      if (pName && !pName.includes(' ') && pName.length >= 2) {
        const exists = await db.filterExists(pName).catch(() => false);
        if (exists) {
          await db.trackUserAccess(userId, msg.from.username, msg.from.first_name, msg.from.last_name)
            .catch(() => {});
          console.log(`🚫 Non-admin ${userId} tried filter: ${pName}`);
        }
      }
      return;
    }

    // Timeout check (DB-backed)
    if (await isTimedOut(userId)) {
      const rem = await getTimeoutRemaining(userId);
      const r   = await bot.sendMessage(chatId, `⏱️ Kamu masih timeout ${rem} detik lagi~`);
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    // ---- Reply keyboard shortcuts ----
    if (text === '📋 Menu Utama') {
      pendingActions.delete(userId);
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      await sendMainMenu(bot, chatId, userId);
      return;
    }
    if (text === '🎯 Filter') {
      pendingActions.delete(userId);
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      await sendFilterMenu(bot, chatId, userId);
      return;
    }
    if (text === '📊 Status') {
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      const stats = await db.getFilterStats();
      const mem   = process.memoryUsage();
      const up    = process.uptime();
      const r     = await bot.sendMessage(chatId,
        `📊 *Status Bot*\n\n` +
        `🎯 Filters: *${stats.total}*\n` +
        `💾 Memory: *${(mem.heapUsed/1024/1024).toFixed(2)} MB*\n` +
        `⏱️ Uptime: *${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m*`,
        { parse_mode: 'Markdown', reply_markup: kb.backKeyboard('main_menu') }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }

    // ---- Pending actions ----
    const pending = pendingActions.get(userId);
    if (pending) {
      // Cek TTL expired
      if (pending.expiresAt && Date.now() > pending.expiresAt) {
        pendingActions.delete(userId);
      } else {
        autoDeleteMessage(bot, chatId, msg.message_id, 3);
        await handlePendingAction(bot, chatId, userId, msg, text, pending);
        return;
      }
    }

    // ---- Filter trigger ----
    const potentialName = text.startsWith('!') ? text.substring(1).trim().toLowerCase() : text.trim().toLowerCase();
    if (potentialName && potentialName.length >= 2 && !/\s/.test(potentialName)) {
      const filter = await db.getFilter(potentialName).catch(() => null);
      if (filter) {
        if (!checkRateLimit(userId)) {
          const r = await bot.sendMessage(chatId, '⚠️ Terlalu banyak request! Tunggu sebentar.');
          autoDeleteMessage(bot, chatId, r.message_id, 3);
          return;
        }
        autoDeleteMessage(bot, chatId, msg.message_id, 3);
        try {
          await sendFilter(bot, chatId, filter);
        } catch (err) {
          console.error('❌ Filter error:', potentialName, err.message);
          const r = await bot.sendMessage(chatId,
            `⚠️ Error kirim filter *${potentialName}*:\n\`${err.message.substring(0, 100)}\``,
            { parse_mode: 'Markdown' }
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          if (!isOwner(userId)) {
            notifyCriticalError(bot, err.message, { chatId, userId, filterName: potentialName });
          }
        }
        return;
      }
    }

    // ---- AI Hoki ----
    if (!AI_ENABLED || !msg.text) return;

    // Group: hanya respon saat di-reply
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
      if (!cachedBotId) return;
      if (msg.reply_to_message?.from?.id !== cachedBotId) return;
    }

    const userMsg = msg.text.trim();
    if (userMsg.length < 2) return;

    const rl = ai.checkAIRateLimit(userId);
    if (!rl.allowed) {
      const r = await bot.sendMessage(chatId, `⏱️ Tunggu ${rl.remaining} detik lagi yaa~ 😊`);
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    try {
      await bot.sendChatAction(chatId, 'typing');
      const { response } = await ai.callGroqAPI(userMsg, userId);
      await bot.sendMessage(chatId, response, { reply_to_message_id: msg.message_id });
    } catch (err) {
      console.error('❌ AI Error:', err.message);
      let errMsg = 'Maaf nih~ Lagi error. Coba lagi yaa 🙏';
      if (err.message.includes('429') || err.message.includes('rate limit')) {
        errMsg = 'Lagi banyak yang pakai AI nih~ Tunggu sebentar yaa 🙏';
      } else if (err.message.includes('rate limited')) {
        errMsg = err.message;
      }
      const r = await bot.sendMessage(chatId, errMsg, { reply_to_message_id: msg.message_id });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
    }
  });

  // ==========================================================
  // WELCOME NEW MEMBERS
  // ==========================================================
  bot.on('new_chat_members', async (msg) => {
    const chatId = msg.chat.id;
    for (const member of msg.new_chat_members) {
      if (member.is_bot) continue;
      try {
        await bot.sendMessage(chatId,
          `👋 Selamat datang *${member.first_name || 'User'}*!\n\n` +
          `🤖 Gua bot filter management.\n` +
          `${AI_ENABLED ? '💬 Chat sama gua dengan reply ke pesan gua!\n' : ''}` +
          `Enjoy! 🚀`,
          { parse_mode: 'Markdown' }
        );
        notifStats.welcomesSent++;
      } catch (e) {
        console.error('❌ Welcome failed:', e.message);
      }
    }
  });

  // ==========================================================
  // POLLING ERROR — auto-recovery dengan backoff
  // ==========================================================
  let pollingErrCount = 0;
  let lastErrTime     = 0;

  bot.on('polling_error', (error) => {
    const now = Date.now();
    console.error('⚠️ Polling error:', error.code, error.message);
    if (now - lastErrTime > 120000) pollingErrCount = 0;
    lastErrTime = now;
    pollingErrCount++;

    const isNet = ['EFATAL','ETELEGRAM','ETIMEDOUT'].includes(error.code)
               || error.message.includes('getUpdates');

    if (pollingErrCount >= 10 && !isNet) {
      console.error('❌ Max retries — check BOT_TOKEN');
      process.exit(1);
    }

    const delay = Math.min(5000 * Math.min(pollingErrCount, 6), 30000);
    console.log(`🔄 Retry ${pollingErrCount}/10 in ${delay/1000}s...`);
    setTimeout(() => {
      bot.stopPolling().then(() => bot.startPolling({ restart: true })).catch(() => {});
    }, delay);
  });
}

// ============================================================
// CALLBACK HANDLER (dipanggil dari event handler di atas)
// Dipisah agar mudah di-maintain dan ter-wrap try/catch
// ============================================================
async function handleCallback(bot, chatId, messageId, userId, queryId, data) {

  // ---- noop ----
  if (data === 'noop') return;

  // ---- main_menu ----
  if (data === 'main_menu') {
    pendingActions.delete(userId);
    await sendMainMenu(bot, chatId, userId, messageId);
    return;
  }

  // ---- filter_menu ----
  if (data === 'filter_menu') {
    pendingActions.delete(userId);
    await sendFilterMenu(bot, chatId, userId, messageId);
    return;
  }

  // ---- status ----
  if (data === 'status') {
    const stats = await db.getFilterStats();
    const mem   = process.memoryUsage();
    const up    = process.uptime();
    const uh    = Math.floor(up / 3600);
    const um    = Math.floor((up % 3600) / 60);
    await bot.editMessageText(
      `📊 *Status Bot*\n\n` +
      `👑 Admins: *${getAdmins().length}*\n` +
      `🎯 Filters: *${stats.total}*\n` +
      `💾 Memory: *${(mem.heapUsed/1024/1024).toFixed(2)} MB*\n` +
      `⏱️ Uptime: *${uh}h ${um}m*\n\n` +
      `📦 *Breakdown:*\n` +
      `📝 Text: ${stats.text || 0}   🖼️ Photo: ${stats.photo || 0}\n` +
      `🎥 Video: ${stats.video || 0}   📄 Doc: ${stats.document || 0}\n` +
      `🎞️ GIF: ${stats.animation || 0}   🎵 Audio: ${stats.audio || 0}\n` +
      `🎤 Voice: ${stats.voice || 0}   🎨 Sticker: ${stats.sticker || 0}\n` +
      `${stats.oldest_name ? `\n📅 Filter tertua: \`${stats.oldest_name}\`` : ''}`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('main_menu') }
    ).catch(() => {});
    return;
  }

  // ---- analytics ----
  if (data === 'analytics') {
    const users = await db.getAllAnalytics();
    let text = `📊 *User Analytics*\n\n`;
    if (users.length === 0) {
      text += '_Belum ada user yang tercatat._';
    } else {
      text += `Total: *${users.length} user*\n\n`;
      users.slice(0, 20).forEach((u, i) => {
        const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'N/A';
        const last = new Date(Number(u.last_seen)).toLocaleString('id-ID');
        text += `${i + 1}. *${name}*\n   ID: \`${u.user_id}\` @${u.username || 'N/A'}\n   ${last} | ${u.attempt_count}x\n\n`;
      });
      if (users.length > 20) text += `_...dan ${users.length - 20} lainnya_`;
    }
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: kb.backKeyboard('main_menu')
    }).catch(() => {});
    return;
  }

  // ---- ai_stats ----
  if (data === 'ai_stats') {
    if (!AI_ENABLED) {
      await bot.editMessageText('⚠️ AI Hoki belum diaktifkan! Set GROQ_API_KEY di .env', {
        chat_id: chatId, message_id: messageId,
        reply_markup: kb.backKeyboard('main_menu')
      }).catch(() => {});
      return;
    }
    const stats = ai.getAIStats();
    const convs = ai.getAIConversations();
    const mText = AI_MODELS.map(m => {
      const ok = (m.rpmUsed < m.rpm && m.used < m.dailyLimit) ? '✅' : '❌';
      return `${ok} *T${m.tier}* \`${m.name}\`\n   RPM:${m.rpmUsed}/${m.rpm} Daily:${m.used}/${m.dailyLimit}`;
    }).join('\n\n');
    const sr = stats.totalRequests > 0 ? ((stats.successfulResponses / stats.totalRequests) * 100).toFixed(1) : '0.0';
    await bot.editMessageText(
      `🤖 *AI Hoki Stats*\n\n` +
      `📊 Req: ${stats.totalRequests} (✅${stats.successfulResponses} ❌${stats.failedResponses})\n` +
      `📈 Success rate: ${sr}%\n` +
      `💬 Active convs: ${convs.size}\n\n` +
      `🎯 *Models:*\n${mText}\n\n` +
      `🛡️ Guard: \`${GUARD_MODEL.name}\`\n` +
      `${isOwner(userId) ? '_Ketik !aireset untuk reset_' : ''}`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('main_menu') }
    ).catch(() => {});
    return;
  }

  // ---- notif_stats ----
  if (data === 'notif_stats') {
    await bot.editMessageText(
      `🔔 *Notification Stats*\n\n` +
      `👋 Welcomes Sent: ${notifStats.welcomesSent}\n` +
      `📊 Daily Stats Sent: ${notifStats.dailyStatsSent}\n` +
      `🚨 Alerts Sent: ${notifStats.alertsSent}\n\n` +
      `✅ System: Active`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('main_menu') }
    ).catch(() => {});
    return;
  }

  // ---- health (owner only) ----
  if (data === 'health') {
    if (!isOwner(userId)) return;
    const h = {
      status:    'healthy',
      uptime_s:  Math.floor(process.uptime()),
      memory_mb: parseFloat((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)),
      filters:   await db.getFilterCount(),
      admins:    getAdmins().length,
      ai_convs:  ai.getAIConversations().size,
      pending:   pendingActions.size
    };
    await bot.editMessageText(
      `\`\`\`json\n${JSON.stringify(h, null, 2)}\n\`\`\``,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('main_menu') }
    ).catch(() => {});
    return;
  }

  // ==========================================================
  // FILTER CALLBACKS
  // ==========================================================

  // ---- filter_add ----
  if (data === 'filter_add') {
    setPending(userId, 'add_filter');
    await bot.editMessageText(
      `➕ *Tambah Filter*\n\n` +
      `*Caranya:*\n` +
      `1️⃣ Pergi ke pesan yang mau dijadikan filter\n` +
      `2️⃣ Reply pesan tersebut\n` +
      `3️⃣ Ketik nama filter di reply kamu\n\n` +
      `_Contoh: reply ke foto promo → ketik_ \`promo\`\n\n` +
      `⏳ Tunggu 10 menit, action akan otomatis batal.`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

  // ---- filter_del ----
  if (data === 'filter_del') {
    setPending(userId, 'del_filter');
    await bot.editMessageText(
      `🗑️ *Hapus Filter*\n\nKetik nama filter yang mau dihapus:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

  // ---- filter_confirm_del:NAME ----
  if (data.startsWith('filter_confirm_del:')) {
    const name = data.split(':')[1];
    await db.deleteFilter(name);
    await bot.editMessageText(
      `✅ Filter *${name}* berhasil dihapus!`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('filter_menu') }
    ).catch(() => {});
    return;
  }

  // ---- filter_list_N ----
  if (data.startsWith('filter_list_')) {
    const page = parseInt(data.split('_')[2]) || 1;
    const { text, total, page: p } = await buildFilterListText(page);
    const kb2 = total > 0 ? kb.filterListKeyboard(p, total) : kb.backKeyboard('filter_menu');
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: kb2
    }).catch(() => {});
    return;
  }

  // ---- filter_search ----
  if (data === 'filter_search') {
    setPending(userId, 'search_filter');
    await bot.editMessageText(
      `🔍 *Cari Filter*\n\nKetik keyword pencarian:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

  // ---- filter_clone ----
  if (data === 'filter_clone') {
    setPending(userId, 'clone_filter');
    await bot.editMessageText(
      `📋 *Clone Filter*\n\nKetik: \`nama_asal nama_baru\`\n_Contoh:_ \`promo promo2\``,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

  // ---- filter_rename ----
  if (data === 'filter_rename') {
    setPending(userId, 'rename_filter');
    await bot.editMessageText(
      `✏️ *Rename Filter*\n\nKetik: \`nama_lama nama_baru\`\n_Contoh:_ \`promo promo_v2\``,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

  // ---- filter_export (owner only) ----
  if (data === 'filter_export') {
    if (!isOwner(userId)) {
      await bot.answerCallbackQuery(queryId, { text: '❌ Hanya owner!' }).catch(() => {});
      return;
    }
    await bot.answerCallbackQuery(queryId, { text: '⏳ Menyiapkan export...' }).catch(() => {});
    const rows = await db.getAllFilters();
    const buf  = Buffer.from(JSON.stringify({ exported_at: new Date().toISOString(), filter_count: rows.length, filters: rows }, null, 2));
    await bot.sendDocument(chatId, buf, {
      caption: `✅ *Backup Filters*\n\n📦 Total: ${rows.length} filters\n📅 ${new Date().toLocaleString('id-ID')}`,
      parse_mode: 'Markdown'
    }, { filename: `filters_backup_${Date.now()}.json`, contentType: 'application/json' });
    return;
  }
}

// ============================================================
// PENDING ACTION HANDLER (dipanggil dari message handler)
// ============================================================
async function handlePendingAction(bot, chatId, userId, msg, text, pending) {
  const { action } = pending;

  // ---- add_filter ----
  if (action === 'add_filter') {
    const filterName = text.trim().toLowerCase().replace(/^!/, '');

    if (!filterName || filterName.length < 2 || filterName.length > 50) {
      const r = await bot.sendMessage(chatId, '⚠️ Nama filter harus 2–50 karakter!', { reply_markup: cancelRow() });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    if (!/^\w+$/.test(filterName)) {
      const r = await bot.sendMessage(chatId, '⚠️ Nama filter hanya boleh huruf, angka, underscore!', { reply_markup: cancelRow() });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }

    const source = msg.reply_to_message;
    if (!source) {
      const r = await bot.sendMessage(chatId,
        `⚠️ Kamu harus *reply ke pesan sumber* yang mau dijadikan filter!\n` +
        `_Cara: pergi ke pesan yang mau disimpan, reply ke pesan itu, ketik nama filter._`,
        { parse_mode: 'Markdown', reply_markup: cancelRow() }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 8);
      return;
    }

    // Tolak jika user reply ke pesan bot sendiri (bukan source yang valid)
    if (source.from?.id === cachedBotId) {
      const r = await bot.sendMessage(chatId,
        `⚠️ Reply ke *pesan yang mau dijadikan filter*, bukan ke pesan bot!\n` +
        `Pergi ke pesan sumber, lalu reply ke sana dengan nama filter.`,
        { parse_mode: 'Markdown', reply_markup: cancelRow() }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 8);
      return;
    }

    const hasMedia = source.photo || source.video || source.document ||
                     source.animation || source.audio || source.voice || source.sticker;
    const hasText  = source.text?.trim() || source.caption?.trim();

    if (!hasMedia && !hasText) {
      const r = await bot.sendMessage(chatId, '⚠️ Pesan sumber harus ada teks atau media!', { reply_markup: cancelRow() });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    if (!checkRateLimit(userId)) {
      const r = await bot.sendMessage(chatId, '⚠️ Terlalu banyak request! Tunggu sebentar.');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    const filterData = {
      name:      filterName,
      text:      source.text || source.caption || '',
      photo:     source.photo      ? source.photo[source.photo.length - 1].file_id : null,
      video:     source.video      ? source.video.file_id      : null,
      document:  source.document   ? source.document.file_id   : null,
      animation: source.animation  ? source.animation.file_id  : null,
      audio:     source.audio      ? source.audio.file_id      : null,
      voice:     source.voice      ? source.voice.file_id      : null,
      sticker:   source.sticker    ? source.sticker.file_id    : null,
      created_by: userId
    };
    if (source.entities?.length)         filterData.entities         = source.entities;
    if (source.caption_entities?.length) filterData.caption_entities = source.caption_entities;
    if (source.reply_markup?.inline_keyboard) filterData.buttons     = source.reply_markup.inline_keyboard;

    await db.upsertFilter(filterData);
    pendingActions.delete(userId);

    const r = await bot.sendMessage(chatId,
      `✅ Filter *${filterName}* berhasil ditambahkan! 🚀`,
      { parse_mode: 'Markdown', reply_markup: kb.backKeyboard('filter_menu') }
    );
    autoDeleteMessage(bot, chatId, r.message_id, 5);
    return;
  }

  // ---- del_filter ----
  if (action === 'del_filter') {
    const filterName = text.trim().toLowerCase().replace(/^!/, '');
    if (!filterName) {
      const r = await bot.sendMessage(chatId, '⚠️ Ketik nama filter yang mau dihapus!', { reply_markup: cancelRow() });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    const exists = await db.filterExists(filterName);
    if (!exists) {
      const r = await bot.sendMessage(chatId, `⚠️ Filter *${filterName}* tidak ditemukan!`,
        { parse_mode: 'Markdown', reply_markup: cancelRow() }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    pendingActions.delete(userId);
    const r = await bot.sendMessage(chatId,
      `⚠️ Konfirmasi hapus filter *${filterName}*?`,
      { parse_mode: 'Markdown', reply_markup: kb.confirmDeleteKeyboard(filterName) }
    );
    autoDeleteMessage(bot, chatId, r.message_id, 60);
    return;
  }

  // ---- search_filter ----
  if (action === 'search_filter') {
    const term = text.trim().toLowerCase();
    if (!term) {
      const r = await bot.sendMessage(chatId, '⚠️ Ketik keyword pencarian!', { reply_markup: cancelRow() });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    const results = await db.searchFilters(term);
    pendingActions.delete(userId);
    if (results.length === 0) {
      const r = await bot.sendMessage(chatId, `🔍 Tidak ada filter yang cocok dengan *${term}*.`,
        { parse_mode: 'Markdown', reply_markup: kb.backKeyboard('filter_menu') }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    const listText = results.map((n, i) => `${i + 1}. \`!${n}\``).join('\n');
    const r = await bot.sendMessage(chatId,
      `🔍 *Hasil "${term}" (${results.length} filter):*\n\n${listText}`,
      { parse_mode: 'Markdown', reply_markup: kb.backKeyboard('filter_menu') }
    );
    autoDeleteMessage(bot, chatId, r.message_id, 15);
    return;
  }

  // ---- clone_filter ----
  if (action === 'clone_filter') {
    const parts = text.trim().split(/\s+/);
    if (parts.length !== 2) {
      const r = await bot.sendMessage(chatId, '⚠️ Format: `nama_asal nama_baru`',
        { parse_mode: 'Markdown', reply_markup: cancelRow() }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    const [src, dst] = parts.map(p => p.toLowerCase());
    const [srcOk, dstOk] = await Promise.all([db.filterExists(src), db.filterExists(dst)]);
    if (!srcOk) {
      const r = await bot.sendMessage(chatId, `⚠️ Filter *${src}* tidak ditemukan!`,
        { parse_mode: 'Markdown', reply_markup: cancelRow() }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    if (dstOk) {
      const r = await bot.sendMessage(chatId, `⚠️ Filter *${dst}* sudah ada! Pakai nama lain.`,
        { parse_mode: 'Markdown', reply_markup: cancelRow() }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    await db.cloneFilter(src, dst);
    pendingActions.delete(userId);
    const r = await bot.sendMessage(chatId,
      `✅ Filter *${src}* berhasil di-clone ke *${dst}*! 🎉`,
      { parse_mode: 'Markdown', reply_markup: kb.backKeyboard('filter_menu') }
    );
    autoDeleteMessage(bot, chatId, r.message_id, 5);
    return;
  }

  // ---- rename_filter ----
  if (action === 'rename_filter') {
    const parts = text.trim().split(/\s+/);
    if (parts.length !== 2) {
      const r = await bot.sendMessage(chatId, '⚠️ Format: `nama_lama nama_baru`',
        { parse_mode: 'Markdown', reply_markup: cancelRow() }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    const [oldN, newN] = parts.map(p => p.toLowerCase());
    const [oldOk, newOk] = await Promise.all([db.filterExists(oldN), db.filterExists(newN)]);
    if (!oldOk) {
      const r = await bot.sendMessage(chatId, `⚠️ Filter *${oldN}* tidak ditemukan!`,
        { parse_mode: 'Markdown', reply_markup: cancelRow() }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    if (newOk) {
      const r = await bot.sendMessage(chatId, `⚠️ Filter *${newN}* sudah ada! Pakai nama lain.`,
        { parse_mode: 'Markdown', reply_markup: cancelRow() }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    await db.renameFilter(oldN, newN);
    pendingActions.delete(userId);
    const r = await bot.sendMessage(chatId,
      `✅ Filter *${oldN}* berhasil di-rename ke *${newN}*! ✨`,
      { parse_mode: 'Markdown', reply_markup: kb.backKeyboard('filter_menu') }
    );
    autoDeleteMessage(bot, chatId, r.message_id, 5);
    return;
  }

  // Unknown action — clear dan ignore
  pendingActions.delete(userId);
}

// ============================================================
// DAILY STATS SCHEDULER
// ============================================================
function startDailyStats(bot) {
  const now  = new Date();
  const next = new Date();
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delay = next - now;
  console.log(`📊 Daily stats: ${next.toLocaleString('id-ID')}`);

  setTimeout(async () => {
    await sendDailyStats(bot);
    setInterval(() => sendDailyStats(bot), 24 * 60 * 60 * 1000);
  }, delay);
}

async function sendDailyStats(bot) {
  if (!OWNER_ID) return;
  try {
    const [filterCount, analyticsCount] = await Promise.all([
      db.getFilterCount().catch(() => 0),
      db.getAnalyticsCount().catch(() => 0)
    ]);
    const admins = getAdmins();
    const up     = process.uptime();
    const stats  = ai.getAIStats();
    const convs  = ai.getAIConversations();
    const sr     = stats.totalRequests > 0 ? ((stats.successfulResponses / stats.totalRequests) * 100).toFixed(1) : '0.0';

    await bot.sendMessage(OWNER_ID,
      `📊 *Daily Bot Stats*\n\n` +
      `📅 ${new Date().toLocaleDateString('id-ID')}\n\n` +
      `🎯 Filters: ${filterCount}\n` +
      `👥 Admins: ${admins.length}\n` +
      `📊 Users Tracked: ${analyticsCount}\n` +
      `⏱️ Uptime: ${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m\n\n` +
      `${AI_ENABLED ? `🤖 *AI:* ${stats.totalRequests} req | ${sr}% success | ${convs.size} convs\n\n` : ''}` +
      `🔔 Welcomes: ${notifStats.welcomesSent} | Alerts: ${notifStats.alertsSent}\n\n` +
      `✅ Bot Status: Online 🚀`,
      { parse_mode: 'Markdown' }
    );
    notifStats.dailyStatsSent++;
    console.log('📊 Daily stats sent');
  } catch (e) {
    console.error('❌ Daily stats failed:', e.message);
  }
}

module.exports = { setupHandlers, startDailyStats };
