


# 🤖 Telegram Bot - Admin & Filter Management

Bot Telegram untuk manajemen admin dan filter dengan fitur lengkap, AI assistant 3-tier cascade system, dan performa optimal.

## ✨ Fitur Utama

### 👑 Admin Management
- 📋 Admin diatur manual di `.env` (tidak bisa diubah via command)
- 🔒 Owner memiliki akses penuh
- ⚡ Admin cache untuk performa optimal
- 🚫 Non-admin akan di-reject secara silent (no response)
- 📊 User analytics untuk tracking siapa yang mencoba akses bot

### 🎯 Filter Management
- ✅ Buat filter dengan berbagai tipe media
- 🖼️ Support: Text, Photo, Video, Document, GIF, Audio, Voice, Sticker
- ✨ Mendukung formatting: Bold, Italic, Underline, Code, Link, Spoiler, dll
- 🔘 **Support inline keyboard/buttons** - Filter bisa simpan & kirim buttons
- 📋 Clone & rename filter
- 🔍 Search filter dengan keyword
- 💾 Export/backup semua filter (Owner only)
- 📊 Info detail setiap filter

### 🚀 Optimasi & Keamanan
- ⚡ Rate limiting untuk mencegah spam (5 req/sec per user)
- ⏱️ Timeout system untuk spam users (max 24 jam)
- 🗑️ Auto-delete message untuk menjaga kebersihan chat (3-60 detik)
- 💾 In-memory cache untuk performa tinggi
- 🔄 Auto-recovery dari network errors dengan backoff retry
- 📊 Health monitoring & statistics
- 🌐 IPv4-only configuration untuk koneksi lambat/tidak stabil

### 🤖 AI Assistant - Hoki (Groq-Powered)

**🔥 Multi-Model Cascade System (3-Tier):**

**Tier 1 - Premium (Admin Priority):**
- Model: `llama-3.3-70b-versatile`
- Capacity: 1K req/day, 100K tokens/day, 12K tokens/min
- Use case: Complex reasoning, admin queries, long responses
- Quality: 10/10

**Tier 2 - General (UNLIMITED Tokens!):**
- Model: `groq/compound-mini` ⚡ **NEW**
- Capacity: 250 req/day, **UNLIMITED** tokens/day, 70K tokens/min
- Use case: 85% traffic, super fast responses (~150ms)
- Quality: 8/10

**Tier 3 - High Capacity Fallback:**
- Model: `llama-3.1-8b-instant`
- Capacity: 14.4K req/day, 500K tokens/day, 6K tokens/min
- Use case: Emergency backup, massive capacity
- Quality: 7/10

**🛡️ Content Moderation:**
- Model: `meta-llama/llama-guard-4-12b` (Upgraded!)
- Advanced content filtering & safety

**✨ AI Features:**
- 😊 Personality engine dengan natural Indonesian/English style
- 🛡️ Prompt injection prevention & output sanitization
- 📊 Conversation analytics & performance monitoring
- 🔔 Smart triggering:
  - **Private chat**: AI respon semua pesan
  - **Group chat**: AI hanya respon kalau di-reply ke bot
- 🌍 Auto language detection (Indonesian/English)
- 👤 Context-aware responses berdasarkan user role (Owner/Admin/User)
- 📚 Filter knowledge base integration - AI tahu filters yang ada
- ⚡ Complexity-aware model selection (auto-pilih model terbaik)
- 🔄 Auto-reset counters (RPM & daily limits)
- ⏱️ AI cooldown: 3 seconds per user

### 🔔 Notification System
- 👋 Auto welcome message untuk member baru di group
- 📊 Daily stats otomatis dikirim ke owner setiap pagi (9 AM)
- 🚨 Critical error alerts ke owner untuk immediate action
- 📈 Notification statistics tracking

### 📊 Analytics & Monitoring
- 👥 User analytics - Track semua user yang mencoba akses bot
- 📈 AI usage statistics & model performance tracking
- 🔍 Filter usage analytics
- ⚡ Real-time health monitoring
- 💾 Memory & uptime tracking

## 📦 Instalasi

