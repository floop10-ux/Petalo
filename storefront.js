const https = require('https');
const pool = require('./db');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

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

const TWO_COLUMNS_THRESHOLD = 12;
const CLICK_NOTIFY_TTL = 10 * 60 * 1000;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const PHOTO_TIMEOUT = 12000;

const notifiedClicks = new Map();
let cleanupStarted = false;

// Безопасная вставка данных в <script>
function safeJson(value) {
  try {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  } catch (e) {
    return 'null';
  }
}

function parseStrictInt(value) {
  if (typeof value !== 'string') return null;
  if (!/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result)) return null;
  return result;
}

function isValidShopId(value) {
  return typeof value === 'string' &&
    /^[a-z0-9_-]{2,50}$/i.test(value);
}

function safeNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback === undefined ? 0 : fallback;
  }
  return number;
}

// Разрешаем файлы в папках магазинов И корневые wh_* файлы
function isValidS3Key(key) {
  if (typeof key !== 'string' || !key) return false;
  if (key.length > 500) return false;
  if (key.includes('..') || key.includes('\\')) return false;
  if (key.startsWith('/') || key.endsWith('/')) return false;
  if (/[\x00-\x1f\x7f]/.test(key)) return false;

  if (!/^[a-zA-Z0-9_\-./ ]+$/.test(key)) return false;

  if (!key.includes('/') && !key.startsWith('wh_')) {
    return false;
  }

  const ext = key.split('.').pop().toLowerCase();
  const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
  return allowed.indexOf(ext) !== -1;
}

function getSafeMaxLink(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(
    /^(?:https:\/\/)?(?:max\.ru|max\.me)\/([a-zA-Z0-9_-]+)\/?$/i
  );
  if (!match) return null;
  return 'https://max.ru/' + match[1];
}

function getSafeTgUsername(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) return null;
  return username;
}

function getSafePhone(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }
  return String(value).replace(/\D/g, '').slice(0, 20);
}

// Безопасный CSS URL (разрешаем https и локальные пути)
function getSafeCssUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  if (!url || url.length > 2000) return '';
  if (/[\r\n"'()\\]/.test(url)) return '';

  if (url.startsWith('/')) {
    return 'url("' + url + '")';
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      return 'url("' + parsed.href + '")';
    }
  } catch (e) {}

  return '';
}

function absoluteUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  if (/^https:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:') return '';
      if (parsed.username || parsed.password) return '';
      return parsed.href;
    } catch (e) {
      return '';
    }
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return '';
  }
  return SITE_URL.replace(/\/+$/, '') + value;
}

function findColorById(id) {
  const colors = [
    { id: 'red', color: '#e74c3c', dark: '#c0392b' },
    { id: 'pink', color: '#e91e63', dark: '#ad1457' },
    { id: 'green', color: '#27ae60', dark: '#1e8449' },
    { id: 'graphite', color: '#2c3e50', dark: '#1a252f' },
    { id: 'blue', color: '#3498db', dark: '#21618c' },
    { id: 'lavender', color: '#9b59b6', dark: '#71368a' }
  ];
  for (const item of colors) {
    if (item.id === id) return item;
  }
  return colors[0];
}

function getButtonColorsLocal(shop) {
  const settings = shop && shop.settings ? shop.settings : {};
  return findColorById(settings.buttonColor || 'red');
}

function isPresetBackground(background) {
  if (!background || typeof background !== 'object') {
    return false;
  }
  return background.type === 'preset' &&
    Number.isInteger(Number(background.id));
}

function getPlaceholderGradientLocal(id) {
  const gradients = [
    'linear-gradient(135deg,#fbe8ef 0%,#f7dae5 100%)',
    'linear-gradient(135deg,#e8f0e5 0%,#dfe8db 100%)',
    'linear-gradient(135deg,#eaeef3 0%,#dee5ec 100%)',
    'linear-gradient(135deg,#f9e8de 0%,#f4dcd0 100%)',
    'linear-gradient(135deg,#f2eeea 0%,#e8e3dc 100%)'
  ];
  const index = Math.abs(Number(id) || 0) % gradients.length;
  return gradients[index];
}

function getPhotoUrlKey(value, bucket, endpoint) {
  if (typeof value !== 'string' || !value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.search || parsed.hash) return null;

  if (endpoint) {
    let expected;
    try {
      expected = new URL(endpoint);
    } catch (e) {
      return null;
    }
    if (parsed.hostname !== expected.hostname) return null;
    if (parsed.port !== expected.port) return null;
    const basePath = expected.pathname.replace(/\/+$/, '');
    if (basePath && !parsed.pathname.startsWith(basePath + '/')) {
      return null;
    }
  }

  let path;
  try {
    path = decodeURIComponent(parsed.pathname || '');
  } catch (e) {
    return null;
  }
  path = path.replace(/^\/+/, '');

  if (endpoint) {
    const expected = new URL(endpoint);
    const basePath = expected.pathname.replace(/\/+$/, '');
    if (basePath) {
      path = path.slice(basePath.length);
      path = path.replace(/^\/+/, '');
    }
  }

  if (bucket && path.startsWith(bucket + '/')) {
    path = path.slice(bucket.length + 1);
  }

  return isValidS3Key(path) ? path : null;
}

function getPrimaryS3Key(value, s3ctx) {
  if (!s3ctx || !s3ctx.YC_BUCKET) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return null;
    const expectedHost = s3ctx.YC_BUCKET + '.storage.yandexcloud.net';
    if (parsed.hostname === expectedHost) {
      if (parsed.search || parsed.hash) return null;
      let key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      return isValidS3Key(key) ? key : null;
    }
    return getPhotoUrlKey(value, s3ctx.YC_BUCKET, 'https://storage.yandexcloud.net');
  } catch (e) {
    return null;
  }
}

function getBackupS3Key(value, s3ctx) {
  if (!s3ctx || !s3ctx.BC_BUCKET || !s3ctx.BC_ENDPOINT) return null;
  return getPhotoUrlKey(value, s3ctx.BC_BUCKET, s3ctx.BC_ENDPOINT);
}

function getPhotoRefsLocal(photo, s3ctx) {
  const result = { primary: null, backup: null, telegram: null };
  if (!photo) return result;

  if (typeof photo === 'string') {
    if (/^https:\/\//i.test(photo)) {
      const primaryKey = getPrimaryS3Key(photo, s3ctx);
      const backupKey = getBackupS3Key(photo, s3ctx);
      if (primaryKey) {
        result.primary = '/photo/s3/' + primaryKey;
      } else if (backupKey) {
        result.backup = '/photo/s3b/' + backupKey;
      } else {
        result.primary = photo;
      }
      return result;
    }
    if (isValidFileId(photo)) {
      result.telegram = '/photo/tg/' + encodeURIComponent(photo);
    }
    return result;
  }

  if (typeof photo !== 'object') return result;

  if (typeof photo.s3 === 'string') {
    const key = getPrimaryS3Key(photo.s3, s3ctx);
    if (key) result.primary = '/photo/s3/' + key;
  }
  if (typeof photo.s3b === 'string') {
    const key = getBackupS3Key(photo.s3b, s3ctx);
    if (key) result.backup = '/photo/s3b/' + key;
  }
  if (typeof photo.tg === 'string' && isValidFileId(photo.tg)) {
    result.telegram = '/photo/tg/' + encodeURIComponent(photo.tg);
  }

  if (!result.primary && result.backup) {
    result.primary = result.backup;
    result.backup = null;
  }
  if (!result.primary && result.telegram) {
    result.primary = result.telegram;
    result.telegram = null;
  }

  return result;
}

