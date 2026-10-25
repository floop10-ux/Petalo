const pool = require('./db');
const { PutObjectCommand } =
  require('@aws-sdk/client-s3');

// ====== РАТЕ-ЛИМИТ ДЛЯ PIN ======
const authAttempts = {};
const AUTH_WINDOW_MS = 60 * 1000;
const AUTH_MAX_TRIES = 10;

function checkAuthLimit(ip) {
  const now = Date.now();
  const e = authAttempts[ip];
  if (!e || now - e.ts > AUTH_WINDOW_MS) {
    authAttempts[ip] = { count: 1, ts: now };
    return true;
  }
  if (e.count >= AUTH_MAX_TRIES) return false;
  e.count++;
  return true;
}

setInterval(function() {
  const now = Date.now();
  for (const ip of Object.keys(authAttempts)) {
    if (now - authAttempts[ip].ts > AUTH_WINDOW_MS * 2) {
      delete authAttempts[ip];
    }
  }
}, 5 * 60 * 1000);

// ====== УТИЛИТЫ ======
async function logAction(shopId, chatId, action, details, refId) {
  try {
    await pool.query(
      'INSERT INTO wh_audit_log (shop_id, chat_id, ' +
      'action, details, ref_id) VALUES ($1, $2, $3, $4, $5)',
      [shopId, chatId, action, details, refId || null]
    );
  } catch (e) { console.error('Log error:', e.message); }
}

async function notifyOwner(bot, shopId, text, type) {
  try {
    const r = await pool.query(
      'SELECT settings FROM shops WHERE shop_id = $1', [shopId]
    );
    if (r.rows.length === 0) return;
    const settings = r.rows[0].settings || {};
    if (settings['notif_' + type] === false) return;
    
    const a = await pool.query(
      'SELECT chat_id FROM admins WHERE shop_id = $1 ' +
      'AND role = $2', [shopId, 'owner']
    );
    if (a.rows.length > 0 && bot) {
      bot.sendMessage(a.rows[0].chat_id, text, {
        parse_mode: 'HTML'
      }).catch(function() {});
    }
  } catch (e) { console.error('Notify error:', e.message); }
}

