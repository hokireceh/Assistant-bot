require('dotenv').config();

const OWNER_ID = parseInt(process.env.OWNER_ID);

const AI_MODELS = [
  {
    name: 'llama-3.3-70b-versatile',
    dailyLimit: 1000,
    tokensPerDay: 100000,
    tokensPerMin: 12000,
    rpm: 30,
    quality: 10,
    latency: 300,
    used: 0,
    rpmUsed: 0,
    lastRpmReset: Date.now(),
    lastDailyReset: Date.now(),
    tier: 1,
    use: 'premium',
    description: 'Best quality - Admin priority, complex reasoning'
  },
  {
    name: 'groq/compound-mini',
    dailyLimit: 250,
    tokensPerDay: Infinity,
    tokensPerMin: 70000,
    rpm: 30,
    quality: 8,
    latency: 150,
    used: 0,
    rpmUsed: 0,
    lastRpmReset: Date.now(),
    lastDailyReset: Date.now(),
    tier: 2,
    use: 'general',
    description: 'Speed king - Unlimited tokens, fast responses'
  },
  {
    name: 'llama-3.1-8b-instant',
    dailyLimit: 14400,
    tokensPerDay: 500000,
    tokensPerMin: 6000,
    rpm: 30,
    quality: 7,
    latency: 100,
    used: 0,
    rpmUsed: 0,
    lastRpmReset: Date.now(),
    lastDailyReset: Date.now(),
    tier: 3,
    use: 'fallback',
    description: 'High capacity fallback - 14.4K daily limit'
  }
];

const GUARD_MODEL = {
  name: 'meta-llama/llama-prompt-guard-2-86m',
  dailyLimit: 14400,
  tokensPerMin: 15000,
  tokensPerDay: 500000,
  rpm: 30,
  used: 0,
  rpmUsed: 0,
  lastRpmReset: Date.now(),
  lastDailyReset: Date.now(),
  use: 'moderation'
};

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  OWNER_ID,
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  AI_ENABLED: (process.env.GROQ_API_KEY || '').length > 0,
  RATE_LIMIT_WINDOW: 1000,
  MAX_REQUESTS: 5,
  AI_COOLDOWN_MS: 3000,
  MAX_CONVERSATION_LENGTH: 10,
  AI_MODELS,
  GUARD_MODEL
};
