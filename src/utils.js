const { OWNER_ID, RATE_LIMIT_WINDOW, MAX_REQUESTS } = require('./config');
const db = require('./db');

// ============================================================
// ADMIN MANAGEMENT
// ============================================================

let adminsSet = new Set();

function loadAdmins() {
  const adminIds = process.env.ADMIN_IDS || '';
  const ids = adminIds
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id) && id > 0);
  ids.push(OWNER_ID);
  adminsSet = new Set(ids);
  return [...adminsSet];
}

function isAdmin(userId) {
  return userId === OWNER_ID || adminsSet.has(userId);
}

function isOwner(userId) {
  return userId === OWNER_ID;
}

function getAdmins() {
  return [...adminsSet];
}

// ============================================================
// RATE LIMITING (in-memory)
// ============================================================

const rateLimits = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const times = (rateLimits.get(userId) || []).filter(t => now - t < RATE_LIMIT_WINDOW);
  if (times.length >= MAX_REQUESTS) return false;
  times.push(now);
  rateLimits.set(userId, times);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [uid, times] of rateLimits.entries()) {
    const valid = times.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (valid.length === 0) rateLimits.delete(uid);
    else rateLimits.set(uid, valid);
  }
}, 60000);

// ============================================================
// SPAM TIMEOUT CHECK
// ============================================================

async function isTimedOut(userId) {
  const t = await db.getSpamTimeout(userId);
  if (!t) return false;
  if (Date.now() > Number(t.until_ts)) {
    await db.clearSpamTimeout(userId);
    return false;
  }
  return true;
}

async function getTimeoutRemaining(userId) {
  const t = await db.getSpamTimeout(userId);
  if (!t) return 0;
  return Math.ceil((Number(t.until_ts) - Date.now()) / 1000);
}

// ============================================================
// AUTO DELETE
// ============================================================

const deleteTimers = new Map();

function autoDeleteMessage(bot, chatId, messageId, delayMinutes = 3) {
  const key = `${chatId}_${messageId}`;
  if (deleteTimers.has(key)) clearTimeout(deleteTimers.get(key));
  const timer = setTimeout(async () => {
    try { await bot.api.deleteMessage(chatId, messageId); } catch (_) {}
    finally { deleteTimers.delete(key); }
  }, delayMinutes * 60 * 1000);
  deleteTimers.set(key, timer);
}

// ============================================================
// HTML ENTITY CONVERSION
// ============================================================

function entitiesToHTML(text, entities) {
  if (!entities || entities.length === 0) return escapeHTML(text);

  const sorted = [...entities].sort((a, b) => a.offset - b.offset);
  const segments = [];
  let last = 0;

  for (const { offset, length, type, url, user } of sorted) {
    if (offset > last) {
      segments.push({ text: text.substring(last, offset), type: 'plain' });
    }
    segments.push({ text: text.substring(offset, offset + length), type, url, user });
    last = offset + length;
  }
  if (last < text.length) {
    segments.push({ text: text.substring(last), type: 'plain' });
  }

  let result = '';
  for (const { text: t, type, url, user } of segments) {
    const e = escapeHTML(t);
    switch (type) {
      case 'plain':        result += e; break;
      case 'bold':         result += `<b>${e}</b>`; break;
      case 'italic':       result += `<i>${e}</i>`; break;
      case 'underline':    result += `<u>${e}</u>`; break;
      case 'strikethrough':result += `<s>${e}</s>`; break;
      case 'code':         result += `<code>${e}</code>`; break;
      case 'pre':          result += `<pre>${e}</pre>`; break;
      case 'text_link':    result += `<a href="${escapeHTML(url)}">${e}</a>`; break;
      case 'text_mention': result += `<a href="tg://user?id=${user.id}">${e}</a>`; break;
      case 'spoiler':      result += `<tg-spoiler>${e}</tg-spoiler>`; break;
      default:             result += e; break;
    }
  }
  return result;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// PAGINATION
// ============================================================

function createPagination(items, page, perPage = 15) {
  const total = Math.ceil(items.length / perPage);
  const safePage = Math.max(1, Math.min(page, total));
  const start = (safePage - 1) * perPage;
  return { items: items.slice(start, start + perPage), total, page: safePage };
}

const { getTopicId, sendTelegramMessage } = require('./TopicTracker');

// ============================================================
// TELEGRAM API HELPER — direct API calls untuk fitur baru
// Auto-inject message_thread_id untuk group forum topic
// ============================================================
async function telegramAPI(method, body = {}) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN not set');

  // Auto-inject message_thread_id untuk group messages
  if (!body.message_thread_id && body.chat_id && parseInt(body.chat_id, 10) < 0) {
    const tid = getTopicId(String(body.chat_id));
    if (tid) body.message_thread_id = tid;
  }

  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API error');
  return data.result;
}

// ============================================================
// SEND RICH MESSAGE — kirim pesan rich formatted
// InputRichMessage: { html: "..." } atau { markdown: "..." }
// ============================================================
async function sendRichMessage(chatId, content, options = {}) {
  return telegramAPI('sendRichMessage', {
    chat_id: chatId,
    rich_message: typeof content === 'string' ? { markdown: content } : content,
    ...options
  });
}

