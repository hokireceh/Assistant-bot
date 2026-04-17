const { isOwner, isAdmin } = require('./utils');

// ============================================================
// MAIN MENU
// ============================================================

function mainMenuKeyboard(userId) {
  const rows = [
    [
      { text: '🎯 Kelola Filter', callback_data: 'filter_menu' },
      { text: '📊 Status Bot',    callback_data: 'status' }
    ],
    [
      { text: '📈 Analytics',  callback_data: 'analytics' },
      { text: '🤖 AI Stats',   callback_data: 'ai_stats' }
    ],
    [
      { text: '🔔 Notif Stats', callback_data: 'notif_stats' }
    ]
  ];

  if (isOwner(userId)) {
    rows.push([{ text: '⚙️ Health Check', callback_data: 'health' }]);
  }

  return { inline_keyboard: rows };
}

// ============================================================
// FILTER MANAGER MENU
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
    ]
  ];

  if (isOwner(userId)) {
    rows.push([{ text: '💾 Export Filters', callback_data: 'filter_export' }]);
  }

  rows.push([{ text: '🔙 Kembali', callback_data: 'main_menu' }]);

  return { inline_keyboard: rows };
}

// ============================================================
// FILTER LIST PAGINATION
// ============================================================

function filterListKeyboard(currentPage, totalPages, backTo = 'filter_menu') {
  const navButtons = [];
  if (currentPage > 1) {
    navButtons.push({ text: '⬅️ Prev', callback_data: `filter_list_${currentPage - 1}` });
  }
  navButtons.push({ text: `${currentPage}/${totalPages}`, callback_data: 'noop' });
  if (currentPage < totalPages) {
    navButtons.push({ text: 'Next ➡️', callback_data: `filter_list_${currentPage + 1}` });
  }

  const rows = [];
  if (navButtons.length > 1 || (navButtons.length === 1 && navButtons[0].callback_data !== 'noop')) {
    rows.push(navButtons);
  }
  rows.push([{ text: '🔙 Kembali', callback_data: backTo }]);

  return { inline_keyboard: rows };
}

// ============================================================
// BACK BUTTON ONLY
// ============================================================

function backKeyboard(target = 'main_menu') {
  return {
    inline_keyboard: [[{ text: '🔙 Kembali', callback_data: target }]]
  };
}

function confirmDeleteKeyboard(filterName) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Ya, Hapus', callback_data: `filter_confirm_del:${filterName}` },
        { text: '❌ Batal',     callback_data: 'filter_menu' }
      ]
    ]
  };
}

// ============================================================
// PERSISTENT REPLY KEYBOARD (Menu Keyboard)
// Dikirim sekali saat /start agar muncul di bawah chat
// ============================================================

function adminMenuKeyboard() {
  return {
    keyboard: [
      [
        { text: '📋 Menu Utama' },
        { text: '🎯 Filter' }
      ],
      [
        { text: '📊 Status' }
      ]
    ],
    resize_keyboard: true,
    persistent: true
  };
}

// ============================================================
// NOOP & MISC
// ============================================================

function noopKeyboard() {
  return { inline_keyboard: [] };
}

module.exports = {
  mainMenuKeyboard,
  filterMenuKeyboard,
  filterListKeyboard,
  backKeyboard,
  confirmDeleteKeyboard,
  adminMenuKeyboard
};
