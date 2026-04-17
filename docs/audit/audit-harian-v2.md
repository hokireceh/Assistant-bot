# Audit Harian Bot Hoki — v2
**Tanggal:** 2026-04-17
**Auditor:** Agent
**Scope:** Semua file src/ + index.js + config.js

---

## Checklist Per File

### `src/config.js`
- [x] Nama model AI cocok dengan daftar resmi Groq ✅
- [x] Limit RPM, dailyLimit, tokensPerMin, tokensPerDay sesuai ✅
- [x] GUARD_MODEL nama valid (`meta-llama/llama-prompt-guard-2-86m`) ✅
- [x] Duplikasi `httpsAgent` dan `dns.setDefaultResultOrder` ada di config.js & index.js → **INFO-1**

### `src/db.js`
- [x] `upsertFilter` — `created_at` tidak di-reset ✅ (fixed v1)
- [x] Semua parameterized query pakai `$1,$2,...` ✅
- [x] Error handling — propagate ke caller (acceptable) ✅
- [x] `ON CONFLICT DO UPDATE SET` — `created_by` ikut diupdate padahal harusnya immutable → **BUG-A**

### `src/utils.js`
- [x] `loadAdmins()` — filter NaN dan <=0 ✅
- [x] `checkRateLimit()` — window 1s, max 5 req/s (design choice, ok) ✅
- [x] `entitiesToHTML()` — semua tipe entity utama ditangani; url/mention jatuh ke plain text (auto-linked Telegram) ✅
- [x] `autoDeleteMessage()` — `deleteTimers` dibersihkan di `finally`, tidak ada leak ✅

### `src/ai.js`
- [x] Model cascade: Tier 1 → Tier 2 → Tier 3 → Tier 1 last resort → null ✅
- [x] `failedResponses` tidak double-increment (fixed v1, `alreadyCounted` flag) ✅
- [x] `clearTimeout` dipanggil di semua code path ✅
- [x] Stale conversation cleanup — `aiRateLimits` selalu di-set saat request, sehingga cleanup via `aiRateLimits` entries sudah cover semua conversation ✅
- [x] `sanitizedMessage` — strip backtick triple, limit 1000 char (basic, acceptable) ✅

### `src/handlers.js`
- [x] `sendFilter()` — semua media type attach replyMarkup ✅ (fixed v1)
- [x] `handlePendingAction()` — rate limit check ada di semua operasi tulis ✅ (fixed v1)
- [x] `filter_confirm_del` callback_data — filter name panjang bisa melewati 64 byte limit → **BUG-B**
- [x] `timeout_confirm` parsing — aman karena user_id tidak bisa mengandung `:` ✅
- [x] `pollingErrCount` — reset jika >2 menit tanpa error, behavior benar ✅
- [x] `startDailyStats()` — `setHours(9,0,0,0)` pakai timezone server (UTC), bukan WIB → **BUG-C**

### `src/keyboards.js`
- [x] `filterListKeyboard()` — nav row tidak tampil jika hanya 1 halaman ✅
- [x] `callback_data` melebihi 64 byte — `filter_confirm_del:${name}` (18+50=68 byte) → **BUG-B**

### `index.js`
- [x] DB retry — 5 percobaan, backoff linear (3s × i) ✅
- [x] Graceful shutdown — `deleteTimers`, `stopPolling`, `pool.end` ✅
- [x] `retryWithBackoff` dipakai untuk `deleteWebHook` dan `getMe` ✅

---

## Queue Issue (Urut Prioritas)

### BUG-A — SEDANG | `src/db.js:60` — `created_by` ikut diupdate saat filter diedit
- **File:** `src/db.js` line 60
- **Masalah:** `ON CONFLICT DO UPDATE SET ... created_by = EXCLUDED.created_by` menyebabkan kolom `created_by` berubah ke userId yang edit filter, bukan mempertahankan creator asli. Seharusnya `created_by` immutable setelah INSERT pertama.
- **Fix:** Hapus `created_by = EXCLUDED.created_by` dari DO UPDATE SET clause.
- **Status:** 🔴 OPEN

### BUG-B — SEDANG | `src/keyboards.js:188` — callback_data melebihi 64 byte limit Telegram
- **File:** `src/keyboards.js` line 188, `src/handlers.js` (confirmDeleteKeyboard usage)
- **Masalah:** `filter_confirm_del:${filterName}` — prefix `filter_confirm_del:` = 18 byte, filter name max 50 karakter = total 68 byte > 64 byte limit Telegram. Tombol hapus filter panjang akan error "BUTTON_DATA_INVALID" dari Telegram API.
- **Fix:** Perpendek prefix `filter_confirm_del:` → `fdel:`, sehingga: 5 + 50 = 55 byte (aman).
- **Status:** 🔴 OPEN

### BUG-C — SEDANG | `src/handlers.js:1293` — Daily stats terjadwal jam 16:00 WIB bukan 09:00 WIB
- **File:** `src/handlers.js` line 1293 (`startDailyStats`)
- **Masalah:** `next.setHours(9, 0, 0, 0)` menggunakan timezone server (Replit = UTC). 09:00 UTC = 16:00 WIB. Jika tujuan adalah kirim stats jam 09:00 WIB (= 02:00 UTC), maka `setHours` harus pakai 2, bukan 9.
- **Fix:** Ganti ke `next.setUTCHours(2, 0, 0, 0)` (02:00 UTC = 09:00 WIB).
- **Status:** 🔴 OPEN

---

## Info (Tidak Perlu Fix Segera)

### INFO-1 — Duplikasi `httpsAgent` + `dns.setDefaultResultOrder`
- `config.js` membuat `httpsAgent` dan memanggil `dns.setDefaultResultOrder('ipv4first')`.
- `index.js` juga membuat `httpsAgent` sendiri dan memanggil `dns.setDefaultResultOrder`.
- `httpsAgent` dari `config.js` di-export tapi tidak digunakan oleh `ai.js` (yang pakai native `fetch()`).
- Tidak menyebabkan bug, hanya dead code. Bisa dibersihkan kapan saja.

---

## Log Eksekusi Fix

| Bug | Propose | Approve | Eksekusi | Selesai |
|-----|---------|---------|----------|---------|
| BUG-A | ✅ | ✅ (SEDANG) | ✅ | ✅ |
| BUG-B | ✅ | ✅ (SEDANG) | ✅ | ✅ |
| BUG-C | ✅ | ✅ (SEDANG) | ✅ | ✅ |
