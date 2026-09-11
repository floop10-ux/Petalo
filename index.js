const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const PRESET_SHOP = {
  shopId: 'kupidon',
  displayName: '🌸 Kupidon - для цветов не нужен повод',
  address: 'Ставрополь, Краснофлотская 157/1',
  hours: 'Пн-Вс 10:30-21:00',
  phone: '+7 962 402-51-75',
  telegramUsername: 'KupidonAdm',
  markupPercent: 20,
  trialMonths: 3
};

const shops = {};
const userToShop = {};
const registrationState = {};
const lastBouquetByUser = {};
const awaitingUpload = {};
const inviteIndex = {};

let idCounter = 1;

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '📷 Добавить букет' }, { text: '✅ Что в наличии?' }],
    [{ text: '🗑 Удалить букет' }, { text: '⚙️ Меню' }]
  ],
  resize_keyboard: true
};

const SETTINGS_MENU = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🔗 Ссылка на витрину', callback_data: 'menu_link' }],
      [{ text: '🔑 Пригласить флориста', callback_data: 'menu_invite' }],
      [{ text: '🎨 Логотип', callback_data: 'menu_logo' }, { text: '🖼 Фон витрины', callback_data: 'menu_background' }],
      [{ text: '📊 Статус магазина', callback_data: 'menu_status' }],
      [{ text: '💳 Продлить подписку', callback_data: 'menu_renew' }],
      [{ text: '❌ Закрыть', callback_data: 'menu_close' }]
    ]
  }
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// ---------- Генерация описания через ИИ (Pollinations, бесплатно) ----------
async function generateDescription(name, price) {
  if (typeof fetch !== 'function') return null;
  try {
    const prompt = `Сгенерируй короткое (1-2 предложения) красивое описание для букета на витрине цветочного магазина. Название: "${name}". Цена: ${price} руб. Пиши тепло, продающе, без кавычек, без вводных слов. Пример стиля: "Нежные розы в крафтовой упаковке — идеальный подарок для любимой. Подчеркнут ваши чувства."`;
    const url = 'https://text.pollinations.ai/' + encodeURIComponent(prompt);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    let text = (await res.text()).trim();
    // Чистим от кавычек и мусора
    text = text.replace(/^["«"']+|["»"']+$/g, '').trim();
    // Если слишком длинно — обрезаем
    if (text.length > 220) text = text.slice(0, 220) + '…';
    if (text.length < 10) return null;
    return text;
  } catch (e) {
    console.error('AI error:', e.message);
    return null;
  }
}

function initPresetShop() {
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setMonth(trialEnd.getMonth() + PRESET_SHOP.trialMonths);
  const inviteCode = generateInviteCode();
  inviteIndex[inviteCode] = PRESET_SHOP.shopId;

  shops[PRESET_SHOP.shopId] = {
    name: PRESET_SHOP.shopId,
    displayName: PRESET_SHOP.displayName,
    address: PRESET_SHOP.address,
    hours: PRESET_SHOP.hours,
    phone: PRESET_SHOP.phone,
    telegramUsername: PRESET_SHOP.telegramUsername,
    inviteCode: inviteCode,
    bouquets: [],
    admins: [],
    subscription: { status: 'trial', trialStart: now.toISOString(), trialEnd: trialEnd.toISOString(), paidUntil: null },
    settings: { logo: null, background: null, markupPercent: PRESET_SHOP.markupPercent, aiEnabled: true }
  };
  console.log(`✅ Магазин "${PRESET_SHOP.shopId}" создан. Invite: ${inviteCode}`);
}
initPresetShop();

function getShopId(chatId) { return userToShop[chatId] || null; }
function getShop(shopId) { return shops[shopId] || null; }

function isSubscriptionActive(shop) {
  if (!shop || !shop.subscription) return false;
  const now = Date.now();
  if (shop.subscription.status === 'trial') return now < new Date(shop.subscription.trialEnd).getTime();
  if (shop.subscription.status === 'active') return shop.subscription.paidUntil ? now < new Date(shop.subscription.paidUntil).getTime() : false;
  return false;
}

