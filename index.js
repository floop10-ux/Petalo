const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// ---------- Хранилище ----------
const shops = {};
const userToShop = {};
const registrationState = {};
const lastBouquetByUser = {}; // chatId -> id последнего созданного букета

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
      `А если хотите добавить к нему ещё фото — просто отправьте их без подписи.\n\n` +
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

// ---------- Регистрация ----------
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (userToShop[chatId]) {
    return bot.sendMessage(chatId, '❌ Вы уже зарегистрированы.');
  }
  registrationState[chatId] = { step: 'name', data: {} };
  bot.sendMessage(chatId, 
    '📝 Шаг 1 из 5.\n\n' +
    'Придумайте **техническое имя** магазина (латиницей, без пробелов).\n' +
    'Пример: `flowers_msk`'
  );
});

// ---------- Пошаговая регистрация ----------
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;
  if (text.startsWith('/')) return;
  const state = registrationState[chatId];
  if (!state) return;

  if (state.step === 'name') {
    const name = text.trim().toLowerCase().replace(/\s+/g, '_');
    if (!/^[a-z0-9_]+$/.test(name)) return bot.sendMessage(chatId, '❌ Только латиница, цифры, _. Попробуйте снова:');
    if (shops[name]) return bot.sendMessage(chatId, '❌ Имя занято. Другое:');
    state.data.shopId = name;
    state.step = 'displayName';
    return bot.sendMessage(chatId, '✅ Отлично!\n\n📝 Шаг 2 из 5.\nНапишите **красивое название** магазина.\nПример: `Цветы на Фрунзе`');
  }

  if (state.step === 'displayName') {
    if (text.length < 2 || text.length > 60) return bot.sendMessage(chatId, '❌ От 2 до 60 символов. Ещё раз:');
    state.data.displayName = text.trim();
    state.step = 'address';
    return bot.sendMessage(chatId, '✅ Принято!\n\n📝 Шаг 3 из 5.\nУкажите **адрес**.\nПример: `г. Москва, ул. Фрунзе, 15`\n(Если не хотите — напишите "нет")');
  }

  if (state.step === 'address') {
    state.data.address = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    state.step = 'hours';
    return bot.sendMessage(chatId, '✅ Принято!\n\n📝 Шаг 4 из 5.\nУкажите **часы работы**.\nПример: `Пн-Вс 09:00–21:00`\n(Если не хотите — "нет")');
  }

  if (state.step === 'hours') {
    state.data.hours = text.trim().toLowerCase() === 'нет' ? null : text.trim();
    state.step = 'phone';
    return bot.sendMessage(chatId, '✅ Принято!\n\n📝 Шаг 5 из 5.\nУкажите **телефон** для клиентов.\nПример: `+7 999 123-45-67`\n(Если не хотите — "нет")');
  }

  if (state.step === 'phone') {
    state.data.phone = text.trim().toLowerCase() === 'нет' ? null : text.trim();
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
      settings: { logo: null, background: null, markupPercent: 20 }
    };
    userToShop[chatId] = state.data.shopId;
    delete registrationState[chatId];

    return bot.sendMessage(chatId, 
      `🎉 Поздравляем! Магазин «${state.data.displayName}» зарегистрирован.\n\n` +
      `🔗 Ваша витрина:\nhttps://petalo.onrender.com/shop/${state.data.shopId}\n\n` +
      `📅 Триал: до ${trialEnd.toLocaleDateString()}\n\n` +
      `Теперь отправляйте ФОТО с подписью "Название цена" — букеты появятся на витрине.\n` +
      `Чтобы добавить к букету ещё фото, просто пришлите их без подписи.`
    );
  }
});

// ---------- Статус ----------
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ Не зарегистрированы.');
  const shop = getShop(shopId);
  const days = getRemainingDays(shop);
  const status = shop.subscription.status;
  let txt = `📊 ${shop.displayName}\n`;
  if (status === 'trial') txt += `Триал: осталось ${days} дней.\n`;
  else if (status === 'active') txt += `Активна: ${days} дней.\n`;
  else txt += `Истекла.\n`;
  if (days <= 0) txt += '⚠️ Витрина приостановлена. /renew';
  bot.sendMessage(chatId, txt);
});

