const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// ============================================================
// ⚙️ НАСТРОЙКИ ВАШЕГО МАГАЗИНА
// ============================================================
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
// ============================================================

const shops = {};
const userToShop = {};
const registrationState = {};
const lastBouquetByUser = {};

let idCounter = 1;

// ---------- Создание preset-магазина ----------
function initPresetShop() {
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setMonth(trialEnd.getMonth() + PRESET_SHOP.trialMonths);

  shops[PRESET_SHOP.shopId] = {
    name: PRESET_SHOP.shopId,
    displayName: PRESET_SHOP.displayName,
    address: PRESET_SHOP.address,
    hours: PRESET_SHOP.hours,
    phone: PRESET_SHOP.phone,
    telegramUsername: PRESET_SHOP.telegramUsername,
    bouquets: [],
    admins: [],
    subscription: {
      status: 'trial',
      trialStart: now.toISOString(),
      trialEnd: trialEnd.toISOString(),
      paidUntil: null
    },
    settings: {
      logo: null,
      background: null,
      markupPercent: PRESET_SHOP.markupPercent
    }
  };
  console.log(`✅ Магазин "${PRESET_SHOP.shopId}" создан.`);
}
initPresetShop();

// ---------- Вспомогательные ----------
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

// Проверка: подтверждён ли букет за последние 3 дня
function isConfirmedRecently(bouquet) {
  if (bouquet.isPinned) return true;
  if (!bouquet.confirmedAt) return false;
  const age = Date.now() - new Date(bouquet.confirmedAt).getTime();
  return age < 3 * 24 * 60 * 60 * 1000;
}

// Формирование списка для /check
function buildCheckMessage(shop) {
  const bouquets = shop.bouquets
    .filter(b => {
      // показываем только те, что ещё не удалены (подтверждены за последние 3 дня или закреплены)
      return isConfirmedRecently(b) || b.isPinned;
    })
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.confirmedAt || b.createdAt) - new Date(a.confirmedAt || a.createdAt);
    });
  
  if (bouquets.length === 0) {
    return { text: '🌿 Нет активных букетов. Добавьте новый через фото.', options: {} };
  }
  
  let text = '✅ Отметьте букеты, которые есть в наличии:\n\n';
  const keyboard = [];
  
  for (const b of bouquets) {
    const confirmed = b.confirmedAt && (Date.now() - new Date(b.confirmedAt).getTime() < 24 * 60 * 60 * 1000);
    const emoji = confirmed ? '✅' : '⬜';
    text += `${emoji} ${b.name} — ${b.price} ₽\n`;
    keyboard.push([{
      text: `${emoji} ${b.name}`,
      callback_data: `confirm_${b.id}`
    }]);
  }
  
  return { text, options: { reply_markup: { inline_keyboard: keyboard } } };
}

// ---------- Старт ----------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  let shopId = getShopId(chatId);

  if (!shopId && shops[PRESET_SHOP.shopId]) {
    userToShop[chatId] = PRESET_SHOP.shopId;
    if (!shops[PRESET_SHOP.shopId].admins.includes(chatId)) {
      shops[PRESET_SHOP.shopId].admins.push(chatId);
    }
    shopId = PRESET_SHOP.shopId;
  }

  if (shopId) {
    const shop = getShop(shopId);
    bot.sendMessage(chatId, 
      `🌸 Добро пожаловать в «${shop.displayName}»!\n\n` +
      `🔗 Ваша витрина:\nhttps://petalo.onrender.com/shop/${shopId}\n\n` +
      `📅 Осталось дней подписки: ${getRemainingDays(shop)}\n\n` +
      `📷 Как добавить букет: отправьте ФОТО с подписью "Название цена"\n\n` +
      `✅ Как подтвердить наличие: команда /check\n` +
      `📊 Статус: /status\n\n` +
      `Команды: /check, /status, /renew`
    );
  } else {
    bot.sendMessage(chatId, '🌸 Отправьте /register для создания магазина.');
  }
});