function getRemainingDays(shop) {
  if (!shop || !shop.subscription) return 0;
  const now = Date.now();
  let end;
  if (shop.subscription.status === 'trial') end = new Date(shop.subscription.trialEnd).getTime();
  else if (shop.subscription.status === 'active' && shop.subscription.paidUntil) end = new Date(shop.subscription.paidUntil).getTime();
  else return 0;
  const diff = end - now;
  return diff <= 0 ? 0 : Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function isConfirmedRecently(bouquet) {
  if (bouquet.isPinned) return true;
  if (!bouquet.confirmedAt) return false;
  const age = Date.now() - new Date(bouquet.confirmedAt).getTime();
  return age < 3 * 24 * 60 * 60 * 1000;
}

function getBouquetStatus(b) {
  if (b.isPinned) return 'pinned';
  if (!b.confirmedAt) return 'expired';
  const age = Date.now() - new Date(b.confirmedAt).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  if (age < oneDay) return 'fresh';
  if (age < 3 * oneDay) return 'stale';
  return 'expired';
}

function hoursLeft(b) {
  if (b.isPinned) return null;
  if (!b.confirmedAt) return 0;
  const age = Date.now() - new Date(b.confirmedAt).getTime();
  const rem = 3 * 24 * 60 * 60 * 1000 - age;
  if (rem <= 0) return 0;
  return Math.round(rem / 3600000);
}

function buildCheckMessage(shop) {
  if (shop.bouquets.length === 0) {
    return { 
      text: '🌿 <b>Нет букетов.</b>\n\nДобавьте первый через «📷 Добавить букет».', 
      options: { parse_mode: 'HTML' } 
    };
  }

  const fresh = [], stale = [], expired = [], pinned = [];
  for (const b of shop.bouquets) {
    const s = getBouquetStatus(b);
    if (s === 'fresh') fresh.push(b);
    else if (s === 'stale') stale.push(b);
    else if (s === 'expired') expired.push(b);
    else if (s === 'pinned') pinned.push(b);
  }

  fresh.sort((a,b) => new Date(b.confirmedAt) - new Date(a.confirmedAt));
  stale.sort((a,b) => new Date(a.confirmedAt) - new Date(b.confirmedAt));

  let text = '✅ <b>Что есть в наличии?</b>\n';
  text += '<i>Нажмите на букет, чтобы подтвердить или вернуть.</i>';

  const keyboard = [];

  if (fresh.length > 0) {
    text += `\n\n━━━━━━━━━━━━━━━\n✅ <b>ЕСТЬ В НАЛИЧИИ</b> (${fresh.length})\n━━━━━━━━━━━━━━━\n`;
    for (const b of fresh) {
      text += `✅ ${esc(b.name)} — ${b.price} ₽\n`;
      const name = b.name.length > 22 ? b.name.slice(0, 20) + '…' : b.name;
      keyboard.push([{ text: `✅ ${name}`, callback_data: `confirm_${b.id}` }]);
    }
  }

  if (stale.length > 0) {
    text += `\n━━━━━━━━━━━━━━━\n⏰ <b>СКОРО ИСЧЕЗНУТ</b> (${stale.length})\n━━━━━━━━━━━━━━━\n`;
    text += `<i>Если не подтвердить — исчезнут с витрины.</i>\n`;
    for (const b of stale) {
      const h = hoursLeft(b);
      text += `⏰ ${esc(b.name)} — ${b.price} ₽ <b>(осталось ${h}ч)</b>\n`;
      const name = b.name.length > 18 ? b.name.slice(0, 16) + '…' : b.name;
      keyboard.push([{ text: `⏰ ${name} — ${h}ч`, callback_data: `confirm_${b.id}` }]);
    }
  }

  if (expired.length > 0) {
    text += `\n━━━━━━━━━━━━━━━\n❌ <b>СКРЫТЫ С ВИТРИНЫ</b> (${expired.length})\n━━━━━━━━━━━━━━━\n`;
    text += `<i>Клиенты их не видят. Нажмите, чтобы вернуть.</i>\n`;
    for (const b of expired) {
      text += `❌ ${esc(b.name)} — ${b.price} ₽\n`;
      const name = b.name.length > 18 ? b.name.slice(0, 16) + '…' : b.name;
      keyboard.push([{ text: `↩️ Вернуть: ${name}`, callback_data: `confirm_${b.id}` }]);
    }
  }

  if (pinned.length > 0) {
    text += `\n━━━━━━━━━━━━━━━\n⭐ <b>ЗАКРЕПЛЕНЫ</b> (${pinned.length})\n━━━━━━━━━━━━━━━\n`;
    text += `<i>Показываются всегда, не исчезают.</i>\n`;
    for (const b of pinned) {
      text += `⭐ ${esc(b.name)} — ${b.price} ₽\n`;
    }
  }

  return { 
    text, 
    options: { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } } 
  };
}

