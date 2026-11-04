const pool = require('./db');
const {
  SITE_URL, esc, escAttr, formatPrice,
  formatPricePill, getPriceRanges, 
  calculateOldPrice, findPresetById,
  isConfirmedRecently, isValidFileId,
  isSubscriptionActive
} = require('./config');

const {
  getShopFromDb, getBouquetById,
  getBouquetsFromDb, incrementShopStat
} = require('./db-actions');

// ========== КОНСТАНТЫ ВИЗУАЛА ==========
const TWO_COLUMNS_THRESHOLD = 12;
const CLICK_NOTIFY_TTL = 10 * 60 * 1000;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB
const notifiedClicks = new Map();
let cleanupStarted = false;

// Безопасная вставка данных в <script>
function safeJson(data) {
  if (data === undefined) return 'undefined';
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

// Строгая проверка ключа S3 (папки магазинов или wh_ файлы)
function isValidS3Key(key) {
  if (!key || typeof key !== 'string') return false;
  if (key.includes('..') || key.includes('\\')) return false;
  if (!/^[a-zA-Z0-9_\-. \/]+$/.test(key)) return false;
  
  const ext = key.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].indexOf(ext) === -1) return false;
  
  if (!key.includes('/') && !key.startsWith('wh_')) return false;
  return true;
}

// Строгая проверка MAX-ссылки
function getSafeMaxLink(link) {
  if (!link || typeof link !== 'string') return null;
  const regex = /^https:\/\/(max\.ru|max\.me)\/[a-zA-Z0-9_-]+$/i;
  if (regex.test(link)) return link;
  return null;
}

// Проверка Telegram username (строго 5-32 символа, @ только в начале)
function getSafeTgUsername(username) {
  if (!username || typeof username !== 'string') return null;
  let clean = username;
  if (clean.startsWith('@')) clean = clean.substring(1);
  if (/^[a-zA-Z0-9_]{5,32}$/.test(clean)) return clean;
  return null;
}