// ============================================================
// SEND RICH MESSAGE DRAFT — streaming rich formatted message
// draft_id: unique ID untuk animasi (yang sama = animated update)
// ============================================================
async function sendRichMessageDraft(chatId, draftId, content, extraOpts = {}) {
  return telegramAPI('sendRichMessageDraft', {
    chat_id: chatId,
    draft_id: draftId,
    rich_message: typeof content === 'string' ? { markdown: content } : content,
    ...extraOpts
  });
}

// ============================================================
// SEND EPHEMERAL MESSAGE — pesan yang hanya terlihat user tertentu
// Bot API 10.2: receiver_user_id parameter
// ============================================================
async function sendEphemeral(chatId, userId, text, options = {}) {
  return telegramAPI('sendMessage', {
    chat_id: chatId,
    text,
    receiver_user_id: userId,
    ...options
  });
}

async function sendEphemeralRich(chatId, userId, content, options = {}) {
  return telegramAPI('sendRichMessage', {
    chat_id: chatId,
    receiver_user_id: userId,
    rich_message: typeof content === 'string' ? { markdown: content } : content,
    ...options
  });
}

// ============================================================
// AUTO EPHEMERAL — kirim pesan ephemeral + auto-delete fallback
// Jika ephemeral gagal (group tidak support), fallback ke autoDelete
// ============================================================
async function sendAutoEphemeral(bot, chatId, userId, text, options = {}, deleteDelayMin = 3) {
  try {
    return await sendEphemeral(chatId, userId, text, options);
  } catch (_) {
    const r = await sendTelegramMessage(bot, chatId, text, options);
    autoDeleteMessage(bot, chatId, r.message_id, deleteDelayMin);
    return r;
  }
}

// ============================================================
// SEND MESSAGE DRAFT — streaming partial message (30s preview)
// ============================================================
async function sendMessageDraft(chatId, text) {
  return telegramAPI('sendMessageDraft', { chat_id: chatId, text });
}

// ============================================================
// SEND CHECKLIST — interactive checklist
// ============================================================
async function sendChecklist(chatId, title, tasks) {
  return telegramAPI('sendChecklist', {
    chat_id: chatId,
    checklist: {
      title,
      tasks: tasks.map(t => ({ text: t }))
    }
  });
}

// ============================================================
// ANSWER GUEST QUERY — reply to guest messages
// Bot API 10.0: Guest Mode
// ============================================================
async function answerGuestQuery(guestQueryId, result) {
  return telegramAPI('answerGuestQuery', {
    guest_query_id: guestQueryId,
    result
  });
}

// ============================================================
// RICH MESSAGE BLOCK BUILDERS
// Helper untuk membuat structured rich message blocks
// ============================================================
function richBlock(type, content) {
  return { type, ...content };
}

function richText(type, text, extra = {}) {
  return { type, text, ...extra };
}

function richParagraph(...segments) {
  return richBlock('paragraph', { text: segments });
}

function richHeading(text, level = 2) {
  return richBlock('section_heading', { text: [richText('text', text)], level });
}

function richPreformatted(text, language = '') {
  return richBlock('preformatted', {
    text: [richText('text', text)],
    ...(language ? { language } : {})
  });
}

function richList(items, ordered = false) {
  return richBlock('list', {
    items: items.map(text => ({
      text: [richText('text', text)]
    })),
    ordered
  });
}

function richTable(headers, rows) {
  return richBlock('table', {
    cells: [
      headers.map(h => ({ text: [richText('text', h)], header: true })),
      ...rows.map(row => row.map(cell => ({ text: [richText('text', cell)] })))
    ]
  });
}

function richDivider() {
  return richBlock('divider', {});
}

function richFooter(text) {
  return richBlock('footer', { text: [richText('text', text)] });
}

function richBlockquote(text) {
  return richBlock('block_quotation', { text: [richText('text', text)] });
}

function richCollage(media) {
  return richBlock('collage', { media });
}

function richSlideshow(media) {
  return richBlock('slideshow', { media });
}

function richDetails(summary, blocks) {
  return richBlock('details', {
    summary: [richText('text', summary)],
    blocks
  });
}

function richThinking(text) {
  return richBlock('thinking', { text: [richText('text', text)] });
}

function richMap(latitude, longitude, zoom = 15) {
  return richBlock('map', { latitude, longitude, zoom });
}

async function sendRichMessageBlocks(chatId, blocks, options = {}) {
  return telegramAPI('sendRichMessage', {
    chat_id: chatId,
    rich_message: { blocks },
    ...options
  });
}

module.exports = {
  loadAdmins, isAdmin, isOwner, getAdmins,
  checkRateLimit,
  isTimedOut, getTimeoutRemaining,
  autoDeleteMessage, deleteTimers,
  entitiesToHTML, escapeHTML,
  createPagination,
  telegramAPI, sendMessageDraft, sendRichMessage, sendRichMessageDraft, sendChecklist,
  answerGuestQuery,
  sendEphemeral, sendEphemeralRich, sendAutoEphemeral,
  richBlock, richText, richParagraph, richHeading, richPreformatted,
  richList, richTable, richDivider, richFooter, richBlockquote,
  richCollage, richSlideshow, richDetails, richThinking, richMap,
  sendRichMessageBlocks
};