// ---------- Регистрация ----------
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (userToShop[chatId]) return bot.sendMessage(chatId, '❌ Вы уже привязаны к магазину.');
  registrationState[chatId] = { step: 'name', data: {} };
  bot.sendMessage(chatId, '📝 Шаг 1 из 5.\n\nПридумайте **техническое имя** (латиницей).\nПример: `flowers_msk`');
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;
  if (text.startsWith('/')) return;
  const state = registrationState[chatId];
  if (!state) return;

  if (state.step === 'name') {
    const name = text.trim().toLowerCase().replace(/\s+/g, '_');
    if (!/^[a-z0-9_]+$/.test(name)) return bot.sendMessage(chatId, '❌ Только латиница, цифры, _. Снова:');
    if (shops[name]) return bot.sendMessage(chatId, '❌ Имя занято. Другое:');
    state.data.shopId = name;
    state.step = 'displayName';
    return bot.sendMessage(chatId, '✅ Шаг 2 из 5.\nНапишите **красивое название**.');
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
    shops[state.data.shopId] = {
      name: state.data.shopId,
      displayName: state.data.displayName,
      address: state.data.address,
      hours: state.data.hours,
      phone: state.data.phone,
      telegramUsername: PRESET_SHOP.telegramUsername,
      bouquets: [],
      admins: [chatId],
      subscription: { status: 'trial', trialStart: now.toISOString(), trialEnd: trialEnd.toISOString(), paidUntil: null },
      settings: { logo: null, background: null, markupPercent: PRESET_SHOP.markupPercent }
    };
    userToShop[chatId] = state.data.shopId;
    delete registrationState[chatId];
    return bot.sendMessage(chatId, `🎉 Магазин создан!\n🔗 https://petalo.onrender.com/shop/${state.data.shopId}`);
  }
});

// ---------- Команда /check ----------
bot.onText(/\/check/, (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ Сначала /start');
  const shop = getShop(shopId);
  if (!isSubscriptionActive(shop)) return bot.sendMessage(chatId, '❌ Подписка истекла.');
  
  const { text, options } = buildCheckMessage(shop);
  bot.sendMessage(chatId, text, options);
});

// ---------- Статус ----------
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ Не привязаны.');
  const shop = getShop(shopId);
  const days = getRemainingDays(shop);
  let txt = `📊 ${shop.displayName}\n`;
  txt += shop.subscription.status === 'trial' ? `Триал: ${days} дней\n` : `Активна: ${days} дней\n`;
  if (days <= 0) txt += '⚠️ Приостановлена. /renew';
  bot.sendMessage(chatId, txt);
});

bot.onText(/\/renew/, (msg) => bot.sendMessage(msg.chat.id, '💳 Продление: @floop10'));

// ---------- Фото ----------
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  let shopId = getShopId(chatId);
  
  if (!shopId && shops[PRESET_SHOP.shopId]) {
    userToShop[chatId] = PRESET_SHOP.shopId;
    if (!shops[PRESET_SHOP.shopId].admins.includes(chatId)) {
      shops[PRESET_SHOP.shopId].admins.push(chatId);
    }
    shopId = PRESET_SHOP.shopId;
  }
  
  if (!shopId) return bot.sendMessage(chatId, '❌ /start');
  const shop = getShop(shopId);
  if (!isSubscriptionActive(shop)) return bot.sendMessage(chatId, '❌ Подписка истекла.');

  const caption = (msg.caption || '').trim();
  const photo = msg.photo[msg.photo.length - 1];
  let filePath = '';
  try {
    const fi = await bot.getFile(photo.file_id);
    filePath = fi.file_path;
  } catch (e) {
    return bot.sendMessage(chatId, '❌ Ошибка фото.');
  }

  if (caption) {
    const words = caption.split(/\s+/);
    let price = 0, name = caption;
    for (let i = words.length - 1; i >= 0; i--) {
      const num = parseFloat(words[i]);
      if (!isNaN(num) && num > 0) { price = num; name = words.slice(0, i).join(' '); break; }
    }
    if (price === 0 || name === '') {
      return bot.sendMessage(chatId, '❌ Укажите цену в конце. Пример: "Розы 4500"');
    }
    
    const bouquet = {
      id: idCounter++,
      name: name.trim(),
      price: price,
      photos: [filePath],
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      isPinned: name.trim().startsWith('.'),
      chatId: chatId,
      reminded: false
    };
    shop.bouquets.push(bouquet);
    lastBouquetByUser[chatId] = bouquet.id;
    
    return bot.sendMessage(chatId, 
      `✅ Букет «${bouquet.name}» добавлен! Цена: ${bouquet.price} ₽\n\n` +
      `💡 Ещё фото? Отправьте без подписи.\n` +
      `✅ Подтвердить наличие: /check`
    );
  }

  const lastId = lastBouquetByUser[chatId];
  if (!lastId) return bot.sendMessage(chatId, '❌ Отправьте фото с подписью.');
  const bouquet = shop.bouquets.find(b => b.id === lastId);
  if (!bouquet) return bot.sendMessage(chatId, '❌ Последний букет не найден.');
  bouquet.photos.push(filePath);
  bot.sendMessage(chatId, `📸 Фото добавлено. Всего: ${bouquet.photos.length}`);
});

