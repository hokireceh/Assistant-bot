const { isOwner } = require('./utils');

// ============================================================
// PERSISTENT REPLY KEYBOARD (Menu Keyboard)
// Tampil permanen di bawah chat, dikirim ulang saat /start
// 5 shortcut tombol untuk akses cepat semua fitur
// ============================================================
function adminMenuKeyboard() {
  return {
    keyboard: [
      [
        { text: '📋 Menu Utama' },
        { text: '🎯 Filter' }
      ],
      [
        { text: '📊 Status' },
        { text: '⚙️ Tools' }
      ],
      [
        { text: '🤖 Chat AI' },
        { text: '🌐 Translate' }
      ],
      [
        { text: '❓ Bantuan' }
      ]
    ],
    resize_keyboard:  true,
    persistent:       true,
    input_field_placeholder: 'Pilih menu atau ketik pesan...'
  };
}

// ============================================================
// MAIN MENU (inline)
// Entry point utama bot — semua fitur bisa diakses dari sini
// ============================================================
function mainMenuKeyboard(userId) {
  const rows = [
    [
      { text: '🎯 Kelola Filter', callback_data: 'filter_menu' },
      { text: '📊 Status Bot',    callback_data: 'status' }
    ],
    [
      { text: '⚙️ Admin Tools',   callback_data: 'admin_tools' },
      { text: '🤖 AI Hoki',       callback_data: 'ai_stats' }
    ],
    [
      { text: '❓ Bantuan',        callback_data: 'bantuan' }
    ]
  ];

  if (isOwner(userId)) {
    rows.push([{ text: '👑 Owner Panel', callback_data: 'owner_panel' }]);
  }

  return { inline_keyboard: rows };
}

// ============================================================
// ADMIN TOOLS MENU (inline)
// Timeout, Analytics, Notif Stats
// ============================================================
function adminToolsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⏱️ Timeout User',  callback_data: 'timeout_user' },
        { text: '📈 Analytics',     callback_data: 'analytics' }
      ],
      [
        { text: '🔔 Notif Stats',   callback_data: 'notif_stats' }
      ],
      [
        { text: '🔙 Kembali',       callback_data: 'main_menu' }
      ]
    ]
  };
}

// ============================================================
// OWNER PANEL (inline) — hanya untuk owner
// Reset AI, Health Check, Export Filters
// ============================================================
function ownerPanelKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '♻️ Reset AI Stats', callback_data: 'reset_ai' },
        { text: '⚙️ Health Check',   callback_data: 'health' }
      ],
      [
        { text: '💾 Export Filters', callback_data: 'filter_export' }
      ],
      [
        { text: '🔙 Kembali',        callback_data: 'main_menu' }
      ]
    ]
  };
}

// ============================================================
// RESET AI CONFIRM (inline)
// ============================================================
function resetAiConfirmKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Ya, Reset Sekarang', callback_data: 'reset_ai_confirm' },
        { text: '❌ Batal',              callback_data: 'owner_panel' }
      ]
    ]
  };
}

// ============================================================
// TIMEOUT CONFIRM (inline)
// ============================================================
function timeoutConfirmKeyboard(targetId, minutes) {
  return {
    inline_keyboard: [
      [
        { text: `✅ Timeout ${minutes} menit`, callback_data: `timeout_confirm:${targetId}:${minutes}` },
        { text: '❌ Batal',                    callback_data: 'admin_tools' }
      ]
    ]
  };
}

// ============================================================
// FILTER MANAGER MENU (inline)
// ============================================================
function filterMenuKeyboard(userId) {
  const rows = [
    [
      { text: '➕ Tambah Filter', callback_data: 'filter_add' },
      { text: '🗑️ Hapus Filter',  callback_data: 'filter_del' }
    ],
    [
      { text: '📋 Daftar Filter', callback_data: 'filter_list_1' },
      { text: '🔍 Cari Filter',   callback_data: 'filter_search' }
    ],
    [
      { text: '📋 Clone Filter',  callback_data: 'filter_clone' },
      { text: '✏️ Rename Filter', callback_data: 'filter_rename' }
    ],
    [
      { text: '🔙 Kembali',       callback_data: 'main_menu' }
    ]
  ];

  return { inline_keyboard: rows };
}

// ============================================================
// FILTER LIST PAGINATION (inline)
// ============================================================
function filterListKeyboard(currentPage, totalPages, backTo = 'filter_menu') {
  const nav = [];
  if (currentPage > 1)           nav.push({ text: '⬅️ Prev', callback_data: `filter_list_${currentPage - 1}` });
  nav.push({ text: `${currentPage}/${totalPages}`,             callback_data: 'noop' });
  if (currentPage < totalPages)  nav.push({ text: 'Next ➡️', callback_data: `filter_list_${currentPage + 1}` });

  const rows = [];
  // Hanya tampilkan nav row jika ada tombol prev/next selain indikator
  if (nav.length > 1 || (nav.length === 1 && nav[0].callback_data !== 'noop')) {
    rows.push(nav);
  }
  rows.push([{ text: '🔙 Kembali', callback_data: backTo }]);
  return { inline_keyboard: rows };
}

// ============================================================
// BACK BUTTON ONLY (inline)
// ============================================================
function backKeyboard(target = 'main_menu') {
  return {
    inline_keyboard: [[{ text: '🔙 Kembali', callback_data: target }]]
  };
}

// ============================================================
// CONFIRM DELETE FILTER (inline)
// ============================================================
function confirmDeleteKeyboard(filterName) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Ya, Hapus', callback_data: `fdel:${filterName}` },
        { text: '❌ Batal',     callback_data: 'filter_menu' }
      ]
    ]
  };
}

module.exports = {
  adminMenuKeyboard,
  mainMenuKeyboard,
  adminToolsKeyboard,
  ownerPanelKeyboard,
  resetAiConfirmKeyboard,
  timeoutConfirmKeyboard,
  filterMenuKeyboard,
  filterListKeyboard,
  backKeyboard,
  confirmDeleteKeyboard
};
