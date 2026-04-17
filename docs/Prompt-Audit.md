# Prompt Audit — Bot Hoki

Dokumen ini berisi prompt standar yang digunakan untuk audit harian.  
Tujuan: konsistensi proses, reproducibility, dan referensi untuk audit berikutnya.

---

## Prompt Utama Audit

```
Audit harian untuk semua struktur ini
dengan cara:
Apakah logika ini benar, dan bagaimana implementasinya di kode kita.

Untuk catatan perubahan tulis ke docs/audit/audit-{nama audit}.md
Untuk referensi cek ke docs/{nama}-docs/ jika ada.

Catatan
Queue Issue (Fix satu per satu, urut prioritas)

Alur Kerja Per Issue:
  Step — Propose
  Step — Eksekusi

Aturan Tambahan:
  Satu issue = satu propose = satu approval. Jangan bundling.
  Jika menemukan issue tambahan di luar queue saat membaca file,
  catat dan laporkan setelah queue selesai — jangan fix tanpa lapor dulu.
  Semua log reasoning dalam Bahasa Indonesia. Code dan field names tetap English.

Mulai:
  Mulai dari issue pertama.
  Propose fix setelah konfirmasi kode bermasalah ditemukan.

---

## Checklist Audit Per File

Gunakan checklist ini saat mengaudit setiap file:

### `src/config.js`
- [ ] Nama model AI cocok dengan daftar resmi Groq (`https://console.groq.com/docs/models`)
- [ ] Limit RPM, dailyLimit, tokensPerMin, tokensPerDay sesuai dengan limit resmi Groq
- [ ] GUARD_MODEL menggunakan nama model yang ada di daftar resmi
- [ ] Tidak ada duplikasi inisialisasi (httpsAgent, dns, dll)

### `src/db.js`
- [ ] Query INSERT/UPDATE semantik benar (`created_at` tidak di-reset saat UPDATE)
- [ ] Semua parameterized query menggunakan `$1`, `$2`, dst (tidak ada raw string concatenation)
- [ ] Semua fungsi async punya error handling yang memadai
- [ ] `ON CONFLICT` clause tidak menimpa data yang seharusnya immutable

### `src/utils.js`
- [ ] `loadAdmins()` — parsing env var benar, tidak ada NaN masuk ke adminsSet
- [ ] `checkRateLimit()` — window dan max request sesuai kebutuhan
- [ ] `entitiesToHTML()` — semua entity type Telegram ditangani, tidak ada XSS
- [ ] `autoDeleteMessage()` — tidak ada memory leak di `deleteTimers`

### `src/ai.js`
- [ ] Model cascade logic benar: Tier 1 → Tier 2 → Tier 3 → null
- [ ] `failedResponses` tidak double-increment
- [ ] `clearTimeout` selalu dipanggil di semua code path (termasuk early return)
- [ ] Stale conversation cleanup bekerja untuk semua edge case
- [ ] `sanitizedMessage` cukup untuk mencegah prompt injection

### `src/handlers.js`
- [ ] `sendFilter()` — semua media type mengirim `replyMarkup` jika ada buttons
- [ ] `handlePendingAction()` — semua operasi tulis punya rate limit check
- [ ] `filter_confirm_del` — parsing `callback_data` aman dari split edge case
- [ ] `timeout_confirm` — parsing callback_data aman
- [ ] `pollingErrCount` tidak terus naik tanpa reset setelah recovery sukses
- [ ] `startDailyStats()` — timezone handling benar (jadwal jam 09:00 WIB)

### `src/keyboards.js`
- [ ] `filterListKeyboard()` — kondisi tampil nav row benar (tidak tampil jika hanya 1 halaman)
- [ ] Tidak ada `callback_data` yang melebihi 64 byte (limit Telegram)

### `index.js`
- [ ] DB retry logic memadai (5 percobaan, backoff bertahap)
- [ ] Graceful shutdown membersihkan semua timer dan koneksi
- [ ] `retryWithBackoff` dipakai untuk semua operasi network kritis saat startup

---

## Referensi Model Resmi Groq (per audit 2026-04-17)

Sumber: https://console.groq.com/docs/models

### Chat Completions

| Model | RPM | Req/Day | Tokens/Min | Tokens/Day |
|-------|-----|---------|------------|------------|
| allam-2-7b | 30 | 7K | 6K | 500K |
| groq/compound | 30 | 250 | 70K | No limit |
| groq/compound-mini | 30 | 250 | 70K | No limit |
| llama-3.1-8b-instant | 30 | 14.4K | 6K | 500K |
| llama-3.3-70b-versatile | 30 | 1K | 12K | 100K |
| meta-llama/llama-4-scout-17b-16e-instruct | 30 | 1K | 30K | 500K |
| meta-llama/llama-prompt-guard-2-22m | 30 | 14.4K | 15K | 500K |
| meta-llama/llama-prompt-guard-2-86m | 30 | 14.4K | 15K | 500K |
| openai/gpt-oss-120b | 30 | 1K | 8K | 200K |
| openai/gpt-oss-20b | 30 | 1K | 8K | 200K |
| openai/gpt-oss-safeguard-20b | 30 | 1K | 8K | 200K |
| qwen/qwen3-32b | 60 | 1K | 6K | 500K |

> **Catatan Penting:**
> - `groq/compound-mini` adalah nama resmi **dengan prefix `groq/`** — sudah benar di config.js
> - Model `meta-llama/llama-guard-4-12b` **tidak ada** di daftar resmi → lihat BUG-006 di audit-harian-v1.md
> - Limit di atas adalah Free Tier — bisa berbeda di paid tier

---

## Cara Menjalankan Audit

1. Buka semua file src/ + index.js
2. Gunakan checklist per file di atas
3. Catat temuan di `docs/audit/audit-harian-{tanggal}.md`
4. Urutkan bug berdasarkan prioritas: KRITIS → SEDANG → RINGAN
5. Propose satu per satu, tunggu approve sebelum eksekusi
6. Update tabel log eksekusi di dokumen audit setelah setiap fix

---

## Template Dokumen Audit

# Audit Harian Bot Hoki — v{N}
**Tanggal:** YYYY-MM-DD
**Auditor:** Agent
**Scope:** Semua file src/ + index.js + config.js

---

## Queue Issue (Prioritas)

### BUG-001 — [KRITIS/SEDANG/RINGAN] | `file:line` — Judul singkat
- **File:** `path/ke/file.js` line N
- **Masalah:** Penjelasan detail
- **Status:** 🔴 OPEN — Menunggu approve

---

## Log Eksekusi Fix

| Bug | Propose | Approve | Eksekusi | Selesai |
|-----|---------|---------|----------|---------|
| BUG-001 | ✅ | ⏳ | - | - |
```
