const pool = require('./db');

const {
  SITE_URL, BOT_USERNAME, PRESET_SHOP,
  esc, normalizePhone, isServiceAdmin,
  isOwner, getRemainingDays, generateInviteCode,
  generateShopId, isSubscriptionActive
} = require('./config');

const {
  getShopFromDb, createShopInDb, addAdminToDb,
  setUserOnShift, getShopByInvite, findUserShop,
  updateShopField, saveShopSettings,
  getOwnerOnboardingState, getFloristOnboardingState,
  setOwnerOnboardingStep, setFloristOnboardingStep,
  setOwnerOnboardingPassed, setFloristOnboardingPassed,
  getAllShopsAdmin, extendShopTrial, blockShop, unblockShop,
  getBouquetById, getBouquetsFromDb,
  updateBouquetField, updateBouquetFields,
  addBouquetToDb, incrementShopStat,
  removeAdminFromDb, getShopByInvite
} = require('./db-actions');

const {
  MENU_BUTTONS, ADD_BOUQUET_HINT, REG_STEPS, REG_ORDER,
  CHECK_PER_PAGE, LIST_PER_PAGE, SEARCH_PER_PAGE,
  plural, getMainKeyboard, getSettingsMenu,
  buildShopDataMessage, getCheckableBouquets,
  buildCheckStartScreen, buildCheckListText, buildCheckListKeyboard,
  getArchivedBouquets, buildArchiveModeSelection,
  buildMyBouquetsMenu, buildSearchPrompt,
  buildRegFinalText, buildCountrySelect,
  buildHelpMenu, buildHelpGuide, buildHelpFAQ,
  buildFaqAnswer, buildHelpSupport
} = require('./bot-ui');

// ========== ГЛОБАЛЬНЫЕ СОСТОЯНИЯ ==========
const userToShop = {};
const registrationState = {};
const lastBouquetByUser = {};
const awaitingInput = {};
const awaitingUpload = {};
const awaitingPrice = {};
const awaitingWarehousePin = {};
const warehousePinMode = {};
const awaitingName = {};
const awaitingMarkup = {};
const awaitingSearch = {};
const photoUrlCache = {};
const checkSessions = {};
const archiveSessions = {};
const searchSessions = {};
const notifiedClicks = {};
const awaitingAdminMessage = {};
const awaitingAdminBlockReason = {};
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

// ========== ОНБОРДИНГ ==========
async function advanceOwnerOnboarding(bot, chatId, shopId) {
  const state = await getOwnerOnboardingState(shopId);
  if (!state || state.passed) return;

  let txt = '';
  let next = '';

  if (state.step === 'add_bouquet') {
    txt = '🎉 <b>Отлично!</b> Первый букет добавлен.\n\nТеперь проверьте витрину — как её видят клиенты.';
    next = 'view_shop';
    const shop = await getShopFromDb(shopId);
    await bot.sendMessage(chatId, txt, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '👀 Открыть витрину', url: SITE_URL + '/shop/' + shopId }]] }
    });
  } else if (state.step === 'view_shop') {
    txt = '✏️ <b>А теперь попробуйте изменить цену</b>\n\nОткройте «✏️ Мои букеты», выберите букет и измените цену.';
    next = 'edit_price';
    const shop = await getShopFromDb(shopId);
    await bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  } else if (state.step === 'edit_price') {
    txt = '📥 <b>Уберём букет с витрины?</b>\n\nВ карточке букета нажмите «📥 Убрать с витрины».';
    next = 'hide_bouquet';
    const shop = await getShopFromDb(shopId);
    await bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  } else if (state.step === 'hide_bouquet') {
    txt = '✅ <b>А теперь вернём его обратно</b>\n\nЗайдите в «📦 Архив» и верните букет.';
    next = 'restore_bouquet';
    const shop = await getShopFromDb(shopId);
    await bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  } else if (state.step === 'restore_bouquet') {
    txt = '📦 <b>Отлично!</b>\n\nТеперь загляните в «📦 Склад» — там ваш товар. И заодно проверьте, что витрина выглядит как надо.';
    next = 'check_stock';
    const shop = await getShopFromDb(shopId);
    await bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  } else if (state.step === 'check_stock') {
    txt = '⚙️ <b>Последний шаг — настройки</b>\n\nЗайдите в «⚙️ Настройки» и посмотрите, что можно изменить.';
    next = 'settings_tour';
    const shop = await getShopFromDb(shopId);
    await bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
  } else if (state.step === 'settings_tour') {
    txt = '🎉 <b>Обучение завершено!</b>\n\nТеперь вы знаете, как пользоваться Flowind. Если будут вопросы — пишите /help.';
    next = 'done';
    await bot.sendMessage(chatId, txt, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🚀 Понятно', callback_data: 'onb_finish' }]] }
    });
  }

  if (next && next !== state.step) {
    await setOwnerOnboardingStep(shopId, next);
  }
}

async function advanceFloristOnboarding(bot, chatId, shopId) {
  const state = await getFloristOnboardingState(chatId, shopId);
  if (!state || state.passed) return;

  let txt = '';
  let next = '';

  if (state.step === 'add_bouquet') {
    txt = '🎉 <b>Отлично!</b> Вы добавили букет.\n\nТеперь проверьте наличие.';
    next = 'check_stock';
    await bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: getMainKeyboard(await getShopFromDb(shopId), chatId) });
  } else if (state.step === 'check_stock') {
    txt = '📦 <b>Склад — это ваша база.</b>\n\nЧтобы получать уведомления о клиентах, нажмите «✅ Я сегодня работаю».';
    next = 'on_shift';
    await bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: getMainKeyboard(await getShopFromDb(shopId), chatId) });
  } else if (state.step === 'on_shift') {
    txt = '🎉 <b>Вы готовы к работе!</b>\n\nУведомления будут приходить, когда вы на смене.';
    next = 'done';
    await setFloristOnboardingPassed(chatId, shopId);
    await bot.sendMessage(chatId, txt, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🚀 В меню', callback_data: 'onb_finish' }]] }
    });
  }

  if (next && next !== state.step && next !== 'done') {
    await setFloristOnboardingStep(chatId, shopId, next);
  }
}

async function advanceOnboardingAfter(bot, chatId, shopId, action) {
  try {
    const shop = await getShopFromDb(shopId);
    if (!shop) return;
    const ownerCheck = isOwner(shop, chatId);
    
    if (ownerCheck) {
      const state = await getOwnerOnboardingState(shopId);
      if (state && !state.passed && state.step === action) {
        return advanceOwnerOnboarding(bot, chatId, shopId);
      }
    } else {
      const state = await getFloristOnboardingState(chatId, shopId);
      if (state && !state.passed && state.step === action) {
        return advanceFloristOnboarding(bot, chatId, shopId);
      }
    }
  } catch (e) {
    console.error('Onboarding error:', e.message);
  }
}

// ========== РЕГИСТРАЦИЯ ==========
async function generateUniqueShopId() {
  for (let i = 0; i < 20; i++) {
    const id = generateShopId();
    if (!(await getShopFromDb(id))) return id;
  }
  return generateShopId() + Date.now().toString(36).slice(-4);
}

async function sendRegistrationStep(bot, chatId, state) {
  const cfg = REG_STEPS[state.step];
  if (!cfg) {
    delete registrationState[chatId];
    return;
  }
  if (state.step === 'country') {
    const msg = await bot.sendMessage(chatId, cfg.text, buildCountrySelect());
    state.messageId = msg.message_id;
    return;
  }
  const opts = { parse_mode: 'HTML' };
  if (cfg.skip) {
    opts.reply_markup = {
      inline_keyboard: [[{ text: '⏭ Пропустить', callback_data: 'reg_skip' }]]
    };
  }
  const msg = await bot.sendMessage(chatId, cfg.text, opts);
  state.messageId = msg.message_id;
}

async function startRegistration(bot, chatId, userName, userUsername) {
  const existing = userToShop[chatId] || await findUserShop(chatId);
  if (existing) {
    return sendNav(bot, chatId, '❌ Уже привязаны к магазину.');
  }
  registrationState[chatId] = {
    step: 'shopId',
    data: {},
    messageId: null,
    userName: userName || null,
    userUsername: userUsername || null
  };
  await sendRegistrationStep(bot, chatId, registrationState[chatId]);
}

async function regGoToNextStep(bot, chatId, state) {
  const idx = REG_ORDER.indexOf(state.step);
  if (idx === -1 || idx >= REG_ORDER.length - 1) {
    return regFinish(bot, chatId, state);
  }
  state.step = REG_ORDER[idx + 1];
  await sendRegistrationStep(bot, chatId, state);
}

async function regSkipCurrentStep(bot, chatId, state) {
  if (state.step === 'shopId') {
    state.data.shopId = await generateUniqueShopId();
  }
  await regGoToNextStep(bot, chatId, state);
}

