# Audit Harian — Telegram Bot Admin & Filter Management
**Tanggal:** 2026-04-17  
**File yang diaudit:** `index.js` (2148 baris)  
**Auditor:** Agent

---

## Ringkasan Temuan

| ID | Prioritas | Area | Judul |
|----|-----------|------|-------|
| BUG-001 | ✅ FIXED | AI / Security | `sanitizedMessage` tidak digunakan saat kirim ke Groq API |
| BUG-002 | ✅ FIXED | Performa | `bot.getMe()` dipanggil setiap pesan di AI handler |
| BUG-003 | ✅ FIXED | AI Cleanup | Stale conversation cleanup berdasarkan length, bukan timestamp |
| BUG-004 | ✅ FIXED | AI Reset | `!aireset` hanya reset `used`, tidak reset `rpmUsed` |
| BUG-005 | ✅ FIXED | Analytics | Admin di-track sebagai non-admin di `!aireset` dan `!export` |
| BUG-006 | ✅ FIXED | Admin System | `loadAdminsFromEnv()` tidak otomatis include `OWNER_ID` ke array `admins` |

---

## Detail Temuan

---

### BUG-001 — `sanitizedMessage` tidak digunakan saat kirim ke Groq API
**Prioritas:** 🔴 HIGH  
**Baris:** 619, 626, 660

**Penjelasan logika:**  
Di fungsi `callGroqAPI()`, ada 2 variabel berbeda:
- `userMessage` — pesan original dari user (BELUM di-sanitize)
- `sanitizedMessage` — hasil sanitasi: hapus backticks + potong 1000 karakter

Yang dikirim ke Groq API di array `messages` adalah `userMessage` (baris 619):
```js
{ role: 'user', content: userMessage }
```
Tapi `sanitizedMessage` baru dipakai saat menyimpan ke conversation history (baris 660):
```js
history.push({ role: 'user', content: sanitizedMessage });
```

