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
// TRANSLATE HELPERS — MyMemory API, bebas key, semua user
// ============================================================
async function translateText(text, fromLang, toLang) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('Translation API error');
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(data.responseDetails || 'Translation failed');
  return data.responseData.translatedText;
}

function detectTranslateLang(text) {
  const idWords = ['apa','yang','ini','itu','dan','atau','saya','kamu','dengan','untuk',
                   'dari','ke','di','ya','tidak','bisa','akan','sudah','juga','gue','lo','aku'];
  const lc    = text.toLowerCase().split(/\s+/);
  const idCnt = idWords.filter(w => lc.includes(w)).length;
  return idCnt >= 2 ? 'id' : 'en';
}

async function handleTranslate(bot, chatId, userId, msg, text) {
  const inputText = text.trim();
  if (!inputText || inputText.length < 2) {
    const r = await bot.sendMessage(chatId, '⚠️ Teks terlalu pendek! Minimal 2 karakter ya.');
    autoDeleteMessage(bot, chatId, r.message_id, 5);
    return;
  }
  if (inputText.length > 500) {
    const r = await bot.sendMessage(chatId, '⚠️ Maksimal 500 karakter per terjemahan!');
    autoDeleteMessage(bot, chatId, r.message_id, 5);
    return;
  }

  pendingActions.delete(userId);

  try {
    await bot.sendChatAction(chatId, 'typing');
    const detectedLang = detectTranslateLang(inputText);
    const toLang       = detectedLang === 'id' ? 'en' : 'id';
    const toLangLabel  = toLang === 'id' ? '🇮🇩 Indonesia' : '🇬🇧 English';

    const translated = await translateText(inputText, detectedLang, toLang);

    const preview = inputText.length > 60 ? inputText.substring(0, 60) + '…' : inputText;
    const r = await bot.sendMessage(chatId,
      `🌐 *Hasil → ${toLangLabel}*\n\n${translated}\n\n_Teks asli: ${preview}_`,
      {
        parse_mode: 'Markdown',
        reply_to_message_id: msg?.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: '🔄 Translate Lagi', callback_data: 'translate_menu' }]]
        }
      }
    );
    autoDeleteMessage(bot, chatId, r.message_id, 30);
  } catch (err) {
    console.error('❌ Translate error:', err.message);
    const r = await bot.sendMessage(chatId,
      `❌ Gagal menerjemahkan.\n_${err.message.substring(0, 80)}_`,
      { parse_mode: 'Markdown' }
    );
    autoDeleteMessage(bot, chatId, r.message_id, 8);
  }
}

// ============================================================
// PENDING ACTIONS — multi-step flows
// TTL 10 menit, auto-cleanup setiap 5 menit
// ============================================================
const pendingActions = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [uid, p] of pendingActions.entries()) {
    if (p.expiresAt && now > p.expiresAt) pendingActions.delete(uid);
  }
}, 5 * 60 * 1000);

function setPending(userId, action, data = {}) {
  pendingActions.set(userId, { action, data, expiresAt: Date.now() + PENDING_TTL_MS });
}

// ============================================================
// CACHED BOT ID — satu kali saat startup
// ============================================================
let cachedBotId = null;

// ============================================================
// RESERVED BANG WORDS — tidak diteruskan ke AI / filter
// (user mengetik !kata, bot diam saja, tidak proses)
// ============================================================
const RESERVED_BANG = new Set([
  'aireset','aistats','health','notifstats','status','export',
  'list','add','del','info','search','clone','rename','timeout','help'
]);

// ============================================================
// NOTIF STATS (shared dengan ai.js)
// ============================================================
const notifStats = ai.notificationStats;

// ============================================================
// HELPERS
// ============================================================

