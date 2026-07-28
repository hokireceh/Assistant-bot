const db        = require('./db');
const ai        = require('./ai');
const kb        = require('./keyboards');
const { OWNER_ID, AI_ENABLED, AI_MODELS, GUARD_MODEL } = require('./config');
const {
  isAdmin, isOwner, getAdmins, checkRateLimit,
  isTimedOut, getTimeoutRemaining,
  autoDeleteMessage, entitiesToHTML, createPagination,
  sendMessageDraft, sendRichMessage, sendRichMessageDraft, sendChecklist, answerGuestQuery,
  richParagraph, richHeading, richPreformatted, richList, richTable,
  richDivider, richFooter, richBlockquote, richThinking, richMap,
  richDetails, richCollage, richSlideshow, richText, sendRichMessageBlocks,
  entitiesToRichSegments, sendAutoEphemeral
} = require('./utils');
const { captureTopic, getTopicId, sendTelegramMessage } = require('./TopicTracker');

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
    const r = await bot.sendMessage(chatId, '⚠️ Teks terlalu pendek! Minimal 2 karakter ya.', threadOpts(msg));
    autoDeleteMessage(bot, chatId, r.message_id, 5);
    return;
  }
  if (inputText.length > 500) {
    const r = await bot.sendMessage(chatId, '⚠️ Maksimal 500 karakter per terjemahan!', threadOpts(msg));
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
        ...threadOpts(msg),
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
      { parse_mode: 'Markdown', ...threadOpts(msg) }
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
    `• 🎲 Fun — dadu, poll, checklist, gallery\n` +
    `• ❓ Bantuan — panduan ini\n\n` +
    `*🎯 Filter Management (admin only):*\n` +
    `• ➕ Tambah — ketik nama → kirim konten (2 langkah)\n` +
    `• 🗑️ Hapus — ketik nama filter\n` +
    `• 📋 Daftar — pagination 15/halaman\n` +
    `• 🔍 Cari — keyword search\n` +
    `• 📋 Clone — ketik: \`asal | tujuan\`\n` +
    `• ✏️ Rename — ketik: \`lama | baru\`\n\n` +
    `*💡 Cara trigger filter:*\n` +
    `• Tanpa spasi: ketik \`!nama\` atau \`nama\`\n` +
    `• Dengan spasi: wajib \`!nama filter\`\n` +
    `• Inline: ketik \`@hokibot nama\` di chat lain\n\n` +
    `*🌐 Translate:*\n` +
    `• Tekan 🌐 Translate → kirim teks\n` +
    `• Auto-detect bahasa (Indonesia ↔ English)\n` +
    `• Tersedia untuk semua user\n\n` +
    `*🎲 Fun Menu:*\n` +
    `• 🎲 Dadu — lempar dadu emoji (6 jenis)\n` +
    `• 📊 Poll — buat poll biasa atau quiz\n` +
    `• ✅ Checklist — buat daftar centang\n` +
    `• 🖼️ Gallery — lihat semua media filter sebagai album\n\n` +
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

async function sendFilter(bot, chatId, filter, extraOpts = {}) {
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
  const hasText          = rawText.trim().length > 0;

  const hasMedia  = filter.photo || filter.video || filter.animation ||
                    filter.document || filter.audio || filter.voice;
  const hasSticker = !!filter.sticker;
  const hasAny    = hasMedia || hasSticker;

  // ============================================================
  // RICH MESSAGE — Bot API 10.2: single request for all filter types
  // ============================================================
  if (hasAny || hasText) {
    try {
      const blocks = [];

      // Media block
      if (hasSticker)      blocks.push({ type: 'photo', media: filter.sticker });
      else if (filter.photo)      blocks.push({ type: 'photo', media: filter.photo });
      else if (filter.video)      blocks.push({ type: 'video', media: filter.video });
      else if (filter.animation)  blocks.push({ type: 'animation', media: filter.animation });
      else if (filter.document)   blocks.push({ type: 'document', media: filter.document });
      else if (filter.audio)      blocks.push({ type: 'audio', media: filter.audio });
      else if (filter.voice)      blocks.push({ type: 'voice_note', media: filter.voice });

      // Text paragraph block (caption or standalone text)
      if (hasText) {
        const ent = (hasMedia && caption_entities?.length) ? caption_entities : entities;
        const segments = entitiesToRichSegments(rawText, ent);
        blocks.push({ type: 'paragraph', text: segments });
      }

      await sendRichMessageBlocks(chatId, blocks, {
        ...extraOpts,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {})
      });
      return;
    } catch (_) {
      // Rich message failed — fall through to standard methods
    }
  }

  // ============================================================
  // STANDARD FALLBACK — when Rich Message unavailable or failed
  // ============================================================
  let formattedCaption = rawText;
  let captionParseMode = null;
  if (hasText) {
    const ent = caption_entities?.length ? caption_entities : entities;
    if (ent && ent.length > 0) {
      formattedCaption = entitiesToHTML(rawText, ent);
      captionParseMode = 'HTML';
    }
  }

  let formattedText = rawText;
  let textParseMode = null;
  if (entities && entities.length > 0) {
    formattedText = entitiesToHTML(rawText, entities);
    textParseMode = 'HTML';
  }

  const captionOpts = () => {
    const o = { ...extraOpts };
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
    const stickerOpts = { ...extraOpts };
    if (replyMarkup && !formattedText?.trim()) stickerOpts.reply_markup = replyMarkup;
    await bot.sendSticker(chatId, filter.sticker, stickerOpts);
    if (formattedText?.trim()) {
      const o = { ...extraOpts };
      if (textParseMode) o.parse_mode = textParseMode;
      if (replyMarkup)   o.reply_markup = replyMarkup;
      await bot.sendMessage(chatId, formattedText, o);
    }
  } else if (formattedText?.trim()) {
    const o = { ...extraOpts };
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

function threadOpts(chatId, msg) {
  // backward compat: threadOpts(msg)
  if (typeof chatId === 'object' && chatId !== null) {
    msg = chatId;
    chatId = msg?.chat?.id;
  }
  if (msg?.message_thread_id) {
    console.log(`🔍 [TRACE] threadOpts: using msg.message_thread_id=${msg.message_thread_id}`);
    return { message_thread_id: msg.message_thread_id };
  }
  const tid = getTopicId(chatId);
  console.log(`🔍 [TRACE] threadOpts: getTopicId(${chatId})=${tid}`);
  if (tid) return { message_thread_id: tid };
  console.log(`🔍 [TRACE] threadOpts: NO topic ID found`);
  return {};
}

function cancelRow(target = 'filter_menu') {
  return { inline_keyboard: [[{ text: '❌ Batal', callback_data: target }]] };
}

// ============================================================
// SETUP ALL HANDLERS
// ============================================================
function setupHandlers(bot) {
  // TopicTracker middleware — dulu, sebelum handler lain
  bot.use(captureTopic);

  // Grammy compat layer: bot.* API methods → bot.api.*
  const API_METHODS = ['sendMessage','sendPhoto','sendVideo','sendAnimation','sendDocument',
    'sendAudio','sendVoice','sendSticker','sendDice','sendPoll',
    'sendMediaGroup','sendChatAction','deleteMessage',
    'getMe','setMyCommands','setChatMenuButton',
    'getFile','getFileLink','sendContact','sendLocation','sendVenue'];
  for (const m of API_METHODS) {
    bot[m] = (...args) => bot.api[m](...args);
  }
  // sendMessage: auto-inject message_thread_id untuk group forum topic
  bot.sendMessage = (chatId, text, opts) => sendTelegramMessage(bot, chatId, text, opts);
  // editMessageText: node-telegram-bot-api (text, {chat_id, message_id, ...})
  // → Grammy (chat_id, message_id, text, other)
  bot.editMessageText = function(text, opts) {
    if (typeof text === 'string' && opts?.chat_id && opts?.message_id) {
      const { chat_id, message_id, ...rest } = opts;
      return bot.api.editMessageText(chat_id, message_id, text, rest);
    }
    return bot.api.editMessageText(text, opts);
  };
  // answerCallbackQuery: node-telegram-bot-api (queryId, text, opts)
  // → Grammy (queryId, {text, ...opts})
  bot.answerCallbackQuery = function(queryId, text, opts) {
    if (text) {
      return bot.api.answerCallbackQuery(queryId, { text, ...opts });
    }
    return bot.api.answerCallbackQuery(queryId);
  };
  bot.answerInlineQuery = (...args) => bot.api.answerInlineQuery(...args);
  // onText compat: like node-telegram-bot-api bot.onText(regex, handler)
  bot.onText = (regex, handler) => {
    bot.on('message:text', async (ctx, next) => {
      const match = (ctx.msg.text || '').match(regex);
      if (match) await handler(ctx, match);
      if (next) await next();
    });
  };

  // Cache bot ID satu kali saat startup
  bot.getMe().then(me => {
    cachedBotId = me.id;
    console.log(`✅ Cached bot ID: ${cachedBotId} (@${me.username})`);
  }).catch(err => console.error('❌ getMe failed:', err.message));

  // ==========================================================
  // INLINE QUERY — Akses filter dari chat manapun
  // User ketik: @hokibot nama_filter
  // HANYA admin yang bisa akses filter via inline
  // ==========================================================
  bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery;
    const userId = query.from.id;
    const queryText = query.query.trim().toLowerCase().replace(/^!/, '');
    const offset = parseInt(query.offset) || 0;
    const limit = 10;

    // SECURITY: Hanya admin yang bisa pakai inline filter
    if (!isAdmin(userId)) {
      try {
        await bot.answerInlineQuery(query.id, [], {
          cache_time: 30,
          switch_pm_text: '🔒 Hanya admin yang bisa pakai filter',
          switch_pm_parameter: 'admin_only'
        });
      } catch (e) {}
      return;
    }

    if (!queryText || queryText.length < 1) {
      const names = await db.getFilterNames().catch(() => []);
      const sliced = names.slice(offset, offset + limit);
      const results = sliced.map((name, i) => ({
        type: 'article',
        id: `filter_${offset + i}`,
        title: `!${name}`,
        description: `Klik untuk kirim filter: ${name}`,
        input_message_content: {
          message_text: `!${name}`
        }
      }));
      try {
        await bot.answerInlineQuery(query.id, results, {
          next_offset: String(offset + limit),
          cache_time: 30,
          switch_pm_text: names.length > offset + limit ? `${names.length - offset - limit} filter lainnya...` : 'Ketik nama filter untuk cari',
          switch_pm_parameter: 'help'
        });
      } catch (e) {
        console.error('❌ Inline query error:', e.message);
      }
      return;
    }

    const names = await db.getFilterNames().catch(() => []);
    const matches = names.filter(n => n.includes(queryText)).slice(offset, offset + limit);
    const results = matches.map((name, i) => ({
      type: 'article',
      id: `filter_${offset + i}`,
      title: `!${name}`,
      description: `Klik untuk kirim filter: ${name}`,
      input_message_content: {
        message_text: `!${name}`
      }
    }));

    try {
      await bot.answerInlineQuery(query.id, results, {
        next_offset: String(offset + limit),
        cache_time: 30,
        switch_pm_text: matches.length === 0 ? 'Filter tidak ditemukan' : `${matches.length} filter ditemukan`,
        switch_pm_parameter: 'search'
      });
    } catch (e) {
      console.error('❌ Inline query error:', e.message);
    }
  });

  // ==========================================================
  // GUEST MESSAGE — Bot API 10.0 Guest Mode
  // Handle pesan dari chat dimana bot tidak menjadi member
  // ==========================================================
  bot.on('guest_message', async (ctx) => {
    const msg = ctx.msg;
    const guestQueryId = msg.guest_query_id;
    if (!guestQueryId) return;

    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text   = msg.text || '';

    console.log(`👤 Guest message from ${userId} in chat ${chatId}: ${text.substring(0, 50)}`);

    // Guest mode hanya untuk filter (non-admin juga bisa)
    if (!text) return;

    const queryText = text.trim().toLowerCase().replace(/^!/, '');
    if (queryText.length < 2) return;

    try {
      const filter = await db.getFilter(queryText).catch(() => null);
      if (filter) {
        // Kirim filter sebagai response
        let responseText = filter.text || `Filter: ${queryText}`;
        if (responseText.length > 200) responseText = responseText.substring(0, 200) + '...';

        await answerGuestQuery(guestQueryId, {
          type: 'article',
          id: `guest_${Date.now()}`,
          title: `!${queryText}`,
          description: responseText.substring(0, 100),
          input_message_content: {
            message_text: responseText
          }
        });
        console.log(`✅ Guest filter response sent: ${queryText}`);
      } else {
        // Filter tidak ditemukan
        await answerGuestQuery(guestQueryId, {
          type: 'article',
          id: `guest_notfound_${Date.now()}`,
          title: '❌ Filter tidak ditemukan',
          description: `Gunakan !namafilter untuk mencari`,
          input_message_content: {
            message_text: `❌ Filter "${queryText}" tidak ditemukan.\n\nKetik !namafilter untuk mencari.`
          }
        });
      }
    } catch (err) {
      console.error('❌ Guest message error:', err.message);
    }
  });

  // ==========================================================
  // /start — SATU-SATUNYA slash command
  // Diperlukan Telegram untuk init bot di private chat
  // ==========================================================
  bot.onText(/\/start/, async (ctx) => {
    const msg       = ctx.msg;
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
  bot.on('callback_query', async (ctx) => {
    const query     = ctx.callbackQuery;
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
  bot.on('message', async (ctx) => {
    try {
    const msg = ctx.msg;
    if (!msg.from) {
      console.log(`🔍 [DEEP] msg.on('message'): NO msg.from — SKIPPING. Keys: ${Object.keys(msg||{}).join(',')}`);
      return;
    }
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text   = msg.text || '';
    const chatType = msg.chat.type;
    const isForum = msg.chat.is_forum;
    const threadId = msg.message_thread_id || 0;
    const hasReply = !!msg.reply_to_message;
    const replyToId = msg.reply_to_message?.message_id;
    const replyFromId = msg.reply_to_message?.from?.id;
    const isReplyToBot = replyFromId === cachedBotId;
    
    console.log(`📨 [DEEP] msg received:`);
    console.log(`  chatId=${chatId} userId=${userId} chatType=${chatType}`);
    console.log(`  isForum=${isForum} threadId=${threadId}`);
    console.log(`  text="${text.substring(0,50)}" hasReply=${hasReply}`);
    if (hasReply) console.log(`  replyToMsg=${replyToId} replyFromId=${replyFromId} isReplyToBot=${isReplyToBot} cachedBotId=${cachedBotId}`);
    console.log(`  msgId=${msg.message_id} date=${msg.date} text_len=${(msg.text||'').length} caption_len=${(msg.caption||'').length}`);
    console.log(`  newChatMembers=${!!msg.new_chat_members} serviceMsg=${!!msg.service}`);

    // Slash commands ditangani oleh onText di atas
    if (text.startsWith('/')) {
      console.log(`🔍 [DEEP] → SKIP: slash command`);
      return;
    }

    // Pending translate — SEMUA user bisa, sebelum admin gate
    {
      const pendingT = pendingActions.get(userId);
      if (pendingT?.action === 'translate') {
        console.log(`🔍 [DEEP] → PENDING TRANSLATE detected`);
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
      if (RESERVED_BANG.has(cmd)) {
        console.log(`🔍 [DEEP] → SKIP: reserved bang word "${cmd}"`);
        return;
      }
    }

    // Gate non-admin — track dan silent reject
    const adminCheck = isAdmin(userId);
    console.log(`🔍 [DEEP] isAdmin(${userId}) = ${adminCheck}`);
    if (!adminCheck) {
      const pName = text.startsWith('!') ? text.substring(1).trim().toLowerCase() : text.trim().toLowerCase();
      if (pName && !pName.includes(' ') && pName.length >= 2) {
        const exists = await db.filterExists(pName).catch(() => false);
        if (exists) {
          await db.trackUserAccess(userId, msg.from.username, msg.from.first_name, msg.from.last_name)
            .catch(() => {});
          console.log(`🚫 Non-admin ${userId} tried filter: ${pName}`);
        }
      }
      console.log(`🚫 [DEEP] → SILENT REJECT: non-admin userId=${userId}`);
      return;
    }

    // Timeout check
    if (await isTimedOut(userId)) {
      console.log(`🔍 [DEEP] → TIMEOUT active for userId=${userId}`);
      const rem = await getTimeoutRemaining(userId);
      const isPrivate = msg.chat.type === 'private';
      if (isPrivate) {
        await sendAutoEphemeral(bot, chatId, userId, `⏱️ Kamu masih timeout ${rem} detik lagi~`, threadOpts(msg), 3);
      } else {
        const r = await bot.sendMessage(chatId, `⏱️ Kamu masih timeout ${rem} detik lagi~`, threadOpts(msg));
        autoDeleteMessage(bot, chatId, r.message_id, 3);
      }
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
    if (text === '🎲 Fun') {
      pendingActions.delete(userId);
      autoDeleteMessage(bot, chatId, msg.message_id, 1);
      await bot.sendMessage(chatId,
        `🎲 *Fun Menu*\nPilih aktivitas seru:`,
        { parse_mode: 'Markdown', reply_markup: kb.funMenuKeyboard() }
      );
      return;
    }

    // ---- Pending Actions ----
    const pending = pendingActions.get(userId);
    if (pending) {
      if (pending.expiresAt && Date.now() > pending.expiresAt) {
        console.log(`🔍 [DEEP] → PENDING ACTION expired: user=${userId} action=${pending.action}`);
        pendingActions.delete(userId);
      } else {
        console.log(`🔍 [DEEP] → PENDING ACTION hit: user=${userId} action=${pending.action}`);
        autoDeleteMessage(bot, chatId, msg.message_id, 3);
        await handlePendingAction(bot, chatId, userId, msg, text, pending);
        return;
      }
    }

    // ---- Filter Trigger ----
    const rawText = msg.text || msg.caption || '';
    const hasPrefix = rawText.startsWith('!');
    const potentialName = (hasPrefix ? rawText.substring(1).trim() : rawText.trim()).toLowerCase().replace(/\s+/g, ' ');
    console.log(`🔍 [DEEP] FILTER TRIGGER CHECK: rawText="${rawText.substring(0,40)}" hasPrefix=${hasPrefix} potentialName="${potentialName}" nameLen=${potentialName.length} hasSpaces=${/\s/.test(potentialName)}`);

    let matchedFilter = null;
    let matchedName = null;

    // 1) Exact match (without prefix !)
    if (potentialName && potentialName.length >= 2 && !/\s/.test(potentialName)) {
      matchedFilter = await db.getFilter(potentialName).catch(() => null);
      if (matchedFilter) matchedName = potentialName;
      console.log(`🔍 [DEEP] Exact match getFilter("${potentialName}") = ${matchedFilter ? 'FOUND' : 'NOT_FOUND'}`);
    }

    // 2) Substring match — find filter name as word anywhere in message
    if (!matchedFilter && rawText.trim().length >= 2) {
      const filterNames = await db.getFilterNames().catch(() => []);
      const lowerText = rawText.toLowerCase();
      for (const name of filterNames) {
        const lowerName = name.toLowerCase();
        const regex = new RegExp(`(?:^|[\\s!])${lowerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[\\s,.:;!?\n]|$)`, 'i');
        if (regex.test(lowerText)) {
          matchedFilter = await db.getFilter(name).catch(() => null);
          if (matchedFilter) {
            matchedName = name;
            console.log(`🔍 [DEEP] Substring match found: "${name}" in text`);
            break;
          }
        }
      }
    }

    if (matchedFilter) {
      const topicOpts = threadOpts(msg);
      console.log(`🔍 [DEEP] → FILTER FOUND! name="${matchedName}" Sending to chatId=${chatId} topicOpts=${JSON.stringify(topicOpts)}`);
      if (!checkRateLimit(userId)) {
        const isPrivate = msg.chat.type === 'private';
        if (isPrivate) {
          await sendAutoEphemeral(bot, chatId, userId, '⚠️ Terlalu banyak request! Tunggu sebentar.', threadOpts(msg), 3);
        } else {
          const r = await bot.sendMessage(chatId, '⚠️ Terlalu banyak request! Tunggu sebentar.', threadOpts(msg));
          autoDeleteMessage(bot, chatId, r.message_id, 3);
        }
        return;
      }
      autoDeleteMessage(bot, chatId, msg.message_id, 3);
      try {
        await sendFilter(bot, chatId, matchedFilter, threadOpts(msg));
      } catch (err) {
        console.error('❌ Filter error:', matchedName, err.message);
        const isPrivate = msg.chat.type === 'private';
        const errText = `⚠️ Error kirim filter *${matchedName}*:\n\`${err.message.substring(0, 100)}\``;
        const errOpts = { parse_mode: 'Markdown', ...threadOpts(msg) };
        if (isPrivate) {
          await sendAutoEphemeral(bot, chatId, userId, errText, errOpts, 5);
        } else {
          const r = await bot.sendMessage(chatId, errText, errOpts);
          autoDeleteMessage(bot, chatId, r.message_id, 5);
        }
        if (!isOwner(userId)) {
          notifyCriticalError(bot, err.message, { chatId, userId, filterName: matchedName });
        }
      }
      return;
    }

    // ---- AI Hoki (Group only: reply ke pesan bot) ----
    // Private chat: pakai tombol 🤖 Chat AI dari menu (pending chat_ai)
    console.log(`🔍 [DEEP] AI CHECK: AI_ENABLED=${AI_ENABLED} hasText=${!!msg.text} chatType=${msg.chat.type} cachedBotId=${cachedBotId} isReplyToBot=${msg.reply_to_message?.from?.id === cachedBotId}`);
    if (!AI_ENABLED || !msg.text) {
      console.log(`🔍 [DEEP] → AI SKIP: AI_ENABLED=${AI_ENABLED} hasText=${!!msg.text}`);
      return;
    }
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
      console.log(`🔍 [DEEP] → AI SKIP: chatType=${msg.chat.type} (not group/supergroup)`);
      return;
    }
    if (!cachedBotId) {
      console.log(`🔍 [DEEP] → AI SKIP: cachedBotId is null`);
      return;
    }
    if (msg.reply_to_message?.from?.id !== cachedBotId) {
      console.log(`🔍 [DEEP] → AI SKIP: not a reply to bot. replyFromId=${msg.reply_to_message?.from?.id} cachedBotId=${cachedBotId}`);
      console.log(`🔍 [DEEP] → END OF HANDLER — NO ACTION TAKEN for this message`);
      return;
    }

    const userMsg = msg.text.trim();
    if (userMsg.length < 2) return;

    const rl = ai.checkAIRateLimit(userId);
    if (!rl.allowed) {
      const isPrivate = msg.chat.type === 'private';
      const rlText = `⏱️ Tunggu ${rl.remaining} detik lagi yaa~ 😊`;
      if (isPrivate) {
        await sendAutoEphemeral(bot, chatId, userId, rlText, threadOpts(msg), 3);
      } else {
        const r = await bot.sendMessage(chatId, rlText, threadOpts(msg));
        autoDeleteMessage(bot, chatId, r.message_id, 3);
      }
      return;
    }

    try {
      await bot.sendChatAction(chatId, 'typing');

      // Stream: kirim draft "thinking" sambil proses
      const draftId = Date.now();
      try {
        await sendRichMessageDraft(chatId, draftId, {
          html: '<tg-thinking>🧠 <b>Hoki sedang berpikir...</b></tg-thinking>'
        }, threadOpts(msg));
      } catch (_) {}

      const { response } = await ai.callGroqAPI(userMsg, userId);

      // Kirim response final sebagai rich message
      await sendRichMessage(chatId, {
        markdown: response
      }, {
        reply_parameters: { message_id: msg.message_id },
        ...threadOpts(msg)
      });
    } catch (err) {
      console.error('❌ AI Error:', err.message);
      let errMsg = 'Maaf nih~ Lagi error. Coba lagi yaa 🙏';
      if (err.message.includes('429') || err.message.includes('rate limit')) {
        errMsg = 'Lagi banyak yang pakai AI nih~ Tunggu sebentar yaa 🙏';
      } else if (err.message.includes('rate limited')) {
        errMsg = err.message;
      }
      const isPrivate = msg.chat.type === 'private';
      if (isPrivate) {
        await sendAutoEphemeral(bot, chatId, userId, errMsg, { reply_to_message_id: msg.message_id, ...threadOpts(msg) }, 5);
      } else {
        const r = await bot.sendMessage(chatId, errMsg, { reply_to_message_id: msg.message_id, ...threadOpts(msg) });
        autoDeleteMessage(bot, chatId, r.message_id, 5);
      }
    }
    } catch (err) {
      console.error('❌ Message handler error:', err.message);
    }
  });

  // ==========================================================
  // WELCOME NEW MEMBERS
  // ==========================================================
  bot.on('message:new_chat_members', async (ctx) => {
    const msg = ctx.msg;
    const chatId = msg.chat.id;
    for (const member of msg.new_chat_members) {
      if (member.is_bot) continue;
      try {
        await bot.sendMessage(chatId,
          `👋 Selamat datang *${member.first_name || 'User'}*!\n\n` +
          `🤖 Gua bot filter management.\n` +
          `${AI_ENABLED ? '💬 Chat sama gua dengan reply ke pesan gua!\n' : ''}` +
          `Enjoy! 🚀`,
          { parse_mode: 'Markdown', ...threadOpts(msg) }
        );
        notifStats.welcomesSent++;
      } catch (e) {
        console.error('❌ Welcome failed:', e.message);
      }
    }
  });

  // Grammy handles error recovery internally via auto-retry plugin
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

  // ---- fun_menu ----
  if (data === 'fun_menu') {
    pendingActions.delete(userId);
    await bot.editMessageText(
      `🎲 *Fun Menu*\nPilih aktivitas seru:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.funMenuKeyboard() }
    ).catch(() => {});
    return;
  }

  // ---- fun_dice ----
  if (data === 'fun_dice') {
    await bot.editMessageText(
      `🎲 *Pilih Dadu:*\nKlik emoji untuk lempar!`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.diceKeyboard() }
    ).catch(() => {});
    return;
  }

  // ---- dice掷 (掷 = throw, any emoji)
  if (data.startsWith('dice🎲') || data.startsWith('dice🎯') || data.startsWith('dice🏀') ||
      data.startsWith('dice⚽') || data.startsWith('dice🎳') || data.startsWith('dice🎰')) {
    const emoji = data.replace('dice', '');
    await bot.sendDice(chatId, { emoji });
    return;
  }

  // ---- fun_poll ----
  if (data === 'fun_poll') {
    await bot.editMessageText(
      `📊 *Buat Poll*\n\nPilih jenis poll:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.pollMenuKeyboard() }
    ).catch(() => {});
    return;
  }

  // ---- poll_create ----
  if (data === 'poll_create') {
    setPending(userId, 'poll_question');
    await bot.editMessageText(
      `📊 *Poll Biasa*\n\nKetik pertanyaan poll:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
    ).catch(() => {});
    return;
  }

  // ---- poll_quiz ----
  if (data === 'poll_quiz') {
    setPending(userId, 'poll_quiz_question');
    await bot.editMessageText(
      `❓ *Quiz*\n\nKetik pertanyaan quiz:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
    ).catch(() => {});
    return;
  }

  // ---- fun_checklist ----
  if (data === 'fun_checklist') {
    await bot.editMessageText(
      `✅ *Checklist*\n\nBuat checklist interaktif.`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.checklistMenuKeyboard() }
    ).catch(() => {});
    return;
  }

  // ---- checklist_create ----
  if (data === 'checklist_create') {
    setPending(userId, 'checklist_title');
    await bot.editMessageText(
      `✅ *Buat Checklist*\n\nKetik judul checklist:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
    ).catch(() => {});
    return;
  }

  // ---- fun_gallery ----
  if (data === 'fun_gallery') {
    if (!isAdmin(userId)) {
      await bot.answerCallbackQuery(queryId, { text: '🔒 Hanya admin!' }).catch(() => {});
      return;
    }
    setPending(userId, 'gallery_filter');
    await bot.editMessageText(
      `🖼️ *Gallery Mode*\n\nKetik nama filter untuk lihat sebagai gallery:\n_Semua media filter akan dikirim sebagai album._`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
    ).catch(() => {});
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
    const blocks = [];
    blocks.push(richHeading('📊 Status Bot'));
    blocks.push(richParagraph([
      richText('text', `👑 Admins: ${getAdmins().length}`)
    ]));
    blocks.push(richTable(
      ['Metric', 'Value'],
      [
        ['🎯 Total Filter', String(stats.total)],
        ['💾 Memory', `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`],
        ['⏱️ Uptime', `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`]
      ]
    ));
    blocks.push(richHeading('📦 Breakdown Filter', 3));
    blocks.push(richTable(
      ['Type', 'Count'],
      [
        ['📝 Text', String(stats.text || 0)],
        ['🖼️ Photo', String(stats.photo || 0)],
        ['🎥 Video', String(stats.video || 0)],
        ['📄 Document', String(stats.document || 0)],
        ['🎞️ Animation', String(stats.animation || 0)],
        ['🎵 Audio', String(stats.audio || 0)],
        ['🎤 Voice', String(stats.voice || 0)],
        ['🎨 Sticker', String(stats.sticker || 0)]
      ]
    ));
    if (stats.oldest_name) {
      blocks.push(richParagraph([richText('text', `📅 Filter tertua: ${stats.oldest_name}`)]));
    }
    
    try {
      await bot.editMessageText('', {
        chat_id: chatId, message_id: messageId,
        rich_message: { blocks },
        reply_markup: kb.backKeyboard('main_menu')
      });
    } catch (_) {
      const fallbackText =
        `📊 *Status Bot*\n\n` +
        `👑 Admins: *${getAdmins().length}*\n` +
        `🎯 Total Filter: *${stats.total}*\n` +
        `💾 Memory: *${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB*\n` +
        `⏱️ Uptime: *${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m*`;
      await bot.editMessageText(fallbackText, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: kb.backKeyboard('main_menu')
      }).catch(() => {});
    }
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
    setPending(userId, 'add_filter_name');
    await bot.editMessageText(
      `➕ *Tambah Filter — Langkah 1/2*\n\n_Menunggu nama filter..._`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    await bot.sendMessage(chatId,
      `📝 *Ketik nama filter baru:*\n` +
      `_Boleh pakai spasi · 2–50 karakter_\n\n` +
      `Contoh: \`promo\` atau \`foto promo\`\n\n` +
      `⏳ Batal dalam 10 menit`,
      { parse_mode: 'Markdown', reply_markup: cancelRow() }
    );
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

  if (data.startsWith('fdel:')) {
    const name = data.slice(5);
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
    const { items, total, page: p } = await db.getFilterNames().then(names => {
      if (names.length === 0) return { items: [], total: 0, page: 1 };
      const pag = createPagination(names, page, 15);
      return { items: pag.items, total: pag.total, page: pag.page };
    });
    
    const blocks = [];
    blocks.push(richHeading(`🎯 Daftar Filter (${items.length > 0 ? (p - 1) * 15 + items.length : 0} total) — Halaman ${p}/${total}`));
    
    if (items.length > 0) {
      const listItems = items.map((n, i) => `${(p - 1) * 15 + i + 1}. !${n}`);
      blocks.push(richList(listItems));
    } else {
      blocks.push(richParagraph([richText('text', '📭 Belum ada filter.')]));
    }
    
    const keyboard = total > 0 ? kb.filterListKeyboard(p, total) : kb.backKeyboard('filter_menu');
    try {
      await bot.editMessageText('', {
        chat_id: chatId, message_id: messageId,
        rich_message: { blocks },
        reply_markup: keyboard
      });
    } catch (_) {
      const fallbackText = items.length > 0
        ? items.map((n, i) => `${(p - 1) * 15 + i + 1}. \`!${n}\``).join('\n')
        : '📭 Belum ada filter.';
      await bot.editMessageText(fallbackText, {
        chat_id: chatId, message_id: messageId,
        reply_markup: keyboard
      }).catch(() => {});
    }
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
      `📋 *Clone Filter*\n\nKetik: \`nama asal | nama baru\`\n_Contoh: \`foto promo | foto promo2\`_`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: cancelRow() }
    ).catch(() => {});
    return;
  }

  if (data === 'filter_rename') {
    setPending(userId, 'rename_filter');
    await bot.editMessageText(
      `✏️ *Rename Filter*\n\nKetik: \`nama lama | nama baru\`\n_Contoh: \`foto promo | foto promo baru\`_`,
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

  // ---- add_filter_name (step 1/2) — terima nama dari user ----
  if (action === 'add_filter_name') {
    const filterName = text.replace(/^!/, '').trim().toLowerCase().replace(/\s+/g, ' ');

    if (!filterName || filterName.length < 2 || filterName.length > 50) {
      const r = await bot.sendMessage(chatId, '⚠️ Nama filter harus 2–50 karakter!', { reply_markup: cancelRow() });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    if (!/^[\w\s]+$/.test(filterName)) {
      const r = await bot.sendMessage(chatId, '⚠️ Nama filter hanya huruf, angka, underscore, dan spasi!', { reply_markup: cancelRow() });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }

    setPending(userId, 'add_filter_content', { name: filterName });
    await bot.sendMessage(chatId,
      `✅ Nama: *${filterName}*\n\n` +
      `*Langkah 2/2:* Sekarang kirim konten untuk filter ini.\n` +
      `_Bisa teks, foto, video, GIF, sticker, audio, dsb_`,
      { parse_mode: 'Markdown', reply_markup: cancelRow() }
    );
    return;
  }

  // ---- add_filter_content (step 2/2) — terima konten dari user ----
  if (action === 'add_filter_content') {
    const filterName = pending.data?.name;
    if (!filterName) { pendingActions.delete(userId); return; }

    const source   = msg;
    const hasMedia = source.photo || source.video || source.document ||
                     source.animation || source.audio || source.voice || source.sticker;
    const hasText  = source.text?.trim() || source.caption?.trim();

    if (!hasMedia && !hasText) {
      const r = await bot.sendMessage(chatId, '⚠️ Kirim pesan yang ada teks atau media!', { reply_markup: cancelRow() });
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
    const filterName = text.replace(/^!/, '').trim().toLowerCase().replace(/\s+/g, ' ');
    console.log(`📋 del_filter: name="${filterName}"`);
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
    const parts = text.split('|').map(p => p.trim().toLowerCase().replace(/\s+/g, ' '));
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      const r = await bot.sendMessage(chatId, '⚠️ Format: `nama asal | nama baru`',
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
    const [src, dst] = parts;
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
    const parts = text.split('|').map(p => p.trim().toLowerCase().replace(/\s+/g, ' '));
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      const r = await bot.sendMessage(chatId, '⚠️ Format: `nama lama | nama baru`',
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
    const [oldN, newN] = parts;
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
      const r = await bot.sendMessage(chatId, '⚠️ AI Hoki belum aktif. Set GROQ_API_KEY dulu ya!', threadOpts(msg));
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      pendingActions.delete(userId);
      return;
    }
    const userMsg = text?.trim();
    if (!userMsg || userMsg.length < 2) return;

    const rl = ai.checkAIRateLimit(userId);
    if (!rl.allowed) {
      const r = await bot.sendMessage(chatId, `⏱️ Tunggu ${rl.remaining} detik lagi yaa~ 😊`, threadOpts(msg));
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }
    // Jangan hapus pending — sesi AI tetap aktif sampai user tekan tombol lain
    try {
      await bot.sendChatAction(chatId, 'typing');

      // Stream: kirim draft "thinking" sambil proses
      const draftId = Date.now();
      try {
        await sendRichMessageDraft(chatId, draftId, {
          html: '<tg-thinking>🧠 <b>Hoki sedang berpikir...</b></tg-thinking>'
        }, threadOpts(msg));
      } catch (_) {}

      const { response } = await ai.callGroqAPI(userMsg, userId);

      // Kirim response final sebagai rich message
      await sendRichMessage(chatId, {
        markdown: response
      }, {
        reply_parameters: { message_id: msg.message_id },
        ...threadOpts(msg)
      });
    } catch (err) {
      console.error('❌ AI Error (pending):', err.message);
      let errMsg = 'Maaf nih~ Lagi error. Coba lagi yaa 🙏';
      if (err.message.includes('429') || err.message.includes('rate limit')) {
        errMsg = 'Lagi banyak yang pakai AI nih~ Tunggu sebentar yaa 🙏';
      } else if (err.message.includes('rate limited')) {
        errMsg = err.message;
      }
      const isPrivate = msg.chat.type === 'private';
      if (isPrivate) {
        await sendAutoEphemeral(bot, chatId, userId, errMsg, { reply_to_message_id: msg.message_id, ...threadOpts(msg) }, 5);
      } else {
        const r = await bot.sendMessage(chatId, errMsg, { reply_to_message_id: msg.message_id, ...threadOpts(msg) });
        autoDeleteMessage(bot, chatId, r.message_id, 5);
      }
    }
    return;
  }

  // ---- translate (via pending) ----
  if (action === 'translate') {
    await handleTranslate(bot, chatId, userId, msg, text);
    return;
  }

  // ---- poll_question ----
  if (action === 'poll_question') {
    if (!text || text.length < 2) {
      const r = await bot.sendMessage(chatId, '⚠️ Pertanyaan minimal 2 karakter!', { reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    setPending(userId, 'poll_options', { question: text, options: [] });
    await bot.sendMessage(chatId,
      `📝 *Pertanyaan:* ${text}\n\nKetik opsi jawaban (1 per baris, minimal 2):\n_Ketik \`selesai\` untuk kirim poll._`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
    );
    return;
  }

  // ---- poll_options ----
  if (action === 'poll_options') {
    const p = pending.data;
    if (text.toLowerCase() === 'selesai') {
      if (p.options.length < 2) {
        const r = await bot.sendMessage(chatId, '⚠️ Minimal 2 opsi!', { reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } });
        autoDeleteMessage(bot, chatId, r.message_id, 5);
        return;
      }
      pendingActions.delete(userId);
      await bot.sendPoll(chatId, p.question, p.options, {
        is_anonymous: true,
        allows_multiple_answers: false
      });
      const r = await bot.sendMessage(chatId, `✅ Poll berhasil dikirim!`);
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }
    if (p.options.length >= 10) {
      const r = await bot.sendMessage(chatId, '⚠️ Maksimal 10 opsi!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }
    p.options.push(text);
    await bot.sendMessage(chatId,
      `✅ Opsi ${p.options.length}: ${text}\n\nKetik opsi berikut atau \`selesai\``,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
    );
    return;
  }

  // ---- poll_quiz_question ----
  if (action === 'poll_quiz_question') {
    if (!text || text.length < 2) {
      const r = await bot.sendMessage(chatId, '⚠️ Pertanyaan minimal 2 karakter!', { reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    setPending(userId, 'poll_quiz_options', { question: text, options: [] });
    await bot.sendMessage(chatId,
      `📝 *Quiz:* ${text}\n\nKetik opsi jawaban (1 per baris, minimal 2):\n_Ketik \`selesai\` lalu ketik nomor jawaban benar._`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
    );
    return;
  }

  // ---- poll_quiz_options ----
  if (action === 'poll_quiz_options') {
    const p = pending.data;
    if (text.toLowerCase() === 'selesai') {
      if (p.options.length < 2) {
        const r = await bot.sendMessage(chatId, '⚠️ Minimal 2 opsi!');
        autoDeleteMessage(bot, chatId, r.message_id, 5);
        return;
      }
      setPending(userId, 'poll_quiz_answer', p);
      const optList = p.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
      await bot.sendMessage(chatId,
        `${optList}\n\nKetik nomor jawaban benar (contoh: \`1\`):`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
      );
      return;
    }
    if (p.options.length >= 10) {
      const r = await bot.sendMessage(chatId, '⚠️ Maksimal 10 opsi!');
      autoDeleteMessage(bot, chatId, r.message_id, 3);
      return;
    }
    p.options.push(text);
    await bot.sendMessage(chatId,
      `✅ Opsi ${p.options.length}: ${text}\n\nKetik opsi berikut atau \`selesai\``,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
    );
    return;
  }

  // ---- poll_quiz_answer ----
  if (action === 'poll_quiz_answer') {
    const p = pending.data;
    const correctIdx = parseInt(text) - 1;
    if (isNaN(correctIdx) || correctIdx < 0 || correctIdx >= p.options.length) {
      const r = await bot.sendMessage(chatId, `⚠️ Nomor tidak valid! Pilih 1-${p.options.length}`);
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    pendingActions.delete(userId);
    await bot.sendPoll(chatId, p.question, p.options, {
      is_anonymous: true,
      type: 'quiz',
      correct_option_id: correctIdx
    });
    const r = await bot.sendMessage(chatId, `✅ Quiz berhasil dikirim!`);
    autoDeleteMessage(bot, chatId, r.message_id, 3);
    return;
  }

  // ---- checklist_title ----
  if (action === 'checklist_title') {
    if (!text || text.length < 2) {
      const r = await bot.sendMessage(chatId, '⚠️ Judul minimal 2 karakter!', { reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    setPending(userId, 'checklist_items', { title: text, items: [] });
    await bot.sendMessage(chatId,
      `✅ *Judul:* ${text}\n\nKetik item checklist (1 per baris):\n_Ketik \`selesai\` untuk kirim checklist._`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
    );
    return;
  }

  // ---- checklist_items ----
  if (action === 'checklist_items') {
    const p = pending.data;
    if (text.toLowerCase() === 'selesai') {
      if (p.items.length === 0) {
        const r = await bot.sendMessage(chatId, '⚠️ Minimal 1 item!');
        autoDeleteMessage(bot, chatId, r.message_id, 5);
        return;
      }
      pendingActions.delete(userId);
      const caption = `✅ *${p.title}*\n\n${p.items.map((item, i) => `☐ ${item}`).join('\n')}`;
      const r = await bot.sendMessage(chatId, caption, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'fun_menu' }]] }
      });
      autoDeleteMessage(bot, chatId, r.message_id, 60);
      return;
    }
    p.items.push(text);
    await bot.sendMessage(chatId,
      `✅ Item ${p.items.length}: ${text}\n\nKetik item berikut atau \`selesai\``,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'fun_menu' }]] } }
    );
    return;
  }

  // ---- gallery_filter ----
  if (action === 'gallery_filter') {
    // SECURITY: Hanya admin
    if (!isAdmin(userId)) {
      pendingActions.delete(userId);
      const r = await bot.sendMessage(chatId, '🔒 Hanya admin yang bisa akses filter!');
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    const filterName = text.replace(/^!/, '').trim().toLowerCase().replace(/\s+/g, ' ');
    pendingActions.delete(userId);
    if (!filterName) {
      const r = await bot.sendMessage(chatId, '⚠️ Ketik nama filter!');
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    const filter = await db.getFilter(filterName).catch(() => null);
    if (!filter) {
      const r = await bot.sendMessage(chatId, `⚠️ Filter *${filterName}* tidak ditemukan!`, { parse_mode: 'Markdown' });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    const media = [];
    if (filter.photo)      media.push({ type: 'photo',  media: filter.photo });
    if (filter.video)      media.push({ type: 'video',  media: filter.video });
    if (filter.animation)  media.push({ type: 'photo',  media: filter.animation });
    if (filter.document)   media.push({ type: 'document', media: filter.document });
    if (filter.audio)      media.push({ type: 'audio',  media: filter.audio });
    if (filter.sticker)    media.push({ type: 'photo',  media: filter.sticker });

    if (media.length === 0) {
      const r = await bot.sendMessage(chatId, `📭 Filter *${filterName}* hanya berisi teks, tidak ada media untuk gallery.`, { parse_mode: 'Markdown' });
      autoDeleteMessage(bot, chatId, r.message_id, 5);
      return;
    }
    try {
      await bot.sendMediaGroup(chatId, media.slice(0, 10));
      const r = await bot.sendMessage(chatId, `🖼️ *Gallery: ${filterName}*`, { parse_mode: 'Markdown' });
      autoDeleteMessage(bot, chatId, r.message_id, 10);
    } catch (err) {
      const r = await bot.sendMessage(chatId, `❌ Error: ${err.message.substring(0, 100)}`);
      autoDeleteMessage(bot, chatId, r.message_id, 5);
    }
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
  next.setUTCHours(2, 0, 0, 0); // 02:00 UTC = 09:00 WIB (UTC+7)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

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