**Akibat:**  
Sanitasi prompt injection (remove ` ``` `, truncate) TIDAK EFEKTIF karena payload asli yang ke-kirim ke API. Hanya conversation history yang tersimpan versi sanitize-nya.

---

### BUG-002 — `bot.getMe()` dipanggil setiap pesan di AI handler
**Prioritas:** 🔴 HIGH  
**Baris:** 1331

**Penjelasan logika:**  
Di dalam `bot.on('message', ...)` untuk AI handler:
```js
const botInfo = await bot.getMe();
const isReplyToBot = msg.reply_to_message && msg.reply_to_message.from.id === botInfo.id;
```
`bot.getMe()` memanggil Telegram API setiap kali ada pesan masuk. Bot info (ID, username) tidak pernah berubah selama runtime — memanggil API untuk ini adalah pemborosan network dan latency setiap pesan.

**Akibat:**  
- Setiap pesan masuk → 1 API call tambahan ke Telegram
- Pada koneksi lambat (konfigurasi utama project ini), ini memperlambat respons AI secara signifikan
- Di group chat dengan banyak pesan, ini bisa menyebabkan rate limit dari Telegram

---

### BUG-003 — Stale conversation cleanup berdasarkan length, bukan timestamp
**Prioritas:** 🔴 HIGH  
**Baris:** 200–207

**Penjelasan logika:**  
Comment di kode menyatakan: *"Clean up stale AI conversations (older than 1 hour)"*  
Tapi implementasinya mengecek **panjang history**, bukan **waktu terakhir aktif**:
```js
if (history.length > MAX_CONVERSATION_LENGTH * 2) {
  aiConversations.delete(userId);
}
```
`MAX_CONVERSATION_LENGTH = 10`, jadi kondisi terpenuhi hanya jika `history.length > 20`.

Namun di `callGroqAPI()` baris 664, history selalu di-trim:
```js
const trimmedHistory = history.slice(-MAX_CONVERSATION_LENGTH * 2); // max 20
aiConversations.set(userId, trimmedHistory);
```
Artinya history **tidak pernah akan > 20**, sehingga cleanup ini **tidak akan pernah berjalan**.

**Akibat:**  
- Conversation history user yang sudah tidak aktif berhari-hari tetap tersimpan di memory
- Memory leak bertahap: `aiConversations` Map terus bertambah, tidak pernah di-clean
- Intent "1 hour stale cleanup" tidak terlaksana

---

### BUG-004 — `!aireset` hanya reset `used`, tidak reset `rpmUsed`
**Prioritas:** 🔴 HIGH  
**Baris:** 1474–1476

**Penjelasan logika:**  
Saat owner menjalankan `!aireset`:
```js
AI_MODELS.forEach(m => m.used = 0);
```
Hanya counter `used` (daily limit) yang direset. Counter `rpmUsed` (rate per minute) **tidak direset**.

**Akibat:**  
Jika owner menjalankan `!aireset` untuk mencoba "refresh" AI saat rate limit, model akan tetap dianggap rate-limited sampai RPM counter auto-reset 1 menit. Lebih parah: jika ada scenario di mana `rpmUsed` terkorupsi, reset manual tidak bisa membersihkannya.

---

### BUG-005 — Admin di-track sebagai non-admin user di `!aireset` dan `!export`
**Prioritas:** 🟡 MEDIUM  
**Baris:** 1467–1470 (`!aireset`), 1536–1539 (`!export`)

**Penjelasan logika:**  
Di `!aireset`, guard check hanya mengecek `isOwner()`, bukan `isAdmin()`:
```js
if (!isOwner(userId)) {
  await trackUserAccess(userId, ...); // ← Admin juga kena ini
  const reply = await bot.sendMessage(chatId, '❌ Cuma owner yang bisa reset AI stats!');
  return;
}
```
Jika seorang **admin (bukan owner)** mencoba `!aireset`, mereka akan:
1. Masuk ke `user_analytics.json` sebagai "non-admin yang mencoba akses bot"
2. Tampil di `/analytics` seolah-olah user tidak sah

Hal sama terjadi di `!export` (baris 1536–1539).

**Akibat:**  
Data analytics terkontaminasi — admin yang sah tampil sebagai "unauthorized access".

---

### BUG-006 — `loadAdminsFromEnv()` tidak otomatis include `OWNER_ID` ke array `admins`
**Prioritas:** 🟡 MEDIUM  
**Baris:** 65–73

**Penjelasan logika:**  
```js
const loadAdminsFromEnv = () => {
  const adminIds = process.env.ADMIN_IDS || '';
  if (!adminIds.trim()) {
    return [OWNER_ID]; // OWNER_ID hanya masuk di sini (ADMIN_IDS kosong)
  }
  return adminIds.split(',').map(...).filter(...); // OWNER_ID TIDAK otomatis masuk
};
```
Jika `ADMIN_IDS` diisi (tidak kosong), `OWNER_ID` tidak otomatis masuk ke array `admins`.

`isAdmin()` dan `isOwner()` tetap bekerja karena ada pengecekan `userId === OWNER_ID`. Tapi:
- `admins.length` di `!status` dan daily stats TIDAK menghitung Owner
- `/listadmins` tidak menampilkan Owner jika OWNER_ID tidak ada di ADMIN_IDS
- `sendDailyStats()` melaporkan jumlah admin yang salah (kurang 1)

**Akibat:**  
Statistik jumlah admin yang ditampilkan di berbagai command tidak akurat.

---

## Queue Fix (Urut Prioritas)

1. **BUG-001** — Sanitasi prompt injection tidak efektif (fix: kirim `sanitizedMessage` ke API)
2. **BUG-002** — `bot.getMe()` per pesan (fix: cache botId saat startup)
3. **BUG-003** — Cleanup conversation tidak berjalan (fix: tracking timestamp, cleanup berdasarkan idle time)
4. **BUG-004** — `!aireset` partial reset (fix: reset juga `rpmUsed`)
5. **BUG-005** — Admin di-track sebagai non-admin (fix: skip trackUserAccess jika isAdmin)
6. **BUG-006** — OWNER_ID tidak masuk admins array (fix: selalu include OWNER_ID)

---

*Audit ini dihasilkan dari pembacaan manual seluruh `index.js`. Tidak ada docs referensi yang ditemukan (folder `docs/` belum ada sebelum audit ini).*
