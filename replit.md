# Telegram Bot - Admin & Filter Management

## 📋 Overview
Bot Telegram untuk manajemen filter dengan sistem admin pribadi. Bot ini **hanya bisa diakses oleh admin** yang terdaftar di `.env`.

## 🔐 Sistem Admin
**Admin diatur manual di file `.env`** (bukan melalui command bot):

### Format di `.env`:
```env
# Owner/Main Admin
OWNER_ID=1170158500

# Admin List (comma-separated IDs)
ADMIN_IDS=1170158500,123456789,987654321
```

### Menambah/Hapus Admin:
1. Edit file `.env`
2. Tambahkan/hapus User ID di `ADMIN_IDS` (pisahkan dengan koma)
3. Restart bot (stop & start ulang)
4. Verifikasi dengan `/listadmins`

## ⚙️ Konfigurasi

### Environment Variables (.env):
- `BOT_TOKEN` - Token dari @BotFather (REQUIRED)
- `OWNER_ID` - User ID owner utama (REQUIRED)
- `ADMIN_IDS` - Daftar admin IDs, comma-separated (REQUIRED)
- `GROQ_API_KEY` - API key untuk AI Hoki (OPTIONAL)

### Cara Mendapatkan Credentials:
1. **BOT_TOKEN**: Chat dengan @BotFather di Telegram, gunakan `/newbot`
2. **OWNER_ID & ADMIN_IDS**: Chat dengan @userinfobot untuk mendapat User ID
3. **GROQ_API_KEY**: Daftar di https://console.groq.com

## 🎯 Fitur Utama

### 1. Filter Management
- **!add** - Buat filter baru (reply ke pesan)
- **!del** - Hapus filter
- **!list** - Lihat semua filter
- **!clone** - Copy filter
- **!rename** - Ganti nama filter
- **!info** - Detail filter
- **!search** - Cari filter
- **!export** - Backup filter (owner only)

Support semua media: Text, Photo, Video, Document, GIF, Audio, Voice, Sticker

### 2. Security Features
- **/blacklist** - Ban user
- **/unblacklist** - Unban user
- **/timeout** - Timeout user sementara
- **/listblacklist** - Lihat daftar ban

### 3. AI Assistant "Hoki"
- Conversational AI powered by Groq LLaMA 3.3 70B
- Reply ke pesan bot untuk chat
- **!aistats** - Lihat statistik AI
- **!aireset** - Reset AI (owner only)

### 4. Monitoring
- **!status** - Status & statistik bot
- **!notifstats** - Notification stats
- Daily stats otomatis ke owner

## 🚀 Project Structure

```
├── index.js           # Main bot file
├── package.json       # Dependencies
├── .env              # Environment variables (JANGAN commit!)
├── .env.example      # Template .env
├── filters.json      # Data filter (auto-generated)
└── blacklist.json    # Data blacklist (auto-generated)
```

## 🔒 Security & Access Control

### Admin-Only Features:
- ✅ **SEMUA command** hanya bisa diakses admin
- ✅ **SEMUA filter** hanya bisa digunakan admin  
- ✅ **AI Hoki** hanya merespon admin
- ✅ Non-admin akan di-reject secara silent (no response)

### Best Practices:
- Jangan share BOT_TOKEN dengan siapapun
- Backup file `.env` di tempat aman
- Export filter secara berkala dengan `!export`
- Monitor bot dengan `!status`

## 📝 Recent Changes

### v1.0.1 (Current)
- ✅ Admin system dipindah ke `.env` (manual config)
- ✅ Removed `/addadmin` dan `/removeadmin` commands
- ✅ Semua fitur restricted ke admin only
- ✅ Filter dan AI Hoki hanya untuk admin
- ✅ Silent rejection untuk non-admin users

## 💡 Tips

1. **Menambah Admin Baru**:
   - Edit `.env`, tambah ID di `ADMIN_IDS`
   - Format: `ADMIN_IDS=ID1,ID2,ID3`
   - Restart bot
   
2. **Backup Regular**:
   - Gunakan `!export` untuk backup filter
   - Simpan file `.env` di tempat aman
   
3. **Monitoring**:
   - Cek `!status` untuk lihat health bot
   - Daily stats otomatis dikirim ke owner setiap pagi
   
4. **Troubleshooting**:
   - Bot tidak respon? Cek apakah User ID kamu ada di `ADMIN_IDS`
   - Filter tidak kerja? Restart bot setelah edit `.env`
   - AI tidak respon? Pastikan `GROQ_API_KEY` valid

## 🛠️ Tech Stack
- Node.js
- node-telegram-bot-api
- Groq LLaMA 3.3 70B (AI)
- Express (health check endpoint)

## 👨‍💻 Author
TentangBlockchain (@hokireceh)
