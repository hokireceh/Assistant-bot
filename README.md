

# 🤖 Telegram Bot - Admin & Filter Management

Bot Telegram untuk manajemen admin dan filter dengan fitur lengkap, AI assistant, dan performa optimal.

## ✨ Fitur Utama

### 👑 Admin Management
- 📋 Admin diatur manual di `.env` (tidak bisa diubah via command)
- 🔒 Owner memiliki akses penuh
- ⚡ Admin cache untuk performa optimal
- 🚫 Non-admin akan di-reject secara silent (no response)

### 🎯 Filter Management
- ✅ Buat filter dengan berbagai tipe media
- 🖼️ Support: Text, Photo, Video, Document, GIF, Audio, Voice, Sticker
- ✨ Mendukung formatting: Bold, Italic, Underline, Code, Link, Spoiler, dll
- 🔘 **Support inline keyboard/buttons** (NEW!)
- 📋 Clone & rename filter
- 🔍 Search filter dengan keyword
- 💾 Export/backup semua filter (Owner only)
- 📊 Info detail setiap filter

### 🚀 Optimasi & Keamanan
- ⚡ Rate limiting untuk mencegah spam
- 🚫 Blacklist system untuk ban user
- ⏱️ Timeout system untuk spam users
- 🗑️ Auto-delete message untuk menjaga kebersihan chat
- 💾 In-memory cache untuk performa tinggi
- 🔄 Auto-recovery dari network errors
- 📊 Health monitoring & statistics
- 🌐 IPv4-only configuration untuk koneksi lambat/tidak stabil

### 🤖 AI Assistant - Hoki
- 💬 Groq LLaMA 3.3 70B integration untuk conversational AI
- 🎯 **Multi-model cascade system** dengan automatic fallback:
  - Tier 1: llama-3.3-70b-versatile (premium, admin priority)
  - Tier 2: llama-3.1-8b-instant (general, semua user)
  - Tier 3: llama-guard-3-8b (emergency fallback)
- 😊 Personality engine dengan natural Indonesian/English style
- 🛡️ Prompt injection prevention & output sanitization
- 📊 Conversation analytics & performance monitoring
- 🔔 Smart triggering:
  - **Private chat**: AI respon semua pesan
  - **Group chat**: AI hanya respon kalau di-reply ke bot
- 🌍 Auto language detection (Indonesian/English)
- 👤 Context-aware responses berdasarkan user role (Owner/Admin/User)
- 📚 Filter knowledge base integration

### 🔔 Notification System
- 👋 Auto welcome message untuk member baru
- 📊 Daily stats otomatis dikirim ke owner setiap pagi (9 AM)
- 🚨 Critical error alerts ke owner
- 📈 Notification statistics tracking

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

# OPTIONAL: API key untuk AI Hoki
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

#### Keamanan
- `/blacklist` - Ban user (reply ke user yang mau di-ban)
- `/unblacklist` - Unban user (reply ke user yang mau di-unban)
- `/listblacklist` - Lihat daftar user yang di-blacklist
- `/timeout <menit>` - Timeout user sementara (reply ke user, max 1440 menit)

#### Manajemen Filter
- `!add <nama>` - Buat filter baru (reply ke pesan yang ingin dijadikan filter)
- `!del <nama>` - Hapus filter
- `!clone <dari> <ke>` - Copy filter ke nama baru
- `!rename <lama> <baru>` - Ganti nama filter
- `!list` - Lihat semua filter dengan pagination
- `!info <nama>` - Lihat detail filter
- `!search <keyword>` - Cari filter
- `!status` - Lihat statistik & status bot
- `!export` - Backup semua filter (Owner only)

#### AI Assistant (Hoki)
**Private Chat:**
- Kirim pesan apapun untuk chat dengan AI

**Group Chat:**
- Reply ke pesan bot untuk chat dengan AI

**Command AI:**
- `!aistats` - Lihat statistik AI (admin only)
- `!aireset` - Reset AI stats & conversations (owner only)

#### Monitoring
- `!notifstats` - Lihat notification system stats
- `!health` - Health check endpoint (owner only)

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

### Chat dengan AI Hoki (Group)
Reply ke pesan bot untuk lanjutkan percakapan.

### Ban User yang Spam
1. Reply ke pesan spammer
2. Kirim: `/blacklist`
3. User tidak bisa gunakan bot lagi

### Timeout User Sementara
1. Reply ke pesan user
2. Kirim: `/timeout 30` (timeout 30 menit)
3. User tidak bisa gunakan bot selama 30 menit

## 🔧 Teknologi

- **Node.js** - Runtime JavaScript
- **node-telegram-bot-api** - Library untuk Telegram Bot API
- **dotenv** - Environment variable management
- **Groq API** - AI integration (LLaMA 3.3 70B)

## 📊 Struktur File

