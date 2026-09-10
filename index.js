const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// ---------- Хранилище ----------
const shops = {};
const userToShop = {};
const registrationState = {}; // chatId -> { step, data }

let idCounter = 1;

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

// ---------- Старт ----------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (shopId) {
    const shop = getShop(shopId);
    bot.sendMessage(chatId, 
      `🌸 С возвращением, «${shop.displayName}»!\n` +
      `Витрина: https://petalo.onrender.com/shop/${shopId}\n` +
      `Осталось дней: ${getRemainingDays(shop)}\n\n` +
      `Отправьте фото с подписью "Название цена" — букет появится на витрине.\n` +
      `Команды: /status, /renew`
    );
  } else {
    bot.sendMessage(chatId, 
      '🌸 Petalo — витрина для цветочных магазинов.\n\n' +
      'Чтобы начать, отправьте команду:\n' +
      '/register'
    );
  }
});

// ---------- Регистрация (шаг 1) ----------
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (userToShop[chatId]) {
    bot.sendMessage(chatId, '❌ Вы уже зарегистрированы. Сначала нужно выйти из текущего магазина (пока не реализовано).');
    return;
  }
  registrationState[chatId] = { step: 'name', data: {} };
  bot.sendMessage(chatId, 
    '📝 Шаг 1 из 5.\n\n' +
    'Придумайте **техническое имя** магазина (латиницей, без пробелов).\n' +
    'Оно будет в ссылке вашей витрины.\n\n' +
    'Пример: `flowers_msk`'
  );
});

// ---------- Обработка всех текстовых сообщений (пошаговая регистрация + прочее) ----------
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return; // фото обрабатывается отдельно
  if (text.startsWith('/')) return; // команды обрабатываются отдельно
  
  const state = registrationState[chatId];
  if (!state) return; // не в процессе регистрации
  
  // --- Шаг 1: техническое имя ---
  if (state.step === 'name') {
    const name = text.trim().toLowerCase().replace(/\s+/g, '_');
    if (!/^[a-z0-9_]+$/.test(name)) {
      bot.sendMessage(chatId, '❌ Только латиница, цифры и подчёркивание. Попробуйте ещё раз:');
      return;
    }
    if (shops[name]) {
      bot.sendMessage(chatId, '❌ Такое имя уже занято. Придумайте другое:');
      return;
    }
    state.data.shopId = name;
    state.step = 'displayName';
    bot.sendMessage(chatId, 
      '✅ Отлично!\n\n' +
      '📝 Шаг 2 из 5.\n' +
      'Напишите **красивое название** магазина — как его увидят клиенты.\n\n' +
      'Пример: `Цветы на Фрунзе`'
    );
    return;
  }
  
  // --- Шаг 2: красивое название ---
  if (state.step === 'displayName') {
    if (text.length < 2 || text.length > 60) {
      bot.sendMessage(chatId, '❌ Название должно быть от 2 до 60 символов. Попробуйте ещё раз:');
      return;
    }
    state.data.displayName = text.trim();
    state.step = 'address';
    bot.sendMessage(chatId, 
      '✅ Принято!\n\n' +
      '📝 Шаг 3 из 5.\n' +
      'Укажите **адрес** магазина.\n\n' +
      'Пример: `г. Москва, ул. Фрунзе, 15`\n' +
      '(Если не хотите указывать — напишите "нет")'
    );
    return;
  }
  
  // --- Шаг 3: адрес ---
  if (state.step === 'address') {
    state.data.address = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    state.step = 'hours';
    bot.sendMessage(chatId, 
      '✅ Принято!\n\n' +
      '📝 Шаг 4 из 5.\n' +
      'Укажите **часы работы**.\n\n' +
      'Пример: `Пн-Вс 09:00–21:00`\n' +
      '(Если не хотите указывать — напишите "нет")'
    );
    return;
  }
  
  // --- Шаг 4: часы работы ---
  if (state.step === 'hours') {
    state.data.hours = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    state.step = 'phone';
    bot.sendMessage(chatId, 
      '✅ Принято!\n\n' +
      '📝 Шаг 5 из 5.\n' +
      'Укажите **телефон** для клиентов.\n' +
      'Он появится на витрине как кнопка «Позвонить».\n\n' +
      'Пример: `+7 999 123-45-67`\n' +
      '(Если не хотите указывать — напишите "нет")'
    );
    return;
  }
  
  // --- Шаг 5: телефон ---
  if (state.step === 'phone') {
    state.data.phone = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    
    // Создаём магазин
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setMonth(trialEnd.getMonth() + 3);
    
    shops[state.data.shopId] = {
      name: state.data.shopId,
      displayName: state.data.displayName,
      address: state.data.address,
      hours: state.data.hours,
      phone: state.data.phone,
      bouquets: [],
      admins: [chatId],
      subscription: {
        status: 'trial',
        trialStart: now.toISOString(),
        trialEnd: trialEnd.toISOString(),
        paidUntil: null
      },
      settings: {
        logo: null,
        background: null,
        markupPercent: 20
      }
    };
    userToShop[chatId] = state.data.shopId;
    delete registrationState[chatId];
    
    bot.sendMessage(chatId, 
      `🎉 Поздравляем! Магазин «${state.data.displayName}» зарегистрирован.\n\n` +
      `🔗 Ваша витрина:\nhttps://petalo.onrender.com/shop/${state.data.shopId}\n\n` +
      `📅 Триал: 3 месяца (до ${trialEnd.toLocaleDateString()})\n\n` +
      `Теперь просто отправляйте мне ФОТО букетов с подписью "Название цена" — они сразу появятся на витрине.\n\n` +
      `Команды: /status, /renew`
    );
    return;
  }
});