async function regSaveValue(bot, chatId, state, text) {
  const step = state.step;
  const value = text.trim();

  if (step === 'shopId') {
    const clean = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!clean || clean.length < 2) {
      return bot.sendMessage(chatId, '❌ Только латинские буквы, цифры и _ (минимум 2 символа). Попробуйте ещё раз или нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    if (await getShopFromDb(clean)) {
      return bot.sendMessage(chatId, '❌ Это имя уже занято. Попробуйте другое или нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    state.data.shopId = clean;
  } else if (step === 'displayName') {
    if (value.length < 2 || value.length > 60) {
      return bot.sendMessage(chatId, '❌ Название должно быть от 2 до 60 символов. Попробуйте ещё раз.');
    }
    state.data.displayName = value;
  } else if (step === 'country') {
    return;
  } else if (step === 'address') {
    state.data.address = value;
  } else if (step === 'hours') {
    state.data.hours = value;
  } else if (step === 'phone') {
    const norm = normalizePhone(value);
    if (!norm) {
      return bot.sendMessage(chatId, '❌ Похоже на опечатку. Пришлите номер целиком.\nНапример: <i>+7 962 402-51-75</i>\n\nИли нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    state.data.phone = norm;
  } else if (step === 'telegram') {
    const clean = value.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(clean)) {
      return bot.sendMessage(chatId, '❌ Юзернейм — только латиница, цифры, _ (от 3 до 32 символов). Попробуйте ещё раз или нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    state.data.telegramUsername = clean;
  } else if (step === 'whatsapp') {
    const norm = normalizePhone(value);
    if (!norm) {
      return bot.sendMessage(chatId, '❌ Похоже на опечатку. Пришлите номер целиком.\nНапример: <i>+7 962 402-51-75</i>\n\nИли нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    state.data.whatsappPhone = norm;
  } else if (step === 'max') {
    if (!/^https?:\/\/max\.ru\//.test(value)) {
      return bot.sendMessage(chatId, '❌ Ссылка должна начинаться с <code>https://max.ru/u/...</code>\n\nПопробуйте ещё раз или нажмите «Пропустить».', { parse_mode: 'HTML' });
    }
    state.data.maxLink = value;
  }

  await regGoToNextStep(bot, chatId, state);
}

async function regFinish(bot, chatId, state) {
  const d = state.data;
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setMonth(trialEnd.getMonth() + PRESET_SHOP.trialMonths);
  const inviteCode = generateInviteCode();
  const userName = state.userName || 'Владелец';

  let defaultCurrency = 'RUB';
  if (d.country === 'KZ') defaultCurrency = 'KZT';
  else if (d.country === 'BY') defaultCurrency = 'BYN';
  else if (d.country === 'UZ') defaultCurrency = 'UZS';

  try {
    await createShopInDb({
      shopId: d.shopId,
      name: d.shopId,
      displayName: d.displayName,
      address: d.address || null,
      hours: d.hours || null,
      phone: d.phone || null,
      telegramUsername: d.telegramUsername || null,
      whatsappPhone: d.whatsappPhone || null,
      maxLink: d.maxLink || null,
      inviteCode,
      trialStart: now.toISOString(),
      trialEnd: trialEnd.toISOString(),
      country: d.country || null,
      settings: {
        logo: null, cover: null,
        background: { type: 'preset', id: 1 },
        buttonColor: 'red',
        currency: defaultCurrency,
        markupPercent: 20, aiEnabled: false
      },
      stats: { views: 0, orders: 0, calls: 0, startedAt: now.toISOString() }
    });
    
    await addAdminToDb(chatId, d.shopId, 'owner', userName);
    await setUserOnShift(chatId, d.shopId, true);
    userToShop[chatId] = d.shopId;
    await setOwnerOnboardingStep(d.shopId, 'add_bouquet');

    delete registrationState[chatId];
    
    await bot.sendMessage(chatId, buildRegFinalText(d.shopId, d.displayName), { parse_mode: 'HTML' });

    if (OWNER_CHAT_ID && OWNER_CHAT_ID !== chatId) {
      const tgRef = state.userUsername ? '@' + state.userUsername : 'chat_id ' + chatId;
      const link = SITE_URL + '/shop/' + d.shopId;
      
      let adminTxt = '🎉 <b>Новый магазин зарегистрирован!</b>\n\n';
      adminTxt += '🏪 «' + esc(d.displayName) + '»\n';
      adminTxt += '🆔 <code>' + esc(d.shopId) + '</code>\n';
      adminTxt += '👤 ' + esc(userName) + ' (' + esc(tgRef) + ')\n\n';
      adminTxt += '🔗 ' + link + '\n\n';
      adminTxt += '<i>Открыть админ-панель — /admin</i>';
      
      bot.sendMessage(OWNER_CHAT_ID, adminTxt, { parse_mode: 'HTML' }).catch(function(){});
    }
  } catch (e) {
    console.error('Ошибка создания магазина:', e?.message || e);
    delete registrationState[chatId];
    return bot.sendMessage(chatId, '❌ Ошибка при создании магазина. Попробуйте ещё раз /register.');
  }
}

module.exports = {
  userToShop, registrationState, lastBouquetByUser,
  awaitingInput, awaitingUpload, awaitingPrice,
  awaitingWarehousePin, warehousePinMode, awaitingName,
  awaitingMarkup, awaitingSearch, checkSessions,
  archiveSessions, searchSessions, awaitingAdminMessage,
  awaitingAdminBlockReason, lastNavByChat,
  sendNav, advanceOnboardingAfter, 
  startRegistration, regGoToNextStep, regSkipCurrentStep, 
  regSaveValue, regFinish
};
// ========== ОБРАБОТКА КОМАНД ==========
function setupBotHandlers(bot, OWNER_CHAT_ID, s3ctx) {
  const {
    S3_ENABLED, YC_BUCKET, BC_BUCKET,
    S3_BACKUP_ENABLED, BC_ENDPOINT,
    s3, s3backup
  } = s3ctx;
  const token = process.env.BOT_TOKEN;

  async function savePhotoToStorage(fileId, shopId) {
    if (!S3_ENABLED) return { tg: fileId };
    try {
      const fileInfo = await bot.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${token}/` +
        `${fileInfo.file_path}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buffer = Buffer.from(await res.arrayBuffer());
      
      const rand = Math.random().toString(36).slice(2, 8);
      const key = `${shopId}/${Date.now()}_${rand}.jpg`;
      
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await s3.send(new PutObjectCommand({
        Bucket: YC_BUCKET, Key: key, Body: buffer,
        ContentType: 'image/jpeg'
      }));
      const s3Url = `https://${YC_BUCKET}.storage.yandexcloud.net/${key}`;
      
      let backupUrl = null;
      if (S3_BACKUP_ENABLED) {
        try {
          await s3backup.send(new PutObjectCommand({
            Bucket: BC_BUCKET, Key: key, Body: buffer,
            ContentType: 'image/jpeg'
          }));
          backupUrl = BC_ENDPOINT + '/' + BC_BUCKET + '/' + key;
        } catch (err) { /* ignore */ }
      }
      
      const result = { s3: s3Url, tg: fileId };
      if (backupUrl) result.s3b = backupUrl;
      return result;
    } catch (e) {
      console.error('⚠️ Ошибка S3:', e?.message || e);
      return { tg: fileId };
    }
  }

  function validatePhotoSaved(res) {
    if (!res) return false;
    if (typeof res === 'object') {
      if (res.s3 && res.s3.startsWith('http')) return true;
      if (res.tg && res.tg.length > 10) return true;
    }
    if (typeof res === 'string') {
      if (res.startsWith('http')) return true;
    }
    return false;
  }

  // ====== /START ======
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const param = match && match[1] ? match[1].trim() : null;
    const userName = msg.from.first_name || 'Флорист';

    delete archiveSessions[chatId];

    if (param && param.startsWith('inv_')) {
      const inviteCode = param.replace('inv_', '').toUpperCase();
      const shopId = await getShopByInvite(inviteCode);
      
      if (shopId) {
        const shop = await getShopFromDb(shopId);
        if (shop && shop.blocked) {
          return bot.sendMessage(chatId, '🚫 Этот магазин заблокирован. Напишите @floop10.');
        }
        
        const currentShop = await findUserShop(chatId);
        if (currentShop && currentShop !== shopId) {
          return bot.sendMessage(chatId, '❌ Вы уже привязаны к другому магазину.');
        }

        const existing = await getFloristOnboardingState(chatId, shopId);
        await addAdminToDb(chatId, shopId, 'florist', userName);
        userToShop[chatId] = shopId;

        if (!existing || !existing.passed) {
          await setFloristOnboardingStep(chatId, shopId, 'add_bouquet');
        }
        
        const updatedShop = await getShopFromDb(shopId);
        let invText = '🎉 Добро пожаловать в команду «';
        invText += esc(shop.displayName) + '»!\n\n';
        invText += '📷 Добавляйте букеты: фото с подписью «Название цена».\n';
        invText += '✅ Подтверждайте наличие через «Что в наличии?».\n\n';
        invText += '<i>💡 Чтобы получать уведомления о клиентах, ';
        invText += 'нажмите «✅ Я сегодня работаю» в меню.</i>';
        
        await bot.sendMessage(chatId, invText, {
          parse_mode: 'HTML',
          reply_markup: getMainKeyboard(updatedShop, chatId)
        });
        return;
      }
      return bot.sendMessage(chatId, '❌ Приглашение недействительно.');
    }

    let shopId = userToShop[chatId] || await findUserShop(chatId);

    if (!shopId) {
      if (OWNER_CHAT_ID && chatId === OWNER_CHAT_ID) {
        const presetShop = await getShopFromDb(PRESET_SHOP.shopId);
        if (presetShop && presetShop.admins.length === 0) {
          await addAdminToDb(chatId, PRESET_SHOP.shopId, 'owner', userName);
          await setUserOnShift(chatId, PRESET_SHOP.shopId, true);
          userToShop[chatId] = PRESET_SHOP.shopId;
          shopId = PRESET_SHOP.shopId;
        }
      }
    }

    if (shopId) {
      const shop = await getShopFromDb(shopId);
      if (!shop) return bot.sendMessage(chatId, '❌ Магазин не найден.');
      userToShop[chatId] = shopId;

      if (shop.blocked) {
        let blockText = '🚫 <b>Магазин заблокирован</b>\n\n';
        if (shop.blockedReason) {
          blockText += 'Причина: <i>' + esc(shop.blockedReason) + '</i>\n\n';
        }
        blockText += 'Для разблокировки напишите: @floop10';
        return bot.sendMessage(chatId, blockText, { parse_mode: 'HTML' });
      }

      if (!isSubscriptionActive(shop)) {
        let subText = '⏳ <b>Подписка истекла</b>\n\n';
        subText += 'Магазин «' + esc(shop.displayName) + '» приостановлен. ';
        subText += 'Витрина не показывается клиентам.\n\n';
        subText += 'Для продления напишите: @floop10';
        return bot.sendMessage(chatId, subText, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '💳 Продлить', callback_data: 'menu_renew' }]]
          }
        });
      }

      const owner = isOwner(shop, chatId);
      const me = shop.admins.find(a => a.chatId === chatId);
      const onShift = !!(me && me.onShift);

      let txt = '🌸 «' + esc(shop.displayName) + '»\n\n';
      if (owner) txt += '👑 Вы — владелец.\n';
      else txt += '🌸 Вы — флорист.\n';
      
      if (onShift) {
        txt += '🟢 Вы <b>на смене</b>.\n\n';
      } else {
        txt += '⚪ Вы <b>не на смене</b>. Нажмите ';
        txt += '«✅ Я сегодня работаю», чтобы получать уведомления.\n\n';
      }
      txt += 'Меню — внизу под полем ввода.';
      
      return bot.sendMessage(chatId, txt, {
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard(shop, chatId)
      });
    }

    let welcome = '🌸 <b>Добро пожаловать в Flowind!</b>\n\n';
    welcome += 'Это витрина для цветочных магазинов.\n';
    welcome += 'Флорист добавляет букет через бота — ';
    welcome += 'он сразу появляется на витрине.\n';
    welcome += 'Клиент видит витрину и пишет вам в мессенджер.\n\n';
    welcome += 'Если вы флорист — нажмите «Создать магазин», ';
    welcome += 'и через минуту у вас будет своя витрина.\n\n';
    welcome += 'Если вас пригласил владелец магазина — ';
    welcome += 'просто откройте ссылку, которую он прислал.';
    
    return bot.sendMessage(chatId, welcome, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '➕ Создать магазин', callback_data: 'welcome_create' }]]
      }
    });
  });

  // ====== /ADMIN ======
  bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isServiceAdmin(chatId)) return;
    const { showAdminPanel } = require('./bot-admin');
    return showAdminPanel(bot, chatId);
  });

  // ====== /HELP ======
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const menu = buildHelpMenu();
    return bot.sendMessage(chatId, menu.text, menu.options);
  });

  // ====== /CANCEL ======
  bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    
    delete awaitingUpload[chatId];
    delete awaitingInput[chatId];
    delete awaitingWarehousePin[chatId];
    delete warehousePinMode[chatId];
    delete awaitingPrice[chatId];
    delete awaitingName[chatId];
    delete awaitingMarkup[chatId];
    delete awaitingSearch[chatId];
    delete awaitingAdminMessage[chatId];
    delete awaitingAdminBlockReason[chatId];
    delete checkSessions[chatId];
    delete archiveSessions[chatId];
    delete searchSessions[chatId];
    delete registrationState[chatId];
    
    const shopId = userToShop[chatId] || await findUserShop(chatId);
    if (shopId) {
      const shop = await getShopFromDb(shopId);
      return bot.sendMessage(chatId, '❌ Отменено.', {
        reply_markup: getMainKeyboard(shop, chatId)
      });
    }
    bot.sendMessage(chatId, '❌ Отменено.');
  });

  // ====== /REGISTER ======
  bot.onText(/\/register/, async (msg) => {
    await startRegistration(bot, msg.chat.id, msg.from.first_name, msg.from.username);
  });

  // ====== /MIGRATE ======
  bot.onText(/\/migrate/, async (msg) => {
    const chatId = msg.chat.id;
    const shopId = userToShop[chatId] || await findUserShop(chatId);
    if (!shopId) return bot.sendMessage(chatId, '❌ Сначала /start');
    
    const shop = await getShopFromDb(shopId);
    if (!shop) return;
    if (!isOwner(shop, chatId)) return bot.sendMessage(chatId, '🚫 Только владелец.');
    if (!S3_ENABLED) return bot.sendMessage(chatId, '❌ Yandex S3 не настроен.');
    
    await bot.sendMessage(chatId, '⏳ Начинаю миграцию фото в Yandex S3...');
    try {
      const { migratePhotosToS3 } = require('./photo-utils');
      const r = await migratePhotosToS3(shopId, bot, s3ctx);
      let txt = '✅ <b>Миграция завершена</b>\n\n';
      txt += '📤 Перенесено: <b>' + r.migrated + '</b>\n';
      txt += '⏭ Уже было в S3: <b>' + r.skipped + '</b>\n';
      txt += '❌ Ошибок: <b>' + r.failed + '</b>';
      return bot.sendMessage(chatId, txt, { parse_mode: 'HTML' });
    } catch (e) {
      return bot.sendMessage(chatId, '❌ Ошибка во время миграции. Проверьте логи.');
    }
  });

  // ====== MESSAGE ======
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    // 1. Причина блокировки
    if (awaitingAdminBlockReason[chatId]) {
      const target = awaitingAdminBlockReason[chatId];
      const reason = text.trim();
      
      if (!reason || reason.length < 3) {
        return bot.sendMessage(chatId, '❌ Причина слишком короткая (минимум 3 символа).');
      }
      if (reason.length > 300) {
        return bot.sendMessage(chatId, '❌ Слишком длинная причина (максимум 300 символов).');
      }
      
      delete awaitingAdminBlockReason[chatId];
      await blockShop(target.shopId, reason);
      
      const shop = await getShopFromDb(target.shopId);
      const owner = shop.admins.find(a => a.role === 'owner');
      
      if (owner) {
        let notice = '🚫 <b>Магазин заблокирован</b>\n\n';
        notice += 'Причина: <i>' + esc(reason) + '</i>\n\n';
        notice += 'Если это ошибка — напишите @floop10.';
        bot.sendMessage(owner.chatId, notice, { parse_mode: 'HTML' }).catch(function(){});
      }
      return bot.sendMessage(chatId, '✅ Магазин «' + esc(shop.displayName) + '» заблокирован.');
    }

    // 2. Сообщение владельцу
    if (awaitingAdminMessage[chatId]) {
      const target = awaitingAdminMessage[chatId];
      if (text.trim().length > 1000) {
        return bot.sendMessage(chatId, '❌ Слишком длинное сообщение.');
      }
      
      delete awaitingAdminMessage[chatId];
      try {
        let body = '📩 <b>Сообщение от Flowind</b>\n\n';
        body += esc(text.trim()) + '\n\n';
        body += '<i>Если нужна помощь — пишите @floop10</i>';
        await bot.sendMessage(target.targetChatId, body, { parse_mode: 'HTML' });
        return bot.sendMessage(chatId, '✅ Отправлено в «' + esc(target.targetName) + '».');
      } catch (e) {
        return bot.sendMessage(chatId, '❌ Не удалось отправить.');
      }
    }

    // 3. Сброс состояний при нажатии кнопок меню
    if (MENU_BUTTONS.includes(text)) {
      delete awaitingPrice[chatId];
      delete awaitingName[chatId];
      delete awaitingMarkup[chatId];
      delete awaitingInput[chatId];
      delete awaitingUpload[chatId];
      delete awaitingSearch[chatId];
      delete archiveSessions[chatId];
      delete awaitingAdminMessage[chatId];
      delete awaitingAdminBlockReason[chatId];
    }

    const shopId = userToShop[chatId] || await findUserShop(chatId);

    // 4. Поиск
    if (awaitingSearch[chatId] && shopId) {
      delete awaitingSearch[chatId];
      const query = text.trim();
      if (!query) return sendNav(bot, chatId, '❌ Пустой запрос.');
      const { renderSearchResults } = require('./bot-ui');
      const { searchBouquets } = require('./db-actions');
      const res = await searchBouquets(shopId, query);
      return renderSearchResults(bot, chatId, shopId, query, res.results);
    }

    // 5. Ввод данных магазина
    const input = awaitingInput[chatId];
    if (input && shopId) {
      const shop = await getShopFromDb(shopId);
      if (!shop) { delete awaitingInput[chatId]; return; }
      if (!isOwner(shop, chatId)) {
        delete awaitingInput[chatId];
        return sendNav(bot, chatId, '🚫 Только владелец.');
      }

      let value = text.trim();
      if (value.toLowerCase() === 'нет') value = null;

      if (input.field === 'telegram_username' && value) {
        value = value.replace(/^@/, '').toLowerCase();
      }
      
      if (input.field === 'max_username' && value) {
        if (!/^https?:\/\/max\.ru\//.test(value)) {
          return bot.sendMessage(chatId, '❌ Ссылка должна начинаться с <code>https://max.ru/u/...</code>', { parse_mode: 'HTML' });
        }
      }
      
      if ((input.field === 'phone' || input.field === 'whatsapp_phone') && value) {
        const norm = normalizePhone(value);
        if (!norm) return bot.sendMessage(chatId, '❌ Похоже на опечатку. Пришлите номер целиком.');
        value = norm;
      }

      if (input.field === 'display_name' && value) {
        if (value.length < 2 || value.length > 60) return bot.sendMessage(chatId, '❌ 2–60 символов.');
      }
      
      if (input.field === 'telegram_username' && value) {
        if (!/^[a-z0-9_]{3,32}$/.test(value)) return bot.sendMessage(chatId, '❌ Только латиница, цифры, _, от 3 до 32 символов.');
      }

      await updateShopField(shopId, input.field, value);
      delete awaitingInput[chatId];

      const updatedShop = await getShopFromDb(shopId);
      const { text: t, options } = buildShopDataMessage(updatedShop);
      
      return bot.sendMessage(chatId, '✅ Сохранено!\n\n' + t, {
        ...options, reply_markup: getMainKeyboard(updatedShop, chatId)
      });
    }

    // 6. Цена
    if (awaitingPrice[chatId]) {
      if (!shopId) { delete awaitingPrice[chatId]; return; }
      const b = await getBouquetById(shopId, awaitingPrice[chatId]);
      if (!b) { delete awaitingPrice[chatId]; return sendNav(bot, chatId, '❌ Букет не найден.'); }
      
      const newPrice = parseFloat(text.replace(/[^\d.,]/g, '').replace(',', '.'));
      if (isNaN(newPrice) || newPrice <= 0) {
        return bot.sendMessage(chatId, '❌ Введите число.');
      }
      
      const oldPrice = b.price;
      const newPriceInt = Math.round(newPrice);
      await updateBouquetField(b.id, 'price', newPriceInt);
      delete awaitingPrice[chatId];
      
      const shop = await getShopFromDb(shopId);
      await bot.sendMessage(chatId, '✅ Цена обновлена: ' + formatPrice(oldPrice, shop) + ' → ' + formatPrice(newPriceInt, shop), { reply_markup: getMainKeyboard(shop, chatId) });
      await advanceOnboardingAfter(bot, chatId, shopId, 'edit_price');
      return;
    }

    // 7. Переименование
    if (awaitingName[chatId]) {
      if (!shopId) { delete awaitingName[chatId]; return; }
      const newName = text.trim();
      if (newName.length < 2 || newName.length > 80) {
        return bot.sendMessage(chatId, '❌ 2–80 символов.');
      }
      
      const { extractTagsFromName } = require('./config');
      const newTags = extractTagsFromName(newName);
      await updateBouquetFields(awaitingName[chatId], {
        name: newName,
        is_pinned: newName.startsWith('.'),
        tags: JSON.stringify(newTags)
      });
      
      delete awaitingName[chatId];
      const shop = await getShopFromDb(shopId);
      let reply = '✅ Переименовано: «' + newName + '»';
      if (newTags.length > 0) reply += '\n🏷 Теги: ' + newTags.map(t => '#' + t).join(' ');
      return bot.sendMessage(chatId, reply, { reply_markup: getMainKeyboard(shop, chatId) });
    }

    // 8. Наценка
    if (awaitingMarkup[chatId]) {
      if (!shopId) { delete awaitingMarkup[chatId]; return; }
      const pct = parseInt(text.replace(/[^\d]/g, ''));
      if (isNaN(pct) || pct < 0 || pct > 200) return bot.sendMessage(chatId, '❌ 0–200.');
      
      const shop = await getShopFromDb(shopId);
      shop.settings.markupPercent = pct;
      await saveShopSettings(shopId, shop.settings);
      delete awaitingMarkup[chatId];
      return bot.sendMessage(chatId, '✅ Наценка: ' + pct + '%', { reply_markup: getMainKeyboard(shop, chatId) });
    }

    if (!shopId) return;
    const shop = await getShopFromDb(shopId);

    // 9. PIN-код
    if (awaitingWarehousePin[chatId]) {
      const mode = warehousePinMode[chatId];
      const pin = text.trim();
      if (!/^\d{4}$/.test(pin)) {
        return bot.sendMessage(chatId, '❌ PIN-код должен состоять ровно из 4 цифр.');
      }

      delete awaitingWarehousePin[chatId];
      delete warehousePinMode[chatId];

      if (mode === 'set') {
        await pool.query(`UPDATE admins SET warehouse_pin = $1 WHERE chat_id = $2 AND shop_id = $3`, [pin, chatId, shopId]);
        return bot.sendMessage(chatId, '✅ <b>PIN-код установлен!</b>', { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
      }

      if (mode === 'enter') {
        const r = await pool.query(`SELECT chat_id FROM admins WHERE shop_id = $1 AND warehouse_pin = $2`, [shopId, pin]);
        if (r.rows.length > 0) {
          const directLink = SITE_URL + '/warehouse-login?shop=' + shopId;
          let msgText = '✅ <b>Добро пожаловать в склад!</b>\n\n';
          msgText += '📱 <b>Для входа с планшета (Safari)</b>, скопируйте ссылку:\n<code>' + directLink + '</code>';
          return bot.sendMessage(chatId, msgText, { 
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '📦 Открыть склад', web_app: { url: SITE_URL + '/warehouse-app' } }]] }
          });
        } else {
          return bot.sendMessage(chatId, '❌ <b>Неверный PIN-код.</b>', { parse_mode: 'HTML' });
        }
      }
    }

    // ========== ТЕКСТОВЫЕ КНОПКИ ==========
    if (text === '📷 Добавить букет') {
      return sendNav(bot, chatId, ADD_BOUQUET_HINT, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
    }
    
    if (text === '📦 Склад') {
      if (!isOwner(shop, chatId)) return bot.sendMessage(chatId, '🚫 Доступ к складу есть только у владельца магазина.');
      const adm = await pool.query(`SELECT warehouse_pin FROM admins WHERE chat_id = $1 AND shop_id = $2`, [chatId, shopId]);
      const hasPin = adm.rows.length > 0 && adm.rows[0].warehouse_pin;
      if (!hasPin) {
        warehousePinMode[chatId] = 'set';
        awaitingWarehousePin[chatId] = true;
        return bot.sendMessage(chatId, '🔐 <b>Установка PIN-кода для склада</b>\n\nПридумайте 4-значный код.', { parse_mode: 'HTML' });
      } else {
        warehousePinMode[chatId] = 'enter';
        awaitingWarehousePin[chatId] = true;
        return bot.sendMessage(chatId, '🔐 <b>Вход в склад</b>\n\nВведите ваш 4-значный PIN-код:', { parse_mode: 'HTML' });
      }
    }

    if (text === '✅ Что в наличии?') {
      if (!isSubscriptionActive(shop)) return sendNav(bot, chatId, '❌ Подписка истекла.');
      const { CHECK_SESSION_TTL } = require('./bot-ui');
      const existing = checkSessions[chatId];
      if (existing && (Date.now() - (existing.lastActivity || 0)) < CHECK_SESSION_TTL) {
        existing.lastActivity = Date.now();
        const t = buildCheckListText(existing);
        const kb = { inline_keyboard: buildCheckListKeyboard(existing) };
        const sent = await sendNav(bot, chatId, t, { parse_mode: 'HTML', reply_markup: kb });
        existing.listMessageId = sent.message_id;
        return;
      }
      const { text: t, options } = await buildCheckStartScreen(shopId);
      await sendNav(bot, chatId, t, options);
      return;
    }

    if (text === '✏️ Мои букеты') {
      return buildMyBouquetsMenu(bot, chatId, shopId);
    }

    if (text === '🔗 Витрина') {
      const link = SITE_URL + '/shop/' + shopId;
      let t = '🔗 <b>Ссылка на вашу витрину:</b>\n\n' + link + '\n\nОтправляйте клиентам.';
      return bot.sendMessage(chatId, t, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
    }

    if (text === '⚙️ Настройки' || text === '⚙️ Меню') {
      await sendNav(bot, chatId, '⚙️ Настройки магазина:', getSettingsMenu(shop, chatId));
      const { getOwnerOnboardingState } = require('./db-actions');
      const ownerState = await getOwnerOnboardingState(shopId);
      if (ownerState && !ownerState.passed && ownerState.step === 'settings_tour') {
        setTimeout(function() { advanceOwnerOnboarding(bot, chatId, shopId); }, 1500);
      }
      return;
    }

    if (text === '✅ Я сегодня работаю') {
      await setUserOnShift(chatId, shopId, true);
      const updated = await getShopFromDb(shopId);
      let t = '✅ Отлично! Вы <b>на смене</b>.\n\nТеперь уведомления будут приходить вам.';
      await bot.sendMessage(chatId, t, { parse_mode: 'HTML', reply_markup: getMainKeyboard(updated, chatId) });
      await advanceOnboardingAfter(bot, chatId, shopId, 'on_shift');
      return;
    }

    if (text === '🚪 Закончить работу') {
      await setUserOnShift(chatId, shopId, false);
      const updated = await getShopFromDb(shopId);
      let t = '👋 Хорошего отдыха!\n\nУведомления больше не приходят.';
      return bot.sendMessage(chatId, t, { reply_markup: getMainKeyboard(updated, chatId) });
    }

    if (text === '🔄 Обновить') {
      delete awaitingPrice[chatId];
      delete awaitingName[chatId];
      delete awaitingMarkup[chatId];
      delete awaitingInput[chatId];
      delete awaitingUpload[chatId];
      delete awaitingSearch[chatId];
      delete archiveSessions[chatId];
      delete registrationState[chatId];
      const updated = await getShopFromDb(shopId);
      return bot.sendMessage(chatId, '🔄 <b>Обновлено</b>\n\nВернулись в главное меню.', { parse_mode: 'HTML', reply_markup: getMainKeyboard(updated, chatId) });
    }
  });

  // ====== PHOTO ======
  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const shopId = userToShop[chatId] || await findUserShop(chatId);
    if (!shopId) return bot.sendMessage(chatId, '❌ /start');
    
    const shop = await getShopFromDb(shopId);
    if (!shop) return;
    if (shop.blocked) return bot.sendMessage(chatId, '🚫 Магазин заблокирован.');

    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;

    if (awaitingUpload[chatId]) {
      const which = awaitingUpload[chatId];
      if (which === 'logo' || which === 'background' || which === 'cover') {
        bot.sendMessage(chatId, '⏳ Загружаю фото...').catch(function(){});
        const result = await savePhotoToStorage(fileId, shopId);
        if (!validatePhotoSaved(result)) {
          delete awaitingUpload[chatId];
          return bot.sendMessage(chatId, '❌ Фото не удалось сохранить.');
        }
        shop.settings[which] = result;
        await saveShopSettings(shopId, shop.settings);
        delete awaitingUpload[chatId];
        
        let label = which === 'logo' ? 'Логотип' : (which === 'background' ? 'Фон' : 'Обложка');
        return bot.sendMessage(chatId, '✅ ' + label + ' установлен!', { reply_markup: getMainKeyboard(shop, chatId) });
      }
    }

    if (!isSubscriptionActive(shop)) return bot.sendMessage(chatId, '❌ Подписка истекла.');

    const caption = (msg.caption || '').trim();

    if (caption) {
      const { parseCaption, buildParseErrorText, computeAllTags } = require('./config');
      const parsed = parseCaption(caption);
      if (!parsed.ok) {
        return bot.sendMessage(chatId, buildParseErrorText(parsed, caption), { parse_mode: 'HTML' });
      }

      const finalName = parsed.name;
      const price = parsed.price;
      const tags = computeAllTags(finalName, caption);

      bot.sendMessage(chatId, '⏳ Загружаю фото...').catch(function(){});
      const result = await savePhotoToStorage(fileId, shopId);

      if (!validatePhotoSaved(result)) {
        return bot.sendMessage(chatId, '❌ Фото не удалось сохранить.');
      }

      const addResult = await addBouquetToDb(shopId, {
        name: finalName, price: price, description: null,
        photos: [result], isPinned: finalName.startsWith('.'),
        chatId, clicks: 0, tags
      });
      lastBouquetByUser[chatId] = addResult.id;

      let reply = '✅ Букет <b>№' + addResult.shopNumber + '</b> «' + esc(finalName) + '» добавлен! ';
      reply += formatPrice(price, shop);
      if (tags.length > 0) reply += '\n🏷 Теги: ' + tags.map(t => '#' + t).join(' ');
      reply += '\n\n💡 Ещё фото? Отправьте без подписи.';
      
      await bot.sendMessage(chatId, reply, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
      await advanceOnboardingAfter(bot, chatId, shopId, 'add_bouquet');
      return;
    }

    const lastId = lastBouquetByUser[chatId];
    if (!lastId) {
      return bot.sendMessage(chatId, '❌ Отправьте фото с подписью.\n\n' + ADD_BOUQUET_HINT, { parse_mode: 'HTML' });
    }
    
    const b = await getBouquetById(shopId, lastId);
    if (!b) return bot.sendMessage(chatId, '❌ Букет не найден.');

    bot.sendMessage(chatId, '⏳ Загружаю фото...').catch(function(){});
    const result = await savePhotoToStorage(fileId, shopId);
    if (!validatePhotoSaved(result)) return bot.sendMessage(chatId, '❌ Фото не удалось сохранить.');

    const photos = b.photos || [];
    photos.push(result);
    await updateBouquetField(lastId, 'photos', JSON.stringify(photos));
    
    return bot.sendMessage(chatId, '📸 Фото добавлено. Всего: ' + photos.length, { reply_markup: getMainKeyboard(shop, chatId) });
  });

  // Вторая регистрация (догоняющая)
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    
    const state = registrationState[chatId];
    if (!state) return;

    if (!state.userName && msg.from && msg.from.first_name) state.userName = msg.from.first_name;
    if (!state.userUsername && msg.from && msg.from.username) state.userUsername = msg.from.username;

    const cfg = REG_STEPS[state.step];
    if (!cfg) { delete registrationState[chatId]; return; }

    if (state.step === 'country') {
      return bot.sendMessage(chatId, 'Пожалуйста, выберите страну кнопкой ниже.');
    }

    if (text.trim().toLowerCase() === 'нет' && !cfg.mandatory) {
      return regSkipCurrentStep(bot, chatId, state);
    }
    return regSaveValue(bot, chatId, state, text);
  });

  // ====== CALLBACK QUERY ======
  bot.on('callback_query', async (q) => {
    const chatId = q.from.id;
    const data = q.data;
    
    bot.answerCallbackQuery(q.id).catch(function(){});

    const { CHECK_SESSION_TTL } = require('./bot-ui');
    if (checkSessions[chatId]) {
      checkSessions[chatId].lastActivity = Date.now();
    }

    if (data === 'welcome_create') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return startRegistration(bot, chatId, q.from.first_name, q.from.username);
    }

    if (data === 'reg_skip') {
      const state = registrationState[chatId];
      if (!state) {
        bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
        return;
      }
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return regSkipCurrentStep(bot, chatId, state);
    }

    if (data.startsWith('reg_country_')) {
      const code = data.replace('reg_country_', '');
      const state = registrationState[chatId];
      if (!state) {
        bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
        return;
      }
      state.data.country = code;
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return regGoToNextStep(bot, chatId, state);
    }

    if (data === 'visual_later') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return;
    }

    // ========== HELP ==========
    if (data === 'help_menu' || data === 'help_back') {
      const menu = buildHelpMenu();
      try {
        await bot.editMessageText(menu.text, {
          chat_id: chatId, message_id: q.message.message_id,
          ...menu.options
        });
      } catch (e) { /* ignore */ }
      return;
    }
    if (data === 'help_close') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return;
    }
    if (data === 'help_guide') {
      const g = buildHelpGuide();
      try {
        await bot.editMessageText(g.text, {
          chat_id: chatId, message_id: q.message.message_id, ...g.options
        });
      } catch (e) { /* ignore */ }
      return;
    }
    if (data === 'help_faq') {
      const f = buildHelpFAQ();
      try {
        await bot.editMessageText(f.text, {
          chat_id: chatId, message_id: q.message.message_id, ...f.options
        });
      } catch (e) { /* ignore */ }
      return;
    }
    if (data === 'help_support') {
      const s = buildHelpSupport();
      try {
        await bot.editMessageText(s.text, {
          chat_id: chatId, message_id: q.message.message_id, ...s.options
        });
      } catch (e) { /* ignore */ }
      return;
    }
    if (data.startsWith('faq_')) {
      const ans = buildFaqAnswer(data);
      if (!ans) return;
      try {
        await bot.editMessageText(ans.text, {
          chat_id: chatId, message_id: q.message.message_id, ...ans.options
        });
      } catch (e) { /* ignore */ }
      return;
    }

    // ========== АДМИН-ПАНЕЛЬ ==========
    if (data.startsWith('admin_') && isServiceAdmin(chatId)) {
      const admin = require('./bot-admin');
      if (data === 'admin_main' || data === 'admin_refresh') {
        return admin.showAdminPanel(bot, chatId, q.message.message_id);
      }
      if (data.startsWith('admin_shops_')) {
        const page = parseInt(data.replace('admin_shops_', '')) || 0;
        return admin.showAdminShopsList(bot, chatId, page, q.message.message_id);
      }
      if (data.startsWith('admin_shop_')) {
        const targetShopId = data.replace('admin_shop_', '');
        return admin.showAdminShopCard(bot, chatId, targetShopId, q.message.message_id);
      }
      if (data.startsWith('admin_extend_')) {
        const rest = data.replace('admin_extend_', '');
        const firstUnderscore = rest.indexOf('_');
        const days = parseInt(rest.slice(0, firstUnderscore));
        const targetShopId = rest.slice(firstUnderscore + 1);
        if (!days || !targetShopId) return;
        await extendShopTrial(targetShopId, days);
        await bot.answerCallbackQuery(q.id, { text: '✅ Продлено на ' + days + ' дней' }).catch(function(){});
        return admin.showAdminShopCard(bot, chatId, targetShopId, q.message.message_id);
      }
      if (data.startsWith('admin_msg_')) {
        const targetShopId = data.replace('admin_msg_', '');
        const targetShop = await getShopFromDb(targetShopId);
        if (!targetShop) return;
        const targetOwner = targetShop.admins.find(a => a.role === 'owner');
        if (!targetOwner) return bot.sendMessage(chatId, '❌ У этого магазина нет владельца.');
        
        awaitingAdminMessage[chatId] = {
          targetChatId: targetOwner.chatId,
          targetName: targetOwner.name || 'Флорист',
          shopId: targetShopId
        };
        let askTxt = '💬 Напишите сообщение для <b>' + esc(targetOwner.name || 'Флориста') + '</b>.\n\n<i>Отмена — /cancel</i>';
        return bot.sendMessage(chatId, askTxt, { parse_mode: 'HTML' });
      }
      if (data.startsWith('admin_block_')) {
        const targetShopId = data.replace('admin_block_', '');
        awaitingAdminBlockReason[chatId] = { shopId: targetShopId };
        let bTxt = '🚫 <b>Блокировка магазина</b>\n\nНапишите <b>причину блокировки</b>.\n\n<i>Отмена — /cancel</i>';
        return bot.sendMessage(chatId, bTxt, { parse_mode: 'HTML' });
      }
      if (data.startsWith('admin_unblock_')) {
        const targetShopId = data.replace('admin_unblock_', '');
        await unblockShop(targetShopId);
        const shop = await getShopFromDb(targetShopId);
        const owner = shop.admins.find(a => a.role === 'owner');
        if (owner) {
          bot.sendMessage(owner.chatId, '✅ <b>Магазин разблокирован</b>\n\n«' + esc(shop.displayName) + '» снова работает.', { parse_mode: 'HTML' }).catch(function(){});
        }
        return admin.showAdminShopCard(bot, chatId, targetShopId, q.message.message_id);
      }
    }

    // ========== КОНТЕКСТ МАГАЗИНА ==========
    const shopId = userToShop[chatId] || await findUserShop(chatId);
    if (!shopId) return;
    const shop = await getShopFromDb(shopId);
    if (!shop) return;
    const owner = isOwner(shop, chatId);

    // ========== ОНБОРДИНГ ==========
    if (data === 'onb_next') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      const ownerState = await getOwnerOnboardingState(shopId);
      if (ownerState && !ownerState.passed && ownerState.step && ownerState.step !== 'done') {
        return advanceOwnerOnboarding(bot, chatId, shopId);
      }
      const floristState = await getFloristOnboardingState(chatId, shopId);
      if (floristState && !floristState.passed && floristState.step && floristState.step !== 'done') {
        return advanceFloristOnboarding(bot, chatId, shopId);
      }
      return;
    }

    if (data === 'onb_skip') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      const ownerState = await getOwnerOnboardingState(shopId);
      if (ownerState && !ownerState.passed) {
        if (isOwner(shop, chatId)) return setOwnerOnboardingPassed(shopId);
      }
      const floristState = await getFloristOnboardingState(chatId, shopId);
      if (floristState && !floristState.passed) {
        return setFloristOnboardingPassed(chatId, shopId);
      }
      return;
    }

    if (data === 'onb_finish') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      await setOwnerOnboardingPassed(shopId);
      return bot.sendMessage(chatId, '👇 Возвращаемся в меню.', { reply_markup: getMainKeyboard(shop, chatId) });
    }

    // ========== МОИ БУКЕТЫ ==========
    if (data === 'mb_close') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return bot.sendMessage(chatId, '🏠 Главное меню', { reply_markup: getMainKeyboard(shop, chatId) });
    }
    
    if (data === 'mb_back') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return buildMyBouquetsMenu(bot, chatId, shopId);
    }
    
    if (data === 'mb_search') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      awaitingSearch[chatId] = true;
      return buildSearchPrompt(bot, chatId);
    }
    
    if (data === 'mb_archive') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return buildArchiveModeSelection(bot, chatId, shopId);
    }
    
    if (data.startsWith('mb_active_')) {
      const page = parseInt(data.replace('mb_active_', '')) || 0;
      const { showActiveBouquetsList } = require('./bot-ui');
      return showActiveBouquetsList(bot, chatId, shopId, page, q.message.message_id);
    }

    // ========== РЕЗУЛЬТАТЫ ПОИСКА ==========
    if (data === 'sres_restore_all') {
      const session = searchSessions[chatId];
      if (!session) {
        bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
        return sendNav(bot, chatId, '⚠️ Поиск устарел.');
      }
      const hidden = session.results.filter(b => b.hidden || !isConfirmedRecently(b));
      if (hidden.length === 0) {
        return bot.answerCallbackQuery(q.id, { text: 'Уже всё на витрине' }).catch(function(){});
      }
      const nowIso = new Date().toISOString();
      for (const b of hidden) {
        await updateBouquetFields(b.id, { hidden: false, confirmed_at: nowIso, reminded: false });
      }
      for (const b of session.results) {
        b.hidden = false; b.confirmedAt = nowIso; b.reminded = false;
      }
      await bot.answerCallbackQuery(q.id, { text: '✅ Вернули ' + hidden.length + ' шт.' }).catch(function(){});
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      const { renderSearchResults } = require('./bot-ui');
      return renderSearchResults(bot, chatId, shopId, session.query, session.results);
    }

    if (data.startsWith('sres_')) {
      const id = parseInt(data.replace('sres_', ''));
      if (!id || isNaN(id)) return;
      const b = await getBouquetById(shopId, id);
      if (!b) return sendNav(bot, chatId, '❌ Букет не найден.');
      const { showBouquetCard } = require('./bot-ui');
      return showBouquetCard(bot, chatId, b, shopId);
    }

    // ========== СКАЧАТЬ ФОТО ==========
    if (data.startsWith('dlphoto_')) {
      const id = parseInt(data.replace('dlphoto_', ''));
      if (!id || isNaN(id)) return;
      const b = await getBouquetById(shopId, id);
      if (!b) return sendNav(bot, chatId, '❌ Букет не найден.');
      const { sendBouquetPhotoAsFile } = require('./photo-utils');
      return sendBouquetPhotoAsFile(bot, chatId, b);
    }

    // ========== УБРАТЬ / ВЕРНУТЬ ==========
    if (data.startsWith('hideit_')) {
      const id = parseInt(data.replace('hideit_', ''));
      if (!id || isNaN(id)) return;
      const b = await getBouquetById(shopId, id);
      if (!b) return sendNav(bot, chatId, '❌ Букет не найден.');
      
      await updateBouquetField(id, 'hidden', true);
      let t = '📥 Букет <b>№' + b.shopNumber + '</b> «' + esc(b.name) + '» убран с витрины.\n\n<i>Вернуть можно из «📦 Архив».</i>';
      return bot.sendMessage(chatId, t, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
    }

    if (data.startsWith('unhide_')) {
      const id = parseInt(data.replace('unhide_', ''));
      if (!id || isNaN(id)) return;
      const b = await getBouquetById(shopId, id);
      if (!b) return sendNav(bot, chatId, '❌ Букет не найден.');
      
      await updateBouquetFields(id, { hidden: false, confirmed_at: new Date().toISOString(), reminded: false });
      let t = '✅ Букет <b>№' + b.shopNumber + '</b> «' + esc(b.name) + '» снова на витрине.\n\n<i>Обновлён на 3 дня вперёд.</i>';
      return bot.sendMessage(chatId, t, { parse_mode: 'HTML', reply_markup: getMainKeyboard(shop, chatId) });
    }

    // ========== АРХИВ ==========
    const { showArchiveList, showArchiveItemCard, showArchiveCard } = require('./bot-ui');
    if (data === 'arch_mode_list') {
      const arch = await getArchivedBouquets(shopId);
      if (arch.length === 0) {
        bot.editMessageText('📦 Архив пуст.', { chat_id: chatId, message_id: q.message.message_id }).catch(function(){});
        return;
      }
      archiveSessions[chatId] = { mode: 'list', bouquets: arch, page: 0, shopId, keyboardHidden: false };
      const sess = archiveSessions[chatId];
      if (!sess.keyboardHidden) {
        sess.keyboardHidden = true;
        bot.sendMessage(chatId, '📦 <i>Открываю архив — меню вернётся после закрытия.</i>', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }).catch(function(){});
      }
      return showArchiveList(bot, chatId, sess, q.message.message_id);
    }

    if (data === 'arch_mode_card') {
      const arch = await getArchivedBouquets(shopId);
      if (arch.length === 0) {
        bot.editMessageText('📦 Архив пуст.', { chat_id: chatId, message_id: q.message.message_id }).catch(function(){});
        return;
      }
      archiveSessions[chatId] = { mode: 'card', bouquets: arch, currentIndex: 0, shopId, keyboardHidden: false };
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return showArchiveCard(bot, chatId, archiveSessions[chatId]);
    }

    if (data.startsWith('arch_list_page_')) {
      const session = archiveSessions[chatId];
      if (!session || session.mode !== 'list') {
        bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
        return;
      }
      session.page = parseInt(data.replace('arch_list_page_', '')) || 0;
      return showArchiveList(bot, chatId, session, q.message.message_id);
    }

    if (data.startsWith('arch_item_')) {
      const session = archiveSessions[chatId];
      if (!session || session.mode !== 'list') {
        bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
        return;
      }
      const itemId = parseInt(data.replace('arch_item_', ''));
      if (!itemId || isNaN(itemId)) return;
      return showArchiveItemCard(bot, chatId, session, itemId);
    }

    if (data === 'arch_list_back') {
      const session = archiveSessions[chatId];
      if (!session || session.mode !== 'list') return;
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return showArchiveList(bot, chatId, session);
    }

    if (data.startsWith('arch_del_')) {
      if (!owner) return;
      const id = parseInt(data.replace('arch_del_', ''));
      if (!id || isNaN(id)) return;
      const b = await getBouquetById(shopId, id);
      if (!b) return sendNav(bot, chatId, '❌ Букет не найден.');
      
      const session = archiveSessions[chatId];
      if (session) session.bouquets = session.bouquets.filter(x => x.id !== id);
      
      await updateBouquetField(id, 'deleted', true);
      bot.answerCallbackQuery(q.id, { text: '🗑 Удалён: №' + b.shopNumber }).catch(function(){});
      
      if (session && session.mode === 'list') {
        bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
        if (session.bouquets.length === 0) {
          delete archiveSessions[chatId];
          return bot.sendMessage(chatId, '📦 Архив пуст.', { reply_markup: getMainKeyboard(shop, chatId) });
        }
        const totalPages = Math.max(1, Math.ceil(session.bouquets.length / LIST_PER_PAGE));
        if (session.page >= totalPages) session.page = totalPages - 1;
        return showArchiveList(bot, chatId, session);
      }
      
      if (session && session.mode === 'card') {
        bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
        if (session.bouquets.length === 0) {
          delete archiveSessions[chatId];
          return bot.sendMessage(chatId, '📦 Архив пуст.', { reply_markup: getMainKeyboard(shop, chatId) });
        }
        if (session.currentIndex >= session.bouquets.length) {
          session.currentIndex = session.bouquets.length - 1;
        }
        return showArchiveCard(bot, chatId, session);
      }
      return;
    }

    if (data.startsWith('arch_restore_')) {
      const session = archiveSessions[chatId];
      const itemId = parseInt(data.replace('arch_restore_', ''));
      const b = session ? session.bouquets.find(x => x.id === itemId) : null;
      
      if (b) {
        await updateBouquetFields(b.id, { confirmed_at: new Date().toISOString(), hidden: false, reminded: false });
        session.bouquets = session.bouquets.filter(x => x.id !== itemId);
      }
      
      if (session && session.mode === 'list') {
        bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
        if (session.bouquets.length === 0) {
          delete archiveSessions[chatId];
          return bot.sendMessage(chatId, '📦 Архив пуст.', { reply_markup: getMainKeyboard(shop, chatId) });
        }
        const totalPages = Math.max(1, Math.ceil(session.bouquets.length / LIST_PER_PAGE));
        if (session.page >= totalPages) session.page = totalPages - 1;
        return showArchiveList(bot, chatId, session);
      }
      
      if (session && session.mode === 'card') {
        session.currentIndex++;
        bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
        return showArchiveCard(bot, chatId, session);
      }
      return;
    }

    if (data === 'arch_next') {
      const session = archiveSessions[chatId];
      if (!session || session.mode !== 'card') {
        bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
        return;
      }
      session.currentIndex++;
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return showArchiveCard(bot, chatId, session);
    }

    if (data === 'arch_close') {
      delete archiveSessions[chatId];
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return bot.sendMessage(chatId, '📦 Архив закрыт.', { reply_markup: getMainKeyboard(shop, chatId) });
    }

    // ========== ПАГИНАЦИЯ СПИСКОВ ==========
    if (data === 'bqlist_close') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return bot.sendMessage(chatId, '🏠 Главное меню', { reply_markup: getMainKeyboard(shop, chatId) });
    }
    
    if (data.startsWith('bqlist_')) {
      const rest = data.replace('bqlist_', '');
      const lastUnderscore = rest.lastIndexOf('_');
      const action = rest.slice(0, lastUnderscore);
      const page = parseInt(rest.slice(lastUnderscore + 1)) || 0;
      
      const headers = {
        editprice: '✏️ <b>Какой букет изменить цену?</b>\nНажмите на кнопку с номером.',
        rename: '📝 <b>Какой букет переименовать?</b>\nНажмите на кнопку с номером.',
        askdel: '🗑 <b>Какой букет удалить?</b>\nНажмите на кнопку с номером.'
      };
      
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      const { showBouquetList } = require('./bot-ui');
      return showBouquetList(bot, chatId, shopId, action, headers[action] || '', page);
    }

    // ========== МЕНЮ / НАСТРОЙКИ ==========
    if (data === 'noop') return;
    if (data === 'menu_close') {
      delete checkSessions[chatId];
      delete archiveSessions[chatId];
      delete searchSessions[chatId];
      bot.deleteMessage(chatId, q.message.message_id)
        .catch(function(){});
      return;
    }
    
    if (data === 'menu_back') {
      if (!owner) return;
      delete archiveSessions[chatId];
      try {
        await bot.editMessageText('⚙️ Настройки магазина:', {
          chat_id: chatId,
          message_id: q.message.message_id,
          ...getSettingsMenu(shop, chatId)
        });
      } catch (e) { /* ignore */ }
      return;
    }
    
    if (data === 'menu_shopdata') {
      if (!owner) return;
      const { text, options } = buildShopDataMessage(shop);
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: q.message.message_id,
          ...options
        });
      } catch (e) { /* ignore */ }
      return;
    }
    
    if (data.startsWith('edit_shop_')) {
      if (!owner) return;
      const field = data.replace('edit_shop_', '');
      const prompts = {
        displayname: {
          q: '📝 Введите новое <b>название</b>.\nПример: <i>Цветы на Фрунзе</i>',
          field: 'display_name'
        },
        address: {
          q: '📍 Введите новый <b>адрес</b>.\nПример: <i>г. Москва, ул. Фрунзе, 15</i>\n(или "нет", чтобы убрать)',
          field: 'address'
        },
        hours: {
          q: '🕐 Введите новые <b>часы работы</b>.\nПример: <i>Пн-Вс 10:30-21:00</i>\n(или "нет", чтобы убрать)',
          field: 'hours'
        },
        phone: {
          q: '📞 Введите новый <b>телефон</b>.\nПример: <i>+7 962 402-51-75</i>\n(или "нет", чтобы убрать)',
          field: 'phone'
        },
        telegram: {
          q: '📱 Введите <b>Telegram-юзернейм</b> (без @).\nПример: <i>KupidonAdm</i>\n(или "нет", чтобы убрать)',
          field: 'telegram_username'
        },
        whatsapp: {
          q: '💬 Введите <b>номер WhatsApp</b>.\nПример: <i>+7 962 402-51-75</i>\n(или "нет", чтобы убрать)',
          field: 'whatsapp_phone'
        },
        max: {
          q: '🅼 <b>Ссылка на профиль в MAX</b>\n\nНачинается с <code>https://max.ru/u/...</code>\n(или "нет", чтобы убрать)',
          field: 'max_username'
        }
      };
      const p = prompts[field];
      if (!p) return;
      awaitingInput[chatId] = { field: p.field, from: 'shopdata' };
      return bot.sendMessage(chatId, p.q + '\n\n<i>Отмена — /cancel</i>', {
        parse_mode: 'HTML'
      });
    }

    // ========== ВАЛЮТА ==========
    const {
      getShopCurrency, findCurrencyByCode, CURRENCY_LIST
    } = require('./config');

    if (data === 'menu_currency') {
      if (!owner) return;
      const curCode = getShopCurrency(shop);
      const curObj = findCurrencyByCode(curCode);
      
      let txt = '💱 <b>Валюта магазина</b>\n\n';
      txt += 'Сейчас: <b>';
      txt += curObj ? curObj.label + ' (' + curObj.sym + ')' : '₽';
      txt += '</b>\n\n';
      txt += 'Цены на витрине будут показываться с этим символом.\n\n';
      txt += '<i>Цены не пересчитываются — просто меняется символ.</i>';
      
      const rows = [];
      for (let i = 0; i < CURRENCY_LIST.length; i += 2) {
        const row = [];
        const c1 = CURRENCY_LIST[i];
        row.push({
          text: c1.sym + ' ' + c1.label,
          callback_data: 'cur_set_' + c1.code
        });
        if (i + 1 < CURRENCY_LIST.length) {
          const c2 = CURRENCY_LIST[i + 1];
          row.push({
            text: c2.sym + ' ' + c2.label,
            callback_data: 'cur_set_' + c2.code
          });
        }
        rows.push(row);
      }
      rows.push([{ text: '↩️ Назад', callback_data: 'menu_back' }]);
      
      try {
        await bot.editMessageText(txt, {
          chat_id: chatId,
          message_id: q.message.message_id,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows }
        });
      } catch (e) { /* ignore */ }
      return;
    }
    
    if (data.startsWith('cur_set_')) {
      if (!owner) return;
      const code = data.replace('cur_set_', '');
      const cur = findCurrencyByCode(code);
      if (!cur) return;
      
      shop.settings.currency = code;
      await saveShopSettings(shopId, shop.settings);
      
      let txt = '✅ Валюта обновлена!\n\n';
      txt += cur.sym + ' ' + cur.label + '\n\n';
      txt += 'Цены на витрине теперь с этим символом.';
      
      try {
        await bot.editMessageText(txt, {
          chat_id: chatId,
          message_id: q.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Готово', callback_data: 'menu_close' }]]
          }
        });
      } catch (e) { /* ignore */ }
      return;
    }

    // ========== КОМАНДА ==========
    if (data === 'menu_invite') {
      if (!owner) return;
      const link = 'https://t.me/' + BOT_USERNAME + 
        '?start=inv_' + shop.inviteCode;
      return bot.sendMessage(chatId,
        '🔑 Ссылка-приглашение:\n\n' + link +
        '\n\nОтправьте её флористу — он кликнет ' +
        'и сразу попадёт в вашу команду.'
      );
    }
    
    if (data === 'menu_team') {
      if (!owner) return;
      const others = shop.admins.filter(a => a.chatId !== chatId);
      
      if (others.length === 0) {
        return bot.sendMessage(chatId,
          '👥 <b>Команда магазина</b>\n\nПока только вы.',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]]
            }
          }
        );
      }
      
      const keyboard = others.map(a => {
        const dot = a.onShift ? '🟢' : '⚪';
        return [{
          text: dot + ' ' + (a.name || 'Флорист'),
          callback_data: 'team_user_' + a.chatId
        }];
      });
      keyboard.push([{ text: '↩️ Назад', callback_data: 'menu_back' }]);
      
      return bot.sendMessage(chatId,
        '👥 <b>Команда магазина</b> (' + others.length + ')',
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        }
      );
    }
    
    if (data.startsWith('team_user_')) {
      if (!owner) return;
      const targetChatId = parseInt(data.split('_')[2]);
      const target = shop.admins.find(a => a.chatId === targetChatId);
      if (!target) return;
      
      const statusText = target.onShift ? '🟢 На смене' : '⚪ Выходной';
      let info = '🌸 <b>';
      info += esc(target.name || 'Флорист') + '</b>\n\n';
      info += 'Статус: ' + statusText + '\n';
      info += 'Присоединился: ';
      info += new Date(target.joinedAt).toLocaleDateString();
      
      return bot.sendMessage(chatId, info, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{
              text: '🗑 Удалить доступ',
              callback_data: 'kick_' + targetChatId
            }],
            [{ text: '↩️ Назад', callback_data: 'menu_team' }]
          ]
        }
      });
    }
    
    if (data.startsWith('kick_')) {
      if (!owner) return;
      const targetChatId = parseInt(data.split('_')[1]);
      return bot.sendMessage(chatId, '⚠️ Удалить доступ?', {
        reply_markup: {
          inline_keyboard: [
            [{
              text: '🗑 Да',
              callback_data: 'confirmkick_' + targetChatId
            }],
            [{ text: '↩️ Отмена', callback_data: 'menu_team' }]
          ]
        }
      });
    }
    
    if (data.startsWith('confirmkick_')) {
      if (!owner) return;
      const targetChatId = parseInt(data.split('_')[1]);
      const target = shop.admins.find(a => a.chatId === targetChatId);
      const name = target ? (target.name || 'Флорист') : 'Флорист';
      
      await removeAdminFromDb(targetChatId, shopId);
      delete userToShop[targetChatId];
      
      bot.editMessageText('✅ Доступ для «' + name + '» удалён.', {
        chat_id: chatId,
        message_id: q.message.message_id
      }).catch(function(){});
      
      bot.sendMessage(targetChatId,
        '🚫 Ваш доступ к витрине «' + shop.displayName + '» удалён.'
      ).catch(function(){});
      return;
    }

    // ========== СТАТИСТИКА ==========
    const { normalizeName } = require('./config');

    if (data === 'menu_stats') {
      if (!owner) return;
      const all = await getBouquetsFromDb(shopId, true);
      const clickMap = {};
      
      for (const b of all) {
        const key = normalizeName(b.name);
        if (!key) continue;
        if (!clickMap[key]) {
          clickMap[key] = { name: b.name, clicks: 0, hasActive: false };
        }
        clickMap[key].clicks += (b.clicks || 0);
        if (!b.deleted) {
          clickMap[key].name = b.name;
          clickMap[key].hasActive = true;
        }
      }
      
      const top = Object.values(clickMap)
        .filter(x => x.clicks > 0)
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 5);
        
      const stats = shop.stats;
      const orders = stats.orders || 0;
      const calls = stats.calls || 0;
      const total = orders + calls;
      
      let txt = '📊 <b>Статистика</b>\n\n';
      txt += '📩 Хотели написать: <b>' + orders + '</b>\n';
      txt += '📞 Хотели позвонить: <b>' + calls + '</b>\n';
      txt += '📈 Всего заявок: <b>' + total + '</b>\n';
      txt += '\n<i>Здесь только реальные клики клиентов.</i>\n';
      
      if (top.length > 0) {
        txt += '\n🔥 <b>Топ-5 по заявкам:</b>\n';
        for (let i = 0; i < top.length; i++) {
          const x = top[i];
          const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
          const mark = x.hasActive ? '' : ' (архив)';
          txt += medal + ' ' + esc(x.name) + ' — ';
          txt += x.clicks + mark + '\n';
        }
      } else {
        txt += '\n<i>Пока ни одной заявки. Поделитесь ссылкой!</i>';
      }
      
      return bot.sendMessage(chatId, txt, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]]
        }
      });
    }

    // ========== НАЦЕНКА ==========
    if (data === 'menu_markup') {
      if (!owner) return;
      const current = shop.settings.markupPercent || 0;
      let txt = '💰 <b>Наценка</b>\n\nСейчас: <b>';
      txt += current + '%</b>\n\n';
      if (current === 0) {
        txt += 'При 0% витрина показывает одну цену.';
      } else {
        txt += 'Пример: 1000 → <s>';
        txt += calculateOldPrice(1000, current) + '</s> <b>1000</b>';
      }
      
      return bot.sendMessage(chatId, txt, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '0%', callback_data: 'markup_set_0' },
              { text: '10%', callback_data: 'markup_set_10' },
              { text: '15%', callback_data: 'markup_set_15' }
            ],
            [
              { text: '20%', callback_data: 'markup_set_20' },
              { text: '30%', callback_data: 'markup_set_30' },
              { text: '50%', callback_data: 'markup_set_50' }
            ],
            [{ text: '✏️ Своё', callback_data: 'markup_custom' }],
            [{ text: '↩️ Назад', callback_data: 'menu_back' }]
          ]
        }
      });
    }
    
    if (data.startsWith('markup_set_')) {
      if (!owner) return;
      const percent = parseInt(data.replace('markup_set_', ''));
      shop.settings.markupPercent = percent;
      await saveShopSettings(shopId, shop.settings);
      
      bot.editMessageText('✅ <b>Наценка: ' + percent + '%</b>', {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]]
        }
      }).catch(function(){});
      return;
    }
    
    if (data === 'markup_custom') {
      if (!owner) return;
      awaitingMarkup[chatId] = true;
      return bot.sendMessage(chatId,
        '💰 Напишите процент числом (0–200).\n<i>Отмена — /cancel</i>',
        {
          parse_mode: 'HTML',
          reply_markup: getMainKeyboard(shop, chatId)
        }
      );
    }

    // ========== СТАТУС ==========
    if (data === 'menu_status') {
      const active = (await getBouquetsFromDb(shopId)).length;
      const days = getRemainingDays(shop);
      const myRole = owner ? '👑 Владелец' : '🌸 Флорист';
      const me = shop.admins.find(a => a.chatId === chatId);
      const myShift = me && me.onShift ? '🟢 На смене' : '⚪ Не на смене';
      
      let txt = '📋 <b>' + esc(shop.displayName) + '</b>\n\n';
      txt += '👤 ' + myRole + ' · ' + myShift + '\n';
      txt += '👥 Команда: ' + shop.admins.length + '\n';
      txt += '📦 Букетов: ' + active + '\n';
      txt += '💰 Наценка: ' + shop.settings.markupPercent + '%\n';
      txt += '📅 Триал: ' + days + ' дней';
      
      const kb = owner
        ? { inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]] }
        : { inline_keyboard: [[{ text: '❌ Закрыть', callback_data: 'menu_close' }]] };
        
      return bot.sendMessage(chatId, txt, {
        parse_mode: 'HTML',
        reply_markup: kb
      });
    }
    
    if (data === 'menu_renew') {
      return bot.sendMessage(chatId, '💳 Продление: @floop10', {
        reply_markup: {
          inline_keyboard: [[{ text: '↩️ Назад', callback_data: 'menu_back' }]]
        }
      });
    }

    // ========== ВИЗУАЛ ==========
    const {
      findColorById, findPresetById, 
      isPresetBackground, hasAnyBackground, hasAnyLogo
    } = require('./storefront');

    if (data === 'menu_logo') {
      if (!owner) return;
      const cur = shop.settings.logo ? '🎨 Логотип установлен.' : '🎨 Логотип не установлен.';
      return bot.sendMessage(chatId, cur, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📷 Загрузить', callback_data: 'setlogo_now' }],
            [{ text: '🗑 Убрать', callback_data: 'resetlogo_now' }],
            [{ text: '↩️ Назад', callback_data: 'menu_back' }]
          ]
        }
      });
    }
    
    if (data === 'menu_cover') {
      if (!owner) return;
      const cur = shop.settings.cover ? '🖼 Обложка установлена.' : '🖼 Обложка не установлена.';
      return bot.sendMessage(chatId, cur, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📷 Загрузить', callback_data: 'setcover_now' }],
            [{ text: '🗑 Убрать', callback_data: 'resetcover_now' }],
            [{ text: '↩️ Назад', callback_data: 'menu_back' }]
          ]
        }
      });
    }
    
    if (data === 'setcover_now') {
      if (!owner) return;
      awaitingUpload[chatId] = 'cover';
      return bot.sendMessage(chatId,
        '📷 Отправьте картинку для обложки.\n\n' +
        '<i>Рекомендуем горизонтальное фото. Ширина от 800 px.</i>',
        { parse_mode: 'HTML' }
      );
    }
    
    if (data === 'resetcover_now') {
      if (!owner) return;
      shop.settings.cover = null;
      await saveShopSettings(shopId, shop.settings);
      bot.editMessageText('✅ Обложка убрана.', {
        chat_id: chatId,
        message_id: q.message.message_id
      }).catch(function(){});
      return;
    }
    
    if (data === 'menu_background') {
      if (!owner) return;
      let curText = '🖼 Фон не установлен.';
      
      if (isPresetBackground(shop.settings.background)) {
        const p = findPresetById(shop.settings.background.id);
        if (p) curText = '🖼 Сейчас: ' + p.emoji + ' ' + p.name;
      } else if (hasAnyBackground(shop)) {
        curText = '🖼 Свой фон установлен.';
      }
      
      return bot.sendMessage(chatId, curText, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎨 Выбрать из готовых', callback_data: 'bg_presets' }],
            [{ text: '📷 Загрузить свой', callback_data: 'setbg_now' }],
            [{ text: '🗑 Убрать фон', callback_data: 'resetbg_now' }],
            [{ text: '↩️ Назад', callback_data: 'menu_back' }]
          ]
        }
      });
    }
    
    if (data === 'bg_presets') {
      if (!owner) return;
      let txt = '🎨 <b>Готовые фоны</b>\n\nТапните на номер — увидите превью.';
      const { PRESET_BACKGROUNDS } = require('./storefront');
      const rows = [];
      
      for (let i = 0; i < PRESET_BACKGROUNDS.length; i += 2) {
        const row = [];
        const b1 = PRESET_BACKGROUNDS[i];
        row.push({
          text: b1.emoji + ' ' + b1.id + '. ' + b1.name,
          callback_data: 'bg_view_' + b1.id
        });
        if (i + 1 < PRESET_BACKGROUNDS.length) {
          const b2 = PRESET_BACKGROUNDS[i + 1];
          row.push({
            text: b2.emoji + ' ' + b2.id + '. ' + b2.name,
            callback_data: 'bg_view_' + b2.id
          });
        }
        rows.push(row);
      }
      rows.push([{ text: '⬅️ Назад', callback_data: 'menu_background' }]);
      
      try {
        await bot.editMessageText(txt, {
          chat_id: chatId,
          message_id: q.message.message_id,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows }
        });
      } catch (e) { /* ignore */ }
      return;
    }
    
    if (data.startsWith('bg_view_')) {
      if (!owner) return;
      const pid = parseInt(data.replace('bg_view_', ''));
      const preset = findPresetById(pid);
      if (!preset) return;
      
      let txt = preset.emoji + ' <b>' + preset.name + '</b>\n\nПрименить?';
      
      try {
        await bot.editMessageText(txt, {
          chat_id: chatId,
          message_id: q.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Применить', callback_data: 'bg_apply_' + pid }],
              [{ text: '⬅️ Выбрать другой', callback_data: 'bg_presets' }]
            ]
          }
        });
      } catch (e) { /* ignore */ }
      return;
    }
    
    if (data.startsWith('bg_apply_')) {
      if (!owner) return;
      const pid = parseInt(data.replace('bg_apply_', ''));
      const preset = findPresetById(pid);
      if (!preset) return;
      
      shop.settings.background = { type: 'preset', id: pid };
      await saveShopSettings(shopId, shop.settings);
      
      let txt = '✅ Фон применён!\n\n' + preset.emoji + ' ' + preset.name;
      
      try {
        await bot.editMessageText(txt, {
          chat_id: chatId,
          message_id: q.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Готово', callback_data: 'menu_close' }]]
          }
        });
      } catch (e) { /* ignore */ }
      return;
    }
    
    if (data === 'setbg_now') {
      if (!owner) return;
      awaitingUpload[chatId] = 'background';
      return bot.sendMessage(chatId, '📷 Отправьте фото фона.');
    }
    
    if (data === 'setlogo_now') {
      if (!owner) return;
      awaitingUpload[chatId] = 'logo';
      return bot.sendMessage(chatId, '📷 Отправьте фото логотипа.');
    }
    
    if (data === 'resetlogo_now') {
      if (!owner) return;
      shop.settings.logo = null;
      await saveShopSettings(shopId, shop.settings);
      bot.editMessageText('✅ Логотип убран.', {
        chat_id: chatId,
        message_id: q.message.message_id
      }).catch(function(){});
      return;
    }
    
    if (data === 'resetbg_now') {
      if (!owner) return;
      shop.settings.background = null;
      await saveShopSettings(shopId, shop.settings);
      bot.editMessageText('✅ Фон убран.', {
        chat_id: chatId,
        message_id: q.message.message_id
      }).catch(function(){});
      return;
    }

    // ========== ЦВЕТ КНОПКИ ==========
    if (data === 'menu_buttoncolor') {
      if (!owner) return;
      const current = shop.settings.buttonColor || 'red';
      const curObj = findColorById(current) || findColorById('red');
      
      let txt = '🔘 <b>Цвет кнопки «Связаться»</b>\n\n';
      txt += 'Сейчас: ' + curObj.emoji + ' ' + curObj.name + '\n\n';
      
      const { BUTTON_COLORS } = require('./storefront');
      const rows = [];
      for (let i = 0; i < BUTTON_COLORS.length; i += 2) {
        const row = [];
        const c1 = BUTTON_COLORS[i];
        row.push({
          text: c1.emoji + ' ' + c1.name,
          callback_data: 'btncol_view_' + c1.id
        });
        if (i + 1 < BUTTON_COLORS.length) {
          const c2 = BUTTON_COLORS[i + 1];
          row.push({
            text: c2.emoji + ' ' + c2.name,
            callback_data: 'btncol_view_' + c2.id
          });
        }
        rows.push(row);
      }
      rows.push([{ text: '↩️ Назад', callback_data: 'menu_back' }]);
      
      try {
        await bot.editMessageText(txt, {
          chat_id: chatId,
          message_id: q.message.message_id,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows }
        });
      } catch (e) { /* ignore */ }
      return;
    }

    if (data.startsWith('btncol_view_')) {
      if (!owner) return;
      const cid = data.replace('btncol_view_', '');
      const col = findColorById(cid);
      if (!col) return;
      
      let txt = col.emoji + ' <b>' + col.name + '</b>\n\nПрименить?';
      
      try {
        await bot.editMessageText(txt, {
          chat_id: chatId,
          message_id: q.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Применить', callback_data: 'btncol_apply_' + cid }],
              [{ text: '⬅️ Выбрать другой', callback_data: 'menu_buttoncolor' }]
            ]
          }
        });
      } catch (e) { /* ignore */ }
      return;
    }

    if (data.startsWith('btncol_apply_')) {
      if (!owner) return;
      const cid = data.replace('btncol_apply_', '');
      const col = findColorById(cid);
      if (!col) return;
      
      shop.settings.buttonColor = cid;
      await saveShopSettings(shopId, shop.settings);
      
      let txt = '✅ Цвет обновлён!\n\n' + col.emoji + ' ' + col.name;
      
      try {
        await bot.editMessageText(txt, {
          chat_id: chatId,
          message_id: q.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '🏠 Готово', callback_data: 'menu_close' }]]
          }
        });
      } catch (e) { /* ignore */ }
      return;
    }

    // ========== ПРОВЕРКА НАЛИЧИЯ ==========
    if (data === 'check_start') {
      const bouquets = await getCheckableBouquets(shopId);
      if (bouquets.length === 0) {
        bot.editMessageText('🌿 На витрине нет букетов — проверять нечего.', {
          chat_id: chatId,
          message_id: q.message.message_id,
          parse_mode: 'HTML'
        }).catch(function(){});
        return;
      }
      
      checkSessions[chatId] = {
        shopId,
        bouquets,
        checked: {},
        order: [],
        listMessageId: q.message.message_id,
        currentPage: 0,
        lastActivity: Date.now()
      };
      
      const session = checkSessions[chatId];
      const txt = buildCheckListText(session);
      const kb = { inline_keyboard: buildCheckListKeyboard(session) };
      
      bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: kb
      }).catch(function(){});
      
      await advanceOnboardingAfter(bot, chatId, shopId, 'check_stock');
      return;
    }

    if (data === 'check_cancel') {
      delete checkSessions[chatId];
      bot.editMessageText('❌ Проверка отменена.', {
        chat_id: chatId,
        message_id: q.message.message_id
      }).catch(function(){});
      return;
    }

    if (data === 'check_finish') {
      delete checkSessions[chatId];
      try {
        await bot.editMessageText('✅ Проверка завершена.', {
          chat_id: chatId,
          message_id: q.message.message_id,
          reply_markup: getMainKeyboard(shop, chatId)
        });
      } catch (e) {
        bot.sendMessage(chatId, '✅ Проверка завершена.', {
          reply_markup: getMainKeyboard(shop, chatId)
        }).catch(function(){});
      }
      await advanceOnboardingAfter(bot, chatId, shopId, 'check_stock');
      return;
    }

    if (data.startsWith('check_page_')) {
      const session = checkSessions[chatId];
      if (!session) {
        bot.editMessageText('⚠️ Сессия истекла. Начните заново.', {
          chat_id: chatId,
          message_id: q.message.message_id
        }).catch(function(){});
        return;
      }
      const newPage = parseInt(data.replace('check_page_', ''));
      if (!isNaN(newPage)) session.currentPage = newPage;
      session.lastActivity = Date.now();
      
      const txt = buildCheckListText(session);
      const kb = { inline_keyboard: buildCheckListKeyboard(session) };
      
      bot.editMessageText(txt, {
        chat_id: chatId,
        message_id: q.message.message_id,
        parse_mode: 'HTML',
        reply_markup: kb
      }).catch(function(){});
      return;
    }

    if (data.startsWith('check_show_')) {
      const session = checkSessions[chatId];
      if (!session) return sendNav(bot, chatId, '⚠️ Сессия прервана.');
      
      const id = parseInt(data.split('_')[2]);
      const b = session.bouquets.find(x => x.id === id);
      if (!b) return sendNav(bot, chatId, '⚠️ Букет больше не в списке.');
      
      session.currentBouquetId = id;
      session.lastActivity = Date.now();
      const already = session.checked[id];
      const headerText = already
        ? '📷 <b>Проверка (уже отмечен)</b>'
        : '📷 <b>Проверка наличия</b>';
        
      const { sendBouquetPreview } = require('./bot-ui');
      return sendBouquetPreview(bot, chatId, b, headerText, [
        [{ text: '✅ Есть', callback_data: 'check_yes_' + b.id }],
        [{ text: '📥 Убрать', callback_data: 'check_no_' + b.id }],
        [{ text: '📸 Скачать фото', callback_data: 'dlphoto_' + b.id }],
        [{ text: '↩️ К списку', callback_data: 'check_back' }]
      ]);
    }

    if (data === 'check_back') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return sendNav(bot, chatId, '👆 Вернуться к списку — выше. Нажмите на любой букет.');
    }

    if (data.startsWith('check_yes_')) {
      const session = checkSessions[chatId];
      if (!session) return sendNav(bot, chatId, '⚠️ Сессия прервана.');
      
      const id = parseInt(data.split('_')[2]);
      if (!session.bouquets.find(x => x.id === id)) return;
      
      await updateBouquetFields(id, {
        confirmed_at: new Date().toISOString(),
        hidden: false,
        reminded: false
      });
      
      session.checked[id] = 'yes';
      session.order = [id, ...session.order.filter(x => x !== id)];
      session.currentBouquetId = null;
      session.lastActivity = Date.now();
      
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return refreshCheckList(bot, chatId, session);
    }

    if (data.startsWith('check_no_')) {
      const session = checkSessions[chatId];
      if (!session) return sendNav(bot, chatId, '⚠️ Сессия прервана.');
      
      const id = parseInt(data.split('_')[2]);
      if (!session.bouquets.find(x => x.id === id)) return;
      
      await updateBouquetField(id, 'hidden', true);
      
      session.checked[id] = 'no';
      session.order = [id, ...session.order.filter(x => x !== id)];
      session.currentBouquetId = null;
      session.lastActivity = Date.now();
      
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      return refreshCheckList(bot, chatId, session);
    }

    // ========== ИЗМЕНИТЬ ЦЕНУ ==========
    const { buildBouquetActionButtons } = require('./bot-ui');

    if (data.startsWith('editprice_ok_')) {
      const id = parseInt(data.split('_')[2]);
      const b = await getBouquetById(shopId, id);
      if (!b) return;
      
      awaitingPrice[chatId] = b.id;
      
      let t = '✏️ Напишите новую цену для ';
      t += 'букета <b>№' + b.shopNumber + '</b> (' + esc(b.name) + ').\n';
      t += 'Текущая: <b>' + formatPrice(b.price, shop) + '</b>\n';
      t += '<i>Отмена — /cancel</i>';
      
      return bot.sendMessage(chatId, t, {
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard(shop, chatId)
      });
    }

    if (data.startsWith('editprice_no_')) {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      const { showBouquetList } = require('./bot-ui');
      return showBouquetList(
        bot, chatId, shopId, 'editprice',
        '✏️ <b>Какой букет изменить цену?</b>\nНажмите на кнопку с номером.',
        0
      );
    }

    if (data.startsWith('editprice_')) {
      const id = parseInt(data.split('_')[1]);
      const b = await getBouquetById(shopId, id);
      if (!b) return sendNav(bot, chatId, '❌ Букет не найден.');
      
      const btns = buildBouquetActionButtons(
        b, '✅ Да, менять цену', 'editprice_ok_' + b.id, 'editprice_no_' + b.id
      );
      const { sendBouquetPreview } = require('./bot-ui');
      return sendBouquetPreview(bot, chatId, b, '✏️ <b>Изменить цену?</b>', btns);
    }

    // ========== ПЕРЕИМЕНОВАТЬ ==========
    if (data.startsWith('rename_ok_')) {
      const id = parseInt(data.split('_')[2]);
      const b = await getBouquetById(shopId, id);
      if (!b) return;
      
      awaitingName[chatId] = b.id;
      
      let t = '📝 Напишите новое название для <b>№' + b.shopNumber + '</b>.\n';
      t += 'Текущее: <b>' + esc(b.name) + '</b>\n';
      t += '<i>Точка в начале — закрепить. Отмена — /cancel</i>';
      
      return bot.sendMessage(chatId, t, {
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard(shop, chatId)
      });
    }

    if (data.startsWith('rename_no_')) {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      const { showBouquetList } = require('./bot-ui');
      return showBouquetList(
        bot, chatId, shopId, 'rename',
        '📝 <b>Какой букет переименовать?</b>\nНажмите на кнопку с номером.',
        0
      );
    }

    if (data.startsWith('rename_')) {
      const id = parseInt(data.split('_')[1]);
      const b = await getBouquetById(shopId, id);
      if (!b) return sendNav(bot, chatId, '❌ Букет не найден.');
      
      const btns = buildBouquetActionButtons(
        b, '✅ Да, менять название', 'rename_ok_' + b.id, 'rename_no_' + b.id
      );
      const { sendBouquetPreview } = require('./bot-ui');
      return sendBouquetPreview(bot, chatId, b, '📝 <b>Переименовать этот букет?</b>', btns);
    }

    // ========== УДАЛИТЬ ==========
    if (data.startsWith('askdel_')) {
      if (!owner) return;
      const id = parseInt(data.split('_')[1]);
      const b = await getBouquetById(shopId, id);
      if (!b) return;
      
      const btns = buildBouquetActionButtons(
        b, '🗑 Да, удалить', 'confirmdel_' + b.id, 'canceldel'
      );
      const { sendBouquetPreview } = require('./bot-ui');
      return sendBouquetPreview(bot, chatId, b, '🗑 <b>Удалить этот букет?</b>', btns);
    }

    if (data.startsWith('confirmdel_')) {
      if (!owner) return;
      const id = parseInt(data.split('_')[1]);
      const b = await getBouquetById(shopId, id);
      const num = b ? b.shopNumber : id;
      
      await updateBouquetField(id, 'deleted', true);
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      
      const { showBouquetList } = require('./bot-ui');
      return showBouquetList(
        bot, chatId, shopId, 'askdel',
        '✅ <b>Букет №' + num + ' удалён с витрины.</b>\n\n🗑 Какой удалить ещё?',
        0
      );
    }

    if (data === 'canceldel') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      const { showBouquetList } = require('./bot-ui');
      return showBouquetList(
        bot, chatId, shopId, 'askdel',
        '🗑 <b>Какой букет удалить?</b>\nНажмите на кнопку с номером.',
        0
      );
    }

    // ========== ПРОДЛЕНИЕ ==========
    if (data.startsWith('extend_')) {
      const id = parseInt(data.split('_')[1]);
      const b = await getBouquetById(shopId, id);
      
      await updateBouquetFields(id, {
        confirmed_at: new Date().toISOString(),
        hidden: false,
        reminded: false
      });
      
      if (!b) return sendNav(bot, chatId, '🌿 Продлено.');
      
      let t = '🌿 <b>Продлено!</b>\n\n';
      t += 'Букет <b>№' + b.shopNumber + '</b> «' + esc(b.name) + '» — ';
      t += '<b>' + formatPrice(b.price, shop) + '</b>\n';
      t += 'Будет на витрине ещё 3 дня.';
      
      return bot.sendMessage(chatId, t, { parse_mode: 'HTML' });
    }

    if (data === 'morning_later') {
      bot.deleteMessage(chatId, q.message.message_id).catch(function(){});
      const { getNowMoscow } = require('./config');
      const key = shopId + ':' + getNowMoscow().toISOString().slice(0, 10);
      const { morningLaterSent } = require('./cron-jobs');
      if (morningLaterSent) morningLaterSent[key] = Date.now();
      return;
    }

    // ========== СТАРЫЕ ВЕТКИ ==========
    if (data.startsWith('confirm_')) {
      const id = parseInt(data.split('_')[1]);
      await updateBouquetFields(id, {
        confirmed_at: new Date().toISOString(),
        hidden: false,
        reminded: false
      });
      const b = await getBouquetById(shopId, id);
      return sendNav(bot, chatId, '✅ Букет №' + (b ? b.shopNumber : id) + ' подтверждён.');
    }

    if (data.startsWith('hide_')) {
      const id = parseInt(data.split('_')[1]);
      await updateBouquetField(id, 'hidden', true);
      const b = await getBouquetById(shopId, id);
      return sendNav(bot, chatId, '📥 Букет №' + (b ? b.shopNumber : id) + ' убран.');
    }

    if (data.startsWith('show_')) {
      const id = parseInt(data.split('_')[1]);
      await updateBouquetFields(id, {
        hidden: false,
        confirmed_at: new Date().toISOString(),
        reminded: false
      });
      const b = await getBouquetById(shopId, id);
      return sendNav(bot, chatId, '✅ Букет №' + (b ? b.shopNumber : id) + ' возвращён.');
    }
  });

}

module.exports = { setupBotHandlers };