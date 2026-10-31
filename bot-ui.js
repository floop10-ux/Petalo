const { 
  esc, 
  formatPrice, 
  calculateOldPrice, 
  shortName, 
  getBouquetStatus, 
  isConfirmedRecently,
  COUNTRIES 
} = require('./config');

const { getBouquetsFromDb } = require('./db-actions');

// ========== КОНСТАНТЫ ==========
const OWNER_STEPS = [
  'add_bouquet', 'view_shop', 'edit_price',
  'hide_bouquet', 'restore_bouquet',
  'check_stock', 'settings_tour', 'done'
];

const FLORIST_STEPS = [
  'add_bouquet', 'check_stock', 'on_shift'
];

const MENU_BUTTONS = [
  '📷 Добавить букет',
  '✅ Что в наличии?',
  '✏️ Мои букеты',
  '🔗 Витрина',
  '📦 Склад',
  '⚙️ Настройки',
  '⚙️ Меню'
];

const ADD_BOUQUET_HINT =
  `📷 <b>Пришлите фото букета с подписью.</b>\n\n` +
  `В подписи: название + цена.\n` +
  `Цена — <b>последнее слово</b>, одно число.\n\n` +
  `✅ <b>Правильно:</b>\n` +
  `  31 роза 3500\n` +
  `  Пионы 4500\n` +
  `  31 роза 50см сорт Аваланж 3500\n` +
  `  Микс 2800\n\n` +
  `❌ <b>Неправильно:</b>\n` +
  `  31 роза 3500 сорт Аваланж цена\n` +
  `     (после цены есть слова)\n` +
  `  3500 31 роза\n` +
  `     (цена в начале)\n\n` +
  `💡 Ещё фото — без подписи.`;

const REG_STEPS = {
  shopId: {
    text: '📝 <b>Шаг 1 из 9. Короткое название ' +
          'для ссылки</b>\n\n' +
          'Только латинские буквы, цифры и _, ' +
          'без пробелов.\n' +
          'Например: <code>cveti_msk</code>\n\n' +
          'Это будет адрес витрины:\n' +
          '<code>flowind.ru/shop/cveti_msk</code>\n\n' +
          '<i>Если не знаете — нажмите ' +
          '«Пропустить», я сгенерирую сам.</i>',
    skip: true, mandatory: true
  },
  displayName: {
    text: '✅ <b>Шаг 2 из 9. Красивое название</b>\n\n' +
          'Как назвать магазин для клиентов?\n' +
          'Оно появится на витрине. ' +
          'Можно с эмодзи.\n\n' +
          'Например: <i>🌸 Цветы на Фрунзе</i>',
    skip: false, mandatory: true
  },
  country: {
    text: '🌍 <b>Шаг 3 из 9. В какой стране ' +
          'магазин?</b>\n\n' +
          'Нужно, чтобы правильно работали цены ' +
          'и валюта.\n\n' +
          '<i>Выберите кнопкой ниже.</i>',
    skip: true, mandatory: false
  },
  address: {
    text: '✅ <b>Шаг 4 из 9. Адрес</b>\n\n' +
          'Клиенты увидят адрес на витрине.\n' +
          'Например: <i>Москва, ул. Фрунзе, 15</i>\n\n' +
          '<i>Можно пропустить и добавить позже.</i>',
    skip: true, mandatory: false
  },
  hours: {
    text: '✅ <b>Шаг 5 из 9. Часы работы</b>\n\n' +
          'Например: <i>Пн-Вс 10:30-21:00</i>\n\n' +
          '<i>Можно пропустить.</i>',
    skip: true, mandatory: false
  },
  phone: {
    text: '✅ <b>Шаг 6 из 9. Телефон</b>\n\n' +
          'Для кнопки «Позвонить» на витрине.\n' +
          'Например: <i>+7 962 402-51-75</i>\n\n' +
          '<i>Можно пропустить.</i>',
    skip: true, mandatory: false
  },
  telegram: {
    text: '✅ <b>Шаг 7 из 9. Ваш юзернейм ' +
          'в Telegram</b>\n\n' +
          'Клиенты будут писать вам, нажав ' +
          'кнопку на витрине.\n' +
          'Пришлите без @.\n\n' +
          'Например: если ваш юзернейм ' +
          '@KupidonAdm — напишите ' +
          '<code>KupidonAdm</code>\n\n' +
          '<i>Если у вас нет юзернейма — можно ' +
          'пропустить, и клиенты смогут только ' +
          'позвонить или написать в WhatsApp.</i>',
    skip: true, mandatory: false
  },
  whatsapp: {
    text: '✅ <b>Шаг 8 из 9. Номер WhatsApp</b>\n\n' +
          'Клиенты смогут написать вам одним ' +
          'нажатием.\n' +
          'Например: <i>+7 962 402-51-75</i>\n\n' +
          '<i>Можно пропустить.</i>',
    skip: true, mandatory: false
  },
  max: {
    text: '✅ <b>Шаг 9 из 9. Ссылка на профиль ' +
          'в MAX</b>\n\n' +
          '<i>Можно пропустить и добавить позже — ' +
          '«Меню» → «🏪 Данные магазина».</i>\n\n' +
          'Она начинается с ' +
          '<code>https://max.ru/u/...</code>\n\n' +
          'Пришлите её сюда или нажмите ' +
          '«Пропустить».',
    skip: true, mandatory: false
  }
};