```
├── index.js          # File utama bot
├── package.json      # Dependencies & scripts
├── .env             # Environment variables (jangan di-commit!)
├── .env.example     # Template environment variables
├── filters.json     # Data filter (auto-generated)
└── blacklist.json   # Data blacklist (auto-generated)
```

## 🛡️ Keamanan

- ✅ **Admin-only access** - Semua fitur hanya untuk admin
- ✅ Rate limiting untuk mencegah spam
- ✅ Owner protection (tidak bisa dihapus/di-ban)
- ✅ HTML escape untuk mencegah injection
- ✅ Validasi input untuk semua command
- ✅ Error handling yang komprehensif
- ✅ Blacklist & timeout system
- ✅ AI prompt injection prevention

## 🚀 Deploy di Replit

Bot ini sudah dikonfigurasi untuk running di Replit:

1. Fork repository ini ke Replit
2. Tambahkan Secrets (BOT_TOKEN, OWNER_ID, ADMIN_IDS, GROQ_API_KEY) di Replit Secrets
3. Klik tombol Run
4. Bot akan berjalan 24/7 di Replit

## 🌐 Optimasi untuk Koneksi Lambat

Bot menggunakan konfigurasi khusus untuk koneksi internet lambat:

- **IPv4-only mode** - Mengatasi masalah timeout IPv6
- **Slower polling interval** (10s) - Lebih stabil untuk koneksi lambat
- **Extended timeouts** (180s) - Mencegah timeout prematur
- **Keep-alive connections** - Mengurangi overhead koneksi
- **Auto-retry dengan backoff** - Recovery otomatis dari network errors

## 💡 Tips & Tricks

1. **Auto-delete**: Pesan command akan auto-delete setelah 3 menit
2. **Pagination**: List filter otomatis ter-pagination untuk filter >15 items
3. **Formatting**: Support semua Telegram formatting (HTML entities)
4. **Media Support**: Bisa save semua tipe media yang didukung Telegram
5. **Backup**: Gunakan `!export` untuk backup filter secara berkala
6. **Buttons**: Filter bisa menyimpan inline keyboard untuk interaksi kompleks
7. **AI Language**: Hoki auto-detect bahasa (Indonesian/English)
8. **AI Context**: Hoki aware dengan role kamu (Owner/Admin/User)
9. **Filter Knowledge**: Hoki bisa referensikan filters yang ada saat chat

## 🐛 Troubleshooting

### Bot tidak merespon
- ✅ Pastikan BOT_TOKEN benar
- ✅ Pastikan User ID kamu ada di ADMIN_IDS (di .env)
- ✅ Check console untuk error messages
- ✅ Pastikan bot sudah running (cek workflow status)

### Filter tidak terkirim
- ✅ Pastikan nama filter benar (case-insensitive)
- ✅ Check apakah ada special characters yang break parsing
- ✅ Lihat error message di console
- ✅ Critical errors akan dikirim ke owner

### Media tidak terkirim
- ✅ Pastikan file_id masih valid (tidak expired)
- ✅ Check ukuran file tidak melebihi limit Telegram

### AI Hoki tidak respon
- ✅ Pastikan GROQ_API_KEY valid di .env
- ✅ Check AI stats dengan `!aistats`
- ✅ Pastikan tidak kena rate limit (3s cooldown)
- ✅ Di group: pastikan reply ke pesan bot
- ✅ Di private: bot akan respon semua pesan

### Koneksi timeout/lambat
- ✅ Bot sudah dikonfigurasi untuk koneksi lambat
- ✅ Gunakan koneksi internet yang lebih stabil jika memungkinkan
- ✅ Bot akan auto-retry dengan backoff
- ✅ IPv4-only mode sudah aktif secara default

## 📝 Changelog

### v1.0.1 (Current)
- ✅ Admin system dipindah ke .env (manual config)
- ✅ Removed /addadmin dan /removeadmin commands
- ✅ Semua fitur restricted ke admin only
- ✅ Filter dan AI Hoki hanya untuk admin
- ✅ Silent rejection untuk non-admin users
- ✅ Inline keyboard/buttons support untuk filters
- ✅ Multi-model AI cascade system
- ✅ Smart AI triggering (private vs group chat)
- ✅ Auto language detection untuk AI
- ✅ Context-aware AI responses
- ✅ Filter knowledge base integration
- ✅ Notification system (welcome, daily stats, alerts)
- ✅ IPv4-only configuration untuk koneksi lambat
- ✅ Enhanced error handling & recovery

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
- **[https://trakteer.id/garapanairdrop/tip](https://trakteer.id/garapanairdrop/tip)**

---

### ⚡ USD BNB ETH (EVM)
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
- [Groq](https://groq.com) - AI infrastructure platform

---

⭐ **Star repository ini jika bermanfaat!**

💬 **Butuh bantuan?** Buka issue di GitHub!