async function sendMainMenu(bot, chatId, userId, editMsgId = null) {
  const text = `🤖 *Menu Utama*\n\nSelamat datang! Pilih menu di bawah.`;
  const opts = { parse_mode: 'Markdown', reply_markup: kb.mainMenuKeyboard(userId) };
  if (editMsgId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: editMsgId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

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

async function sendAdminTools(bot, chatId, userId, editMsgId = null) {
  const text = `⚙️ *Admin Tools*\n\nAksi admin tersedia di bawah:`;
  const opts = { parse_mode: 'Markdown', reply_markup: kb.adminToolsKeyboard() };
  if (editMsgId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: editMsgId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

async function sendBantuan(bot, chatId, userId, editMsgId = null) {
  const help =
    `📖 *Panduan Bot*\n\n` +
    `*📱 Menu Keyboard (bawah chat):*\n` +
    `• 📋 Menu Utama — lihat semua menu\n` +
    `• 🎯 Filter — kelola filter\n` +
    `• 📊 Status — info bot\n` +
    `• ⚙️ Tools — admin tools (timeout, analytics)\n` +
    `• 🤖 Chat AI — sesi chat dengan AI Hoki\n` +
    `• 🌐 Translate — terjemahkan teks (semua user)\n` +
    `• ❓ Bantuan — panduan ini\n\n` +
    `*🎯 Filter Management (admin only):*\n` +
    `• ➕ Tambah — reply ke pesan sumber, ketik nama\n` +
    `• 🗑️ Hapus — ketik nama filter\n` +
    `• 📋 Daftar — pagination 15/halaman\n` +
    `• 🔍 Cari — keyword search\n` +
    `• 📋 Clone — ketik: \`asal tujuan\`\n` +
    `• ✏️ Rename — ketik: \`lama baru\`\n\n` +
    `*💡 Cara trigger filter:*\n` +
    `Ketik \`!namafilter\` atau \`namafilter\`\n\n` +
    `*🌐 Translate:*\n` +
    `• Tekan 🌐 Translate → kirim teks\n` +
    `• Auto-detect bahasa (Indonesia ↔ English)\n` +
    `• Tersedia untuk semua user\n\n` +
    `*⏱️ Timeout user:*\n` +
    `⚙️ Tools → ⏱️ Timeout User → ketik \`ID MENIT\`\n` +
    `atau reply ke pesan user, ketik MENIT\n\n` +
    `${AI_ENABLED ? '*🤖 AI Hoki:*\n• Tekan 🤖 Chat AI → ketik pertanyaan\n• Sesi aktif hingga tekan tombol lain\n• Group: reply ke pesan bot\n\n' : ''}` +
    `${isOwner(userId) ? '*👑 Owner Panel:*\n♻️ Reset AI | ⚙️ Health | 💾 Export\n\n' : ''}` +
    `_Semua aksi via tombol — tidak perlu command!_`;

  const opts = {
    parse_mode: 'Markdown',
    reply_markup: kb.backKeyboard('main_menu')
  };
  if (editMsgId) {
    return bot.editMessageText(help, { chat_id: chatId, message_id: editMsgId, ...opts })
      .catch(() => bot.sendMessage(chatId, help, opts));
  }
  const r = await bot.sendMessage(chatId, help, opts);
  autoDeleteMessage(bot, chatId, r.message_id, 15);
  return r;
}

async function buildFilterListText(page) {
  const names = await db.getFilterNames();
  if (names.length === 0) {
    return { text: '📭 Belum ada filter. Tambah via tombol ➕.', total: 0, page: 1 };
  }
  const { items, total, page: p } = createPagination(names, page, 15);
  const start    = (p - 1) * 15;
  const listText = items.map((n, i) => `${start + i + 1}. \`!${n}\``).join('\n');
  return {
    text: `🎯 *Daftar Filter (${names.length} total) — Halaman ${p}/${total}:*\n\n${listText}`,
    total, page: p
  };
}

async function sendFilter(bot, chatId, filter) {
  let replyMarkup = null;
  if (filter.buttons && filter.buttons.length > 0) {
    replyMarkup = {
      inline_keyboard: filter.buttons.map(row =>
        row.map(btn => ({
          text:          btn.text,
          url:           btn.url           || undefined,
          callback_data: btn.callback_data || undefined
        }))
      )
    };
  }

  const entities         = filter.entities;
  const caption_entities = filter.caption_entities;
  const rawText          = filter.text || '';

  let formattedText  = rawText;
  let textParseMode  = null;
  if (entities && entities.length > 0) {
    formattedText = entitiesToHTML(rawText, entities);
    textParseMode = 'HTML';
  }

  let formattedCaption = rawText;
  let captionParseMode = null;
  if (rawText.trim().length > 0) {
    const ent = caption_entities?.length ? caption_entities : entities;
    if (ent && ent.length > 0) {
      formattedCaption = entitiesToHTML(rawText, ent);
      captionParseMode = 'HTML';
    }
  }

  const captionOpts = () => {
    const o = {};
    if (formattedCaption?.trim()) {
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
    const stickerOpts = {};
    if (replyMarkup && !formattedText?.trim()) stickerOpts.reply_markup = replyMarkup;
    await bot.sendSticker(chatId, filter.sticker, stickerOpts);
    if (formattedText?.trim()) {
      const o = {};
      if (textParseMode) o.parse_mode = textParseMode;
      if (replyMarkup)   o.reply_markup = replyMarkup;
      await bot.sendMessage(chatId, formattedText, o);
    }
  } else if (formattedText?.trim()) {
    const o = {};
    if (textParseMode) o.parse_mode = textParseMode;
    if (replyMarkup)   o.reply_markup = replyMarkup;
    await bot.sendMessage(chatId, formattedText, o);
  }
}

function notifyCriticalError(bot, errorMsg, context = {}) {
  if (!OWNER_ID) return;
  bot.sendMessage(OWNER_ID,
    `🚨 *Critical Error*\n\n` +
    `⏰ ${new Date().toLocaleString('id-ID')}\n` +
    `❌ \`${String(errorMsg).substring(0, 200)}\`\n` +
    `${context.chatId     ? `💬 Chat: ${context.chatId}\n`     : ''}` +
    `${context.userId     ? `👤 User: ${context.userId}\n`     : ''}` +
    `${context.filterName ? `🎯 Filter: ${context.filterName}` : ''}`,
    { parse_mode: 'Markdown' }
  ).then(() => notifStats.alertsSent++).catch(() => {});
}

function cancelRow(target = 'filter_menu') {
  return { inline_keyboard: [[{ text: '❌ Batal', callback_data: target }]] };
}

// ============================================================
// SETUP ALL HANDLERS
// ============================================================
function setupHandlers(bot) {

  // Cache bot ID satu kali saat startup
  bot.getMe().then(me => {
    cachedBotId = me.id;
    console.log(`✅ Cached bot ID: ${cachedBotId} (@${me.username})`);
  }).catch(err => console.error('❌ getMe failed:', err.message));

  // ==========================================================
  // /start — SATU-SATUNYA slash command
  // Diperlukan Telegram untuk init bot di private chat
  // ==========================================================
  bot.onText(/\/start/, async (msg) => {
    const chatId    = msg.chat.id;
    const userId    = msg.from.id;
    const firstName = msg.from.first_name || 'User';
    autoDeleteMessage(bot, chatId, msg.message_id, 1);

    if (!isAdmin(userId)) {
      await db.trackUserAccess(userId, msg.from.username, msg.from.first_name, msg.from.last_name)
        .catch(() => {});
      const r = await bot.sendMessage(chatId,
        `❌ Bot ini hanya untuk admin!\n\n🌐 Kamu tetap bisa pakai fitur *Translate*:`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🌐 Translate', callback_data: 'translate_menu' }]] }
        }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 30);
      return;
    }

    // Kirim persistent reply keyboard (menu di bawah chat)
    await bot.sendMessage(chatId,
      `👋 Halo *${firstName}*!\n\nMenu keyboard aktif di bawah. Semua fitur bisa diakses tanpa command! 🚀`,
      { parse_mode: 'Markdown', reply_markup: kb.adminMenuKeyboard() }
    );
    await sendMainMenu(bot, chatId, userId);
  });

  // ==========================================================
  // CALLBACK QUERY — semua inline button
  // Dibungkus try/catch global agar error tidak crash bot
  // ==========================================================
  bot.on('callback_query', async (query) => {
    const chatId    = query.message.chat.id;
    const messageId = query.message.message_id;
    const userId    = query.from.id;
    const data      = query.data;

    // Export dan filter_export jawab sendiri dengan custom text
    if (data !== 'filter_export') {
      await bot.answerCallbackQuery(query.id).catch(() => {});
    }

    // translate_menu & translate_cancel — terbuka untuk SEMUA user
    if (data === 'translate_menu') {
      setPending(userId, 'translate');
      await bot.editMessageText(
        `🌐 *Translate*\n\nKirim teks yang mau diterjemahkan:\n_Auto-detect: Indonesia ↔ English · Maks 500 karakter_`,
        {
          chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'translate_cancel' }]] }
        }
      ).catch(() => {});
      return;
    }
    if (data === 'translate_cancel') {
      pendingActions.delete(userId);
      await bot.editMessageText('❌ Translate dibatalkan.',
        { chat_id: chatId, message_id: messageId }
      ).catch(() => bot.sendMessage(chatId, '❌ Dibatalkan.').catch(() => {}));
      return;
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
  // MESSAGE HANDLER — shortcut menu keyboard + pending + filter + AI
  // ==========================================================
  bot.on('message', async (msg) => {
    if (!msg.from) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text   = msg.text || '';

    // Slash commands ditangani oleh onText di atas
    if (text.startsWith('/')) return;

    // Pending translate — SEMUA user bisa, sebelum admin gate
    {
      const pendingT = pendingActions.get(userId);
      if (pendingT?.action === 'translate') {
        if (!pendingT.expiresAt || Date.now() <= pendingT.expiresAt) {
          autoDeleteMessage(bot, chatId, msg.message_id, 3);
          await handleTranslate(bot, chatId, userId, msg, text);
          return;
        }
        pendingActions.delete(userId);
      }
    }

    // Skip reserved bang words (jangan proses sebagai AI/filter)
    if (text.startsWith('!')) {
      const cmd = text.substring(1).split(/\s+/)[0].toLowerCase();
      if (RESERVED_BANG.has(cmd)) return;
    }

    // Gate non-admin — track dan silent reject
    if (!isAdmin(userId)) {
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

    // Timeout check
    if (await isTimedOut(userId)) {
      const rem = await getTimeoutRemaining(userId);
      const r   = await bot.sendMessage(chatId, `⏱️ Kamu masih timeout ${rem} detik lagi~`);
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }

    // ---- Menu Keyboard Shortcuts ----
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
        `💾 Memory: *${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB*\n` +
        `⏱️ Uptime: *${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m*`,
        { parse_mode: 'Markdown', reply_markup: kb.backKeyboard('main_menu') }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 10);
      return;
    }
    if (text === '⚙️ Tools') {
      pendingActions.delete(userId);
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      await sendAdminTools(bot, chatId, userId);
      return;
    }
    if (text === '❓ Bantuan') {
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      await sendBantuan(bot, chatId, userId);
      return;
    }
    if (text === '🤖 Chat AI') {
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      if (!AI_ENABLED) {
        const r = await bot.sendMessage(chatId, '⚠️ AI Hoki belum aktif. Set GROQ_API_KEY dulu ya!');
        autoDeleteMessage(bot, chatId, r.message_id, 5);
        return;
      }
      setPending(userId, 'chat_ai');
      await bot.sendMessage(chatId,
        `🤖 *Sesi Chat AI Aktif!*\n\nKetik pertanyaanmu sekarang.\n_Tekan tombol menu lain untuk keluar._`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    if (text === '🌐 Translate') {
      pendingActions.delete(userId);
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      setPending(userId, 'translate');
      await bot.sendMessage(chatId,
        `🌐 *Translate*\n\nKirim teks yang mau diterjemahkan:\n_Auto-detect: Indonesia ↔ English · Maks 500 karakter_`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'translate_cancel' }]] }
        }
      );
      return;
    }

    // ---- Pending Actions ----
    const pending = pendingActions.get(userId);
    if (pending) {
      if (pending.expiresAt && Date.now() > pending.expiresAt) {
        pendingActions.delete(userId);
      } else {
        autoDeleteMessage(bot, chatId, msg.message_id, 3);
        await handlePendingAction(bot, chatId, userId, msg, text, pending);
        return;
      }
    }

    // ---- Filter Trigger ----
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

    // ---- AI Hoki (Group only: reply ke pesan bot) ----
    // Private chat: pakai tombol 🤖 Chat AI dari menu (pending chat_ai)
    if (!AI_ENABLED || !msg.text) return;
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    if (!cachedBotId) return;
    if (msg.reply_to_message?.from?.id !== cachedBotId) return;

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

    const isNet = ['EFATAL', 'ETELEGRAM', 'ETIMEDOUT'].includes(error.code)
               || error.message.includes('getUpdates');

    if (pollingErrCount >= 10 && !isNet) {
      console.error('❌ Max retries — check BOT_TOKEN');
      process.exit(1);
    }

    const delay = Math.min(5000 * Math.min(pollingErrCount, 6), 30000);
    console.log(`🔄 Retry ${pollingErrCount}/10 in ${delay / 1000}s...`);
    setTimeout(() => {
      bot.stopPolling().then(() => bot.startPolling({ restart: true })).catch(() => {});
    }, delay);
  });
}