// ---------- Обработка кнопок ----------
bot.on('callback_query', (q) => {
  const chatId = q.from.id;
  const data = q.data;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.answerCallbackQuery(q.id, { text: 'Ошибка' });
  const shop = getShop(shopId);
  
  // ---- Подтверждение наличия букета ----
  if (data.startsWith('confirm_')) {
    const id = parseInt(data.split('_')[1]);
    const b = shop.bouquets.find(x => x.id === id);
    if (b) {
      b.confirmedAt = new Date().toISOString();
      b.reminded = false;
      bot.answerCallbackQuery(q.id, { text: '✅ Подтверждено!' });
      // Обновим сообщение со списком
      const { text, options } = buildCheckMessage(shop);
      bot.editMessageText(text, { chat_id: chatId, message_id: q.message.message_id, ...options }).catch(() => {});
    } else {
      bot.answerCallbackQuery(q.id, { text: '❌ Букет не найден' });
    }
    return;
  }
  
  // ---- Продление по уведомлению ----
  if (data.startsWith('extend_')) {
    const id = parseInt(data.split('_')[1]);
    const b = shop.bouquets.find(x => x.id === id);
    if (b) {
      b.confirmedAt = new Date().toISOString();
      b.reminded = false;
      bot.answerCallbackQuery(q.id, { text: '✅ Продлено' });
      bot.sendMessage(chatId, `🌿 Букет «${b.name}» продлён.`);
    } else {
      bot.answerCallbackQuery(q.id, { text: '❌ Уже удалён' });
    }
    return;
  }
});

// ---------- Уведомления (за 12 часов до скрытия) ----------
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
          `⚠️ Букет «${b.name}» скоро исчезнет с витрины (нет подтверждения ~3 дня).\n` +
          `Нажмите «Продлить», если он ещё в наличии.`,
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
    return res.send(`
      <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Petalo</title>
      <style>body{font-family:sans-serif;text-align:center;padding:50px;background:#fafaf8;}h1{color:#2c3e50;}</style></head>
      <body><h1>🌸 ${shop.displayName}</h1>
      <p style="font-size:20px;">Витрина приостановлена.</p></body></html>
    `);
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
      cards += `
        <div style="border:1px solid #eee;border-radius:16px;padding:16px;margin:12px;max-width:300px;display:inline-block;vertical-align:top;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.08);text-align:center;">
          ${galleryHTML}
          <h3 style="margin:12px 0 6px;font-family:sans-serif;">${b.name}</h3>
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

  const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${shop.displayName} — Petalo</title>
    <style>body{font-family:-apple-system,sans-serif;background:#fafaf8;margin:0;padding:20px;text-align:center;}
    h1{color:#2c3e50;margin-bottom:4px;} .info{color:#888;font-size:14px;margin-bottom:20px;}
    .container{max-width:1200px;margin:0 auto;}</style></head>
    <body><div class="container">
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
