# Telegram Bot - Admin & Filter Management

## 📋 Overview
Bot Telegram untuk manajemen filter dengan sistem admin. Bot ini **hanya bisa diakses oleh admin** yang terdaftar di `.env`.

## 🏗️ Arsitektur (v2.0)

```
index.js              — Entry point, bot init, startup
src/
  config.js           — Constants, AI model config
  db.js               — PostgreSQL queries (semua CRUD)
  ai.js               — AI cascade system (Groq, 3-tier)
  keyboards.js        — Inline keyboard & menu keyboard builders
  utils.js            — isAdmin, rateLimit, autoDelete, entitiesToHTML
  handlers.js         — Semua handler (commands, callbacks, messages)
```

## 🗄️ Database (PostgreSQL)
Menggunakan Replit PostgreSQL built-in. Tabel:
- `filters` — data filter (nama, media, teks, entities, buttons)
- `user_analytics` — tracking non-admin yang mencoba akses bot
- `spam_timeouts` — timeout aktif per user

## 🔐 Sistem Admin
Admin diatur manual di `.env`:
```env
BOT_TOKEN=xxx
OWNER_ID=1170158500
ADMIN_IDS=1170158500,123456789
GROQ_API_KEY=xxx (optional)
```

## 📱 UI System
- `/start` → Main Menu (inline keyboard)
- `/help` → Panduan lengkap
- **Menu Keyboard** (persistent reply keyboard) untuk akses cepat
- **Semua operasi** via inline keyboard — tidak ada text command kecuali /start, /help, /timeout, dan !aireset

## 🎯 Flow Filter Management
1. Tekan **🎯 Kelola Filter** di menu
2. Pilih aksi (Tambah / Hapus / Daftar / Cari / Clone / Rename / Export)
3. Ikuti instruksi bot (multi-step via pendingActions)

## 🤖 AI Hoki (3-Tier Cascade)
- Tier 1: `llama-3.3-70b-versatile` — Admin, query complex
- Tier 2: `groq/compound-mini` — General, unlimited tokens
- Tier 3: `llama-3.1-8b-instant` — Fallback, 14.4K req/day

## 🔒 Security
- Admin-only access
- Rate limiting (5 req/sec per user)
- Spam timeout system (DB-backed, persistent)
- AI prompt sanitization (sanitizedMessage → API & history)
- botId di-cache saat startup (tidak dipanggil per pesan)

## 📝 Changelog

### v2.0.0 (Current)
- ✅ Full refactor: modular structure (src/ directory)
- ✅ PostgreSQL menggantikan JSON file storage
- ✅ Inline keyboard + menu keyboard (full UI overhaul)
- ✅ Hilangkan semua text command kecuali /start, /help, /timeout
- ✅ pendingActions untuk multi-step flows
- ✅ BUG-001 fix: sanitizedMessage dikirim ke Groq API
- ✅ BUG-002 fix: botId di-cache saat startup
- ✅ BUG-003 fix: stale conversation cleanup berdasarkan idle time
- ✅ BUG-004 fix: !aireset reset rpmUsed + used
- ✅ BUG-005 fix: admin tidak di-track sebagai non-admin
- ✅ BUG-006 fix: OWNER_ID selalu masuk array admins

### v1.1.0
- AI cascade 3-tier, guard model, notification system

### v1.0.0
- Initial release