function buildDeleteMessage(shop) {
  if (shop.bouquets.length === 0) return { text: '🌿 Букетов пока нет.', options: {} };
  const order = { fresh: 0, stale: 1, expired: 2, pinned: 3 };
  const sorted = [...shop.bouquets].sort((a, b) => {
    const sa = getBouquetStatus(a), sb = getBouquetStatus(b);
    if (order[sa] !== order[sb]) return order[sa] - order[sb];
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const keyboard = sorted.slice(0, 30).map(b => {
    const name = b.name.length > 25 ? b.name.slice(0, 22) + '…' : b.name;
    return [{
      text: `🗑 ${name} — ${b.price} ₽`,
      callback_data: `askdel_${b.id}`
    }];
  });
  return {
    text: `🗑 Выберите букет для удаления.\nВсего: ${shop.bouquets.length}`,
    options: { reply_markup: { inline_keyboard: keyboard } }
  };
}

function attachUserToShop(chatId, shopId) {
  userToShop[chatId] = shopId;
  if (!shops[shopId].admins.includes(chatId)) shops[shopId].admins.push(chatId);
}

function sendMainMenu(chatId, text) {
  bot.sendMessage(chatId, text, { reply_markup: MAIN_KEYBOARD });
}

// ---------- Старт ----------
bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const param = match && match[1] ? match[1].trim() : null;

  if (param && param.startsWith('inv_')) {
    const inviteCode = param.replace('inv_', '').toUpperCase();
    const shopId = inviteIndex[inviteCode];
    if (shopId && shops[shopId]) {
      if (userToShop[chatId] && userToShop[chatId] !== shopId) {
        return sendMainMenu(chatId, `❌ Вы уже привязаны к другому магазину.`);
      }
      attachUserToShop(chatId, shopId);
      const shop = shops[shopId];
      return sendMainMenu(chatId, `🎉 Добро пожаловать в «${shop.displayName}»!\n\nИспользуйте кнопки внизу 👇`);
    } else {
      return sendMainMenu(chatId, '❌ Приглашение недействительно.');
    }
  }

  let shopId = getShopId(chatId);
  if (!shopId && shops[PRESET_SHOP.shopId] && shops[PRESET_SHOP.shopId].admins.length === 0) {
    attachUserToShop(chatId, PRESET_SHOP.shopId);
    shopId = PRESET_SHOP.shopId;
  }

  if (shopId) {
    const shop = getShop(shopId);
    sendMainMenu(chatId, 
      `🌸 «${shop.displayName}»\n\n` +
      `📷 Добавить букет — отправить фото с подписью\n` +
      `✅ Что в наличии — отметить актуальные\n` +
      `🗑 Удалить — убрать букет\n` +
      `⚙️ Меню — все настройки`
    );
  } else {
    sendMainMenu(chatId, '🌸 Petalo — витрина для цветочных магазинов.\n\n/register — создать свой магазин');
  }
});

