const pool = require('./db');
const {
  SITE_URL, esc, shortName, getRemainingDays,
  isServiceAdmin, findCountryByCode
} = require('./config');

const { 
  getAllShopsAdmin, getShopFromDb, 
  getBouquetsFromDb, isConfirmedRecently 
} = require('./db-actions');

const ADMIN_SHOP_PER_PAGE = 10;

async function showAdminPanel(bot, chatId, editMessageId) {
  const shops = await getAllShopsAdmin();
  const total = shops.length;
  const now = Date.now();
  const activeTrials = shops.filter(
    s => s.trialEnd && new Date(s.trialEnd).getTime() > now
  ).length;
  const expired = total - activeTrials;
  const blocked = shops.filter(s => s.blocked).length;
  const totalBouquets = shops.reduce((sum, s) => sum + s.bouquetsCount, 0);
  const totalOrders = shops.reduce((sum, s) => sum + s.orders, 0);
  const totalCalls = shops.reduce((sum, s) => sum + s.calls, 0);

  let txt = '🛡 <b>Админ-панель Flowind</b>\n\n';
  txt += '🏪 Всего магазинов: <b>' + total + '</b>\n';
  txt += '🟢 Активный триал: <b>' + activeTrials + '</b>\n';
  txt += '🔴 Истёк триал: <b>' + expired + '</b>\n';
  if (blocked > 0) {
    txt += '🚫 Заблокировано: <b>' + blocked + '</b>\n';
  }
  txt += '\n📦 Букетов на витринах: <b>' + totalBouquets + '</b>\n';
  txt += '📩 Заявок (сообщения): <b>' + totalOrders + '</b>\n';
  txt += '📞 Заявок (звонки): <b>' + totalCalls + '</b>';

  const buttons = [
    [{ text: '🏪 Список магазинов', callback_data: 'admin_shops_0' }],
    [{ text: '🔄 Обновить', callback_data: 'admin_refresh' }]
  ];

  const opts = {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  };

  if (editMessageId) {
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId, message_id: editMessageId, ...opts
      });
      return;
    } catch (e) { /* fallthrough */ }
  }
  return bot.sendMessage(chatId, txt, opts);
}

async function showAdminShopsList(bot, chatId, page, editMessageId) {
  const currentPage = page || 0;
  const shops = await getAllShopsAdmin();
  const totalPages = Math.max(1, Math.ceil(shops.length / ADMIN_SHOP_PER_PAGE));
  const safePage = Math.max(0, Math.min(currentPage, totalPages - 1));
  const start = safePage * ADMIN_SHOP_PER_PAGE;
  const slice = shops.slice(start, start + ADMIN_SHOP_PER_PAGE);

  let txt = '🏪 <b>Магазины</b> (' + shops.length + ')\n';
  if (totalPages > 1) {
    txt += 'Страница ' + (safePage + 1) + ' из ' + totalPages + '\n';
  }
  txt += '\n<i>Тапните на магазин для подробностей.</i>';

  const rows = [];
  const now = Date.now();
  
  for (const s of slice) {
    let emoji = '⚪';
    if (s.blocked) emoji = '🚫';
    else if (s.trialEnd) {
      const daysLeft = Math.ceil(
        (new Date(s.trialEnd).getTime() - now) / (24 * 60 * 60 * 1000)
      );
      if (daysLeft <= 0) emoji = '🔴';
      else if (daysLeft <= 7) emoji = '🟡';
      else emoji = '🟢';
    }
    const country = findCountryByCode(s.country);
    const flag = country ? country.label.split(' ')[0] : '';
    const name = shortName(s.displayName || s.shopId, 20);
    const label = flag ? flag + ' ' + emoji + ' ' + name : emoji + ' ' + name;
    
    rows.push([{
      text: label,
      callback_data: 'admin_shop_' + s.shopId
    }]);
  }

  if (totalPages > 1) {
    const nav = [];
    if (safePage > 0) {
      nav.push({ text: '⬅️ Назад', callback_data: 'admin_shops_' + (safePage - 1) });
    }
    nav.push({ text: (safePage + 1) + ' / ' + totalPages, callback_data: 'noop' });
    if (safePage < totalPages - 1) {
      nav.push({ text: 'Дальше ➡️', callback_data: 'admin_shops_' + (safePage + 1) });
    }
    rows.push(nav);
  }

  rows.push([{ text: '⬅️ Назад', callback_data: 'admin_main' }]);

  const opts = {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows }
  };

  if (editMessageId) {
    try {
      await bot.editMessageText(txt, {
        chat_id: chatId, message_id: editMessageId, ...opts
      });
      return;
    } catch (e) { /* fallthrough */ }
  }
  return bot.sendMessage(chatId, txt, opts);
}

