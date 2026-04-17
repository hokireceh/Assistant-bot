# Audit Harian Bot Hoki — v1
**Tanggal:** 2026-04-17  
**Auditor:** Agent  
**Scope:** Semua file src/ + index.js + config.js  

---

## Ringkasan File yang Diaudit

| File | Baris | Status |
|------|-------|--------|
| `index.js` | 176 | ✅ Diaudit |
| `src/config.js` | 93 | ✅ Diaudit |
| `src/db.js` | 194 | ✅ Diaudit |
| `src/utils.js` | 162 | ✅ Diaudit |
| `src/ai.js` | 275 | ✅ Diaudit |
| `src/keyboards.js` | 203 | ✅ Diaudit |
| `src/handlers.js` | 1141 | ✅ Diaudit |

---

## Queue Issue (Prioritas)

### BUG-001 — KRITIS | `src/config.js:34` — Model Tier 2 nama invalid
- **File:** `src/config.js` line 34
- **Masalah:** `name: 'groq/compound-mini'` — prefix `groq/` bukan format valid Groq API. Groq API endpoint menerima nama model tanpa prefix. Setiap request ke Tier 2 akan gagal dengan error model not found.
- **Status:** 🔴 OPEN — Menunggu approve

---

### BUG-002 — SEDANG | `src/db.js:59` — `created_at` di-reset saat filter diedit
- **File:** `src/db.js` line 59
- **Masalah:** `ON CONFLICT DO UPDATE SET created_at = NOW()` — semantik salah. `created_at` seharusnya tidak berubah saat filter diperbarui; hanya `updated_at` yang seharusnya diperbarui (tapi kolom ini tidak ada).
- **Status:** 🔴 OPEN — Menunggu approve

---

### BUG-003 — SEDANG | `src/handlers.js:186-192` — Filter sticker + buttons tidak tampil inline keyboard
- **File:** `src/handlers.js` line 186-192
- **Masalah:** Saat filter bertipe sticker dan memiliki `buttons` (inline keyboard), `replyMarkup` tidak disertakan di pesan teks yang dikirim setelah sticker. Tombol inline tidak akan muncul.
- **Status:** 🔴 OPEN — Menunggu approve

---

### BUG-004 — RINGAN | `src/ai.js:222-229` — `failedResponses` double-increment fragile
- **File:** `src/ai.js` line 222-229
- **Masalah:** Logika menghindari double-increment menggunakan string check `err.message.startsWith('Groq API')`. Sangat rapuh — jika pesan error berubah sedikit saja, counter bisa double-increment atau miss-increment.
- **Status:** 🔴 OPEN — Menunggu approve

---

### BUG-005 — RINGAN | `src/handlers.js` — Rate limit tidak dicek untuk `del/clone/rename filter`
- **File:** `src/handlers.js` — `handlePendingAction`
- **Masalah:** Hanya `add_filter` yang melakukan `checkRateLimit()`. Operasi `del_filter`, `clone_filter`, dan `rename_filter` tidak dicek rate limit, memungkinkan admin spam operasi tersebut.
- **Status:** 🔴 OPEN — Menunggu approve

---

### TEMUAN INFORMASI (bukan bug kritis, tidak perlu fix segera)

#### INFO-001 — Duplikasi `httpsAgent` antara `index.js` dan `config.js`
- `config.js` mendefinisikan dan mengeksport `httpsAgent` tapi tidak dipakai di mana-mana
- `index.js` mendefinisikan `httpsAgent` sendiri secara terpisah untuk TelegramBot
- `fetch` di `ai.js` (Groq API calls) tidak menggunakan httpsAgent apapun — tapi masih aman karena `dns.setDefaultResultOrder('ipv4first')` sudah dipanggil di kedua file

#### INFO-002 — `AI_ENABLED` didefinisikan di dua tempat
- `config.js` line 84 dan `ai.js` line 267 keduanya mengekspor `AI_ENABLED`
- `handlers.js` import dari `config.js`, bukan dari `ai.js` — konsisten, tidak konflik

---

## Log Eksekusi Fix

| Bug | Propose | Approve | Eksekusi | Selesai |
|-----|---------|---------|----------|---------|
| BUG-001 | ✅ | ⏳ | - | - |
| BUG-002 | - | - | - | - |
| BUG-003 | - | - | - | - |
| BUG-004 | - | - | - | - |
| BUG-005 | - | - | - | - |