// ---------- Тексты ----------
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;
  if (text.startsWith('/')) return;

  if (text === '📷 Добавить букет') {
    const shopId = getShopId(chatId);
    if (!shopId) return sendMainMenu(chatId, '❌ Сначала /start');
    return sendMainMenu(chatId, 
      '📷 Как добавить букет:\n\n' +
      '1️⃣ Сфотографируйте букет\n' +
      '2️⃣ Отправьте фото сюда\n' +
      '3️⃣ В подписи напишите: Название и цена\n\n' +
      'Пример: «Розы в крафте 4500»\n\n' +
      '🤖 Бот сам сгенерирует красивое описание для витрины.\n\n' +
      '💡 Ещё фото? Отправьте их следом без подписи.'
    );
  }

  if (text === '✅ Что в наличии?') {
    const shopId = getShopId(chatId);
    if (!shopId) return sendMainMenu(chatId, '❌ Сначала /start');
    const shop = getShop(shopId);
    if (!isSubscriptionActive(shop)) return sendMainMenu(chatId, '❌ Подписка истекла.');
    const { text: t, options } = buildCheckMessage(shop);
    return bot.sendMessage(chatId, t, options);
  }

  if (text === '🗑 Удалить букет') {
    const shopId = getShopId(chatId);
    if (!shopId) return sendMainMenu(chatId, '❌ Сначала /start');
    const shop = getShop(shopId);
    const { text: t, options } = buildDeleteMessage(shop);
    return bot.sendMessage(chatId, t, options);
  }

  if (text === '⚙️ Меню') {
    const shopId = getShopId(chatId);
    if (!shopId) return sendMainMenu(chatId, '❌ Сначала /start');
    return bot.sendMessage(chatId, '⚙️ Меню магазина:', SETTINGS_MENU);
  }

  const state = registrationState[chatId];
  if (!state) return;

  if (state.step === 'name') {
    const name = text.trim().toLowerCase().replace(/\s+/g, '_');
    if (!/^[a-z0-9_]+$/.test(name)) return bot.sendMessage(chatId, '❌ Только латиница, цифры, _. Снова:');
    if (shops[name]) return bot.sendMessage(chatId, '❌ Имя занято. Другое:');
    state.data.shopId = name;
    state.step = 'displayName';
    return bot.sendMessage(chatId, '✅ Шаг 2 из 5.\n**Красивое название**.');
  }
  if (state.step === 'displayName') {
    if (text.length < 2 || text.length > 60) return bot.sendMessage(chatId, '❌ От 2 до 60 символов. Снова:');
    state.data.displayName = text.trim();
    state.step = 'address';
    return bot.sendMessage(chatId, '✅ Шаг 3 из 5.\n**Адрес** (или "нет").');
  }
  if (state.step === 'address') {
    state.data.address = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    state.step = 'hours';
    return bot.sendMessage(chatId, '✅ Шаг 4 из 5.\n**Часы работы** (или "нет").');
  }
  if (state.step === 'hours') {
    state.data.hours = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    state.step = 'phone';
    return bot.sendMessage(chatId, '✅ Шаг 5 из 5.\n**Телефон** (или "нет").');
  }
  if (state.step === 'phone') {
    state.data.phone = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setMonth(trialEnd.getMonth() + PRESET_SHOP.trialMonths);
    const newInvite = generateInviteCode();
    inviteIndex[newInvite] = state.data.shopId;
    shops[state.data.shopId] = {
      name: state.data.shopId,
      displayName: state.data.displayName,
      address: state.data.address,
      hours: state.data.hours,
      phone: state.data.phone,
      telegramUsername: PRESET_SHOP.telegramUsername,
      inviteCode: newInvite,
      bouquets: [],
      admins: [chatId],
      subscription: { status: 'trial', trialStart: now.toISOString(), trialEnd: trialEnd.toISOString(), paidUntil: null },
      settings: { logo: null, background: null, markupPercent: PRESET_SHOP.markupPercent, aiEnabled: true }
    };
    userToShop[chatId] = state.data.shopId;
    delete registrationState[chatId];
    return sendMainMenu(chatId, `🎉 Магазин создан!\n🔗 https://petalo.onrender.com/shop/${state.data.shopId}`);
  }
});

// ---------- Слэш-команды ----------
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (userToShop[chatId]) return bot.sendMessage(chatId, '❌ Вы уже привязаны к магазину.');
  registrationState[chatId] = { step: 'name', data: {} };
  bot.sendMessage(chatId, '📝 Шаг 1 из 5.\n\n**Техническое имя** (латиницей).\nПример: `flowers_msk`');
});

bot.onText(/\/invite/, (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ Сначала /start');
  const shop = getShop(shopId);
  const link = `https://t.me/petalo_rus_bot?start=inv_${shop.inviteCode}`;
  bot.sendMessage(chatId, `🔑 Ссылка для флористов:\n\n${link}`);
});

bot.onText(/\/check/, (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ /start');
  const shop = getShop(shopId);
  const { text, options } = buildCheckMessage(shop);
  bot.sendMessage(chatId, text, options);
});

