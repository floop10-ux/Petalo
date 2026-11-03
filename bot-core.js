const lastNavByChat = {};
const NAV_TTL = 10 * 60 * 1000;

async function sendNav(bot, chatId, text, opts) {
  try {
    const prev = lastNavByChat[chatId];
    if (prev && (Date.now() - prev.ts) < NAV_TTL) {
      await bot.deleteMessage(chatId, prev.id).catch(function(){});
    }
  } catch (e) { /* ignore */ }
  const sent = await bot.sendMessage(chatId, text, opts);
  lastNavByChat[chatId] = { id: sent.message_id, ts: Date.now() };
  return sent;
}

module.exports = { sendNav, lastNavByChat };