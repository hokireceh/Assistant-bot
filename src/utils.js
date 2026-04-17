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
    try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
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

module.exports = {
  loadAdmins, isAdmin, isOwner, getAdmins,
  checkRateLimit,
  isTimedOut, getTimeoutRemaining,
  autoDeleteMessage, deleteTimers,
  entitiesToHTML, escapeHTML,
  createPagination
};