const REG_ORDER = [
  'shopId', 'displayName', 'country', 'address',
  'hours', 'phone', 'telegram', 'whatsapp', 'max'
];

const CHECK_PER_PAGE = 25;
const LIST_PER_PAGE = 25;
const SEARCH_PER_PAGE = 25;

// ========== УТИЛИТЫ ==========
function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

// ========== ГЛАВНЫЕ МЕНЮ ==========
function getMainKeyboard(shop, chatId) {
  const me = shop && shop.admins
    ? shop.admins.find(a => a.chatId === chatId)
    : null;
  const onShift = !!(me && me.onShift);

  const rows = [
    [
      { text: '📷 Добавить букет' },
      { text: '✅ Что в наличии?' }
    ],
    [
      { text: '✏️ Мои букеты' },
      { text: '🔗 Витрина' }
    ]
  ];

  if (onShift) {
    rows.push([{ text: '🚪 Закончить работу' }]);
  } else {
    rows.push([{ text: '✅ Я сегодня работаю' }]);
  }

  rows.push([{ text: '📦 Склад' }]);
  rows.push([{ text: '⚙️ Настройки' }]);

  return {
    keyboard: rows,
    resize_keyboard: true
  };
}

function getSettingsMenu(shop, chatId) {
  const { isOwner } = require('./config');
  if (isOwner(shop, chatId)) {
    return { reply_markup: { inline_keyboard: [
      [{ text: '🔑 Пригласить флориста', callback_data: 'menu_invite' }],
      [{ text: '👥 Команда магазина', callback_data: 'menu_team' }],
      [{ text: '🏪 Данные магазина', callback_data: 'menu_shopdata' }],
      [{ text: '📊 Статистика', callback_data: 'menu_stats' }],
      [{ text: '💰 Наценка', callback_data: 'menu_markup' }],
      [
        { text: '🎨 Логотип', callback_data: 'menu_logo' },
        { text: '🖼 Фон', callback_data: 'menu_background' }
      ],
      [{ text: '🖼 Обложка', callback_data: 'menu_cover' }],
      [{ text: '🔘 Цвет кнопки', callback_data: 'menu_buttoncolor' }],
      [{ text: '💱 Валюта', callback_data: 'menu_currency' }],
      [{ text: '📋 Статус магазина', callback_data: 'menu_status' }],
      [{ text: '💳 Продлить подписку', callback_data: 'menu_renew' }],
      [{ text: '📖 Помощь', callback_data: 'help_menu' }],
      [{ text: '❌ Закрыть', callback_data: 'menu_close' }]
    ] } };
  }
  
  return { reply_markup: { inline_keyboard: [
    [{ text: '📋 Статус магазина', callback_data: 'menu_status' }],
    [{ text: '📖 Помощь', callback_data: 'help_menu' }],
    [{ text: '❌ Закрыть', callback_data: 'menu_close' }]
  ] } };
}

