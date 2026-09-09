const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

let bouquets = [];
let idCounter = 1;

// ---- Приветствие ----
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    '🌸 Добро пожаловать в Petalo!\n\n' +
    'Просто отправьте мне ФОТО и в подписи напишите:\n' +
    'Название и цену (последнее число).\n' +
    'Например: "Розы в крафте 2200"\n\n' +
    'Цена на витрине будет показана с перечёркнутой старой ценой (+20%, округлено до 100 ₽).'
  );
});

// ---- Добавление букета ----
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const caption = msg.caption || '';
  const words = caption.trim().split(/\s+/);
  let price = 0;
  let name = caption;
  
  for (let i = words.length - 1; i >= 0; i--) {
    const num = parseFloat(words[i]);
    if (!isNaN(num) && num > 0) {
      price = num;
      name = words.slice(0, i).join(' ');
      break;
    }
  }
  
  if (price === 0 || name === '') {
    bot.sendMessage(chatId, '❌ Не могу разобрать цену. Укажите число в конце, например: "Розы 2200"');
    return;
  }
  
  const photo = msg.photo[msg.photo.length - 1];
  const fileId = photo.file_id;
  
  let filePath = '';
  try {
    const fileInfo = await bot.getFile(fileId);
    filePath = fileInfo.file_path;
  } catch (err) {
    bot.sendMessage(chatId, '❌ Ошибка при получении фото. Попробуйте ещё раз.');
    return;
  }
  
  const bouquet = {
    id: idCounter++,
    name: name.trim(),
    price: price,
    filePath: filePath,
    createdAt: new Date().toISOString(),
    isPinned: name.trim().startsWith('.'),
    chatId: chatId,
    reminded: false
  };
  
  bouquets.push(bouquet);
  bot.sendMessage(chatId, `✅ Букет «${bouquet.name}» добавлен! Цена: ${bouquet.price} ₽`);
});

// ---- Обработка кнопки "Продлить" ----
bot.on('callback_query', (query) => {
  const data = query.data;
  if (data.startsWith('extend_')) {
    const bouquetId = parseInt(data.split('_')[1]);
    const bouquet = bouquets.find(b => b.id === bouquetId);
    if (bouquet) {
      const newDate = new Date();
      newDate.setHours(newDate.getHours() + 24);
      bouquet.createdAt = newDate.toISOString();
      bouquet.reminded = false;
      
      bot.answerCallbackQuery(query.id, { text: '✅ Букет продлён на 1 день!' });
      bot.sendMessage(query.from.id, `🌿 Букет «${bouquet.name}» продлён до ${newDate.toLocaleString()}`);
    } else {
      bot.answerCallbackQuery(query.id, { text: '❌ Букет уже удалён' });
    }
  }
});

// ---- Проверка и отправка уведомлений ----
function checkAndNotify() {
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const twelveHours = 12 * 60 * 60 * 1000;
  
  for (let b of bouquets) {
    if (b.isPinned) continue;
    
    const age = now - new Date(b.createdAt).getTime();
    const remaining = threeDays - age;
    
    if (remaining > 0 && remaining <= twelveHours && !b.reminded) {
      const chatId = b.chatId;
      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌿 Продлить на 1 день', callback_data: `extend_${b.id}` }]
          ]
        }
      };
      bot.sendMessage(chatId, 
        `⚠️ Букет «${b.name}» скоро исчезнет с витрины (осталось ~${Math.round(remaining / 3600000)} ч.).\n` +
        `Нажмите «Продлить», чтобы оставить его ещё на сутки.`,
        options
      );
      b.reminded = true;
    }
  }
}

setInterval(checkAndNotify, 10 * 60 * 1000);

// ---- Витрина для клиентов ----
app.get('/', (req, res) => {
  checkAndNotify();
  
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  
  let active = bouquets.filter(b => {
    const age = now - new Date(b.createdAt).getTime();
    return age < threeDays || b.isPinned;
  });
  
  active.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  
  let cards = '';
  if (active.length === 0) {
    cards = '<div style="text-align:center; padding:50px; font-size:24px; color:#888;">🌿 Пока нет букетов. Загляните позже!</div>';
  } else {
    for (let b of active) {
      const photoUrl = `https://api.telegram.org/file/bot${token}/${b.filePath}`;
      
      // ---- НАЦЕНКА: вычисляем старую цену (+20%, округление до 100 вверх) ----
      const oldPrice = Math.ceil(b.price * 1.2 / 100) * 100;
      
      cards += `
        <div style="border:1px solid #eee; border-radius:16px; padding:16px; margin:12px; max-width:300px; display:inline-block; vertical-align:top; background:#fff; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <img src="${photoUrl}" style="width:100%; height:auto; border-radius:12px; aspect-ratio:1/1; object-fit:cover;" />
          <h3 style="margin:12px 0 6px; font-family:sans-serif;">${b.name}</h3>
          <p style="font-size:22px; font-weight:bold; color:#2c3e50; margin:6px 0;">
            <span style="text-decoration:line-through; color:#999; font-weight:normal; font-size:18px;">${oldPrice} ₽</span>
            &nbsp; ${b.price} ₽
          </p>
          ${b.isPinned ? '<span style="background:#f1c40f; padding:2px 10px; border-radius:20px; font-size:12px;">⭐ Закреплён</span>' : ''}
          <br>
          <a href="tg://resolve?domain=floop10" style="display:inline-block; margin-top:12px; background:#4CAF50; color:#fff; padding:10px 20px; border-radius:30px; text-decoration:none; font-weight:bold; font-size:16px;">📩 Заказать в Telegram</a>
        </div>
      `;
    }
  }
  
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Petalo — Витрина</title>
        <style>
          body { font-family: -apple-system, sans-serif; background: #fafaf8; margin:0; padding:20px; text-align:center; }
          h1 { color: #2c3e50; }
          .container { max-width: 1200px; margin:0 auto; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🌸 Petalo</h1>
          ${cards}
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер Petalo запущен на порту ${PORT}`);
});