// Безопасный парсинг URL для CSS (защита от XSS)
function getSafeCssUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const clean = url.replace(/['"()\\]/g, '');
  
  if (clean.startsWith('/')) {
    return escAttr(clean);
  }
  
  try {
    const parsed = new URL(clean);
    if (parsed.protocol === 'https:') {
      return escAttr(parsed.href);
    }
  } catch (e) {}
  
  return '';
}

const CLICK_TYPE_NAMES = {
  tg: '📩 Telegram', wa: '💬 WhatsApp',
  max: '🟼 MAX', call: '📞 Звонок'
};

const BUTTON_COLORS = [
  { id: 'red', name: 'Красный', emoji: '🔴', 
    color: '#e74c3c', dark: '#c0392b' },
  { id: 'pink', name: 'Розовый', emoji: '🌸', 
    color: '#e91e63', dark: '#ad1457' },
  { id: 'green', name: 'Зелёный', emoji: '💚', 
    color: '#27ae60', dark: '#1e8449' },
  { id: 'graphite', name: 'Графит', emoji: '🖤', 
    color: '#2c3e50', dark: '#1a252f' },
  { id: 'blue', name: 'Синий', emoji: '🔵', 
    color: '#3498db', dark: '#21618c' },
  { id: 'lavender', name: 'Лаванда', emoji: '🟣', 
    color: '#9b59b6', dark: '#71368a' }
];

const PRESET_BACKGROUNDS = [
  { id: 1, name: 'Тёплый крем', emoji: '🍦',
    gradient: 'linear-gradient(180deg,#fdf9f3 0%,#fafaf8 40%,' +
              '#f7f5f1 100%)' },
  { id: 2, name: 'Чистый белый', emoji: '⚪',
    gradient: 'linear-gradient(180deg,#ffffff 0%,#fafafa 60%,' +
              '#f5f5f5 100%)' },
  { id: 3, name: 'Нежный розовый', emoji: '🌸',
    gradient: 'linear-gradient(180deg,#fdf2f5 0%,#fbe8ef 50%,' +
              '#f7dae5 100%)' },
  { id: 4, name: 'Ботанический', emoji: '🌿',
    gradient: 'linear-gradient(180deg,#f2f7f0 0%,#e8f0e5 50%,' +
              '#dfe8db 100%)' },
  { id: 5, name: 'Серо-голубой', emoji: '💎',
    gradient: 'linear-gradient(180deg,#f5f7fa 0%,#eaeef3 50%,' +
              '#dee5ec 100%)' },
  { id: 6, name: 'Акварель', emoji: '🎨',
    gradient: 'linear-gradient(180deg,#fdf5f0 0%,#f9e8de 50%,' +
              '#f4dcd0 100%)' },
  { id: 7, name: 'Мрамор', emoji: '🏛',
    gradient: 'linear-gradient(180deg,#fbfaf8 0%,#f2eeea 50%,' +
              '#e8e3dc 100%)' },
  { id: 8, name: 'Новогодний', emoji: '❄️',
    gradient: 'linear-gradient(180deg,#f5f7fa 0%,#e8edf3 50%,' +
              '#dce3ea 100%)' },
  { id: 9, name: 'Весенний', emoji: '🌷',
    gradient: 'linear-gradient(180deg,#fff5f7 0%,#fce4ea 50%,' +
              '#f8d5de 100%)' },
  { id: 10, name: 'Осенний', emoji: '🍂',
    gradient: 'linear-gradient(180deg,#fdf4ea 0%,#f8e4cf 50%,' +
              '#f2d4b6 100%)' }
];

const PLACEHOLDER_GRADIENTS = [
  'linear-gradient(135deg,#fbe8ef 0%,#f7dae5 100%)',
  'linear-gradient(135deg,#e8f0e5 0%,#dfe8db 100%)',
  'linear-gradient(135deg,#eaeef3 0%,#dee5ec 100%)',
  'linear-gradient(135deg,#f9e8de 0%,#f4dcd0 100%)',
  'linear-gradient(135deg,#f2eeea 0%,#e8e3dc 100%)'
];

const MANROPE_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?' +
  'family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">';

// ========== УТИЛИТЫ ВИЗУАЛА ==========
function findColorById(id) {
  if (!id) return null;
  return BUTTON_COLORS.find(function(c) { return c.id === id; }) || null;
}

function getButtonColorsLocal(shop) {
  if (!shop || !shop.settings) {
    return { color: '#e74c3c', dark: '#c0392b' };
  }
  const id = shop.settings.buttonColor;
  if (!id) return { color: '#e74c3c', dark: '#c0392b' };
  const found = findColorById(id);
  return found || { color: '#e74c3c', dark: '#c0392b' };
}

function isPresetBackground(bgSetting) {
  if (!bgSetting) return false;
  if (typeof bgSetting !== 'object') return false;
  return bgSetting.type === 'preset';
}

function getPlaceholderGradientLocal(seed) {
  const n = parseInt(seed, 10) || 0;
  return PLACEHOLDER_GRADIENTS[n % PLACEHOLDER_GRADIENTS.length];
}

function getPhotoRefsLocal(photo) {
  if (!photo) return { primary: null, fallback: null };
  if (typeof photo === 'string') {
    if (photo.startsWith('https://')) {
      return { primary: photo, fallback: null };
    }
    if (isValidFileId(photo)) {
      return { primary: '/photo/tg/' + photo, fallback: null };
    }
    return { primary: null, fallback: null };
  }
  if (typeof photo === 'object') {
    const s3 = isValidS3Key(photo.s3) ? photo.s3 : null;
    const s3b = isValidS3Key(photo.s3b) ? photo.s3b : null;
    const tg = isValidFileId(photo.tg) ? photo.tg : null;

    if (s3 && s3b && tg) {
      return { 
        primary: s3, 
        fallback: s3b, 
        fallback2: '/photo/tg/' + tg 
      };
    }
    if (s3 && s3b) return { primary: s3, fallback: s3b };
    if (s3b && tg) return { primary: s3b, fallback: '/photo/tg/' + tg };
    if (s3b) return { primary: s3b, fallback: null };
    if (s3 && tg) return { primary: s3, fallback: '/photo/tg/' + tg };
    if (s3) return { primary: s3, fallback: null };
    if (tg) return { primary: '/photo/tg/' + tg, fallback: null };
  }
  return { primary: null, fallback: null };
}

// Безопасный рендер тега img с защитой от зацикливания
function renderImgTag(refs, style) {
  if (!refs || !refs.primary) return null;
  const p = escAttr(refs.primary);
  const st = style || '';
  let html = '<img src="' + p + '"';
  if (st) html += ' style="' + st + '"';
  
  if (refs.fallback && refs.fallback2) {
    const f1 = escAttr(refs.fallback);
    const f2 = escAttr(refs.fallback2);
    html += ' data-f1="' + f1 + '" data-f2="' + f2 + '"';
    html += ' onerror="if(this.src!==this.dataset.f1&&this.dataset.f1){this.src=this.dataset.f1;}else if(this.src!==this.dataset.f2&&this.dataset.f2){this.src=this.dataset.f2;}else{this.onerror=null;this.src=\'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7\';}"';
  } else if (refs.fallback) {
    const f = escAttr(refs.fallback);
    html += ' data-f1="' + f + '"';
    html += ' onerror="if(this.src!==this.dataset.f1&&this.dataset.f1){this.src=this.dataset.f1;}else{this.onerror=null;this.src=\'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7\';}"';
  }
  html += '>';
  return html;
}

function absoluteUrl(url) {
  if (!url) return null;
  if (url.startsWith('https://')) return url;
  if (url.startsWith('/')) return SITE_URL + url;
  return null;
}

function getBackgroundStyle(bgSetting) {
  const def = 'background:linear-gradient(180deg,#fdf9f3 0%,#fafaf8 40%,';
  const def2 = '#f7f5f1 100%);background-attachment:fixed;';
  const fullDef = def + def2;
  if (!bgSetting) return fullDef;
  
  if (isPresetBackground(bgSetting)) {
    const preset = findPresetById(bgSetting.id);
    if (preset) {
      return 'background:' + preset.gradient + ';background-attachment:fixed;';
    }
    return fullDef;
  }
  
  const refs = getPhotoRefsLocal(bgSetting);
  if (refs && refs.primary) {
    const safeUrl = getSafeCssUrl(refs.primary);
    if (safeUrl) {
      let st = "background-image:url('" + safeUrl + "');";
      st += "background-size:cover;background-attachment:fixed;";
      return st;
    }
  }
  return fullDef;
}

// ========== HTML: КАРТОЧКА БУКЕТА ==========
function buildBouquetPage({ shop, bouquet, photoRefs, otherPhotoRefs }) {
  const bouquetNameEsc = esc(bouquet.name);
  const shopIdEsc = escAttr(shop.shopId);
  
  const settings = shop.settings || {};
  const oldPrice = calculateOldPrice(bouquet.price, settings.markupPercent);
  const bouquetUrl = SITE_URL + '/shop/' + shopIdEsc + '/b/' + bouquet.id;
  const title = bouquetNameEsc + ' — ' + esc(shop.displayName);
  const priceStr = formatPrice(bouquet.price, shop);
  const oldPriceStr = formatPrice(oldPrice, shop);
  const description = priceStr + ' · ' + esc(shop.displayName);
  
  const primaryPhotoUrl = (photoRefs && photoRefs.primary) ? 
    absoluteUrl(photoRefs.primary) : null;
  const btnColors = getButtonColorsLocal(shop);

  let ogTags = '';
  if (primaryPhotoUrl) {
    ogTags += '\n<meta property="og:image" content="' + 
      escAttr(primaryPhotoUrl) + '">\n';
    ogTags += '<meta property="og:image:width" content="800">\n';
    ogTags += '<meta property="og:image:height" content="800">\n';
    ogTags += '<meta name="twitter:image" content="' + 
      escAttr(primaryPhotoUrl) + '">';
  }

  const imgStyle = 'width:100%;max-width:500px;border-radius:20px;';
  const imgStyle2 = 'box-shadow:0 6px 24px rgba(0,0,0,0.12);';
  const fullImgStyle = imgStyle + imgStyle2;

  let mainPhotoHtml = '';
  if (photoRefs && photoRefs.primary) {
    mainPhotoHtml = renderImgTag(photoRefs, fullImgStyle);
  } else {
    const grad = getPlaceholderGradientLocal(bouquet.id);
    mainPhotoHtml = '<div style="width:100%;max-width:500px;aspect-ratio:1/1;';
    mainPhotoHtml += 'background:' + grad + ';border-radius:20px;';
    mainPhotoHtml += 'display:flex;align-items:center;justify-content:center;';
    mainPhotoHtml += 'color:#fff;font-size:60px;margin:0 auto;opacity:0.7;">📷</div>';
  }

  let thumbsHtml = '';
  if (otherPhotoRefs && otherPhotoRefs.length > 0) {
    const thumbStyle = 'width:70px;height:70px;object-fit:cover;';
    const thumbStyle2 = 'border-radius:12px;border:2px solid #fff;';
    const thumbStyle3 = 'box-shadow:0 2px 8px rgba(0,0,0,0.12);';
    const fullThumbStyle = thumbStyle + thumbStyle2 + thumbStyle3;
    thumbsHtml = '<div style="display:flex;gap:8px;justify-content:center;';
    thumbsHtml += 'margin-top:12px;flex-wrap:wrap;">';
    for (const r of otherPhotoRefs) {
      thumbsHtml += renderImgTag(r, fullThumbStyle);
    }
    thumbsHtml += '</div>';
  }

  const btnBase = 'display:block;margin-top:8px;color:#fff;padding:14px 20px;';
  const btnBase2 = 'border-radius:30px;text-decoration:none;font-weight:700;';
  const btnBase3 = 'text-align:center;font-size:16px;';
  const btnCommon = btnBase + btnBase2 + btnBase3;
  
  const btnTg = btnCommon + 'background:#229ED9;';
  const btnWa = btnCommon + 'background:#25D366;';
  const btnMax = btnCommon + 'background:#7B68EE;';
  const btnCall = btnCommon + 'background:' + btnColors.color + ';';
  const hrefBase = '/go/' + shopIdEsc + '/' + bouquet.id + '/';

  let buttonsHTML = '';
  
  const waPhone = shop.whatsappPhone ? 
    shop.whatsappPhone.replace(/\D/g, '') : '';
  if (waPhone.length >= 10) {
    buttonsHTML += '<a href="' + hrefBase + 'wa" style="' + btnWa + '">';
    buttonsHTML += '💬 Написать в WhatsApp</a>';
  }
  
  if (getSafeTgUsername(shop.telegramUsername)) {
    buttonsHTML += '<a href="' + hrefBase + 'tg" style="' + btnTg + '">';
    buttonsHTML += '📩 Написать в Telegram</a>';
  }
  
  if (getSafeMaxLink(shop.maxLink)) {
    buttonsHTML += '<a href="' + hrefBase + 'max" style="' + btnMax + '">';
    buttonsHTML += '🟼 Написать в MAX</a>';
  }
  
  const cleanPhone = shop.phone ? 
    shop.phone.replace(/\D/g, '') : '';
  if (cleanPhone.length >= 10) {
    buttonsHTML += '<a href="' + hrefBase + 'call" style="' + btnCall + '">';
    buttonsHTML += '📞 Позвонить</a>';
  }

  let priceHtml = '';
  if (oldPrice > bouquet.price) {
    priceHtml += '<span style="text-decoration:line-through;color:#999;';
    priceHtml += 'font-weight:400;font-size:20px;">';
    priceHtml += oldPriceStr + '</span>&nbsp; ' + priceStr;
  } else {
    priceHtml = priceStr;
  }

  let preorderBadge = '';
  if (bouquet.preorderOnly) {
    preorderBadge = '<div style="display:inline-block; background:#FFF0EC; ';
    preorderBadge += 'color:#E1846D; font-size:13px; font-weight:800; ';
    preorderBadge += 'padding:6px 16px; border-radius:20px; margin-bottom:16px;">';
    preorderBadge += 'Только предзаказ</div>';
  }

  const bouquetNameJs = safeJson(bouquet.name);
  const bouquetUrlJs = safeJson(bouquetUrl);
  const noContacts = '<div style="color:#888;padding:10px;">';
  const noContacts2 = 'Контакты временно недоступны</div>';
  const bodyBg = getBackgroundStyle(settings.background);

  let html = '<!DOCTYPE html>\n<html lang="ru">\n<head>\n';
  html += '<meta charset="UTF-8">\n';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
  html += '<title>' + title + '</title>\n';
  html += '<meta property="og:type" content="product">\n';
  html += '<meta property="og:title" content="' + escAttr(title) + '">\n';
  html += '<meta property="og:description" content="' + escAttr(description) + '">\n';
  html += '<meta property="og:url" content="' + escAttr(bouquetUrl) + '">\n';
  html += '<meta property="og:site_name" content="Flowind">\n';
  html += '<meta name="twitter:card" content="summary_large_image">\n';
  html += '<meta name="twitter:title" content="' + escAttr(title) + '">\n';
  html += '<meta name="twitter:description" content="' + escAttr(description) + '">';
  html += ogTags + '\n';
  html += MANROPE_LINK + '\n<style>\n';
  html += 'body{font-family:Manrope,-apple-system,sans-serif;margin:0;padding:20px;';
  html += bodyBg;
  html += 'text-align:center;color:#2c3e50;}\n';
  html += '.container{max-width:560px;margin:0 auto;padding:12px 0;}\n';
  html += '.back{display:inline-block;margin-bottom:16px;color:#888;';
  html += 'text-decoration:none;font-size:14px;}\n';
  html += 'h1{font-size:26px;margin:16px 0 8px;line-height:1.3;font-weight:800;}\n';
  html += '.price{font-size:30px;font-weight:800;margin:8px 0 20px;';
  html += 'color:' + btnColors.color + ';}\n';
  html += '.card{background:#fff;border-radius:22px;padding:20px;';
  html += 'box-shadow:0 6px 24px rgba(0,0,0,0.07);margin:20px 0;}\n';
  html += '.share{display:inline-block;margin-top:20px;color:#888;';
  html += 'text-decoration:none;font-size:14px;padding:10px 16px;';
  html += 'border-radius:20px;background:#f0f0f0;}\n';
  html += '</style>\n</head>\n<body>\n';
  html += '<div class="container">\n';
  html += '<a class="back" href="/shop/' + shopIdEsc + '">← К витрине</a>\n';
  html += '<div>' + mainPhotoHtml + '</div>\n';
  html += thumbsHtml + '\n';
  html += '<h1>' + bouquetNameEsc + '</h1>\n';
  html += preorderBadge + '\n';
  html += '<div class="price">' + priceHtml + '</div>\n';
  html += '<div class="card">';
  html += buttonsHTML || (noContacts + noContacts2);
  html += '</div>\n';
  html += '<a class="share" href="#" onclick="shareBouquet(); return false;">';
  html += '📤 Поделиться с близкими</a>\n';
  html += '</div>\n<script>\n';
  html += 'function shareBouquet() {\n';
  html += '  var url = ' + bouquetUrlJs + ';\n';
  html += '  var name = ' + bouquetNameJs + ';\n';
  html += '  var price = ' + safeJson(priceStr) + ';\n';
  html += '  var text = name + " — " + price;\n';
  html += '  if (navigator.share) {\n';
  html += '    navigator.share({ title: name, text: text, url: url })';
  html += '.catch(function(){});\n';
  html += '  } else if (navigator.clipboard && navigator.clipboard.writeText) {\n';
  html += '    navigator.clipboard.writeText(url).then(function(){ ';
  html += 'alert("Ссылка скопирована"); }).catch(function(){ ';
  html += 'prompt("Скопируйте ссылку:", url); });\n';
  html += '  } else { prompt("Скопируйте ссылку:", url); }\n';
  html += '}\n';
  html += '</script>\n</body>\n</html>';
  return html;
}
// ========== HTML: СТРАНИЦА КОНТАКТОВ ==========
function buildContactPage({ shop, bouquet, photoRefs }) {
  const bouquetNameEsc = esc(bouquet.name);
  const shopIdEsc = escAttr(shop.shopId);
  
  const settings = shop.settings || {};
  const oldPrice = calculateOldPrice(
    bouquet.price, settings.markupPercent
  );
  const priceStr = formatPrice(bouquet.price, shop);
  const oldPriceStr = formatPrice(oldPrice, shop);
  
  const orderText = 'Здравствуйте! Пишу с вашей витрины. ';
  const orderText2 = 'Хочу заказать букет №';
  const fullOrderText = orderText + orderText2 + bouquet.shopNumber + 
    ' «' + bouquet.name + '» — ' + priceStr + '.';
    
  const orderTextJs = safeJson(fullOrderText);
  const orderTextEsc = esc(fullOrderText);
  const btnColors = getButtonColorsLocal(shop);

  const imgStyle = 'width:100%;max-width:420px;border-radius:20px;';
  const imgStyle2 = 'box-shadow:0 6px 24px rgba(0,0,0,0.12);';
  const fullImgStyle = imgStyle + imgStyle2;

  let mainPhotoHtml = '';
  if (photoRefs && photoRefs.primary) {
    mainPhotoHtml = renderImgTag(photoRefs, fullImgStyle);
  } else {
    const grad = getPlaceholderGradientLocal(bouquet.id);
    mainPhotoHtml = '<div style="width:100%;max-width:420px;';
    mainPhotoHtml += 'aspect-ratio:1/1;background:' + grad + ';';
    mainPhotoHtml += 'border-radius:20px;display:flex;';
    mainPhotoHtml += 'align-items:center;justify-content:center;';
    mainPhotoHtml += 'color:#fff;font-size:60px;margin:0 auto;';
    mainPhotoHtml += 'opacity:0.7;">📷</div>';
  }

  let priceHtml = '';
  if (oldPrice > bouquet.price) {
    priceHtml += '<span style="text-decoration:line-through;';
    priceHtml += 'color:#999;font-weight:400;font-size:20px;">';
    priceHtml += oldPriceStr + '</span>&nbsp; ' + priceStr;
  } else {
    priceHtml = priceStr;
  }

  const btnBase = 'display:flex;align-items:center;';
  const btnBase2 = 'justify-content:center;gap:8px;';
  const btnBase3 = 'width:100%;padding:16px;';
  const btnBase4 = 'border-radius:30px;font-size:17px;';
  const btnBase5 = 'font-weight:700;text-decoration:none;';
  const btnBase6 = 'border:none;cursor:pointer;margin-top:10px;';
  const btnBase7 = 'box-sizing:border-box;font-family:inherit;color:#fff;';
  const btnCommon = btnBase + btnBase2 + btnBase3 + btnBase4 + 
    btnBase5 + btnBase6 + btnBase7;
    
  const btnWa = btnCommon + 'background:#25D366;';
  const btnTg = btnCommon + 'background:#229ED9;';
  const btnMax = btnCommon + 'background:#7B68EE;';
  const btnCall = btnCommon + 'background:' + btnColors.color + ';';
  const hrefBase = '/go/' + shopIdEsc + '/' + bouquet.id + '/';

  let contactsHTML = '';
  
  const waPhone = shop.whatsappPhone ? 
    shop.whatsappPhone.replace(/\D/g, '') : '';
  if (waPhone.length >= 10) {
    contactsHTML += '<a href="' + hrefBase + 'wa" style="';
    contactsHTML += btnWa + '">💬 WhatsApp</a>';
  }
  
  if (getSafeTgUsername(shop.telegramUsername)) {
    contactsHTML += '<a href="' + hrefBase + 'tg" style="';
    contactsHTML += btnTg + '">📩 Telegram</a>';
  }
  
  if (getSafeMaxLink(shop.maxLink)) {
    contactsHTML += '<a href="' + hrefBase + 'max" style="';
    contactsHTML += btnMax + '">🟼 MAX</a>';
  }
  
  const cleanPhone = shop.phone ? 
    shop.phone.replace(/\D/g, '') : '';
  if (cleanPhone.length >= 10) {
    contactsHTML += '<a href="' + hrefBase + 'call" style="';
    contactsHTML += btnCall + '">📞 Позвонить</a>';
  }

  const noContacts = '<div style="color:#888;padding:10px;">';
  const noContacts2 = 'Контакты временно недоступны</div>';
  const bodyBg = getBackgroundStyle(settings.background);

  let html = '<!DOCTYPE html>\n<html lang="ru">\n<head>\n';
  html += '<meta charset="UTF-8">\n';
  html += '<meta name="viewport" content="width=device-width, ';
  html += 'initial-scale=1.0">\n';
  html += '<title>Связаться — ' + bouquetNameEsc + '</title>\n';
  html += MANROPE_LINK + '\n<style>\n';
  html += 'body{font-family:Manrope,-apple-system,sans-serif;';
  html += 'margin:0;padding:20px;';
  html += bodyBg;
  html += 'text-align:center;color:#2c3e50;}\n';
  html += '.container{max-width:500px;margin:0 auto;padding:12px 0;}\n';
  html += '.back{display:inline-block;margin-bottom:16px;color:#888;';
  html += 'text-decoration:none;font-size:14px;}\n';
  html += 'h1{font-size:22px;margin:14px 0 6px;';
  html += 'line-height:1.3;font-weight:800;}\n';
  html += '.price{font-size:26px;font-weight:800;';
  html += 'margin:6px 0 16px;color:' + btnColors.color + ';}\n';
  html += '.card{background:#fff;border-radius:22px;padding:20px;';
  html += 'box-shadow:0 6px 24px rgba(0,0,0,0.07);margin:16px 0;}\n';
  html += '.quote{background:#f5f5f5;border-radius:12px;padding:14px;';
  html += 'text-align:left;font-size:15px;line-height:1.5;margin:0 0 12px;';
  html += 'color:#333;white-space:pre-wrap;word-break:break-word;}\n';
  html += '.copy{display:block;width:100%;padding:12px;';
  html += 'border-radius:24px;font-size:15px;font-weight:700;';
  html += 'background:#e8e8e8;color:#333;border:none;cursor:pointer;';
  html += 'font-family:inherit;}\n';
  html += '.copy.copied{background:#27ae60;color:#fff;}\n';
  html += '</style>\n</head>\n<body>\n';
  html += '<div class="container">\n';
  html += '<a class="back" href="/shop/' + shopIdEsc;
  html += '">← К витрине</a>\n\n';
  html += '<div>' + mainPhotoHtml + '</div>\n';
  html += '<h1>' + bouquetNameEsc + '</h1>\n';
  html += '<div class="price">' + priceHtml + '</div>\n\n';
  html += '<div class="card">\n';
  html += '<div style="font-size:16px;font-weight:700;color:#2c3e50;';
  html += 'margin-bottom:12px;">Как связаться с флористом?</div>\n';
  html += contactsHTML || (noContacts + noContacts2);
  html += '\n</div>\n\n';
  html += '<div class="card" style="text-align:left;">\n';
  html += '<div style="font-size:14px;color:#555;margin-bottom:10px;">\n';
  html += '💡 Можно скопировать готовый текст ';
  html += 'заказа и вставить в чат:\n</div>\n';
  html += '<div class="quote">' + orderTextEsc + '</div>\n';
  html += '<button class="copy" id="copyBtn" onclick="copyOrder()">';
  html += '📋 Скопировать текст</button>\n';
  html += '</div>\n</div>\n';
  html += '<script>\n';
  html += 'function copyOrder() {\n';
  html += '  var text = ' + orderTextJs + ';\n';
  html += '  var btn = document.getElementById("copyBtn");\n';
  html += '  function done() {\n';
  html += '    btn.textContent = "✅ Скопировано!";\n';
  html += '    btn.classList.add("copied");\n';
  html += '    setTimeout(function(){ ';
  html += 'btn.textContent = "📋 Скопировать текст"; ';
  html += 'btn.classList.remove("copied"); }, 2500);\n';
  html += '  }\n';
  html += '  if (navigator.clipboard && navigator.clipboard.writeText) {\n';
  html += '    navigator.clipboard.writeText(text)';
  html += '.then(done).catch(function(){ fallbackCopy(text, done); });\n';
  html += '  } else { fallbackCopy(text, done); }\n';
  html += '}\n';
  html += 'function fallbackCopy(text, cb) {\n';
  html += '  var ta = document.createElement("textarea");\n';
  html += '  ta.value = text; ';
  html += 'ta.style.position = "fixed"; ta.style.left = "-9999px";\n';
  html += '  document.body.appendChild(ta); ta.focus(); ta.select();\n';
  html += '  try { document.execCommand("copy"); cb(); } catch(e) {}\n';
  html += '  document.body.removeChild(ta);\n';
  html += '}\n';
  html += '</script>\n</body>\n</html>';
  return html;
}

// ========== HTML: ПЕРЕХОД В МЕССЕНДЖЕР ==========
function buildMessengerOrderPage(
  { shop, bouquet, orderText, messenger }
) {
  const isMax = messenger === 'max';
  const messengerName = isMax ? 'MAX' : 'Telegram';
  const messengerEmoji = isMax ? '🟼' : '📩';
  const buttonColor = isMax ? '#7B68EE' : '#229ED9';
  
  let externalLink = '#';
  if (isMax) {
    const safeMax = getSafeMaxLink(shop.maxLink);
    if (safeMax) externalLink = escAttr(safeMax);
  } else {
    const safeTg = getSafeTgUsername(shop.telegramUsername);
    if (safeTg) externalLink = 'https://t.me/' + escAttr(safeTg);
  }
    
  const orderTextJs = safeJson(orderText);
  const orderTextEsc = esc(orderText);
  const shopNameEsc = esc(shop.displayName);
  const shopIdEsc = escAttr(shop.shopId);
  const bouquetNameEsc = esc(bouquet.name);
  const priceStr = formatPrice(bouquet.price, shop);

  let html = '<!DOCTYPE html>\n<html lang="ru">\n<head>\n';
  html += '<meta charset="UTF-8">\n';
  html += '<meta name="viewport" content="width=device-width, ';
  html += 'initial-scale=1.0">\n';
  html += '<title>Перейти в ' + messengerName;
  html += ' — ' + shopNameEsc + '</title>\n';
  html += MANROPE_LINK + '\n';
  html += '<style>\n';
  html += 'body{font-family:Manrope,-apple-system,sans-serif;';
  html += 'margin:0;padding:20px;background:#fafaf8;';
  html += 'text-align:center;color:#2c3e50;}\n';
  html += '.container{max-width:500px;margin:0 auto;padding:12px 0;}\n';
  html += 'h1{font-size:22px;margin:8px 0 4px;font-weight:800;}\n';
  html += '.sub{color:#666;font-size:14px;margin-bottom:16px;}\n';
  html += '.card{background:#fff;border-radius:20px;padding:20px;';
  html += 'margin:16px 0;box-shadow:0 4px 20px rgba(0,0,0,0.08);}\n';
  html += '.quote{background:#f5f5f5;border-radius:12px;padding:16px;';
  html += 'text-align:left;font-size:16px;line-height:1.5;margin:16px 0;';
  html += 'color:#333;white-space:pre-wrap;word-break:break-word;}\n';
  html += '.btn{display:block;width:100%;padding:16px;';
  html += 'border-radius:30px;font-size:17px;font-weight:700;';
  html += 'text-decoration:none;border:none;cursor:pointer;';
  html += 'margin-top:12px;box-sizing:border-box;font-family:inherit;}\n';
  html += '.btn-copy{background:#3498db;color:#fff;}\n';
  html += '.btn-copy.copied{background:#27ae60;}\n';
  html += '.btn-open{background:' + buttonColor + ';color:#fff;}\n';
  html += '.steps{text-align:left;color:#555;font-size:14px;';
  html += 'line-height:1.6;margin:12px 0;}\n';
  html += '.steps b{color:#2c3e50;}\n';
  html += '.back{display:inline-block;margin-top:20px;color:#888;';
  html += 'text-decoration:none;font-size:14px;}\n';
  html += '</style>\n</head>\n<body>\n';
  html += '<div class="container">\n';
  html += '<h1>' + messengerEmoji + ' Перейти в ';
  html += messengerName + '</h1>\n';
  html += '<div class="sub">Букет №';
  html += bouquet.shopNumber + ' — ';
  html += bouquetNameEsc + ' — ' + priceStr + '</div>\n';
  html += '<div class="card">\n';
  html += '<div class="steps">\n';
  html += '<b>1.</b> Скопируйте текст ниже<br>\n';
  html += '<b>2.</b> Нажмите «Открыть ';
  html += messengerName + '»<br>\n';
  html += '<b>3.</b> Вставьте текст в чат и отправьте\n';
  html += '</div>\n';
  html += '<div class="quote">' + orderTextEsc + '</div>\n';
  html += '<button class="btn btn-copy" id="copyBtn" ';
  html += 'onclick="copyOrder()">';
  html += '📋 Скопировать текст</button>\n';
  html += '<a class="btn btn-open" href="' + externalLink + '" ';
  html += 'target="_blank" rel="noopener">';
  html += messengerEmoji + ' Открыть ';
  html += messengerName + '</a>\n';
  html += '</div>\n';
  html += '<a class="back" href="/shop/' + shopIdEsc + '">';
  html += '← Вернуться на витрину</a>\n';
  html += '</div>\n<script>\n';
  html += 'function copyOrder() {\n';
  html += '  var text = ' + orderTextJs + ';\n';
  html += '  var btn = document.getElementById("copyBtn");\n';
  html += '  function done() {\n';
  html += '    btn.textContent = "✅ Скопировано!";\n';
  html += '    btn.classList.add("copied");\n';
  html += '    setTimeout(function(){ ';
  html += 'btn.textContent = "📋 Скопировать текст"; ';
  html += 'btn.classList.remove("copied"); }, 2500);\n';
  html += '  }\n';
  html += '  if (navigator.clipboard && navigator.clipboard.writeText) {\n';
  html += '    navigator.clipboard.writeText(text)';
  html += '.then(done).catch(function(){ fallbackCopy(text, done); });\n';
  html += '  } else { fallbackCopy(text, done); }\n';
  html += '}\n';
  html += 'function fallbackCopy(text, cb) {\n';
  html += '  var ta = document.createElement("textarea");\n';
  html += '  ta.value = text; ';
  html += 'ta.style.position = "fixed"; ta.style.left = "-9999px";\n';
  html += '  document.body.appendChild(ta); ta.focus(); ta.select();\n';
  html += '  try { document.execCommand("copy"); cb(); } catch(e) {}\n';
  html += '  document.body.removeChild(ta);\n';
  html += '}\n';
  html += '</script>\n</body>\n</html>';
  return html;
}

// ========== УВЕДОМЛЕНИЕ О КЛИКЕ ==========
function sendClickNotification(shop, bouquet, type, bot) {
  if (!shop || !shop.admins || shop.admins.length === 0) return;
  const channelName = CLICK_TYPE_NAMES[type] || 'Мессенджер';
  const isCall = type === 'call';
  const priceStr = formatPrice(bouquet.price, shop);
  
  const onShiftAdmins = shop.admins.filter(function(a) {
    return a.onShift;
  });

  if (onShiftAdmins.length > 0) {
    const action = isCall ? 'Позвонить' : 'Связаться';
    let text = '🔔 <b>Клиент нажал «' + action + '»</b>\n\n';
    text += 'Букет <b>№' + bouquet.shopNumber + '</b> «';
    text += esc(bouquet.name) + '» — ';
    text += '<b>' + priceStr + '</b>\n';
    text += 'Канал: ' + channelName + '\n\n';
    text += isCall
      ? '<i>Ожидайте звонка.</i>'
      : '<i>Возможно, он уже пишет — проверьте.</i>';

    for (const admin of onShiftAdmins) {
      bot.sendMessage(admin.chatId, text, {
        parse_mode: 'HTML'
      }).catch(function(){});
    }
    return;
  }

  const owner = shop.admins.find(function(a) {
    return a.role === 'owner';
  });
  if (!owner) return;

  const action = isCall ? 'Позвонить' : 'Связаться';
  let warnText = '⚠️ <b>На смене никого</b>\n\n';
  warnText += 'Клиент нажал «' + action + '»\n\n';
  warnText += 'Букет <b>№' + bouquet.shopNumber + '</b> «';
  warnText += esc(bouquet.name) + '» — ';
  warnText += '<b>' + priceStr + '</b>\n';
  warnText += 'Канал: ' + channelName + '\n\n';
  warnText += '<i>Напомните флористам ';
  warnText += 'отметиться: «✅ Я сегодня ';
  warnText += 'работаю».</i>';

  bot.sendMessage(owner.chatId, warnText, {
    parse_mode: 'HTML'
  }).catch(function(){});
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function formatConfirmedAt(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffHrs < 1) return 'только что';
  if (diffHrs < 24) return diffHrs + ' ч. назад';
  
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return 'вчера';
  return diffDays + ' дн. назад';
}
// ========== EXPRESS-РОУТЫ ==========
function setupStorefront(app, bot, s3ctx) {
  const { s3, YC_BUCKET } = s3ctx;
  const token = process.env.BOT_TOKEN;
  const https = require('https');

  function parseStrictInt(str) {
    if (typeof str !== 'string') str = String(str);
    if (!/^[0-9]+$/.test(str)) return null;
    const n = parseInt(str, 10);
    return (n > 0) ? n : null;
  }

  if (!cleanupStarted) {
    cleanupStarted = true;
    setInterval(function() {
      const now = Date.now();
      notifiedClicks.forEach(function(val, key) {
        if (now - val > CLICK_NOTIFY_TTL) notifiedClicks.delete(key);
      });
    }, 15 * 60 * 1000);
  }

  app.get('/photo/s3/*', async (req, res) => {
    try {
      const key = req.params[0];
      if (!isValidS3Key(key)) return res.status(400).send('bad key');
      if (!s3) return res.status(503).send('s3 disabled');

      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const cmd = new GetObjectCommand({
        Bucket: YC_BUCKET, Key: key
      });
      const data = await s3.send(cmd);

      if (data.ContentLength && data.ContentLength > MAX_PHOTO_SIZE) {
        return res.status(413).send('too large');
      }

      const mime = data.ContentType;
      const allowedMime = [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif'
      ];
      if (!mime || allowedMime.indexOf(mime) === -1) {
        return res.status(403).send('bad mime');
      }

      res.setHeader('Content-Type', mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=86400');

      const stream = data.Body;
      let bytesSent = 0;
      
      if (stream.pipe) {
        stream.on('data', function(chunk) {
          bytesSent += chunk.length;
          if (bytesSent > MAX_PHOTO_SIZE) {
            stream.destroy();
            if (!res.headersSent) res.status(413).send('too large');
          }
        });
        stream.on('error', function(e) {
          console.error('S3 stream error:', e.message);
          if (!res.headersSent) res.status(500).send('stream error');
        });
        stream.pipe(res);
      } else {
        const chunks = [];
        let totalSize = 0;
        for await (const chunk of stream) {
          totalSize += chunk.length;
          if (totalSize > MAX_PHOTO_SIZE) {
            return res.status(413).send('too large');
          }
          chunks.push(chunk);
        }
        res.send(Buffer.concat(chunks));
      }
    } catch (e) {
      console.error('Ошибка /photo/s3:', e?.message || e);
      return res.status(404).send('not found');
    }
  });

  app.get('/photo/tg/:fileId', async (req, res) => {
    try {
      const fileId = req.params.fileId;
      if (!isValidFileId(fileId)) return res.status(400).send('bad');
      
      const fileInfo = await bot.getFile(fileId);
      if (!fileInfo || !fileInfo.file_path) {
        return res.status(404).send('not found');
      }
      
      const url = 'https://api.telegram.org/file/bot' + 
        token + '/' + fileInfo.file_path;
        
      const request = https.get(url, function(tgRes) {
        if (tgRes.statusCode !== 200) {
          return res.status(tgRes.statusCode).send('tg error');
        }

        const mime = tgRes.headers['content-type'] || '';
        const allowedMime = [
          'image/jpeg', 'image/png', 'image/webp', 'image/gif'
        ];
        if (allowedMime.indexOf(mime) === -1) {
          tgRes.destroy();
          return res.status(403).send('bad mime');
        }

        const len = parseInt(tgRes.headers['content-length'], 10);
        if (len && len > MAX_PHOTO_SIZE) {
          tgRes.destroy();
          return res.status(413).send('too large');
        }

        res.setHeader('Content-Type', mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        
        let tgBytes = 0;
        tgRes.on('data', function(chunk) {
          tgBytes += chunk.length;
          if (tgBytes > MAX_PHOTO_SIZE) {
            tgRes.destroy();
            if (!res.headersSent) res.status(413).send('too large');
          }
        });
        
        tgRes.pipe(res);
      }).on('error', function(e) {
        console.error('Ошибка потока tg:', e.message);
        if (!res.headersSent) res.status(500).send('stream error');
      });
      
      request.setTimeout(10000, function() {
        request.abort();
        if (!res.headersSent) res.status(504).send('tg timeout');
      });
      
    } catch (e) {
      console.error('Ошибка /photo/tg:', e?.message || e);
      return res.status(404).send('not found');
    }
  });

  app.get('/contact/:shopId/:bouquetId', async (req, res) => {
    try {
      const shop = await getShopFromDb(req.params.shopId);
      if (!shop) return res.status(404).send('Магазин не найден');
      if (shop.blocked) return res.status(403).send('Магазин заблокирован');
      if (!isSubscriptionActive(shop)) {
        return res.status(403).send('Подписка истекла');
      }
      
      const bouquetId = parseStrictInt(req.params.bouquetId);
      if (!bouquetId) return res.status(404).send('Букет не найден');
      
      const b = await getBouquetById(req.params.shopId, bouquetId);
      if (!b) return res.status(404).send('Букет не найден');
      
      let firstPhoto = null;
      if (Array.isArray(b.photos) && b.photos.length > 0) {
        firstPhoto = b.photos[0];
      }
      const photoRefs = getPhotoRefsLocal(firstPhoto);
      
      res.send(buildContactPage({ shop, bouquet: b, photoRefs }));
    } catch (e) {
      console.error('Ошибка /contact:', e?.message || e);
      res.status(500).send('Ошибка');
    }
  });

  app.get('/shop/:shopId/b/:bouquetId', async (req, res) => {
    try {
      const shop = await getShopFromDb(req.params.shopId);
      if (!shop) return res.status(404).send('Магазин не найден');
      if (shop.blocked) return res.status(403).send('Магазин заблокирован');
      if (!isSubscriptionActive(shop)) {
        return res.status(403).send('Подписка истекла');
      }
      
      const bouquetId = parseStrictInt(req.params.bouquetId);
      if (!bouquetId) return res.status(404).send('Букет не найден');
      
      const b = await getBouquetById(req.params.shopId, bouquetId);
      if (!b) return res.status(404).send('Букет не найден');
      
      const photoRefsList = [];
      if (Array.isArray(b.photos)) {
        for (let i = 0; i < b.photos.length; i++) {
          const r = getPhotoRefsLocal(b.photos[i]);
          if (r.primary) photoRefsList.push(r);
        }
      }
      
      const mainRef = photoRefsList[0] || null;
      const otherRefs = photoRefsList.slice(1);
      
      res.send(buildBouquetPage({
        shop, bouquet: b,
        photoRefs: mainRef,
        otherPhotoRefs: otherRefs
      }));
    } catch (e) {
      console.error('Ошибка /shop/b:', e?.message || e);
      res.status(500).send('Ошибка');
    }
  });

  app.get('/go/:shopId/:bouquetId/:type', async (req, res) => {
    try {
      const shopId = req.params.shopId;
      const type = req.params.type;
      
      const validTypes = ['tg', 'wa', 'max', 'call'];
      if (validTypes.indexOf(type) === -1) {
        return res.status(404).send('Не найдено');
      }
      
      const bouquetId = parseStrictInt(req.params.bouquetId);
      if (!bouquetId) return res.status(404).send('Букет не найден');
      
      const shop = await getShopFromDb(shopId);
      if (!shop) return res.status(404).send('Не найдено');
      if (shop.blocked) return res.status(403).send('Магазин заблокирован');
      if (!isSubscriptionActive(shop)) {
        return res.status(403).send('Подписка истекла');
      }
      
      const b = await getBouquetById(shopId, bouquetId);
      if (!b) return res.status(404).send('Букет не найден');

      let redirectUrl = null;
      let isMessengerPage = false;
      
      if (type === 'max') {
        if (!getSafeMaxLink(shop.maxLink)) {
          return res.status(404).send('Контакт не настроен');
        }
        isMessengerPage = true;
      } else if (type === 'tg') {
        if (!getSafeTgUsername(shop.telegramUsername)) {
          return res.status(404).send('Контакт не настроен');
        }
        isMessengerPage = true;
      } else if (type === 'wa') {
        const waPhone = shop.whatsappPhone ? 
          shop.whatsappPhone.replace(/\D/g, '') : '';
        if (waPhone.length < 10) {
          return res.status(404).send('Контакт не настроен');
        }
        redirectUrl = 'https://wa.me/' + waPhone;
      } else if (type === 'call') {
        const cleanPhone = shop.phone ? 
          shop.phone.replace(/\D/g, '') : '';
        if (cleanPhone.length < 10) {
          return res.status(404).send('Контакт не настроен');
        }
        redirectUrl = 'tel:' + cleanPhone;
      }

      const priceStr = formatPrice(b.price, shop);
      const orderText = 'Здравствуйте! Пишу с вашей витрины. ';
      const orderText2 = 'Хочу заказать букет №';
      const fullOrderText = orderText + orderText2 + b.shopNumber + 
        ' «' + b.name + '» — ' + priceStr + '.';

      const clientIp = req.ip || 'unknown';
      const clickKey = shopId + ':' + b.id + ':' + type + ':' + clientIp;
      const now = Date.now();
      
      if (notifiedClicks.size >= 1000) {
        const firstKey = notifiedClicks.keys().next().value;
        notifiedClicks.delete(firstKey);
      }

      const lastNotified = notifiedClicks.get(clickKey);
      
      // Защита от потери статистики при ошибке БД
      if (!lastNotified || now - lastNotified > CLICK_NOTIFY_TTL) {
        try {
          if (type === 'max' || type === 'tg' || type === 'wa') {
            await incrementShopStat(shopId, 'orders');
          } else if (type === 'call') {
            await incrementShopStat(shopId, 'calls');
          }
          
          await pool.query(
            'UPDATE bouquets SET clicks = COALESCE(clicks, 0) + 1 ' +
            'WHERE id = $1 AND shop_id = $2', [b.id, shopId]
          );
          
          notifiedClicks.set(clickKey, now);
          sendClickNotification(shop, b, type, bot);
        } catch (dbErr) {
          console.error('Ошибка статистики /go:', dbErr);
          // Не сохраняем в notifiedClicks, чтобы клиент мог повторить
        }
      }

      if (isMessengerPage) {
        return res.send(buildMessengerOrderPage({
          shop, bouquet: b, orderText: fullOrderText, messenger: type
        }));
      }
      
      if (redirectUrl) {
        if (type === 'wa') {
          redirectUrl += '?text=' + encodeURIComponent(fullOrderText);
        }
        
        let redirectHtml = '<!DOCTYPE html><html><head>';
        redirectHtml += '<meta charset="UTF-8">';
        redirectHtml += '<meta http-equiv="refresh" content="0; url=';
        redirectHtml += escAttr(redirectUrl) + '">';
        redirectHtml += '<title>Переход…</title></head>';
        redirectHtml += '<body style="font-family:-apple-system,sans-serif;';
        redirectHtml += 'text-align:center;padding:50px;color:#555;">';
        redirectHtml += '<p>Переходим к продавцу…</p>';
        redirectHtml += '<p><a href="' + escAttr(redirectUrl) + '">';
        redirectHtml += 'Нажмите, если не переходит автоматически</a></p>';
        redirectHtml += '</body></html>';
        return res.send(redirectHtml);
      }
      
      return res.status(404).send('Ошибка перехода');
    } catch (e) {
      console.error('Ошибка /go:', e?.message || e);
      res.status(500).send('Ошибка');
    }
  });

  app.get('/shop/:shopId', async (req, res) => {
    try {
      const shop = await getShopFromDb(req.params.shopId);
      if (!shop) return res.status(404).send('Магазин не найден');
      
      if (shop.blocked) {
        let h = '<html><body style="font-family:-apple-system,';
        h += 'sans-serif;text-align:center;padding:50px;">';
        h += '<h1>🚫 Магазин временно недоступен</h1>';
        h += '<p style="color:#666;">Приносим извинения.</p>';
        h += '</body></html>';
        return res.send(h);
      }
      
      if (!isSubscriptionActive(shop)) {
        let h = '<html><body style="font-family:-apple-system,';
        h += 'sans-serif;text-align:center;padding:50px;">';
        h += '<h1>🌸 ' + esc(shop.displayName) + '</h1>';
        h += '<p>Витрина приостановлена.</p></body></html>';
        return res.send(h);
      }

      const priceFilter = req.query.price || 'all';
      const sortParam = req.query.sort || 'default';
      const tagFilter = req.query.tag || 'all';

      const all = await getBouquetsFromDb(shop.shopId);
      
      const shopItems = await pool.query(
        'SELECT id, current_stock FROM wh_shop_items WHERE shop_id = $1',
        [shop.shopId]
      );
      const stockMap = Object.create(null);
      shopItems.rows.forEach(function(r) { 
        stockMap[r.id] = parseFloat(r.current_stock) || 0; 
      });

      const recipesQ = await pool.query(
        'SELECT r.bouquet_id, r.qty, r.alternatives, r.shop_item_id ' +
        'FROM wh_bouquet_recipes r ' +
        'JOIN wh_shop_items i ON i.id = r.shop_item_id ' +
        'WHERE i.shop_id = $1', [shop.shopId]
      );
      const recipeMap = Object.create(null);
      recipesQ.rows.forEach(function(r) {
        if (!recipeMap[r.bouquet_id]) recipeMap[r.bouquet_id] = [];
        recipeMap[r.bouquet_id].push(r);
      });

      let active = all.filter(function(b) {
        if (!isConfirmedRecently(b)) return false;
        if (b.whLinked && !b.preorderOnly) {
          const rList = recipeMap[b.id] || [];
          for (let i = 0; i < rList.length; i++) {
            const it = rList[i];
            let totalStock = stockMap[it.shop_item_id] || 0;
            if (it.alternatives && it.alternatives.length > 0) {
              const altIds = it.alternatives.map(function(a) {
                return typeof a === 'object' ? a.shop_item_id : a;
              });
              altIds.forEach(function(id) {
                totalStock += stockMap[id] || 0;
              });
            }
            if (totalStock < parseFloat(it.qty)) {
              return false;
            }
          }
        }
        return true;
      });

      // ТОЧНЫЙ ПОДСЧЕТ: берем количество ДО фильтрации по цене/тегам
      const totalActiveCount = active.length;
      
      const tagCounts = Object.create(null);
      for (const b of active) {
        for (const t of (b.tags || [])) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      }

      const activeBeforePrice = [...active];
      const ranges = getPriceRanges(shop);
      
      if (priceFilter === 'low') {
        active = active.filter(function(b) { return b.price < ranges[0]; });
      } else if (priceFilter === 'mid') {
        active = active.filter(function(b) {
          return b.price >= ranges[0] && b.price <= ranges[1];
        });
      } else if (priceFilter === 'mid2') {
        active = active.filter(function(b) {
          return b.price > ranges[1] && b.price <= ranges[2];
        });
      } else if (priceFilter === 'high1') {
        active = active.filter(function(b) {
          return b.price > ranges[2] && b.price <= ranges[3];
        });
      } else if (priceFilter === 'high2') {
        active = active.filter(function(b) { return b.price > ranges[3]; });
      }
      
      if (tagFilter !== 'all') {
        active = active.filter(function(b) {
          return (b.tags || []).includes(tagFilter);
        });
      }

      if (sortParam === 'asc') {
        active.sort(function(a, b) { return a.price - b.price; });
      } else if (sortParam === 'desc') {
        active.sort(function(a, b) { return b.price - a.price; });
      } else if (sortParam === 'fresh') {
        active.sort(function(a, b) {
          const da = new Date(a.confirmedAt || a.createdAt);
          const db = new Date(b.confirmedAt || b.createdAt);
          return db - da;
        });
      } else if (sortParam === 'popular') {
        active.sort(function(a, b) {
          return (b.clicks || 0) - (a.clicks || 0);
        });
      } else {
        active.sort(function(a, b) {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          const da = new Date(b.confirmedAt || b.createdAt);
          const db = new Date(a.confirmedAt || a.createdAt);
          return da - db;
        });
      }

      const buildUrl = function(newPrice, newSort, newTag) {
        const p = (newPrice !== undefined && newPrice !== null) 
          ? newPrice : priceFilter;
        const s = (newSort !== undefined && newSort !== null) 
          ? newSort : sortParam;
        const t = (newTag !== undefined && newTag !== null) 
          ? newTag : tagFilter;
        const parts = [];
        if (p && p !== 'all') parts.push('price=' + p);
        if (s && s !== 'default') parts.push('sort=' + s);
        if (t && t !== 'all') {
          parts.push('tag=' + encodeURIComponent(t));
        }
        return escAttr('/shop/' + shop.shopId + 
          (parts.length ? '?' + parts.join('&') : ''));
      };

      const pillBase = 'display:inline-block;padding:8px 16px;';
      const pillBase2 = 'margin:4px;border-radius:20px;';
      const pillBase3 = 'text-decoration:none;font-size:14px;';
      const pillBase4 = 'font-weight:700;';
      const pillCommon = pillBase + pillBase2 + pillBase3 + pillBase4;
      
      const sortBase = 'display:inline-block;padding:6px 12px;';
      const sortBase2 = 'margin:4px;border-radius:16px;';
      const sortBase3 = 'text-decoration:none;font-size:13px;';
      const sortCommon = sortBase + sortBase2 + sortBase3;
      
      const btnColors = getButtonColorsLocal(shop);
      const pillActive = 'background:' + btnColors.color + ';color:#fff;';
      const pillIdle = 'background:#f0f0f0;color:#555;';

      const pill = function(label, filterValue) {
        const isActive = priceFilter === filterValue;
        const style = pillCommon + (isActive ? pillActive : pillIdle);
        const href = buildUrl(filterValue, null, null);
        return '<a href="' + href + '" style="' + style + '">' + 
          label + '</a>';
      };

      const sortActive = 'background:' + btnColors.color + ';color:#fff;';
      const sortPill = function(label, sortValue) {
        const isActive = sortParam === sortValue;
        const style = sortCommon + (isActive ? sortActive : pillIdle);
        const href = buildUrl(null, sortValue, null);
        return '<a href="' + href + '" style="' + style + '">' + 
          label + '</a>';
      };

      let tagPillsHTML = '';
      const sortedTags = Object.entries(tagCounts)
        .sort(function(a, b) { return b[1] - a[1]; });
      
      if (sortedTags.length > 0) {
        const tagBase = 'display:inline-block;padding:6px 12px;';
        const tagBase2 = 'margin:4px;border-radius:16px;';
        const tagBase3 = 'text-decoration:none;font-size:13px;';
        const tagBase4 = 'font-weight:700;';
        const tagCommon = tagBase + tagBase2 + tagBase3 + tagBase4;
        const tagActive = 'background:' + btnColors.color + ';color:#fff;';
        
        let tagsHTML = '<a href="' + buildUrl(null, null, 'all') + '" ';
        tagsHTML += 'style="' + tagCommon + 
          (tagFilter === 'all' ? tagActive : pillIdle) + '">Все</a>';
        
        for (const [tag, count] of sortedTags) {
          const isActive = tagFilter === tag;
          const style = tagCommon + (isActive ? tagActive : pillIdle);
          tagsHTML += '<a href="' + buildUrl(null, null, tag) + '" ';
          tagsHTML += 'style="' + style + '">#' + esc(tag) + ' ' + 
            count + '</a>';
        }
        tagPillsHTML = '<div style="margin:10px 0 6px;">' + 
          tagsHTML + '</div>';
      }

      const pricesAll = activeBeforePrice.map(function(b) { return b.price; });
      const hasLow = pricesAll.some(function(p) { return p < ranges[0]; });
      const hasMid = pricesAll.some(function(p) {
        return p >= ranges[0] && p <= ranges[1];
      });
      const hasMid2 = pricesAll.some(function(p) {
        return p > ranges[1] && p <= ranges[2];
      });
      const hasHigh1 = pricesAll.some(function(p) {
        return p > ranges[2] && p <= ranges[3];
      });
      const hasHigh2 = pricesAll.some(function(p) { return p > ranges[3]; });
      
      let filtersHTML = tagPillsHTML;
      filtersHTML += '<div style="margin:10px 0 6px;">';
      filtersHTML += pill('Все', 'all');
      if (hasLow) filtersHTML += pill(
        'До ' + formatPricePill(ranges[0], shop), 'low'
      );
      if (hasMid) filtersHTML += pill(
        formatPricePill(ranges[0], shop) + '–' + 
        formatPricePill(ranges[1], shop), 'mid'
      );
      if (hasMid2) filtersHTML += pill(
        formatPricePill(ranges[1], shop) + '–' + 
        formatPricePill(ranges[2], shop), 'mid2'
      );
      if (hasHigh1) filtersHTML += pill(
        formatPricePill(ranges[2], shop) + '–' + 
        formatPricePill(ranges[3], shop), 'high1'
      );
      if (hasHigh2) filtersHTML += pill(
        'От ' + formatPricePill(ranges[3], shop), 'high2'
      );
      filtersHTML += '</div>';
      
      filtersHTML += '<div style="margin-bottom:20px;">';
      filtersHTML += sortPill('↓ Дешевле', 'asc');
      filtersHTML += sortPill('↑ Дороже', 'desc');
      filtersHTML += sortPill('🔥 Свежие', 'fresh');
      filtersHTML += sortPill('⭐ Популярные', 'popular');
      filtersHTML += '</div>';

      const useTwoColumns = active.length > TWO_COLUMNS_THRESHOLD;
      const gridStyle = useTwoColumns
        ? 'display:grid;grid-template-columns:minmax(0,1fr) ' +
          'minmax(0,1fr);gap:8px;max-width:760px;margin:0 auto;' +
          'align-items:stretch;'
        : 'display:flex;flex-wrap:wrap;justify-content:center;gap:8px;';
      const cardExtra = useTwoColumns
        ? 'width:100%;box-sizing:border-box;min-width:0;'
        : 'max-width:320px;';
        
      let cards = '';
      if (active.length === 0) {
        cards = '<div style="text-align:center;padding:50px;';
        cards += 'font-size:20px;color:#888;grid-column:1/-1;">';
        cards += '🌿 По этому фильтру букетов нет.</div>';
      } else {
        for (const b of active) {
          const photoRefsList = [];
          if (Array.isArray(b.photos)) {
            for (const p of b.photos) {
              const r = getPhotoRefsLocal(p);
              if (r.primary) photoRefsList.push(r);
            }
          }
          
          let gallery = '';
          if (photoRefsList.length === 0) {
            const grad = getPlaceholderGradientLocal(b.id);
            gallery = '<div class="card-photo" ';
            gallery += 'style="width:100%;aspect-ratio:4/5;';
            gallery += 'background:' + grad + ';display:flex;';
            gallery += 'align-items:center;justify-content:center;';
            gallery += 'color:#fff;font-size:44px;opacity:0.65;">📷</div>';
          } else if (photoRefsList.length === 1) {
            gallery = renderImgTag(
              photoRefsList[0], 
              'width:100%;aspect-ratio:4/5;object-fit:cover;display:block;'
            );
          } else {
            const slideStyle = 'height:100%;width:auto;';
            const slideStyle2 = 'flex-shrink:0;display:block;';
            const fullSlide = slideStyle + slideStyle2;
            let slides = '';
            for (const r of photoRefsList) {
              slides += renderImgTag(r, fullSlide);
            }
            gallery = '<div class="card-gallery-wrap" ';
            gallery += 'style="position:relative;width:100%;';
            gallery += 'aspect-ratio:4/5;overflow:hidden;">';
            gallery += '<div class="card-gallery" style="display:flex;';
            gallery += 'overflow-x:auto;gap:0;width:100%;height:100%;';
            gallery += 'scroll-snap-type:x mandatory;';
            gallery += '-webkit-overflow-scrolling:touch;';
            gallery += 'scrollbar-width:none;">';
            gallery += slides + '</div>';
            gallery += '<div class="card-dots" style="position:absolute;';
            gallery += 'bottom:8px;left:50%;transform:translateX(-50%);';
            gallery += 'display:flex;gap:4px;z-index:5;">';
            
            for (let i = 0; i < photoRefsList.length; i++) {
              const op = i === 0 ? '0.95' : '0.45';
              gallery += '<span data-i="' + i + '" ';
              gallery += 'style="display:inline-block;width:14px;';
              gallery += 'height:2px;border-radius:2px;';
              gallery += 'background:rgba(255,255,255,' + op + ');"></span>';
            }
            gallery += '</div>';
            gallery += '<span style="position:absolute;top:50%;right:8px;';
            gallery += 'transform:translateY(-50%);width:28px;height:28px;';
            gallery += 'background:rgba(255,255,255,0.85);';
            gallery += 'border-radius:50%;display:flex;align-items:center;';
            gallery += 'justify-content:center;font-size:14px;color:#333;';
            gallery += 'pointer-events:none;">›</span>';
            gallery += '</div>';
          }

          const oldPrice = calculateOldPrice(
            b.price, shop.settings ? shop.settings.markupPercent : 0
          );
          const bouquetUrl = SITE_URL + '/shop/' + 
            shop.shopId + '/b/' + b.id;
          const contactUrl = '/contact/' + shop.shopId + '/' + b.id;
          
          const urlEsc = escAttr(bouquetUrl);
          const nameEsc = escAttr(b.name);
          const contactUrlEsc = escAttr(contactUrl);
          
          const titleFS = useTwoColumns ? '14px' : '17px';
          const priceFS = useTwoColumns ? '20px' : '26px';
          const oldFS = useTwoColumns ? '13px' : '16px';

          const confirmedLine = formatConfirmedAt(b.confirmedAt);
          const confirmedHTML = confirmedLine
            ? '<div style="font-size:11px;color:#27ae60;' +
              'margin:2px 0 6px;font-weight:600;">✓ Обновлено ' +
              esc(confirmedLine) + '</div>'
            : '';

          let preorderBadge = '';
          if (b.preorderOnly) {
            preorderBadge = '<div style="display:inline-block;';
            preorderBadge += 'background:#FFF0EC;color:#E1846D;';
            preorderBadge += 'font-size:11px;font-weight:800;';
            preorderBadge += 'padding:2px 8px;border-radius:10px;';
            preorderBadge += 'margin-top:6px;">Только предзаказ</div>';
          }

          const btnGrad = 'linear-gradient(135deg,' + 
            btnColors.color + ',' + btnColors.dark + ')';
          const btnShadow = '0 4px 14px ' + btnColors.color + '55';

          let card = '<div class="card" style="border:none;';
          card += 'border-radius:6px;padding:0;margin:0;' + cardExtra;
          card += 'background:#fff;box-shadow:0 2px 12px rgba(0,0,0,0.06);';
          card += 'text-align:center;position:relative;display:flex;';
          card += 'flex-direction:column;overflow:hidden;';
          card += 'transition:transform 0.25s ease,box-shadow 0.25s ease,';
          card += 'opacity 0.4s ease;will-change:transform;">';
          card += '<div style="position:absolute;top:10px;right:10px;';
          card += 'background:rgba(44,62,80,0.85);color:#fff;';
          card += 'padding:3px 10px;border-radius:12px;font-size:11px;';
          card += 'font-weight:700;z-index:10;backdrop-filter:blur(4px);">';
          card += '№' + b.shopNumber + '</div>';
          card += gallery;
          card += '<div style="padding:10px 12px 12px;">';
          card += '<h3 class="card-title" style="margin:0 0 4px;';
          card += 'font-size:' + titleFS + ';line-height:1.3;';
          card += 'display:-webkit-box;-webkit-line-clamp:2;';
          card += '-webkit-box-orient:vertical;overflow:hidden;';
          card += 'font-weight:600;color:#2c3e50;">';
          card += esc(b.name) + '</h3>';
          
          card += '<p style="font-size:' + priceFS + ';font-weight:800;';
          card += 'color:#2c3e50;margin:4px 0 4px;';
          card += 'letter-spacing:-0.5px;">';
          
          if (oldPrice > b.price) {
            card += '<span style="text-decoration:line-through;';
            card += 'color:#b0b0b0;font-weight:400;font-size:' + oldFS + ';';
            card += 'margin-right:6px;">';
            card += formatPrice(oldPrice, shop) + '</span>';
          }
          card += formatPrice(b.price, shop) + '</p>';
          card += confirmedHTML;
          card += preorderBadge;
          card += '<div style="margin-top:auto;padding-top:8px;">';
          card += '<a href="' + contactUrlEsc + '" style="display:block;';
          card += 'margin:8px auto 0;background:' + btnGrad + ';';
          card += 'color:#fff;padding:12px 16px;border-radius:24px;';
          card += 'text-decoration:none;font-weight:700;';
          card += 'text-align:center;font-size:14px;';
          card += 'box-shadow:' + btnShadow + ';">📞 Связаться</a>';
          card += '<div style="margin-top:6px;">';
          
          // Защита от NaN и Infinity
          const safePrice = Number(b.price) || 0;
          
          card += '<a href="#" class="share-btn" ';
          card += 'data-url="' + urlEsc + '" ';
          card += 'data-name="' + nameEsc + '" ';
          card += 'data-price="' + safePrice + '" ';
          card += 'style="display:inline-block;color:#999;font-size:11px;';
          card += 'text-decoration:none;padding:5px 10px;';
          card += 'border-radius:14px;background:#f7f3ee;">';
          card += '📤 Поделиться</a>';
          
          card += '</div></div></div></div>';
          cards += card;
        }
      }
      
      const settings = shop.settings || {};
      
      let coverUrl = null;
      if (settings.cover) {
        const coverRefs = getPhotoRefsLocal(settings.cover);
        coverUrl = absoluteUrl(coverRefs.primary);
      }
      
      let logoUrl = null;
      if (settings.logo) {
        const logoRefs = getPhotoRefsLocal(settings.logo);
        logoUrl = absoluteUrl(logoRefs.primary);
      }
      
      const bodyBg = getBackgroundStyle(settings.background);

      let coverHTML = '';
      if (coverUrl) {
        coverHTML = '<div style="max-width:760px;margin:0 auto 12px;';
        coverHTML += 'border-radius:20px;overflow:hidden;position:relative;';
        coverHTML += 'box-shadow:0 6px 28px rgba(0,0,0,0.12);">';
        coverHTML += '<img src="' + escAttr(coverUrl) + '" ';
        coverHTML += 'style="width:100%;display:block;height:280px;';
        coverHTML += 'object-fit:cover;">';
        coverHTML += '<div style="position:absolute;left:0;right:0;';
        coverHTML += 'bottom:0;padding:60px 24px 20px;';
        coverHTML += 'background:linear-gradient(180deg,';
        coverHTML += 'rgba(0,0,0,0) 0%,rgba(0,0,0,0.35) 40%,';
        coverHTML += 'rgba(0,0,0,0.72) 100%);';
        coverHTML += 'color:#fff;text-align:center;">';
        coverHTML += '<h1 style="margin:0 0 8px;font-size:26px;';
        coverHTML += 'font-weight:800;letter-spacing:-0.5px;color:#fff;';
        coverHTML += 'text-shadow:0 2px 12px rgba(0,0,0,0.5);">';
        coverHTML += esc(shop.displayName) + '</h1>';
        
        if (shop.address || shop.hours) {
          coverHTML += '<div style="font-size:14px;line-height:1.5;';
          coverHTML += 'color:rgba(255,255,255,0.94);';
          coverHTML += 'text-shadow:0 1px 8px rgba(0,0,0,0.6);">';
          if (shop.address) coverHTML += '📍 ' + esc(shop.address);
          if (shop.hours) {
            if (shop.address) coverHTML += '<br>';
            coverHTML += '🕐 ' + esc(shop.hours);
          }
          coverHTML += '</div>';
        }
        coverHTML += '</div></div>';
      }

      const headerHTML = logoUrl
        ? '<img src="' + escAttr(logoUrl) + '" ' +
          'style="max-height:80px;display:block;margin:0 auto 12px;">'
        : '';
        
      const cntWord = plural(
        totalActiveCount, 'букет', 'букета', 'букетов'
      );
      const countLine = totalActiveCount > 0
        ? '<div style="font-size:13px;color:#27ae60;' +
          'margin-top:6px;font-weight:700;">🌸 ' +
          totalActiveCount + ' ' + cntWord + ' в наличии</div>'
        : '';

      let titleHTML = '';
      if (!coverUrl) {
        titleHTML = '<div style="background:rgba(255,255,255,0.92);';
        titleHTML += 'border-radius:14px;padding:16px 22px;';
        titleHTML += 'max-width:560px;margin:0 auto 20px;';
        titleHTML += 'box-shadow:0 4px 20px rgba(0,0,0,0.06);';
        titleHTML += 'backdrop-filter:blur(8px);">';
        titleHTML += '<h1 style="color:#2c3e50;margin:0 0 8px;';
        titleHTML += 'font-size:26px;font-weight:800;';
        titleHTML += 'letter-spacing:-0.5px;">';
        titleHTML += esc(shop.displayName) + '</h1>';
        
        if (shop.address || shop.hours) {
          titleHTML += '<div style="color:#666;font-size:14px;';
          titleHTML += 'line-height:1.5;">';
          if (shop.address) titleHTML += '📍 ' + esc(shop.address);
          if (shop.hours) {
            if (shop.address) titleHTML += '<br>';
            titleHTML += '🕐 ' + esc(shop.hours);
          }
          titleHTML += '</div>';
        }
        titleHTML += countLine + '</div>';
      }

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0">';
      html += '<title>' + esc(shop.displayName) + ' — Flowind</title>';
      html += MANROPE_LINK;
      html += '<style>';
      html += 'body{font-family:Manrope,-apple-system,sans-serif;';
      html += 'margin:0;padding:20px 14px;text-align:center;' + bodyBg + '}\n';
      html += 'h1{color:#2c3e50;}\n';
      html += '.container{max-width:1200px;margin:0 auto;}\n';
      html += '.shop-grid img{cursor:zoom-in;}\n';
      html += '.card{opacity:0;transform:translateY(14px);}\n';
      html += '.card.visible{opacity:1;transform:translateY(0);}\n';
      html += '.card-gallery::-webkit-scrollbar{display:none;}\n';
      html += '@media (hover: hover){.card:hover{transform:translateY(-3px);';
      html += 'box-shadow:0 10px 32px rgba(0,0,0,0.12) !important;}}\n';
      html += '.card:active{transform:translateY(-2px);}\n';
      html += '@media (prefers-reduced-motion: reduce){';
      html += '.card{opacity:1;transform:none;transition:none !important;}\n';
      html += '.card:active,.card:hover{transform:none;}}\n';
      html += '</style></head><body>';
      html += '<div class="container">';
      html += headerHTML + coverHTML + titleHTML + filtersHTML;
      html += '<div class="shop-grid" style="' + gridStyle + '">' + 
        cards + '</div></div>';
      
      html += '<div id="lightbox" onclick="closeLightbox()" ';
      html += 'style="display:none;position:fixed;inset:0;';
      html += 'background:rgba(0,0,0,0.92);z-index:9999;';
      html += 'align-items:center;justify-content:center;padding:20px;';
      html += 'box-sizing:border-box;touch-action:none;">';
      html += '<img id="lightbox-img" src="" alt="" style="max-width:100%;';
      html += 'max-height:100%;border-radius:10px;';
      html += 'box-shadow:0 8px 40px rgba(0,0,0,0.6);">';
      html += '<button onclick="closeLightbox()" style="position:fixed;';
      html += 'top:20px;right:20px;background:rgba(255,255,255,0.95);';
      html += 'border:none;width:44px;height:44px;border-radius:50%;';
      html += 'font-size:22px;cursor:pointer;font-weight:bold;color:#333;';
      html += 'box-shadow:0 2px 8px rgba(0,0,0,0.4);">✕</button></div>';

      html += '<script>\n';
      html += 'var lbImages = []; var lbIndex = 0; ';
      html += 'var touchStartX = 0; var touchStartY = 0;\n';
      html += 'function shareBouquet(url, name, price) {\n';
      html += '  var text = name + " — " + price;\n';
      html += '  if (navigator.share) {\n';
      html += '    navigator.share({ title: name, text: text, url: url })';
      html += '.catch(function(){});\n';
      html += '  } else if (navigator.clipboard && ';
      html += 'navigator.clipboard.writeText) {\n';
      html += '    navigator.clipboard.writeText(url).then(function(){ ';
      html += 'alert("Ссылка скопирована"); }).catch(function(){ ';
      html += 'prompt("Скопируйте ссылку:", url); });\n';
      html += '  } else { prompt("Скопируйте ссылку:", url); }\n';
      html += '}\n';
      
      html += 'document.addEventListener("click", function(e) {\n';
      html += '  var btn = e.target.closest(".share-btn");\n';
      html += '  if (!btn) return;\n';
      html += '  e.preventDefault();\n';
      html += '  var url = btn.getAttribute("data-url");\n';
      html += '  var name = btn.getAttribute("data-name");\n';
      html += '  var price = btn.getAttribute("data-price");\n';
      html += '  shareBouquet(url, name, price);\n';
      html += '});\n';

      html += 'function openLightbox(images, index) {\n';
      html += '  lbImages = images; lbIndex = index;\n';
      html += '  var lb = document.getElementById("lightbox");\n';
      html += '  var img = document.getElementById("lightbox-img");\n';
      html += '  img.src = lbImages[lbIndex]; lb.style.display = "flex";\n';
      html += '  document.body.style.overflow = "hidden";\n';
      html += '}\n';
      html += 'function closeLightbox() {\n';
      html += '  document.getElementById("lightbox").style.display = "none";\n';
      html += '  document.getElementById("lightbox-img").src = "";\n';
      html += '  document.body.style.overflow = "";\n';
      html += '}\n';
      html += 'function lbNext() {\n';
      html += '  if (lbImages.length < 2) return;\n';
      html += '  lbIndex = (lbIndex + 1) % lbImages.length;\n';
      html += '  document.getElementById("lightbox-img").src = ';
      html += 'lbImages[lbIndex];\n';
      html += '}\n';
      html += 'function lbPrev() {\n';
      html += '  if (lbImages.length < 2) return;\n';
      html += '  lbIndex = (lbIndex - 1 + lbImages.length) % lbImages.length;\n';
      html += '  document.getElementById("lightbox-img").src = ';
      html += 'lbImages[lbIndex];\n';
      html += '}\n';
      html += 'document.addEventListener("click", function(e) {\n';
      html += '  var img = e.target.closest(".shop-grid img");\n';
      html += '  if (!img) return; e.preventDefault(); e.stopPropagation();\n';
      html += '  var card = img.closest(".card");\n';
      html += '  if (!card) { openLightbox([img.src], 0); return; }\n';
      html += '  var imgs = card.querySelectorAll("img");\n';
      html += '  var arr = []; var idx = 0;\n';
      html += '  for (var i = 0; i < imgs.length; i++) {\n';
      html += '    arr.push(imgs[i].src); if (imgs[i] === img) idx = i;\n';
      html += '  }\n';
      html += '  if (arr.length === 0) { arr = [img.src]; idx = 0; }\n';
      html += '  openLightbox(arr, idx);\n';
      html += '});\n';
      html += 'document.addEventListener("keydown", function(e) {\n';
      html += '  var lb = document.getElementById("lightbox");\n';
      html += '  if (!lb || lb.style.display !== "flex") return;\n';
      html += '  if (e.key === "Escape") closeLightbox();\n';
      html += '  if (e.key === "ArrowRight") lbNext();\n';
      html += '  if (e.key === "ArrowLeft") lbPrev();\n';
      html += '});\n';
      html += 'var lbEl = document.getElementById("lightbox");\n';
      html += 'lbEl.addEventListener("touchstart", function(e) {\n';
      html += '  if (!e.touches || e.touches.length === 0) return;\n';
      html += '  touchStartX = e.touches[0].clientX;\n';
      html += '  touchStartY = e.touches[0].clientY;\n';
      html += '}, { passive: true });\n';
      html += 'lbEl.addEventListener("touchend", function(e) {\n';
      html += '  if (!e.changedTouches || ';
      html += 'e.changedTouches.length === 0) return;\n';
      html += '  var dx = e.changedTouches[0].clientX - touchStartX;\n';
      html += '  var dy = e.changedTouches[0].clientY - touchStartY;\n';
      html += '  if (Math.abs(dx) < 40) return;\n';
      html += '  if (Math.abs(dx) < Math.abs(dy)) return;\n';
      html += '  if (dx < 0) lbNext(); else lbPrev();\n';
      html += '}, { passive: true });\n';
      html += 'var galWraps = document.querySelectorAll(".card-gallery-wrap");\n';
      html += 'for (var gw = 0; gw < galWraps.length; gw++) {\n';
      html += '  (function(wrap) {\n';
      html += '    var gal = wrap.querySelector(".card-gallery");\n';
      html += '    var dots = wrap.querySelectorAll(".card-dots span");\n';
      html += '    if (!gal || !dots || !dots.length) return;\n';
      html += '    gal.addEventListener("scroll", function() {\n';
      html += '      var w = gal.clientWidth; if (!w) return;\n';
      html += '      var i = Math.round(gal.scrollLeft / w);\n';
      html += '      for (var j = 0; j < dots.length; j++) {\n';
      html += '        dots[j].style.background = j === i ? ';
      html += '"rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)";\n';
      html += '      }\n';
      html += '    }, { passive: true });\n';
      html += '  })(galWraps[gw]);\n';
      html += '}\n';
      
      html += 'if ("IntersectionObserver" in window) {\n';
      html += '  var obs = new IntersectionObserver(function(entries){\n';
      html += '    entries.forEach(function(en){\n';
      html += '      if (en.isIntersecting) {\n';
      html += '        en.target.classList.add("visible"); ';
      html += 'obs.unobserve(en.target);\n';
      html += '      }\n';
      html += '    });\n';
      html += '  }, { threshold: 0.1 });\n';
      html += '  var allCards = document.querySelectorAll(".card");\n';
      html += '  for (var c = 0; c < allCards.length; c++) {\n';
      html += '    obs.observe(allCards[c]);\n';
      html += '  }\n';
      html += '} else {\n';
      html += '  var allCards2 = document.querySelectorAll(".card");\n';
      html += '  for (var c2 = 0; c2 < allCards2.length; c2++) {\n';
      html += '    allCards2[c2].classList.add("visible");\n';
      html += '  }\n';
      html += '}\n';
      html += '</script></body></html>';
      
      res.send(html);
    } catch (e) {
      console.error('Ошибка витрины:', e?.message || e);
      res.status(500).send('Ошибка');
    }
  });
}

module.exports = { setupStorefront };