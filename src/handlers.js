const path      = require('path');
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
// ============================================================
// pendingActions[userId] = { action: string, data: {} }
const pendingActions = new Map();

// ============================================================
// CACHED BOT ID (avoid calling bot.getMe() on every message)
// ============================================================
let cachedBotId = null;

// ============================================================
// NOTIFICATION STATS (shared ref)
// ============================================================
const notifStats = ai.notificationStats;

// ============================================================
// HELPER: send main menu
// ============================================================
async function sendMainMenu(bot, chatId, userId, editMessageId = null) {
  const text =
    `🤖 *Menu Utama*\n\n` +
    `Selamat datang! Pilih menu yang kamu butuhkan.`;
  const opts = {
    parse_mode: 'Markdown',
    reply_markup: kb.mainMenuKeyboard(userId)
  };
  if (editMessageId) {
    await bot.editMessageText(text, { chat_id: chatId, message_id: editMessageId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  } else {
    return bot.sendMessage(chatId, text, opts);
  }
}

// ============================================================
// HELPER: send filter menu
// ============================================================
async function sendFilterMenu(bot, chatId, userId, editMessageId = null) {
  const count = await db.getFilterCount();
  const text  = `🎯 *Filter Manager*\n\n📦 Total filter: *${count}*\n\nPilih aksi:`;
  const opts  = { parse_mode: 'Markdown', reply_markup: kb.filterMenuKeyboard(userId) };
  if (editMessageId) {
    await bot.editMessageText(text, { chat_id: chatId, message_id: editMessageId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  } else {
    return bot.sendMessage(chatId, text, opts);
  }
}

// ============================================================
// HELPER: prompt user (cancel any pending, set new pending)
// ============================================================
async function promptUser(bot, chatId, userId, action, promptText, backTarget = 'filter_menu') {
  pendingActions.set(userId, { action, data: {} });
  const msg = await bot.sendMessage(chatId, promptText, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '❌ Batal', callback_data: backTarget }]]
    }
  });
  autoDeleteMessage(bot, chatId, msg.message_id, 5);
}

// ============================================================
// HELPER: build filter list text
// ============================================================
async function buildFilterListText(page) {
  const names              = await db.getFilterNames();
  const { items, total, page: p } = createPagination(names, page, 15);
  const start              = (p - 1) * 15;
  const listText           = items.map((n, i) => `${start + i + 1}. \`!${n}\``).join('\n');
  return {
    text:  `🎯 *Daftar Filter (${names.length} total) — Halaman ${p}/${total}:*\n\n${listText}`,
    total, page: p, names
  };
}

