# Daily Audit — 17 April 2026

## Status: ✅ SEMUA SELESAI

---

## Ringkasan

| ID | Prioritas | Area | Judul | Status |
|----|-----------|------|-------|--------|
| BUG-001 | 🔴 HIGH | AI / Security | `sanitizedMessage` tidak digunakan saat kirim ke Groq API | ✅ FIXED |
| BUG-002 | ✅ FIXED | Performa | `bot.getMe()` dipanggil setiap pesan di AI handler | ✅ FIXED |
| BUG-003 | ✅ FIXED | AI Cleanup | Stale conversation cleanup berdasarkan length, bukan timestamp | ✅ FIXED |
| BUG-004 | ✅ FIXED | AI Reset | `!aireset` hanya reset `used`, tidak reset `rpmUsed` | ✅ FIXED |
| BUG-005 | ✅ FIXED | Analytics | Admin di-track sebagai non-admin di `!aireset` dan `!export` | ✅ FIXED |
| BUG-006 | ✅ FIXED | Admin System | `loadAdminsFromEnv()` tidak otomatis include `OWNER_ID` ke array `admins` | ✅ FIXED |

---

## Sesi 2: 24/365 Hardening (17 Apr 2026)

### FIX-007: !aireset double-fire ke AI
- **Masalah**: `bot.onText(/^!aireset$/)` dan `bot.on('message')` keduanya fire untuk pesan `!aireset`. Message handler juga meloloskannya ke AI.
- **Fix**: Tambah `RESERVED_BANG` Set di handlers.js. Message handler skip jika `cmd` ada di Set ini.

### FIX-008: add_filter menerima bot's own message sebagai source
- **Masalah**: User bisa reply ke pesan instruksi bot (prompt message), konten prompt bot jadi isi filter.
- **Fix**: Cek `source.from?.id === cachedBotId` sebelum proses. Jika iya, tampilkan error dengan instruksi yang benar.

### FIX-009: Filter list kosong menampilkan "Halaman 1/0"
- **Masalah**: `buildFilterListText` tidak handle kasus 0 filter. Keyboard pagination tetap muncul.
- **Fix**: Tambah early return dengan pesan `📭 Belum ada filter.` dan gunakan `backKeyboard` saat `total === 0`.

### FIX-010: filter_export memanggil answerCallbackQuery dua kali
- **Masalah**: Top-level handler jawab semua callback_query terlebih dahulu, lalu `filter_export` jawab lagi dengan custom text.
- **Fix**: Skip global answerCallbackQuery untuk `filter_export` (kondisi `data !== 'filter_export'`), let `filter_export` jawab sendiri.

### FIX-011: Unused code — `promptUser` function dan `path` import
- **Masalah**: `promptUser` didefinisikan tapi tidak pernah dipanggil. `const path = require('path')` tidak digunakan.
- **Fix**: Hapus keduanya dari handlers.js.

### FIX-012: pendingActions tidak punya TTL
- **Masalah**: Jika user memulai action (add_filter, dll) lalu tidak melanjutkan, state tersimpan selamanya (memory leak).
- **Fix**: Setiap pending action diberi `expiresAt = Date.now() + 10 menit`. `setInterval` setiap 5 menit cleanup expired entries. Helper `setPending()` menggantikan `pendingActions.set()` langsung.

### FIX-013: Callback handler tidak punya global try/catch
- **Masalah**: Error di dalam callback (misal DB down) bisa uncaught, crash handler.
- **Fix**: Pisahkan logic ke `handleCallback()`, panggil via `try/catch` dari event handler. Error ditangkap dan pesan error dikirim ke user.

### FIX-014: cleanExpiredTimeouts hanya dipanggil saat startup
- **Masalah**: Timeout yang expired tidak dibersihkan dari DB selama bot jalan berhari-hari.
- **Fix**: Tambah `setInterval` di `index.js` yang memanggil `cleanExpiredTimeouts` setiap 1 jam.

### FIX-015: resetAIStats tidak reset GUARD_MODEL counters
- **Masalah**: Saat `!aireset`, hanya `AI_MODELS` yang di-reset, `GUARD_MODEL.rpmUsed` dan `GUARD_MODEL.used` tetap lama.
- **Fix**: Tambah reset `GUARD_MODEL.rpmUsed = 0` dan `GUARD_MODEL.used = 0` di `resetAIStats()`.

### FIX-016: Tidak ada process-level uncaughtException / unhandledRejection handler
- **Masalah**: Exception yang tidak ter-catch di luar async handlers bisa crash process Node.js.
- **Fix**: Tambah `process.on('uncaughtException')` dan `process.on('unhandledRejection')` di `index.js`. Keduanya log error tapi tidak exit.

### FIX-017: DB connection tidak retry saat startup
- **Masalah**: Satu kali DB connect failure langsung `process.exit(1)`. Bisa false positive jika DB sedang restart.
- **Fix**: Tambah loop retry 5x dengan delay bertahap (3s, 6s, 9s...). Keluar hanya jika semua gagal.

### FIX-018: handlePendingAction dipisah dari setupHandlers
- **Improvement**: Logika pending actions dipisah ke fungsi `handlePendingAction()` dan `handleCallback()` sendiri untuk maintainability.

---

## Startup Log (setelah hardening)

```
🌐 IPv4-only mode aktif
🚀 Starting bot...
👑 Admins loaded (1): 1170158500
✅ PostgreSQL connected
✅ Expired timeouts cleaned
✅ Webhook cleared
✅ Connected as @hokibot (ID: 1993747121)
✅ Handlers registered
📊 Daily stats: 18/4/2026, 09.00.00
✅ Cached bot ID: 1993747121 (@hokibot)
🤖 Bot is running! 🚀
```

**Status: 🟢 PRODUCTION READY — 24/365 OK**