function getPhotoSources(photoRefs) {
  if (!photoRefs) return [];
  const values = [photoRefs.primary, photoRefs.backup, photoRefs.telegram];
  const result = [];
  for (const value of values) {
    if (typeof value === 'string' && value && result.indexOf(value) === -1) {
      result.push(value);
    }
  }
  return result;
}

function renderImgTag(photoRefs, style, alt) {
  const sources = getPhotoSources(photoRefs);
  if (!sources.length) return '';

  let html = '<img src="' + escAttr(sources[0]) + '"';
  html += ' alt="' + escAttr(alt || '') + '"';
  html += ' loading="lazy" decoding="async"';
  html += ' referrerpolicy="no-referrer"';

  if (style) html += ' style="' + escAttr(style) + '"';

  if (sources.length > 1) {
    html += ' data-fallback="' + escAttr(safeJson(sources.slice(1))) + '"';
  }

  html += ' onerror="flowindPhotoFallback(this)">';
  return html;
}

function getBackgroundStyle(background, s3ctx) {
  const presets = {
    1: 'linear-gradient(180deg,#fdf9f3 0%,#fafaf8 40%,#f7f5f1 100%)',
    2: 'linear-gradient(180deg,#ffffff 0%,#fafafa 60%,#f5f5f5 100%)',
    3: 'linear-gradient(180deg,#fdf2f5 0%,#fbe8ef 50%,#f7dae5 100%)',
    4: 'linear-gradient(180deg,#f2f7f0 0%,#e8f0e5 50%,#dfe8db 100%)',
    5: 'linear-gradient(180deg,#f5f7fa 0%,#eaeef3 50%,#dee5ec 100%)',
    6: 'linear-gradient(180deg,#fdf5f0 0%,#f9e8de 50%,#f4dcd0 100%)',
    7: 'linear-gradient(180deg,#fbfaf8 0%,#f2eeea 50%,#e8e3dc 100%)',
    8: 'linear-gradient(180deg,#f5f7fa 0%,#e8edf3 50%,#dce3ea 100%)',
    9: 'linear-gradient(180deg,#fff5f7 0%,#fce4ea 50%,#f8d5de 100%)',
    10: 'linear-gradient(180deg,#fdf4ea 0%,#f8e4cf 50%,#f2d4b6 100%)'
  };

  if (isPresetBackground(background)) {
    const id = String(background.id);
    return 'background:' + (presets[id] || presets[1]) + ';background-attachment:fixed;';
  }

  const refs = getPhotoRefsLocal(background, s3ctx);
  const sources = getPhotoSources(refs);

  if (sources.length) {
    const safe = getSafeCssUrl(sources[0]);
    if (safe) {
      return 'background-image:' + safe + ';background-size:cover;background-attachment:fixed;';
    }
  }

  return 'background:' + presets[1] + ';background-attachment:fixed;';
}

function plural(number, one, few, many) {
  const n = Math.abs(Number(number) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

function formatConfirmedAt(dateValue) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  
  const now = new Date();
  const diffMs = now - date;
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffHrs < 1) return 'только что';
  if (diffHrs < 24) return diffHrs + ' ч. назад';
  
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return 'вчера';
  return diffDays + ' дн. назад';
}

function buildPageHead(title, description, imageUrl) {
  let html = '<!DOCTYPE html><html lang="ru"><head>';
  html += '<meta charset="UTF-8">';
  html += '<meta name="viewport" content="width=device-width,initial-scale=1">';
  html += '<meta name="theme-color" content="#F8F5F1">';
  html += '<title>' + esc(title) + '</title>';
  html += '<meta name="description" content="' + escAttr(description || '') + '">';

  if (imageUrl) {
    html += '<meta property="og:image" content="' + escAttr(imageUrl) + '">';
  }

  html += '<meta property="og:title" content="' + escAttr(title) + '">';
  html += '<meta property="og:description" content="' + escAttr(description || '') + '">';
  
  const manrope = '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?' +
    'family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">';
    
  html += manrope;
  return html;
}

function buildPhotoFallbackScript() {
  let html = '<script>';
  html += 'function flowindPhotoFallback(img){';
  html += 'var raw=img.getAttribute("data-fallback");';
  html += 'if(!raw){img.onerror=null;return;}';
  html += 'var list=[];';
  html += 'try{list=JSON.parse(raw);}catch(e){}';
  html += 'if(!list.length){img.onerror=null;return;}';
  html += 'var next=list.shift();';
  html += 'img.setAttribute("data-fallback",JSON.stringify(list));';
  html += 'img.src=next;';
  html += '}';
  html += '</script>';
  return html;
}

