const _topicMap = new Map();
const _allowedGroups = new Set(require('./config').TELEGRAM_TOPIC_GROUPS);

function captureTopic(ctx, next) {
  const msg = ctx.message || ctx.channelPost || ctx.editedMessage;
  const cbQuery = ctx.callbackQuery;
  const inlineQuery = ctx.inlineQuery;
  const updateType = msg ? 'message' : cbQuery ? 'callbackQuery' : inlineQuery ? 'inlineQuery' : 'unknown';
  
  if (msg) {
    const chat = msg.chat;
    console.log(`🔍 [DEEP] captureTopic msg: updateType=${updateType} chatId=${chat?.id} chatType=${chat?.type} isForum=${chat?.is_forum} threadId=${msg.message_thread_id} msgId=${msg.message_id} from=${msg.from?.id} text="${(msg.text||msg.caption||'').substring(0,30)}" hasReply=${!!msg.reply_to_message} replyToMsg=${msg.reply_to_message?.message_id} replyFrom=${msg.reply_to_message?.from?.id}`);
    
    if (chat?.id) {
      const gid = String(chat.id);
      const isAllowed = _allowedGroups.has(gid);
      if (!isAllowed) {
        console.log(`🔍 [DEEP] captureTopic: gid=${gid} NOT in allowedGroups [${[..._allowedGroups].join(',')}] — SKIPPING topic capture`);
        return next();
      }
      let entry = _topicMap.get(gid);
      if (!entry) entry = {};
      if (chat.is_forum) entry.isForum = true;
      const tid = msg.message_thread_id || (msg.is_topic_message ? msg.message_thread_id : 0);
      if (tid > 0) entry.topicId = tid;
      _topicMap.set(gid, entry);
      console.log(`🔍 [DEEP] captureTopic: CAPTURED gid=${gid} topicId=${tid} isForum=${chat.is_forum}`);
    }
  }

  if (cbQuery?.message) {
    const cbMsg = cbQuery.message;
    console.log(`🔍 [DEEP] captureTopic callback: chatId=${cbMsg.chat?.id} threadId=${cbMsg.message_thread_id} data="${cbQuery.data}"`);
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

  if (!msg && !cbQuery && !inlineQuery) {
    console.log(`🔍 [DEEP] captureTopic: UNKNOWN update type, keys=${Object.keys(ctx.update || {}).join(',')}`);
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
