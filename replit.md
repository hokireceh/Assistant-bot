
# Telegram Bot - Admin & Filter Management

## 📋 Overview
Bot Telegram untuk manajemen filter dengan sistem admin. Bot ini **hanya bisa diakses oleh admin** yang terdaftar di `.env`.

## 🏗️ Arsitektur

```
index.js              — Entry point, bot init, PM2, startup
schema.sql            — PostgreSQL DDL (filters, analytics, timeouts)
src/
  config.js           — Constants, AI model config, TELEGRAM_TOPIC_GROUPS
  db.js               — PostgreSQL pool + queries (semua CRUD)
  ai.js               — AI cascade system (Groq, 3-tier)
  keyboards.js        — Inline keyboard & menu keyboard builders
  utils.js            — Telegram API helpers, Rich Message, entitiesToRichSegments, pagination
  handlers.js         — Semua handler (commands, callbacks, messages, filter trigger)
  TopicTracker.js     — Forum topic detection & message routing
```

## 🗄️ Database (PostgreSQL / Neon Cloud)
Menggunakan Neon cloud PostgreSQL. Tabel:
- `filters` — data filter (nama, media, teks, entities, buttons)
- `user_analytics` — tracking non-admin yang mencoba akses bot
- `spam_timeouts` — timeout aktif per user

Setup:
```bash
psql $DATABASE_URL -f schema.sql
```

## 🔐 Sistem Admin
Admin diatur manual di `.env`:
```env
BOT_TOKEN=xxx
OWNER_ID=1170158500
ADMIN_IDS=1170158500,123456789
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
GROQ_API_KEY=xxx (optional)
TELEGRAM_TOPIC_GROUPS=-1001234567890 (optional)
```

## 📱 UI System
- `/start` → Main Menu (inline keyboard)
- `/help` → Panduan lengkap
- **Menu Keyboard** (persistent reply keyboard) untuk akses cepat
- **Semua operasi** via inline keyboard — tidak ada text command kecuali /start, /help, /timeout, dan !aireset

## 🎯 Filter Management
### Flow
1. Tekan **🎯 Kelola Filter** di menu
2. Pilih aksi (Tambah / Hapus / Daftar / Cari / Clone / Rename / Export)
3. Ikuti instruksi bot (multi-step via pendingActions)

### Auto-Trigger (Tanpa Prefix)
Filter langsung trigger tanpa perlu `!`:
```
hongkong        ← langsung trigger
!hongkong       ← masih jalan juga
cek hongkong    ← substring match (word boundary)
```

### Rich Message (Bot API 10.2)
Semua filter dikirim via Rich Message (single API call):
- Media + text → photo/video/animation + paragraph block
- Text only → paragraph block dengan entities (bold, italic, code, url)
- Sticker + text → photo block + paragraph block
- Standard fallback jika Rich Message gagal

## 🏗️ Forum Topic Support
- **TopicTracker middleware** — auto-detect topic ID dari pesan masuk
- **Auto-inject** `message_thread_id` ke semua outgoing messages
- **Real-time tracking** — setiap pesan update topic map
- **Group config** — `TELEGRAM_TOPIC_GROUPS` di .env

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

## 🚀 Deploy
```bash
# PM2
pm2 start index.js --name assistant-bot
pm2 save
pm2 startup

# Atau langsung
npm start
```

## 📝 Changelog

### v2.1.0 (Current)
- ✅ ZERO commands: /help, /timeout, !aireset semua dihapus
- ✅ Menu Keyboard diperluas 5 tombol: Menu Utama | Filter | Status | ⚙️ Tools | ❓ Bantuan
- ✅ Admin Tools inline menu: Timeout User, Analytics, Notif Stats
- ✅ Owner Panel inline menu: Reset AI, Health, Export Filters
- ✅ Timeout user via inline flow (ID+menit atau reply+menit)
- ✅ Reset AI via inline button dengan konfirmasi
- ✅ Bantuan/Help via inline keyboard (tombol ❓)
- ✅ Semua fitur 100% accessible tanpa mengetik command

### v2.0.0
- ✅ **BREAKING**: Migrated to grammY (from node-telegram-bot-api)
- ✅ **BREAKING**: Migrated to PostgreSQL/Neon (from JSON file storage)
- ✅ **NEW**: Bot API 10.2 Rich Message — single API call untuk semua filter
- ✅ **NEW**: Filter auto-trigger tanpa prefix `!`
- ✅ **NEW**: Forum topic support (TopicTracker middleware)
- ✅ **NEW**: `entitiesToRichSegments` helper — convert entities ke rich text
- ✅ `sendFilter` refactored — Rich Message → Standard fallback
- ✅ `sendRichMessageBlocks` — single API call
- ✅ Auto-inject `message_thread_id` ke semua outgoing messages
- ✅ Full refactor: modular structure (src/ directory)
- ✅ Inline keyboard + menu keyboard (full UI overhaul)
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