async function showAdminShopCard(bot, chatId, shopId, editMessageId) {
  const shop = await getShopFromDb(shopId);
  if (!shop) {
    try {
      await bot.editMessageText('❌ Магазин не найден.', {
        chat_id: chatId, message_id: editMessageId
      });
    } catch (e) { /* ignore */ }
    return;
  }

  const all = await getBouquetsFromDb(shopId, false);
  const active = all.filter(isConfirmedRecently);
  const stats = shop.stats || {};
  const orders = stats.orders || 0;
  const calls = stats.calls || 0;
  const owner = shop.admins.find(a => a.role === 'owner');
  const florists = shop.admins.filter(a => a.role !== 'owner');

  const days = getRemainingDays(shop);
  let trialStatus = days > 0 ? '🟢 ' + days + ' дней' : '🔴 истёк';
  if (shop.blocked) {
    trialStatus = '🚫 ЗАБЛОКИРОВАН';
  }

  let txt = '🏪 <b>' + esc(shop.displayName) + '</b>\n';
  txt += '<code>' + esc(shop.shopId) + '</code>\n\n';

  const country = findCountryByCode(shop.country);
  if (country) {
    txt += '🌍 ' + country.label + '\n\n';
  }

  if (shop.blocked && shop.blockedReason) {
    txt += '🚫 <b>Причина блокировки:</b>\n';
    txt += '<i>' + esc(shop.blockedReason) + '</i>\n\n';
  }

  if (owner) {
    txt += '👑 Владелец: <b>';
    txt += esc(owner.name || 'Флорист') + '</b>\n';
    txt += '🆔 <code>' + owner.chatId + '</code>\n';
    if (shop.telegramUsername) {
      txt += '💬 @' + esc(shop.telegramUsername) + '\n';
    }
    if (shop.phone) {
      txt += '📞 ' + esc(formatPhone(shop.phone)) + '\n';
    }
  } else {
    txt += '⚠️ Владелец не найден\n';
  }

  if (florists.length > 0) {
    const names = florists.map(f => esc(f.name || 'без имени')).join(', ');
    txt += '\n👥 Флористы (' + florists.length + '): ';
    txt += names + '\n';
  } else {
    txt += '\n👥 Флористы: <i>нет</i>\n';
  }

  txt += '\n📦 На витрине: <b>' + active.length + '</b> из ' + all.length + '\n';
  txt += '📅 Триал: ' + trialStatus + '\n\n';
  txt += '📊 <b>Заявки:</b>\n';
  txt += '📩 Сообщения: ' + orders + '\n';
  txt += '📞 Звонки: ' + calls + '\n';

  const buttons = [
    [{ text: '⏱ Продлить на 7 дней', callback_data: 'admin_extend_7_' + shop.shopId }],
    [{ text: '⏱ Продлить на 30 дней', callback_data: 'admin_extend_30_' + shop.shopId }],
    [{ text: '⏱ Продлить на 90 дней', callback_data: 'admin_extend_90_' + shop.shopId }],
    [{ text: '💬 Написать владельцу', callback_data: 'admin_msg_' + shop.shopId }],
    [shop.blocked
      ? { text: '✅ Разблокировать', callback_data: 'admin_unblock_' + shop.shopId }
      : { text: '🚫 Заблокировать', callback_data: 'admin_block_' + shop.shopId }],
    [{ text: '🛒 Открыть витрину', url: SITE_URL + '/shop/' + shop.shopId }],
    [{ text: '⬅️ К списку', callback_data: 'admin_shops_0' }]
  ];

  try {
    await bot.editMessageText(txt, {
      chat_id: chatId,
      message_id: editMessageId,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (e) { /* ignore */ }
}

module.exports = { showAdminPanel, showAdminShopsList, showAdminShopCard };