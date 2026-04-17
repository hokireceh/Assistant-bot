const { GROQ_API_KEY, AI_ENABLED, AI_MODELS, GUARD_MODEL, MAX_CONVERSATION_LENGTH } = require('./config');
const { isOwner, isAdmin } = require('./utils');
const db = require('./db');

// ============================================================
// AI STATE (in-memory)
// ============================================================
const aiConversations = new Map(); // userId -> message history
const aiRateLimits    = new Map(); // userId -> last request timestamp (ms)
const AI_COOLDOWN_MS  = 3000;

let aiStats = {
  totalRequests:        0,
  successfulResponses:  0,
  failedResponses:      0,
  modelUsage:           {}
};

// Notification stats (shared dengan handlers.js via module ref)
const notificationStats = {
  welcomesSent:    0,
  dailyStatsSent:  0,
  alertsSent:      0
};

// ============================================================
// MODEL COUNTER AUTO-RESET
// ============================================================
function resetModelCounters() {
  const now = Date.now();
  for (const m of AI_MODELS) {
    if (now - m.lastRpmReset   > 60000)    { m.rpmUsed = 0; m.lastRpmReset   = now; }
    if (now - m.lastDailyReset > 86400000) {
      m.used = 0; m.lastDailyReset = now;
      console.log(`🔄 Daily counter reset: ${m.name}`);
    }
  }
}

function isModelAvailable(model) {
  return model.rpmUsed < model.rpm && model.used < model.dailyLimit;
}

// ============================================================
// COMPLEXITY DETECTION
// ============================================================
function analyzeComplexity(text) {
  let score = 0;
  if (text.length > 500)                                                 score += 0.3;
  if (text.split('\n').length > 5)                                       score += 0.2;
  if (/code|function|algorithm|technical|explain.*detail/i.test(text))  score += 0.3;
  if (/explain|analyze|compare|detailed|how.*work/i.test(text))         score += 0.2;
  if (score < 0.3) return 'simple';
  if (score < 0.7) return 'medium';
  return 'complex';
}

// ============================================================
// MODEL SELECTION (3-TIER CASCADE)
// ============================================================
function getBestModel(userId, userMessage) {
  resetModelCounters();
  const userIsAdmin = isAdmin(userId);
  const complexity  = analyzeComplexity(userMessage);
  console.log(`🔍 Complexity: ${complexity}`);

  // Tier 1 hanya untuk admin + complex
  if (userIsAdmin && complexity === 'complex') {
    const m = AI_MODELS.find(m => m.tier === 1);
    if (m && isModelAvailable(m)) { console.log(`✅ T1: ${m.name}`); return m; }
  }
  // Tier 2 general
  const m2 = AI_MODELS.find(m => m.tier === 2);
  if (m2 && isModelAvailable(m2)) { console.log(`✅ T2: ${m2.name}`); return m2; }
  // Tier 3 fallback
  const m3 = AI_MODELS.find(m => m.tier === 3);
  if (m3 && isModelAvailable(m3)) { console.log(`✅ T3: ${m3.name}`); return m3; }
  // Last resort: Tier 1 anyway
  const m1 = AI_MODELS.find(m => m.tier === 1);
  if (m1 && isModelAvailable(m1)) { console.log(`✅ T1 last: ${m1.name}`); return m1; }
  return null;
}

// ============================================================
// LANGUAGE DETECTION
// ============================================================
function detectLanguage(text) {
  const idWords = ['apa','yang','ini','itu','dan','atau','saya','kamu','dia','dengan','untuk','dari'];
  const enWords = ['what','that','this','and','or','the','you','they','with','for','from'];
  const lc    = text.toLowerCase();
  const idCnt = idWords.filter(w => lc.includes(w)).length;
  const enCnt = enWords.filter(w => lc.includes(w)).length;
  if (idCnt > enCnt) return 'id-ID';
  if (enCnt > idCnt) return 'en-US';
  return 'id-ID';
}

// ============================================================
// AI RATE LIMIT CHECK
// ============================================================
function checkAIRateLimit(userId) {
  const last    = aiRateLimits.get(userId) || 0;
  const elapsed = Date.now() - last;
  if (elapsed < AI_COOLDOWN_MS) {
    return { allowed: false, remaining: Math.ceil((AI_COOLDOWN_MS - elapsed) / 1000) };
  }
  aiRateLimits.set(userId, Date.now());
  return { allowed: true };
}