function fmtNum(n) {
  var num = parseFloat(n);
  if (isNaN(num)) return '0';
  return num % 1 === 0 ? num.toString() :
    num.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

// Фикс: кириллица тоже капитализируется

function capWords(str) {
  if (!str) return '';
  return String(str).replace(
    /(^[\p{L}\d])|(\s+[\p{L}\d])/gu,
    function(letter) {
      return letter.toUpperCase();
    }
  );
}
function setupWarehouse(app, bot, sup3ctx) {
  // = ====== S3 КОНТ sЕКСТ ======
  s3ctx = s3ctx || {};
  const s3 = s3ctx.s33 ||ctx.s3backup || null;
  const YC_BUCKET = s3ctx.YC_BUCKET || null;
  const BC_BUCKET = s3ctx.BC_BUCKET || null;
  const BC_ENDPOINT = s3ctx.BC_ENDPOINT || null;

  const brandColor = '#0F3D3E';
  const accentColor = '#E2856B';
  const successColor = '#2E8B57';
  const dangerColor = '#D9534F';
  const bgGradient =
    'linear-gradient(135deg, #F5F8F8 0%, #E6EFEE 100%)';

  const fontLink = '<link href="https://fonts.googleapis.com/css2?' +
    'family=Manrope:wght@400;600;800&display=swap" ' +
    'rel="stylesheet">';

  function getIconSvg(type) {
    var c = 'xmlns="http://www.w3.org/2000/svg" ' +
            'viewBox="0 0 24 24" ' +
            'fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" ' +
            'stroke-linejoin="round" class="svg-ico"';
    if (type === 'sale') return '<svg ' + c +
      '><rect x="2" y="5" width="20" height="14" rx="2"/>' +
      '<line x1="2" y1="10" x2="22" y2="10"/></svg>';
    if (type === 'receipt') return '<svg ' + c +
      '><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 ' +
      '0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4' +
      'a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' +
      '<polyline points="3.27 6.96 12 12.01 20.73 6.96"/>' +
      '<line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
    if (type === 'writeoff') return '<svg ' + c +
      '><polyline points="3 6 5 6 21 6"/>' +
      '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' +
      'm3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
      '<line x1="10" y1="11" x2="10" y2="17"/>' +
      '<line x1="14" y1="11" x2="14" y2="17"/></svg>';
    if (type === 'inventory') return '<svg ' + c +
      '><rect x="3" y="3" width="7" height="7"/>' +
      '<rect x="14" y="3" width="7" height="7"/>' +
      '<rect x="14" y="14" width="7" height="7"/>' +
      '<rect x="3" y="14" width="7" height="7"/></svg>';
    if (type === 'history') return '<svg ' + c +
      '><circle cx="12" cy="12" r="10"/>' +
      '<polyline points="12 6 12 12 16 14"/></svg>';
    if (type === 'docs') return '<svg ' + c +
      '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12' +
      'a2 2 0 0 0 2-2V8z"/>' +
      '<polyline points="14 2 14 8 20 8"/>' +
      '<line x1="16" y1="13" x2="8" y2="13"/>' +
      '<line x1="16" y1="17" x2="8" y2="17"/>' +
      '<polyline points="10 9 9 9 8 9"/></svg>';
    if (type === 'reports') return '<svg ' + c +
      '><line x1="18" y1="20" x2="18" y2="10"/>' +
      '<line x1="12" y1="20" x2="12" y2="4"/>' +
      '<line x1="6" y1="20" x2="6" y2="14"/></svg>';
    if (type === 'staff') return '<svg ' + c +
      '><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>' +
      '<circle cx="9" cy="7" r="4"/>' +
      '<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>' +
      '<path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    if (type === 'settings') return '<svg ' + c +
      '><circle cx="12" cy="12" r="3"/>' +
      '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 ' +
      '0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 ' +
      '0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 ' +
      '2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 ' +
      '0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 ' +
      '0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 ' +
      '0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09' +
      'A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06' +
      '-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 ' +
      '1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 ' +
      '0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 ' +
      '1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 ' +
      '2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9' +
      'a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 ' +
      '1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    if (type === 'audit') return '<svg ' + c +
      '><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8' +
      '-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    if (type === 'shift') return '<svg ' + c +
      '><circle cx="12" cy="12" r="10"/>' +
      '<polyline points="12 6 12 12 16 14"/></svg>';
    return '';
  }

  const uiScript = `
    <style>
      .custom-modal-overlay { display: none; position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(15, 61, 62, 0.6); z-index: 2000;
        align-items: center; justify-content: center;
        backdrop-filter: blur(4px); }
      .custom-modal { background: #fff; padding: 32px 24px;
        border-radius: 28px; width: 85%; max-width: 320px;
        text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.15); }
      
      .modal-icon-wrap { margin: 0 auto 16px; width: 56px; height: 56px;
        border-radius: 50%; display: flex; align-items: center; justify-content: center; }
      .modal-icon-success { background: #E8F5E9; color: ${successColor}; }
      .modal-icon-error { background: #FFEBEE; color: ${dangerColor}; }
      .modal-icon-info { background: #E0F2F1; color: ${brandColor}; }
      
      .custom-modal h3 { margin: 0 0 8px 0; font-size: 22px;
        font-weight: 800; color: ${brandColor}; }
      .custom-modal p { margin: 0 0 24px 0;
        font-size: 15px; color: #666; line-height: 1.5; }
      
      .custom-modal-btns { display: flex; gap: 12px; }
      .custom-modal-btns button { flex: 1; padding: 16px;
        border: none; border-radius: 16px;
        font-size: 16px; font-weight: 700;
        font-family: inherit; cursor: pointer; transition: 0.2s; }
        
      .btn-cancel { background: #F0F4F4; color: #555; }
      .btn-ok { background: ${brandColor}; color: #fff; box-shadow: 0 4px 15px rgba(15,61,62,0.2); }
      .btn-danger { background: ${dangerColor}; color: #fff; box-shadow: 0 4px 15px rgba(217,83,79,0.2); }

      .flowind-watermark { position: fixed; bottom: 15px;
        left: 15px; display: flex; align-items: center;
        gap: 5px; font-family: "Manrope", sans-serif;
        font-weight: 800; font-size: 12px;
        color: ${brandColor}; opacity: 0.3;
        pointer-events: none; z-index: 9999; }

      .svg-ico { width: 24px; height: 24px;
        vertical-align: middle; margin-right: 8px;
        color: ${brandColor}; }

      button, .btn, .pay-btn, .card, .qty-btn {
        touch-action: manipulation; }
      body { -webkit-user-select: none; user-select: none; }
      input, textarea {
        -webkit-user-select: text; user-select: text; }
        
      /* Правка 1: Подсветка активного поля */
      .input-active {
        border: 2px solid ${brandColor} !important;
        box-shadow: 0 0 8px rgba(15,61,62,0.2) !important;
        background: #fff !important;
      }

      /* Правка 11: Адаптация под планшет */
      @media (min-width: 768px) {
        .bottom-sheet {
          width: 400px; left: auto; right: 0;
          height: 100vh; bottom: 0;
          border-radius: 24px 0 0 24px;
          transform: translateX(100%);
          transition: transform 0.3s ease;
        }
        .bottom-sheet.open { transform: translateX(0); }
        .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)) !important; }
        .b-row { grid-template-columns: 1fr 140px 40px !important; font-size: 16px; }
      }
    </style>
    <div class="custom-modal-overlay" id="uiModal">
      <div class="custom-modal">
        <div id="uiModalIcon" class="modal-icon-wrap modal-icon-info">
        </div>
        <h3 id="uiModalTitle"></h3>
        <p id="uiModalText"></p>
        <div class="custom-modal-btns" id="uiModalBtns"></div>
      </div>
    </div>
    <div class="flowind-watermark">
      <svg viewBox="0 0 100 100" style="width: 20px; height: 20px;">
        <rect x="10" y="10" width="80" height="80" rx="20" fill="${brandColor}"/>
        <path d="M25 30 L70 30 Q75 30 75 35 L75 60 Q75 65 70 65 L55 65 L45 75 L45 65 L30 65 Q25 65 25 60 L25 35 Q25 30 30 30 Z" fill="none" stroke="#fff" stroke-width="5"/>
        <path d="M40 45 Q55 35 60 50 Q45 60 40 45 Z" fill="${accentColor}"/>
        <path d="M55 45 Q70 35 75 50 Q60 60 55 45 Z" fill="#fff"/>
      </svg>
      Flowind
    </div>
    <script>
      function showAlert(title, text, isSuccess) {
        var ov = document.getElementById('uiModal');
        var icon = document.getElementById('uiModalIcon');
        
        if (isSuccess) {
          icon.className = 'modal-icon-wrap modal-icon-success';
          icon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          if (title === 'Успех') title = 'Готово';
        } else {
          icon.className = 'modal-icon-wrap modal-icon-error';
          icon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        }

        document.getElementById('uiModalTitle').innerText = title;
        document.getElementById('uiModalText').innerText = text;
        var btns = document.getElementById('uiModalBtns');
        var btnClass = isSuccess ? 'btn-ok' : 'btn-danger';
        btns.innerHTML = '<button class="' + btnClass + '" ' +
          'onclick="closeModal()">ОК</button>';
        ov.style.display = 'flex';
      }

      function showConfirm(title, text, onConfirm, isDanger) {
        var ov = document.getElementById('uiModal');
        var icon = document.getElementById('uiModalIcon');
        
        icon.className = isDanger ? 'modal-icon-wrap modal-icon-error' : 'modal-icon-wrap modal-icon-info';
        icon.innerHTML = isDanger 
          ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
          : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';

        document.getElementById('uiModalTitle').innerText = title;
        document.getElementById('uiModalText').innerText = text;
        var btns = document.getElementById('uiModalBtns');
        var btnClass = isDanger ? 'btn-danger' : 'btn-ok';
        btns.innerHTML = '<button class="btn-cancel" ' +
          'onclick="closeModal()">Отмена</button>' +
          '<button class="' + btnClass + '" ' +
          'id="uiModalConfirmBtn">Да</button>';
        ov.style.display = 'flex';
        document.getElementById('uiModalConfirmBtn').onclick =
          function() { closeModal(); onConfirm(); };
      }
      function closeModal() {
        document.getElementById('uiModal').style.display = 'none';
      }
    </script>
  `;

  // ====== 1. ГЛАВНЫЙ ЭКРАН ======
  app.get('/warehouse-app', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatIdStr = match ? match[1] : null;
      const chatId = chatIdStr ? Number(chatIdStr) : null;

      if (!chatId) {
        return res.redirect('/warehouse-login?shop=kupidon');
      }

      const r = await pool.query(
        'SELECT role, name, can_receipt, can_sale, ' +
        'can_writeoff FROM admins WHERE chat_id = $1 LIMIT 1',
        [chatId]
      );
      if (r.rows.length === 0) {
        return res.redirect('/warehouse-login?shop=kupidon');
      }

      const user = r.rows[0];
      const isOwner = user.role === 'owner';
      const userName = user.name || 'Флорист';
      const canSale = user.can_sale === true;
      const canWriteoff = user.can_writeoff === true;
      const canReceipt = user.can_receipt === true;

      const shiftRes = await pool.query(
        'SELECT id FROM wh_shifts WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND status = \'open\' LIMIT 1',
        ['kupidon', chatId]
      );
      const hasOpenShift = shiftRes.rows.length > 0;

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, ';
      html += 'user-scalable=no">';
      html += fontLink;
      html += '<script src="https://telegram.org/js/';
      html += 'telegram-web-app.js"><\/script>';
      html += uiScript;
      html += '<style>';
      html += 'body { font-family: "Manrope", sans-serif; ';
      html += 'margin: 0; padding: 15px; background: ' + bgGradient;
      html += '; color: ' + brandColor + '; }';
      html += '.top-bar { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 20px; }';
      html += '.logo-wrap { display: flex; align-items: center; ';
      html += 'gap: 10px; }';
      html += '.logo-svg { width: 40px; height: 40px; }';
      html += '.logo-text { font-size: 20px; font-weight: 800; ';
      html += 'line-height: 1; letter-spacing: -0.5px; }';
      html += '.logo-text span { font-size: 10px; color: #888; ';
      html += 'font-weight: 600; letter-spacing: 1px; }';
      html += '.shift-badge { display: inline-flex; align-items: center; ';
      html += 'padding: 5px 10px; border-radius: 20px; font-size: 11px; ';
      html += 'font-weight: 600; text-decoration: none; ';
      html += 'margin-right: 10px; }';
      html += '.shift-open { background: #E0F2F1; color: #00695C; }';
      html += '.shift-closed { background: #FFEBEE; color: #C62828; }';
      html += '.dot { width: 6px; height: 6px; border-radius: 50%; ';
      html += 'margin-right: 4px; }';
      html += '.dot-green { background: #2E8B57; }';
      html += '.dot-red { background: #D9534F; }';
      html += '.burger { font-size: 24px; background: none; ';
      html += 'border: none; color: ' + brandColor + '; ';
      html += 'cursor: pointer; padding: 0; }';
      html += '.grid { display: grid; grid-template-columns: 1fr 1fr; ';
      html += 'gap: 15px; }';
      html += '.btn { background: #fff; padding: 20px 10px; ';
      html += 'border-radius: 16px; text-decoration: none; ';
      html += 'color: ' + brandColor + '; font-weight: 600; ';
      html += 'font-size: 15px; display: flex; ';
      html += 'flex-direction: column; align-items: center; ';
      html += 'justify-content: center; box-shadow: 0 4px 15px ';
      html += 'rgba(15, 61, 62, 0.05); border: none; }';
      html += '.btn svg { width: 32px; height: 32px; ';
      html += 'margin-bottom: 8px; }';
      html += '.full { grid-column: 1 / -1; }';
      html += '.sidebar { position: fixed; top: 0; right: -280px; ';
      html += 'width: 250px; height: 100%; background: #fff; ';
      html += 'box-shadow: -5px 0 15px rgba(0,0,0,0.1); ';
      html += 'transition: right 0.3s ease; z-index: 1000; ';
      html += 'padding: 20px; box-sizing: border-box; }';
      html += '.sidebar.open { right: 0; }';
      html += '.sidebar-overlay { position: fixed; top: 0; left: 0; ';
      html += 'width: 100%; height: 100%; background: rgba(0,0,0,0.4); ';
      html += 'display: none; z-index: 999; }';
      html += '.sidebar-overlay.open { display: block; }';
      html += '.menu-item { display: flex; align-items: center; ';
      html += 'padding: 15px 0; text-decoration: none; ';
      html += 'color: ' + brandColor + '; font-size: 16px; ';
      html += 'border-bottom: 1px solid #eee; }';
      html += '</style></head><body>';

      html += '<div class="top-bar">';
      html += '<div class="logo-wrap">';
      html += '<svg class="logo-svg" viewBox="0 0 100 100">';
      html += '<rect x="10" y="10" width="80" height="80" rx="20" fill="' + brandColor + '"/>';
      html += '<path d="M25 30 L70 30 Q75 30 75 35 L75 60 Q75 65 70 65 ';
      html += 'L55 65 L45 75 L45 65 L30 65 Q25 65 25 60 L25 35 Q25 30 30 30 Z" ';
      html += 'fill="none" stroke="#fff" stroke-width="5"/>';
      html += '<path d="M40 45 Q55 35 60 50 Q45 60 40 45 Z" fill="' + accentColor + '"/>';
      html += '<path d="M55 45 Q70 35 75 50 Q60 60 55 45 Z" fill="#fff"/>';
      html += '</svg>';
      html += '<div class="logo-text">Flowind<br><span>СКЛАД</span></div>';
      html += '</div>';

      html += '<div style="display:flex; align-items:center;">';
      html += '<a href="/warehouse/shift" class="shift-badge ';
      html += (hasOpenShift ? 'shift-open' : 'shift-closed') + '">';
      html += '<div class="dot ';
      html += (hasOpenShift ? 'dot-green' : 'dot-red') + '"></div>';
      html += (hasOpenShift ? 'Открыта' : 'Закрыта');
      html += '</a>';
      if (isOwner) {
        html += '<button class="burger" ';
        html += 'onclick="toggleMenu()">☰</button>';
      }
      html += '</div></div>';

      html += '<div style="margin-bottom:20px;">';
      html += '<h2 style="margin:0; font-size:24px;">Привет, ';
      html += userName + '!</h2></div>';

      html += '<div class="grid">';
      if (isOwner || canSale) {
        html += '<a href="/warehouse/sale" class="btn">';
        html += getIconSvg('sale') + 'Продажа</a>';
      }
      if (isOwner || canReceipt) {
        html += '<a href="/warehouse/receipts" class="btn">';
        html += getIconSvg('receipt') + 'Приход</a>';
      }
      if (isOwner || canWriteoff) {
        html += '<a href="/warehouse/writeoff" class="btn">';
        html += getIconSvg('writeoff') + 'Списание</a>';
      }
      html += '<a href="/warehouse/inventory" class="btn">';
      html += getIconSvg('inventory') + 'Обзор</a>';
      html += '<a href="/warehouse/history" class="btn full">';
      html += getIconSvg('history') + 'История</a>';
      html += '</div>';

      if (isOwner) {
        html += '<div class="sidebar-overlay" id="overlay" ';
        html += 'onclick="toggleMenu()"></div>';
        html += '<div class="sidebar" id="sidebar">';
        html += '<h3>Меню</h3>';
        html += '<a href="/warehouse/documents" class="menu-item">';
        html += getIconSvg('docs') + 'Документы</a>';
        html += '<a href="/warehouse/reports" class="menu-item">';
        html += getIconSvg('reports') + 'Отчёты</a>';
        html += '<a href="/warehouse/staff" class="menu-item">';
        html += getIconSvg('staff') + 'Флористы</a>';
        html += '<a href="/warehouse/audit" class="menu-item">';
        html += getIconSvg('audit') + 'Журнал</a>';
        html += '<a href="/warehouse/settings" class="menu-item">';
        html += getIconSvg('settings') + 'Настройки</a>';
        html += '</div>';
      }

      html += '<script>';
      html += 'function toggleMenu() {';
      html += '  document.getElementById("sidebar").classList';
      html += '.toggle("open");';
      html += '  document.getElementById("overlay").classList';
      html += '.toggle("open");';
      html += '}';
      html += 'Telegram.WebApp.ready();';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) { res.status(500).send('Ошибка сервера'); }
  });

  // ====== 2. ВХОД ======
  app.get('/warehouse-login', (req, res) => {
    const shopId = req.query.shop || '';
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, ';
    html += 'user-scalable=no">';
    html += fontLink;
    html += uiScript;
    html += '<style>';
    html += 'body { font-family: "Manrope", sans-serif; ';
    html += 'text-align: center; padding: 50px 20px; ';
    html += 'background: ' + bgGradient + '; }';
    html += '.card { background: #fff; border-radius: 20px; ';
    html += 'padding: 30px; max-width: 400px; margin: 0 auto; ';
    html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.1); }';
    html += 'input { font-size: 24px; padding: 10px; width: 120px; ';
    html += 'text-align: center; border: 2px solid #ddd; ';
    html += 'border-radius: 10px; margin: 20px 0; ';
    html += 'font-family: inherit; }';
    html += 'button { background: ' + brandColor + '; color: white; ';
    html += 'border: none; padding: 15px 40px; font-size: 18px; ';
    html += 'border-radius: 30px; font-weight: 600; ';
    html += 'font-family: inherit; }';
    html += '</style></head><body>';
    html += '<div class="card"><h1>📦 Flowind</h1>';
    html += '<p>Введите PIN-код</p>';
    html += '<input type="password" id="pin" maxlength="4" ';
    html += 'inputmode="numeric" placeholder="****">';
    html += '<br><button onclick="login()">Войти</button></div>';
    html += '<script>';
    html += 'function login() {';
    html += '  var pin = document.getElementById("pin").value;';
    html += '  fetch("/api/warehouse/auth", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shopId: "' + shopId + '", ';
    html += 'pin: pin }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(data) {';
    html += '    if (data.ok) ';
    html += '      window.location.href = "/warehouse-app"; ';
    html += '    else if (data.rate_limited) ';
    html += '      showAlert("Стоп", "Слишком много попыток. ';
    html += 'Подождите минуту.", false); ';
    html += '    else showAlert("Ошибка", "Неверный PIN", false);';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 3. API АВТОРИЗАЦИИ ======
  app.post('/api/warehouse/auth', async (req, res) => {
    try {
      const ip = (req.headers['x-forwarded-for'] || '')
        .split(',')[0].trim() || req.ip || 'unknown';
      if (!checkAuthLimit(ip)) {
        return res.json({ ok: false, rate_limited: true });
      }

      const r = await pool.query(
        'SELECT chat_id, role FROM admins WHERE shop_id = $1 ' +
        'AND warehouse_pin = $2',
        [req.body.shopId, req.body.pin]
      );
      if (r.rows.length === 0) {
        return res.json({ ok: false });
      }

      res.setHeader('Set-Cookie',
        'wh_auth=' + r.rows[0].chat_id +
        '; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax'
      );
      res.json({ ok: true, role: r.rows[0].role });
    } catch (e) { res.status(500).json({ ok: false }); }
  });
  // ====== 4. API КАТЕГОРИЙ ======
  app.get('/api/warehouse/categories', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT id, name FROM wh_categories ' +
        'ORDER BY sort_order ASC'
      );
      res.json({ ok: true, categories: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 5. API ТОВАРОВ ======
  app.get('/api/warehouse/items', async (req, res) => {
    try {
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate'
      );
      const r = await pool.query(
        'SELECT i.id, i.current_stock, i.retail_price, ' +
        'i.last_cost, i.is_pinned, ' +
        'COALESCE(i.custom_name, w.name) AS name, ' +
        'w.photo_url, w.category_id, w.unit ' +
        'FROM wh_shop_items i ' +
        'JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.shop_id = $1 ' +
        'ORDER BY i.is_pinned DESC, w.name ASC',
        [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) {
      console.error('API items:', e.message);
      res.status(500).json({ ok: false });
    }
  });

  // ====== 6. ОБЗОР СКЛАДА (ПЛИТКА/СТРОКИ + ПАГИНАЦИЯ) ======
  app.get('/warehouse/inventory', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, ';
    html += 'user-scalable=no">';
    html += fontLink;
    html += uiScript;
    html += '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; justify-content: space-between; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.search { width: 100%; padding: 12px; border: none; ';
    html += 'border-radius: 12px; margin-bottom: 15px; ';
    html += 'box-sizing: border-box; font-family: inherit; ';
    html += 'box-shadow: 0 2px 8px rgba(15,61,62,0.05); }';
    html += '.h-scroll { display: flex; overflow-x: auto; ';
    html += 'gap: 8px; margin-bottom: 15px; padding-bottom: 5px; }';
    html += '.cat-btn { padding: 8px 15px; border: none; ';
    html += 'border-radius: 20px; background: #fff; cursor: pointer; ';
    html += 'font-size: 14px; white-space: nowrap; ';
    html += 'font-family: inherit; color: ' + brandColor + '; ';
    html += 'font-weight: 600; ';
    html += 'box-shadow: 0 2px 8px rgba(15,61,62,0.05); }';
    html += '.cat-btn.active { background: ' + brandColor + '; ';
    html += 'color: #fff; }';
    
    // Стили для настроек отображения
    html += '.controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }';
    html += '.view-toggles { display: flex; gap: 5px; background: #e0e0e0; padding: 4px; border-radius: 10px; }';
    html += '.view-btn { border: none; background: none; padding: 6px 10px; border-radius: 8px; cursor: pointer; color: #666; display: flex; align-items: center; justify-content: center; }';
    html += '.view-btn.active { background: #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.1); color: ' + brandColor + '; }';
    html += '.view-btn svg { width: 20px; height: 20px; }';
    html += '.limit-select { padding: 8px; border-radius: 10px; border: 1px solid #ddd; font-family: inherit; font-weight: 600; color: ' + brandColor + '; background: #fff; }';

    // Стили для сетки (плитка)
    html += '.grid-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }';
    html += '.card-tile { background: #fff; padding: 10px; border-radius: 16px; text-align: center; text-decoration: none; color: ' + brandColor + '; position: relative; box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
    html += '.card-tile img { width: 100%; height: 80px; object-fit: cover; border-radius: 12px; margin-bottom: 5px; }';
    html += '.card-tile .ph { height: 80px; border-radius: 12px; background: #F0F4F4; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; }';
    html += '.card-tile .ph svg { width: 32px; height: 32px; }';
    
    // Стили для списка (строки)
    html += '.grid-rows { display: flex; flex-direction: column; gap: 8px; }';
    html += '.card-row { background: #fff; padding: 10px 15px; border-radius: 12px; display: flex; align-items: center; justify-content: space-between; text-decoration: none; color: ' + brandColor + '; box-shadow: 0 2px 8px rgba(15,61,62,0.05); }';
    html += '.card-row .row-left { display: flex; align-items: center; gap: 12px; }';
    html += '.card-row img, .card-row .ph { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; }';
    html += '.card-row .ph { background: #F0F4F4; display: flex; align-items: center; justify-content: center; }';
    html += '.card-row .ph svg { width: 20px; height: 20px; }';
    
    html += '.name { font-size: 13px; font-weight: 600; margin-bottom: 2px; }';
    html += '.card-row .name { font-size: 15px; margin-bottom: 0; }';
    html += '.stock { font-size: 12px; font-weight: 800; }';
    html += '.green { color: ' + successColor + '; } .red { color: ' + dangerColor + '; }';
    html += '.pin-icon { position: absolute; top: 6px; right: 6px; color: #E67E22; }';
    html += '.card-row .pin-icon { position: static; margin-left: 5px; }';
    html += '</style></head><body>';

    html += '<div class="header">';
    html += '<div style="display:flex; align-items:center;">';
    html += '<a href="/warehouse-app" class="back">←</a>';
    html += '<h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('inventory') + 'Обзор</h2></div></div>';
    
    html += '<input type="text" class="search" id="search" placeholder="🔍 Поиск..." onkeyup="applyFilters()">';
    
    html += '<div class="controls">';
    html += '  <div class="view-toggles">';
    html += '    <button class="view-btn active" id="btn-view-tile" onclick="setViewMode(\'tile\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></button>';
    html += '    <button class="view-btn" id="btn-view-row" onclick="setViewMode(\'row\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>';
    html += '  </div>';
    html += '  <select class="limit-select" id="limitSelect" onchange="setLimit(this.value)">';
    html += '    <option value="10">10 шт</option>';
    html += '    <option value="30">30 шт</option>';
    html += '    <option value="50">50 шт</option>';
    html += '    <option value="100">100 шт</option>';
    html += '  </select>';
    html += '</div>';

    html += '<div class="h-scroll" id="catList">';
    html += '<button class="cat-btn active" id="cat-0" onclick="setCat(0)">Все</button></div>';
    
    html += '<div id="itemsContainer"></div>';
    html += '<div id="pagination" style="display:flex; justify-content:center; gap:10px; margin-top:20px;"></div>';

    html += '<script>';
    html += 'var allItems = []; var currentCat = 0;';
    html += 'var currentPage = 1; var pageLimit = 10; var viewMode = "tile";';
    
    html += 'var svgPh = \'<svg viewBox="0 0 24 24" fill="#A0B4B4"><path d="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5C2,15.5 3.5,17.5 6.5,17.5C7.21,17.5 7.87,17.36 8.5,17.12C11.24,16.08 13.44,14.57 15,12.5C15,12.5 15.5,14.5 15.5,16.5C15.5,18.5 14.5,20 14.5,20C17,20 19.5,17.5 20.5,14.5C21.5,11.5 21.5,8 21.5,8C21.5,8 19.5,6 17,8Z"/></svg>\';';
    html += 'var pinSvg = \'<svg class="pin-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>\';';

    html += 'function fmtNum(n) { var num = parseFloat(n); if (isNaN(num)) return "0"; return num % 1 === 0 ? num.toString() : num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, ""); }';

    // Загрузка настроек из памяти
    html += 'if (localStorage.getItem("wh_view_mode")) viewMode = localStorage.getItem("wh_view_mode");';
    html += 'if (localStorage.getItem("wh_page_limit")) pageLimit = parseInt(localStorage.getItem("wh_page_limit"));';
    html += 'document.getElementById("limitSelect").value = pageLimit;';
    html += 'updateViewButtons();';

    html += 'function setViewMode(mode) {';
    html += '  viewMode = mode; localStorage.setItem("wh_view_mode", mode);';
    html += '  updateViewButtons(); render();';
    html += '}';
    
    html += 'function updateViewButtons() {';
    html += '  document.getElementById("btn-view-tile").classList.remove("active");';
    html += '  document.getElementById("btn-view-row").classList.remove("active");';
    html += '  document.getElementById("btn-view-" + (viewMode === "tile" ? "tile" : "row")).classList.add("active");';
    html += '}';

    html += 'function setLimit(val) {';
    html += '  pageLimit = parseInt(val); localStorage.setItem("wh_page_limit", pageLimit);';
    html += '  currentPage = 1; render();';
    html += '}';

    html += 'fetch("/api/warehouse/categories").then(function(r){return r.json();}).then(function(d){';
    html += '  if (d.ok) { var cl = document.getElementById("catList"); d.categories.forEach(function(c){ var b = document.createElement("button"); b.className = "cat-btn"; b.id = "cat-" + c.id; b.innerText = c.name; b.onclick = function(){setCat(c.id);}; cl.appendChild(b); }); }';
    html += '}).catch(function(){});';

    html += 'fetch("/api/warehouse/items?shop=kupidon&t=" + Date.now()).then(function(r){return r.json();}).then(function(d){';
    html += '  if (d.ok) { allItems = d.items; applyFilters(); }';
    html += '}).catch(function(){});';

    html += 'function setCat(id) {';
    html += '  currentCat = id; currentPage = 1;';
    html += '  var els = document.querySelectorAll(".cat-btn"); els.forEach(function(el){el.classList.remove("active");});';
    html += '  document.getElementById("cat-" + id).classList.add("active"); applyFilters();';
    html += '}';

    html += 'function applyFilters() {';
    html += '  var q = document.getElementById("search").value.toLowerCase();';
    html += '  var filtered = allItems.filter(function(i){';
    html += '    var matchQ = i.name.toLowerCase().includes(q);';
    html += '    var matchC = (currentCat === 0 || i.category_id === currentCat);';
    html += '    return matchQ && matchC;';
    html += '  });';
    html += '  currentPage = 1; render(filtered);';
    html += '}';

    html += 'var filteredItems = [];';

    html += 'function render(items) {';
    html += '  if (items) filteredItems = items;';
    html += '  var totalPages = Math.ceil(filteredItems.length / pageLimit) || 1;';
    html += '  if (currentPage > totalPages) currentPage = totalPages;';
    html += '  var start = (currentPage - 1) * pageLimit;';
    html += '  var end = start + pageLimit;';
    html += '  var pageItems = filteredItems.slice(start, end);';
    html += '  var container = document.getElementById("itemsContainer");';
    html += '  container.className = viewMode === "tile" ? "grid-tiles" : "grid-rows";';
    html += '  container.innerHTML = "";';
    
    html += '  if (pageItems.length === 0) {';
    html += '    container.innerHTML = "<div style=\'text-align:center;padding:30px;color:#888;\'>Ничего не найдено</div>";';
    html += '  }';
    
    html += '  pageItems.forEach(function(i) {';
    html += '    var a = document.createElement("a");';
    html += '    a.href = "/warehouse/item?id=" + i.id;';
    html += '    var cl = parseFloat(i.current_stock) > 0 ? "green" : "red";';
    html += '    var unit = i.unit || "шт";';
    html += '    var imgHtml = i.photo_url ? \'<img src="\' + i.photo_url + \'">\' : \'<div class="ph">\' + svgPh + \'</div>\';';
    html += '    var pinHtml = i.is_pinned ? pinSvg : "";';
    
    // Отрисовка в зависимости от режима
    html += '    if (viewMode === "tile") {';
    html += '      a.className = "card-tile";';
    html += '      a.innerHTML = imgHtml + pinHtml + \'<div class="name">\' + i.name + \'</div><div class="stock \' + cl + \'">\' + fmtNum(i.current_stock) + \' \' + unit + \'</div>\';';
    html += '    } else {';
    html += '      a.className = "card-row";';
    html += '      a.innerHTML = \'<div class="row-left">\' + imgHtml + \'<div><div class="name">\' + i.name + pinHtml + \'</div></div></div>\' + \'<div class="stock \' + cl + \'">\' + fmtNum(i.current_stock) + \' \' + unit + \'</div>\';';
    html += '    }';
    html += '    container.appendChild(a);';
    html += '  });';

    // Отрисовка пагинации
    html += '  var pag = document.getElementById("pagination"); pag.innerHTML = "";';
    html += '  if (totalPages > 1) {';
    html += '    var prevBtn = document.createElement("button"); prevBtn.className = "cat-btn"; prevBtn.innerText = "←"; prevBtn.disabled = currentPage === 1; prevBtn.onclick = function(){ currentPage--; render(); window.scrollTo(0,0); }; if(currentPage === 1) prevBtn.style.opacity = "0.3";';
    html += '    var nextBtn = document.createElement("button"); nextBtn.className = "cat-btn"; nextBtn.innerText = "→"; nextBtn.disabled = currentPage === totalPages; nextBtn.onclick = function(){ currentPage++; render(); window.scrollTo(0,0); }; if(currentPage === totalPages) nextBtn.style.opacity = "0.3";';
    html += '    var txt = document.createElement("span"); txt.style = "display:flex; align-items:center; font-weight:600; font-size:14px;"; txt.innerText = currentPage + " / " + totalPages;';
    html += '    pag.appendChild(prevBtn); pag.appendChild(txt); pag.appendChild(nextBtn);';
    html += '  }';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });
  // ====== 7. API ИСТОРИИ ТОВАРА ======
  app.get('/api/warehouse/item/history', async (req, res) => {
    try {
      const itemId = parseInt(req.query.id);
      if (!itemId || isNaN(itemId)) {
        return res.json({
          ok: false, error: 'Неверный ID товара'
        });
      }
      const shopId = req.query.shop || 'kupidon';

      const itemInfo = await pool.query(
        'SELECT i.id, i.current_stock, i.item_id, i.is_pinned, ' +
        'COALESCE(i.custom_name, w.name) AS name, w.unit ' +
        'FROM wh_shop_items i ' +
        'JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.id = $1 AND i.shop_id = $2',
        [itemId, shopId]
      );
      if (itemInfo.rows.length === 0) {
        return res.json({ ok: false, error: 'Товар не найден' });
      }

      const sales = await pool.query(
        'SELECT s.id, s.date, \'sale\' as type, si.qty, ' +
        'a.name as person FROM wh_sale_items si ' +
        'JOIN wh_sales s ON s.id = si.sale_id ' +
        'LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'WHERE si.shop_item_id = $1 AND s.shop_id = $2 ' +
        'ORDER BY s.date DESC LIMIT 30',
        [itemId, shopId]
      );

      const receipts = await pool.query(
        'SELECT r.id, r.date, \'receipt\' as type, ri.qty, ' +
        '\'Приход\' as person FROM wh_receipt_items ri ' +
        'JOIN wh_receipts r ON r.id = ri.receipt_id ' +
        'WHERE ri.shop_item_id = $1 AND r.shop_id = $2 ' +
        'ORDER BY r.date DESC LIMIT 30',
        [itemId, shopId]
      );

      const writeoffs = await pool.query(
        'SELECT w.id, w.date, \'writeoff\' as type, w.qty, ' +
        'a.name as person, w.reason FROM wh_writeoffs w ' +
        'LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
        'WHERE w.shop_item_id = $1 AND w.shop_id = $2 ' +
        'ORDER BY w.date DESC LIMIT 30',
        [itemId, shopId]
      );

      let list = [
        ...sales.rows, ...receipts.rows, ...writeoffs.rows
      ];
      list.sort(function(a, b) {
        return new Date(b.date) - new Date(a.date);
      });

      let runningStock =
        parseFloat(itemInfo.rows[0].current_stock);
      list.forEach(function(op) {
        let qty = parseFloat(op.qty);
        op.stock_after = runningStock;
        if (op.type === 'receipt') {
          op.stock_before = runningStock - qty;
          runningStock -= qty;
        } else {
          op.stock_before = runningStock + qty;
          runningStock += qty;
        }
      });

      res.json({
        ok: true, item: itemInfo.rows[0], history: list
      });
    } catch (e) {
      console.error('History error:', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  // ====== 8. API ПЕРЕИМЕНОВАНИЯ ======
  app.post('/api/warehouse/item/rename', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      if (!chatId) return res.status(401).json({ ok: false });
      
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 LIMIT 1',
        [chatId]
      );
      if (ownerCheck.rows.length === 0 ||
          ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false, error: 'Только владелец' });
      }

      const itemId = parseInt(req.body.id);
      if (!itemId || isNaN(itemId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      const newName = capWords(req.body.name);
      if (!newName || newName.length > 200) {
        return res.json({ ok: false, error: 'Некорректное имя' });
      }

      const r = await pool.query(
        'SELECT item_id FROM wh_shop_items WHERE id = $1',
        [itemId]
      );
      if (r.rows.length === 0) {
        return res.json({ ok: false, error: 'Не найден' });
      }

      await pool.query(
        'UPDATE wh_items SET name = $1 WHERE id = $2',
        [newName, r.rows[0].item_id]
      );
      await pool.query(
        'UPDATE wh_shop_items SET custom_name = $1 WHERE id = $2',
        [newName, itemId]
      );
      await logAction('kupidon', chatId, 'rename',
        'Переименование в: ' + newName);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 9. API ЗАКРЕПЛЕНИЯ ======
  app.post('/api/warehouse/item/pin', async (req, res) => {
    try {
      const itemId = parseInt(req.body.id);
      const val = req.body.val === true;
      if (!itemId || isNaN(itemId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      await pool.query(
        'UPDATE wh_shop_items SET is_pinned = $1 WHERE id = $2',
        [val, itemId]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 10. API ОБЪЕДИНЕНИЯ ======
  app.post('/api/warehouse/item/merge', async (req, res) => {
    const client = await pool.connect();
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      if (!chatId) {
        client.release();
        return res.status(401).json({ ok: false });
      }
      const ownerCheck = await client.query(
        'SELECT role FROM admins WHERE chat_id = $1 LIMIT 1',
        [chatId]
      );
      if (ownerCheck.rows.length === 0 ||
          ownerCheck.rows[0].role !== 'owner') {
        client.release();
        return res.status(403).json({
          ok: false, error: 'Только владелец'
        });
      }

      const sourceId = parseInt(req.body.source_id);
      const targetName = String(req.body.target_name || '').trim();
      const shopId = 'kupidon';
      if (!sourceId || isNaN(sourceId) || !targetName) {
        client.release();
        return res.json({
          ok: false, error: 'Неверные данные'
        });
      }

      await client.query('BEGIN');

      const targetRes = await client.query(
        'SELECT i.id FROM wh_shop_items i ' +
        'JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE i.shop_id = $1 AND w.name = $2',
        [shopId, targetName]
      );
      if (targetRes.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.json({
          ok: false, error: 'Целевой товар не найден'
        });
      }
      const targetId = targetRes.rows[0].id;

      if (sourceId === targetId) {
        await client.query('ROLLBACK');
        client.release();
        return res.json({
          ok: false, error: 'Одинаковые товары'
        });
      }

      await client.query(
        'UPDATE wh_sale_items SET shop_item_id = $1 ' +
        'WHERE shop_item_id = $2',
        [targetId, sourceId]
      );
      await client.query(
        'UPDATE wh_receipt_items SET shop_item_id = $1 ' +
        'WHERE shop_item_id = $2',
        [targetId, sourceId]
      );
      await client.query(
        'UPDATE wh_writeoffs SET shop_item_id = $1 ' +
        'WHERE shop_item_id = $2',
        [targetId, sourceId]
      );
      await client.query(
        'UPDATE wh_bouquet_recipes SET shop_item_id = $1 ' +
        'WHERE shop_item_id = $2',
        [targetId, sourceId]
      );

      await client.query(
        'UPDATE wh_shop_items SET current_stock = ' +
        'current_stock + (SELECT current_stock ' +
        'FROM wh_shop_items WHERE id = $1) ' +
        'WHERE id = $2',
        [sourceId, targetId]
      );

      await client.query(
        'DELETE FROM wh_shop_items WHERE id = $1',
        [sourceId]
      );

      await client.query('COMMIT');
      client.release();

      await logAction(shopId, chatId, 'merge',
        'Объединение ID ' + sourceId + ' в ' + targetId);

      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 11. API УСТАНОВКИ ФОТО ======
  app.post('/api/warehouse/item/set-photo', async (req, res) => {
    try {
      const shopItemId = parseInt(req.body.id);
      const url = String(req.body.url || '');
      if (!shopItemId || isNaN(shopItemId) ||
          !url.startsWith('http')) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      const r = await pool.query(
        'SELECT item_id FROM wh_shop_items WHERE id = $1',
        [shopItemId]
      );
      if (r.rows.length === 0) {
        return res.json({ ok: false, error: 'Не найден' });
      }

      await pool.query(
        'UPDATE wh_items SET photo_url = $1 WHERE id = $2',
        [url, r.rows[0].item_id]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 12. КАРТОЧКА ТОВАРА (ВЫПИСКА) ======
  app.get('/warehouse/item', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, ';
    html += 'user-scalable=no">';
    html += fontLink;
    html += uiScript;
    html += '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    
    html += '.history-card { background: #fff; border-radius: 16px; ';
    html += 'padding: 16px; margin-bottom: 12px; display: flex; ';
    html += 'justify-content: space-between; align-items: center; ';
    html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); ';
    html += 'text-decoration: none; color: ' + brandColor + '; ';
    html += 'border-left: 5px solid transparent; transition: transform 0.2s; }';
    html += '.history-card:active { transform: scale(0.98); }';
    html += '.history-card.sale { border-left-color: #3C7A89; }';
    html += '.history-card.receipt { border-left-color: ' + successColor + '; }';
    html += '.history-card.writeoff { border-left-color: ' + dangerColor + '; }';
    
    html += '.h-left { display: flex; flex-direction: column; gap: 4px; }';
    html += '.h-title { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 6px; }';
    html += '.h-meta { font-size: 12px; color: #888; }';
    html += '.h-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 700; display: inline-block; }';
    html += '.badge-sale { background: #E3F2FD; color: #3C7A89; }';
    html += '.badge-receipt { background: #E8F5E9; color: ' + successColor + '; }';
    html += '.badge-writeoff { background: #FFEBEE; color: ' + dangerColor + '; }';
    
    html += '.h-right { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }';
    html += '.h-amount { font-weight: 800; font-size: 16px; }';
    html += '.h-stock { font-size: 11px; color: #aaa; font-weight: 600; }';
    
    html += '.actions { display: flex; gap: 8px; margin-top: 15px; ';
    html += 'justify-content: center; margin-bottom: 20px; flex-wrap: wrap; }';
    html += '.btn-act { padding: 10px 15px; border-radius: 12px; ';
    html += 'border: none; font-weight: 600; color: #fff; font-size: 13px; ';
    html += 'font-family: inherit; cursor: pointer; display: flex; align-items: center; gap: 5px; }';
    html += '.btn-act svg { width: 16px; height: 16px; }';
    html += '.btn-rename { background: #E67E22; }';
    html += '.btn-merge { background: ' + dangerColor + '; }';
    html += '.btn-photo { background: #3C7A89; }';
    html += '.btn-pin { background: ' + (brandColor) + '; }';
    html += '.btn-pin.active { background: #E67E22; }';
    html += '</style></head><body>';

    html += '<div class="header">';
    html += '<a href="/warehouse/inventory" class="back">←</a>';
    html += '<h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('inventory') + 'Выписка</h2></div>';

    html += '<input type="file" id="photoInput" accept="image/*" ';
    html += 'style="display:none;" onchange="uploadPhoto()">';

    html += '<div id="header-info" style="text-align:center; ';
    html += 'margin-bottom:15px;"></div>';

    html += '<div class="actions" id="actions" style="display:none;">';
    html += '<button class="btn-act btn-pin" id="btnPin" onclick="togglePin()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> Закрепить</button>';
    html += '<button class="btn-act btn-rename" onclick="renameItem()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg> Имя</button>';
    html += '<button class="btn-act btn-merge" onclick="mergeItem()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg> Объединить</button>';
    html += '<button class="btn-act btn-photo" onclick="document.getElementById(\'photoInput\').click()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> Фото</button>';
    html += '</div>';

    html += '<div id="list">Загрузка...</div>';

    html += '<script>';
    html += 'var urlParams = new URLSearchParams(window.location.search);';
    html += 'var itemId = parseInt(urlParams.get("id")) || 0;';
    html += 'var itemName = ""; var itemUnit = "шт"; var isPinned = false;';

    html += 'function fmtNum(n) {';
    html += '  var num = parseFloat(n);';
    html += '  if (isNaN(num)) return "0";';
    html += '  return num % 1 === 0 ? num.toString() : ';
    html += 'num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");';
    html += '}';

    html += 'function translateReason(r) {';
    html += '  var map = { spoilage: "Порча", loss: "Потеря", markdown: "Уценка", sorting: "Пересорт" };';
    html += '  return map[r] || r;';
    html += '}';

    html += 'fetch("/api/warehouse/item/history?id=" + itemId)';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) {';
    html += '  var b = document.getElementById("list");';
    html += '  b.innerHTML = "";';
    html += '  var hi = document.getElementById("header-info");';
    html += '  if (!d.ok) {';
    html += '    hi.innerHTML = "<div style=\'color:red\'>Ошибка: " + d.error + "</div>"; return; }';
    html += '  if (d.item) {';
    html += '    itemName = d.item.name;';
    html += '    itemUnit = d.item.unit || "шт";';
    html += '    isPinned = d.item.is_pinned === true;';
    
    html += '    document.getElementById("actions").style.display = "flex";';
    html += '    updatePinBtn();';
    
    html += '    var isPos = parseFloat(d.item.current_stock) > 0;';
    html += '    var cl = isPos ? "' + successColor + '" : "' + dangerColor + '";';
    
    html += '    var h2 = document.createElement("h2");';
    html += '    h2.style.margin = "0"; h2.style.fontSize = "24px";';
    html += '    h2.textContent = itemName;';
    html += '    hi.appendChild(h2);';
    
    html += '    var stockDiv = document.createElement("div");';
    html += '    stockDiv.style.fontSize = "20px";';
    html += '    stockDiv.style.fontWeight = "800";';
    html += '    stockDiv.style.color = cl;';
    html += '    stockDiv.style.marginTop = "5px";';
    html += '    stockDiv.textContent = "Остаток: " + fmtNum(d.item.current_stock) + " " + itemUnit;';
    html += '    hi.appendChild(stockDiv);';
    html += '  }';
    html += '  if (d.history.length === 0) {';
    html += '    b.innerHTML = "<div style=\'text-align:center; color:#888; margin-top:20px;\'>Нет операций</div>";';
    html += '    return; }';

    html += '  d.history.forEach(function(h) {';
    html += '    var a = document.createElement("a");';
    html += '    var ds = new Date(h.date).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });';
    
    html += '    var left = document.createElement("div");';
    html += '    left.className = "h-left";';
    html += '    var title = document.createElement("div");';
    html += '    title.className = "h-title";';
    html += '    var meta = document.createElement("div");';
    html += '    meta.className = "h-meta";';
    html += '    meta.textContent = ds + " · " + (h.person || "Система");';
    
    html += '    var right = document.createElement("div");';
    html += '    right.className = "h-right";';
    html += '    var amt = document.createElement("div");';
    html += '    amt.className = "h-amount";';
    html += '    var stockFlow = document.createElement("div");';
    html += '    stockFlow.className = "h-stock";';
    html += '    stockFlow.textContent = fmtNum(h.stock_before) + " → " + fmtNum(h.stock_after);';

    html += '    if (h.type === "sale") {';
    html += '      a.className = "history-card sale";';
    html += '      a.href = "/warehouse/sale/details?id=" + h.id;';
    html += '      title.innerHTML = "<span class=\'h-badge badge-sale\'>Продажа</span> №" + h.id;';
    html += '      amt.textContent = "-" + fmtNum(h.qty) + " " + itemUnit;';
    html += '      amt.style.color = "#3C7A89";';
    html += '    } else if (h.type === "writeoff") {';
    html += '      a.className = "history-card writeoff";';
    html += '      a.href = "/warehouse/documents/details?id=" + h.id + "&type=writeoffs";';
    html += '      title.innerHTML = "<span class=\'h-badge badge-writeoff\'>Списание</span> №" + h.id;';
    html += '      meta.textContent += " · " + translateReason(h.reason);';
    html += '      amt.textContent = "-" + fmtNum(h.qty) + " " + itemUnit;';
    html += '      amt.style.color = "' + dangerColor + '";';
    html += '    } else {';
    html += '      a.className = "history-card receipt";';
    html += '      a.href = "/warehouse/documents/details?id=" + h.id + "&type=receipts";';
    html += '      title.innerHTML = "<span class=\'h-badge badge-receipt\'>Приход</span> №" + h.id;';
    html += '      amt.textContent = "+" + fmtNum(h.qty) + " " + itemUnit;';
    html += '      amt.style.color = "' + successColor + '";';
    html += '    }';

    html += '    left.appendChild(title); left.appendChild(meta);';
    html += '    right.appendChild(amt); right.appendChild(stockFlow);';
    html += '    a.appendChild(left); a.appendChild(right);';
    html += '    b.appendChild(a);';
    html += '  });';
    html += '}).catch(function() {';
    html += '  document.getElementById("list").textContent = "Ошибка загрузки";';
    html += '});';

    html += 'function togglePin() {';
    html += '  var newVal = !isPinned;';
    html += '  fetch("/api/warehouse/item/pin", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ id: itemId, val: newVal }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { if (d.ok) { isPinned = newVal; updatePinBtn(); } })';
    html += '  .catch(function() {});';
    html += '}';
    
    html += 'function updatePinBtn() {';
    html += '  var b = document.getElementById("btnPin");';
    html += '  if (isPinned) { b.classList.add("active"); b.innerHTML = "<svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\'><polygon points=\'12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\'></polygon></svg> Открепить"; }';
    html += '  else { b.classList.remove("active"); b.innerHTML = "<svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\'><polygon points=\'12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\'></polygon></svg> Закрепить"; }';
    html += '}';

    html += 'function renameItem() {';
    html += '  var newName = prompt("Введите новое название:", itemName);';
    html += '  if (!newName || newName === itemName) return;';
    html += '  fetch("/api/warehouse/item/rename", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ id: itemId, name: newName }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { if (d.ok) { ';
    html += 'showAlert("Успех", "Переименовано", true); ';
    html += 'setTimeout(function() { location.reload(); }, 1000); ';
    html += '} else showAlert("Ошибка", d.error, false); })';
    html += '  .catch(function() { showAlert("Ошибка сети", "Повторите", false); });';
    html += '}';

    html += 'function mergeItem() {';
    html += '  var targetName = prompt("Название товара, В КОТОРЫЙ объединить:");';
    html += '  if (!targetName) return;';
    html += '  showConfirm("Объединение", "Вы уверены? Этот товар будет удален, а данные перейдут в \'" + targetName + "\'.", ';
    html += '  function() {';
    html += '    fetch("/api/warehouse/item/merge", { method: "POST", ';
    html += '    headers: { "Content-Type": "application/json" }, ';
    html += '    body: JSON.stringify({ source_id: itemId, target_name: targetName }) })';
    html += '    .then(function(r) { return r.json(); })';
    html += '    .then(function(d) { if (d.ok) { window.location.href = "/warehouse/inventory"; } ';
    html += '    else showAlert("Ошибка", d.error, false); })';
    html += '    .catch(function() { showAlert("Ошибка сети", "Повторите", false); });';
    html += '  }, true);';
    html += '}';

    html += 'function uploadPhoto() {';
    html += '  var f = document.getElementById("photoInput").files[0];';
    html += '  if (!f) return;';
    html += '  showAlert("Загрузка", "Сжимаем и отправляем фото...", true);';
    html += '  var rd = new FileReader();';
    html += '  rd.onload = function(e) {';
    html += '    var img = new Image();';
    html += '    img.onload = function() {';
    html += '      var canvas = document.createElement("canvas");';
    html += '      var MAX = 800;';
    html += '      var w = img.width, h = img.height;';
    html += '      if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }';
    html += '      else { if (h > MAX) { w *= MAX / h; h = MAX; } }';
    html += '      canvas.width = w; canvas.height = h;';
    html += '      var ctx = canvas.getContext("2d");';
    html += '      ctx.drawImage(img, 0, 0, w, h);';
    html += '      var dataUrl = canvas.toDataURL("image/jpeg", 0.7);';
    html += '      sendCompressedPhoto(dataUrl);';
    html += '    };';
    html += '    img.src = e.target.result;';
    html += '  };';
    html += '  rd.readAsDataURL(f);';
    html += '}';

    html += 'function sendCompressedPhoto(base64) {';
    html += '  fetch("/api/warehouse/upload", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ image: base64 }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) {';
    html += '    if (d.ok) { savePhoto(d.url); }';
    html += '    else { showAlert("Ошибка", d.error || "Сервер не принял фото", false); }';
    html += '  }).catch(function() { showAlert("Ошибка сети", "Не удалось загрузить фото", false); });';
    html += '}';

    html += 'function savePhoto(url) {';
    html += '  fetch("/api/warehouse/item/set-photo", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ id: itemId, url: url }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) {';
    html += '    if (d.ok) { showAlert("Успех", "Фото обновлено", true); ';
    html += '    setTimeout(function() { location.reload(); }, 1000); }';
    html += '    else showAlert("Ошибка базы", d.error, false);';
    html += '  }).catch(function() { showAlert("Ошибка", "Сбой при сохранении", false); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });
  // ====== 13. API ЖУРНАЛА (С ФИЛЬТРОМ ПО ВРЕМЕНИ) ======
  app.get('/api/warehouse/audit', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const period = req.query.period || 'today';
      
      let dateFilter = '';
      if (period === 'today') dateFilter = 'AND DATE(l.date) = CURRENT_DATE';
      else if (period === 'week') dateFilter = 'AND l.date >= NOW() - INTERVAL \'7 days\'';
      else if (period === 'month') dateFilter = 'AND l.date >= NOW() - INTERVAL \'1 month\'';

      const r = await pool.query(
        'SELECT l.action, l.details, l.date, l.ref_id, ' +
        'a.name as person ' +
        'FROM wh_audit_log l ' +
        'LEFT JOIN admins a ON a.chat_id = l.chat_id ' +
        'WHERE l.shop_id = $1 ' + dateFilter + ' ' +
        'ORDER BY l.date DESC LIMIT 100',
        [shopId]
      );
      res.json({ ok: true, logs: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 14. ЭКРАН ЖУРНАЛА ======
  app.get('/warehouse/audit', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, ';
    html += 'user-scalable=no">';
    html += fontLink;
    html += uiScript;
    html += '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    
    html += '.filters { display: flex; gap: 8px; margin-bottom: 15px; }';
    html += '.filter { flex: 1; padding: 10px; border: 1px solid #ddd; ';
    html += 'border-radius: 12px; background: #fff; text-align: center; ';
    html += 'cursor: pointer; font-size: 13px; font-weight: 600; }';
    html += '.filter.active { background: ' + brandColor + '; color: #fff; }';

    html += '.log-card { background: #fff; border-radius: 16px; ';
    html += 'padding: 15px; margin-bottom: 10px; ';
    html += 'cursor: pointer; ';
    html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); ';
    html += 'border-left: 4px solid #ddd; }';
    html += '.log-card.sale { border-left-color: #3C7A89; }';
    html += '.log-card.receipt { border-left-color: ';
    html += successColor + '; }';
    html += '.log-card.writeoff { border-left-color: ';
    html += dangerColor + '; }';
    html += '.log-card.shift { border-left-color: #E67E22; }';
    html += '.log-top { display: flex; justify-content: space-between; ';
    html += 'align-items: center; margin-bottom: 8px; }';
    html += '.log-title { font-weight: 800; font-size: 15px; ';
    html += 'display: flex; align-items: center; }';
    html += '.log-title svg { width: 18px; height: 18px; ';
    html += 'margin-right: 6px; }';
    html += '.log-date { font-size: 11px; color: #888; }';
    html += '.log-desc { font-size: 14px; color: #444; ';
    html += 'line-height: 1.4; }';
    html += '.log-link { font-size: 12px; color: #3C7A89; ';
    html += 'margin-top: 8px; font-weight: 600; }';
    html += '</style></head><body>';

    html += '<div class="header">';
    html += '<a href="/warehouse-app" class="back">←</a>';
    html += '<h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('audit') + 'Журнал</h2></div>';
    
    html += '<div class="filters">';
    html += '<div class="filter active" id="f-today" onclick="setPeriod(\'today\')">Сегодня</div>';
    html += '<div class="filter" id="f-week" onclick="setPeriod(\'week\')">Неделя</div>';
    html += '<div class="filter" id="f-month" onclick="setPeriod(\'month\')">Месяц</div>';
    html += '</div>';

    html += '<div id="list">Загрузка...</div>';

    html += '<script>';
    html += 'var currentPeriod = "today";';
    
    html += 'function setPeriod(p) {';
    html += '  currentPeriod = p;';
    html += '  document.querySelectorAll(".filter").forEach(function(el){el.classList.remove("active");});';
    html += '  document.getElementById("f-" + p).classList.add("active");';
    html += '  loadData();';
    html += '}';

    html += 'function getActionIcon(action) {';
    html += '  var c = "class=\'svg-ico\' viewBox=\'0 0 24 24\' ';
    html += 'fill=\'none\' stroke=\'currentColor\' ';
    html += 'stroke-width=\'2\'";';
    html += '  if (action === "sale") return "<svg " + c + ';
    html += '"><rect x=\'2\' y=\'5\' width=\'20\' height=\'14\' ';
    html += 'rx=\'2\'/><line x1=\'2\' y1=\'10\' x2=\'22\' ';
    html += 'y2=\'10\'/></svg>";';
    html += '  if (action === "receipt") return "<svg " + c + ';
    html += '"><path d=\'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 ';
    html += '0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 ';
    html += '2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z\'/></svg>";';
    html += '  if (action === "writeoff" || action === "cancel") ';
    html += 'return "<svg " + c + "><polyline points=\'3 6 5 6 21 ';
    html += '6\'/><path d=\'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2';
    html += 'V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\'/></svg>";';
    html += '  if (action === "shift") return "<svg " + c + ';
    html += '"><circle cx=\'12\' cy=\'12\' r=\'10\'/><polyline ';
    html += 'points=\'12 6 12 12 16 14\'/></svg>";';
    html += '  return "<svg " + c + "><circle cx=\'12\' cy=\'12\' ';
    html += 'r=\'3\'/></svg>";';
    html += '}';

    html += 'function loadData() {';
    html += '  var listEl = document.getElementById("list");';
    html += '  listEl.innerHTML = "Загрузка...";';
    html += '  fetch("/api/warehouse/audit?shop=kupidon&period=" + currentPeriod)';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) {';
    html += '    listEl.innerHTML = "";';
    html += '    if (!d.ok || d.logs.length === 0) {';
    html += '      listEl.textContent = "Журнал пуст"; return; }';

    html += '    d.logs.forEach(function(l) {';
    html += '      var div = document.createElement("div");';
    html += '      var acts = ["sale","receipt","writeoff","shift"];';
    html += '      var actClass = acts.indexOf(l.action) >= 0 ? l.action : "";';
    html += '      div.className = "log-card " + actClass;';

    html += '      var ds = new Date(l.date).toLocaleString("ru-RU", ';
    html += '      { day: "2-digit", month: "2-digit", ';
    html += '      hour: "2-digit", minute: "2-digit" });';
    html += '      var p = l.person || "Система";';

    html += '      var top = document.createElement("div");';
    html += '      top.className = "log-top";';
    html += '      var titleDiv = document.createElement("div");';
    html += '      titleDiv.className = "log-title";';
    html += '      titleDiv.innerHTML = getActionIcon(l.action);';
    html += '      var nameSpan = document.createElement("span");';
    html += '      nameSpan.textContent = p;';
    html += '      titleDiv.appendChild(nameSpan);';
    html += '      var dateDiv = document.createElement("div");';
    html += '      dateDiv.className = "log-date";';
    html += '      dateDiv.textContent = ds;';
    html += '      top.appendChild(titleDiv);';
    html += '      top.appendChild(dateDiv);';
    html += '      div.appendChild(top);';

    html += '      var desc = document.createElement("div");';
    html += '      desc.className = "log-desc";';
    html += '      desc.textContent = l.details || "";';
    html += '      div.appendChild(desc);';

    html += '      if (l.ref_id) {';
    html += '        var link = document.createElement("div");';
    html += '        link.className = "log-link";';
    html += '        if (l.action === "sale") {';
    html += '          link.textContent = "Чек №" + l.ref_id + " →";';
    html += '          div.onclick = function() { ';
    html += 'window.location.href = ';
    html += '"/warehouse/sale/details?id=" + l.ref_id; };';
    html += '        } else if (l.action === "receipt") {';
    html += '          link.textContent = "Накладная №" + l.ref_id + " →";';
    html += '          div.onclick = function() { ';
    html += 'window.location.href = ';
    html += '"/warehouse/documents/details?id=" + l.ref_id + ';
    html += '"&type=receipts"; };';
    html += '        } else if (l.action === "writeoff") {';
    html += '          link.textContent = "Акт списания №" + l.ref_id + " →";';
    html += '          div.onclick = function() { ';
    html += 'window.location.href = ';
    html += '"/warehouse/documents/details?id=" + l.ref_id + ';
    html += '"&type=writeoffs"; };';
    html += '        }';
    html += '        div.appendChild(link);';
    html += '      }';
    html += '      listEl.appendChild(div);';
    html += '    });';
    html += '  }).catch(function() {';
    html += '    listEl.textContent = "Ошибка загрузки";';
    html += '  });';
    html += '}';
    
    html += 'loadData();';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 15. ЭКРАН СМЕНЫ ======
  app.get('/warehouse/shift', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;

      const shiftRes = await pool.query(
        'SELECT * FROM wh_shifts WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND status = \'open\' LIMIT 1',
        ['kupidon', chatId]
      );

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, ';
      html += 'user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
      html += 'padding: 15px; background: ' + bgGradient + '; ';
      html += 'color: ' + brandColor + '; }';
      html += '.header { display: flex; align-items: center; ';
      html += 'margin-bottom: 15px; }';
      html += '.back { font-size: 24px; text-decoration: none; ';
      html += 'color: ' + brandColor + '; margin-right: 15px; }';
      html += '.card { background: #fff; border-radius: 20px; ';
      html += 'padding: 20px; ';
      html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
      html += '.btn { width: 100%; padding: 15px; color: #fff; ';
      html += 'border: none; border-radius: 12px; font-size: 16px; ';
      html += 'font-weight: 800; margin-top: 15px; ';
      html += 'font-family: inherit; }';
      html += '.btn-green { background: ' + successColor + '; }';
      html += '.btn-red { background: ' + dangerColor + '; }';
      html += 'input { width: 100%; padding: 15px; font-size: 20px; ';
      html += 'border: 2px solid #eee; border-radius: 12px; ';
      html += 'margin-top: 5px; box-sizing: border-box; ';
      html += 'font-family: inherit; }';
      html += 'label { display: block; margin-top: 15px; ';
      html += 'font-weight: 600; font-size: 14px; }';
      html += '.stats { margin-top: 15px; font-size: 14px; }';
      html += '.stats div { display: flex; justify-content: space-between; ';
      html += 'margin-bottom: 8px; }';
      html += '.total-rev { font-size: 18px; font-weight: 800; ';
      html += 'margin-top: 10px; padding-top: 10px; ';
      html += 'border-top: 1px solid #eee; }';
      html += '</style></head><body>';

      html += '<div class="header"><a href="/warehouse-app" ';
      html += 'class="back">←</a><h2 style="margin:0; display:flex; ';
      html += 'align-items:center;">';
      html += getIconSvg('shift') + 'Смена</h2></div>';

      if (shiftRes.rows.length === 0) {
        html += '<div class="card">';
        html += '<h3 style="margin-top:0;">Открытие смены</h3>';
        html += '<p style="color:#666; font-size:14px;">';
        html += 'Укажите сумму наличных в кассе ';
        html += 'на начало дня.</p>';
        html += '<label>Наличные в кассе (₽)</label>';
        html += '<input type="number" id="startCash" ';
        html += 'placeholder="0">';
        html += '<button class="btn btn-green" ';
        html += 'onclick="openShift()">Открыть смену</button></div>';
      } else {
        const shift = shiftRes.rows[0];
        const salesRes = await pool.query(
          'SELECT SUM(pay_cash) as c, SUM(pay_card) as k, ' +
          'SUM(pay_qr) as q, SUM(real_price) as t ' +
          'FROM wh_sales WHERE shop_id = $1 AND date >= $2',
          ['kupidon', shift.open_time]
        );
        const st = salesRes.rows[0];
        const cash = parseFloat(st.c || 0);
        const card = parseFloat(st.k || 0);
        const qr = parseFloat(st.q || 0);
        const total = parseFloat(st.t || 0);
        const start = parseFloat(shift.start_cash);

        html += '<div class="card">';
        html += '<h3 style="margin-top:0;">Смена открыта</h3>';
        html += '<div class="stats">';
        html += '<div><span>Наличные:</span> <b>' + cash;
        html += ' ₽</b></div>';
        html += '<div><span>Карта:</span> <b>' + card;
        html += ' ₽</b></div>';
        html += '<div><span>QR:</span> <b>' + qr + ' ₽</b></div>';
        html += '<div class="total-rev"><span>Выручка:</span> ';
        html += '<span>' + total + ' ₽</span></div>';
        html += '</div>';

        html += '<label>Фактически наличных в кассе (₽)</label>';
        html += '<input type="number" id="endCash" ';
        html += 'placeholder="' + (start + cash) + '">';
        html += '<p style="font-size:12px; color:#888;">';
        html += 'Ожидается: ' + (start + cash) + ' ₽ ';
        html += '(Остаток + Нал)</p>';
        html += '<button class="btn btn-red" ';
        html += 'onclick="closeShift()">Закрыть смену</button></div>';
      }

      html += '<script>';
      html += 'function openShift() {';
      html += '  var v = document.getElementById("startCash")';
      html += '.value || 0;';
      html += '  fetch("/api/warehouse/shift", { method: "POST", ';
      html += 'headers: { "Content-Type": "application/json" }, ';
      html += 'body: JSON.stringify({ action: "open", val: v }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) window.location.href = "/warehouse/sale";';
      html += '    else showAlert("Ошибка", d.error, false);';
      html += '  })';
      html += '  .catch(function() {';
      html += '    showAlert("Ошибка сети", "Повторите", false);';
      html += '  });';
      html += '}';

      html += 'function closeShift() {';
      html += '  var v = document.getElementById("endCash").value;';
      html += '  if (!v) { showAlert("Внимание", "Введите сумму", ';
      html += 'false); return; }';
      html += '  fetch("/api/warehouse/shift", { method: "POST", ';
      html += 'headers: { "Content-Type": "application/json" }, ';
      html += 'body: JSON.stringify({ action: "close", val: v }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) { ';
      html += 'showAlert("Успех", "Смена закрыта", true); ';
      html += '      setTimeout(function() { ';
      html += 'window.location.href = "/warehouse-app"; }, 1500); ';
      html += '    } else showAlert("Ошибка", d.error, false);';
      html += '  })';
      html += '  .catch(function() {';
      html += '    showAlert("Ошибка сети", "Повторите", false);';
      html += '  });';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) { res.status(500).send(e.message); }
  });

  // ====== 16. API СМЕНЫ ======
  app.post('/api/warehouse/shift', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      if (!chatId) {
        return res.status(401).json({ ok: false });
      }

      if (req.body.action === 'open') {
        const existing = await pool.query(
          'SELECT id FROM wh_shifts WHERE shop_id = $1 ' +
          'AND chat_id = $2 AND status = \'open\' LIMIT 1',
          ['kupidon', chatId]
        );
        if (existing.rows.length > 0) {
          return res.json({
            ok: false, error: 'Смена уже открыта'
          });
        }
        const startCash = parseFloat(req.body.val) || 0;
        if (startCash < 0) {
          return res.json({
            ok: false, error: 'Некорректная сумма'
          });
        }
        await pool.query(
          'INSERT INTO wh_shifts (shop_id, chat_id, start_cash) ' +
          'VALUES ($1, $2, $3)',
          ['kupidon', chatId, startCash]
        );
      } else {
        const shiftRes = await pool.query(
          'SELECT id, start_cash, open_time FROM wh_shifts ' +
          'WHERE shop_id = $1 AND chat_id = $2 ' +
          'AND status = \'open\' ORDER BY open_time DESC LIMIT 1',
          ['kupidon', chatId]
        );
        if (shiftRes.rows.length === 0) {
          return res.json({
            ok: false, error: 'Смена не найдена'
          });
        }
        const shift = shiftRes.rows[0];

        const salesRes = await pool.query(
          'SELECT SUM(pay_cash) as c, SUM(pay_card) as k, ' +
          'SUM(pay_qr) as q, SUM(real_price) as t ' +
          'FROM wh_sales WHERE shop_id = $1 AND date >= $2',
          ['kupidon', shift.open_time]
        );
        const st = salesRes.rows[0];
        const cash = parseFloat(st.c || 0);
        const card = parseFloat(st.k || 0);
        const qr = parseFloat(st.q || 0);
        const total = parseFloat(st.t || 0);

        const expected = parseFloat(shift.start_cash) + cash;
        const actual = parseFloat(req.body.val);
        if (isNaN(actual)) {
          return res.json({
            ok: false, error: 'Некорректная сумма'
          });
        }
        const discrepancy = actual - expected;

        await pool.query(
          'UPDATE wh_shifts SET close_time = NOW(), ' +
          'end_cash_fact = $1, total_sales = $2, cash_sales = $3, ' +
          'card_sales = $4, qr_sales = $5, discrepancy = $6, ' +
          'status = \'closed\' WHERE id = $7',
          [actual, total, cash, card, qr, discrepancy, shift.id]
        );
        await logAction('kupidon', chatId, 'shift',
          'Закрыта смена. Расхождение: ' + discrepancy);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  // ====== 17. ЭКРАН ПРОДАЖИ (КАССА) ======
  app.get('/warehouse/sale', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;

      const shiftRes = await pool.query(
        'SELECT id FROM wh_shifts WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND status = \'open\' LIMIT 1',
        ['kupidon', chatId]
      );

      if (shiftRes.rows.length === 0) {
        let errHtml = '<!DOCTYPE html><html><head>';
        errHtml += '<meta charset="UTF-8">';
        errHtml += '<meta name="viewport" content="width=device-width, ';
        errHtml += 'initial-scale=1.0, maximum-scale=1.0, ';
        errHtml += 'user-scalable=no">';
        errHtml += fontLink;
        errHtml += '<style>';
        errHtml += 'body { font-family: "Manrope", sans-serif; ';
        errHtml += 'margin: 0; padding: 15px; background: ';
        errHtml += bgGradient + '; color: ' + brandColor + '; ';
        errHtml += 'display: flex; flex-direction: column; ';
        errHtml += 'align-items: center; justify-content: center; ';
        errHtml += 'height: 100vh; }';
        errHtml += '.card { background: #fff; border-radius: 20px; ';
        errHtml += 'padding: 40px 20px; text-align: center; ';
        errHtml += 'max-width: 300px; width: 100%; ';
        errHtml += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
        errHtml += 'h1 { font-size: 50px; margin: 0 0 10px 0; }';
        errHtml += 'h2 { margin: 0 0 10px 0; }';
        errHtml += 'p { color: #888; font-size: 14px; ';
        errHtml += 'margin-bottom: 20px; }';
        errHtml += '.btn { display: block; width: 100%; ';
        errHtml += 'box-sizing: border-box; padding: 15px; ';
        errHtml += 'background: ' + brandColor + '; color: #fff; ';
        errHtml += 'text-decoration: none; border-radius: 12px; ';
        errHtml += 'font-weight: 800; font-size: 16px; }';
        errHtml += '</style></head><body>';
        errHtml += '<div class="card"><h1>⏱</h1>';
        errHtml += '<h2>Смена не открыта</h2>';
        errHtml += '<p>Для оформления продаж сначала ';
        errHtml += 'откройте смену.</p>';
        errHtml += '<a href="/warehouse/shift" class="btn">';
        errHtml += 'Открыть смену</a>';
        errHtml += '</div></body></html>';
        return res.send(errHtml);
      }

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, ';
      html += 'user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
      html += 'padding: 15px; padding-bottom: 90px; background: ';
      html += bgGradient + '; color: ' + brandColor + '; }';
      html += '.header { display: flex; align-items: center; ';
      html += 'margin-bottom: 15px; justify-content: space-between; }';
      html += '.header-left { display: flex; align-items: center; }';
      html += '.back { font-size: 24px; text-decoration: none; ';
      html += 'color: ' + brandColor + '; margin-right: 15px; }';
      html += '.burger { font-size: 24px; background: none; ';
      html += 'border: none; color: ' + brandColor + '; ';
      html += 'cursor: pointer; padding: 0; }';

      html += '.search-wrapper { position: relative; ';
      html += 'margin-bottom: 15px; }';
      html += '.search { width: 100%; padding: 15px; border: none; ';
      html += 'border-radius: 12px; box-sizing: border-box; ';
      html += 'font-family: inherit; font-size: 16px; ';
      html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
      html += '.search-results { display: none; position: absolute; ';
      html += 'top: 100%; left: 0; right: 0; background: #fff; ';
      html += 'border-radius: 12px; margin-top: 5px; z-index: 100; ';
      html += 'box-shadow: 0 4px 15px rgba(0,0,0,0.1); ';
      html += 'max-height: 200px; overflow-y: auto; }';
      html += '.sr-item { padding: 15px; border-bottom: 1px solid #eee; ';
      html += 'cursor: pointer; display: flex; ';
      html += 'justify-content: space-between; }';

      html += '.h-scroll { display: flex; overflow-x: auto; ';
      html += 'gap: 8px; margin-bottom: 15px; padding-bottom: 5px; }';
      html += '.cat-btn { padding: 8px 15px; border: none; ';
      html += 'border-radius: 20px; background: #fff; cursor: pointer; ';
      html += 'font-size: 14px; white-space: nowrap; ';
      html += 'font-family: inherit; color: ' + brandColor + '; ';
      html += 'font-weight: 600; ';
      html += 'box-shadow: 0 2px 8px rgba(15,61,62,0.05); }';
      html += '.cat-btn.active { background: ' + brandColor + '; ';
      html += 'color: #fff; }';
      html += '.cat-btn.bouquets-btn { background: #FFF3E0; ';
      html += 'color: ' + accentColor + '; font-weight: 700; }';
      html += '.cat-btn.bouquets-btn.active { background: ';
      html += accentColor + '; color: #fff; }';

      html += '.grid { display: grid; ';
      html += 'grid-template-columns: repeat(3, 1fr); gap: 8px; }';
      html += '.card { background: #fff; padding: 8px; ';
      html += 'border-radius: 12px; text-align: center; ';
      html += 'cursor: pointer; position: relative; ';
      html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
      html += '.card img { width: 100%; height: 60px; ';
      html += 'object-fit: cover; border-radius: 8px; ';
      html += 'margin-bottom: 4px; }';
      html += '.card .ph { height: 60px; border-radius: 8px; ';
      html += 'background: #F0F4F4; display: flex; ';
      html += 'align-items: center; justify-content: center; ';
      html += 'margin-bottom: 4px; }';
      html += '.card .ph svg { width: 24px; height: 24px; }';
      html += '.card .name { font-size: 11px; font-weight: 600; ';
      html += 'margin-bottom: 2px; line-height: 1.2; }';
      html += '.card .stock { font-size: 10px; font-weight: 800; ';
      html += 'color: ' + successColor + '; }';
      html += '.card.bouquet { background: #FFF8F3; ';
      html += 'border: 2px solid ' + accentColor + '; }';
      html += '.card .bouquet-tag { font-size: 10px; ';
      html += 'color: ' + accentColor + '; font-weight: 800; }';
      
      html += '.card.pinned { border: 2px solid #E67E22; }';
      html += '.pin-badge { position: absolute; top: -5px; right: -5px; ';
      html += 'background: #E67E22; color: #fff; font-size: 12px; ';
      html += 'width: 24px; height: 24px; border-radius: 50%; ';
      html += 'display: flex; align-items: center; justify-content: center; ';
      html += 'box-shadow: 0 2px 5px rgba(0,0,0,0.2); z-index: 10; }';

      html += '.floating-cart { position: fixed; bottom: 20px; ';
      html += 'left: 15px; right: 15px; background: ';
      html += brandColor + '; color: #fff; padding: 15px 20px; ';
      html += 'border-radius: 16px; display: none; ';
      html += 'justify-content: space-between; align-items: center; ';
      html += 'box-shadow: 0 8px 25px rgba(15,61,62,0.3); z-index: 900; ';
      html += 'cursor: pointer; font-weight: 800; font-size: 16px; ';
      html += 'transition: background 0.3s, transform 0.3s; ';
      html += 'user-select: none; }';
      html += '.floating-cart.show { display: flex; }';
      html += '.floating-cart.swiping { background: ' + dangerColor + '; }';

      html += '.sheet-overlay { position: fixed; top: 0; left: 0; ';
      html += 'width: 100%; height: 100%; ';
      html += 'background: rgba(0,0,0,0.5); display: none; ';
      html += 'z-index: 1000; }';
      html += '.sheet-overlay.open { display: block; }';
      html += '.bottom-sheet { position: fixed; bottom: -100%; ';
      html += 'left: 0; width: 100%; height: 85vh; background: #fafaf8; ';
      html += 'border-radius: 24px 24px 0 0; ';
      html += 'transition: bottom 0.3s ease; z-index: 1001; ';
      html += 'display: flex; flex-direction: column; }';
      html += '.bottom-sheet.open { bottom: 0; }';
      html += '.sheet-header { padding: 10px 15px; display: flex; ';
      html += 'justify-content: space-between; align-items: center; }';
      html += '.sheet-handle { width: 40px; height: 5px; ';
      html += 'background: #ccc; border-radius: 5px; margin: 0 auto; }';
      html += '.close-sheet { background: none; border: none; ';
      html += 'font-size: 24px; color: #888; cursor: pointer; ';
      html += 'padding: 0; line-height: 1; }';
      html += '.sheet-content { padding: 0 15px; overflow-y: auto; ';
      html += 'flex: 1; }';

      html += '.b-row { display: grid; ';
      html += 'grid-template-columns: 1fr 140px 30px; gap: 5px; ';
      html += 'align-items: center; margin-bottom: 8px; ';
      html += 'font-size: 14px; background: #fff; padding: 10px; ';
      html += 'border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); }';
      html += '.qty-btn { background: #F0F4F4; border: none; ';
      html += 'width: 44px; height: 44px; border-radius: 10px; ';
      html += 'font-weight: bold; font-size: 20px; color: ' + brandColor + '; ';
      html += 'display: flex; align-items: center; justify-content: center; }';
      html += '.qty-input { width: 46px; height: 44px; text-align: center; ';
      html += 'font-size: 18px; font-weight: bold; ';
      html += 'border: 1px solid #ddd; border-radius: 10px; ';
      html += 'padding: 0; }';

      html += '.pay-btn { padding: 12px; border: 1px solid #ddd; ';
      html += 'border-radius: 12px; background: #fff; cursor: pointer; ';
      html += 'flex: 1; text-align: center; font-weight: 600; }';
      html += '.pay-btn.active { background: #E0F2F1; ';
      html += 'border-color: ' + brandColor + '; ';
      html += 'color: ' + brandColor + '; }';
      html += '.pay-input-row { display: flex; gap: 5px; ';
      html += 'margin-top: 10px; }';
      
      html += '.pay-input-row input { font-size: 24px; ';
      html += 'font-weight: 800; text-align: right; flex: 1; ';
      html += 'padding: 10px; border: 1px solid #ddd; ';
      html += 'border-radius: 10px; box-sizing: border-box; ';
      html += 'width: 100%; background: #fff; }';
      
      html += '.pay-input-row button { background: ' + brandColor + '; ';
      html += 'color: #fff; border: none; border-radius: 10px; ';
      html += 'padding: 0 20px; font-size: 16px; font-weight: bold; ';
      html += 'white-space: nowrap; flex-shrink: 0; }';

      html += '.numpad { display: grid; ';
      html += 'grid-template-columns: 1fr 1fr 1fr; gap: 5px; ';
      html += 'margin-top: 5px; }';
      html += '.numpad button { padding: 12px; font-size: 18px; ';
      html += 'border: none; background: #fff; border-radius: 10px; ';
      html += 'font-family: inherit; font-weight: 600; color: ' + brandColor + '; ';
      html += 'box-shadow: 0 2px 4px rgba(0,0,0,0.05); }';

      html += '.btn-submit { width: 100%; padding: 14px; ';
      html += 'font-size: 16px; font-weight: 800; color: #fff; ';
      html += 'background: #ccc; border: none; border-radius: 14px; ';
      html += 'margin-top: 0; }';
      html += '.btn-submit.ready { background: ' + successColor + '; }';
      
      html += '.total-inp { font-size: 24px; font-weight: 800; ';
      html += 'width: 100%; border: none; background: #fff; ';
      html += 'padding: 15px; border-radius: 12px; ';
      html += 'box-sizing: border-box; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }';
      
      html += '.swipe-hint { text-align: center; font-size: 11px; color: #aaa; ';
      html += 'margin-top: -5px; margin-bottom: 15px; font-style: italic; }';

      html += '.sidebar { position: fixed; top: 0; right: -280px; ';
      html += 'width: 250px; height: 100%; background: #fff; ';
      html += 'box-shadow: -5px 0 15px rgba(0,0,0,0.1); ';
      html += 'transition: right 0.3s ease; z-index: 1000; ';
      html += 'padding: 20px; box-sizing: border-box; }';
      html += '.sidebar.open { right: 0; }';
      html += '.sidebar-overlay { position: fixed; top: 0; left: 0; ';
      html += 'width: 100%; height: 100%; ';
      html += 'background: rgba(0,0,0,0.4); display: none; ';
      html += 'z-index: 999; }';
      html += '.sidebar-overlay.open { display: block; }';
      html += '.menu-item { display: flex; align-items: center; ';
      html += 'padding: 15px 0; text-decoration: none; ';
      html += 'color: ' + brandColor + '; font-size: 16px; ';
      html += 'border-bottom: 1px solid #eee; }';
      html += '</style></head><body>';

      html += '<div class="header">';
      html += '<div class="header-left">';
      html += '<a href="/warehouse-app" class="back">←</a>';
      html += '<h2 style="margin:0; display:flex; align-items:center;">';
      html += getIconSvg('sale') + 'Касса</h2>';
      html += '</div>';
      html += '<button class="burger" ';
      html += 'onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<div class="search-wrapper">';
      html += '<input type="text" class="search" id="search" ';
      html += 'placeholder="🔍 Поиск..." onkeyup="filterItems()" ';
      html += 'autocomplete="off">';
      html += '<div class="search-results" ';
      html += 'id="searchResults"></div></div>';

      html += '<div class="h-scroll" id="catList">';
      html += '<button class="cat-btn active" id="cat-0" ';
      html += 'onclick="setCat(0)">Все</button>';
      html += '<button class="cat-btn bouquets-btn" ';
      html += 'id="cat-bouquets" onclick="toggleBouquetsMode()">';
      html += '🎁 Букеты</button>';
      html += '</div>';

      html += '<div class="grid" id="itemsGrid"></div>';

      html += '<div class="floating-cart" id="floatingCart">';
      html += '<span id="fcCount">0 товаров</span>';
      html += '<span id="fcTotal">0 ₽</span>';
      html += '</div>';

      html += '<div class="sheet-overlay" id="sheetOverlay" ';
      html += 'onclick="closeSheet()"></div>';
      html += '<div class="bottom-sheet" id="bottomSheet">';

      html += '<div class="sheet-header">';
      html += '<div class="sheet-handle"></div>';
      html += '<button class="close-sheet" ';
      html += 'onclick="closeSheet()">✕</button>';
      html += '</div>';

      html += '<div class="sheet-content">';
      
      html += '<div class="swipe-hint">← Смахните влево по корзине, чтобы очистить</div>';
      
      html += '<div id="bList" class="swipeable-cart"></div>';

      html += '<div style="margin-top:15px;">';
      html += '<label style="font-size:12px; font-weight:600; ';
      html += 'color:#666;">Сумма чека (можно менять)</label>';
      
      html += '<input type="text" id="totalPrice" class="total-inp" ';
      html += 'value="0" inputmode="none" readonly ';
      html += 'onclick="setActiveInput(\'totalPrice\')">';
      html += '</div>';

      html += '<div style="display:flex; gap:5px; margin-top:15px;">';
      html += '<div class="pay-btn active" id="btn-cash" ';
      html += 'onclick="setPay(\'cash\')">💵 Нал</div>';
      html += '<div class="pay-btn" id="btn-card" ';
      html += 'onclick="setPay(\'card\')">💳 Карта</div>';
      html += '<div class="pay-btn" id="btn-qr" ';
      html += 'onclick="setPay(\'qr\')">📱 QR</div>';
      html += '</div>';

      html += '<div style="margin-top:15px;" id="payArea">';
      html += '<div class="pay-input-row">';
      
      html += '<input type="text" id="payAmount" placeholder="Сумма" ';
      html += 'inputmode="none" readonly ';
      html += 'onclick="setActiveInput(\'payAmount\')">';
      
      html += '<button onclick="addPayment()">Внести</button>';
      html += '</div>';

      html += '<div class="numpad">';
      html += '<button onclick="num(\'1\')">1</button>';
      html += '<button onclick="num(\'2\')">2</button>';
      html += '<button onclick="num(\'3\')">3</button>';
      html += '<button onclick="num(\'4\')">4</button>';
      html += '<button onclick="num(\'5\')">5</button>';
      html += '<button onclick="num(\'6\')">6</button>';
      html += '<button onclick="num(\'7\')">7</button>';
      html += '<button onclick="num(\'8\')">8</button>';
      html += '<button onclick="num(\'9\')">9</button>';
      html += '<button onclick="num(\'C\')" ';
      html += 'style="color:red;">C</button>';
      html += '<button onclick="num(\'0\')">0</button>';
      html += '<button onclick="num(\'X\')">⌫</button>';
      html += '</div>';
      html += '</div>';

      html += '<div class="pay-list" id="payList" ';
      html += 'style="font-size:14px; margin-top:10px;"></div>';
      html += '<div style="text-align:center; margin-top:10px; ';
      html += 'font-size:16px; font-weight:800; padding-bottom: 10px;" ';
      html += 'id="remainTxt"></div>';
      html += '</div>';

      html += '<div style="padding: 10px 15px 20px 15px; ';
      html += 'background: #fafaf8; border-top: 1px solid #eee;">';
      html += '<button class="btn-submit" id="btnSubmit" ';
      html += 'style="margin-top:0;" ';
      html += 'onclick="openPrecheck()">Принять оплату</button>';
      html += '</div>';

      html += '</div>';

      // МОДАЛЬНОЕ ОКНО ПРЕ-ЧЕК (ПРАВКА 7 и 8)
      html += '<div class="sheet-overlay" id="precheckModal" ';
      html += 'style="z-index:2000; align-items:center; ';
      html += 'justify-content:center;">';
      html += '<div style="background:#fff; padding:20px; ';
      html += 'border-radius:24px; width:90%; max-width:400px; ';
      html += 'max-height:80vh; display:flex; flex-direction:column;">';
      html += '<h2 style="margin:0 0 15px 0; text-align:center;">Проверьте чек</h2>';
      html += '<div id="precheckList" style="overflow-y:auto; flex:1; ';
      html += 'margin-bottom:15px; border-top:1px solid #eee; ';
      html += 'border-bottom:1px solid #eee; padding:10px 0;">';
      html += '</div>';
      html += '<div style="display:flex; justify-content:space-between; ';
      html += 'font-weight:800; font-size:18px; margin-bottom:15px;">';
      html += '<span>Итого:</span><span id="precheckTotal">0 ₽</span>';
      html += '</div>';
      html += '<div style="display:flex; gap:10px;">';
      html += '<button onclick="closePrecheck()" style="flex:1; padding:15px; ';
      html += 'border:none; border-radius:12px; font-weight:800; font-size:16px; ';
      html += 'background:#eee; color:#333;">Вернуться</button>';
      html += '<button onclick="saveSale()" style="flex:2; padding:15px; ';
      html += 'border:none; border-radius:12px; font-weight:800; font-size:16px; ';
      html += 'background:' + successColor + '; color:#fff;">Подтвердить</button>';
      html += '</div>';
      html += '</div></div>';

      html += '<div class="sidebar-overlay" id="overlay" ';
      html += 'onclick="toggleMenu()"></div>';
      html += '<div class="sidebar" id="sidebar">';
      html += '<h3>Меню</h3>';
      html += '<a href="/warehouse/receipts" class="menu-item">';
      html += getIconSvg('receipt') + 'Приход</a>';
      html += '<a href="/warehouse/writeoff" class="menu-item">';
      html += getIconSvg('writeoff') + 'Списание</a>';
      html += '<a href="/warehouse/inventory" class="menu-item">';
      html += getIconSvg('inventory') + 'Обзор</a>';
      html += '<a href="/warehouse/history" class="menu-item">';
      html += getIconSvg('history') + 'История</a>';
      html += '<a href="/warehouse/documents" class="menu-item">';
      html += getIconSvg('docs') + 'Документы</a>';
      html += '<a href="/warehouse/reports" class="menu-item">';
      html += getIconSvg('reports') + 'Отчёты</a>';
      html += '<a href="/warehouse/audit" class="menu-item">';
      html += getIconSvg('audit') + 'Журнал</a>';
      html += '</div>';

      html += '<div class="sheet-overlay" id="successModal" ';
      html += 'style="z-index:2000; align-items:center; ';
      html += 'justify-content:center;">';
      html += '<div style="background:#fff; padding:30px; ';
      html += 'border-radius:24px; width:85%; max-width:350px; ';
      html += 'text-align:center;">';
      html += '<h1 style="color:' + successColor + '; font-size:24px; ';
      html += 'margin:0 0 10px 0;">🎉 Готово!</h1>';
      html += '<div style="font-size:16px; margin-bottom:10px;">';
      html += 'Продажа оформлена</div>';
      html += '<div id="changeBlock" style="display:none;">';
      html += '<div style="font-size:14px; color:#888; ';
      html += 'margin-top:15px;">СДАЧА:</div>';
      html += '<div style="font-size:36px; font-weight:800; color:';
      html += brandColor + ';" id="changeAmount">0</div>';
      html += '<div style="font-size:14px; color:#888; ';
      html += 'margin-top:15px;">Куда выдать?</div>';
      html += '<div style="display:flex; gap:5px; margin: 10px 0;">';
      html += '<div class="pay-btn active" id="cm-cash" ';
      html += 'onclick="setChangeMethod(\'cash\')">💵 Нал</div>';
      html += '<div class="pay-btn" id="cm-card" ';
      html += 'onclick="setChangeMethod(\'card\')">💳 Карта</div>';
      html += '<div class="pay-btn" id="cm-qr" ';
      html += 'onclick="setChangeMethod(\'qr\')">📱 QR</div>';
      html += '</div></div>';
      html += '<button onclick="closeSuccess()" style="width:100%; ';
      html += 'padding:15px; border:none; border-radius:12px; ';
      html += 'font-size:16px; font-weight:800; color:#fff; ';
      html += 'background:' + successColor + '; margin-top:15px;">';
      html += 'Готово</button>';
      html += '</div></div>';
      html += '<script>';
      html += 'var allItems = []; var cart = []; ';
      html += 'var payMethod = "cash"; var payments = []; ';
      html += 'var changeMethod = "cash"; var currentCat = 0;';
      html += 'var bouquetsMode = false; var bouquetsList = [];';
      html += 'var activeInputId = "payAmount";';
      
      // Правка 1: подсветка активного поля
      html += 'function setActiveInput(id) {';
      html += '  activeInputId = id;';
      html += '  var allInps = document.querySelectorAll(".total-inp, .qty-input, .pay-input-row input");';
      html += '  allInps.forEach(function(el) { el.classList.remove("input-active"); });';
      html += '  var el = document.getElementById(id);';
      html += '  if (el) el.classList.add("input-active");';
      html += '}';
      
      html += 'var svgPh = \'<svg viewBox="0 0 24 24" fill="#A0B4B4">';
      html += '<path d="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22';
      html += 'L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3';
      html += 'C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5';
      html += 'C2,15.5 3.5,17.5 6.5,17.5C7.21,17.5 7.87,17.36 ';
      html += '8.5,17.12C11.24,16.08 13.44,14.57 15,12.5';
      html += 'C15,12.5 15.5,14.5 15.5,16.5C15.5,18.5 14.5,20 ';
      html += '14.5,20C17,20 19.5,17.5 20.5,14.5C21.5,11.5 ';
      html += '21.5,8 21.5,8C21.5,8 19.5,6 17,8Z"/></svg>\';';

      html += 'function fmtNum(n) {';
      html += '  var num = parseFloat(n);';
      html += '  if (isNaN(num)) return "0";';
      html += '  return num % 1 === 0 ? num.toString() : ';
      html += 'num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");';
      html += '}';

      html += 'function saveCart() {';
      html += '  localStorage.setItem("wh_cart_kupidon", ';
      html += 'JSON.stringify(cart));';
      html += '}';
      html += 'function loadCart() {';
      html += '  var c = localStorage.getItem("wh_cart_kupidon");';
      html += '  if (c) { try { cart = JSON.parse(c); } ';
      html += '  catch(e) { cart = []; } }';
      html += '}';

      // ===== ЛОГИКА СВАЙПА ДЛЯ ОЧИСТКИ КОРЗИНЫ =====
      html += 'var startX = 0; var isSwiping = false;';
      html += 'var cartList = document.getElementById("bList");';
      
      html += 'cartList.addEventListener("touchstart", function(e) {';
      html += '  startX = e.touches[0].clientX; isSwiping = true;';
      html += '  cartList.style.transition = "none";';
      html += '});';
      
      html += 'cartList.addEventListener("touchmove", function(e) {';
      html += '  if (!isSwiping) return;';
      html += '  var diff = e.touches[0].clientX - startX;';
      html += '  if (diff < 0) {';
      html += '    if (diff < -150) diff = -150;';
      html += '    cartList.style.transform = "translateX(" + diff + "px)";';
      html += '    cartList.style.background = "rgba(217, 83, 79, " + (Math.abs(diff)/150) + ")";';
      html += '    cartList.style.borderRadius = "12px";';
      html += '  }';
      html += '});';
      
      html += 'cartList.addEventListener("touchend", function(e) {';
      html += '  if (!isSwiping) return; isSwiping = false;';
      html += '  var diff = e.changedTouches[0].clientX - startX;';
      html += '  cartList.style.transition = "transform 0.3s, background 0.3s";';
      html += '  if (diff < -100) {';
      html += '    cartList.style.transform = "translateX(-100%)";';
      html += '    setTimeout(function() { clearCartDirect(); cartList.style.transform = "translateX(0)"; cartList.style.background = "transparent"; }, 300);';
      html += '  } else {';
      html += '    cartList.style.transform = "translateX(0)";';
      html += '    cartList.style.background = "transparent";';
      html += '  }';
      html += '});';

      // ЛОГИКА СВАЙПА ПЛАВАЮЩЕЙ КОРЗИНЫ
      html += 'var fc = document.getElementById("floatingCart");';
      html += 'fc.addEventListener("touchstart", function(e) { startX = e.touches[0].clientX; });';
      html += 'fc.addEventListener("touchend", function(e) {';
      html += '  var diff = e.changedTouches[0].clientX - startX;';
      html += '  if (diff > -30 && diff < 30) { openSheet(); }';
      html += '});';

      html += 'function clearCartDirect() {';
      html += '  cart = []; payments = [];';
      html += '  localStorage.removeItem("wh_cart_kupidon");';
      html += '  renderBasket();';
      html += '}';

      html += 'loadCart();';
      html += 'fetch("/api/warehouse/categories")';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) {';
      html += '  if (d.ok) {';
      html += '    var cl = document.getElementById("catList");';
      html += '    var bouqBtn = document.getElementById("cat-bouquets");';
      html += '    d.categories.forEach(function(c) {';
      html += '      var b = document.createElement("button");';
      html += '      b.className = "cat-btn"; b.id = "cat-" + c.id;';
      html += '      b.innerText = c.name;';
      html += '      b.onclick = function() { setCat(c.id); };';
      html += '      cl.insertBefore(b, bouqBtn);';
      html += '    });';
      html += '  }';
      html += '}).catch(function() {});';

      html += 'fetch("/api/warehouse/items?shop=kupidon&t=" + Date.now())';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) { allItems = d.items; render(); })';
      html += '.catch(function() {});';

      html += 'function toggleBouquetsMode() {';
      html += '  bouquetsMode = !bouquetsMode;';
      html += '  var bqBtn = document.getElementById("cat-bouquets");';
      html += '  var allBtns = document.querySelectorAll(".cat-btn");';
      html += '  if (bouquetsMode) {';
      html += '    allBtns.forEach(function(el) { el.classList.remove("active"); });';
      html += '    bqBtn.classList.add("active"); currentCat = -1;';
      html += '    document.getElementById("search").value = ""; loadBouquets();';
      html += '  } else {';
      html += '    bqBtn.classList.remove("active"); currentCat = 0;';
      html += '    document.getElementById("cat-0").classList.add("active"); filterItems();';
      html += '  }';
      html += '}';

      html += 'function loadBouquets() {';
      html += '  var g = document.getElementById("itemsGrid");';
      html += '  g.innerHTML = "<div style=\'grid-column:1/-1; text-align:center; padding:20px; color:#888;\'>Загрузка...</div>";';
      html += '  fetch("/api/warehouse/bouquets?shop=kupidon")';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { g.innerHTML = "<div style=\'grid-column:1/-1; text-align:center; padding:20px; color:#e74c3c;\'>Ошибка загрузки</div>"; return; }';
      html += '    bouquetsList = d.bouquets; renderBouquets(bouquetsList);';
      html += '  }).catch(function() {});';
      html += '}';

      html += 'function renderBouquets(list) {';
      html += '  var g = document.getElementById("itemsGrid"); g.innerHTML = "";';
      html += '  if (list.length === 0) {';
      html += '    g.innerHTML = "<div style=\'grid-column:1/-1; text-align:center; padding:20px; color:#888;\'>Нет связанных букетов</div>"; return;';
      html += '  }';
      html += '  list.forEach(function(b) {';
      html += '    var d = document.createElement("div"); d.className = "card bouquet";';
      html += '    var img = b.photo_url ? \'<img src="\' + b.photo_url + \'">\' : \'<div class="ph">\' + svgPh + \'</div>\';';
      html += '    var ok = b.all_in_stock !== false;';
      html += '    d.innerHTML = img;';
      html += '    var nm = document.createElement("div"); nm.className = "name"; nm.textContent = b.name; d.appendChild(nm);';
      html += '    var tag = document.createElement("div"); tag.className = "bouquet-tag";';
      html += '    tag.textContent = ok ? "✓ в наличии" : "⚠ нет ингредиентов";';
      html += '    if (!ok) tag.style.color = "#e74c3c";';
      html += '    d.appendChild(tag);';
      html += '    d.onclick = function() { addBouquetToCart(b); };';
      html += '    g.appendChild(d);';
      html += '  });';
      html += '}';

      html += 'function addBouquetToCart(b) {';
      html += '  fetch("/api/warehouse/bouquet/expand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bouquet_id: b.id }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { showAlert("Ошибка", d.error || "Не удалось", false); return; }';
      html += '    var items = d.ingredients || [];';
      html += '    items.forEach(function(it) {';
      html += '      var ex = cart.find(function(c) { return c.id === it.shop_item_id; });';
      html += '      if (ex) { ex.qty += it.qty; }';
      html += '      else { cart.push({ id: it.shop_item_id, name: it.name, qty: it.qty, retail: it.retail_price || 0 }); }';
      html += '    });';
      html += '    resetPayments(); openSheet();';
      html += '  }).catch(function() { showAlert("Ошибка сети", "Повторите", false); });';
      html += '}';

      html += 'function setCat(id) {';
      html += '  bouquetsMode = false; document.getElementById("cat-bouquets").classList.remove("active");';
      html += '  currentCat = id;';
      html += '  var els = document.querySelectorAll(".cat-btn"); els.forEach(function(el) { el.classList.remove("active"); });';
      html += '  document.getElementById("cat-" + id).classList.add("active");';
      html += '  filterItems();';
      html += '}';

      html += 'function render() { filterItems(); renderBasket(); }';

      html += 'function filterItems() {';
      html += '  if (bouquetsMode) { renderBouquets(bouquetsList); return; }';
      html += '  var q = document.getElementById("search").value.toLowerCase();';
      html += '  var items = allItems.filter(function(i) {';
      html += '    var matchQ = i.name.toLowerCase().includes(q);';
      html += '    var matchC = (currentCat === 0 || i.category_id === currentCat);';
      html += '    return matchQ && matchC; });';
      html += '  drawCards(items);';
      html += '}';

      html += 'function drawCards(items) {';
      html += '  var g = document.getElementById("itemsGrid"); g.innerHTML = "";';
      html += '  items.forEach(function(item) {';
      html += '    var d = document.createElement("div");';
      html += '    d.className = item.is_pinned ? "card pinned" : "card";';
      
      html += '    if (item.is_pinned) {';
      html += '      var pin = document.createElement("div"); pin.className = "pin-badge"; pin.textContent = "🔥"; d.appendChild(pin);';
      html += '    }';

      html += '    var img = item.photo_url ? \'<img src="\' + item.photo_url + \'">\' : \'<div class="ph">\' + svgPh + \'</div>\';';
      html += '    d.innerHTML += img;';
      html += '    var nm = document.createElement("div"); nm.className = "name"; nm.textContent = item.name; d.appendChild(nm);';
      html += '    var st = document.createElement("div"); st.className = "stock";';
      html += '    st.textContent = "Ост: " + fmtNum(item.current_stock) + " " + (item.unit || "шт");';
      html += '    d.appendChild(st);';
      
      html += '    d.onclick = function() { addToCart(item); };';

      html += '    var pressTimer;';
      html += '    d.addEventListener("touchstart", function() {';
      html += '      pressTimer = setTimeout(function() { togglePin(item); }, 600);';
      html += '    });';
      html += '    d.addEventListener("touchend", function() { clearTimeout(pressTimer); });';
      html += '    d.addEventListener("touchmove", function() { clearTimeout(pressTimer); });';

      html += '    g.appendChild(d);';
      html += '  });';
      html += '}';

      html += 'function togglePin(item) {';
      html += '  var newVal = !item.is_pinned;';
      html += '  fetch("/api/warehouse/item/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, val: newVal }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) {';
      html += '      item.is_pinned = newVal;';
      html += '      showAlert("Готово", newVal ? "Закреплено 🔥" : "Откреплено", true);';
      html += '      allItems.sort(function(a,b){ if(a.is_pinned && !b.is_pinned) return -1; if(!a.is_pinned && b.is_pinned) return 1; return 0; });';
      html += '      filterItems();';
      html += '    }';
      html += '  }).catch(function(){});';
      html += '}';

      html += 'function addToCart(item) {';
      html += '  var ex = cart.find(function(c) { return c.id === item.id; });';
      html += '  if (ex) ex.qty += 1; ';
      html += '  else cart.push({ id: item.id, name: item.name, qty: 1, retail: item.retail_price || 0 });';
      html += '  resetPayments();';
      html += '}';

      html += 'function resetPayments() { payments = []; saveCart(); renderBasket(); }';

      html += 'function openSheet() {';
      html += '  document.getElementById("sheetOverlay").classList.add("open");';
      html += '  document.getElementById("bottomSheet").classList.add("open");';
      html += '}';
      html += 'function closeSheet() {';
      html += '  document.getElementById("sheetOverlay").classList.remove("open");';
      html += '  document.getElementById("bottomSheet").classList.remove("open");';
      html += '}';

      html += 'function renderBasket() {';
      html += '  var b = document.getElementById("bList");';
      html += '  var fc = document.getElementById("floatingCart");';
      html += '  if (cart.length === 0) { fc.classList.remove("show"); b.innerHTML = ""; return; }';
      html += '  fc.classList.add("show"); b.innerHTML = ""; var total = 0; var count = 0;';
      html += '  cart.forEach(function(item, idx) {';
      html += '    total += (item.retail * item.qty); count += item.qty;';
      html += '    var div = document.createElement("div"); div.className = "b-row";';
      html += '    var name = document.createElement("div"); name.textContent = item.name;';
      html += '    var ctrl = document.createElement("div"); ctrl.style = "display:flex; justify-content:space-between; align-items:center; gap:4px;";';
      
      html += '    var mn = document.createElement("button"); mn.innerText = "-"; mn.className = "qty-btn";';
      html += '    mn.onclick = function() { changeQty(idx, -1); };';
      
      html += '    var vl = document.createElement("input"); vl.type = "number"; vl.className = "qty-input"; vl.value = item.qty;';
      html += '    vl.readOnly = true; vl.id = "qty_" + idx;';
      html += '    vl.onclick = function() { setActiveInput(this.id); };';
      
      html += '    var pl = document.createElement("button"); pl.innerText = "+"; pl.className = "qty-btn";';
      html += '    pl.onclick = function() { changeQty(idx, 1); };';
      
      html += '    ctrl.appendChild(mn); ctrl.appendChild(vl); ctrl.appendChild(pl);';
      html += '    var del = document.createElement("span"); del.innerText = "✕";';
      html += '    del.style = "color:red; cursor:pointer; font-size:20px; text-align:center;";';
      html += '    del.onclick = function() { cart.splice(idx, 1); resetPayments(); };';
      html += '    div.appendChild(name); div.appendChild(ctrl); div.appendChild(del);';
      html += '    b.appendChild(div);';
      html += '  });';
      html += '  document.getElementById("totalPrice").value = total;';
      
      // Правка 9: Убрано авто-заполнение поля оплаты
      html += '  document.getElementById("fcCount").innerText = count + " товар(ов)";';
      html += '  document.getElementById("fcTotal").innerText = total + " ₽";';
      html += '  renderPayments();';
      html += '}';

      html += 'function changeQty(idx, delta) {';
      html += '  cart[idx].qty += delta;';
      html += '  if (cart[idx].qty <= 0) cart.splice(idx, 1);';
      html += '  resetPayments();';
      html += '}';

      html += 'function setPay(method) {';
      html += '  payMethod = method;';
      html += '  var els = document.querySelectorAll(".pay-btn"); els.forEach(function(b) { b.classList.remove("active"); });';
      html += '  document.getElementById("btn-" + method).classList.add("active");';
      html += '}';

      // Правка 5: Пересчет суммы при вводе с Numpad
      html += 'function num(v) {';
      html += '  var inp = document.getElementById(activeInputId);';
      html += '  if (!inp) return;';
      html += '  if (v === "C") inp.value = "";';
      html += '  else if (v === "X") inp.value = inp.value.slice(0, -1);';
      html += '  else inp.value += v;';
      html += '  if (activeInputId === "payAmount") renderPayments();';
      html += '  if (activeInputId === "totalPrice") onManualPriceChange();';
      html += '  if (activeInputId.startsWith("qty_")) {';
      html += '    var idx = parseInt(activeInputId.replace("qty_", ""));';
      html += '    var newQty = parseFloat(inp.value) || 0;';
      html += '    if (newQty > 0) { cart[idx].qty = newQty; saveCart(); }';
      html += '    renderBasket();'; // Пересчет суммы чека
      html += '  }';
      html += '}';

      html += 'function addPayment() {';
      html += '  var val = parseFloat(document.getElementById("payAmount").value);';
      html += '  if (!val || val <= 0) { showAlert("Внимание", "Введите сумму", false); return; }';
      html += '  payments.push({ method: payMethod, amount: val });';
      html += '  document.getElementById("payAmount").value = "";';
      html += '  renderPayments();';
      html += '}';

      html += 'function onManualPriceChange() {';
      html += '  renderPayments();';
      html += '}';

      html += 'function renderPayments() {';
      html += '  var total = parseFloat(document.getElementById("totalPrice").value) || 0;';
      html += '  var paid = 0; var pl = document.getElementById("payList"); pl.innerHTML = "";';
      
      html += '  payments.forEach(function(p, i) {';
      html += '    paid += p.amount;';
      html += '    var mn = p.method === "cash" ? "Нал" : (p.method === "card" ? "Карта" : "QR");';
      html += '    var row = document.createElement("div");';
      html += '    row.style = "display:flex; justify-content:space-between; align-items:center; color:' + successColor + '; font-weight:bold; margin-bottom:5px;";';
      html += '    var txt = document.createElement("span"); txt.textContent = mn + " " + p.amount + " ₽";';
      
      // Правка 6: Отмена ошибочной оплаты
      html += '    var delBtn = document.createElement("span"); delBtn.textContent = " ✕";';
      html += '    delBtn.style = "color:red; cursor:pointer; font-size:16px; margin-left:10px;";';
      html += '    delBtn.onclick = function() { payments.splice(i, 1); renderPayments(); };';
      
      html += '    row.appendChild(txt); row.appendChild(delBtn); pl.appendChild(row);';
      html += '  });';
      
      html += '  var typed = parseFloat(document.getElementById("payAmount").value) || 0;';
      html += '  var remain = total - (paid + typed);';
      html += '  var rTxt = document.getElementById("remainTxt"); var btn = document.getElementById("btnSubmit");';
      html += '  if (total <= 0) { rTxt.innerText = "Укажите сумму чека"; rTxt.style.color = "' + dangerColor + '"; btn.classList.remove("ready"); return; }';
      html += '  if (remain > 0) { rTxt.innerText = "Осталось внести: " + remain + " ₽"; rTxt.style.color = "' + dangerColor + '"; btn.classList.remove("ready"); }';
      html += '  else if (remain < 0) { rTxt.innerText = "Сдача: " + Math.abs(remain) + " ₽"; rTxt.style.color = "#3C7A89"; btn.classList.add("ready"); }';
      html += '  else { rTxt.innerText = "Оплачено полностью"; rTxt.style.color = "' + successColor + '"; btn.classList.add("ready"); }';
      html += '}';

      html += 'function setChangeMethod(m) { changeMethod = m; var els = document.querySelectorAll(".pay-btn"); els.forEach(function(el) { el.classList.remove("active"); }); document.getElementById("cm-" + m).classList.add("active"); }';

      // Правка 7: Пре-чек
      html += 'function openPrecheck() {';
      html += '  var btn = document.getElementById("btnSubmit");';
      html += '  if (!btn.classList.contains("ready")) { showAlert("Внимание", "Оплата не завершена", false); return; }';
      
      html += '  var total = parseFloat(document.getElementById("totalPrice").value);';
      html += '  var typed = parseFloat(document.getElementById("payAmount").value) || 0;';
      html += '  if (typed > 0) { payments.push({ method: payMethod, amount: typed }); document.getElementById("payAmount").value = ""; renderPayments(); }';
      
      html += '  var list = document.getElementById("precheckList"); list.innerHTML = "";';
      html += '  cart.forEach(function(item) {';
      html += '    var row = document.createElement("div");';
      html += '    row.style = "display:flex; justify-content:space-between; margin-bottom:5px; font-size:14px;";';
      html += '    row.innerHTML = "<span>" + item.name + " x" + item.qty + "</span><span>" + (item.retail * item.qty) + " ₽</span>";';
      html += '    list.appendChild(row);';
      html += '  });';
      html += '  document.getElementById("precheckTotal").innerText = total + " ₽";';
      html += '  document.getElementById("precheckModal").style.display = "flex";';
      html += '}';
      
      html += 'function closePrecheck() { document.getElementById("precheckModal").style.display = "none"; }';

      // Сохранение (вызывается после Пре-чека)
      html += 'function saveSale() {';
      html += '  var btn = document.getElementById("btnSubmit");';
      html += '  btn.disabled = true; btn.innerText = "Отправка...";';
      html += '  var total = parseFloat(document.getElementById("totalPrice").value);';
      
      html += '  var paid = 0; payments.forEach(function(p) { paid += p.amount; });';
      html += '  var change = paid - total; var finalPayments = JSON.parse(JSON.stringify(payments));';
      
      html += '  if (change > 0) {';
      html += '    var found = false;';
      html += '    for (var i = 0; i < finalPayments.length; i++) {';
      html += '      if (finalPayments[i].method === changeMethod) {';
      html += '        if (finalPayments[i].amount >= change) { finalPayments[i].amount -= change; found = true; break; }';
      html += '        else { btn.disabled = false; btn.innerText = "Принять оплату"; showAlert("Ошибка", "Недостаточно средств для сдачи", false); return; }';
      html += '      }';
      html += '    }';
      html += '    if (!found) { btn.disabled = false; btn.innerText = "Принять оплату"; showAlert("Ошибка", "Вы не вносили оплату этим способом", false); return; }';
      html += '  }';
      
      html += '  var payload = { shopId: "kupidon", real_price: total, payments: finalPayments, items: cart };';
      html += '  fetch("/api/warehouse/sale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) {';
      html += '      localStorage.removeItem("wh_cart_kupidon");';
      html += '      var cBlock = document.getElementById("changeBlock");';
      html += '      if (change > 0) { document.getElementById("changeAmount").innerText = change + " ₽"; cBlock.style.display = "block"; }';
      html += '      else { cBlock.style.display = "none"; }';
      html += '      document.getElementById("precheckModal").style.display = "none";';
      html += '      document.getElementById("successModal").style.display = "flex";';
      html += '    } else { btn.disabled = false; btn.innerText = "Принять оплату"; showAlert("Ошибка", d.error || "unknown", false); }';
      html += '  }).catch(function(err) { btn.disabled = false; btn.innerText = "Принять оплату"; showAlert("Ошибка сети", "Повторите", false); });';
      html += '}';

      html += 'function closeSuccess() { window.location.reload(); }';
      html += 'function toggleMenu() { document.getElementById("sidebar").classList.toggle("open"); document.getElementById("overlay").classList.toggle("open"); }';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) {
      console.error('Sale page error:', e?.message || e);
      res.status(500).send('Ошибка сервера');
    }
  });
  // ====== 18. API ПРОДАЖИ ======
  app.post('/api/warehouse/sale', async (req, res) => {
    const client = await pool.connect();
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      if (!chatId) {
        client.release();
        return res.status(401).json({ ok: false });
      }

      const real_price = parseFloat(req.body.real_price);
      if (!real_price || real_price <= 0) {
        client.release();
        return res.json({ ok: false, error: 'Сумма > 0' });
      }

      const items = req.body.items;
      if (!Array.isArray(items) || items.length === 0) {
        client.release();
        return res.json({ ok: false, error: 'Корзина пуста' });
      }

      const payments = Array.isArray(req.body.payments) ? 
        req.body.payments : [];
      let payCash = 0, payCard = 0, payQr = 0;
      
      payments.forEach(function(p) {
        if (p.method === 'cash') payCash += p.amount;
        if (p.method === 'card') payCard += p.amount;
        if (p.method === 'qr') payQr += p.amount;
      });

      await client.query('BEGIN');

      const saleRes = await client.query(
        'INSERT INTO wh_sales (shop_id, real_price, chat_id, ' +
        'pay_cash, pay_card, pay_qr) ' +
        'VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [req.body.shopId, real_price, chatId, 
         payCash, payCard, payQr]
      );
      const saleId = saleRes.rows[0].id;
      let itemsStr = '';

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        await client.query(
          'UPDATE wh_shop_items SET current_stock = ' +
          'current_stock - $1 WHERE id = $2',
          [item.qty, item.id]
        );

        const costQ = await client.query(
          'SELECT avg_cost FROM wh_shop_items WHERE id = $1',
          [item.id]
        );
        var costVal = 0;
        if (costQ.rows.length > 0 && costQ.rows[0].avg_cost) {
          costVal = costQ.rows[0].avg_cost;
        }

        await client.query(
          'INSERT INTO wh_sale_items (sale_id, shop_item_id, ' +
          'qty, cost_at_sale) VALUES ($1, $2, $3, $4)',
          [saleId, item.id, item.qty, costVal]
        );
        itemsStr += item.name + ' x' + item.qty + ', ';
      }
      
      if (itemsStr.length > 2) {
        itemsStr = itemsStr.slice(0, -2);
      }

      await client.query('COMMIT');
      client.release();

      await logAction(req.body.shopId, chatId, 'sale',
        'Продажа на ' + real_price + ' ₽. Товары: ' + itemsStr,
        saleId);

      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      console.error('Sale error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 19. API БУКЕТОВ ДЛЯ КАССЫ ======
  app.get('/api/warehouse/bouquets', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const r = await pool.query(
        'SELECT b.id, b.name, b.price, b.photos, ' +
        'EXISTS (' +
        '  SELECT 1 FROM wh_bouquet_recipes r ' +
        '  JOIN wh_shop_items i ON i.id = r.shop_item_id ' +
        '  WHERE r.bouquet_id = b.id AND i.current_stock < r.qty' +
        ') AS missing_ingredients ' +
        'FROM bouquets b ' +
        'WHERE b.shop_id = $1 AND b.wh_linked = TRUE ' +
        'AND b.deleted = FALSE AND b.hidden = FALSE ' +
        'ORDER BY b.name ASC',
        [shopId]
      );

      const result = r.rows.map(function(b) {
        let photoUrl = null;
        if (b.photos && b.photos.length > 0) {
          const p = b.photos[0];
          if (typeof p === 'string') photoUrl = p;
          else if (p.s3) photoUrl = p.s3;
          else if (p.s3b) photoUrl = p.s3b;
        }
        return {
          id: b.id,
          name: b.name,
          price: b.price,
          photo_url: photoUrl,
          all_in_stock: !b.missing_ingredients
        };
      });

      res.json({ ok: true, bouquets: result });
    } catch (e) {
      console.error('API bouquets:', e.message);
      res.status(500).json({ ok: false });
    }
  });

  // ====== 20. API РАСКРЫТИЯ БУКЕТА ======
  app.post('/api/warehouse/bouquet/expand', async (req, res) => {
    try {
      const bouquetId = parseInt(req.body.bouquet_id);
      if (!bouquetId || isNaN(bouquetId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }

      const checkB = await pool.query(
        'SELECT wh_linked FROM bouquets WHERE id = $1',
        [bouquetId]
      );
      if (checkB.rows.length === 0 || !checkB.rows[0].wh_linked) {
        return res.json({ ok: false, error: 'Не связан со складом' });
      }

      const r = await pool.query(
        'SELECT r.shop_item_id, r.qty, i.current_stock, ' +
        'i.retail_price, COALESCE(i.custom_name, w.name) AS name ' +
        'FROM wh_bouquet_recipes r ' +
        'JOIN wh_shop_items i ON i.id = r.shop_item_id ' +
        'JOIN wh_items w ON w.id = i.item_id ' +
        'WHERE r.bouquet_id = $1',
        [bouquetId]
      );

      if (r.rows.length === 0) {
        return res.json({ ok: false, error: 'Рецепт пуст' });
      }

      let missing = [];
      r.rows.forEach(function(it) {
        if (parseFloat(it.current_stock) < parseFloat(it.qty)) {
          missing.push(it.name);
        }
      });

      res.json({
        ok: true,
        ingredients: r.rows,
        missing: missing
      });
    } catch (e) {
      console.error('Expand error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 21. ЭКРАН СПИСКА НАКЛАДНЫХ ======
  app.get('/warehouse/receipts', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, ';
    html += 'user-scalable=no">';
    html += fontLink;
    html += uiScript;
    html += '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.btn-new { display: block; width: 100%; padding: 15px; ';
    html += 'background: ' + brandColor + '; color: #fff; ';
    html += 'text-align: center; text-decoration: none; ';
    html += 'border-radius: 12px; font-size: 16px; font-weight: 800; ';
    html += 'margin-bottom: 15px; box-sizing: border-box; }';
    html += '.doc { background: #fff; border-radius: 12px; ';
    html += 'padding: 15px; margin-bottom: 10px; ';
    html += 'text-decoration: none; color: ' + brandColor + '; ';
    html += 'display: flex; justify-content: space-between; ';
    html += 'align-items: center; ';
    html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
    html += '.doc.completed { border-left: 4px solid ';
    html += successColor + '; }';
    html += '.doc.draft { border-left: 4px solid #E67E22; }';
    html += '.meta { font-size: 12px; color: #888; margin-top: 4px; }';
    html += '.amount { font-weight: 800; font-size: 16px; }';
    html += '.del-btn { font-size: 20px; color: ' + dangerColor + '; ';
    html += 'margin-left: 10px; cursor: pointer; }';
    html += '</style></head><body>';

    html += '<div class="header"><a href="/warehouse-app" ';
    html += 'class="back">←</a><h2 style="margin:0; display:flex; ';
    html += 'align-items:center;">';
    html += getIconSvg('receipt') + 'Приходы</h2></div>';
    html += '<a href="/warehouse/receipt/new" class="btn-new">';
    html += '+ Создать накладную</a>';
    html += '<div id="list">Загрузка...</div>';

    html += '<script>';
    html += 'fetch("/api/warehouse/receipts?shop=kupidon")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) {';
    html += '  var b = document.getElementById("list");';
    html += '  b.innerHTML = "";';
    html += '  if (!d.ok || d.docs.length === 0) {';
    html += '    b.textContent = "Накладных нет"; return; }';
    
    html += '  d.docs.forEach(function(doc) {';
    html += '    var a = document.createElement("a");';
    html += '    var st = doc.status === "draft" ? "draft" : ';
    html += '"completed";';
    html += '    a.className = "doc " + st;';
    html += '    if (st === "draft") {';
    html += '      a.href = "/warehouse/receipt/edit?id=" + doc.id;';
    html += '    } else {';
    html += '      a.href = "/warehouse/documents/details?id=" + ';
    html += 'doc.id + "&type=receipts";';
    html += '    }';
    
    html += '    var ds = new Date(doc.date).toLocaleString("ru-RU");';
    html += '    var author = doc.author || "Флорист";';
    html += '    var statusTxt = st === "draft" ? ';
    html += '"⚠️ Черновик" : "Накладная";';
    
    html += '    var div = document.createElement("div");';
    html += '    var bTitle = document.createElement("b");';
    html += '    bTitle.textContent = statusTxt + " №" + doc.id;';
    html += '    div.appendChild(bTitle);';
    
    html += '    var meta = document.createElement("div");';
    html += '    meta.className = "meta";';
    html += '    meta.textContent = ds + " · " + author;';
    html += '    div.appendChild(meta);';
    
    html += '    var amt = document.createElement("div");';
    html += '    amt.className = "amount";';
    html += '    amt.textContent = parseFloat(doc.total_sum)';
    html += '.toLocaleString("ru-RU") + " ₽";';
    html += '    div.appendChild(amt);';
    
    html += '    a.appendChild(div);';
    
    html += '    if (st === "draft") {';
    html += '      var del = document.createElement("span");';
    html += '      del.innerText = "🗑";';
    html += '      del.className = "del-btn";';
    html += '      del.onclick = function(e) {';
    html += '        e.preventDefault();';
    html += '        e.stopPropagation();';
    html += '        deleteDraft(doc.id);';
    html += '      };';
    html += '      a.appendChild(del);';
    html += '    }';
    html += '    b.appendChild(a);';
    html += '  });';
    html += '}).catch(function() {';
    html += '  document.getElementById("list").textContent = ';
    html += '"Ошибка загрузки";';
    html += '});';

    html += 'function deleteDraft(id) {';
    html += '  showConfirm("Удаление", ';
    html += '"Удалить черновик №" + id + "?", function() {';
    html += '    fetch("/api/warehouse/receipt/delete", { ';
    html += '    method: "POST", ';
    html += '    headers: { "Content-Type": "application/json" }, ';
    html += '    body: JSON.stringify({ id: id }) })';
    html += '    .then(function(r) { return r.json(); })';
    html += '    .then(function(d) { if(d.ok) { location.reload(); } ';
    html += '    else showAlert("Ошибка", d.error, false); })';
    html += '    .catch(function() {';
    html += '      showAlert("Ошибка сети", "Повторите", false); });';
    html += '  }, true);';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 22. API СПИСКА НАКЛАДНЫХ ======
  app.get('/api/warehouse/receipts', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT r.id, r.date, r.total_sum, r.status, ' +
        'a.name as author ' +
        'FROM wh_receipts r ' +
        'LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
        'WHERE r.shop_id = $1 ' +
        'ORDER BY r.date DESC LIMIT 30',
        [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, docs: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 23. API УДАЛЕНИЯ ЧЕРНОВИКА ======
  app.post('/api/warehouse/receipt/delete', async (req, res) => {
    try {
      const receiptId = parseInt(req.body.id);
      if (!receiptId || isNaN(receiptId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      const r = await pool.query(
        'SELECT status FROM wh_receipts WHERE id = $1',
        [receiptId]
      );
      if (r.rows.length === 0) {
        return res.json({ ok: false, error: 'Не найдено' });
      }
      if (r.rows[0].status !== 'draft') {
        return res.json({ ok: false, error: 'Только черновики' });
      }

      await pool.query(
        'DELETE FROM wh_receipt_items WHERE receipt_id = $1',
        [receiptId]
      );
      await pool.query(
        'DELETE FROM wh_receipts WHERE id = $1',
        [receiptId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ====== 24. СОЗДАНИЕ ЧЕРНОВИКА ======
  app.get('/warehouse/receipt/new', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      
      const r = await pool.query(
        'INSERT INTO wh_receipts (shop_id, chat_id, status) ' +
        'VALUES ($1, $2, \'draft\') RETURNING id',
        ['kupidon', chatId]
      );
      res.redirect('/warehouse/receipt/edit?id=' + r.rows[0].id);
    } catch (e) { res.status(500).send('Ошибка создания'); }
  });
  // ====== 25. ЭКРАН РЕДАКТИРОВАНИЯ ЧЕРНОВИКА ======
  app.get('/warehouse/receipt/edit', (req, res) => {
    const rawId = req.query.id;
    const receiptId = parseInt(rawId);
    if (!receiptId || isNaN(receiptId)) {
      return res.status(400).send('Неверный ID накладной');
    }

    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, ';
    html += 'user-scalable=no">';
    html += fontLink;
    html += uiScript;
    html += '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 20px; ';
    html += 'padding: 20px; margin-bottom: 15px; ';
    html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
    html += 'label { display: block; font-size: 13px; color: #666; ';
    html += 'margin-bottom: 5px; font-weight: 600; }';
    html += 'input, select { width: 100%; padding: 15px; ';
    html += 'border: 1px solid #eee; border-radius: 12px; ';
    html += 'margin-bottom: 15px; box-sizing: border-box; ';
    html += 'font-family: inherit; font-size: 16px; }';
    html += '.input-cap { text-transform: capitalize; }';
    html += '.btn-add { width: 100%; background: ' + brandColor + '; ';
    html += 'color: #fff; border: none; padding: 16px; ';
    html += 'border-radius: 12px; font-size: 16px; font-weight: 800; ';
    html += 'margin-bottom: 15px; }';
    html += '.basket { background: #fff; border-radius: 12px; ';
    html += 'padding: 15px; margin-bottom: 15px; ';
    html += 'border: 2px solid ' + brandColor + '; display: none; }';
    html += '.b-row { display: flex; justify-content: space-between; ';
    html += 'margin-bottom: 8px; border-bottom: 1px solid #eee; ';
    html += 'padding-bottom: 8px; font-size: 14px; }';
    html += '.btn-save { width: 100%; background: ' + successColor + '; ';
    html += 'color: #fff; border: none; padding: 16px; ';
    html += 'border-radius: 12px; font-size: 16px; font-weight: 800; }';
    html += '.hint-cost { font-size: 12px; margin-top: -10px; ';
    html += 'margin-bottom: 10px; font-weight: 600; }';
    html += '.img-preview { width: 60px; height: 60px; ';
    html += 'border-radius: 8px; object-fit: cover; display: none; ';
    html += 'margin-bottom: 10px; }';
    html += '</style></head><body>';

    html += '<div class="header">';
    html += '<a href="/warehouse/receipts" class="back">←</a>';
    html += '<h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('receipt') + 'Накладная</h2></div>';

    html += '<div class="card">';
    html += '<label>Название товара</label>';
    html += '<input type="text" id="itemName" class="input-cap" ';
    html += 'list="itemsList" oninput="onNameInput()" ';
    html += 'placeholder="Начните вводить...">';
    html += '<datalist id="itemsList"></datalist>';

    html += '<label>Категория (для нового)</label>';
    html += '<select id="itemCategory" onchange="checkCat()"></select>';

    html += '<div id="unitBlock" style="display:none;">';
    html += '<label>Единица измерения</label>';
    html += '<select id="itemUnit">';
    html += '<option value="м">Метры (м)</option>';
    html += '<option value="уп">Упаковки (уп)</option>';
    html += '<option value="шт">Штуки (шт)</option>';
    html += '</select></div>';

    html += '<label>Фото товара (для нового)</label>';
    html += '<input type="file" id="itemPhoto" accept="image/*" ';
    html += 'onchange="previewPhoto()" style="margin-bottom:5px;">';
    html += '<img id="photoPreview" class="img-preview">';

    html += '<label>Количество</label>';
    html += '<input type="number" id="itemQty" step="0.1">';
    html += '<label>Цена закупки</label>';
    html += '<input type="number" id="itemPrice" ';
    html += 'oninput="calcCostDiff()">';
    html += '<div id="costDiff" class="hint-cost"></div>';

    html += '<label>Розничная цена</label>';
    html += '<input type="number" id="itemRetail">';
    html += '</div>';

    html += '<button class="btn-add" id="btnAdd" ';
    html += 'onclick="addToBasket()">';
    html += '+ Добавить в накладную</button>';

    html += '<div class="basket" id="basket">';
    html += '<h3 style="margin-top:0; font-size:16px;">В накладной:';
    html += '</h3>';
    html += '<div id="bList"></div>';
    html += '<div style="display:flex; justify-content:space-between; ';
    html += 'margin-top:15px; border-top:2px solid ' + brandColor + '; ';
    html += 'padding-top:10px; font-size:18px; font-weight:800;">';
    html += '<span>Итого:</span><span id="totalSum">0 ₽</span></div>';
    html += '<button class="btn-save" id="btnSaveReceipt" ';
    html += 'style="margin-top:15px;" ';
    html += 'onclick="saveReceipt()">Провести накладную</button>';
    html += '</div>';

    html += '<script>';
    html += 'var receiptId = ' + receiptId + ';';
    html += 'var currentLastCost = 0; var itemsCatalog = [];';

    html += 'function fmtNum(n) {';
    html += '  var num = parseFloat(n);';
    html += '  if (isNaN(num)) return "0";';
    html += '  return num % 1 === 0 ? num.toString() : ';
    html += 'num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");';
    html += '}';

    html += 'function checkCat() {';
    html += '  var sel = document.getElementById("itemCategory");';
    html += '  var unitBlock = document.getElementById("unitBlock");';
    html += '  if (sel.selectedIndex === -1) return;';
    html += '  var catText = sel.options[sel.selectedIndex].text;';
    html += '  if (catText.includes("Упаковка")) {';
    html += '    unitBlock.style.display = "block";';
    html += '  } else { unitBlock.style.display = "none"; }';
    html += '}';

    html += 'function onNameInput() {';
    html += '  var val = document.getElementById("itemName").value;';
    html += '  var found = itemsCatalog.find(function(i) { ';
    html += '    return i.name.toLowerCase() === val.toLowerCase(); });';
    html += '  if (found) {';
    html += '    document.getElementById("itemRetail").value = ';
    html += 'found.retail_price || "";';
    html += '    currentLastCost = parseFloat(found.last_cost) || 0;';
    html += '  } else { currentLastCost = 0; }';
    html += '  calcCostDiff();';
    html += '}';

    html += 'function calcCostDiff() {';
    html += '  var hint = document.getElementById("costDiff"); ';
    html += '  hint.innerText = "";';
    html += '  var priceStr = document.getElementById("itemPrice").value;';
    html += '  if (!priceStr) return;';
    html += '  var currentPrice = parseFloat(priceStr);';
    html += '  if (currentLastCost > 0 && currentPrice > 0) {';
    html += '    var diff = currentPrice - currentLastCost;';
    html += '    if (diff > 0) {';
    html += '      hint.innerText = "+" + diff + " ₽"; ';
    html += '      hint.style.color = "' + dangerColor + '";';
    html += '    } else if (diff < 0) {';
    html += '      hint.innerText = diff + " ₽"; ';
    html += '      hint.style.color = "' + successColor + '";';
    html += '    }';
    html += '  }';
    html += '}';

    html += 'function previewPhoto() {';
    html += '  var f = document.getElementById("itemPhoto").files[0];';
    html += '  if (!f) return;';
    html += '  var rd = new FileReader();';
    html += '  rd.onload = function(e) {';
    html += '    var img = document.getElementById("photoPreview");';
    html += '    img.src = e.target.result; ';
    html += '    img.style.display = "block";';
    html += '  };';
    html += '  rd.readAsDataURL(f);';
    html += '}';

    html += 'fetch("/api/warehouse/categories")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) { if (d.ok) {';
    html += '  var sel = document.getElementById("itemCategory");';
    html += '  d.categories.forEach(function(c) {';
    html += '    var opt = document.createElement("option");';
    html += '    opt.value = c.id; opt.innerText = c.name;';
    html += '    sel.appendChild(opt);';
    html += '  });';
    html += '  checkCat(); ';
    html += '} }).catch(function() {});';

    html += 'fetch("/api/warehouse/items?shop=kupidon")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) { if (d.ok) { ';
    html += '  itemsCatalog = d.items;';
    html += '  var dl = document.getElementById("itemsList");';
    html += '  d.items.forEach(function(i) {';
    html += '    var opt = document.createElement("option");';
    html += '    opt.value = i.name; dl.appendChild(opt);';
    html += '  }); ';
    html += '} }).catch(function() {});';

    html += 'fetch("/api/warehouse/receipt/items?id=" + receiptId)';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) { if (d.ok) { renderList(d.items); } })';
    html += '.catch(function() {});';

    html += 'function addToBasket() {';
    html += '  var name = document.getElementById("itemName").value;';
    html += '  var qty = document.getElementById("itemQty")';
    html += '.value.replace(",", ".");';
    html += '  var price = document.getElementById("itemPrice")';
    html += '.value.replace(",", ".");';
    html += '  var retail = document.getElementById("itemRetail")';
    html += '.value.replace(",", ".") || 0;';
    html += '  var catId = document.getElementById("itemCategory").value;';
    html += '  var unitEl = document.getElementById("itemUnit");';
    html += '  var unit = "шт";';
    html += '  if (document.getElementById("unitBlock").style.display ';
    html += '!== "none") { unit = unitEl.value; }';
    html += '  if (!name || !qty || !price) {';
    html += '    showAlert("Внимание", "Заполните поля", false); ';
    html += '    return;';
    html += '  }';

    html += '  var btn = document.getElementById("btnAdd");';
    html += '  btn.disabled = true; btn.innerText = "Добавление...";';

    html += '  var f = document.getElementById("itemPhoto").files[0];';
    html += '  var finish = function(url) {';
    html += '    fetch("/api/warehouse/receipt/item/add", {';
    html += '    method: "POST", ';
    html += '    headers: { "Content-Type": "application/json" }, ';
    html += '    body: JSON.stringify({ receipt_id: receiptId, ';
    html += '    name: name, qty: qty, price: price, retail: retail, ';
    html += '    cat_id: catId, unit: unit, photo_url: url }) })';

    html += '    .then(function(r) {';
    html += '      if (!r.ok) throw new Error("Сбой: " + r.status);';
    html += '      return r.json();';
    html += '    }).then(function(d) {';
    html += '      btn.disabled = false; ';
    html += '      btn.innerText = "+ Добавить в накладную";';
    html += '      if (d.ok) {';
    html += '        document.getElementById("itemName").value = "";';
    html += '        document.getElementById("itemQty").value = "";';
    html += '        document.getElementById("itemPrice").value = "";';
    html += '        document.getElementById("itemRetail").value = "";';
    html += '        document.getElementById("itemPhoto").value = "";';
    html += '        document.getElementById("photoPreview")';
    html += '        .style.display = "none";';
    html += '        document.getElementById("costDiff").innerText = "";';
    html += '        renderList(d.items);';
    html += '      } else {';
    html += '        showAlert("Ошибка", d.error, false);';
    html += '      }';
    html += '    }).catch(function(err) {';
    html += '      btn.disabled = false; ';
    html += '      btn.innerText = "+ Добавить в накладную";';
    html += '      showAlert("Ошибка", "Сбой: " + err.message, false);';
    html += '    });';
    html += '  };';

    html += '  if (f) {';
    html += '    var rd = new FileReader();';
    html += '    rd.onload = function(e) {';
    html += '      var img = new Image();';
    html += '      img.onload = function() {';
    html += '        var canvas = document.createElement("canvas");';
    html += '        var MAX = 800;';
    html += '        var w = img.width, h = img.height;';
    html += '        if (w > h) { if (w > MAX) { h *= MAX / w; ';
    html += '        w = MAX; } }';
    html += '        else { if (h > MAX) { w *= MAX / h; ';
    html += '        h = MAX; } }';
    html += '        canvas.width = w; canvas.height = h;';
    html += '        var ctx = canvas.getContext("2d");';
    html += '        ctx.drawImage(img, 0, 0, w, h);';
    html += '        var dataUrl = canvas.toDataURL("image/jpeg", 0.7);';
    html += '        fetch("/api/warehouse/upload", { method: "POST", ';
    html += '        headers: { "Content-Type": "application/json" }, ';
    html += '        body: JSON.stringify({ image: dataUrl }) })';
    html += '        .then(function(r) { return r.json(); })';
    html += '        .then(function(d) { finish(d.ok ? d.url : null); })';
    html += '        .catch(function() { finish(null); });';
    html += '      };';
    html += '      img.src = e.target.result;';
    html += '    };';
    html += '    rd.readAsDataURL(f);';
    html += '  } else { finish(null); }';
    html += '}';

    html += 'function renderList(items) {';
    html += '  var b = document.getElementById("basket");';
    html += '  var list = document.getElementById("bList");';
    html += '  if (!items || !Array.isArray(items) || ';
    html += 'items.length === 0) {';
    html += '    b.style.display = "none"; list.innerHTML = ""; ';
    html += '    return;';
    html += '  }';
    html += '  b.style.display = "block"; list.innerHTML = "";';
    html += '  var totalSum = 0;';
    html += '  items.forEach(function(item) {';
    html += '    totalSum += parseFloat(item.sum || 0);';
    html += '    var div = document.createElement("div");';
    html += '    div.className = "b-row";';
    html += '    var n = document.createElement("span");';
    html += '    n.textContent = item.name || "Товар";';
    html += '    var p = document.createElement("span");';
    html += '    p.textContent = fmtNum(item.qty) + " x " + ';
    html += '    fmtNum(item.unit_cost) + " ₽";';
    html += '    div.appendChild(n); div.appendChild(p); ';
    html += '    list.appendChild(div);';
    html += '  });';
    html += '  document.getElementById("totalSum").innerText = ';
    html += '  fmtNum(totalSum) + " ₽";';
    html += '}';

    html += 'function saveReceipt() {';
    html += '  var btn = document.getElementById("btnSaveReceipt");';
    html += '  btn.disabled = true; btn.innerText = "Проведение...";';
    html += '  fetch("/api/warehouse/receipt/finalize", { ';
    html += '  method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ receipt_id: receiptId }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) {';
    html += '    if (d.ok) {';
    html += '      showAlert("Успех", "Накладная проведена!", true);';
    html += '      setTimeout(function() {';
    html += '        window.location.href = "/warehouse/receipts"; ';
    html += '      }, 1500);';
    html += '    } else {';
    html += '      btn.disabled = false; ';
    html += '      btn.innerText = "Провести накладную";';
    html += '      showAlert("Ошибка", d.error || "unknown", false);';
    html += '    }';
    html += '  }).catch(function() {';
    html += '    btn.disabled = false; ';
    html += '    btn.innerText = "Провести накладную";';
    html += '    showAlert("Ошибка сети", "Повторите", false);';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 26. API ПОЛУЧЕНИЯ ПОЗИЦИЙ НАКЛАДНОЙ ======
  app.get('/api/warehouse/receipt/items', async (req, res) => {
    try {
      const receiptId = parseInt(req.query.id);
      if (!receiptId || isNaN(receiptId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      const r = await pool.query(
        'SELECT ri.id, ri.qty, ri.unit_cost, ri.sum, ' +
        'COALESCE(shi.custom_name, i.name) as name ' +
        'FROM wh_receipt_items ri ' +
        'JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE ri.receipt_id = $1',
        [receiptId]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 27. API ДОБАВЛЕНИЯ ПОЗИЦИИ ======
  app.post('/api/warehouse/receipt/item/add', async (req, res) => {
    try {
      const receiptId = parseInt(req.body.receipt_id);
      if (!receiptId || isNaN(receiptId)) {
        return res.json({ ok: false, error: 'Неверный ID накладной' });
      }

      const checkR = await pool.query(
        'SELECT status FROM wh_receipts WHERE id = $1',
        [receiptId]
      );
      if (checkR.rows.length === 0) {
        return res.json({ ok: false, error: 'Накладная не найдена' });
      }
      if (checkR.rows[0].status !== 'draft') {
        return res.json({ ok: false, error: 'Накладная уже проведена' });
      }

      const name = capWords(String(req.body.name || '').trim());
      if (!name) {
        return res.json({ ok: false, error: 'Введите название' });
      }

      const numQty = parseFloat(
        String(req.body.qty).replace(',', '.')
      );
      const numPrice = parseFloat(
        String(req.body.price).replace(',', '.')
      );
      const numRetail = parseFloat(
        String(req.body.retail).replace(',', '.')
      ) || 0;

      if (isNaN(numQty) || isNaN(numPrice) ||
          numQty <= 0 || numPrice <= 0) {
        return res.json({ ok: false, error: 'Неверные числа' });
      }

      const catId = req.body.cat_id ? 
        parseInt(req.body.cat_id) : null;
      const unit = req.body.unit || 'шт';
      const photoUrl = req.body.photo_url || null;

      let itemRes = await pool.query(
        'SELECT id FROM wh_items WHERE name = $1',
        [name]
      );
      let itemId;
      
      if (itemRes.rows.length === 0) {
        const ni = await pool.query(
          'INSERT INTO wh_items (name, unit, category_id, photo_url) ' +
          'VALUES ($1, $2, $3, $4) RETURNING id',
          [name, unit, catId, photoUrl]
        );
        itemId = ni.rows[0].id;
      } else {
        itemId = itemRes.rows[0].id;
        if (photoUrl) {
          await pool.query(
            'UPDATE wh_items SET photo_url = $1 WHERE id = $2',
            [photoUrl, itemId]
          );
        }
      }

      let shopItemRes = await pool.query(
        'SELECT id FROM wh_shop_items WHERE shop_id = $1 ' +
        'AND item_id = $2',
        ['kupidon', itemId]
      );
      let shopItemId;
      
      if (shopItemRes.rows.length === 0) {
        const nsi = await pool.query(
          'INSERT INTO wh_shop_items (shop_id, item_id) ' +
          'VALUES ($1, $2) RETURNING id',
          ['kupidon', itemId]
        );
        shopItemId = nsi.rows[0].id;
      } else {
        shopItemId = shopItemRes.rows[0].id;
      }

      const sum = Math.round(numQty * numPrice * 100) / 100;

      const existing = await pool.query(
        'SELECT id, qty, sum FROM wh_receipt_items ' +
        'WHERE receipt_id = $1 AND shop_item_id = $2',
        [receiptId, shopItemId]
      );

      if (existing.rows.length > 0) {
        const ex = existing.rows[0];
        const exQty = parseFloat(ex.qty);
        const exSum = parseFloat(ex.sum);
        const newQty = exQty + numQty;
        const newSum = exSum + sum;
        const newAvg = Math.round((newSum / newQty) * 100) / 100;
        
        await pool.query(
          'UPDATE wh_receipt_items SET qty = $1, sum = $2, ' +
          'unit_cost = $3 WHERE id = $4',
          [newQty, newSum, newAvg, ex.id]
        );
      } else {
        await pool.query(
          'INSERT INTO wh_receipt_items (receipt_id, shop_item_id, ' +
          'qty, unit_cost, sum) VALUES ($1, $2, $3, $4, $5)',
          [receiptId, shopItemId, numQty, numPrice, sum]
        );
      }

      await pool.query(
        'UPDATE wh_receipts SET total_sum = total_sum + $1 ' +
        'WHERE id = $2',
        [sum, receiptId]
      );

      if (numRetail > 0) {
        await pool.query(
          'UPDATE wh_shop_items SET retail_price = $1 ' +
          'WHERE id = $2',
          [numRetail, shopItemId]
        );
      }

      const items = await pool.query(
        'SELECT ri.id, ri.qty, ri.unit_cost, ri.sum, ' +
        'COALESCE(shi.custom_name, i.name) as name ' +
        'FROM wh_receipt_items ri ' +
        'JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE ri.receipt_id = $1',
        [receiptId]
      );
      res.json({ ok: true, items: items.rows });

    } catch (e) {
      console.error('Receipt add error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 28. API ПРОВЕДЕНИЯ НАКЛАДНОЙ ======
  app.post('/api/warehouse/receipt/finalize', async (req, res) => {
    const client = await pool.connect();
    try {
      const receiptId = parseInt(req.body.receipt_id);
      if (!receiptId || isNaN(receiptId)) {
        client.release();
        return res.json({ ok: false, error: 'Неверный ID' });
      }

      await client.query('BEGIN');

      const checkR = await client.query(
        'SELECT status FROM wh_receipts WHERE id = $1 FOR UPDATE',
        [receiptId]
      );
      if (checkR.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.json({ ok: false, error: 'Накладная не найдена' });
      }
      if (checkR.rows[0].status !== 'draft') {
        await client.query('ROLLBACK');
        client.release();
        return res.json({ ok: false, error: 'Уже проведена' });
      }

      const items = await client.query(
        'SELECT shop_item_id, qty, unit_cost ' +
        'FROM wh_receipt_items WHERE receipt_id = $1',
        [receiptId]
      );

      if (items.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.json({ ok: false, error: 'Накладная пуста' });
      }

      for (let i = 0; i < items.rows.length; i++) {
        const item = items.rows[i];
        const curr = await client.query(
          'SELECT current_stock, avg_cost FROM wh_shop_items ' +
          'WHERE id = $1 FOR UPDATE',
          [item.shop_item_id]
        );

        let oldStock = parseFloat(curr.rows[0].current_stock) || 0;
        let oldAvg = parseFloat(curr.rows[0].avg_cost) || 0;
        let qty = parseFloat(item.qty) || 0;
        let price = parseFloat(item.unit_cost) || 0;

        let newStock = oldStock + qty;
        let newAvg = 0;
        
        if (newStock > 0) {
          newAvg = (oldStock * oldAvg + qty * price) / newStock;
          newAvg = Math.round(newAvg * 100) / 100;
        }

        await client.query(
          'UPDATE wh_shop_items SET current_stock = $1, ' +
          'last_cost = $2, avg_cost = $3 WHERE id = $4',
          [newStock, price, newAvg, item.shop_item_id]
        );
      }

      await client.query(
        'UPDATE wh_receipts SET status = \'completed\' ' +
        'WHERE id = $1',
        [receiptId]
      );

      await client.query('COMMIT');
      client.release();

      await logAction('kupidon', null, 'receipt',
        'Проведена накладная ID ' + receiptId, receiptId);
        
      res.json({ ok: true });

    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      console.error('Finalize error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 29. ЭКРАН СПИСАНИЯ ======
  app.get('/warehouse/writeoff', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, ';
    html += 'user-scalable=no">';
    html += fontLink;
    html += uiScript;
    html += '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; }';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.search { width: 100%; padding: 15px; border: none; ';
    html += 'border-radius: 12px; margin-bottom: 15px; ';
    html += 'box-sizing: border-box; font-family: inherit; ';
    html += 'font-size: 16px; ';
    html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
    html += '.grid { display: grid; grid-template-columns: ';
    html += 'repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; ';
    html += 'margin-bottom: 15px; }';
    html += '.card { background: #fff; padding: 10px; ';
    html += 'border-radius: 16px; text-align: center; ';
    html += 'cursor: pointer; ';
    html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
    html += '.card img { width: 100%; height: 80px; ';
    html += 'object-fit: cover; border-radius: 12px; ';
    html += 'margin-bottom: 5px; }';
    html += '.card .ph { height: 80px; border-radius: 12px; ';
    html += 'background: #F0F4F4; display: flex; ';
    html += 'align-items: center; justify-content: center; ';
    html += 'margin-bottom: 5px; }';
    html += '.card .ph svg { width: 32px; height: 32px; }';
    html += '.card .name { font-size: 13px; font-weight: 600; ';
    html += 'margin-bottom: 4px; }';
    html += '.card .stock { font-size: 12px; font-weight: 800; ';
    html += 'color: ' + successColor + '; }';
    html += '.basket { background: #fff; border-radius: 16px; ';
    html += 'padding: 15px; margin-bottom: 15px; ';
    html += 'box-shadow: 0 4px 15px rgba(15,61,62,0.05); ';
    html += 'display: none; border-left: 4px solid ';
    html += accentColor + '; }';
    html += '.b-row { display: flex; justify-content: space-between; ';
    html += 'margin-bottom: 8px; border-bottom: 1px solid #eee; ';
    html += 'padding-bottom: 8px; font-size: 14px; }';
    html += '.reasons { display: grid; grid-template-columns: 1fr 1fr; ';
    html += 'gap: 10px; margin-bottom: 15px; }';
    html += '.reason { padding: 12px; border-radius: 12px; ';
    html += 'border: 1px solid #ddd; background: #fff; ';
    html += 'text-align: center; cursor: pointer; font-size: 14px; ';
    html += 'font-weight: 600; }';
    html += '.reason.active { border-color: ' + accentColor + '; ';
    html += 'color: ' + accentColor + '; background: #FFF3E0; }';
    html += '.btn-save { width: 100%; padding: 16px; ';
    html += 'background: ' + accentColor + '; color: #fff; ';
    html += 'border: none; border-radius: 12px; font-size: 16px; ';
    html += 'font-weight: 800; }';
    html += '</style></head><body>';

    html += '<div class="header">';
    html += '<a href="/warehouse-app" class="back">←</a>';
    html += '<h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('writeoff') + 'Списание</h2></div>';

    html += '<div class="basket" id="basket">';
    html += '<h3 style="margin-top:0; font-size:16px;">';
    html += 'Выбрано:</h3><div id="bList"></div>';
    html += '<label style="margin-top:10px; display:block; ';
    html += 'font-size:13px; font-weight:600; color:#666;">';
    html += 'Причина</label><div class="reasons">';
    html += '<div class="reason active" ';
    html += 'onclick="setR(this, \'spoilage\')">Порча</div>';
    html += '<div class="reason" ';
    html += 'onclick="setR(this, \'loss\')">Потеря</div>';
    html += '<div class="reason" ';
    html += 'onclick="setR(this, \'markdown\')">Уценка</div>';
    html += '<div class="reason" ';
    html += 'onclick="setR(this, \'sorting\')">Пересорт</div>';
    html += '</div>';
    
    html += '<label style="font-size:13px; font-weight:600; ';
    html += 'color:#666;">Комментарий</label>';
    html += '<textarea id="comment" style="width:100%; padding:12px; ';
    html += 'border-radius:12px; border:1px solid #ddd; ';
    html += 'margin-bottom:15px; font-family:inherit;"></textarea>';
    
    html += '<label style="font-size:13px; font-weight:600; ';
    html += 'color:#666;">Фото (необязательно)</label>';
    html += '<input type="file" id="wPhoto" accept="image/*" ';
    html += 'style="margin-bottom:15px;">';
    
    html += '<button class="btn-save" id="btnSaveWriteoff" ';
    html += 'onclick="saveWriteoff()">Списать всё</button>';
    html += '</div>';

    html += '<input type="text" class="search" id="search" ';
    html += 'placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    html += '<div class="grid" id="itemsGrid"></div>';

    html += '<div class="custom-modal-overlay" id="qtyModal">';
    html += '<div class="custom-modal">';
    html += '<h3 style="margin-top:0;">Сколько списать?</h3>';
    html += '<input type="number" id="qtyInput" inputmode="decimal" ';
    html += 'style="font-size:24px; text-align:center; width:100%; ';
    html += 'box-sizing:border-box; padding:12px; ';
    html += 'border:1px solid #ddd; border-radius:10px; ';
    html += 'margin-bottom:15px; font-family:inherit;">';
    html += '<div class="custom-modal-btns">';
    html += '<button class="btn-cancel" ';
    html += 'onclick="closeQtyModal()">Отмена</button>';
    html += '<button class="btn-ok" ';
    html += 'onclick="confirmQty()">ОК</button>';
    html += '</div></div></div>';

    html += '<script>';
    html += 'var allItems = []; var cart = []; ';
    html += 'var selReason = "spoilage";';
    html += 'var currentItem = null;';
    
    html += 'var svgPh = \'<svg viewBox="0 0 24 24" fill="#A0B4B4">';
    html += '<path d="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22';
    html += 'L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3';
    html += 'C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5';
    html += 'C2,15.5 3.5,17.5 6.5,17.5C7.21,17.5 7.87,17.36 ';
    html += '8.5,17.12C11.24,16.08 13.44,14.57 15,12.5';
    html += 'C15,12.5 15.5,14.5 15.5,16.5C15.5,18.5 14.5,20 ';
    html += '14.5,20C17,20 19.5,17.5 20.5,14.5C21.5,11.5 ';
    html += '21.5,8 21.5,8C21.5,8 19.5,6 17,8Z"/></svg>\';';

    html += 'function fmtNum(n) {';
    html += '  var num = parseFloat(n);';
    html += '  if (isNaN(num)) return "0";';
    html += '  return num % 1 === 0 ? num.toString() : ';
    html += 'num.toFixed(3).replace(/0+$/, "")';
    html += '.replace(/\\.$/, "");';
    html += '}';

    html += 'fetch("/api/warehouse/items?shop=kupidon")';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) { allItems = d.items; render(); })';
    html += '.catch(function() {});';

    html += 'function render() { drawCards(allItems); }';
    html += 'function filterItems() {';
    html += '  var q = document.getElementById("search")';
    html += '  .value.toLowerCase();';
    html += '  drawCards(allItems.filter(function(i) {';
    html += '    return i.name.toLowerCase().includes(q); ';
    html += '  }));';
    html += '}';

    html += 'function drawCards(items) {';
    html += '  var g = document.getElementById("itemsGrid");';
    html += '  g.innerHTML = "";';
    html += '  items.forEach(function(i) {';
    html += '    var d = document.createElement("div");';
    html += '    d.className = "card";';
    html += '    var img = i.photo_url ? ';
    html += '    \'<img src="\' + i.photo_url + \'">\' : ';
    html += '    \'<div class="ph">\' + svgPh + \'</div>\';';
    html += '    var unit = i.unit || "шт";';
    html += '    d.innerHTML = img;';
    html += '    var nm = document.createElement("div");';
    html += '    nm.className = "name"; nm.textContent = i.name;';
    html += '    var st = document.createElement("div");';
    html += '    st.className = "stock";';
    html += '    st.textContent = "Ост: " + ';
    html += '    fmtNum(i.current_stock) + " " + unit;';
    html += '    d.appendChild(nm); d.appendChild(st);';
    html += '    d.onclick = function() { addToBasket(i); };';
    html += '    g.appendChild(d);';
    html += '  });';
    html += '}';

    html += 'function addToBasket(item) {';
    html += '  currentItem = item;';
    html += '  document.getElementById("qtyInput").value = "";';
    html += '  document.getElementById("qtyModal")';
    html += '  .style.display = "flex";';
    html += '  setTimeout(function() {';
    html += '    document.getElementById("qtyInput").focus();';
    html += '  }, 100);';
    html += '}';

    html += 'function closeQtyModal() {';
    html += '  document.getElementById("qtyModal")';
    html += '  .style.display = "none";';
    html += '}';

    html += 'function confirmQty() {';
    html += '  var q = parseFloat(';
    html += '    document.getElementById("qtyInput").value);';
    html += '  if (q && q > 0) {';
    html += '    var ex = cart.find(function(c) { ';
    html += '      return c.id === currentItem.id; });';
    html += '    if (ex) ex.qty += q;';
    html += '    else cart.push({ id: currentItem.id, ';
    html += '      name: currentItem.name, qty: q });';
    html += '    renderBasket();';
    html += '    window.scrollTo(0, 0);';
    html += '  }';
    html += '  closeQtyModal();';
    html += '}';

    html += 'function renderBasket() {';
    html += '  var b = document.getElementById("basket");';
    html += '  var list = document.getElementById("bList");';
    html += '  if (cart.length === 0) { ';
    html += '    b.style.display = "none"; return; }';
    html += '  b.style.display = "block"; list.innerHTML = "";';
    html += '  cart.forEach(function(item, idx) {';
    html += '    var div = document.createElement("div");';
    html += '    div.className = "b-row";';
    html += '    var span1 = document.createElement("span");';
    html += '    span1.textContent = item.name;';
    html += '    var span2 = document.createElement("span");';
    html += '    span2.textContent = fmtNum(item.qty) + " шт";';
    html += '    var x = document.createElement("span");';
    html += '    x.textContent = " ✕";';
    html += '    x.style = "color:red; cursor:pointer; margin-left:10px;";';
    html += '    x.onclick = function() { ';
    html += '      cart.splice(idx, 1); renderBasket(); };';
    html += '    span2.appendChild(x);';
    html += '    div.appendChild(span1); div.appendChild(span2);';
    html += '    list.appendChild(div);';
    html += '  });';
    html += '}';

    html += 'function setR(el, r) {';
    html += '  document.querySelectorAll(".reason").forEach(function(b) {';
    html += '    b.classList.remove("active"); });';
    html += '  el.classList.add("active"); selReason = r;';
    html += '}';

    html += 'function saveWriteoff() {';
    html += '  if (cart.length === 0) return;';
    html += '  var btn = document.getElementById("btnSaveWriteoff");';
    html += '  btn.disabled = true; btn.innerText = "Списание...";';
    html += '  var c = document.getElementById("comment").value;';
    html += '  var f = document.getElementById("wPhoto").files[0];';
    html += '  if (f) {';
    html += '    var rd = new FileReader();';
    html += '    rd.onload = function(e) { upload(e.target.result, c); };';
    html += '    rd.readAsDataURL(f);';
    html += '  } else { submit(null, c); }';
    html += '}';

    html += 'function upload(base64, c) {';
    html += '  fetch("/api/warehouse/upload", { method: "POST", ';
    html += '    headers: { "Content-Type": "application/json" }, ';
    html += '    body: JSON.stringify({ image: base64 }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { submit(d.url, c); })';
    html += '  .catch(function() { submit(null, c); });';
    html += '}';

    html += 'function submit(url, c) {';
    html += '  var payload = { shopId: "kupidon", items: cart, ';
    html += '    reason: selReason, comment: c, photo: url };';
    html += '  fetch("/api/warehouse/writeoff", { method: "POST", ';
    html += '    headers: { "Content-Type": "application/json" }, ';
    html += '    body: JSON.stringify(payload) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) {';
    html += '    if (d.ok) {';
    html += '      showAlert("Успех", "Успешно списано!", true);';
    html += '      setTimeout(function() { ';
    html += '        window.location.href = "/warehouse-app"; }, 1500);';
    html += '    } else {';
    html += '      document.getElementById("btnSaveWriteoff")';
    html += '      .disabled = false;';
    html += '      document.getElementById("btnSaveWriteoff")';
    html += '      .innerText = "Списать всё";';
    html += '      showAlert("Ошибка", d.error, false);';
    html += '    }';
    html += '  }).catch(function() {';
    html += '    document.getElementById("btnSaveWriteoff")';
    html += '    .disabled = false;';
    html += '    showAlert("Ошибка сети", "Повторите", false);';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 30. API СПИСАНИЯ ======
  app.post('/api/warehouse/writeoff', async (req, res) => {
    const client = await pool.connect();
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;
      if (!chatId) {
        client.release();
        return res.status(401).json({ ok: false });
      }

      const items = req.body.items;
      if (!Array.isArray(items) || items.length === 0) {
        client.release();
        return res.json({ ok: false, error: 'Список пуст' });
      }

      await client.query('BEGIN');

      let wId = null;
      let totalLoss = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        await client.query(
          'UPDATE wh_shop_items SET current_stock = ' +
          'current_stock - $1 WHERE id = $2',
          [item.qty, item.id]
        );

        const costQ = await client.query(
          'SELECT avg_cost FROM wh_shop_items WHERE id = $1',
          [item.id]
        );
        const cost = parseFloat(costQ.rows[0].avg_cost) || 0;
        totalLoss += (cost * parseFloat(item.qty));

        const wRes = await client.query(
          'INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, ' +
          'reason, comment, photo_url, chat_id) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [req.body.shopId, item.id, item.qty, req.body.reason,
           req.body.comment, req.body.photo, chatId]
        );
        if (!wId) wId = wRes.rows[0].id;
      }

      await client.query('COMMIT');
      client.release();

      const itemName = items[0].name || 'Товар';
      const logMsg = 'Списание: ' + itemName + ' (и др.)';
      await logAction(req.body.shopId, chatId, 'writeoff', logMsg, wId);

      const shopRes = await pool.query(
        'SELECT settings FROM shops WHERE shop_id = $1',
        [req.body.shopId]
      );
      let threshold = 1000;
      if (shopRes.rows.length > 0 && shopRes.rows[0].settings) {
        const st = shopRes.rows[0].settings.writeoff_threshold;
        threshold = st ? parseInt(st) : 1000;
      }

      if (totalLoss >= threshold) {
        const txt = '🗑 Крупное списание на ' +
          Math.round(totalLoss) + ' ₽';
        await notifyOwner(bot, req.body.shopId, txt, 'writeoff');
      }

      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      console.error('Writeoff error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 31. API ЗАГРУЗКИ ФОТО (S3) ======
  app.post('/api/warehouse/upload', async (req, res) => {
    try {
      if (!s3) {
        return res.status(503).json({ 
          ok: false, error: 'S3 не настроен на сервере' 
        });
      }
      
      const base64Data = req.body.image;
      if (!base64Data) {
        return res.json({ ok: false, error: 'Нет фото' });
      }

      const base64Image = base64Data.split(';base64,').pop();
      const buffer = Buffer.from(base64Image, 'base64');
      const key = 'wh_' + Date.now() + '_' + 
        Math.random().toString(36).slice(2, 6) + '.jpg';
      
      const cmd = new PutObjectCommand({
        Bucket: YC_BUCKET, 
        Key: key, 
        Body: buffer, 
        ContentType: 'image/jpeg'
      });
      await s3.send(cmd);
      
      const url = 'https://' + YC_BUCKET + 
        '.storage.yandexcloud.net/' + key;
      
      let urlBackup = null;
      if (s3backup && BC_BUCKET && BC_ENDPOINT) {
        try {
          const cmd2 = new PutObjectCommand({
            Bucket: BC_BUCKET, 
            Key: key, 
            Body: buffer, 
            ContentType: 'image/jpeg'
          });
          await s3backup.send(cmd2);
          urlBackup = BC_ENDPOINT + '/' + BC_BUCKET + '/' + key;
        } catch (err) {
          console.error('Backup S3 error:', err.message);
        }
      }
      
      res.json({ ok: true, url: url, urlBackup: urlBackup });
    } catch (e) {
      console.error('Upload error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  // ====== 32. API ДОКУМЕНТОВ ======
  app.get('/api/warehouse/documents', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const type = req.query.type || 'receipts';
      
      if (type === 'receipts') {
        const r = await pool.query(
          'SELECT r.id, r.date, r.total_sum as amount, a.name as author ' +
          'FROM wh_receipts r LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
          'WHERE r.shop_id = $1 AND r.status = \'completed\' ' +
          'ORDER BY r.date DESC LIMIT 50', [shopId]
        );
        res.json({ ok: true, docs: r.rows });
      } else {
        const r = await pool.query(
          'SELECT w.id, w.date, w.qty as amount, w.reason, a.name as author, ' +
          'COALESCE(shi.custom_name, i.name) as item_name ' +
          'FROM wh_writeoffs w LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
          'LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ' +
          'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
          'WHERE w.shop_id = $1 ORDER BY w.date DESC LIMIT 50', [shopId]
        );
        res.json({ ok: true, docs: r.rows });
      }
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ====== 33. ЭКРАН ДОКУМЕНТОВ ======
  app.get('/warehouse/documents', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; padding: 15px; background: ' + bgGradient + '; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.tabs { display: flex; gap: 10px; margin-bottom: 15px; } .tab { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 12px; background: #fff; text-align: center; cursor: pointer; text-decoration: none; font-weight: 600; color: ' + brandColor + '; }';
    html += '.tab.active { background: ' + brandColor + '; color: #fff; } .doc { background: #fff; border-radius: 12px; padding: 15px; margin-bottom: 10px; text-decoration: none; color: ' + brandColor + '; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
    html += '.doc.receipt { border-left: 4px solid #3C7A89; } .doc.writeoff { border-left: 4px solid ' + accentColor + '; } .meta { font-size: 12px; color: #888; margin-top: 4px; } .amount { font-weight: 800; font-size: 16px; }';
    html += '</style></head><body><div class="header"><a href="/warehouse-app" class="back">←</a><h2 style="margin:0; display:flex; align-items:center;">' + getIconSvg('docs') + 'Документы</h2></div>';
    html += '<div class="tabs"><a href="/warehouse/documents?type=receipts" class="tab" id="tab-receipts">Приходы</a><a href="/warehouse/documents?type=writeoffs" class="tab" id="tab-writeoffs">Списания</a></div><div id="list">Загрузка...</div>';

    html += '<script>';
    html += 'var currentType = new URLSearchParams(window.location.search).get("type") || "receipts";';
    html += 'var tab = document.getElementById("tab-" + currentType); if (tab) tab.classList.add("active");';
    html += 'fetch("/api/warehouse/documents?shop=kupidon&type=" + currentType).then(function(r){return r.json();}).then(function(d){';
    html += '  var b = document.getElementById("list"); b.innerHTML = ""; if (!d.ok) { b.textContent = "Ошибка: " + (d.error || "сервер"); return; } if (d.docs.length === 0) { b.textContent = "Документов нет"; return; }';
    html += '  d.docs.forEach(function(doc){ var a = document.createElement("a"); a.className = "doc " + (currentType === "receipts" ? "receipt" : "writeoff"); a.href = "/warehouse/documents/details?id=" + doc.id + "&type=" + currentType;';
    html += '    var ds = new Date(doc.date).toLocaleString("ru-RU"); var author = doc.author || "Система"; var left = document.createElement("div"); var title = document.createElement("b"); var meta = document.createElement("div"); var amount = document.createElement("div"); meta.className = "meta"; amount.className = "amount";';
    html += '    if (currentType === "receipts") { title.textContent = "Накладная №" + doc.id; meta.textContent = ds + " · " + author; amount.textContent = parseFloat(doc.amount).toLocaleString("ru-RU") + " ₽"; amount.style.color = "#3C7A89"; }';
    html += '    else { title.textContent = "Акт списания №" + doc.id; var itm = doc.item_name || ""; meta.textContent = ds + " · " + author + " (" + itm + " / " + doc.reason + ")"; amount.textContent = "-" + parseFloat(doc.amount) + " шт"; amount.style.color = "' + accentColor + '"; }';
    html += '    left.appendChild(title); left.appendChild(meta); a.appendChild(left); a.appendChild(amount); b.appendChild(a); });';
    html += '}).catch(function(){ document.getElementById("list").textContent = "Ошибка загрузки"; });';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 34. API ДЕТАЛЕЙ ДОКУМЕНТА ======
  app.get('/api/warehouse/documents/details', async (req, res) => {
    try {
      const id = parseInt(req.query.id); const type = req.query.type;
      if (!id || isNaN(id)) return res.json({ ok: false, error: 'Неверный ID' });
      
      if (type === 'receipts') {
        const header = await pool.query('SELECT r.id, r.date, r.total_sum, a.name as author FROM wh_receipts r LEFT JOIN admins a ON a.chat_id = r.chat_id WHERE r.id = $1', [id]);
        const items = await pool.query('SELECT ri.shop_item_id, ri.qty, ri.unit_cost, ri.sum, COALESCE(shi.custom_name, i.name) as name FROM wh_receipt_items ri LEFT JOIN wh_shop_items shi ON shi.id = ri.shop_item_id LEFT JOIN wh_items i ON i.id = shi.item_id WHERE ri.receipt_id = $1', [id]);
        res.json({ ok: true, header: header.rows[0], items: items.rows });
      } else {
        const header = await pool.query('SELECT w.id, w.date, w.qty as total_sum, w.reason, a.name as author FROM wh_writeoffs w LEFT JOIN admins a ON a.chat_id = w.chat_id WHERE w.id = $1', [id]);
        const items = await pool.query('SELECT w.shop_item_id, w.qty, 0 as unit_cost, 0 as sum, COALESCE(shi.custom_name, i.name) as name FROM wh_writeoffs w LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id LEFT JOIN wh_items i ON i.id = shi.item_id WHERE w.id = $1', [id]);
        res.json({ ok: true, header: header.rows[0], items: items.rows });
      }
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ====== 35. ЭКРАН ДЕТАЛЕЙ ДОКУМЕНТА ======
  app.get('/warehouse/documents/details', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; padding: 15px; background: ' + bgGradient + '; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 16px; padding: 20px; margin-bottom: 15px; box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
    html += '.item-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee; text-decoration: none; color: ' + brandColor + '; } .item-row:last-child { border-bottom: none; } .item-name { font-weight: 600; } .item-qty { text-align: right; font-weight: 800; }';
    html += '.total-row { margin-top: 15px; padding-top: 15px; border-top: 2px solid ' + brandColor + '; display: flex; justify-content: space-between; font-size: 18px; font-weight: 800; }';
    html += '</style></head><body><div class="header"><a href="/warehouse/documents" class="back">←</a><h2 style="margin:0; display:flex; align-items:center;">' + getIconSvg('docs') + 'Документ</h2></div><div class="card" id="content">Загрузка...</div>';

    html += '<script>';
    html += 'var urlParams = new URLSearchParams(window.location.search); var docId = parseInt(urlParams.get("id")) || 0; var docType = urlParams.get("type") || "receipts";';
    html += 'fetch("/api/warehouse/documents/details?id=" + docId + "&type=" + docType).then(function(r){return r.json();}).then(function(d){';
    html += '  var content = document.getElementById("content"); content.innerHTML = ""; if (!d.ok) { content.textContent = "Ошибка: " + d.error; return; }';
    html += '  var h = d.header; var ds = new Date(h.date).toLocaleString("ru-RU"); var titleTxt = docType === "receipts" ? "Приходная накладная №" : "Акт списания №";';
    html += '  var title = document.createElement("div"); title.style = "font-size:20px; font-weight:800;"; title.textContent = titleTxt + h.id; content.appendChild(title);';
    html += '  var meta = document.createElement("div"); meta.style = "font-size:13px; color:#666; margin-bottom:15px;"; meta.textContent = ds + " · Сделал: " + (h.author || "Неизвестно"); content.appendChild(meta);';
    html += '  d.items.forEach(function(i){ var a = document.createElement("a"); a.href = "/warehouse/item?id=" + (parseInt(i.shop_item_id) || 0); a.className = "item-row"; var left = document.createElement("div"); var nm = document.createElement("div"); nm.className = "item-name"; nm.textContent = i.name; left.appendChild(nm);';
    html += '    if (docType === "receipts") { var cost = document.createElement("div"); cost.style = "font-size:12px; color:#888;"; cost.textContent = parseFloat(i.unit_cost).toLocaleString("ru-RU") + " ₽/шт"; left.appendChild(cost); }';
    html += '    else { var rsn = document.createElement("div"); rsn.style = "font-size:12px; color:#888;"; rsn.textContent = "Причина: " + h.reason; left.appendChild(rsn); }';
    html += '    var right = document.createElement("div"); right.className = "item-qty"; right.textContent = parseFloat(i.qty) + " шт";';
    html += '    if (docType === "receipts") { var sum = document.createElement("div"); sum.style = "font-size:12px; color:#888; font-weight:400;"; sum.textContent = parseFloat(i.sum).toLocaleString("ru-RU") + " ₽"; right.appendChild(sum); }';
    html += '    a.appendChild(left); a.appendChild(right); content.appendChild(a); });';
    html += '  var total = document.createElement("div"); total.className = "total-row";';
    html += '  total.innerHTML = "<span>Итого:</span><span>" + (docType === "receipts" ? parseFloat(h.total_sum).toLocaleString("ru-RU") + " ₽" : h.total_sum + " шт") + "</span>"; content.appendChild(total);';
    html += '}).catch(function(){ document.getElementById("content").textContent = "Ошибка загрузки"; });';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 36. API ОТЧЁТОВ ======
  app.get('/api/warehouse/reports', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon'; const period = req.query.period || 'all';
      let dateFilter = '';
      if (period === 'today') dateFilter = 'AND DATE(%DATE%) = CURRENT_DATE';
      else if (period === 'week') dateFilter = 'AND %DATE% >= NOW() - INTERVAL \'7 days\'';
      else if (period === 'month') dateFilter = 'AND %DATE% >= NOW() - INTERVAL \'1 month\'';

      const rev = await pool.query('SELECT COALESCE(SUM(real_price), 0) AS total FROM wh_sales WHERE shop_id = $1 ' + dateFilter.replace(/%DATE%/g, 'date'), [shopId]);
      const loss = await pool.query('SELECT COALESCE(SUM(w.qty * i.avg_cost), 0) AS total FROM wh_writeoffs w JOIN wh_shop_items i ON i.id = w.shop_item_id WHERE w.shop_id = $1 ' + dateFilter.replace(/%DATE%/g, 'w.date'), [shopId]);
      const cost = await pool.query('SELECT COALESCE(SUM(s.qty * s.cost_at_sale), 0) AS total FROM wh_sale_items s JOIN wh_sales sa ON sa.id = s.sale_id WHERE sa.shop_id = $1 ' + dateFilter.replace(/%DATE%/g, 'sa.date'), [shopId]);

      const revenue = parseFloat(rev.rows[0].total) || 0; const losses = parseFloat(loss.rows[0].total) || 0; const costVal = parseFloat(cost.rows[0].total) || 0;
      const profit = revenue - costVal; let lossPercent = 0; if ((revenue + losses) > 0) lossPercent = Math.round((losses / (revenue + losses)) * 100);
      res.json({ ok: true, revenue, profit, losses, lossPercent });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ====== 37. ЭКРАН ОТЧЁТОВ ======
  app.get('/warehouse/reports', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>body { font-family: "Manrope", sans-serif; margin: 0; padding: 15px; background: ' + bgGradient + '; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; } .filters { display: flex; gap: 8px; margin-bottom: 15px; } .filter { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 12px; background: #fff; text-align: center; cursor: pointer; font-size: 13px; font-weight: 600; } .filter.active { background: ' + brandColor + '; color: #fff; }';
    html += '.card { background: #fff; border-radius: 16px; padding: 20px; margin-bottom: 15px; text-align: center; box-shadow: 0 4px 15px rgba(15,61,62,0.05); } .val { font-size: 28px; font-weight: 800; } .blue { color: #3C7A89; } .green { color: ' + successColor + '; } .red { color: ' + accentColor + '; }</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h2 style="margin:0; display:flex; align-items:center;">' + getIconSvg('reports') + 'Отчёты</h2></div>';
    html += '<div class="filters"><div class="filter" id="f-today" onclick="setPeriod(\'today\')">Сегодня</div><div class="filter" id="f-week" onclick="setPeriod(\'week\')">Неделя</div><div class="filter" id="f-month" onclick="setPeriod(\'month\')">Месяц</div><div class="filter active" id="f-all" onclick="setPeriod(\'all\')">Всё</div></div>';
    html += '<div id="load" style="text-align:center;">Загрузка...</div><div id="cont" style="display:none;">';
    html += '<div class="card"><div style="font-size:14px;color:#666;">Выручка</div><div class="val blue" id="rev">0</div></div>';
    html += '<div class="card"><div style="font-size:14px;color:#666;">Прибыль</div><div class="val green" id="prof">0</div></div>';
    html += '<div class="card" style="border: 2px solid ' + accentColor + ';"><div style="font-size:14px;color:#666;">Потери</div><div class="val red" id="loss">0</div><div id="pct" style="font-size:13px;font-weight:600;"></div></div></div>';

    html += '<script>';
    html += 'var currentPeriod = "all"; function setPeriod(p) { currentPeriod = p; document.querySelectorAll(".filter").forEach(function(el){el.classList.remove("active");}); document.getElementById("f-"+p).classList.add("active"); loadData(); }';
    html += 'function loadData() { document.getElementById("load").style.display = "block"; document.getElementById("cont").style.display = "none"; fetch("/api/warehouse/reports?shop=kupidon&period=" + currentPeriod).then(function(r){return r.json();}).then(function(d){ if (d.ok) { document.getElementById("load").style.display="none"; document.getElementById("cont").style.display="block"; document.getElementById("rev").innerText = d.revenue.toLocaleString("ru-RU") + " ₽"; document.getElementById("prof").innerText = d.profit.toLocaleString("ru-RU") + " ₽"; document.getElementById("loss").innerText = d.losses.toLocaleString("ru-RU") + " ₽"; document.getElementById("pct").innerText = d.lossPercent + "% от закупок"; } }).catch(function(){ document.getElementById("load").textContent = "Ошибка"; }); }';
    html += 'loadData();';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 38. API ФЛОРИСТОВ ======
  app.get('/api/warehouse/staff', async (req, res) => {
    try {
      const cookie = req.headers.cookie || ''; const match = cookie.match(/wh_auth=(\d+)/); const chatId = match ? Number(match[1]) : null;
      const ownerCheck = await pool.query('SELECT role FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]);
      if (!ownerCheck.rows[0] || ownerCheck.rows[0].role !== 'owner') return res.status(403).json({ ok: false, error: 'Только владелец' });
      const r = await pool.query('SELECT a.name, a.warehouse_pin, a.can_receipt, a.can_sale, a.can_writeoff, a.chat_id, COALESCE(SUM(s.real_price), 0) as total_sales FROM admins a LEFT JOIN wh_sales s ON a.chat_id = s.chat_id WHERE a.shop_id = $1 AND a.role = \'florist\' GROUP BY a.chat_id, a.name, a.warehouse_pin, a.can_receipt, a.can_sale, a.can_writeoff', [req.query.shop || 'kupidon']);
      res.json({ ok: true, staff: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 39. ЭКРАН ФЛОРИСТОВ ======
  app.get('/warehouse/staff', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>body { font-family: "Manrope", sans-serif; margin: 0; padding: 15px; background: ' + bgGradient + '; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; } .card { background: #fff; border-radius: 16px; padding: 15px; margin-bottom: 15px; box-shadow: 0 4px 15px rgba(15,61,62,0.05); } .name { font-size: 18px; font-weight: 800; } .sales { font-size: 16px; color: ' + successColor + '; margin-top: 5px; font-weight: 600; }';
    html += '.row { display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; } .btn-pin { margin-top:10px; padding:8px 15px; border-radius:10px; border:none; background:' + brandColor + '; color:#fff; font-weight:600; font-family:inherit; } input[type="checkbox"] { transform: scale(1.3); accent-color: ' + brandColor + '; }</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a><h2 style="margin:0; display:flex; align-items:center;">' + getIconSvg('staff') + 'Флористы</h2></div><div id="list"></div>';

    html += '<script>';
    html += 'fetch("/api/warehouse/staff?shop=kupidon").then(function(r){return r.json();}).then(function(d){ var b = document.getElementById("list"); if (!d.ok) { b.textContent = "Доступ запрещен"; return; } if (d.staff.length === 0) { b.textContent = "Нет флористов"; return; }';
    html += '  d.staff.forEach(function(f){ var c = document.createElement("div"); c.className = "card"; var name = f.name || "Флорист"; c.innerHTML = "<div class=\'name\'>" + name + "</div>"; var sum = parseFloat(f.total_sales).toLocaleString("ru-RU"); c.innerHTML += "<div class=\'sales\'>Продано: " + sum + " ₽</div><div style=\'font-size:12px;color:#888;\'>PIN: " + (f.warehouse_pin || "нет") + "</div>";';
    html += '    var btn = document.createElement("button"); btn.innerText = "Задать PIN"; btn.className = "btn-pin"; btn.onclick = function(){setPin(f.chat_id);}; c.appendChild(btn);';
    html += '    c.appendChild(makeCheck("Приход", "receipt", f.can_receipt, f.chat_id)); c.appendChild(makeCheck("Продажа", "sale", f.can_sale, f.chat_id)); c.appendChild(makeCheck("Списание", "writeoff", f.can_writeoff, f.chat_id)); b.appendChild(c); }); }).catch(function(){});';
    html += 'function makeCheck(label, field, checked, chatId) { var r = document.createElement("div"); r.className = "row"; r.innerHTML = "<span>" + label + "</span>"; var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = checked; cb.onchange = function(){setRights(chatId, field, cb.checked);}; r.appendChild(cb); return r; }';
    html += 'function setPin(id) { var p = prompt("Введите 4 цифры:"); if (p && p.length === 4) { fetch("/api/warehouse/florist/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", chatId: id, pin: p }) }).then(function(){location.reload();}).catch(function(){}); } }';
    html += 'function setRights(id, field, val) { fetch("/api/warehouse/florist/rights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", chatId: id, field: field, val: val }) }).catch(function(){}); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 40. API ПРАВ ФЛОРИСТОВ ======
  app.post('/api/warehouse/florist/pin', async (req, res) => {
    try {
      const cookie = req.headers.cookie || ''; const match = cookie.match(/wh_auth=(\d+)/); const chatId = match ? Number(match[1]) : null;
      const ownerCheck = await pool.query('SELECT role FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]);
      if (!ownerCheck.rows[0] || ownerCheck.rows[0].role !== 'owner') return res.status(403).json({ ok: false });
      await pool.query('UPDATE admins SET warehouse_pin = $1 WHERE shop_id = $2 AND chat_id = $3', [req.body.pin, req.body.shop, req.body.chatId]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/florist/rights', async (req, res) => {
    try {
      const cookie = req.headers.cookie || ''; const match = cookie.match(/wh_auth=(\d+)/); const chatId = match ? Number(match[1]) : null;
      const ownerCheck = await pool.query('SELECT role FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]);
      if (!ownerCheck.rows[0] || ownerCheck.rows[0].role !== 'owner') return res.status(403).json({ ok: false });
      var col = 'can_receipt'; if (req.body.field === 'sale') col = 'can_sale'; if (req.body.field === 'writeoff') col = 'can_writeoff';
      await pool.query('UPDATE admins SET ' + col + ' = $1 WHERE shop_id = $2 AND chat_id = $3', [req.body.val, req.body.shop, req.body.chatId]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 41. API НАСТРОЕК ======
  app.get('/api/warehouse/settings', async (req, res) => {
    try {
      const r = await pool.query('SELECT settings FROM shops WHERE shop_id = $1', [req.query.shop || 'kupidon']);
      if (r.rows.length === 0) return res.json({ ok: true, settings: {} });
      res.json({ ok: true, settings: r.rows[0].settings || {} });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/settings', async (req, res) => {
    try {
      var obj = {}; obj[req.body.key] = req.body.val;
      await pool.query('UPDATE shops SET settings = COALESCE(settings, \'{}\'::jsonb) || $1::jsonb WHERE shop_id = $2', [JSON.stringify(obj), req.body.shop || 'kupidon']);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ====== 42. ЭКРАН НАСТРОЕК ======
  app.get('/warehouse/settings', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>body { font-family: "Manrope", sans-serif; margin: 0; padding: 15px; background: ' + bgGradient + '; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; } .card { background: #fff; border-radius: 16px; padding: 20px; margin-bottom: 15px; box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
    html += '.row { display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; } input[type="checkbox"] { transform: scale(1.3); accent-color: ' + brandColor + '; } input[type="radio"] { transform: scale(1.3); accent-color: ' + brandColor + '; margin-right: 10px; } label { display: flex; align-items: center; margin-top: 10px; } .btn-save { background: ' + brandColor + '; color: #fff; border: none; padding: 10px 15px; border-radius: 8px; font-weight: 600; font-family: inherit; margin-top: 10px; }';
    html += '</style></head><body><div class="header"><a href="/warehouse-app" class="back">←</a><h2 style="margin:0; display:flex; align-items:center;">' + getIconSvg('settings') + 'Настройки</h2></div>';
    html += '<div class="card"><h3 style="margin-top:0;">Уведомления</h3><div id="notifs"></div></div><div class="card"><h3 style="margin-top:0;">Отображение</h3><div id="views"></div></div>';
    html += '<div class="card"><h3 style="margin-top:0;">Списания</h3><label style="font-size:13px; font-weight:600; color:#666;">Порог уведомления (₽)</label><input type="number" id="writeoffThreshold" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-top:5px; box-sizing:border-box; font-family:inherit;" placeholder="1000"><button class="btn-save" onclick="saveThreshold()">Сохранить</button></div>';

    html += '<script>';
    html += 'var shopSettings = {}; fetch("/api/warehouse/settings?shop=kupidon").then(function(r){return r.json();}).then(function(d){ if (!d.ok) return; var s = d.settings; shopSettings = s;';
    html += '  var nOpts = [{k:"notif_discount",t:"Уведомлять о скидках"},{k:"notif_cancel",t:"Уведомлять об отмене"},{k:"notif_writeoff",t:"Уведомлять о списаниях"}]; var nb = document.getElementById("notifs");';
    html += '  nOpts.forEach(function(o){ var r = document.createElement("div"); r.className = "row"; r.innerHTML = "<span>" + o.t + "</span>"; var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = s[o.k] !== false; cb.onchange = function(){saveSet(o.k, cb.checked);}; r.appendChild(cb); nb.appendChild(r); });';
    html += '  var vOpts = [{v:"all",t:"Все товары (включая нулевые)"},{v:"nonzero",t:"Только ненулевые"},{v:"pos",t:"Только в наличии"}]; var currentV = s.inv_view || "pos"; var vb = document.getElementById("views");';
    html += '  vOpts.forEach(function(o){ var lb = document.createElement("label"); var rb = document.createElement("input"); rb.type = "radio"; rb.name = "inv_view"; rb.value = o.v; rb.checked = (currentV === o.v); rb.onchange = function(){saveSet("inv_view", o.v);}; lb.appendChild(rb); lb.appendChild(document.createTextNode(o.t)); vb.appendChild(lb); });';
    html += '  document.getElementById("writeoffThreshold").value = s.writeoff_threshold || "";';
    html += '}).catch(function(){});';
    html += 'function saveSet(k, v) { fetch("/api/warehouse/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", key: k, val: v }) }).catch(function(){}); }';
    html += 'function saveThreshold() { var v = document.getElementById("writeoffThreshold").value; saveSet("writeoff_threshold", v); showAlert("Успех", "Настройка сохранена", true); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 43. API ИСТОРИИ ======
  app.get('/api/warehouse/history', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const targetDate = req.query.date || new Date().toISOString().slice(0, 10);
      
      const sales = await pool.query(
        'SELECT s.id, s.real_price as amount, s.date, \'sale\' as type, a.name as person, STRING_AGG(COALESCE(shi.custom_name, i.name) || \' x\' || si.qty::text, \', \') as items FROM wh_sales s LEFT JOIN admins a ON a.chat_id = s.chat_id LEFT JOIN wh_sale_items si ON si.sale_id = s.id LEFT JOIN wh_shop_items shi ON shi.id = si.shop_item_id LEFT JOIN wh_items i ON i.id = shi.item_id WHERE s.shop_id = $1 AND DATE(s.date) = $2 GROUP BY s.id, a.name ORDER BY s.date DESC', [shopId, targetDate]
      );
      const writeoffs = await pool.query(
        'SELECT w.id, w.qty as amount, w.date, \'writeoff\' as type, a.name as person, COALESCE(shi.custom_name, i.name) as items, w.reason FROM wh_writeoffs w LEFT JOIN admins a ON a.chat_id = w.chat_id LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id LEFT JOIN wh_items i ON i.id = shi.item_id WHERE w.shop_id = $1 AND DATE(w.date) = $2 ORDER BY w.date DESC', [shopId, targetDate]
      );
      const receipts = await pool.query(
        'SELECT r.id, r.total_sum as amount, r.date, \'receipt\' as type, a.name as person, STRING_AGG(COALESCE(shi.custom_name, i.name) || \' x\' || ri.qty::text, \', \') as items FROM wh_receipts r LEFT JOIN admins a ON a.chat_id = r.chat_id LEFT JOIN wh_receipt_items ri ON ri.receipt_id = r.id LEFT JOIN wh_shop_items shi ON shi.id = ri.shop_item_id LEFT JOIN wh_items i ON i.id = shi.item_id WHERE r.shop_id = $1 AND DATE(r.date) = $2 AND r.status = \'completed\' GROUP BY r.id, a.name ORDER BY r.date DESC', [shopId, targetDate]
      );
      
      let list = [...sales.rows, ...writeoffs.rows, ...receipts.rows];
      list.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
      res.json({ ok: true, history: list, date: targetDate });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ====== 44. ЭКРАН ИСТОРИИ ======
  app.get('/warehouse/history', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>body { font-family: "Manrope", sans-serif; margin: 0; padding: 15px; background: ' + bgGradient + '; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; } .calendar { display: flex; overflow-x: auto; gap: 10px; margin-bottom: 15px; } .day-btn { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 10px; text-align: center; min-width: 60px; text-decoration: none; color: ' + brandColor + '; font-weight: 600; }';
    html += '.day-btn.active { background: ' + brandColor + '; color: #fff; } .item { background: #fff; border-radius: 12px; padding: 15px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; cursor: pointer; box-shadow: 0 4px 15px rgba(15,61,62,0.05); } .item.sale { border-left: 4px solid #3C7A89; } .item.writeoff { border-left: 4px solid ' + accentColor + '; } .item.receipt { border-left: 4px solid ' + successColor + '; }';
    html += '.date { font-size: 11px; color: #888; margin-top: 5px; } .amount { font-weight: 800; font-size: 16px; text-align: right; } .items-list { font-size: 13px; color: #555; margin-top: 4px; font-style: italic; } .btn-cancel { background: #fff; border: 1px solid ' + dangerColor + '; color: ' + dangerColor + '; border-radius: 6px; padding: 5px 10px; font-size: 12px; margin-top: 5px; font-weight: 600; }';
    html += '</style></head><body><div class="header"><a href="/warehouse-app" class="back">←</a><h2 style="margin:0; display:flex; align-items:center;">' + getIconSvg('history') + 'История</h2></div><div class="calendar" id="calendar"></div><div id="list">Загрузка...</div>';

    html += '<script>';
    html += 'var selectedDate = new URLSearchParams(window.location.search).get("date") || new Date().toISOString().slice(0, 10);';
    html += 'function renderCalendar() { var cal = document.getElementById("calendar"); var today = new Date(); var daysRu = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]; for (var i = 0; i < 7; i++) { var d = new Date(today); d.setDate(today.getDate() - i); var dStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); var a = document.createElement("a"); a.href = "/warehouse/history?date=" + dStr; a.className = "day-btn"; if (dStr === selectedDate) a.classList.add("active"); var label = i === 0 ? "Сегодня" : daysRu[d.getDay()]; a.innerHTML = "<div style=\'font-size:10px;\'>" + label + "</div><div style=\'font-size:18px;font-weight:800;\'>" + d.getDate() + "</div>"; cal.appendChild(a); } }';
    html += 'renderCalendar();';
    html += 'fetch("/api/warehouse/history?shop=kupidon&date=" + selectedDate).then(function(r){return r.json();}).then(function(d){';
    html += '  var b = document.getElementById("list"); b.innerHTML = ""; if (!d.ok || d.history.length === 0) { b.textContent = "За этот день операций нет"; return; }';
    html += '  d.history.forEach(function(h){ var div = document.createElement("div"); var ds = new Date(h.date).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" }); var seller = h.person || "Флорист";';
    html += '    if (h.type === "sale") { div.className = "item sale"; var saleId = parseInt(h.id) || 0; div.onclick = function() { window.location.href = "/warehouse/sale/details?id=" + saleId; }; div.innerHTML = "<div><b>💰 Продажа</b> (" + seller + ")<div class=\'date\'>" + ds + "</div><div class=\'items-list\'>" + (h.items || "") + "</div></div>";';
    html += '      var btnR = document.createElement("button"); btnR.className = "btn-cancel"; btnR.innerText = "Возврат"; btnR.onclick = function(e){e.stopPropagation(); doCancel(saleId, "return");};';
    html += '      var btnL = document.createElement("button"); btnL.className = "btn-cancel"; btnL.style.marginLeft = "5px"; btnL.innerText = "В потери"; btnL.onclick = function(e){e.stopPropagation(); doCancel(saleId, "loss");};';
    html += '      var rightDiv = document.createElement("div"); rightDiv.innerHTML = "<div class=\'amount\'>+" + parseFloat(h.amount).toLocaleString("ru-RU") + " ₽</div>";';
    html += '      var btnWrap = document.createElement("div"); btnWrap.appendChild(btnR); btnWrap.appendChild(btnL); rightDiv.appendChild(btnWrap); div.appendChild(rightDiv);';
    html += '    } else if (h.type === "receipt") { div.className = "item receipt"; var docId = parseInt(h.id) || 0; div.onclick = function() { window.location.href = "/warehouse/documents/details?id=" + docId + "&type=receipts"; }; div.innerHTML = "<div><b>📥 Приход</b> (" + seller + ")<div class=\'date\'>" + ds + "</div><div class=\'items-list\'>" + (h.items || "") + "</div></div>"; div.innerHTML += "<div class=\'amount\' style=\'color:" + successColor + ";\'>+" + parseFloat(h.amount).toLocaleString("ru-RU") + " ₽</div>";';
    html += '    } else { div.className = "item writeoff"; var docId = parseInt(h.id) || 0; div.onclick = function() { window.location.href = "/warehouse/documents/details?id=" + docId + "&type=writeoffs"; }; div.innerHTML = "<div><b>🗑 Списание</b> (" + seller + ")<div class=\'date\'>" + ds + "</div><div class=\'items-list\'>" + (h.items || "") + " (" + h.reason + ")</div></div>"; div.innerHTML += "<div class=\'amount\' style=\'color:" + accentColor + "\'>-" + parseFloat(h.amount) + " шт</div>"; }';
    html += '    b.appendChild(div); });';
    html += '}).catch(function(){ document.getElementById("list").textContent = "Ошибка загрузки"; });';
    
    html += 'function doCancel(id, action) { var msg = action === "return" ? "Вернуть товары на склад?" : "Списать эти товары в потери?";';
    html += '  showConfirm("Отмена продажи", msg, function() { fetch("/api/warehouse/sale/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId: "kupidon", saleId: id, action: action }) }).then(function(r){return r.json();}).then(function(d){ if(d.ok){ showAlert("Успех", "Продажа отменена", true); setTimeout(function(){location.reload();}, 1000); } else showAlert("Ошибка", d.error, false); }).catch(function(){}); }, true); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 45. API ОТМЕНЫ ПРОДАЖИ ======
  app.post('/api/warehouse/sale/cancel', async (req, res) => {
    const client = await pool.connect();
    try {
      const shopId = req.body.shopId; const saleId = parseInt(req.body.saleId); const action = req.body.action;
      if (!saleId || isNaN(saleId)) { client.release(); return res.json({ ok: false, error: 'Неверный ID' }); }
      await client.query('BEGIN');
      const itemsRes = await client.query('SELECT shop_item_id, qty FROM wh_sale_items WHERE sale_id = $1', [saleId]);
      for (let i = 0; i < itemsRes.rows.length; i++) {
        const item = itemsRes.rows[i];
        if (action === 'return') { await client.query('UPDATE wh_shop_items SET current_stock = current_stock + $1 WHERE id = $2', [item.qty, item.shop_item_id]); }
        else { await client.query('INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, reason, comment, date) VALUES ($1, $2, $3, $4, $5, NOW())', [shopId, item.shop_item_id, item.qty, 'loss', 'Отмена продажи']); }
      }
      await client.query('DELETE FROM wh_sale_items WHERE sale_id = $1', [saleId]);
      await client.query('DELETE FROM wh_sales WHERE id = $1', [saleId]);
      await client.query('COMMIT');
      client.release();
      await logAction(shopId, null, 'cancel', 'Возврат/списание продажи ID: ' + saleId, saleId);
      await notifyOwner(bot, shopId, '⚠️ Отмена продажи ID: ' + saleId, 'cancel');
      res.json({ ok: true });
    } catch (e) { try { await client.query('ROLLBACK'); } catch (e2) {} client.release(); res.status(500).json({ ok: false, error: e.message }); }
  });

  // ====== 46. API ДЕТАЛЕЙ ПРОДАЖИ ======
  app.get('/api/warehouse/sale/details', async (req, res) => {
    try {
      const saleId = parseInt(req.query.id); if (!saleId || isNaN(saleId)) return res.json({ ok: false, error: 'Неверный ID' });
      const sale = await pool.query('SELECT s.id, s.real_price, s.date, a.name as seller FROM wh_sales s LEFT JOIN admins a ON a.chat_id = s.chat_id WHERE s.id = $1', [saleId]);
      if (sale.rows.length === 0) return res.json({ ok: false, error: 'Не найдено' });
      const items = await pool.query('SELECT si.qty, si.cost_at_sale, COALESCE(shi.custom_name, i.name) as name, shi.id as shop_item_id FROM wh_sale_items si JOIN wh_shop_items shi ON shi.id = si.shop_item_id JOIN wh_items i ON i.id = shi.item_id WHERE si.sale_id = $1', [saleId]);
      res.json({ ok: true, sale: sale.rows[0], items: items.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 47. ЭКРАН ДЕТАЛЕЙ ПРОДАЖИ ======
  app.get('/warehouse/sale/details', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>body { font-family: "Manrope", sans-serif; margin: 0; padding: 15px; background: ' + bgGradient + '; color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; margin-bottom: 15px; } .back { font-size: 24px; text-decoration: none; color: ' + brandColor + '; margin-right: 15px; } .card { background: #fff; border-radius: 16px; padding: 20px; margin-bottom: 15px; box-shadow: 0 4px 15px rgba(15,61,62,0.05); }';
    html += '.total { font-size: 28px; font-weight: 800; color: ' + successColor + '; margin-bottom: 10px; } .meta { font-size: 13px; color: #666; margin-bottom: 20px; } .item-row { display: flex; justify-content: space-between; padding: 15px 0; border-bottom: 1px solid #eee; text-decoration: none; color: ' + brandColor + '; } .item-row:last-child { border-bottom: none; } .item-name { font-weight: 600; font-size: 16px; } .item-qty { color: ' + dangerColor + '; font-weight: 800; }</style></head><body>';
    html += '<div class="header"><a href="/warehouse/history" class="back">←</a><h2 style="margin:0;">🧾 Чек</h2></div><div class="card" id="content">Загрузка...</div>';

    html += '<script>';
    html += 'var saleId = parseInt(new URLSearchParams(window.location.search).get("id")) || 0;';
    html += 'fetch("/api/warehouse/sale/details?id=" + saleId).then(function(r){return r.json();}).then(function(d){';
    html += '  var content = document.getElementById("content"); content.innerHTML = ""; if (!d.ok) { content.textContent = "Ошибка"; return; }';
    html += '  var s = d.sale; var ds = new Date(s.date).toLocaleString("ru-RU");';
    html += '  var tot = document.createElement("div"); tot.className = "total"; tot.textContent = parseFloat(s.real_price).toLocaleString("ru-RU") + " ₽"; content.appendChild(tot);';
    html += '  var meta = document.createElement("div"); meta.className = "meta"; meta.textContent = "Продал: " + (s.seller || "Неизвестно") + " · Дата: " + ds; content.appendChild(meta);';
    html += '  d.items.forEach(function(i){ var a = document.createElement("a"); a.href = "/warehouse/item?id=" + (parseInt(i.shop_item_id)||0); a.className = "item-row"; var left = document.createElement("div"); var n = document.createElement("div"); n.className = "item-name"; n.textContent = i.name; var c = document.createElement("div"); c.style = "font-size:12px;color:#888;"; c.textContent = "Себестоимость: " + parseFloat(i.cost_at_sale) + " ₽/шт"; left.appendChild(n); left.appendChild(c); var right = document.createElement("div"); right.className = "item-qty"; right.textContent = "x" + i.qty; a.appendChild(left); a.appendChild(right); content.appendChild(a); });';
    html += '}).catch(function(){ document.getElementById("content").textContent = "Ошибка загрузки"; });';
    html += '<\/script></body></html>';
    res.send(html);
  });

}

module.exports = { setupWarehouse };