function buildShopDataMessage(shop) {
  const { 
    findCountryByCode, 
    getShopCurrency, 
    findCurrencyByCode,
    formatPhone 
  } = require('./config');

  let txt = `🏪 <b>Данные магазина</b>\n\n`;
  txt += `📝 Название: ${esc(shop.displayName)}\n`;
  
  const addr = shop.address ? esc(shop.address) : '<i>не указан</i>';
  txt += `📍 Адрес: ${addr}\n`;
  
  const hrs = shop.hours ? esc(shop.hours) : '<i>не указаны</i>';
  txt += `🕐 Часы: ${hrs}\n`;
  
  const ph = shop.phone ? esc(formatPhone(shop.phone)) : '<i>не указан</i>';
  txt += `📞 Телефон: ${ph}\n\n`;
  
  const tg = shop.telegramUsername
    ? '@' + esc(shop.telegramUsername) : '<i>не указан</i>';
  txt += `📱 Telegram: ${tg}\n`;
  
  const wa = shop.whatsappPhone
    ? esc(formatPhone(shop.whatsappPhone)) : '<i>не указан</i>';
  txt += `💬 WhatsApp: ${wa}\n`;
  
  const mx = shop.maxLink ? '✅ установлена' : '<i>не указана</i>';
  txt += `🅼 MAX: ${mx}\n`;
  
  const country = findCountryByCode(shop.country);
  const cLabel = country ? country.label : '<i>не указана</i>';
  txt += `🌍 Страна: ${cLabel}\n`;
  
  const curCode = getShopCurrency(shop);
  const curObj = findCurrencyByCode(curCode);
  const curLabel = curObj 
    ? curObj.label + ' (' + curObj.sym + ')' : '₽';
  txt += `💱 Валюта: ${curLabel}\n\n`;
  txt += `<i>Что изменить?</i>`;
  
  return {
    text: txt,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📝 Название', callback_data: 'edit_shop_displayname' }],
          [{ text: '📍 Адрес', callback_data: 'edit_shop_address' }],
          [{ text: '🕐 Часы работы', callback_data: 'edit_shop_hours' }],
          [{ text: '📞 Телефон', callback_data: 'edit_shop_phone' }],
          [{ text: '📱 Telegram', callback_data: 'edit_shop_telegram' }],
          [{ text: '💬 WhatsApp', callback_data: 'edit_shop_whatsapp' }],
          [{ text: '🅼 MAX', callback_data: 'edit_shop_max' }],
          [{ text: '💱 Валюта', callback_data: 'menu_currency' }],
          [{ text: '↩️ Назад', callback_data: 'menu_back' }]
        ]
      }
    }
  };
}

// ========== ПРОВЕРКА НАЛИЧИЯ ==========
async function getCheckableBouquets(shopId) {
  const all = await getBouquetsFromDb(shopId);
  return all.filter(b => {
    const s = getBouquetStatus(b);
    return s === 'fresh' || s === 'stale' || s === 'pinned';
  });
}

async function buildCheckStartScreen(shopId) {
  const bouquets = await getCheckableBouquets(shopId);
  const count = bouquets.length;
  
  if (count === 0) {
    return {
      text: '🌿 На витрине нет букетов — проверять нечего.',
      options: { parse_mode: 'HTML' }
    };
  }
  
  const pages = Math.ceil(count / CHECK_PER_PAGE);
  const cntWord = plural(count, 'букет', 'букета', 'букетов');
  const pgWord = plural(pages, 'страницу', 'страницы', 'страниц');
  
  let txt = `✅ <b>Проверка наличия</b>\n\n`;
  txt += `В списке <b>${count}</b> ${cntWord}.\n`;
  txt += `Мы разбили их на <b>${pages}</b> `;
  txt += `${pgWord} по ${CHECK_PER_PAGE}.\n\n`;
  txt += `<i>💾 Если отвлечётесь — не страшно. `;
  txt += `Проверка сохранится, и вы сможете `;
  txt += `продолжить с того же места в течение часа.</i>`;
  
  return {
    text: txt,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Начать проверку', callback_data: 'check_start' }],
          [{ text: '❌ Отмена', callback_data: 'check_cancel' }]
        ]
      }
    }
  };
}