// ---------- Продление ----------
bot.onText(/\/renew/, (msg) => {
  bot.sendMessage(msg.chat.id, '💳 Продление: свяжитесь с @floop10');
});

// ---------- Фото (создание букета или добавление в последний) ----------
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const shopId = getShopId(chatId);
  if (!shopId) return bot.sendMessage(chatId, '❌ Сначала /register');
  const shop = getShop(shopId);
  if (!isSubscriptionActive(shop)) return bot.sendMessage(chatId, '❌ Подписка истекла. /renew');

  const caption = (msg.caption || '').trim();
  const photo = msg.photo[msg.photo.length - 1];
  let filePath = '';
  try {
    const fi = await bot.getFile(photo.file_id);
    filePath = fi.file_path;
  } catch (e) {
    return bot.sendMessage(chatId, '❌ Ошибка фото.');
  }

  // ---- Случай 1: есть подпись → создаём новый букет ----
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
      isPinned: name.trim().startsWith('.'),
      chatId: chatId,
      reminded: false
    };
    shop.bouquets.push(bouquet);
    lastBouquetByUser[chatId] = bouquet.id;
    
    return bot.sendMessage(chatId, 
      `✅ Букет «${bouquet.name}» добавлен! Цена: ${bouquet.price} ₽\n\n` +
      `💡 Хотите добавить к нему ещё фото (другой ракурс)? Просто отправьте их без подписи.`
    );
  }

  // ---- Случай 2: без подписи → добавляем к последнему букету ----
  const lastId = lastBouquetByUser[chatId];
  if (!lastId) {
    return bot.sendMessage(chatId, '❌ Не понимаю. Отправьте фото с подписью "Название цена" — создам новый букет.');
  }
  const bouquet = shop.bouquets.find(b => b.id === lastId);
  if (!bouquet) {
    return bot.sendMessage(chatId, '❌ Последний букет не найден. Отправьте новое фото с подписью.');
  }
  bouquet.photos.push(filePath);
  bot.sendMessage(chatId, `📸 Фото добавлено к букету «${bouquet.name}». Всего фото: ${bouquet.photos.length}`);
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
      bot.answerCallbackQuery(q.id, { text: '✅ Продлено' });
      bot.sendMessage(chatId, `🌿 Букет «${b.name}» продлён.`);
    } else {
      bot.answerCallbackQuery(q.id, { text: '❌ Уже удалён' });
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
      // ---- Галерея фото (горизонтальный скролл, если фото больше одного) ----
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
        <div style="border:1px solid #eee;border-radius:16px;padding:16px;margin:12px;max-width:300px;display:inline-block;vertical-align:top;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.08);text-align:left;">
          ${galleryHTML}
          <h3 style="margin:12px 0 6px;font-family:sans-serif;">${b.name}</h3>
          <p style="font-size:22px;font-weight:bold;color:#2c3e50;margin:6px 0;">
            <span style="text-decoration:line-through;color:#999;font-weight:normal;font-size:18px;">${oldPrice} ₽</span>
            &nbsp; ${b.price} ₽
          </p>
          ${b.isPinned ? '<span style="background:#f1c40f;padding:2px 10px;border-radius:20px;font-size:12px;">⭐ Закреплён</span><br>' : ''}
          <a href="tg://resolve?domain=floop10" style="display:inline-block;margin-top:12px;background:#4CAF50;color:#fff;padding:10px 20px;border-radius:30px;text-decoration:none;font-weight:bold;">📩 Заказать</a>
          ${shop.phone ? `<a href="tel:${shop.phone.replace(/\D/g,'')}" style="display:inline-block;margin-top:8px;margin-left:6px;background:#3498db;color:#fff;padding:10px 20px;border-radius:30px;text-decoration:none;font-weight:bold;">📞 Позвонить</a>` : ''}
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
