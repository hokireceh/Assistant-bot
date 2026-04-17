const { GROQ_API_KEY, AI_ENABLED, AI_MODELS, MAX_CONVERSATION_LENGTH } = require('./config');
const { isOwner, isAdmin } = require('./utils');
const db = require('./db');

// ============================================================
// AI STATE (in-memory)
// ============================================================

const aiConversations = new Map(); // userId -> message history
const aiRateLimits    = new Map(); // userId -> last request timestamp
const AI_COOLDOWN_MS  = 3000;

let aiStats = {
  totalRequests: 0,
  successfulResponses: 0,
  failedResponses: 0,
  modelUsage: {}
};

// Notification stats (shared with notification system)
const notificationStats = {
  welcomesSent: 0,
  dailyStatsSent: 0,
  alertsSent: 0
};

// ============================================================
// MODEL COUNTER RESET
// ============================================================

function resetModelCounters() {
  const now = Date.now();
  for (const m of AI_MODELS) {
    if (now - m.lastRpmReset   > 60000)    { m.rpmUsed = 0; m.lastRpmReset   = now; }
    if (now - m.lastDailyReset > 86400000) { m.used    = 0; m.lastDailyReset = now;
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
  const userIsAdmin  = isAdmin(userId);
  const complexity   = analyzeComplexity(userMessage);
  console.log(`🔍 Query complexity: ${complexity}`);

  if (userIsAdmin && complexity === 'complex') {
    const m = AI_MODELS.find(m => m.tier === 1);
    if (m && isModelAvailable(m)) { console.log(`✅ Tier 1 (premium): ${m.name}`); return m; }
  }

  const m2 = AI_MODELS.find(m => m.tier === 2);
  if (m2 && isModelAvailable(m2)) { console.log(`✅ Tier 2 (general): ${m2.name}`); return m2; }

  const m3 = AI_MODELS.find(m => m.tier === 3);
  if (m3 && isModelAvailable(m3)) { console.log(`✅ Tier 3 (fallback): ${m3.name}`); return m3; }

  const m1 = AI_MODELS.find(m => m.tier === 1);
  if (m1 && isModelAvailable(m1)) { console.log(`✅ Tier 1 (last resort): ${m1.name}`); return m1; }

  return null;
}

// ============================================================
// LANGUAGE DETECTION
// ============================================================

function detectLanguage(text) {
  const id = ['apa','yang','ini','itu','dan','atau','saya','kamu','dia','dengan','untuk','dari'];
  const en = ['what','that','this','and','or','the','you','they','with','for','from'];
  const lc = text.toLowerCase();
  const idCount = id.filter(w => lc.includes(w)).length;
  const enCount = en.filter(w => lc.includes(w)).length;
  if (idCount > enCount) return 'id-ID';
  if (enCount > idCount) return 'en-US';
  return 'id-ID';
}

// ============================================================
// AI RATE LIMIT CHECK
// ============================================================

function checkAIRateLimit(userId) {
  const last = aiRateLimits.get(userId) || 0;
  const elapsed = Date.now() - last;
  if (elapsed < AI_COOLDOWN_MS) {
    return { allowed: false, remaining: Math.ceil((AI_COOLDOWN_MS - elapsed) / 1000) };
  }
  aiRateLimits.set(userId, Date.now());
  return { allowed: true };
}

// ============================================================
// GROQ API CALL
// ============================================================

async function callGroqAPI(userMessage, userId) {
  const model = getBestModel(userId, userMessage);
  if (!model) {
    throw new Error('⚠️ Semua model AI lagi rate limited! Tunggu 1 menit yaa~ 🙏');
  }

  // Sanitize BEFORE building messages
  const sanitizedMessage = userMessage.replace(/```/g, '').substring(0, 1000);

  const history     = aiConversations.get(userId) || [];
  const recentHist  = history.slice(-Math.min(5, MAX_CONVERSATION_LENGTH));
  const lang        = detectLanguage(sanitizedMessage);
  const userRole    = isOwner(userId) ? 'Owner' : isAdmin(userId) ? 'Admin' : 'User';

  const roleContext = userRole === 'Owner'
    ? 'User ini adalah OWNER bot (pemilik utama), punya akses penuh ke semua fitur.'
    : userRole === 'Admin'
    ? 'User ini adalah ADMIN, bisa manage filters, ban user, lihat stats, dll.'
    : 'User ini adalah user biasa, cuma bisa pakai filters yang udah ada.';

  // Filter knowledge base for AI context
  let filterKnowledge = '';
  try {
    const count = await db.getFilterCount();
    if (count > 0) {
      const names = (await db.getFilterNames()).slice(0, 20);
      filterKnowledge = `\n\nFILTER KNOWLEDGE BASE (${count} total):\n` +
        names.map(n => `- !${n}`).join('\n') +
        (count > 20 ? `\n(dan ${count - 20} filters lainnya...)` : '');
    }
  } catch (_) {}

  const langInstr = lang === 'en-US'
    ? `LANGUAGE: English. Use natural friendly English, max 1-2 emojis.`
    : `LANGUAGE: Indonesian sehari-hari. Pakai "sih","nih","yaa","~", max 1-2 emoji.`;

  const messages = [
    {
      role: 'system',
      content: `Kamu adalah Hoki, AI assistant yang ramah dan helpful di Telegram bot.\n\nUSER CONTEXT:\n${roleContext}\n\nPERSONALITY:\n- Ramah kayak teman baik\n- Helpful dan concise (langsung to the point)\n${langInstr}\n\nRULES:\n- Jangan bahas politik/agama/hal sensitif\n- Jangan kasih info yang berbahaya\n- Kalau gak tau, bilang jujur\n- Jawaban singkat tapi jelas (2-3 kalimat max)\n- Fokus bantu user dengan pertanyaannya${filterKnowledge}\n\nRespond in the detected language and adjust helpfulness based on user role!`
    },
    ...recentHist,
    { role: 'user', content: sanitizedMessage }
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model.name,
      messages,
      temperature: 0.8,
      max_tokens: 300,
      top_p: 0.9
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status}`);
  }

  const data      = await response.json();
  const aiReply   = data.choices[0].message.content;

  model.used++;
  model.rpmUsed++;

  console.log(`📊 ${model.name} | RPM:${model.rpmUsed}/${model.rpm} Daily:${model.used}/${model.dailyLimit}`);

  // Save to conversation history (sanitized version)
  history.push({ role: 'user',      content: sanitizedMessage });
  history.push({ role: 'assistant', content: aiReply });
  aiConversations.set(userId, history.slice(-MAX_CONVERSATION_LENGTH * 2));

  aiStats.totalRequests++;
  aiStats.successfulResponses++;
  aiStats.modelUsage[model.name] = (aiStats.modelUsage[model.name] || 0) + 1;

  return { response: aiReply, model: model.name, tier: model.tier, tokens: data.usage?.total_tokens || 0 };
}

// ============================================================
// STALE CONVERSATION CLEANUP (by idle time, not length)
// ============================================================

setInterval(() => {
  // Cleanup: setiap interval, hapus conversation yang tidak pernah update (no timestamp tracking)
  // Since conversation is trimmed di callGroqAPI, cleanup ini untuk user tidak aktif > 1 jam
  // Kita track last activity dengan aiRateLimits (last request time)
  const oneHourAgo = Date.now() - 3600000;
  for (const [userId, lastTime] of aiRateLimits.entries()) {
    if (lastTime < oneHourAgo) {
      aiConversations.delete(userId);
      aiRateLimits.delete(userId);
      console.log(`🧹 Cleaned up stale conversation for user ${userId}`);
    }
  }
}, 60000);

// ============================================================
// STATS HELPERS
// ============================================================

function getAIStats() {
  return aiStats;
}

function getAIConversations() {
  return aiConversations;
}

function resetAIStats() {
  AI_MODELS.forEach(m => {
    m.used    = 0;
    m.rpmUsed = 0;
  });
  // Reset guard model counters juga
  if (GUARD_MODEL) {
    GUARD_MODEL.rpmUsed = 0;
    GUARD_MODEL.used    = 0;
  }
  aiConversations.clear();
  aiRateLimits.clear();
  aiStats = { totalRequests: 0, successfulResponses: 0, failedResponses: 0, modelUsage: {} };
  console.log('✅ AI stats, conversations, dan rate limits berhasil di-reset');
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