function buildCheckListText(session) {
  const total = session.bouquets.length;
  const done = Object.keys(session.checked).length;
  const totalPages = Math.max(1, Math.ceil(total / CHECK_PER_PAGE));
  const page = (session.currentPage || 0) + 1;
  
  let txt = `✅ <b>Проверка наличия</b>\n`;
  txt += `Страница <b>${page}</b> из <b>${totalPages}</b> · `;
  txt += `Проверено <b>${done}</b> из <b>${total}</b>\n\n`;
  txt += `<i>Работайте снизу списка, так удобнее.</i>`;
  return txt;
}

function buildCheckListKeyboard(session) {
  const rows = [];
  const total = session.bouquets.length;
  const totalPages = Math.max(1, Math.ceil(total / CHECK_PER_PAGE));
  const page = Math.max(0, Math.min(session.currentPage || 0, totalPages - 1));
  const start = page * CHECK_PER_PAGE;
  const end = Math.min(start + CHECK_PER_PAGE, total);
  const slice = session.bouquets.slice(start, end);

  const checked = slice.filter(b => session.checked[b.id]);
  const unchecked = slice.filter(b => !session.checked[b.id]);

  for (const b of checked) {
    const st = session.checked[b.id];
    const prefix = st === 'yes' ? '✓ ' : '🚫 ';
    const label = `${prefix}№${b.shopNumber} ${shortName(b.name, 16)}`;
    rows.push([{ text: label, callback_data: `check_show_${b.id}` }]);
  }

  for (const b of unchecked) {
    const label = `№${b.shopNumber} ${shortName(b.name, 16)}`;
    rows.push([{ text: label, callback_data: `check_show_${b.id}` }]);
  }

  if (totalPages > 1) {
    const navRow = [];
    if (page > 0) {
      navRow.push({ text: '⬅️ Назад', callback_data: `check_page_${page - 1}` });
    }
    navRow.push({ text: `${page + 1} / ${totalPages}`, callback_data: 'noop' });
    if (page < totalPages - 1) {
      navRow.push({ text: 'Дальше ➡️', callback_data: `check_page_${page + 1}` });
    }
    rows.push(navRow);
  }

  rows.push([{ text: '⏹ Завершить проверку', callback_data: 'check_finish' }]);
  return rows;
}

// ========== АРХИВ ==========
async function getArchivedBouquets(shopId) {
  const all = await getBouquetsFromDb(shopId);
  const arch = all.filter(b => {
    const s = getBouquetStatus(b);
    return s === 'hidden' || s === 'expired';
  });
  arch.sort((a, b) => {
    const da = new Date(a.confirmedAt || a.createdAt);
    const db = new Date(b.confirmedAt || b.createdAt);
    return db - da;
  });
  return arch;
}

async function buildArchiveModeSelection(chatId, shopId) {
  const { sendNav } = require('./bot-core');
  const arch = await getArchivedBouquets(shopId);
  if (arch.length === 0) {
    return sendNav(chatId, '📦 Архив пуст — все букеты на витрине.');
  }
  const total = arch.length;
  const word = plural(total, 'букет', 'букета', 'букетов');
  
  let txt = `📦 <b>Архив</b> · ${total} ${word}\n\n`;
  txt += `<i>Как удобнее смотреть?</i>`;
  
  return sendNav(chatId, txt, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Списком', callback_data: 'arch_mode_list' }],
        [{ text: '🖼 По одному (с фото)', callback_data: 'arch_mode_card' }],
        [{ text: '❌ Отмена', callback_data: 'arch_close' }]
      ]
    }
  });
}