### 1. Clone Repository
```bash
git clone https://github.com/hokireceh/Assistant-bot.git
cd Assistant-bot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Konfigurasi Environment
Buat file `.env` dari template:
```bash
cp .env.example .env
```

Edit file `.env` dan isi dengan data Anda:
```env
# Dapatkan token dari @BotFather di Telegram
BOT_TOKEN=your_telegram_bot_token_here

# Dapatkan User ID dari @userinfobot di Telegram
OWNER_ID=your_telegram_user_id_here

# Daftar admin IDs (comma-separated)
ADMIN_IDS=1170158500,123456789,987654321

# OPTIONAL: API key untuk AI Hoki (get from https://console.groq.com)
GROQ_API_KEY=your_groq_api_key_here
```

### 4. Jalankan Bot
```bash
npm start
```

## 📖 Cara Penggunaan

### Command Admin

#### Manajemen Admin
- `/listadmins` - Lihat daftar semua admin

**Note:** Admin diatur manual di `.env`, tidak bisa ditambah/hapus via command.

#### Analytics & Monitoring
- `/analytics` - Lihat user yang mencoba akses bot (tracked non-admin users)
- `/status` - Lihat statistik & status bot lengkap
- `!notifstats` - Lihat notification system stats
- `!health` - Health check endpoint (owner only)

#### Keamanan
- `/timeout <menit>` - Timeout user sementara (reply ke user, max 1440 menit)

#### Manajemen Filter
- `!add <nama>` - Buat filter baru (reply ke pesan yang ingin dijadikan filter)
- `!del <nama>` - Hapus filter
- `!clone <dari> <ke>` - Copy filter ke nama baru
- `!rename <lama> <baru>` - Ganti nama filter
- `!list` - Lihat semua filter dengan pagination (15 items/page)
- `!info <nama>` - Lihat detail filter (type, size, formatting)
- `!search <keyword>` - Cari filter berdasarkan nama
- `!export` - Backup semua filter ke JSON file (Owner only)

#### AI Assistant (Hoki)
**Private Chat:**
- Kirim pesan apapun untuk chat dengan AI (no prefix needed)

**Group Chat:**
- Reply ke pesan bot untuk chat dengan AI

**Command AI:**
- `!aistats` - Lihat statistik AI (model usage, success rate, active conversations)
- `!aireset` - Reset AI stats & conversations (owner only)

#### Command Umum
- `/start` - Mulai menggunakan bot
- `/help` - Lihat semua command yang tersedia

### Menggunakan Filter
Admin bisa menggunakan filter dengan:
```
!namafilter
```
atau
```
namafilter
```

## 🎨 Contoh Penggunaan

### Membuat Filter Text dengan Formatting
1. Kirim pesan dengan format yang diinginkan (bold, italic, dll)
2. Reply ke pesan tersebut dengan: `!add welcome`
3. Filter "welcome" siap digunakan dengan formatting aslinya

### Membuat Filter dengan Buttons
1. Kirim pesan yang punya inline keyboard/buttons
2. Reply ke pesan tersebut dengan: `!add promo`
3. Filter "promo" akan menyimpan buttons dan bisa digunakan ulang

### Membuat Filter Media
1. Kirim photo/video dengan caption
2. Reply ke media tersebut dengan: `!add promo`
3. Filter "promo" siap digunakan

### Clone Filter
```
!clone welcome welcome2
```

### Rename Filter
```
!rename welcome2 hello
```

### Chat dengan AI Hoki (Private)
```
Halo Hoki, apa kabar?
```
AI akan auto-detect bahasa dan respon dalam Indonesian.

### Chat dengan AI Hoki (Group)
Reply ke pesan bot untuk lanjutkan percakapan:
```
[Reply ke bot] Explain this code please
```

### Timeout User yang Spam
1. Reply ke pesan spammer
2. Kirim: `/timeout 30` (timeout 30 menit)
3. User tidak bisa gunakan bot selama 30 menit

### Lihat User Analytics
```
/analytics
```
Akan menampilkan semua non-admin yang pernah mencoba akses bot.

## 🔧 Teknologi

- **Node.js** v20+ - Runtime JavaScript
- **node-telegram-bot-api** - Library untuk Telegram Bot API
- **dotenv** - Environment variable management
- **Groq API** - AI infrastructure (LLaMA models)

## 📊 Struktur File

```
├── index.js                # File utama bot (2200+ lines)
├── package.json           # Dependencies & scripts
├── .env                   # Environment variables (jangan di-commit!)
├── .env.example          # Template environment variables
├── filters.json          # Data filter (auto-generated)
├── user_analytics.json   # User tracking data (auto-generated)
├── README.md            # Documentation (this file)
└── replit.md           # Replit-specific docs
```

## 🛡️ Keamanan

- ✅ **Admin-only access** - Semua fitur hanya untuk admin
- ✅ Rate limiting (5 req/sec) untuk mencegah spam
- ✅ Owner protection (tidak bisa dihapus/di-timeout)
- ✅ HTML escape untuk mencegah injection
- ✅ Validasi input untuk semua command
- ✅ Error handling yang komprehensif
- ✅ Timeout system untuk spam users
- ✅ AI prompt injection prevention & sanitization
- ✅ Conversation history limits (prevent memory bloat)

## 🚀 Deploy di Replit

Bot ini sudah dikonfigurasi untuk running di Replit:

1. Fork repository ini ke Replit
2. Tambahkan Secrets (BOT_TOKEN, OWNER_ID, ADMIN_IDS, GROQ_API_KEY) di Replit Secrets
3. Klik tombol Run
4. Bot akan berjalan 24/7 di Replit dengan workflow `telegram-bot`

## 🌐 Optimasi untuk Koneksi Lambat

Bot menggunakan konfigurasi khusus untuk koneksi internet lambat:

- **IPv4-only mode** - Mengatasi masalah timeout IPv6
- **Optimized polling** (3s interval) - Balance antara speed & stability
- **Extended timeouts** (60-120s) - Mencegah timeout prematur
- **Keep-alive connections** - Mengurangi overhead koneksi
- **Auto-retry dengan exponential backoff** - Recovery otomatis (max 10 retries)
- **Stale conversation cleanup** - Auto-cleanup setiap 1 menit

## 💡 Tips & Tricks

1. **Auto-delete**: Pesan command akan auto-delete setelah 3-60 detik
2. **Pagination**: List filter otomatis ter-pagination untuk filter >15 items
3. **Formatting**: Support semua Telegram formatting via HTML entities conversion
4. **Media Support**: Bisa save semua tipe media yang didukung Telegram
5. **Backup**: Gunakan `!export` untuk backup filter secara berkala
6. **Buttons**: Filter bisa menyimpan inline keyboard untuk interaksi kompleks
7. **AI Language**: Hoki auto-detect bahasa (Indonesian/English)
8. **AI Context**: Hoki aware dengan role kamu (Owner/Admin/User)
9. **Filter Knowledge**: Hoki bisa referensikan up to 20 filters saat chat
10. **AI Cooldown**: 3 detik per user untuk prevent abuse
11. **Model Selection**: AI auto-pilih model terbaik based on complexity
12. **Conversation History**: Max 10 messages untuk optimal context

## 🐛 Troubleshooting

### Bot tidak merespon
- ✅ Pastikan BOT_TOKEN benar (dari @BotFather)
- ✅ Pastikan User ID kamu ada di ADMIN_IDS (di .env)
- ✅ Check console untuk error messages
- ✅ Pastikan bot sudah running (cek workflow `telegram-bot`)
- ✅ Verifikasi dengan `/listadmins` bahwa ID kamu terdaftar

### Filter tidak terkirim
- ✅ Pastikan nama filter benar (case-insensitive)
- ✅ Check apakah ada special characters yang break parsing
- ✅ Lihat error message di console
- ✅ Critical errors akan dikirim ke owner otomatis
- ✅ Gunakan `!info <nama>` untuk cek detail filter

### Media tidak terkirim
- ✅ Pastikan file_id masih valid (tidak expired)
- ✅ Check ukuran file tidak melebihi limit Telegram
- ✅ Lihat console log untuk detailed error

### AI Hoki tidak respon
- ✅ Pastikan GROQ_API_KEY valid di .env
- ✅ Check AI stats dengan `!aistats`
- ✅ Pastikan tidak kena rate limit (3s cooldown per user)
- ✅ Di group: pastikan reply ke pesan bot
- ✅ Di private: bot akan respon semua pesan
- ✅ Check apakah semua model masih available (RPM/daily limits)

### Koneksi timeout/lambat
- ✅ Bot sudah dikonfigurasi untuk koneksi lambat (IPv4-only)
- ✅ Gunakan koneksi internet yang lebih stabil jika memungkinkan
- ✅ Bot akan auto-retry dengan backoff (max 10 attempts)
- ✅ Periksa console untuk retry messages

### User Analytics tidak update
- ✅ Analytics hanya track non-admin users
- ✅ Check `user_analytics.json` file
- ✅ Gunakan `/analytics` untuk lihat data

## 📝 Changelog

### v1.1.0 (Current)
- 🔥 **NEW**: Upgraded to `groq/compound-mini` (Tier 2) - UNLIMITED tokens/day!
- 🔥 **NEW**: Guard model upgraded to `llama-guard-4-12b` (12B params)
- ✅ User analytics system untuk tracking non-admin access attempts
- ✅ Notification system (welcome, daily stats, critical alerts)
- ✅ Multi-model AI cascade system dengan complexity detection
- ✅ Smart AI triggering (private vs group chat)
- ✅ Auto language detection untuk AI responses
- ✅ Context-aware AI (role-based responses)
- ✅ Filter knowledge base integration untuk AI
- ✅ IPv4-only configuration untuk koneksi lambat
- ✅ Enhanced error handling & recovery
- ✅ Conversation history management & auto-cleanup
- ✅ AI cooldown & rate limiting per user

### v1.0.1
- ✅ Admin system dipindah ke .env (manual config)
- ✅ Removed /addadmin dan /removeadmin commands
- ✅ Semua fitur restricted ke admin only
- ✅ Filter dan AI Hoki hanya untuk admin
- ✅ Silent rejection untuk non-admin users
- ✅ Inline keyboard/buttons support untuk filters

### v1.0.0
- ✅ Initial release
- ✅ Admin & filter management
- ✅ Support semua media types
- ✅ HTML entities conversion untuk formatting
- ✅ Rate limiting & auto-delete
- ✅ Export/backup filters
- ✅ Search & pagination

## 🤝 Kontribusi

Kontribusi selalu welcome! Silakan:
1. Fork repository
2. Buat branch baru (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push ke branch (`git push origin feature/AmazingFeature`)
5. Buat Pull Request

## 💰 Donasi

Jika bot ini bermanfaat, dukung development dengan donasi:

### ⚡ IDR (Rupiah)
- **[Trakteer](https://trakteer.id/garapanairdrop/tip)**

---

### ⚡ USD BNB ETH (EVM Networks)
```
0x77bFeEa5Dd20C4Cf3B716A7CEf39E29897797aEC
```

## 📄 License

ISC License - Bebas digunakan untuk keperluan apapun.

## 👨‍💻 Author

**TentangBlockchain**
- GitHub: [@hokireceh](https://github.com/hokireceh)
- Bot Repository: [Assistant-bot](https://github.com/hokireceh/Assistant-bot)

## 🙏 Credits

- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) - Telegram Bot API wrapper
- [Telegram Bot API](https://core.telegram.org/bots/api) - Official Telegram Bot API
- [Groq](https://groq.com) - AI infrastructure platform (LLaMA models)
- [Meta AI](https://ai.meta.com/) - LLaMA model developers

---

## 📊 Stats & Performance

**Current Configuration:**
- AI Models: 3-tier cascade (Premium + Unlimited + Fallback)
- Filter Capacity: Unlimited (file-based storage)
- Admin Capacity: Unlimited (env-based)
- User Analytics: Tracked per non-admin user
- Auto-delete: 3-60 seconds (configurable)
- Rate Limit: 5 requests/second per user
- AI Cooldown: 3 seconds per user
- Conversation History: Max 10 messages
- Daily Stats: Sent at 9 AM daily

---

⭐ **Star repository ini jika bermanfaat!**

💬 **Butuh bantuan?** Buka issue di GitHub!

🚀 **Happy Coding!**