bot.onText(/\/delete/, (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ /start');
  const shop = getShop(shopId);
  const { text, options } = buildDeleteMessage(shop);
  bot.sendMessage(chatId, text, options);
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌');
  const shop = getShop(shopId);
  const days = getRemainingDays(shop);
  let txt = `📊 ${shop.displayName}\n👥 Флористов: ${shop.admins.length}\n📦 Букетов: ${shop.bouquets.length}\n`;
  txt += shop.subscription.status === 'trial' ? `Триал: ${days} дней\n` : `Активна: ${days} дней\n`;
  bot.sendMessage(chatId, txt);
});

bot.onText(/\/renew/, (msg) => bot.sendMessage(msg.chat.id, '💳 @floop10'));

bot.onText(/\/cancel/, (msg) => {
  const chatId = msg.chat.id;
  if (awaitingUpload[chatId]) {
    delete awaitingUpload[chatId];
    sendMainMenu(chatId, '❌ Отменено.');
  }
});

// ---------- Фото ----------
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  let shopId = getShopId(chatId);
  if (!shopId) return sendMainMenu(chatId, '❌ Вы не привязаны к магазину.');
  const shop = getShop(shopId);

  const awaiting = awaitingUpload[chatId];
  if (awaiting) {
    const photo = msg.photo[msg.photo.length - 1];
    let filePath = '';
    try { const fi = await bot.getFile(photo.file_id); filePath = fi.file_path; }
    catch (e) { return sendMainMenu(chatId, '❌ Ошибка загрузки.'); }
    if (awaiting === 'logo') {
      shop.settings.logo = filePath;
      delete awaitingUpload[chatId];
      return sendMainMenu(chatId, '✅ Логотип установлен!');
    }
    if (awaiting === 'background') {
      shop.settings.background = filePath;
      delete awaitingUpload[chatId];
      return sendMainMenu(chatId, '✅ Фон установлен!');
    }
    return;
  }

  if (!isSubscriptionActive(shop)) return sendMainMenu(chatId, '❌ Подписка истекла.');

  const caption = (msg.caption || '').trim();
  const photo = msg.photo[msg.photo.length - 1];
  let filePath = '';
  try { const fi = await bot.getFile(photo.file_id); filePath = fi.file_path; }
  catch (e) { return sendMainMenu(chatId, '❌ Ошибка фото.'); }

  if (caption) {
    const words = caption.split(/\s+/);
    let price = 0, name = caption;
    for (let i = words.length - 1; i >= 0; i--) {
      const num = parseFloat(words[i]);
      if (!isNaN(num) && num > 0) { price = num; name = words.slice(0, i).join(' '); break; }
    }
    if (price === 0 || name === '') return sendMainMenu(chatId, '❌ Укажите цену в конце. Пример: "Розы 4500"');

    const finalName = name.trim();

    // ---- Сначала сообщим, что добавляем ----
    bot.sendMessage(chatId, '⏳ Добавляю букет и генерирую описание…');

    // ---- Генерируем описание через ИИ (если включено) ----
    let description = null;
    if (shop.settings.aiEnabled !== false) {
      description = await generateDescription(finalName, price);
    }

    const bouquet = {
      id: idCounter++,
      name: finalName,
      price: price,
      description: description,
      photos: [filePath],
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      isPinned: finalName.startsWith('.'),
      chatId: chatId,
      reminded: false
    };
    shop.bouquets.push(bouquet);
    lastBouquetByUser[chatId] = bouquet.id;

    let replyText = `✅ Букет «${finalName}» добавлен! ${price} ₽`;
    if (description) {
      replyText += `\n\n✨ Описание: ${description}`;
    } else {
      replyText += `\n\n<i>(описание не сгенерировано)</i>`;
    }
    replyText += `\n\n💡 Ещё фото? Отправьте без подписи.`;

    return bot.sendMessage(chatId, replyText, { parse_mode: 'HTML', reply_markup: MAIN_KEYBOARD });
  }

  const lastId = lastBouquetByUser[chatId];
  if (!lastId) return sendMainMenu(chatId, '❌ Отправьте фото с подписью.');
  const bouquet = shop.bouquets.find(b => b.id === lastId);
  if (!bouquet) return sendMainMenu(chatId, '❌ Букет не найден.');
  bouquet.photos.push(filePath);
  sendMainMenu(chatId, `📸 Фото добавлено. Всего: ${bouquet.photos.length}`);
});