// ========== МОИ БУКЕТЫ ==========
async function buildMyBouquetsMenu(chatId, shopId) {
  const { sendNav } = require('./bot-core');
  const all = await getBouquetsFromDb(shopId);
  const active = all.filter(isConfirmedRecently);
  const arch = await getArchivedBouquets(shopId);
  
  const cntWord = plural(active.length, 'активный', 'активных', 'активных');
  const archWord = plural(arch.length, 'букет', 'букета', 'букетов');
  
  let txt = `✏️ <b>Мои букеты</b>\n\n`;
  txt += `🟢 На витрине: <b>${active.length}</b> ${cntWord}\n`;
  txt += `📦 В архиве: <b>${arch.length}</b> ${archWord}\n\n`;
  txt += `<i>Что делаем?</i>`;
  
  return sendNav(chatId, txt, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔍 Найти букет', callback_data: 'mb_search' }],
        [{ text: '📋 Все активные', callback_data: 'mb_active_0' }],
        [{ text: '📦 Архив', callback_data: 'mb_archive' }],
        [{ text: '⬅️ Назад', callback_data: 'mb_close' }]
      ]
    }
  });
}

async function buildSearchPrompt(chatId) {
  const { sendNav } = require('./bot-core');
  let txt = `🔍 <b>Что ищем?</b>\n\n`;
  txt += `Напишите любое слово из названия или номер букета.\n\n`;
  txt += `Например:\n`;
  txt += `• <code>роза</code>\n`;
  txt += `• <code>Pink Avalanche</code>\n`;
  txt += `• <code>гортензия</code>\n`;
  txt += `• <code>58</code>\n\n`;
  txt += `<i>Ищем и на витрине, и в архиве.</i>`;
  
  return sendNav(chatId, txt, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'mb_close' }]]
    }
  });
}

// ========== РЕГИСТРАЦИЯ ==========
function buildRegFinalText(shopId, displayName) {
  const { SITE_URL } = require('./config');
  const link = SITE_URL + '/shop/' + shopId;
  let t = '🎉 <b>Готово! Ваша витрина создана.</b>\n\n';
  t += '🏪 Магазин: «' + esc(displayName) + '»\n\n';
  t += '🔗 <b>Ссылка для клиентов:</b>\n';
  t += link + '\n\n';
  t += '━━━━━━━━━━━━━━━\n\n';
  t += '📷 <b>Что делать дальше:</b>\n\n';
  t += '1. Нажмите «📷 Добавить букет» и ';
  t += 'отправьте фото с подписью.\n\n';
  t += '2. В подписи: название + пробел + цена.\n';
  t += '   ✅ <code>31 роза 3500</code>\n';
  t += '   ✅ <code>Пионы 4500</code>\n';
  t += '   ❌ <code>31 роза 3500 сорт Аваланж</code>\n';
  t += '      (цена должна быть последней)\n\n';
  t += '3. Букет сразу появится на витрине.\n\n';
  t += '4. Через 3 дня бот напомнит — ';
  t += 'надо будет подтвердить, что он ещё есть.\n\n';
  t += '━━━━━━━━━━━━━━━\n\n';
  t += '⚙️ Чтобы заполнить адрес, телефон и ';
  t += 'другое — «Меню» → «🏪 Данные магазина»\n\n';
  t += '💡 Если что-то непонятно — напишите ';
  t += '<code>/help</code>.\n\n';
  t += '<b>Попробуйте прямо сейчас — ';
  t += 'отправьте первый букет.</b>';
  return t;
}

function buildCountrySelect() {
  const rows = [];
  for (let i = 0; i < COUNTRIES.length; i += 2) {
    const row = [];
    row.push({
      text: COUNTRIES[i].label,
      callback_data: 'reg_country_' + COUNTRIES[i].code
    });
    if (i + 1 < COUNTRIES.length) {
      row.push({
        text: COUNTRIES[i + 1].label,
        callback_data: 'reg_country_' + COUNTRIES[i + 1].code
      });
    }
    rows.push(row);
  }
  rows.push([{
    text: '⏭ Пропустить',
    callback_data: 'reg_skip'
  }]);
  return {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows }
  };
}