function buildBouquetPage(data) {
  const shop = data.shop;
  const bouquet = data.bouquet;
  const photoRefs = data.photoRefs;
  const otherPhotoRefs = data.otherPhotoRefs || [];
  const s3ctx = data.s3ctx;

  const title = bouquet.name + ' — ' + shop.displayName;
  const description = 'Букет №' + bouquet.shopNumber + ' «' + bouquet.name + '». Цена: ' + formatPrice(bouquet.price, shop);

  const sources = getPhotoSources(photoRefs);
  const imageUrl = sources.length ? absoluteUrl(sources[0]) : '';
  const bodyBg = getBackgroundStyle(shop.settings ? shop.settings.background : null, s3ctx);
  const btnColors = getButtonColorsLocal(shop);

  let html = buildPageHead(title, description, imageUrl);

  html += '<style>';
  html += 'body{font-family:Manrope,-apple-system,sans-serif;margin:0;padding:20px;';
  html += bodyBg;
  html += 'text-align:center;color:#2c3e50;}';
  html += '.container{max-width:560px;margin:0 auto;padding:12px 0;}';
  html += '.back{display:inline-block;margin-bottom:16px;color:#888;text-decoration:none;font-size:14px;}';
  html += 'h1{font-size:26px;margin:16px 0 8px;line-height:1.3;font-weight:800;}';
  html += '.price{font-size:30px;font-weight:800;margin:8px 0 20px;color:' + btnColors.color + ';}';
  html += '.card{background:#fff;border-radius:22px;padding:20px;box-shadow:0 6px 24px rgba(0,0,0,0.07);margin:20px 0;}';
  html += '.share{display:inline-block;margin-top:20px;color:#888;text-decoration:none;font-size:14px;padding:10px 16px;border-radius:20px;background:#f0f0f0;}';
  html += '</style></head><body>';

  html += '<div class="container">';
  html += '<a class="back" href="/shop/' + escAttr(shop.shopId) + '">← К витрине</a>';
  
  if (photoRefs) {
    html += '<div>' + renderImgTag(photoRefs, 'width:100%;max-width:500px;border-radius:20px;box-shadow:0 6px 24px rgba(0,0,0,0.12);', bouquet.name) + '</div>';
  }

  if (otherPhotoRefs.length) {
    html += '<div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap;">';
    for (const r of otherPhotoRefs) {
      html += renderImgTag(r, 'width:70px;height:70px;object-fit:cover;border-radius:12px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.12);', bouquet.name);
    }
    html += '</div>';
  }

  html += '<h1>' + esc(bouquet.name) + '</h1>';

  if (bouquet.preorderOnly) {
    html += '<div style="display:inline-block;background:#FFF0EC;color:#E1846D;font-size:13px;font-weight:800;padding:6px 16px;border-radius:20px;margin-bottom:16px;">Только предзаказ</div>';
  }

  const oldPrice = calculateOldPrice(bouquet.price, shop.settings ? shop.settings.markupPercent : 0);
  html += '<div class="price">';
  if (oldPrice > safeNumber(bouquet.price)) {
    html += '<span style="text-decoration:line-through;color:#999;font-weight:400;font-size:20px;margin-right:6px;">' + formatPrice(oldPrice, shop) + '</span>';
  }
  html += formatPrice(bouquet.price, shop);
  html += '</div>';

  html += '<div class="card">';
  
  const waPhone = getSafePhone(shop.whatsappPhone);
  const cleanPhone = getSafePhone(shop.phone);
  const btnBase = 'display:block;margin-top:8px;color:#fff;padding:14px 20px;border-radius:30px;text-decoration:none;font-weight:700;text-align:center;font-size:16px;';
  
  let buttonsHtml = '';
  if (waPhone.length >= 10) {
    buttonsHtml += '<a href="/go/' + escAttr(shop.shopId) + '/' + bouquet.id + '/wa" style="' + btnBase + 'background:#25D366;">💬 Написать в WhatsApp</a>';
  }
  if (getSafeTgUsername(shop.telegramUsername)) {
    buttonsHtml += '<a href="/go/' + escAttr(shop.shopId) + '/' + bouquet.id + '/tg" style="' + btnBase + 'background:#229ED9;">📩 Написать в Telegram</a>';
  }
  if (getSafeMaxLink(shop.maxLink)) {
    buttonsHtml += '<a href="/go/' + escAttr(shop.shopId) + '/' + bouquet.id + '/max" style="' + btnBase + 'background:#7B68EE;">🟼 Написать в MAX</a>';
  }
  if (cleanPhone.length >= 10) {
    buttonsHtml += '<a href="/go/' + escAttr(shop.shopId) + '/' + bouquet.id + '/call" style="' + btnBase + 'background:' + btnColors.color + ';">📞 Позвонить</a>';
  }

  if (!buttonsHtml) {
    buttonsHtml = '<div style="color:#888;padding:10px;">Контакты временно недоступны</div>';
  }
  html += buttonsHtml;
  html += '</div>';

  html += '<a class="share" href="#" onclick="shareBouquet(); return false;">📤 Поделиться с близкими</a>';
  html += '</div>';

  html += '<script>';
  html += 'function shareBouquet() {';
  html += 'var url = ' + safeJson(SITE_URL + '/shop/' + escAttr(shop.shopId) + '/b/' + bouquet.id) + ';';
  html += 'var name = ' + safeJson(bouquet.name) + ';';
  html += 'var price = ' + safeJson(formatPrice(bouquet.price, shop)) + ';';
  html += 'var text = name + " — " + price;';
  html += 'if (navigator.share) {';
  html += 'navigator.share({ title: name, text: text, url: url }).catch(function(){});';
  html += '} else if (navigator.clipboard && navigator.clipboard.writeText) {';
  html += 'navigator.clipboard.writeText(url).then(function(){ alert("Ссылка скопирована"); }).catch(function(){ prompt("Скопируйте ссылку:", url); });';
  html += '} else { prompt("Скопируйте ссылку:", url); }';
  html += '}';
  html += '</script>';

  html += buildPhotoFallbackScript();
  html += '</body></html>';

  return html;
}
function buildContactPage(data) {
  const shop = data.shop;
  const bouquet = data.bouquet;
  const photoRefs = data.photoRefs;
  const s3ctx = data.s3ctx;

  const title = 'Заказать букет — ' + shop.displayName;
  const description = 'Свяжитесь с магазином, чтобы заказать букет.';

  const sources = getPhotoSources(photoRefs);
  const imageUrl = sources.length ? absoluteUrl(sources[0]) : '';
  const bodyBg = getBackgroundStyle(shop.settings ? shop.settings.background : null, s3ctx);
  const btnColors = getButtonColorsLocal(shop);

  let html = buildPageHead(title, description, imageUrl);

  html += '<style>';
  html += 'body{font-family:Manrope,-apple-system,sans-serif;margin:0;padding:20px;';
  html += bodyBg;
  html += 'text-align:center;color:#2c3e50;}';
  html += '.container{max-width:500px;margin:0 auto;padding:12px 0;}';
  html += '.back{display:inline-block;margin-bottom:16px;color:#888;text-decoration:none;font-size:14px;}';
  html += 'h1{font-size:22px;margin:14px 0 6px;line-height:1.3;font-weight:800;}';
  html += '.price{font-size:26px;font-weight:800;margin:6px 0 16px;color:' + btnColors.color + ';}';
  html += '.card{background:#fff;border-radius:22px;padding:20px;box-shadow:0 6px 24px rgba(0,0,0,0.07);margin:16px 0;}';
  html += '.quote{background:#f5f5f5;border-radius:12px;padding:14px;text-align:left;font-size:15px;line-height:1.5;margin:0 0 12px;color:#333;white-space:pre-wrap;word-break:break-word;}';
  html += '.copy{display:block;width:100%;padding:12px;border-radius:24px;font-size:15px;font-weight:700;background:#e8e8e8;color:#333;border:none;cursor:pointer;font-family:inherit;}';
  html += '</style></head><body>';

  html += '<div class="container">';
  html += '<a class="back" href="/shop/' + escAttr(shop.shopId) + '">← К витрине</a>';

  if (photoRefs) {
    html += '<div>' + renderImgTag(photoRefs, 'width:100%;max-width:420px;border-radius:20px;box-shadow:0 6px 24px rgba(0,0,0,0.12);', bouquet.name) + '</div>';
  }

  html += '<h1>' + esc(bouquet.name) + '</h1>';
  html += '<div class="price">' + formatPrice(bouquet.price, shop) + '</div>';

  const orderText = 'Здравствуйте! Пишу с вашей витрины. Хочу заказать букет №' + bouquet.shopNumber + ' «' + bouquet.name + '» — ' + formatPrice(bouquet.price, shop) + '.';
  
  html += '<div class="card">';
  html += '<div style="font-size:16px;font-weight:700;color:#2c3e50;margin-bottom:12px;">Как связаться с флористом?</div>';

  const btnBase = 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:16px;border-radius:30px;font-size:17px;font-weight:700;text-decoration:none;margin-top:10px;box-sizing:border-box;color:#fff;';
  
  const waPhone = getSafePhone(shop.whatsappPhone);
  const cleanPhone = getSafePhone(shop.phone);
  let contactsHtml = '';

  if (waPhone.length >= 10) {
    contactsHtml += '<a href="/go/' + escAttr(shop.shopId) + '/' + bouquet.id + '/wa" style="' + btnBase + 'background:#25D366;">💬 WhatsApp</a>';
  }
  if (getSafeTgUsername(shop.telegramUsername)) {
    contactsHtml += '<a href="/go/' + escAttr(shop.shopId) + '/' + bouquet.id + '/tg" style="' + btnBase + 'background:#229ED9;">📩 Telegram</a>';
  }
  if (getSafeMaxLink(shop.maxLink)) {
    contactsHtml += '<a href="/go/' + escAttr(shop.shopId) + '/' + bouquet.id + '/max" style="' + btnBase + 'background:#7B68EE;">🟼 MAX</a>';
  }
  if (cleanPhone.length >= 10) {
    contactsHtml += '<a href="/go/' + escAttr(shop.shopId) + '/' + bouquet.id + '/call" style="' + btnBase + 'background:' + btnColors.color + ';">📞 Позвонить</a>';
  }

  if (!contactsHtml) {
    contactsHtml = '<div style="color:#888;padding:10px;">Контакты временно недоступны</div>';
  }
  
  html += contactsHtml;
  html += '</div>';

  html += '<div class="card" style="text-align:left;">';
  html += '<div style="font-size:14px;color:#555;margin-bottom:10px;">💡 Можно скопировать готовый текст заказа:</div>';
  html += '<div class="quote">' + esc(orderText) + '</div>';
  html += '<button class="copy" id="copyBtn" onclick="copyOrder()">📋 Скопировать текст</button>';
  html += '</div></div>';

  html += '<script>';
  html += 'function copyOrder() {';
  html += 'var text = ' + safeJson(orderText) + ';';
  html += 'var btn = document.getElementById("copyBtn");';
  html += 'function done() { btn.textContent = "✅ Скопировано!"; setTimeout(function(){ btn.textContent = "📋 Скопировать текст"; }, 2500); }';
  html += 'if (navigator.clipboard && navigator.clipboard.writeText) {';
  html += 'navigator.clipboard.writeText(text).then(done).catch(function(){ fallbackCopy(text, done); });';
  html += '} else { fallbackCopy(text, done); }';
  html += '}';
  html += 'function fallbackCopy(text, cb) {';
  html += 'var ta = document.createElement("textarea"); ta.value = text;';
  html += 'ta.style.position = "fixed"; ta.style.left = "-9999px";';
  html += 'document.body.appendChild(ta); ta.focus(); ta.select();';
  html += 'try { document.execCommand("copy"); cb(); } catch(e) {}';
  html += 'document.body.removeChild(ta);';
  html += '}';
  html += '</script>';

  html += buildPhotoFallbackScript();
  html += '</body></html>';

  return html;
}