// ---------- Кнопки ----------
bot.on('callback_query', (q) => {
  const chatId = q.from.id;
  const data = q.data;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.answerCallbackQuery(q.id, { text: 'Ошибка' });
  const shop = getShop(shopId);

  if (data === 'menu_link') {
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, `🔗 Ваша витрина:\nhttps://petalo.onrender.com/shop/${shopId}`);
  }
  if (data === 'menu_invite') {
    const link = `https://t.me/petalo_rus_bot?start=inv_${shop.inviteCode}`;
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, `🔑 Ссылка-приглашение:\n\n${link}`);
  }
  if (data === 'menu_logo') {
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, 
      shop.settings.logo ? '🎨 Логотип установлен.' : '🎨 Логотип не установлен.',
      { reply_markup: { inline_keyboard: [
        [{ text: '📷 Загрузить новый', callback_data: 'setlogo_now' }],
        [{ text: '🗑 Убрать логотип', callback_data: 'resetlogo_now' }],
        [{ text: '↩️ Назад', callback_data: 'menu_back' }]
      ]}}
    );
  }
  if (data === 'menu_background') {
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, 
      shop.settings.background ? '🖼 Фон установлен.' : '🖼 Фон не установлен.',
      { reply_markup: { inline_keyboard: [
        [{ text: '📷 Загрузить новый', callback_data: 'setbg_now' }],
        [{ text: '🗑 Убрать фон', callback_data: 'resetbg_now' }],
        [{ text: '↩️ Назад', callback_data: 'menu_back' }]
      ]}}
    );
  }
  if (data === 'menu_status') {
    const days = getRemainingDays(shop);
    const aiStatus = shop.settings.aiEnabled !== false ? '✅ включены' : '❌ выключены';
    let txt = `📊 Статус\n\n🏪 ${shop.displayName}\n👥 Флористов: ${shop.admins.length}\n📦 Букетов: ${shop.bouquets.length}\n📅 ${shop.subscription.status === 'trial' ? 'Триал' : 'Подписка'}: ${days} дней\n🤖 ИИ-описания: ${aiStatus}`;
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]] } });
  }
  if (data === 'menu_renew') {
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, '💳 Для продления: @floop10', { reply_markup: { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]] } });
  }
  if (data === 'menu_close') {
    bot.answerCallbackQuery(q.id);
    return bot.deleteMessage(chatId, q.message.message_id).catch(() => {});
  }
  if (data === 'menu_back') {
    bot.answerCallbackQuery(q.id);
    return bot.editMessageText('⚙️ Меню магазина:', { chat_id: chatId, message_id: q.message.message_id, ...SETTINGS_MENU }).catch(() => {});
  }
  if (data === 'setlogo_now') {
    awaitingUpload[chatId] = 'logo';
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, '📷 Отправьте фото — установлю как логотип.\n(/cancel — отмена)');
  }
  if (data === 'setbg_now') {
    awaitingUpload[chatId] = 'background';
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, '📷 Отправьте фото — установлю как фон.\n(/cancel — отмена)');
  }
  if (data === 'resetlogo_now') {
    shop.settings.logo = null;
    bot.answerCallbackQuery(q.id, { text: '✅ Логотип убран' });
    return bot.editMessageText('✅ Логотип убран.', { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
  }
  if (data === 'resetbg_now') {
    shop.settings.background = null;
    bot.answerCallbackQuery(q.id, { text: '✅ Фон убран' });
    return bot.editMessageText('✅ Фон убран.', { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
  }

  if (data.startsWith('confirm_')) {
    const id = parseInt(data.split('_')[1]);
    const b = shop.bouquets.find(x => x.id === id);
    if (b) {
      b.confirmedAt = new Date().toISOString();
      b.reminded = false;
      bot.answerCallbackQuery(q.id, { text: '✅ Подтверждено!' });
      const { text, options } = buildCheckMessage(shop);
      bot.editMessageText(text, { chat_id: chatId, message_id: q.message.message_id, ...options }).catch(() => {});
    } else {
      bot.answerCallbackQuery(q.id, { text: '❌ Не найден' });
    }
    return;
  }
  if (data.startsWith('extend_')) {
    const id = parseInt(data.split('_')[1]);
    const b = shop.bouquets.find(x => x.id === id);
    if (b) {
      b.confirmedAt = new Date().toISOString();
      b.reminded = false;
      bot.answerCallbackQuery(q.id, { text: '✅ Продлено' });
      bot.sendMessage(chatId, `🌿 Букет «${b.name}» продлён.`);
    } else {
      bot.answerCallbackQuery(q.id, { text: '❌' });
    }
    return;
  }
  if (data.startsWith('askdel_')) {
    const id = parseInt(data.split('_')[1]);
    const b = shop.bouquets.find(x => x.id === id);
    if (!b) return bot.answerCallbackQuery(q.id, { text: '❌ Не найден' });
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(chatId, 
      `🗑 Удалить букет «${b.name}» (${b.price} ₽)?\n\nЭто действие нельзя отменить.`,
      { reply_markup: { inline_keyboard: [
        [{ text: '🗑 Да, удалить', callback_data: `confirmdel_${b.id}` }],
        [{ text: '↩️ Отмена', callback_data: 'canceldel' }]
      ]}}
    );
  }
  if (data.startsWith('confirmdel_')) {
    const id = parseInt(data.split('_')[1]);
    const idx = shop.bouquets.findIndex(x => x.id === id);
    if (idx === -1) {
      bot.answerCallbackQuery(q.id, { text: '❌ Уже удалён' });
      return bot.editMessageText('❌ Букет уже удалён.', { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
    }
    const name = shop.bouquets[idx].name;
    shop.bouquets.splice(idx, 1);
    bot.answerCallbackQuery(q.id, { text: '🗑 Удалено' });
    bot.editMessageText(`✅ Букет «${name}» удалён.`, { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
    return;
  }
  if (data === 'canceldel') {
    bot.answerCallbackQuery(q.id, { text: 'Отменено' });
    bot.editMessageText('❌ Удаление отменено.', { chat_id: chatId, message_id: q.message.message_id }).catch(() => {});
    return;
  }
});

// ---------- Уведомления ----------
function checkAndNotify() {
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const twelveHours = 12 * 60 * 60 * 1000;
  for (const id in shops) {
    const shop = shops[id];
    if (!isSubscriptionActive(shop)) continue;
    for (const b of shop.bouquets) {
      if (b.isPinned) continue;
      if (!b.confirmedAt) continue;
      const age = now - new Date(b.confirmedAt).getTime();
      const rem = threeDays - age;
      if (rem > 0 && rem <= twelveHours && !b.reminded) {
        bot.sendMessage(b.chatId, 
          `⚠️ Букет «${b.name}» скоро скроется (нет подтверждения ~3 дня).\nЕсли он ещё в наличии — нажмите:`,
          { reply_markup: { inline_keyboard: [[{ text: '🌿 Продлить на 3 дня', callback_data: `extend_${b.id}` }]] } }
        );
        b.reminded = true;
      }
    }
  }
}
setInterval(checkAndNotify, 10 * 60 * 1000);

// ---------- Витрина ----------
app.get('/shop/:shopId', (req, res) => {
  const shop = getShop(req.params.shopId);
  if (!shop) return res.status(404).send('❌ Магазин не найден');

  if (!isSubscriptionActive(shop)) {
    return res.send(`<html><head><meta charset="UTF-8"><title>Petalo</title>
      <style>body{font-family:sans-serif;text-align:center;padding:50px;background:#fafaf8;}</style></head>
      <body><h1>🌸 ${shop.displayName}</h1><p style="font-size:20px;">Витрина приостановлена.</p></body></html>`);
  }

  let bouquets = shop.bouquets.filter(isConfirmedRecently);
  bouquets.sort((a,b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.confirmedAt || b.createdAt) - new Date(a.confirmedAt || a.createdAt);
  });

  let cards = '';
  if (bouquets.length === 0) {
    cards = '<div style="text-align:center;padding:50px;font-size:20px;color:#888;">🌿 Пока нет букетов.</div>';
  } else {
    for (const b of bouquets) {
      let galleryHTML = '';
      if (b.photos.length === 1) {
        const photoUrl = `https://api.telegram.org/file/bot${token}/${b.photos[0]}`;
        galleryHTML = `<img src="${photoUrl}" style="width:100%;border-radius:12px;aspect-ratio:1/1;object-fit:cover;">`;
      } else {
        const slides = b.photos.map(p => 
          `<img src="https://api.telegram.org/file/bot${token}/${p}" style="height:220px;width:auto;border-radius:12px;flex-shrink:0;scroll-snap-align:start;">`
        ).join('');
        galleryHTML = `
          <div style="display:flex;overflow-x:auto;gap:6px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;margin-bottom:4px;">
            ${slides}
          </div>
          <div style="font-size:12px;color:#aaa;margin-bottom:6px;">← листайте фото →</div>
        `;
      }
      const oldPrice = Math.ceil(b.price * (1 + shop.settings.markupPercent / 100) / 100) * 100;
      const descHTML = b.description 
        ? `<p style="font-size:13px;color:#777;font-style:italic;margin:4px 0 8px;line-height:1.4;">${b.description}</p>` 
        : '';
      cards += `
        <div style="border:1px solid #eee;border-radius:16px;padding:16px;margin:12px;max-width:300px;display:inline-block;vertical-align:top;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.08);text-align:center;">
          ${galleryHTML}
          <h3 style="margin:12px 0 6px;font-family:sans-serif;">${b.name}</h3>
          ${descHTML}
          <p style="font-size:22px;font-weight:bold;color:#2c3e50;margin:6px 0;">
            <span style="text-decoration:line-through;color:#999;font-weight:normal;font-size:18px;">${oldPrice} ₽</span>
            &nbsp; ${b.price} ₽
          </p>
          ${b.isPinned ? '<span style="background:#f1c40f;padding:2px 10px;border-radius:20px;font-size:12px;">⭐ Закреплён</span><br>' : ''}
          <a href="tg://resolve?domain=${shop.telegramUsername}" style="display:block;margin-top:12px;background:#4CAF50;color:#fff;padding:12px 20px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;">📩 Заказать</a>
          ${shop.phone ? `<a href="tel:${shop.phone.replace(/\D/g,'')}" style="display:block;margin-top:8px;background:#3498db;color:#fff;padding:12px 20px;border-radius:30px;text-decoration:none;font-weight:bold;text-align:center;">📞 Позвонить</a>` : ''}
        </div>
      `;
    }
  }

  const logoUrl = shop.settings.logo ? `https://api.telegram.org/file/bot${token}/${shop.settings.logo}` : null;
  const bgUrl = shop.settings.background ? `https://api.telegram.org/file/bot${token}/${shop.settings.background}` : null;
  const bodyStyle = bgUrl ? `background-image:url('${bgUrl}');background-size:cover;background-position:center;background-attachment:fixed;` : `background:#fafaf8;`;
  const headerHTML = logoUrl ? `<img src="${logoUrl}" style="max-height:90px;max-width:200px;display:block;margin:0 auto 12px;">` : '';

  const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${shop.displayName} — Petalo</title>
    <style>
      body{font-family:-apple-system,sans-serif;margin:0;padding:20px;text-align:center;${bodyStyle}}
      h1{color:#2c3e50;margin-bottom:4px;text-shadow:0 1px 3px rgba(255,255,255,0.8);}
      .info{color:#555;font-size:14px;margin-bottom:20px;background:rgba(255,255,255,0.75);display:inline-block;padding:6px 14px;border-radius:20px;}
      .container{max-width:1200px;margin:0 auto;}
    </style></head>
    <body><div class="container">
      ${headerHTML}
      <h1>${shop.displayName}</h1>
      <div class="info">
        ${shop.address ? `📍 ${shop.address}` : ''}
        ${shop.hours ? ` · 🕐 ${shop.hours}` : ''}
      </div>
      ${cards}
    </div></body></html>
  `;
  res.send(html);
});

app.get('/', (req, res) => {
  res.send(`<html><head><title>Petalo</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:50px;background:#fafaf8;">
    <h1>🌸 Petalo</h1><p>Витрина для цветочных магазинов.</p></body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Petalo запущен на порту ${PORT}`));
