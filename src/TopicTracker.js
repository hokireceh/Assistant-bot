const _topicMap = new Map();
const _allowedGroups = new Set(require('./config').TELEGRAM_TOPIC_GROUPS);

function captureTopic(ctx, next) {
  const msg = ctx.message || ctx.channelPost || ctx.editedMessage;
  if (msg) {
    const chat = msg.chat;
    if (chat?.id) {
      const gid = String(chat.id);
      if (!_allowedGroups.has(gid)) return next();
      let entry = _topicMap.get(gid);
      if (!entry) entry = {};
      if (chat.is_forum) entry.isForum = true;
      const tid = msg.message_thread_id || (msg.is_topic_message ? msg.message_thread_id : 0);
      if (tid > 0) entry.topicId = tid;
      _topicMap.set(gid, entry);
    }
  }

  if (ctx.callbackQuery?.message) {
    const cbMsg = ctx.callbackQuery.message;
    if (cbMsg.chat?.id) {
      const gid = String(cbMsg.chat.id);
      if (!_allowedGroups.has(gid)) return next();
      let entry = _topicMap.get(gid);
      if (!entry) entry = {};
      const tid = cbMsg.message_thread_id || 0;
      if (tid > 0) entry.topicId = tid;
      if (cbMsg.chat.is_forum) entry.isForum = true;
      _topicMap.set(gid, entry);
    }
  }

  return next();
}

function getTopicId(groupId, configTopicId = 0) {
  if (configTopicId) return configTopicId;
  if (!_allowedGroups.has(String(groupId))) return 0;
  const entry = _topicMap.get(String(groupId));
  return entry?.topicId || 0;
}

function isForumChat(groupId) {
  const entry = _topicMap.get(String(groupId));
  return entry?.isForum || false;
}

function clearTopic(groupId) {
  _topicMap.delete(String(groupId));
}

function sendTelegramMessage(bot, chatId, text, opts = {}) {
  if (!opts.message_thread_id && parseInt(chatId, 10) < 0) {
    const tid = getTopicId(String(chatId));
    if (tid) opts = { ...opts, message_thread_id: tid };
  }
  return bot.api.sendMessage(chatId, text, opts);
}

module.exports = { captureTopic, getTopicId, isForumChat, clearTopic, sendTelegramMessage };