// ========== ПОМОЩЬ ==========
function buildHelpMenu() {
  let t = '📖 <b>Помощь</b>\n\nЧто вы хотите узнать?\n\n';
  t += '🎓 <b>Как пользоваться</b> — пошаговый гайд\n';
  t += '❓ <b>Частые вопросы</b> — короткие ответы\n';
  t += '💬 <b>Написать в поддержку</b> — если что-то сломалось';
  return {
    text: t,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎓 Как пользоваться ботом', callback_data: 'help_guide' }],
          [{ text: '❓ Частые вопросы', callback_data: 'help_faq' }],
          [{ text: '💬 Написать в поддержку', callback_data: 'help_support' }],
          [{ text: '❌ Закрыть', callback_data: 'help_close' }]
        ]
      }
    }
  };
}

function buildHelpGuide() {
  let t = '🎓 <b>Как пользоваться Flowind</b>\n\n';
  t += '1️⃣ <b>Добавить букет</b>\n';
  t += 'Нажмите «📷 Добавить букет» и отправьте фото с подписью.\n';
  t += 'В подписи: название + цена последним словом.\n';
  t += '<code>31 роза 3500</code>\n\n';
  t += '2️⃣ <b>Проверить наличие</b>\n';
  t += 'Раз в 3 дня бот напомнит. Открывайте «✅ Что в наличии?» ';
  t += 'и отмечайте — есть или нет.\n\n';
  t += '3️⃣ <b>Найти букет</b>\n';
  t += '«✏️ Мои букеты» → «🔍 Найти букет».\n';
  t += 'Ищет по слову из названия или по номеру.\n\n';
  t += '4️⃣ <b>Изменить букет</b>\n';
  t += 'Из карточки букета: цена, переименовать, убрать с витрины, удалить.\n\n';
  t += '5️⃣ <b>Ссылка для клиентов</b>\n';
  t += '«🔗 Витрина» — она показывается на кнопке.\n';
  t += 'Отправляйте клиентам, открывается в любом браузере.\n\n';
  t += '6️⃣ <b>Пригласить флориста</b>\n';
  t += '«⚙️ Настройки → 🔑 Пригласить флориста».\n';
  t += 'Он кликнет по ссылке и сразу попадёт в команду.\n\n';
  t += '<i>Если что-то непонятно — /help снова.</i>';
  return {
    text: t,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ К помощи', callback_data: 'help_back' }]]
      }
    }
  };
}

function buildHelpFAQ() {
  let t = '❓ <b>Частые вопросы</b>\n\nВыберите вопрос:';
  return {
    text: t,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🤔 Почему бот не принимает цену?', callback_data: 'faq_price' }],
          [{ text: '⏰ Что будет, если не подтверждать?', callback_data: 'faq_expire' }],
          [{ text: '📥 Как убрать букет с витрины?', callback_data: 'faq_hide' }],
          [{ text: '🖼 Как поменять фон витрины?', callback_data: 'faq_bg' }],
          [{ text: '👥 Как добавить флориста?', callback_data: 'faq_team' }],
          [{ text: '🔗 Где ссылка для клиентов?', callback_data: 'faq_link' }],
          [{ text: '🔔 Почему не приходят уведомления?', callback_data: 'faq_notify' }],
          [{ text: '💱 Как поменять валюту?', callback_data: 'faq_currency' }],
          [{ text: '⬅️ К помощи', callback_data: 'help_back' }]
        ]
      }
    }
  };
}