// ---------- Статус подписки ----------
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ Вы не зарегистрированы. Используйте /register');
  const shop = getShop(shopId);
  const days = getRemainingDays(shop);
  const status = shop.subscription.status;
  let txt = `📊 Магазин: ${shop.displayName}\n`;
  if (status === 'trial') txt += `Триал: осталось ${days} дней.\n`;
  else if (status === 'active') txt += `Подписка активна: осталось ${days} дней.\n`;
  else txt += `Подписка истекла.\n`;
  if (days <= 0) txt += '⚠️ Витрина приостановлена. Используйте /renew.\n';
  bot.sendMessage(chatId, txt);
});

// ---------- Продление ----------
bot.onText(/\/renew/, (msg) => {
  bot.sendMessage(msg.chat.id, 
    '💳 Для продления подписки свяжитесь с нами:\nTelegram: @floop10'
  );
});

// ---------- Фото ----------
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ Сначала зарегистрируйтесь: /register');
  const shop = getShop(shopId);
  if (!shop) return bot.sendMessage(chatId, '❌ Магазин не найден.');
  if (!isSubscriptionActive(shop)) return bot.sendMessage(chatId, '❌ Подписка истекла. Используйте /renew.');
  
  const caption = msg.caption || '';
  const words = caption.trim().split(/\s+/);
  let price = 0, name = caption;
  for (let i = words.length - 1; i >= 0; i--) {
    const num = parseFloat(words[i]);
    if (!isNaN(num) && num > 0) { price = num; name = words.slice(0, i).join(' '); break; }
  }
  if (price === 0 || name === '') {
    return bot.sendMessage(chatId, '❌ Укажите цену в конце. Пример: "Розы 4500"');
  }
  
  const photo = msg.photo[msg.photo.length - 1];
  let filePath = '';
  try {
    const fi = await bot.getFile(photo.file_id);
    filePath = fi.file_path;
  } catch (e) {
    return bot.sendMessage(chatId, '❌ Ошибка при получении фото.');
  }
  
  shop.bouquets.push({
    id: idCounter++,
    name: name.trim(),
    price: price,
    filePath: filePath,
    createdAt: new Date().toISOString(),
    isPinned: name.trim().startsWith('.'),
    chatId: chatId,
    reminded: false
  });
  bot.sendMessage(chatId, `✅ Букет «${name.trim()}» добавлен! Цена: ${price} ₽`);
});