function buildMessengerOrderPage(data) {
  const shop = data.shop;
  const orderText = data.orderText;
  const messenger = data.messenger;
  const bouquet = data.bouquet;

  let target = '';
  if (messenger === 'tg') {
    const username = getSafeTgUsername(shop.telegramUsername);
    if (username) target = 'https://t.me/' + username;
  } else if (messenger === 'max') {
    target = getSafeMaxLink(shop.maxLink) || '';
  }

  const title = 'Ваш заказ — ' + shop.displayName;
  const description = 'Скопируйте сообщение и отправьте продавцу.';
  const btnColors = getButtonColorsLocal(shop);

  let html = buildPageHead(title, description);

  html += '<style>';
  html += 'body{font-family:Manrope,-apple-system,sans-serif;background:#fafaf8;margin:0;padding:24px 14px;color:#2c3e50;text-align:center;}';
  html += '.panel{max-width:480px;margin:0 auto;background:#fff;border-radius:20px;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.08);}';
  html += 'textarea{width:100%;min-height:120px;padding:12px;border:1px solid #ddd;border-radius:12px;font:inherit;resize:vertical;box-sizing:border-box;}';
  html += 'button,.button{display:block;width:100%;padding:14px;border:0;border-radius:26px;margin-top:12px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer;box-sizing:border-box;}';
  html += '.btn-copy{background:#3498db;color:#fff;}';
  html += '.btn-open{background:' + btnColors.color + ';color:#fff;}';
  html += '</style></head><body>';

  html += '<main class="panel">';
  html += '<h1 style="font-size:22px;">Перейти в ' + (messenger === 'tg' ? 'Telegram' : 'MAX') + '</h1>';
  html += '<p style="color:#666;font-size:14px;">Букет №' + bouquet.shopNumber + '</p>';
  
  html += '<textarea id="orderText" readonly>' + esc(orderText) + '</textarea>';
  html += '<button class="btn-copy" onclick="copyOrder()">📋 Скопировать текст</button>';

  if (target) {
    html += '<a class="button btn-open" href="' + escAttr(target) + '" target="_blank" rel="noopener">Открыть ' + (messenger === 'tg' ? 'Telegram' : 'MAX') + '</a>';
  }

  html += '<p style="color:#888;font-size:12px;margin-top:20px;">' + esc(shop.displayName) + '</p>';
  html += '</main>';

  html += '<script>';
  html += 'function copyOrder() {';
  html += 'var el = document.getElementById("orderText");';
  html += 'el.select(); el.setSelectionRange(0, 99999);';
  html += 'if (navigator.clipboard && navigator.clipboard.writeText) {';
  html += 'navigator.clipboard.writeText(el.value).then(function(){ alert("Скопировано"); }).catch(function(){ document.execCommand("copy"); });';
  html += '} else { document.execCommand("copy"); }';
  html += '}';
  html += '</script></body></html>';

  return html;
}

async function sendClickNotification(shop, bouquet, type, bot) {
  if (!bot || !shop || !bouquet) return;

  try {
    const recipients = [];
    if (Array.isArray(shop.admins)) {
      for (const admin of shop.admins) {
        const chatId = admin && (admin.chatId || admin.chat_id);
        if (chatId) recipients.push(String(chatId));
      }
    }
    if (shop.ownerChatId) recipients.push(String(shop.ownerChatId));

    const unique = Array.from(new Set(recipients));
    if (!unique.length) return;

    const labels = { tg: 'Telegram', wa: 'WhatsApp', max: 'MAX', call: 'звонок' };
    const label = labels[type] || 'контакт';
    const priceStr = formatPrice(bouquet.price, shop);

    const message =
      '🔔 <b>Переход с витрины</b>\n\n' +
      'Букет: ' + esc(bouquet.name || '') + '\n' +
      '№' + esc(bouquet.shopNumber || '') + '\n' +
      'Цена: ' + priceStr + '\n' +
      'Действие: ' + esc(label);

    for (const chatId of unique) {
      try {
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      } catch (e) {}
    }
  } catch (e) {}
}

function setPhotoHeaders(res, contentType) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
}

function isAllowedImageType(value) {
  if (typeof value !== 'string') return false;
  const type = value.split(';')[0].trim().toLowerCase();
  return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].indexOf(type) !== -1;
}

// ЗАЩИТА ОТ ПЕРЕПОЛНЕНИЯ ПАМЯТИ (взято у аудитора)
async function readLimitedStream(stream, maxSize) {
  const chunks = [];
  let total = 0;

  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxSize) {
      if (stream.destroy) stream.destroy();
      throw new Error('PHOTO_TOO_LARGE');
    }
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks, total);
}

async function readS3Photo(client, bucket, key) {
  if (!client || !bucket) {
    throw new Error('S3_NOT_CONFIGURED');
  }

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const result = await client.send(command);

  if (!result || !result.Body) {
    throw new Error('PHOTO_NOT_FOUND');
  }

  if (result.ContentLength !== undefined && result.ContentLength > MAX_PHOTO_SIZE) {
    if (result.Body.destroy) result.Body.destroy();
    throw new Error('PHOTO_TOO_LARGE');
  }

  if (!isAllowedImageType(result.ContentType)) {
    if (result.Body.destroy) result.Body.destroy();
    throw new Error('PHOTO_TYPE_NOT_ALLOWED');
  }

  const body = await readLimitedStream(result.Body, MAX_PHOTO_SIZE);

  return {
    body: body,
    contentType: result.ContentType.split(';')[0].trim()
  };
}

function sendPhotoBuffer(res, photo) {
  if (res.headersSent || res.destroyed) return;
  setPhotoHeaders(res, photo.contentType);
  res.setHeader('Content-Length', photo.body.length);
  res.status(200).end(photo.body);
}

function sendPhotoError(res, status) {
  if (res.headersSent || res.destroyed) {
    if (!res.destroyed) res.destroy();
    return;
  }
  res.status(status).end();
}

function getRequestIp(req) {
  if (req.ip) return String(req.ip).slice(0, 100);
  if (req.socket && req.socket.remoteAddress) {
    return String(req.socket.remoteAddress).slice(0, 100);
  }
  return 'unknown';
}