// ============================================================
// CALLBACK HANDLER
// Semua inline keyboard callback diproses di sini
// ============================================================
async function handleCallback(bot, chatId, messageId, userId, queryId, data) {

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

  // ---- admin_tools ----
  if (data === 'admin_tools') {
    pendingActions.delete(userId);
    await sendAdminTools(bot, chatId, userId, messageId);
    return;
  }

  // ---- bantuan ----
  if (data === 'bantuan') {
    await sendBantuan(bot, chatId, userId, messageId);
    return;
  }

  // ---- owner_panel (owner only) ----
  if (data === 'owner_panel') {
    if (!isOwner(userId)) return;
    await bot.editMessageText(
      `👑 *Owner Panel*\n\nAkses eksklusif owner:\n` +
      `• ♻️ Reset AI — reset semua stats & konversasi\n` +
      `• ⚙️ Health Check — info detail sistem\n` +
      `• 💾 Export Filters — backup semua filter`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.ownerPanelKeyboard() }
    ).catch(() => {});
    return;
  }

  // ---- status ----
  if (data === 'status') {
    const stats = await db.getFilterStats();
    const mem   = process.memoryUsage();
    const up    = process.uptime();
    await bot.editMessageText(
      `📊 *Status Bot*\n\n` +
      `👑 Admins: *${getAdmins().length}*\n` +
      `🎯 Total Filter: *${stats.total}*\n` +
      `💾 Memory: *${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB*\n` +
      `⏱️ Uptime: *${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m*\n\n` +
      `📦 *Breakdown Filter:*\n` +
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
    let text = `📈 *User Analytics*\n\n`;
    if (users.length === 0) {
      text += '_Belum ada user yang tercatat._';
    } else {
      text += `Total: *${users.length} user*\n\n`;
      users.slice(0, 15).forEach((u, i) => {
        const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'N/A';
        const last = new Date(Number(u.last_seen)).toLocaleString('id-ID');
        text += `${i + 1}. *${name}*\n   \`${u.user_id}\` @${u.username || 'N/A'}\n   ${last} | ${u.attempt_count}x\n\n`;
      });
      if (users.length > 15) text += `_...dan ${users.length - 15} lainnya_`;
    }
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: kb.backKeyboard('admin_tools')
    }).catch(() => {});
    return;
  }

  // ---- notif_stats ----
  if (data === 'notif_stats') {
    await bot.editMessageText(
      `🔔 *Notification Stats*\n\n` +
      `👋 Welcomes: ${notifStats.welcomesSent}\n` +
      `📊 Daily Stats: ${notifStats.dailyStatsSent}\n` +
      `🚨 Alerts: ${notifStats.alertsSent}`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('admin_tools') }
    ).catch(() => {});
    return;
  }

  // ---- ai_stats ----
  if (data === 'ai_stats') {
    if (!AI_ENABLED) {
      await bot.editMessageText(
        `⚠️ *AI Hoki Belum Aktif*\n\n` +
        `Set \`GROQ_API_KEY\` di environment secrets untuk mengaktifkan AI.`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
          reply_markup: kb.backKeyboard('main_menu') }
      ).catch(() => {});
      return;
    }
    const stats = ai.getAIStats();
    const convs = ai.getAIConversations();
    const mText = AI_MODELS.map(m => {
      const ok = (m.rpmUsed < m.rpm && m.used < m.dailyLimit) ? '✅' : '❌';
      return `${ok} *T${m.tier}* \`${m.name}\`\n   RPM: ${m.rpmUsed}/${m.rpm} | Daily: ${m.used}/${m.dailyLimit}`;
    }).join('\n\n');
    const sr = stats.totalRequests > 0 ? ((stats.successfulResponses / stats.totalRequests) * 100).toFixed(1) : '0.0';
    const backTarget = isOwner(userId) ? 'owner_panel' : 'main_menu';
    await bot.editMessageText(
      `🤖 *AI Hoki Stats*\n\n` +
      `📊 Total Req: ${stats.totalRequests}\n` +
      `✅ Success: ${stats.successfulResponses} (${sr}%)\n` +
      `❌ Failed: ${stats.failedResponses}\n` +
      `💬 Active Convs: ${convs.size}\n\n` +
      `*Models:*\n${mText}\n\n` +
      `🛡️ Guard: \`${GUARD_MODEL.name}\``,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard(backTarget) }
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
      pending_actions: pendingActions.size
    };
    await bot.editMessageText(
      `⚙️ *Health Check*\n\n\`\`\`json\n${JSON.stringify(h, null, 2)}\n\`\`\``,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('owner_panel') }
    ).catch(() => {});
    return;
  }

  // ---- reset_ai (owner only, minta konfirmasi) ----
  if (data === 'reset_ai') {
    if (!isOwner(userId)) return;
    await bot.editMessageText(
      `♻️ *Reset AI Stats*\n\n` +
      `Ini akan:\n` +
      `• Reset semua model counters (RPM + Daily)\n` +
      `• Hapus semua riwayat percakapan\n` +
      `• Reset rate limits\n\n` +
      `Yakin mau reset sekarang?`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.resetAiConfirmKeyboard() }
    ).catch(() => {});
    return;
  }

  // ---- reset_ai_confirm (owner only) ----
  if (data === 'reset_ai_confirm') {
    if (!isOwner(userId)) return;
    ai.resetAIStats();
    await bot.editMessageText(
      `✅ *AI Stats Berhasil Di-reset!*\n\n` +
      `• Semua model counters: 0\n` +
      `• Riwayat percakapan: dihapus\n` +
      `• Rate limits: clear`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('owner_panel') }
    ).catch(() => {});
    return;
  }

  // ---- timeout_user (set pending) ----
  if (data === 'timeout_user') {
    setPending(userId, 'timeout_user');
    await bot.editMessageText(
      `⏱️ *Timeout User*\n\n` +
      `Ada 2 cara:\n\n` +
      `*Cara 1 — langsung ketik ID:*\n` +
      `\`USER_ID DURASI_MENIT\`\n` +
      `_Contoh: \`123456789 30\` → timeout 30 menit_\n\n` +
      `*Cara 2 — reply ke pesan user:*\n` +
      `Reply ke pesan user, lalu ketik angka menit saja\n` +
      `_Contoh: reply ke pesan user → ketik \`30\`_\n\n` +
      `⏳ Action batal otomatis dalam 10 menit`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow('admin_tools') }
    ).catch(() => {});
    return;
  }

  // ---- timeout_confirm:ID:MENIT ----
  if (data.startsWith('timeout_confirm:')) {
    const parts    = data.split(':');
    const targetId = parseInt(parts[1]);
    const minutes  = parseInt(parts[2]);
    if (!targetId || !minutes) return;

    if (isAdmin(targetId)) {
      await bot.editMessageText('❌ Tidak bisa timeout admin/owner!',
        { chat_id: chatId, message_id: messageId, reply_markup: kb.backKeyboard('admin_tools') }
      ).catch(() => {});
      return;
    }

    await db.setSpamTimeout(targetId, Date.now() + minutes * 60 * 1000);
    await bot.editMessageText(
      `✅ *User Di-timeout!*\n\n` +
      `👤 User ID: \`${targetId}\`\n` +
      `⏰ Durasi: *${minutes} menit*\n` +
      `🕐 Berakhir: ${new Date(Date.now() + minutes * 60 * 1000).toLocaleString('id-ID')}`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('admin_tools') }
    ).catch(() => {});
    return;
  }

  // ==========================================================
  // FILTER CALLBACKS
  // ==========================================================

  if (data === 'filter_add') {
    setPending(userId, 'add_filter');
    await bot.editMessageText(
      `➕ *Tambah Filter*\n\n` +
      `*Langkah-langkah:*\n` +
      `1️⃣ Pergi ke pesan yang mau dijadikan filter\n` +
      `2️⃣ Reply pesan tersebut\n` +
      `3️⃣ Ketik nama filter di kolom reply kamu\n\n` +
      `_Contoh: reply ke foto promo → ketik_ \`promo\`\n\n` +
      `⏳ Batal otomatis dalam 10 menit`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

  if (data === 'filter_del') {
    setPending(userId, 'del_filter');
    await bot.editMessageText(
      `🗑️ *Hapus Filter*\n\nKetik nama filter yang mau dihapus:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

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

  if (data.startsWith('filter_list_')) {
    const page = parseInt(data.split('_')[2]) || 1;
    const { text, total, page: p } = await buildFilterListText(page);
    const keyboard = total > 0 ? kb.filterListKeyboard(p, total) : kb.backKeyboard('filter_menu');
    await bot.editMessageText(text, {
      chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
    return;
  }

  if (data === 'filter_search') {
    setPending(userId, 'search_filter');
    await bot.editMessageText(
      `🔍 *Cari Filter*\n\nKetik keyword pencarian:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

  if (data === 'filter_clone') {
    setPending(userId, 'clone_filter');
    await bot.editMessageText(
      `📋 *Clone Filter*\n\nKetik: \`nama_asal nama_baru\`\n_Contoh: \`promo promo2\`_`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

  if (data === 'filter_rename') {
    setPending(userId, 'rename_filter');
    await bot.editMessageText(
      `✏️ *Rename Filter*\n\nKetik: \`nama_lama nama_baru\`\n_Contoh: \`promo promo_v2\`_`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

  if (data === 'filter_export') {
    if (!isOwner(userId)) {
      await bot.answerCallbackQuery(queryId, { text: '❌ Hanya owner yang bisa export!' }).catch(() => {});
      return;
    }
    await bot.answerCallbackQuery(queryId, { text: '⏳ Menyiapkan export...' }).catch(() => {});
    const rows = await db.getAllFilters();
    const buf  = Buffer.from(JSON.stringify({
      exported_at:  new Date().toISOString(),
      filter_count: rows.length,
      filters:      rows
    }, null, 2));
    await bot.sendDocument(chatId, buf, {
      caption:    `✅ *Backup Filters*\n\n📦 Total: *${rows.length}* filters\n📅 ${new Date().toLocaleString('id-ID')}`,
      parse_mode: 'Markdown'
    }, { filename: `filters_backup_${Date.now()}.json`, contentType: 'application/json' });
    return;
  }
}

// ============================================================
// PENDING ACTION HANDLER
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
      const r = await bot.sendMessage(chatId, '⚠️ Nama filter hanya huruf, angka, dan underscore!', { reply_markup: cancelRow() });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }

    const source = msg.reply_to_message;
    if (!source) {
      const r = await bot.sendMessage(chatId,
        `⚠️ *Harus reply ke pesan sumber!*\n\n` +
        `Pergi ke pesan yang mau dijadikan filter, reply ke sana, lalu ketik nama filternya.`,
        { parse_mode: 'Markdown', reply_markup: cancelRow() }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 8);
      return;
    }
    if (source.from?.id === cachedBotId) {
      const r = await bot.sendMessage(chatId,
        `⚠️ Jangan reply ke pesan bot!\n\nReply ke *pesan sumber* yang mau dijadikan filter.`,
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
    if (source.entities?.length)             filterData.entities         = source.entities;
    if (source.caption_entities?.length)     filterData.caption_entities = source.caption_entities;
    if (source.reply_markup?.inline_keyboard) filterData.buttons         = source.reply_markup.inline_keyboard;

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
    if (!checkRateLimit(userId)) {
      const r = await bot.sendMessage(chatId, '⚠️ Terlalu banyak request! Tunggu sebentar.');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
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
      const r = await bot.sendMessage(chatId, `🔍 Tidak ada filter cocok dengan *${term}*.`,
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
    if (!checkRateLimit(userId)) {
      const r = await bot.sendMessage(chatId, '⚠️ Terlalu banyak request! Tunggu sebentar.');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
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
    if (!checkRateLimit(userId)) {
      const r = await bot.sendMessage(chatId, '⚠️ Terlalu banyak request! Tunggu sebentar.');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
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

  // ---- timeout_user ----
  if (action === 'timeout_user') {
    const parts = text.trim().split(/\s+/);
    let targetId, minutes;

    if (msg.reply_to_message && parts.length === 1) {
      // Cara 2: reply ke pesan user, ketik menit
      targetId = msg.reply_to_message.from?.id;
      minutes  = parseInt(parts[0]);
    } else if (parts.length === 2) {
      // Cara 1: ketik "USER_ID MENIT"
      targetId = parseInt(parts[0]);
      minutes  = parseInt(parts[1]);
    }

    if (!targetId || isNaN(targetId)) {
      const r = await bot.sendMessage(chatId,
        `⚠️ Format salah!\n\n` +
        `Cara 1: \`USER_ID MENIT\`\n` +
        `Cara 2: reply ke pesan user → ketik menit`,
        { parse_mode: 'Markdown', reply_markup: cancelRow('admin_tools') }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 8);
      return;
    }
    if (!minutes || isNaN(minutes) || minutes < 1 || minutes > 1440) {
      const r = await bot.sendMessage(chatId, '⚠️ Durasi timeout: 1–1440 menit (max 24 jam)',
        { reply_markup: cancelRow('admin_tools') }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    if (isAdmin(targetId)) {
      const r = await bot.sendMessage(chatId, '❌ Tidak bisa timeout admin/owner!',
        { reply_markup: cancelRow('admin_tools') }
      );
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }

    pendingActions.delete(userId);

    // Minta konfirmasi sebelum eksekusi
    const r = await bot.sendMessage(chatId,
      `⚠️ *Konfirmasi Timeout*\n\n` +
      `👤 User ID: \`${targetId}\`\n` +
      `⏰ Durasi: *${minutes} menit*\n\n` +
      `Lanjutkan?`,
      { parse_mode: 'Markdown', reply_markup: kb.timeoutConfirmKeyboard(targetId, minutes) }
    );
    autoDeleteMessage(bot, chatId, r.message_id, 30);
    return;
  }

  // ---- chat_ai ----
  if (action === 'chat_ai') {
    if (!AI_ENABLED) {
      const r = await bot.sendMessage(chatId, '⚠️ AI Hoki belum aktif. Set GROQ_API_KEY dulu ya!');
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      pendingActions.delete(userId);
      return;
    }
    const userMsg = text?.trim();
    if (!userMsg || userMsg.length < 2) return;

    const rl = ai.checkAIRateLimit(userId);
    if (!rl.allowed) {
      const r = await bot.sendMessage(chatId, `⏱️ Tunggu ${rl.remaining} detik lagi yaa~ 😊`);
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }
    // Jangan hapus pending — sesi AI tetap aktif sampai user tekan tombol lain
    try {
      await bot.sendChatAction(chatId, 'typing');
      const { response } = await ai.callGroqAPI(userMsg, userId);
      await bot.sendMessage(chatId, response, { reply_to_message_id: msg.message_id });
    } catch (err) {
      console.error('❌ AI Error (pending):', err.message);
      let errMsg = 'Maaf nih~ Lagi error. Coba lagi yaa 🙏';
      if (err.message.includes('429') || err.message.includes('rate limit')) {
        errMsg = 'Lagi banyak yang pakai AI nih~ Tunggu sebentar yaa 🙏';
      } else if (err.message.includes('rate limited')) {
        errMsg = err.message;
      }
      const r = await bot.sendMessage(chatId, errMsg, { reply_to_message_id: msg.message_id });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
    }
    return;
  }

  // ---- translate (via pending) ----
  if (action === 'translate') {
    await handleTranslate(bot, chatId, userId, msg, text);
    return;
  }

  // Unknown action — clear
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
  console.log(`📊 Daily stats dijadwalkan: ${next.toLocaleString('id-ID')}`);

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
    const sr     = stats.totalRequests > 0
      ? ((stats.successfulResponses / stats.totalRequests) * 100).toFixed(1)
      : '0.0';

    await bot.sendMessage(OWNER_ID,
      `📊 *Daily Bot Stats*\n\n` +
      `📅 ${new Date().toLocaleDateString('id-ID')}\n\n` +
      `🎯 Filters: ${filterCount}\n` +
      `👥 Admins: ${admins.length}\n` +
      `📊 Users Tracked: ${analyticsCount}\n` +
      `⏱️ Uptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m\n\n` +
      `${AI_ENABLED ? `🤖 *AI:* ${stats.totalRequests} req | ${sr}% | ${convs.size} convs\n\n` : ''}` +
      `🔔 Welcomes: ${notifStats.welcomesSent} | Alerts: ${notifStats.alertsSent}\n\n` +
      `✅ Status: Online 🚀`,
      { parse_mode: 'Markdown' }
    );
    notifStats.dailyStatsSent++;
    console.log('📊 Daily stats sent to owner');
  } catch (e) {
    console.error('❌ Daily stats failed:', e.message);
  }
}

module.exports = { setupHandlers, startDailyStats };