// ============================================================
// GROQ API CALL — dengan timeout 30 detik
// Semua stats ditrack di sini (totalRequests, success, failed)
// ============================================================
async function callGroqAPI(userMessage, userId) {
  // Track SETIAP permintaan di awal
  aiStats.totalRequests++;

  const model = getBestModel(userId, userMessage);
  if (!model) {
    aiStats.failedResponses++;
    throw new Error('⚠️ Semua model AI lagi rate limited! Tunggu 1 menit yaa~ 🙏');
  }

  // Sanitize sebelum kirim ke API (BUG-001 fix)
  const sanitizedMessage = userMessage.replace(/```/g, '').substring(0, 1000);

  const history    = aiConversations.get(userId) || [];
  const recentHist = history.slice(-Math.min(5, MAX_CONVERSATION_LENGTH));
  const lang       = detectLanguage(sanitizedMessage);
  const userRole   = isOwner(userId) ? 'Owner' : isAdmin(userId) ? 'Admin' : 'User';

  const roleContext = userRole === 'Owner'
    ? 'User ini adalah OWNER bot (pemilik utama), punya akses penuh ke semua fitur.'
    : userRole === 'Admin'
    ? 'User ini adalah ADMIN, bisa manage filters, timeout user, lihat stats, dll.'
    : 'User ini adalah user biasa, cuma bisa pakai filters yang udah ada.';

  // Filter knowledge base (max 20 nama)
  let filterKnowledge = '';
  try {
    const count = await db.getFilterCount();
    if (count > 0) {
      const names = (await db.getFilterNames()).slice(0, 20);
      filterKnowledge = `\n\nFILTER KNOWLEDGE BASE (${count} total):\n` +
        names.map(n => `- !${n}`).join('\n') +
        (count > 20 ? `\n(dan ${count - 20} lainnya...)` : '');
    }
  } catch (_) {}

  const langInstr = lang === 'en-US'
    ? 'LANGUAGE: English. Natural friendly English, max 1-2 emojis.'
    : 'LANGUAGE: Bahasa Indonesia sehari-hari. Pakai "sih","nih","yaa","~", max 1-2 emoji.';

  const messages = [
    {
      role:    'system',
      content: `Kamu adalah Hoki, AI assistant yang ramah di Telegram bot.\n\nUSER CONTEXT:\n${roleContext}\n\nPERSONALITY:\n- Ramah kayak teman baik\n- Helpful dan concise (langsung to the point)\n${langInstr}\n\nRULES:\n- Jangan bahas politik/agama/hal sensitif\n- Jangan kasih info berbahaya\n- Kalau gak tau, bilang jujur\n- Jawaban singkat tapi jelas (2-3 kalimat max)${filterKnowledge}`
    },
    ...recentHist,
    { role: 'user', content: sanitizedMessage }
  ];

  // AbortController untuk timeout 30 detik
  const controller   = new AbortController();
  const timeout      = setTimeout(() => controller.abort(), 30000);
  let alreadyCounted = false;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body:   JSON.stringify({
        model:       model.name,
        messages,
        temperature: 0.8,
        max_tokens:  300,
        top_p:       0.9
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      aiStats.failedResponses++;
      alreadyCounted = true;
      throw new Error(`Groq API ${response.status}: ${errBody.substring(0, 100)}`);
    }

    const data = await response.json();

    if (!data?.choices?.[0]?.message?.content) {
      aiStats.failedResponses++;
      alreadyCounted = true;
      throw new Error('Groq API returned empty response');
    }

    const aiReply = data.choices[0].message.content;

    // Update model counters
    model.used++;
    model.rpmUsed++;
    console.log(`📊 ${model.name} | RPM:${model.rpmUsed}/${model.rpm} Daily:${model.used}/${model.dailyLimit}`);

    // Simpan ke history (versi sanitized)
    history.push({ role: 'user',      content: sanitizedMessage });
    history.push({ role: 'assistant', content: aiReply });
    aiConversations.set(userId, history.slice(-MAX_CONVERSATION_LENGTH * 2));

    // Update stats
    aiStats.successfulResponses++;
    aiStats.modelUsage[model.name] = (aiStats.modelUsage[model.name] || 0) + 1;

    return { response: aiReply, model: model.name, tier: model.tier, tokens: data.usage?.total_tokens || 0 };

  } catch (err) {
    clearTimeout(timeout);
    if (!alreadyCounted) aiStats.failedResponses++;
    if (err.name === 'AbortError') {
      throw new Error('Groq API timeout (30s) — coba lagi yaa 🙏');
    }
    throw err;
  }
}

// ============================================================
// STALE CONVERSATION CLEANUP
// Setiap 15 menit, hapus conversation idle > 1 jam (FIX-028)
// ============================================================
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  let cleaned = 0;
  for (const [uid, lastTime] of aiRateLimits.entries()) {
    if (lastTime < oneHourAgo) {
      aiConversations.delete(uid);
      aiRateLimits.delete(uid);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} stale AI conversations`);
}, 15 * 60 * 1000);

// ============================================================
// STATS HELPERS
// ============================================================
function getAIStats()         { return aiStats; }
function getAIConversations() { return aiConversations; }

function resetAIStats() {
  AI_MODELS.forEach(m => { m.used = 0; m.rpmUsed = 0; });
  if (GUARD_MODEL)  { GUARD_MODEL.rpmUsed = 0; GUARD_MODEL.used = 0; }
  aiConversations.clear();
  aiRateLimits.clear();
  aiStats = { totalRequests: 0, successfulResponses: 0, failedResponses: 0, modelUsage: {} };
  console.log('✅ AI stats, conversations, rate limits di-reset');
}

module.exports = {
  AI_ENABLED: (process.env.GROQ_API_KEY || '').length > 0,
  callGroqAPI,
  checkAIRateLimit,
  getAIStats,
  getAIConversations,
  resetAIStats,
  notificationStats
};
