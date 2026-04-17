# Audit Harian Bot Hoki — v1
**Tanggal:** 2026-04-17  
**Auditor:** Agent  
**Scope:** Semua file src/ + index.js + config.js  
**Referensi Model Resmi:** https://console.groq.com/docs/models (lihat Prompt-Audit.md)

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

## Queue Issue (Urut Prioritas)

### ~~BUG-001~~ — ❌ FALSE POSITIVE | `src/config.js:34` — Model Tier 2 nama
- **Status:** ✅ DITUTUP — FALSE POSITIVE
- **Penjelasan:** Awalnya dikira `'groq/compound-mini'` tidak valid. Setelah dicek ke daftar resmi Groq (`https://console.groq.com/docs/models`), nama tersebut **sudah benar** — prefix `groq/` memang bagian dari nama resmi model. Tidak ada yang perlu diubah.

---

### BUG-002 — KRITIS | `src/config.js:68` — `GUARD_MODEL` menggunakan nama yang tidak ada di Groq
- **File:** `src/config.js` line 68
- **Masalah:** `name: 'meta-llama/llama-guard-4-12b'` — model ini **tidak ada** di daftar resmi Groq. Model guard yang tersedia di Groq adalah:
  - `meta-llama/llama-prompt-guard-2-22m` (14.4K/day, 15K TPM, 500K TPD)
  - `meta-llama/llama-prompt-guard-2-86m` (14.4K/day, 15K TPM, 500K TPD)
- **Dampak:** GUARD_MODEL tidak bisa dipanggil — meski saat ini GUARD_MODEL belum aktif digunakan dalam kode (hanya ditampilkan di ai_stats), ini adalah konfigurasi yang keliru dan limit-nya juga salah.
- **Status:** 🔴 OPEN — Menunggu approve

---

### BUG-003 — SEDANG | `src/db.js:59` — `created_at` di-reset saat filter diedit
- **File:** `src/db.js` line 59
- **Masalah:** `ON CONFLICT (name) DO UPDATE SET ... created_at = NOW()` — saat filter yang sudah ada diedit ulang (upsert), field `created_at` ikut diperbarui ke waktu sekarang. Artinya informasi "kapan filter pertama dibuat" hilang permanen setiap kali filter diedit.
- **Dampak:** Data `getFilterStats()` field `oldest_date` dan `oldest_name` menjadi tidak akurat setelah filter diedit.
- **Status:** 🔴 OPEN — Menunggu approve

---

### BUG-004 — SEDANG | `src/handlers.js:186-192` — Filter sticker + buttons tidak tampilkan inline keyboard
- **File:** `src/handlers.js` line 186-192
- **Masalah:** Saat filter bertipe sticker dan memiliki `buttons` (inline keyboard), bot mengirim dua pesan: 1) sticker, 2) teks. `replyMarkup` **tidak disertakan** di pesan teks kedua. Tombol inline tidak akan muncul untuk filter jenis ini.
- **Dampak:** Seluruh filter sticker yang punya tombol inline kehilangan fungsi tombolnya.
- **Status:** 🔴 OPEN — Menunggu approve

---

### BUG-005 — RINGAN | `src/ai.js:222-229` — `failedResponses` double-increment logic fragile
- **File:** `src/ai.js` line 222-229
- **Masalah:** Logika menghindari double-increment menggunakan string check: `!err.message.startsWith('Groq API')`. Sangat rapuh — jika pesan error berubah sedikit (misal typo, library update), counter bisa double-increment atau under-count tanpa ada peringatan.
- **Status:** 🔴 OPEN — Menunggu approve

---

### BUG-006 — RINGAN | `src/handlers.js` — Rate limit tidak dicek untuk `del/clone/rename filter`
- **File:** `src/handlers.js` — `handlePendingAction()`
- **Masalah:** Hanya `add_filter` yang melakukan `checkRateLimit()`. Operasi `del_filter`, `clone_filter`, dan `rename_filter` tidak ada rate limit check — admin bisa spam operasi ini tanpa throttle.
- **Status:** 🔴 OPEN — Menunggu approve

---

## Temuan Informasi (tidak perlu fix segera)

### INFO-001 — Duplikasi `httpsAgent` antara `index.js` dan `config.js`
- `config.js` mendefinisikan dan mengeksport `httpsAgent` tapi tidak dipakai di mana-mana
- `index.js` membuat `httpsAgent` sendiri untuk TelegramBot instance
- `fetch` di `ai.js` tidak bisa pakai httpsAgent (Node 18 global fetch tidak support `agent` option)
- Tetap aman karena `dns.setDefaultResultOrder('ipv4first')` sudah dipanggil

### INFO-002 — `AI_ENABLED` didefinisikan di dua tempat
- `config.js` line 84 dan `ai.js` line 267 keduanya mengekspor `AI_ENABLED`
- `handlers.js` konsisten import dari `config.js` — tidak konflik, hanya duplikasi

---

## Log Eksekusi Fix

| Bug | Propose | Approve | Eksekusi | Selesai |
|-----|---------|---------|----------|---------|
| BUG-001 | ✅ FALSE POSITIVE | — | — | ✅ Ditutup |
| BUG-002 | ✅ | ⏳ | — | — |
| BUG-003 | — | — | — | — |
| BUG-004 | — | — | — | — |
| BUG-005 | — | — | — | — |
| BUG-006 | — | — | — | — |