function makeClickKey(shopId, bouquetId, type, ip) {
  return [String(shopId), String(bouquetId), String(type), String(ip)].join(':');
}

function shouldCountClick(key) {
  const now = Date.now();
  const previous = notifiedClicks.get(key);
  if (previous && now - previous < CLICK_NOTIFY_TTL) {
    return false;
  }
  notifiedClicks.set(key, now);
  return true;
}

function getShopBlocked(shop) {
  return !!(shop && (shop.blocked || shop.isBlocked || shop.status === 'blocked'));
}

function getShopSubscriptionActive(shop) {
  if (!shop) return false;
  try {
    return isSubscriptionActive(shop);
  } catch (e) {
    return false;
  }
}

function sendStorefrontPaused(res) {
  res.status(200).send(
    '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Витрина временно недоступна</title></head>' +
    '<body style="font-family:Arial,sans-serif;text-align:center;padding:50px 20px;color:#444;">' +
    '<h2>Витрина временно недоступна</h2>' +
    '<p>Магазин временно приостановил публикацию витрины.</p>' +
    '</body></html>'
  );
}

function sendNotFound(res) {
  res.status(404).send(
    '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Не найдено</title></head>' +
    '<body style="font-family:Arial,sans-serif;text-align:center;padding:50px 20px;color:#444;">' +
    '<h2>Страница не найдена</h2><p>Возможно, ссылка устарела.</p>' +
    '</body></html>'
  );
}

function setPageHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store');
}
function setupStorefront(app, bot, s3ctx) {
  s3ctx = s3ctx || {};
  const primaryS3 = s3ctx.s3 || null;
  const primaryBucket = s3ctx.YC_BUCKET || null;
  const backupS3 = s3ctx.s3backup || null;
  const backupBucket = s3ctx.BC_BUCKET || null;
  const primaryEnabled = !!(s3ctx.S3_ENABLED && primaryS3 && primaryBucket);
  const backupEnabled = !!(s3ctx.S3_BACKUP_ENABLED && backupS3 && backupBucket);
  const token = process.env.BOT_TOKEN || '';

  if (!cleanupStarted) {
    cleanupStarted = true;
    const timer = setInterval(function() {
      const now = Date.now();
      notifiedClicks.forEach(function(value, key) {
        if (now - value > CLICK_NOTIFY_TTL) {
          notifiedClicks.delete(key);
        }
      });
    }, 5 * 60 * 1000);
    if (timer.unref) timer.unref();
  }

  async function serveS3Photo(req, res, key, backupOnly) {
    if (!isValidS3Key(key)) {
      return sendPhotoError(res, 400);
    }

    const attempts = [];
    if (backupOnly) {
      if (backupEnabled) {
        attempts.push({ client: backupS3, bucket: backupBucket });
      }
    } else {
      if (primaryEnabled) {
        attempts.push({ client: primaryS3, bucket: primaryBucket });
      }
      if (backupEnabled) {
        attempts.push({ client: backupS3, bucket: backupBucket });
      }
    }

    if (!attempts.length) {
      return sendPhotoError(res, 404);
    }

    for (const attempt of attempts) {
      try {
        const photo = await readS3Photo(attempt.client, attempt.bucket, key);
        return sendPhotoBuffer(res, photo);
      } catch (e) {
        if (e && e.message === 'PHOTO_TOO_LARGE') {
          return sendPhotoError(res, 413);
        }
        if (e && e.message === 'PHOTO_TYPE_NOT_ALLOWED') {
          return sendPhotoError(res, 415);
        }
      }
    }

    return sendPhotoError(res, 404);
  }

  app.get('/photo/s3/*', async function(req, res) {
    try {
      const key = req.params[0] || '';
      return await serveS3Photo(req, res, key, false);
    } catch (e) {
      return sendPhotoError(res, 404);
    }
  });

  app.get('/photo/s3b/*', async function(req, res) {
    try {
      const key = req.params[0] || '';
      return await serveS3Photo(req, res, key, true);
    } catch (e) {
      return sendPhotoError(res, 404);
    }
  });

  app.get('/photo/tg/:fileId', async function(req, res) {
    const fileId = req.params.fileId;

    if (!token || !isValidFileId(fileId)) {
      return sendPhotoError(res, 404);
    }

    let fileInfo;
    try {
      fileInfo = await bot.getFile(fileId);
    } catch (e) {
      return sendPhotoError(res, 404);
    }

    const filePath = fileInfo && fileInfo.file_path;

    if (
      typeof filePath !== 'string' ||
      !/^[a-zA-Z0-9_./-]+$/.test(filePath) ||
      filePath.startsWith('/') ||
      filePath.indexOf('..') !== -1
    ) {
      return sendPhotoError(res, 404);
    }

    const telegramUrl =
      'https://api.telegram.org/file/bot' + token + '/' + filePath;

    let finished = false;
    let timer = null;

    function finishError(status) {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      sendPhotoError(res, status);
    }

    const request = https.get(telegramUrl, function(upstream) {
      if (finished) {
        upstream.destroy();
        return;
      }

      if (upstream.statusCode !== 200) {
        upstream.destroy();
        return finishError(404);
      }

      const contentType = upstream.headers['content-type'];
      if (!isAllowedImageType(contentType)) {
        upstream.destroy();
        return finishError(415);
      }

      const contentLength = Number(upstream.headers['content-length'] || 0);
      if (contentLength > MAX_PHOTO_SIZE) {
        upstream.destroy();
        return finishError(413);
      }

      const chunks = [];
      let total = 0;

      upstream.on('data', function(chunk) {
        if (finished) return;
        total += chunk.length;
        if (total > MAX_PHOTO_SIZE) {
          upstream.destroy();
          return finishError(413);
        }
        chunks.push(Buffer.from(chunk));
      });

      upstream.on('end', function() {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        const body = Buffer.concat(chunks, total);
        sendPhotoBuffer(res, {
          body: body,
          contentType: contentType.split(';')[0].trim()
        });
      });

      upstream.on('error', function() {
        finishError(502);
      });
    });

    request.on('error', function() {
      finishError(502);
    });

    timer = setTimeout(function() {
      request.destroy();
      finishError(504);
    }, PHOTO_TIMEOUT);

    if (timer.unref) timer.unref();

    res.on('close', function() {
      if (!res.writableEnded) {
        request.destroy();
        if (timer) clearTimeout(timer);
      }
    });
  });

  app.get('/contact/:shopId/:bouquetId', async function(req, res) {
    setPageHeaders(res);
    try {
      const shopId = req.params.shopId;
      const bouquetId = parseStrictInt(req.params.bouquetId);

      if (!isValidShopId(shopId) || !bouquetId) {
        return sendNotFound(res);
      }

      const shop = await getShopFromDb(shopId);
      if (!shop || getShopBlocked(shop)) {
        return sendNotFound(res);
      }

      if (!getShopSubscriptionActive(shop)) {
        return sendStorefrontPaused(res);
      }

      const bouquet = await getBouquetById(shop.shopId, bouquetId);
      if (!bouquet || bouquet.hidden || bouquet.archived) {
        return sendNotFound(res);
      }

      const firstPhoto = Array.isArray(bouquet.photos) && bouquet.photos.length
        ? bouquet.photos[0] : null;

      const photoRefs = getPhotoRefsLocal(firstPhoto, s3ctx);

      return res.send(buildContactPage({
        shop: shop,
        bouquet: bouquet,
        photoRefs: photoRefs,
        s3ctx: s3ctx
      }));
    } catch (e) {
      return res.status(500).send('Ошибка сервера');
    }
  });

  app.get('/shop/:shopId/b/:bouquetId', async function(req, res) {
    setPageHeaders(res);
    try {
      const shopId = req.params.shopId;
      const bouquetId = parseStrictInt(req.params.bouquetId);

      if (!isValidShopId(shopId) || !bouquetId) {
        return sendNotFound(res);
      }

      const shop = await getShopFromDb(shopId);
      if (!shop || getShopBlocked(shop)) {
        return sendNotFound(res);
      }

      if (!getShopSubscriptionActive(shop)) {
        return sendStorefrontPaused(res);
      }

      const bouquet = await getBouquetById(shop.shopId, bouquetId);
      if (!bouquet || bouquet.hidden || bouquet.archived) {
        return sendNotFound(res);
      }

      const photos = Array.isArray(bouquet.photos) ? bouquet.photos : [];
      const photoRefs = photos.length ? getPhotoRefsLocal(photos[0], s3ctx) : null;
      const otherPhotoRefs = [];

      for (let i = 1; i < photos.length; i++) {
        const refs = getPhotoRefsLocal(photos[i], s3ctx);
        if (getPhotoSources(refs).length) {
          otherPhotoRefs.push(refs);
        }
      }

      return res.send(buildBouquetPage({
        shop: shop,
        bouquet: bouquet,
        photoRefs: photoRefs,
        otherPhotoRefs: otherPhotoRefs,
        s3ctx: s3ctx
      }));
    } catch (e) {
      return res.status(500).send('Ошибка сервера');
    }
  });app.get('/go/:shopId/:bouquetId/:type', async function(req, res) {
    setPageHeaders(res);
    try {
      const shopId = req.params.shopId;
      const bouquetId = parseStrictInt(req.params.bouquetId);
      const type = req.params.type;
      const allowedTypes = ['tg', 'wa', 'max', 'call'];

      if (!isValidShopId(shopId) || !bouquetId || 
          allowedTypes.indexOf(type) === -1) {
        return sendNotFound(res);
      }

      const shop = await getShopFromDb(shopId);
      if (!shop || getShopBlocked(shop)) return sendNotFound(res);
      if (!getShopSubscriptionActive(shop)) return sendStorefrontPaused(res);

      const bouquet = await getBouquetById(shop.shopId, bouquetId);
      if (!bouquet || bouquet.hidden || bouquet.archived) {
        return sendNotFound(res);
      }

      let target = '';
      let isMessengerPage = false;

      if (type === 'tg') {
        const username = getSafeTgUsername(shop.telegramUsername);
        if (!username) return sendNotFound(res);
        target = 'https://t.me/' + username;
        isMessengerPage = true;
      } else if (type === 'max') {
        target = getSafeMaxLink(shop.maxLink) || '';
        if (!target) return sendNotFound(res);
        isMessengerPage = true;
      } else if (type === 'wa') {
        const phone = getSafePhone(shop.whatsappPhone);
        if (phone.length < 10 || phone.length > 15) {
          return sendNotFound(res);
        }
        target = 'https://wa.me/' + phone;
      } else if (type === 'call') {
        const phone = getSafePhone(shop.phone);
        if (phone.length < 10 || phone.length > 15) {
          return sendNotFound(res);
        }
        target = 'tel:+' + phone;
      }

      const priceStr = formatPrice(bouquet.price, shop);
      const orderText = 'Здравствуйте! Пишу с вашей витрины. ' +
        'Хочу заказать букет №' + bouquet.shopNumber + 
        ' «' + bouquet.name + '» — ' + priceStr + '.';

      const ip = getRequestIp(req);
      const clickKey = makeClickKey(shop.shopId, bouquet.id, type, ip);

      if (shouldCountClick(clickKey)) {
        try {
          if (type === 'call') {
            await incrementShopStat(shop.shopId, 'calls');
          } else {
            await incrementShopStat(shop.shopId, 'orders');
          }
          await pool.query(
            'UPDATE bouquets SET clicks = COALESCE(clicks, 0) + 1 ' +
            'WHERE id = $1 AND shop_id = $2', [bouquet.id, shop.shopId]
          );
          sendClickNotification(shop, bouquet, type, bot)
            .catch(function(){});
        } catch (e) {}
      }

      if (isMessengerPage) {
        return res.send(buildMessengerOrderPage({
          shop: shop, bouquet: bouquet, 
          orderText: orderText, messenger: type
        }));
      }

      if (type === 'wa') {
        target += '?text=' + encodeURIComponent(orderText);
      }

      let redirectHtml = '<!DOCTYPE html><html lang="ru"><head>';
      redirectHtml += '<meta charset="UTF-8">';
      redirectHtml += '<meta name="viewport" content="width=device-width,';
      redirectHtml += 'initial-scale=1">';
      redirectHtml += '<meta http-equiv="refresh" content="0;url=';
      redirectHtml += escAttr(target) + '">';
      redirectHtml += '<title>Переход...</title></head>';
      redirectHtml += '<body style="font-family:Arial,sans-serif;';
      redirectHtml += 'text-align:center;padding:40px;">';
      redirectHtml += '<p>Переходим...</p>';
      redirectHtml += '<a href="' + escAttr(target) + '">Открыть</a>';
      redirectHtml += '</body></html>';
      return res.send(redirectHtml);

    } catch (e) {
      return res.status(500).send('Ошибка сервера');
    }
  });

  app.get('/shop/:shopId', async function(req, res) {
    setPageHeaders(res);
    try {
      const shopId = req.params.shopId;
      if (!isValidShopId(shopId)) return sendNotFound(res);

      const shop = await getShopFromDb(shopId);
      if (!shop || getShopBlocked(shop)) return sendNotFound(res);
      if (!getShopSubscriptionActive(shop)) return sendStorefrontPaused(res);

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
        if (b.hidden || b.archived) return false;
        
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
            if (totalStock < parseFloat(it.qty)) return false;
          }
        }
        return true;
      });

      const totalActiveCount = active.length;
      
      const tagCounts = Object.create(null);
      for (const b of active) {
        for (const t of (b.tags || [])) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      }

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
        active = active.filter(function(b) { 
          return b.price > ranges[3]; 
        });
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

      const settings = shop.settings || {};
      const btnColors = getButtonColorsLocal(shop);
      const bodyBg = getBackgroundStyle(settings.background, s3ctx);
      const titleStr = esc(shop.displayName) + ' — Flowind';
      const description = 'Официальная витрина магазина ' + esc(shop.displayName);
      
      let html = buildPageHead(titleStr, description, null);
      
      const pillBase = 'display:inline-block;padding:8px 16px;';
      const pillBase2 = 'margin:4px;border-radius:20px;';
      const pillBase3 = 'text-decoration:none;font-size:14px;';
      const pillBase4 = 'font-weight:700;';
      const pillCommon = pillBase + pillBase2 + pillBase3 + pillBase4;
      
      const pillActive = 'background:' + btnColors.color + ';color:#fff;';
      const pillIdle = 'background:#f0f0f0;color:#555;';

      html += '<style>';
      html += 'body{font-family:Manrope,-apple-system,sans-serif;';
      html += 'margin:0;padding:20px 14px;text-align:center;' + bodyBg + '}';
      html += 'h1{color:#2c3e50;margin-top:0;}';
      html += '.container{max-width:1200px;margin:0 auto;}';
      html += '.shop-grid img{cursor:zoom-in;}';
      html += '.card{opacity:0;transform:translateY(14px);}';
      html += '.card.visible{opacity:1;transform:translateY(0);}';
      html += '.card-gallery::-webkit-scrollbar{display:none;}';
      html += '@media (hover: hover){.card:hover{transform:translateY(-3px);';
      html += 'box-shadow:0 10px 32px rgba(0,0,0,0.12) !important;}}';
      html += '.card:active{transform:translateY(-2px);}';
      html += '@media (prefers-reduced-motion: reduce){';
      html += '.card{opacity:1;transform:none;transition:none !important;}';
      html += '.card:active,.card:hover{transform:none;}}';
      html += '</style></head><body>';

      html += '<div class="container">';
      
      let logoUrl = null;
      if (settings.logo) {
        const logoRefs = getPhotoRefsLocal(settings.logo, s3ctx);
        logoUrl = absoluteUrl(getPhotoSources(logoRefs)[0]);
      }
      
      let coverUrl = null;
      if (settings.cover) {
        const coverRefs = getPhotoRefsLocal(settings.cover, s3ctx);
        coverUrl = absoluteUrl(getPhotoSources(coverRefs)[0]);
      }

      if (logoUrl) {
        html += '<img src="' + escAttr(logoUrl) + '" ';
        html += 'style="max-height:80px;margin:0 auto 12px;">';
      }

      if (coverUrl) {
        html += '<div style="max-width:760px;margin:0 auto 12px;';
        html += 'border-radius:20px;overflow:hidden;position:relative;';
        html += 'box-shadow:0 6px 28px rgba(0,0,0,0.12);">';
        html += '<img src="' + escAttr(coverUrl) + '" ';
        html += 'style="width:100%;display:block;height:280px;';
        html += 'object-fit:cover;">';
        html += '<div style="position:absolute;left:0;right:0;';
        html += 'bottom:0;padding:60px 24px 20px;';
        html += 'background:linear-gradient(180deg,';
        html += 'rgba(0,0,0,0) 0%,rgba(0,0,0,0.35) 40%,';
        html += 'rgba(0,0,0,0.72) 100%);';
        html += 'color:#fff;text-align:center;">';
        html += '<h1 style="margin:0 0 8px;font-size:26px;';
        html += 'font-weight:800;color:#fff;';
        html += 'text-shadow:0 2px 12px rgba(0,0,0,0.5);">';
        html += esc(shop.displayName) + '</h1>';
        
        if (shop.address || shop.hours) {
          html += '<div style="font-size:14px;line-height:1.5;';
          html += 'color:rgba(255,255,255,0.94);';
          html += 'text-shadow:0 1px 8px rgba(0,0,0,0.6);">';
          if (shop.address) html += '📍 ' + esc(shop.address);
          if (shop.hours) {
            if (shop.address) html += '<br>';
            html += '🕐 ' + esc(shop.hours);
          }
          html += '</div>';
        }
        html += '</div></div>';
      }

      if (!coverUrl) {
        html += '<div style="background:rgba(255,255,255,0.92);';
        html += 'border-radius:14px;padding:16px 22px;';
        html += 'max-width:560px;margin:0 auto 20px;';
        html += 'box-shadow:0 4px 20px rgba(0,0,0,0.06);';
        html += 'backdrop-filter:blur(8px);">';
        html += '<h1 style="color:#2c3e50;margin:0 0 8px;';
        html += 'font-size:26px;font-weight:800;">';
        html += esc(shop.displayName) + '</h1>';
        
        if (shop.address || shop.hours) {
          html += '<div style="color:#666;font-size:14px;';
          html += 'line-height:1.5;">';
          if (shop.address) html += '📍 ' + esc(shop.address);
          if (shop.hours) {
            if (shop.address) html += '<br>';
            html += '🕐 ' + esc(shop.hours);
          }
          html += '</div>';
        }
        
        const cntWord = plural(totalActiveCount, 'букет', 'букета', 'букетов');
        if (totalActiveCount > 0) {
          html += '<div style="font-size:13px;color:#27ae60;';
          html += 'margin-top:6px;font-weight:700;">🌸 ';
          html += totalActiveCount + ' ' + cntWord + ' в наличии</div>';
        }
        html += '</div>';
      }

      let filtersHTML = '<div style="margin:10px 0 6px;">';
      filtersHTML += '<a href="' + buildUrl('all', null, null) + '" ';
      filtersHTML += 'style="' + pillCommon;
      filtersHTML += (priceFilter === 'all' ? pillActive : pillIdle) + '">';
      filtersHTML += 'Все</a>';
      
      const hasLow = all.some(function(b) { return b.price < ranges[0]; });
      const hasMid = all.some(function(b) { 
        return b.price >= ranges[0] && b.price <= ranges[1]; 
      });
      
      if (hasLow) {
        filtersHTML += '<a href="' + buildUrl('low', null, null) + '" ';
        filtersHTML += 'style="' + pillCommon;
        filtersHTML += (priceFilter === 'low' ? pillActive : pillIdle) + '">';
        filtersHTML += 'До ' + formatPricePill(ranges[0], shop) + '</a>';
      }
      if (hasMid) {
        filtersHTML += '<a href="' + buildUrl('mid', null, null) + '" ';
        filtersHTML += 'style="' + pillCommon;
        filtersHTML += (priceFilter === 'mid' ? pillActive : pillIdle) + '">';
        filtersHTML += formatPricePill(ranges[0], shop) + '–';
        filtersHTML += formatPricePill(ranges[1], shop) + '</a>';
      }
      filtersHTML += '</div>';

      let sortHTML = '<div style="margin-bottom:20px;">';
      const sortOpts = [
        { id: 'asc', label: '↓ Дешевле' },
        { id: 'desc', label: '↑ Дороже' },
        { id: 'fresh', label: '🔥 Свежие' },
        { id: 'popular', label: '⭐ Популярные' }
      ];
      
      for (const opt of sortOpts) {
        sortHTML += '<a href="' + buildUrl(null, opt.id, null) + '" ';
        sortHTML += 'style="display:inline-block;padding:6px 12px;';
        sortHTML += 'margin:4px;border-radius:16px;text-decoration:none;';
        sortHTML += 'font-size:13px;font-weight:700;';
        sortHTML += (sortParam === opt.id ? pillActive : pillIdle) + '">';
        sortHTML += opt.label + '</a>';
      }
      sortHTML += '</div>';

      let tagsHTML = '';
      const sortedTags = Object.keys(tagCounts)
        .sort(function(a, b) { return tagCounts[b] - tagCounts[a]; });
        
      if (sortedTags.length > 0) {
        tagsHTML += '<div style="margin:10px 0 6px;">';
        for (const tag of sortedTags) {
          tagsHTML += '<a href="' + buildUrl(null, null, tag) + '" ';
          tagsHTML += 'style="display:inline-block;padding:6px 12px;';
          tagsHTML += 'margin:4px;border-radius:16px;text-decoration:none;';
          tagsHTML += 'font-size:13px;font-weight:700;';
          tagsHTML += (tagFilter === tag ? pillActive : pillIdle) + '">';
          tagsHTML += '#' + esc(tag) + ' ' + tagCounts[tag] + '</a>';
        }
        tagsHTML += '</div>';
      }

      html += filtersHTML + tagsHTML + sortHTML;

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
              const r = getPhotoRefsLocal(p, s3ctx);
              if (getPhotoSources(r).length) photoRefsList.push(r);
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
              'width:100%;aspect-ratio:4/5;object-fit:cover;display:block;',
              b.name
            );
          } else {
            const slideStyle = 'height:100%;width:auto;';
            const slideStyle2 = 'flex-shrink:0;display:block;';
            const fullSlide = slideStyle + slideStyle2;
            let slides = '';
            for (const r of photoRefsList) {
              slides += renderImgTag(r, fullSlide, b.name);
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
            b.price, settings.markupPercent || 0
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
          
          if (oldPrice > safeNumber(b.price)) {
            card += '<span style="text-decoration:line-through;';
            card += 'color:#b0b0b0;font-weight:400;font-size:' + oldFS + ';';
            card += 'margin-right:6px;">';
            card += formatPrice(oldPrice, shop) + '</span>';
          }
          card += formatPrice(b.price, shop) + '</p>';
          card += preorderBadge;
          card += '<div style="margin-top:auto;padding-top:8px;">';
          card += '<a href="' + contactUrlEsc + '" style="display:block;';
          card += 'margin:8px auto 0;background:' + btnGrad + ';';
          card += 'color:#fff;padding:12px 16px;border-radius:24px;';
          card += 'text-decoration:none;font-weight:700;';
          card += 'text-align:center;font-size:14px;';
          card += 'box-shadow:' + btnShadow + ';">📞 Связаться</a>';
          card += '<div style="margin-top:6px;">';
          
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

      html += '<script>';
      html += 'var lbImages = []; var lbIndex = 0; ';
      html += 'var touchStartX = 0; var touchStartY = 0;';
      html += 'function shareBouquet(url, name, price) {';
      html += 'var text = name + " — " + price;';
      html += 'if (navigator.share) {';
      html += 'navigator.share({ title: name, text: text, url: url })';
      html += '.catch(function(){});';
      html += '} else if (navigator.clipboard && ';
      html += 'navigator.clipboard.writeText) {';
      html += 'navigator.clipboard.writeText(url).then(function(){ ';
      html += 'alert("Ссылка скопирована"); }).catch(function(){ ';
      html += 'prompt("Скопируйте ссылку:", url); });';
      html += '} else { prompt("Скопируйте ссылку:", url); }';
      html += '}';
      
      html += 'document.addEventListener("click", function(e) {';
      html += 'var btn = e.target.closest(".share-btn");';
      html += 'if (!btn) return;';
      html += 'e.preventDefault();';
      html += 'var url = btn.getAttribute("data-url");';
      html += 'var name = btn.getAttribute("data-name");';
      html += 'var price = btn.getAttribute("data-price");';
      html += 'shareBouquet(url, name, price);';
      html += '});';

      html += 'function openLightbox(images, index) {';
      html += 'lbImages = images; lbIndex = index;';
      html += 'var lb = document.getElementById("lightbox");';
      html += 'var img = document.getElementById("lightbox-img");';
      html += 'img.src = lbImages[lbIndex]; lb.style.display = "flex";';
      html += 'document.body.style.overflow = "hidden";';
      html += '}';
      html += 'function closeLightbox() {';
      html += 'document.getElementById("lightbox").style.display = "none";';
      html += 'document.getElementById("lightbox-img").src = "";';
      html += 'document.body.style.overflow = "";';
      html += '}';
      html += 'function lbNext() {';
      html += 'if (lbImages.length < 2) return;';
      html += 'lbIndex = (lbIndex + 1) % lbImages.length;';
      html += 'document.getElementById("lightbox-img").src = ';
      html += 'lbImages[lbIndex];';
      html += '}';
      html += 'function lbPrev() {';
      html += 'if (lbImages.length < 2) return;';
      html += 'lbIndex = (lbIndex - 1 + lbImages.length) % lbImages.length;';
      html += 'document.getElementById("lightbox-img").src = ';
      html += 'lbImages[lbIndex];';
      html += '}';
      html += 'document.addEventListener("click", function(e) {';
      html += 'var img = e.target.closest(".shop-grid img");';
      html += 'if (!img) return; e.preventDefault(); e.stopPropagation();';
      html += 'var card = img.closest(".card");';
      html += 'if (!card) { openLightbox([img.src], 0); return; }';
      html += 'var imgs = card.querySelectorAll("img");';
      html += 'var arr = []; var idx = 0;';
      html += 'for (var i = 0; i < imgs.length; i++) {';
      html += 'arr.push(imgs[i].src); if (imgs[i] === img) idx = i;';
      html += '}';
      html += 'if (arr.length === 0) { arr = [img.src]; idx = 0; }';
      html += 'openLightbox(arr, idx);';
      html += '});';
      html += 'document.addEventListener("keydown", function(e) {';
      html += 'var lb = document.getElementById("lightbox");';
      html += 'if (!lb || lb.style.display !== "flex") return;';
      html += 'if (e.key === "Escape") closeLightbox();';
      html += 'if (e.key === "ArrowRight") lbNext();';
      html += 'if (e.key === "ArrowLeft") lbPrev();';
      html += '});';
      html += 'var lbEl = document.getElementById("lightbox");';
      html += 'lbEl.addEventListener("touchstart", function(e) {';
      html += 'if (!e.touches || e.touches.length === 0) return;';
      html += 'touchStartX = e.touches[0].clientX;';
      html += 'touchStartY = e.touches[0].clientY;';
      html += '}, { passive: true });';
      html += 'lbEl.addEventListener("touchend", function(e) {';
      html += 'if (!e.changedTouches || ';
      html += 'e.changedTouches.length === 0) return;';
      html += 'var dx = e.changedTouches[0].clientX - touchStartX;';
      html += 'var dy = e.changedTouches[0].clientY - touchStartY;';
      html += 'if (Math.abs(dx) < 40) return;';
      html += 'if (Math.abs(dx) < Math.abs(dy)) return;';
      html += 'if (dx < 0) lbNext(); else lbPrev();';
      html += '}, { passive: true });';
      
      html += 'var galWraps = document.querySelectorAll(".card-gallery-wrap");';
      html += 'for (var gw = 0; gw < galWraps.length; gw++) {';
      html += '(function(wrap) {';
      html += 'var gal = wrap.querySelector(".card-gallery");';
      html += 'var dots = wrap.querySelectorAll(".card-dots span");';
      html += 'if (!gal || !dots || !dots.length) return;';
      html += 'gal.addEventListener("scroll", function() {';
      html += 'var w = gal.clientWidth; if (!w) return;';
      html += 'var i = Math.round(gal.scrollLeft / w);';
      html += 'for (var j = 0; j < dots.length; j++) {';
      html += 'dots[j].style.background = j === i ? ';
      html += '"rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)";';
      html += '}';
      html += '}, { passive: true });';
      html += '})(galWraps[gw]);';
      html += '}';
      
      html += 'if ("IntersectionObserver" in window) {';
      html += 'var obs = new IntersectionObserver(function(entries){';
      html += 'entries.forEach(function(en){';
      html += 'if (en.isIntersecting) {';
      html += 'en.target.classList.add("visible"); ';
      html += 'obs.unobserve(en.target);';
      html += '}';
      html += '});';
      html += '}, { threshold: 0.1 });';
      html += 'var allCards = document.querySelectorAll(".card");';
      html += 'for (var c = 0; c < allCards.length; c++) {';
      html += 'obs.observe(allCards[c]);';
      html += '}';
      html += '} else {';
      html += 'var allCards2 = document.querySelectorAll(".card");';
      html += 'for (var c2 = 0; c2 < allCards2.length; c2++) {';
      html += 'allCards2[c2].classList.add("visible");';
      html += '}';
      html += '}';
      html += '</script>';

      html += buildPhotoFallbackScript();
      html += '</body></html>';

      res.send(html);
    } catch (e) {
      console.error('Ошибка витрины:', e);
      res.status(500).send('Ошибка сервера');
    }
  });
}

module.exports = { setupStorefront };