function buildFaqAnswer(key) {
  const answers = {
    faq_price: {
      title: '🤔 Почему бот не принимает цену?',
      body: 'Цена должна быть <b>последним словом</b> в подписи ' +
        'и только <b>цифрами</b>.\n\n' +
        '✅ <b>Правильно:</b>\n' +
        '<code>31 роза 3500</code>\n' +
        '<code>51 хризантема 10000</code>\n\n' +
        '❌ <b>Неправильно:</b>\n' +
        '<code>31 роза 3500 сорт Аваланж</code>\n' +
        '   (после цены ещё слова)\n' +
        '<code>3500 31 роза</code>\n' +
        '   (цена в начале)\n\n' +
        '💡 Если запутались — /cancel и заново.'
    },
    faq_expire: {
      title: '⏰ Что будет, если не подтверждать?',
      body: 'Через 3 дня после добавления букет <b>уйдёт в архив</b> — ' +
        'исчезнет с витрины.\n\n' +
        'Перед этим за 12 часов бот напомнит.\n\n' +
        'Вернуть из архива можно в любой момент:\n' +
        '«✏️ Мои букеты → 📦 Архив» → «✅ Вернуть».'
    },
    faq_hide: {
      title: '📥 Как убрать букет с витрины?',
      body: 'Откройте карточку букета и нажмите «📥 Убрать с витрины».\n\n' +
        'Клиенты его больше не увидят, а вернуть можно из архива.\n\n' +
        'Не путайте с «🗑 Удалить» — там букет исчезает совсем.'
    },
    faq_bg: {
      title: '🖼 Как поменять фон витрины?',
      body: '«⚙️ Настройки → 🖼 Фон».\n\n' +
        'Можно выбрать один из 10 готовых фонов или загрузить свою картинку.\n\n' +
        'Готовые фоны — CSS-градиенты: безопасные, не мешают карточкам ' +
        'и грузятся мгновенно.'
    },
    faq_team: {
      title: '👥 Как добавить флориста?',
      body: '«⚙️ Настройки → 🔑 Пригласить флориста».\n\n' +
        'Бот выдаст ссылку. Отправьте её флористу — он кликнет, ' +
        'и сразу попадёт в вашу команду.\n\n' +
        'Управлять составом: «⚙️ Настройки → 👥 Команда».'
    },
    faq_link: {
      title: '🔗 Где ссылка для клиентов?',
      body: 'Кнопка «🔗 Витрина» в главном меню.\n\n' +
        'Ссылка кликабельная — можно переслать клиенту. ' +
        'Он откроет в любом браузере без VPN.'
    },
    faq_notify: {
      title: '🔔 Почему не приходят уведомления?',
      body: 'Уведомления приходят только тем, кто «на смене».\n\n' +
        'Нажмите в главном меню «✅ Я сегодня работаю» — и всё заработает.\n\n' +
        'Статус сбрасывается через 14 часов, поэтому каждое утро ' +
        'его нужно включать.'
    },
    faq_currency: {
      title: '💱 Как поменять валюту?',
      body: '«⚙️ Настройки → 🏪 Данные магазина → 💱 Валюта».\n\n' +
        'Доступные валюты:\n' +
        '₽ рубль · ₸ тенге · Br рубль · сўм сум\n\n' +
        'Цены <b>не пересчитываются</b> — просто меняется символ. ' +
        'Если хотите новые цены — поменяйте их вручную.'
    }
  };
  
  const a = answers[key];
  if (!a) return null;
  
  return {
    text: '<b>' + a.title + '</b>\n\n' + a.body,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❓ К вопросам', callback_data: 'help_faq' }],
          [{ text: '💬 Поддержка', callback_data: 'help_support' }]
        ]
      }
    }
  };
}

function buildHelpSupport() {
  let t = '💬 <b>Поддержка Flowind</b>\n\n';
  t += 'Если что-то не работает или непонятно — напишите напрямую:\n\n';
  t += '👤 @floop10\n\n';
  t += '<i>Постараемся ответить в течение дня.</i>';
  return {
    text: t,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ К помощи', callback_data: 'help_back' }]]
      }
    }
  };
}

module.exports = {
  OWNER_STEPS,
  FLORIST_STEPS,
  MENU_BUTTONS,
  ADD_BOUQUET_HINT,
  REG_STEPS,
  REG_ORDER,
  CHECK_PER_PAGE,
  LIST_PER_PAGE,
  SEARCH_PER_PAGE,
  plural,
  getMainKeyboard,
  getSettingsMenu,
  buildShopDataMessage,
  getCheckableBouquets,
  buildCheckStartScreen,
  buildCheckListText,
  buildCheckListKeyboard,
  getArchivedBouquets,
  buildArchiveModeSelection,
  buildMyBouquetsMenu,
  buildSearchPrompt,
  buildRegFinalText,
  buildCountrySelect,
  buildHelpMenu,
  buildHelpGuide,
  buildHelpFAQ,
  buildFaqAnswer,
  buildHelpSupport
};