// ---------- Продление букета ----------
bot.on('callback_query', (q) => {
  if (q.data.startsWith('extend_')) {
    const id = parseInt(q.data.split('_')[1]);
    const chatId = q.from.id;
    const shopId = getShopId(chatId);
    if (!shopId) return bot.answerCallbackQuery(q.id, { text: 'Ошибка' });
    const shop = getShop(shopId);
    const b = shop.bouquets.find(x => x.id === id);
    if (b) {
      const d = new Date();
      d.setHours(d.getHours() + 24);
      b.createdAt = d.toISOString();
      b.reminded = false;
      bot.answerCallbackQuery(q.id, { text: '✅ Продлено на 1 день' });
      bot.sendMessage(chatId, `🌿 Букет «${b.name}» продлён.`);
    } else {
      bot.answerCallbackQuery(q.id, { text: '❌ Букет уже удалён' });
    }
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
      const age = now - new Date(b.createdAt).getTime();
      const rem = threeDays - age;
      if (rem > 0 && rem <= twelveHours && !b.reminded) {
        bot.sendMessage(b.chatId, 
          `⚠️ Букет «${b.name}» скоро исчезнет (~${Math.round(rem/3600000)} ч.).`,
          { reply_markup: { inline_keyboard: [[{ text: '🌿 Продлить на 1 день', callback_data: `extend_${b.id}` }]] } }
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
      <p style="font-size:20px;">Витрина приостановлена.</p>
      <p style="color:#888;">Для продления подписки свяжитесь с владельцем.</p></body></html>
    `);
  }
  
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  let bouquets = shop.bouquets.filter(b => {
    const age = now - new Date(b.createdAt).getTime();
    return age < threeDays || b.isPinned;
  });
  bouquets.sort((a,b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  
  let cards = '';
  if (bouquets.length === 0) {
    cards = '<div style="text-align:center;padding:50px;font-size:20px;color:#888;">🌿 Пока нет букетов.</div>';
  } else {
    for (const b of bouquets) {
      const photoUrl = `https://api.telegram.org/file/bot${token}/${b.filePath}`;
      const oldPrice = Math.ceil(b.price * (1 + shop.settings.markupPercent / 100) / 100) * 100;
      cards += `
        <div style="border:1px solid #eee;border-radius:16px;padding:16px;margin:12px;max-width:300px;display:inline-block;vertical-align:top;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <img src="${photoUrl}" style="width:100%;border-radius:12px;aspect-ratio:1/1;object-fit:cover;">
          <h3 style="margin:12px 0 6px;font-family:sans-serif;">${b.name}</h3>
          <p style="font-size:22px;font-weight:bold;color:#2c3e50;margin:6px 0;">
            <span style="text-decoration:line-through;color:#999;font-weight:normal;font-size:18px;">${oldPrice} ₽</span>
            &nbsp; ${b.price} ₽
          </p>
          ${b.isPinned ? '<span style="background:#f1c40f;padding:2px 10px;border-radius:20px;font-size:12px;">⭐ Закреплён</span><br>' : ''}
          <a href="tg://resolve?domain=floop10" style="display:inline-block;margin-top:12px;background:#4CAF50;color:#fff;padding:10px 20px;border-radius:30px;text-decoration:none;font-weight:bold;">📩 Заказать</a>
          ${shop.phone ? `<a href="tel:${shop.phone.replace(/\D/g,'')}" style="display:inline-block;margin-top:8px;margin-left:8px;background:#3498db;color:#fff;padding:10px 20px;border-radius:30px;text-decoration:none;font-weight:bold;">📞 Позвонить</a>` : ''}
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
      <h1>🌸 ${shop.displayName}</h1>
      <div class="info">
        ${shop.address ? `📍 ${shop.address}` : ''}
        ${shop.hours ? ` · 🕐 ${shop.hours}` : ''}
      </div>
      ${cards}
    </div></body></html>
  `;
  res.send(html);
});

// ---------- Главная ----------
app.get('/', (req, res) => {
  res.send(`<html><head><title>Petalo</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:50px;background:#fafaf8;">
    <h1>🌸 Petalo</h1>
    <p>Витрина для цветочных магазинов.</p>
    <p>Откройте бота @petalo_rus_bot в Telegram и напишите /register</p>
    </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Petalo запущен на порту ${PORT}`));