// ============================================================
// HELPER: send filter for triggering
// ============================================================
async function sendFilter(bot, chatId, filter) {
  let replyMarkup = null;
  if (filter.buttons && filter.buttons.length > 0) {
    replyMarkup = {
      inline_keyboard: filter.buttons.map(row =>
        row.map(btn => ({
          text:          btn.text,
          url:           btn.url,
          callback_data: btn.callback_data
        }))
      )
    };
  }

  const entities         = filter.entities;
  const caption_entities = filter.caption_entities;
  const rawText          = filter.text || '';

  let formattedText    = rawText;
  let textParseMode    = null;
  if (entities && entities.length > 0) {
    formattedText = entitiesToHTML(rawText, entities);
    textParseMode = 'HTML';
  }

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

  const buildCaptionOpts = () => {
    const o = {};
    if (formattedCaption && formattedCaption.trim()) {
      o.caption    = formattedCaption;
      if (captionParseMode) o.parse_mode = captionParseMode;
    }
    if (replyMarkup) o.reply_markup = replyMarkup;
    return o;
  };

  if      (filter.photo)     await bot.sendPhoto    (chatId, filter.photo,     buildCaptionOpts());
  else if (filter.video)     await bot.sendVideo    (chatId, filter.video,     buildCaptionOpts());
  else if (filter.animation) await bot.sendAnimation(chatId, filter.animation, buildCaptionOpts());
  else if (filter.document)  await bot.sendDocument (chatId, filter.document,  buildCaptionOpts());
  else if (filter.audio)     await bot.sendAudio    (chatId, filter.audio,     buildCaptionOpts());
  else if (filter.voice)     await bot.sendVoice    (chatId, filter.voice,     buildCaptionOpts());
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
// HELPER: notify critical error to owner
// ============================================================
function notifyCriticalError(bot, errorMsg, context = {}) {
  if (!OWNER_ID) return;
  const alertMsg =
    `🚨 *Critical Error Alert*\n\n` +
    `⏰ Time: ${new Date().toLocaleString('id-ID')}\n` +
    `❌ Error: \`${errorMsg}\`\n` +
    `${context.chatId    ? `💬 Chat: ${context.chatId}\n`      : ''}` +
    `${context.userId    ? `👤 User: ${context.userId}\n`      : ''}` +
    `${context.filterName? `🎯 Filter: ${context.filterName}\n`: ''}`;
  bot.sendMessage(OWNER_ID, alertMsg, { parse_mode: 'Markdown' })
    .then(() => notifStats.alertsSent++)
    .catch(() => {});
}

// ============================================================
// SETUP ALL HANDLERS
// ============================================================
function setupHandlers(bot) {

  // ----------------------------------------------------------
  // Cache bot ID once
  // ----------------------------------------------------------
  bot.getMe().then(me => {
    cachedBotId = me.id;
    console.log(`🤖 Cached bot ID: ${cachedBotId} (@${me.username})`);
  });

  // ----------------------------------------------------------
  // /start
  // ----------------------------------------------------------
  bot.onText(/\/start/, async (msg) => {
    const chatId    = msg.chat.id;
    const userId    = msg.from.id;
    const firstName = msg.from.first_name || 'User';
    autoDeleteMessage(bot, chatId, msg.message_id, 1);

    if (!isAdmin(userId)) {
      await db.trackUserAccess(userId, msg.from.username, msg.from.first_name, msg.from.last_name);
      const r = await bot.sendMessage(chatId, '❌ Bot ini hanya untuk admin!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    // Send persistent reply keyboard first
    await bot.sendMessage(chatId,
      `👋 Halo *${firstName}*! Gunakan menu di bawah atau tombol di atas.`,
      { parse_mode: 'Markdown', reply_markup: kb.adminMenuKeyboard() }
    );

    // Then send main menu with inline keyboard
    await sendMainMenu(bot, chatId, userId);
  });

  // ----------------------------------------------------------
  // /help
  // ----------------------------------------------------------
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    autoDeleteMessage(bot, chatId, msg.message_id, 1);

    if (!isAdmin(userId)) {
      await db.trackUserAccess(userId, msg.from.username, msg.from.first_name, msg.from.last_name);
      const r = await bot.sendMessage(chatId, '❌ Bot ini hanya untuk admin!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    const helpText =
      `📖 *Panduan Bot*\n\n` +
      `🎯 *Filter Management* (via menu):\n` +
      `• ➕ Tambah Filter — reply ke pesan, ketik nama\n` +
      `• 🗑️ Hapus Filter — ketik nama filter\n` +
      `• 📋 Daftar Filter — lihat semua dengan pagination\n` +
      `• 🔍 Cari Filter — cari berdasarkan keyword\n` +
      `• 📋 Clone — duplikasi filter\n` +
      `• ✏️ Rename — ganti nama filter\n` +
      `${isOwner(userId) ? '• 💾 Export — backup semua filter (owner only)\n' : ''}` +
      `\n💡 *Cara pakai filter:*\n` +
      `Ketik \`!namafilter\` atau \`namafilter\`\n\n` +
      `${AI_ENABLED ? '🤖 *AI Hoki:*\n• Private chat: langsung chat\n• Group: reply ke pesan bot\n\n' : ''}` +
      `⏱️ *Timeout user:*\n` +
      `Reply ke pesan user → /timeout <menit>\n\n` +
      `📋 *Menu keyboard* di bawah untuk akses cepat!`;

    const r = await bot.sendMessage(chatId, helpText, {
      parse_mode: 'Markdown',
      reply_markup: kb.backKeyboard('main_menu')
    });
    autoDeleteMessage(bot, chatId, r.message_id, 10);
  });

  // ----------------------------------------------------------
  // /timeout (still kept as command — requires reply to user)
  // ----------------------------------------------------------
  bot.onText(/\/timeout(?:@\w+)?\s+(\d+)/, async (msg, match) => {
    const chatId  = msg.chat.id;
    const userId  = msg.from.id;
    const minutes = parseInt(match[1]);
    autoDeleteMessage(bot, chatId, msg.message_id, 3);

    if (!isAdmin(userId)) {
      await db.trackUserAccess(userId, msg.from.username, msg.from.first_name, msg.from.last_name);
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
      const r = await bot.sendMessage(chatId, '⚠️ Timeout harus 1–1440 menit!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    const targetId = msg.reply_to_message.from.id;
    if (targetId === OWNER_ID || isAdmin(targetId)) {
      const r = await bot.sendMessage(chatId, '❌ Tidak bisa timeout admin/owner!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    const until = Date.now() + minutes * 60 * 1000;
    await db.setSpamTimeout(targetId, until);

    const r = await bot.sendMessage(chatId,
      `⏱️ *User di-timeout!*\n👤 User ID: \`${targetId}\`\n⏰ Durasi: ${minutes} menit`,
      { parse_mode: 'Markdown' }
    );
    autoDeleteMessage(bot, chatId, r.message_id, 5);
  });

  // ----------------------------------------------------------
  // CALLBACK QUERY HANDLER (all inline button presses)
  // ----------------------------------------------------------
  bot.on('callback_query', async (query) => {
    const chatId    = query.message.chat.id;
    const messageId = query.message.message_id;
    const userId    = query.from.id;
    const data      = query.data;

    await bot.answerCallbackQuery(query.id).catch(() => {});

    if (!isAdmin(userId)) return;

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
      const stats  = await db.getFilterStats();
      const admins = getAdmins();
      const mem    = process.memoryUsage();
      const up     = process.uptime();
      const uh     = Math.floor(up / 3600);
      const um     = Math.floor((up % 3600) / 60);

      const text =
        `📊 *Status Bot*\n\n` +
        `👑 Total Admin: *${admins.length}*\n` +
        `🎯 Total Filter: *${stats.total}*\n` +
        `💾 Memory: *${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB*\n` +
        `⏱️ Uptime: *${uh}h ${um}m*\n\n` +
        `📦 *Breakdown Filter:*\n` +
        `📝 Text: ${stats.text}   🖼️ Photo: ${stats.photo}\n` +
        `🎥 Video: ${stats.video}  📄 Doc: ${stats.document}\n` +
        `🎞️ GIF: ${stats.animation}   🎵 Audio: ${stats.audio}\n` +
        `🎤 Voice: ${stats.voice}  🎨 Sticker: ${stats.sticker}\n` +
        `${stats.oldest_name ? `\n📅 Filter tertua: \`${stats.oldest_name}\`` : ''}`;

      await bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('main_menu')
      }).catch(() => {});
      return;
    }

    // ---- analytics ----
    if (data === 'analytics') {
      const users = await db.getAllAnalytics();
      if (users.length === 0) {
        await bot.editMessageText('📊 Belum ada user yang tercatat.', {
          chat_id: chatId, message_id: messageId,
          reply_markup: kb.backKeyboard('main_menu')
        }).catch(() => {});
        return;
      }

      let text = `📊 *User Analytics (${users.length} user)*\n\n`;
      users.slice(0, 20).forEach((u, i) => {
        const name = `${u.first_name || ''}${u.last_name ? ' ' + u.last_name : ''}`.trim() || 'N/A';
        const last = new Date(Number(u.last_seen)).toLocaleString('id-ID');
        text += `${i + 1}. *${name}*\n` +
                `   ID: \`${u.user_id}\` | @${u.username || 'N/A'}\n` +
                `   Terakhir: ${last} | ${u.attempt_count}x\n\n`;
      });
      if (users.length > 20) text += `_...dan ${users.length - 20} user lainnya_`;

      await bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'Markdown',
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
      const stats     = ai.getAIStats();
      const convs     = ai.getAIConversations();
      const modelText = AI_MODELS.map(m => {
        const ok = m.rpmUsed < m.rpm && m.used < m.dailyLimit ? '✅' : '❌';
        return `${ok} *Tier ${m.tier}* \`${m.name}\`\n   RPM:${m.rpmUsed}/${m.rpm} Daily:${m.used}/${m.dailyLimit}`;
      }).join('\n\n');

      const text =
        `🤖 *AI Hoki Stats*\n\n` +
        `📊 Requests: ${stats.totalRequests} (✅${stats.successfulResponses} ❌${stats.failedResponses})\n` +
        `💬 Active Convs: ${convs.size}\n\n` +
        `🎯 *Models:*\n${modelText}\n\n` +
        `🛡️ Guard: \`${GUARD_MODEL.name}\`\n` +
        `${isOwner(userId) ? '_Gunakan !aireset untuk reset stats_' : ''}`;

      await bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('main_menu')
      }).catch(() => {});
      return;
    }

    // ---- notif_stats ----
    if (data === 'notif_stats') {
      const text =
        `🔔 *Notification Stats*\n\n` +
        `👋 Welcomes Sent: ${notifStats.welcomesSent}\n` +
        `📊 Daily Stats Sent: ${notifStats.dailyStatsSent}\n` +
        `🚨 Alerts Sent: ${notifStats.alertsSent}\n\n` +
        `✅ System: Active`;

      await bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('main_menu')
      }).catch(() => {});
      return;
    }

    // ---- health (owner only) ----
    if (data === 'health') {
      if (!isOwner(userId)) return;
      const health = {
        status: 'healthy',
        uptime: Math.floor(process.uptime()),
        memory_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
        filters: await db.getFilterCount(),
        admins: getAdmins().length,
        ai_convs: ai.getAIConversations().size
      };
      await bot.editMessageText(`\`\`\`json\n${JSON.stringify(health, null, 2)}\n\`\`\``, {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('main_menu')
      }).catch(() => {});
      return;
    }

    // ========== FILTER ACTIONS ==========

    // ---- filter_add ----
    if (data === 'filter_add') {
      await bot.editMessageText(
        `➕ *Tambah Filter*\n\n` +
        `Reply ke pesan yang mau dijadikan filter, lalu ketik nama filternya.\n` +
        `_Contoh: reply ke gambar promo → ketik_ \`promo\``,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }
        }
      ).catch(() => {});
      pendingActions.set(userId, { action: 'add_filter', data: {} });
      return;
    }

    // ---- filter_del ----
    if (data === 'filter_del') {
      await bot.editMessageText(
        `🗑️ *Hapus Filter*\n\nKetik nama filter yang mau dihapus:`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }
        }
      ).catch(() => {});
      pendingActions.set(userId, { action: 'del_filter', data: {} });
      return;
    }

    // ---- filter_confirm_del:NAME ----
    if (data.startsWith('filter_confirm_del:')) {
      const filterName = data.split(':')[1];
      await db.deleteFilter(filterName);
      await bot.editMessageText(
        `✅ Filter *${filterName}* berhasil dihapus!`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
          reply_markup: kb.backKeyboard('filter_menu')
        }
      ).catch(() => {});
      return;
    }

    // ---- filter_list_N ----
    if (data.startsWith('filter_list_')) {
      const page = parseInt(data.split('_')[2]) || 1;
      const { text, total, page: p } = await buildFilterListText(page);
      await bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: kb.filterListKeyboard(p, total)
      }).catch(() => {});
      return;
    }

    // ---- filter_search ----
    if (data === 'filter_search') {
      await bot.editMessageText(
        `🔍 *Cari Filter*\n\nKetik keyword pencarian:`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }
        }
      ).catch(() => {});
      pendingActions.set(userId, { action: 'search_filter', data: {} });
      return;
    }

    // ---- filter_clone ----
    if (data === 'filter_clone') {
      await bot.editMessageText(
        `📋 *Clone Filter*\n\nKetik: \`nama_asal nama_baru\`\n_Contoh:_ \`promo promo2\``,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }
        }
      ).catch(() => {});
      pendingActions.set(userId, { action: 'clone_filter', data: {} });
      return;
    }

    // ---- filter_rename ----
    if (data === 'filter_rename') {
      await bot.editMessageText(
        `✏️ *Rename Filter*\n\nKetik: \`nama_lama nama_baru\`\n_Contoh:_ \`promo promo_v2\``,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }
        }
      ).catch(() => {});
      pendingActions.set(userId, { action: 'rename_filter', data: {} });
      return;
    }

    // ---- filter_export (owner only) ----
    if (data === 'filter_export') {
      if (!isOwner(userId)) return;
      await bot.answerCallbackQuery(query.id, { text: '⏳ Menyiapkan export...' }).catch(() => {});
      try {
        const rows       = await db.getAllFilters();
        const exportData = {
          exported_at:  new Date().toISOString(),
          filter_count: rows.length,
          filters:      rows
        };
        await bot.sendChatAction(chatId, 'upload_document');
        await bot.sendDocument(chatId, Buffer.from(JSON.stringify(exportData, null, 2)), {
          caption: `✅ *Backup Filters*\n\n📦 Total: ${rows.length} filters\n📅 ${new Date().toLocaleString('id-ID')}`,
          parse_mode: 'Markdown'
        }, { filename: `filters_backup_${Date.now()}.json`, contentType: 'application/json' });
      } catch (e) {
        console.error('Export error:', e);
        await bot.sendMessage(chatId, '❌ Gagal export filters!');
      }
      return;
    }
  });

  // ----------------------------------------------------------
  // MESSAGE HANDLER
  // Handles: reply keyboard shortcuts, pending actions,
  //          filter triggers, AI chat
  // ----------------------------------------------------------
  bot.on('message', async (msg) => {
    if (!msg.from) return;
    const chatId  = msg.chat.id;
    const userId  = msg.from.id;

    // Ignore non-text for most flows (media handled only for add_filter pending)
    const text    = msg.text || '';
    const isCmd   = text.startsWith('/');
    if (isCmd) return; // Slash commands handled by onText above

    // ---- Admin gate for most flows ----
    if (!isAdmin(userId)) {
      // Still track non-admins and handle filter triggers (silent reject)
      // But first check if message triggers a filter
      const potentialName = text.startsWith('!') ? text.substring(1).trim().toLowerCase() : text.trim().toLowerCase();
      const filter = potentialName ? await db.getFilter(potentialName).catch(() => null) : null;
      if (filter) {
        await db.trackUserAccess(userId, msg.from.username, msg.from.first_name, msg.from.last_name);
        console.log(`🚫 Non-admin ${userId} tried filter: ${potentialName}`);
      }
      return;
    }

    // ---- Timeout check ----
    if (await isTimedOut(userId)) {
      const rem = await getTimeoutRemaining(userId);
      const r   = await bot.sendMessage(chatId, `⏱️ Kamu masih timeout ${rem} detik lagi~`);
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    // ---- Reply keyboard shortcuts ----
    if (text === '📋 Menu Utama') {
      pendingActions.delete(userId);
      await sendMainMenu(bot, chatId, userId);
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      return;
    }
    if (text === '🎯 Filter') {
      pendingActions.delete(userId);
      await sendFilterMenu(bot, chatId, userId);
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      return;
    }
    if (text === '📊 Status') {
      const stats = await db.getFilterStats();
      const mem   = process.memoryUsage();
      const up    = process.uptime();
      const uh    = Math.floor(up / 3600);
      const um    = Math.floor((up % 3600) / 60);
      const r     = await bot.sendMessage(chatId,
        `📊 *Status Bot*\n\n🎯 Filters: *${stats.total}*\n💾 Memory: *${(mem.heapUsed/1024/1024).toFixed(2)} MB*\n⏱️ Uptime: *${uh}h ${um}m*`,
        { parse_mode: 'Markdown', reply_markup: kb.backKeyboard('main_menu') }
      );
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }

    // ========== PENDING ACTIONS HANDLER ==========
    const pending = pendingActions.get(userId);
    if (pending) {
      autoDeleteMessage(bot, chatId, msg.message_id, 3);

      // ---- add_filter: waiting for name (must be reply to source) ----
      if (pending.action === 'add_filter') {
        const filterName = text.trim().toLowerCase().replace(/^!/, '');

        if (!filterName || filterName.length < 2 || filterName.length > 50) {
          const r = await bot.sendMessage(chatId, '⚠️ Nama filter harus 2–50 karakter!',
            { reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          return;
        }

        if (!/^\w+$/.test(filterName)) {
          const r = await bot.sendMessage(chatId, '⚠️ Nama filter hanya boleh huruf, angka, underscore!',
            { reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          return;
        }

        const source = msg.reply_to_message;
        if (!source) {
          const r = await bot.sendMessage(chatId,
            `⚠️ Kamu harus *reply ke pesan* yang mau dijadikan filter!\nKetik nama filter sambil reply ke pesan sumber.`,
            { parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          return;
        }

        const hasMedia = source.photo || source.video || source.document ||
                         source.animation || source.audio || source.voice || source.sticker;
        const hasText  = (source.text?.trim()) || (source.caption?.trim());
        if (!hasMedia && !hasText) {
          const r = await bot.sendMessage(chatId, '⚠️ Pesan harus ada teks atau media!',
            { reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          return;
        }

        if (!checkRateLimit(userId)) {
          const r = await bot.sendMessage(chatId, '⚠️ Terlalu banyak request! Tunggu sebentar.');
          autoDeleteMessage(bot, chatId, r.message_id, 3);
          return;
        }

        const filterData = {
          name:       filterName,
          text:       source.text || source.caption || '',
          photo:      source.photo      ? source.photo[source.photo.length - 1].file_id : null,
          video:      source.video      ? source.video.file_id      : null,
          document:   source.document   ? source.document.file_id   : null,
          animation:  source.animation  ? source.animation.file_id  : null,
          audio:      source.audio      ? source.audio.file_id      : null,
          voice:      source.voice      ? source.voice.file_id      : null,
          sticker:    source.sticker    ? source.sticker.file_id    : null,
          created_by: userId
        };
        if (source.entities?.length)         filterData.entities         = source.entities;
        if (source.caption_entities?.length) filterData.caption_entities = source.caption_entities;
        if (source.reply_markup?.inline_keyboard) filterData.buttons      = source.reply_markup.inline_keyboard;

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
      if (pending.action === 'del_filter') {
        const filterName = text.trim().toLowerCase().replace(/^!/, '');
        const exists     = await db.filterExists(filterName);
        if (!exists) {
          const r = await bot.sendMessage(chatId, `⚠️ Filter *${filterName}* tidak ditemukan!`,
            { parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          return;
        }
        pendingActions.delete(userId);
        const r = await bot.sendMessage(chatId,
          `⚠️ Konfirmasi hapus filter *${filterName}*?`,
          { parse_mode: 'Markdown', reply_markup: kb.confirmDeleteKeyboard(filterName) }
        );
        autoDeleteMessage(bot, chatId, r.message_id, 30);
        return;
      }

      // ---- search_filter ----
      if (pending.action === 'search_filter') {
        const term    = text.trim().toLowerCase();
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
          `🔍 *Hasil pencarian "${term}" (${results.length}):*\n\n${listText}`,
          { parse_mode: 'Markdown', reply_markup: kb.backKeyboard('filter_menu') }
        );
        autoDeleteMessage(bot, chatId, r.message_id, 10);
        return;
      }

      // ---- clone_filter ----
      if (pending.action === 'clone_filter') {
        const parts = text.trim().split(/\s+/);
        if (parts.length !== 2) {
          const r = await bot.sendMessage(chatId, '⚠️ Format: `nama_asal nama_baru`',
            { parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          return;
        }
        const [src, dst] = parts.map(p => p.toLowerCase());
        const srcExists  = await db.filterExists(src);
        const dstExists  = await db.filterExists(dst);
        if (!srcExists) {
          const r = await bot.sendMessage(chatId, `⚠️ Filter *${src}* tidak ditemukan!`,
            { parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          return;
        }
        if (dstExists) {
          const r = await bot.sendMessage(chatId, `⚠️ Filter *${dst}* sudah ada! Pakai nama lain.`,
            { parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
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
      if (pending.action === 'rename_filter') {
        const parts = text.trim().split(/\s+/);
        if (parts.length !== 2) {
          const r = await bot.sendMessage(chatId, '⚠️ Format: `nama_lama nama_baru`',
            { parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          return;
        }
        const [oldN, newN] = parts.map(p => p.toLowerCase());
        const oldExists    = await db.filterExists(oldN);
        const newExists    = await db.filterExists(newN);
        if (!oldExists) {
          const r = await bot.sendMessage(chatId, `⚠️ Filter *${oldN}* tidak ditemukan!`,
            { parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          return;
        }
        if (newExists) {
          const r = await bot.sendMessage(chatId, `⚠️ Filter *${newN}* sudah ada! Pakai nama lain.`,
            { parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'filter_menu' }]] }}
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

      // ---- !aireset (owner only, via text in pending or direct) ----
      return; // Unknown pending action, ignore
    }

    // ========== FILTER TRIGGER ==========
    const potentialName = text.startsWith('!') ? text.substring(1).trim().toLowerCase() : text.trim().toLowerCase();
    // Only single-word triggers (no spaces), min 2 chars
    if (potentialName && potentialName.length >= 2 && !/\s/.test(potentialName)) {
      const filter = await db.getFilter(potentialName).catch(() => null);
      if (filter) {
        if (!checkRateLimit(userId)) {
          const r = await bot.sendMessage(chatId, '⚠️ Terlalu banyak request!');
          autoDeleteMessage(bot, chatId, r.message_id, 3);
          return;
        }
        autoDeleteMessage(bot, chatId, msg.message_id, 3);
        try {
          await sendFilter(bot, chatId, filter);
        } catch (err) {
          console.error('❌ Filter send error:', err.message, 'filter:', potentialName);
          const r = await bot.sendMessage(chatId, `⚠️ Error kirim filter *${potentialName}*: \`${err.message}\``,
            { parse_mode: 'Markdown' }
          );
          autoDeleteMessage(bot, chatId, r.message_id, 5);
          if (!isOwner(userId) && (err.code === 'EFATAL' || err.message.includes('parse'))) {
            notifyCriticalError(bot, err.message, { chatId, userId, filterName: potentialName });
          }
        }
        return;
      }
    }

    // ========== AI HOKI HANDLER ==========
    if (!AI_ENABLED) return;
    if (!msg.text)   return;

    const isPrivate = msg.chat.type === 'private';
    const isGroup   = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

    if (isGroup) {
      if (!cachedBotId) return;
      const isReplyToBot = msg.reply_to_message?.from?.id === cachedBotId;
      if (!isReplyToBot) return;
    }

    const userMsg = msg.text.trim();
    if (!userMsg || userMsg.length < 2) return;

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
      if (err.message.includes('rate limit') || err.message.includes('429')) {
        errMsg = 'Lagi banyak yang pakai AI nih~ Tunggu sebentar yaa 🙏';
      } else if (err.message.includes('rate limited')) {
        errMsg = err.message;
      }
      const r = await bot.sendMessage(chatId, errMsg, { reply_to_message_id: msg.message_id });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
    }
  });

  // ----------------------------------------------------------
  // NEW CHAT MEMBERS (welcome)
  // ----------------------------------------------------------
  bot.on('new_chat_members', async (msg) => {
    const chatId = msg.chat.id;
    for (const member of msg.new_chat_members) {
      if (member.is_bot) continue;
      const name = member.first_name || 'User';
      try {
        await bot.sendMessage(chatId,
          `👋 Selamat datang *${name}*!\n\n` +
          `🤖 Gua bot filter management.\n` +
          `${AI_ENABLED ? '💬 Chat sama gua dengan reply ke pesan gua!\n' : ''}` +
          `Enjoy! 🚀`,
          { parse_mode: 'Markdown' }
        );
        notifStats.welcomesSent++;
      } catch (e) {
        console.error('❌ Welcome message failed:', e.message);
      }
    }
  });

  // ----------------------------------------------------------
  // !aireset (owner only, text command)
  // ----------------------------------------------------------
  bot.onText(/^!aireset$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    autoDeleteMessage(bot, chatId, msg.message_id, 3);
    if (!isOwner(userId)) return;
    ai.resetAIStats();
    const r = await bot.sendMessage(chatId, '✅ AI stats & conversations berhasil di-reset!');
    autoDeleteMessage(bot, chatId, r.message_id, 5);
  });

  // ----------------------------------------------------------
  // POLLING ERROR
  // ----------------------------------------------------------
  let pollingErrorCount = 0;
  let lastErrorTime     = 0;
  const MAX_RETRIES     = 10;

  bot.on('polling_error', (error) => {
    const now = Date.now();
    console.error('⚠️ Polling error:', error.code, error.message);
    if (now - lastErrorTime > 120000) pollingErrorCount = 0;
    lastErrorTime = now;
    pollingErrorCount++;

    const isNet = ['EFATAL','ETELEGRAM','ETIMEDOUT'].includes(error.code)
               || error.message.includes('getUpdates');

    if (pollingErrorCount >= MAX_RETRIES && !isNet) {
      console.error('❌ Max retries reached — check BOT_TOKEN');
      process.exit(1);
    }

    const delay = Math.min(5000 * Math.min(pollingErrorCount, 6), 30000);
    console.log(`🔄 Retry ${pollingErrorCount}/${MAX_RETRIES} in ${delay/1000}s...`);
    setTimeout(() => {
      bot.stopPolling().then(() => bot.startPolling({ restart: true })).catch(() => {});
    }, delay);
  });
}

// ----------------------------------------------------------
// DAILY STATS SCHEDULER
// ----------------------------------------------------------
function startDailyStats(bot) {
  const now       = new Date();
  const scheduled = new Date();
  scheduled.setHours(9, 0, 0, 0);
  if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 1);

  const delay = scheduled - now;
  console.log(`📊 Daily stats dijadwalkan: ${scheduled.toLocaleString('id-ID')}`);

  setTimeout(async () => {
    await sendDailyStats(bot);
    setInterval(() => sendDailyStats(bot), 24 * 60 * 60 * 1000);
  }, delay);
}

async function sendDailyStats(bot) {
  if (!OWNER_ID) return;
  const filterCount    = await db.getFilterCount().catch(() => 0);
  const analyticsCount = await db.getAnalyticsCount().catch(() => 0);
  const admins         = getAdmins();
  const up             = process.uptime();
  const stats          = ai.getAIStats();
  const convs          = ai.getAIConversations();

  const text =
    `📊 *Daily Bot Stats*\n\n` +
    `📅 ${new Date().toLocaleDateString('id-ID')}\n\n` +
    `🎯 Filters: ${filterCount}\n` +
    `👥 Admins: ${admins.length}\n` +
    `📊 Users Tracked: ${analyticsCount}\n` +
    `⏱️ Uptime: ${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m\n\n` +
    `${AI_ENABLED
      ? `🤖 *AI Stats:*\nRequests: ${stats.totalRequests}\nSuccess: ${stats.totalRequests>0?((stats.successfulResponses/stats.totalRequests)*100).toFixed(1):0}%\nConvs: ${convs.size}\n\n`
      : ''}` +
    `🔔 *Notif:*\nWelcomes: ${notifStats.welcomesSent} | Alerts: ${notifStats.alertsSent}\n\n` +
    `✅ Bot Status: Online 🚀`;

  try {
    await bot.sendMessage(OWNER_ID, text, { parse_mode: 'Markdown' });
    notifStats.dailyStatsSent++;
  } catch (e) {
    console.error('❌ Daily stats failed:', e.message);
  }
}

module.exports = { setupHandlers, startDailyStats };
