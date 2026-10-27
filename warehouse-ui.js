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

function capWords(str) {
  if (!str) return '';
  return String(str).replace(
    /(^[\p{L}\d])|(\s+[\p{L}\d])/gu,
    function(letter) {
      return letter.toUpperCase();
    }
  );
}

function translateReason(r) {
  var map = { 
    spoilage: 'Порча', 
    loss: 'Потеря', 
    markdown: 'Уценка', 
    sorting: 'Пересорт' 
  };
  return map[r] || r || '';
}

function setupWarehouse(app, bot, s3ctx) {
  s3ctx = s3ctx || {};
  const s3 = s3ctx.s3 || null;
  const s3backup = s3ctx.s3backup || null;
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
      '0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 ' +
      '0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 ' +
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
    if (type === 'cash') return '<svg ' + c +
      '><rect x="2" y="6" width="20" height="12" rx="2"/>' +
      '<circle cx="12" cy="12" r="2"/>' +
      '<path d="M6 12h.01M18 12h.01"/></svg>';
    if (type === 'card') return '<svg ' + c +
      '><rect x="2" y="5" width="20" height="14" rx="2"/>' +
      '<line x1="2" y1="10" x2="22" y2="10"/></svg>';
    if (type === 'qr') return '<svg ' + c +
      '><rect x="3" y="3" width="7" height="7"/>' +
      '<rect x="14" y="3" width="7" height="7"/>' +
      '<rect x="14" y="14" width="7" height="7"/>' +
      '<path d="M3 14h7v7H3z"/></svg>';
    if (type === 'bouquets') return '<svg ' + c +
      '><path d="M12 2v20M17 5l-5 5-5-5M7 19l5-5 5 5"/></svg>';
    return '';
  }

  const uiScript = `
    <style>
      /* Правка 2: Глобальный фикс горизонтального скролла */
      html, body { overflow-x: hidden; width: 100%; }
      
      /* Правка 6: Глобальный Soft UI для всех полей ввода */
      input, select, textarea {
        width: 100%; padding: 15px;
        border: 1px solid transparent;
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 4px 12px rgba(15,61,62,0.06);
        font-family: inherit; font-size: 16px;
        color: ${brandColor};
        font-weight: 600;
        transition: all 0.2s ease;
        box-sizing: border-box;
        margin-bottom: 15px;
        -webkit-appearance: none;
      }
      input:focus, select:focus, textarea:focus {
        outline: none;
        box-shadow: 0 4px 12px rgba(15,61,62,0.12);
        border-color: ${brandColor};
      }
      input::placeholder, textarea::placeholder {
        color: #A0B4B4; font-weight: 400;
      }
      select {
        background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%230F3D3E%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
        background-repeat: no-repeat;
        background-position: right 15px top 50%;
        background-size: 12px auto;
        padding-right: 40px;
      }

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
        
      .input-active {
        border: 2px solid ${brandColor} !important;
        box-shadow: 0 0 8px rgba(15,61,62,0.2) !important;
        background: #fff !important;
      }

      /* Правка 3: Уменьшение кнопок оплаты */
      .pay-btn { padding: 8px 2px; border: 1px solid #ddd;
        border-radius: 10px; background: #fff; cursor: pointer;
        flex: 1; display: flex; align-items: center;
        justify-content: center; gap: 3px; font-weight: 600;
        font-size: 12px; transition: 0.2s; color: #666;
        box-sizing: border-box; }
      .pay-btn svg { width: 16px; height: 16px; margin: 0; }
      .pay-btn.active { background: #E0F2F1;
        border-color: ${brandColor};
        color: ${brandColor}; font-weight: 800; }

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
        while (icon.firstChild) icon.removeChild(icon.firstChild);
        
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
        while (icon.firstChild) icon.removeChild(icon.firstChild);
        
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
      // Правка 9: Переименование в Обзор склада
      html += '<a href="/warehouse/inventory" class="btn">';
      html += getIconSvg('inventory') + 'Обзор склада</a>';
      
      html += '<a href="/warehouse/history" class="btn full">';
      html += getIconSvg('history') + 'История смены</a>';
      html += '</div>';

      if (isOwner) {
        html += '<div class="sidebar-overlay" id="overlay" ';
        html += 'onclick="toggleMenu()"></div>';
        html += '<div class="sidebar" id="sidebar">';
        html += '<h3>Меню</h3>';
        html += '<a href="/warehouse/bouquets" class="menu-item">';
        html += getIconSvg('bouquets') + 'Букеты (Рецепты)</a>';
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
    html += 'text-align: center; letter-spacing: 5px; }';
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
    html += '  }).catch(function() { showAlert("Ошибка сети", ';
    html += '  "Проверьте интернет или отключите VPN", false); });';
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
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 6. ОБЗОР СКЛАДА ======
  app.get('/warehouse/inventory', async (req, res) => {
    try {
      const shopId = 'kupidon';
      
      const statsRes = await pool.query(
        'SELECT ' +
        'COALESCE(SUM(current_stock), 0) as stems, ' +
        'COALESCE(SUM(current_stock * avg_cost), 0) as cost, ' +
        'COALESCE(SUM(current_stock * retail_price), 0) as retail ' +
        'FROM wh_shop_items WHERE shop_id = $1 ' +
        'AND current_stock > 0',
        [shopId]
      );
      const stats = statsRes.rows[0];

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
      
      html += '.stats-bar { display: flex; gap: 10px; margin-bottom: 15px; }';
      html += '.stat-box { flex: 1; background: #fff; padding: 10px; ';
      html += 'border-radius: 12px; text-align: center; ';
      html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
      html += '.stat-val { font-size: 18px; font-weight: 800; ';
      html += 'color: ' + brandColor + '; }';
      html += '.stat-lbl { font-size: 11px; color: #888; ';
      html += 'font-weight: 600; margin-top: 4px; }';

      html += '.search { width: 100%; padding: 15px; border: none; ';
      html += 'border-radius: 12px; margin-bottom: 15px; ';
      html += 'box-sizing: border-box; font-family: inherit; ';
      html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
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
      html += '.cat-btn.noprice-btn { background: #FFF3E0; ';
      html += 'color: ' + accentColor + '; font-weight: 800; }';
      html += '.cat-btn.noprice-btn.active { background: ';
      html += accentColor + '; color: #fff; }';
      
      html += '.controls { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 15px; }';
      html += '.view-toggles { display: flex; gap: 5px; ';
      html += 'background: #e0e0e0; padding: 4px; border-radius: 10px; }';
      html += '.view-btn { border: none; background: none; padding: 6px 10px; ';
      html += 'border-radius: 8px; cursor: pointer; color: #666; ';
      html += 'display: flex; }';
      html += '.view-btn.active { background: #fff; ';
      html += 'box-shadow: 0 2px 5px rgba(0,0,0,0.1); ';
      html += 'color: ' + brandColor + '; }';
      html += '.view-btn svg { width: 20px; height: 20px; }';
      html += '.limit-select { padding: 8px; border-radius: 10px; ';
      html += 'border: none; font-family: inherit; ';
      html += 'font-weight: 600; color: ' + brandColor + '; ';
      html += 'background: #fff; box-shadow: 0 2px 8px rgba(15,61,62,0.05); }';

      html += '.grid-tiles { display: grid; ';
      html += 'grid-template-columns: 1fr 1fr; gap: 10px; }';
      html += '.card-tile { background: #fff; padding: 10px; ';
      html += 'border-radius: 16px; text-align: center; ';
      html += 'text-decoration: none; color: ' + brandColor + '; ';
      html += 'position: relative; ';
      html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
      html += '.card-tile img { width: 100%; height: 80px; ';
      html += 'object-fit: cover; border-radius: 12px; ';
      html += 'margin-bottom: 5px; }';
      html += '.card-tile .ph { height: 80px; border-radius: 12px; ';
      html += 'background: #F0F4F4; display: flex; align-items: center; ';
      html += 'justify-content: center; margin-bottom: 5px; }';
      html += '.card-tile .ph svg { width: 32px; height: 32px; }';
      
      html += '.grid-rows { display: flex; flex-direction: column; gap: 8px; }';
      html += '.card-row { background: #fff; padding: 10px 15px; ';
      html += 'border-radius: 12px; display: flex; align-items: center; ';
      html += 'justify-content: space-between; text-decoration: none; ';
      html += 'color: ' + brandColor + '; ';
      html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
      html += '.card-row .row-left { display: flex; align-items: center; ';
      html += 'gap: 12px; }';
      html += '.card-row img, .card-row .ph { width: 40px; height: 40px; ';
      html += 'border-radius: 8px; object-fit: cover; }';
      html += '.card-row .ph { background: #F0F4F4; display: flex; ';
      html += 'align-items: center; justify-content: center; }';
      html += '.card-row .ph svg { width: 20px; height: 20px; }';
      
      html += '.name { font-size: 13px; font-weight: 600; ';
      html += 'margin-bottom: 2px; }';
      html += '.card-row .name { font-size: 15px; margin-bottom: 0; }';
      html += '.stock { font-size: 12px; font-weight: 800; }';
      html += '.green { color: ' + successColor + '; } ';
      html += '.red { color: ' + dangerColor + '; }';
      html += '.pin-icon { position: absolute; top: 6px; right: 6px; ';
      html += 'color: #E67E22; }';
      html += '.card-row .pin-icon { position: static; ';
      html += 'margin-left: 5px; }';
      html += '.price-warn { font-size: 10px; color: ' + accentColor + '; ';
      html += 'font-weight: 800; margin-top: 2px; }';
      html += '</style></head><body>';

      // Правка 9: Название Обзор склада
      html += '<div class="header">';
      html += '<div style="display:flex; align-items:center;">';
      html += '<a href="/warehouse-app" class="back">←</a>';
      html += '<h2 style="margin:0; display:flex; align-items:center;">';
      html += getIconSvg('inventory') + 'Обзор склада</h2></div></div>';
      
      html += '<div class="stats-bar">';
      html += '<div class="stat-box"><div class="stat-val">';
      html += fmtNum(stats.stems);
      html += '</div><div class="stat-lbl">Стебли</div></div>';
      html += '<div class="stat-box"><div class="stat-val">';
      html += Math.round(stats.cost).toLocaleString('ru-RU') + ' ₽';
      html += '</div><div class="stat-lbl">Закупка</div></div>';
      html += '<div class="stat-box"><div class="stat-val">';
      html += Math.round(stats.retail).toLocaleString('ru-RU') + ' ₽';
      html += '</div><div class="stat-lbl">Розница</div></div>';
      html += '</div>';

      html += '<input type="text" class="search" id="search" ';
      html += 'placeholder="🔍 Поиск..." onkeyup="applyFilters()">';
      
      html += '<div class="controls">';
      html += '  <div class="view-toggles">';
      html += '    <button class="view-btn active" id="btn-view-tile" ';
      html += 'onclick="setViewMode(\'tile\')"><svg viewBox="0 0 24 24" ';
      html += 'fill="none" stroke="currentColor" stroke-width="2">';
      html += '<rect x="3" y="3" width="7" height="7"/>';
      html += '<rect x="14" y="3" width="7" height="7"/>';
      html += '<rect x="14" y="14" width="7" height="7"/>';
      html += '<rect x="3" y="14" width="7" height="7"/></svg></button>';
      html += '    <button class="view-btn" id="btn-view-row" ';
      html += 'onclick="setViewMode(\'row\')"><svg viewBox="0 0 24 24" ';
      html += 'fill="none" stroke="currentColor" stroke-width="2">';
      html += '<line x1="8" y1="6" x2="21" y2="6"/>';
      html += '<line x1="8" y1="12" x2="21" y2="12"/>';
      html += '<line x1="8" y1="18" x2="21" y2="18"/>';
      html += '<line x1="3" y1="6" x2="3.01" y2="6"/>';
      html += '<line x1="3" y1="12" x2="3.01" y2="12"/>';
      html += '<line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>';
      html += '  </div>';
      html += '  <select class="limit-select" id="limitSelect" ';
      html += 'onchange="setLimit(this.value)">';
      html += '    <option value="10">10 шт</option>';
      html += '    <option value="30">30 шт</option>';
      html += '    <option value="50">50 шт</option>';
      html += '    <option value="100">100 шт</option>';
      html += '  </select>';
      html += '</div>';

      html += '<div class="h-scroll" id="catList">';
      html += '<button class="cat-btn active" id="cat-0" ';
      html += 'onclick="setCat(0)">Все</button>';
      html += '<button class="cat-btn noprice-btn" ';
      html += 'id="cat-noprice" onclick="toggleNoPrice()">Без цены</button>';
      html += '</div>';
      
      html += '<div id="itemsContainer"></div>';
      html += '<div id="pagination" style="display:flex; ';
      html += 'justify-content:center; gap:10px; margin-top:20px;"></div>';

      html += '<script>';
      html += 'var allItems = []; var currentCat = 0;';
      html += 'var currentPage = 1; var pageLimit = 10; ';
      html += 'var viewMode = "tile"; var noPriceFilter = false;';
      
      html += 'var svgPh = \'<svg viewBox="0 0 24 24" fill="#A0B4B4">';
      html += '<path d="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22';
      html += 'L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3';
      html += 'C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5';
      html += 'C2,15.5 3.5,17.5 6.5,17.5C7.21,17.5 7.87,17.36 ';
      html += '8.5,17.12C11.24,16.08 13.44,14.57 15,12.5';
      html += 'C15,12.5 15.5,14.5 15.5,16.5C15.5,18.5 14.5,20 ';
      html += '14.5,20C17,20 19.5,17.5 20.5,14.5C21.5,11.5 ';
      html += '21.5,8 21.5,8C21.5,8 19.5,6 17,8Z"/></svg>\';';
      html += 'var pinSvg = \'<svg class="pin-icon" width="18" ';
      html += 'height="18" viewBox="0 0 24 24" fill="currentColor">';
      html += '<path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 ';
      html += '21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 ';
      html += '8.26L12 2Z"/></svg>\';';

      html += 'function fmtNum(n) {';
      html += '  var num = parseFloat(n);';
      html += '  if (isNaN(num)) return "0";';
      html += '  return num % 1 === 0 ? num.toString() : ';
      html += 'num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");';
      html += '}';

      html += 'if (localStorage.getItem("wh_view_mode")) ';
      html += 'viewMode = localStorage.getItem("wh_view_mode");';
      html += 'if (localStorage.getItem("wh_page_limit")) ';
      html += 'pageLimit = parseInt(localStorage.getItem("wh_page_limit"));';
      html += 'document.getElementById("limitSelect").value = pageLimit;';
      html += 'updateViewButtons();';

      html += 'function setViewMode(mode) {';
      html += '  viewMode = mode; ';
      html += 'localStorage.setItem("wh_view_mode", mode); ';
      html += 'updateViewButtons(); render(); }';
      html += 'function updateViewButtons() {';
      html += '  document.getElementById("btn-view-tile")';
      html += '.classList.remove("active");';
      html += '  document.getElementById("btn-view-row")';
      html += '.classList.remove("active");';
      html += '  document.getElementById("btn-view-" + ';
      html += '(viewMode === "tile" ? "tile" : "row"))';
      html += '.classList.add("active");';
      html += '}';
      html += 'function setLimit(val) { ';
      html += 'pageLimit = parseInt(val); ';
      html += 'localStorage.setItem("wh_page_limit", pageLimit); ';
      html += 'currentPage = 1; render(); }';

      html += 'function toggleNoPrice() {';
      html += '  noPriceFilter = !noPriceFilter;';
      html += '  var btn = document.getElementById("cat-noprice");';
      html += '  if (noPriceFilter) {';
      html += '    btn.classList.add("active");';
      html += '    document.querySelectorAll(".cat-btn").forEach(';
      html += '    function(b){ if(b.id !== "cat-noprice") ';
      html += '    b.classList.remove("active"); });';
      html += '  } else {';
      html += '    btn.classList.remove("active");';
      html += '    document.getElementById("cat-" + currentCat)';
      html += '    .classList.add("active");';
      html += '  }';
      html += '  currentPage = 1; applyFilters();';
      html += '}';

      html += 'fetch("/api/warehouse/categories")';
      html += '.then(function(r){return r.json();}).then(function(d){';
      html += '  if (d.ok) { ';
      html += '  var cl = document.getElementById("catList"); ';
      html += '  var npBtn = document.getElementById("cat-noprice");';
      html += '  d.categories.forEach(function(c){ ';
      html += '    var b = document.createElement("button"); ';
      html += '    b.className = "cat-btn"; b.id = "cat-" + c.id; ';
      html += '    b.innerText = c.name; ';
      html += '    b.onclick = function(){setCat(c.id);}; ';
      html += '    cl.insertBefore(b, npBtn); }); }';
      html += '}).catch(function(){});';

      html += 'fetch("/api/warehouse/items?shop=kupidon&t=" + Date.now())';
      html += '.then(function(r){return r.json();}).then(function(d){';
      html += '  if (d.ok) { allItems = d.items; applyFilters(); } ';
      html += '  else { ';
      html += '    var g = document.getElementById("itemsContainer"); ';
      html += '    g.innerHTML = "<div style=\'color:red;text-align:center;\'>"';
      html += ' + "Ошибка API: " + (d.error || "Неизвестно") + "</div>";';
      html += '  }';
      html += '}).catch(function(err){ ';
      html += '  var g = document.getElementById("itemsContainer"); ';
      html += '  g.innerHTML = "<div style=\'color:red;text-align:center;\'>"';
      html += ' + "Ошибка сети: " + err.message + "</div>";';
      html += '});';

      html += 'function setCat(id) { ';
      html += 'noPriceFilter = false; ';
      html += 'document.getElementById("cat-noprice")';
      html += '.classList.remove("active");';
      html += 'currentCat = id; currentPage = 1; ';
      html += 'var els = document.querySelectorAll(".cat-btn"); ';
      html += 'els.forEach(function(el){el.classList.remove("active");}); ';
      html += 'document.getElementById("cat-" + id).classList.add("active"); ';
      html += 'applyFilters(); }';

      html += 'function applyFilters() {';
      html += '  var q = document.getElementById("search")';
      html += '  .value.toLowerCase();';
      html += '  var filtered = allItems.filter(function(i){';
      html += '    var matchQ = i.name.toLowerCase().includes(q);';
      html += '    var matchC = (currentCat === 0 || ';
      html += 'i.category_id === currentCat);';
      html += '    var matchP = !noPriceFilter || ';
      html += '(parseFloat(i.retail_price) === 0);';
      html += '    return matchQ && matchC && matchP;';
      html += '  });';
      html += '  currentPage = 1; render(filtered);';
      html += '}';

      html += 'var filteredItems = [];';

      // Правка 10: Отрисовка в try/catch
      html += 'function render(items) {';
      html += '  if (items) filteredItems = items;';
      html += '  var container = document.getElementById("itemsContainer");';
      html += '  try {';
      html += '    var totalPages = ';
      html += 'Math.ceil(filteredItems.length / pageLimit) || 1;';
      html += '    if (currentPage > totalPages) currentPage = totalPages;';
      html += '    var start = (currentPage - 1) * pageLimit;';
      html += '    var end = start + pageLimit;';
      html += '    var pageItems = filteredItems.slice(start, end);';
      html += '    container.className = ';
      html += 'viewMode === "tile" ? "grid-tiles" : "grid-rows";';
      html += '    while (container.firstChild) ';
      html += '    container.removeChild(container.firstChild);';
      
      html += '    if (pageItems.length === 0) { ';
      html += '      var empty = document.createElement("div"); ';
      html += '      empty.style = "text-align:center;padding:30px;color:#888;";';
      html += '      empty.innerText = "Ничего не найдено"; ';
      html += '      container.appendChild(empty); }';
      
      html += '    pageItems.forEach(function(i) {';
      html += '      var a = document.createElement("a");';
      html += '      a.href = "/warehouse/item?id=" + i.id;';
      html += '      var cl = parseFloat(i.current_stock) > 0 ? ';
      html += '      "green" : "red";';
      html += '      var unit = i.unit || "шт";';
      html += '      var hasPrice = parseFloat(i.retail_price) > 0;';
      
      html += '      if (viewMode === "tile") {';
      html += '        a.className = "card-tile";';
      html += '        if (i.photo_url) { ';
      html += '          var img = document.createElement("img"); ';
      html += '          img.src = i.photo_url; a.appendChild(img); } ';
      html += '        else { ';
      html += '          var ph = document.createElement("div"); ';
      html += '          ph.className = "ph"; ph.innerHTML = svgPh; ';
      html += '          a.appendChild(ph); }';
      
      html += '        if (i.is_pinned) { ';
      html += '          var pin = document.createElement("div"); ';
      html += '          pin.innerHTML = pinSvg; a.appendChild(pin); }';
      
      html += '        var nm = document.createElement("div"); ';
      html += '        nm.className = "name"; nm.textContent = i.name; ';
      html += '        a.appendChild(nm);';
      
      html += '        var st = document.createElement("div"); ';
      html += '        st.className = "stock " + cl; ';
      html += '        st.textContent = fmtNum(i.current_stock) + ';
      html += '        " " + unit; ';
      html += '        a.appendChild(st);';
      
      html += '        if (!hasPrice) { ';
      html += '          var pw = document.createElement("div"); ';
      html += '          pw.className = "price-warn"; ';
      html += '          pw.textContent = "Нет цены"; a.appendChild(pw); }';
      
      html += '      } else {';
      html += '        a.className = "card-row";';
      html += '        var left = document.createElement("div"); ';
      html += '        left.className = "row-left";';
      
      html += '        if (i.photo_url) { ';
      html += '          var img = document.createElement("img"); ';
      html += '          img.src = i.photo_url; left.appendChild(img); } ';
      html += '        else { ';
      html += '          var ph = document.createElement("div"); ';
      html += '          ph.className = "ph"; ph.innerHTML = svgPh; ';
      html += '          left.appendChild(ph); }';
      
      html += '        var nmWrap = document.createElement("div");';
      html += '        var nm = document.createElement("div"); ';
      html += '        nm.className = "name"; nm.textContent = i.name; ';
      html += '        nmWrap.appendChild(nm);';
      
      html += '        if (!hasPrice) { ';
      html += '          var pw = document.createElement("div"); ';
      html += '          pw.className = "price-warn"; ';
      html += '          pw.textContent = "Нет цены"; nmWrap.appendChild(pw); }';
      
      html += '        if (i.is_pinned) { ';
      html += '          var pin = document.createElement("span"); ';
      html += '          pin.innerHTML = pinSvg; nmWrap.appendChild(pin); }';
      html += '        left.appendChild(nmWrap); a.appendChild(left);';
      
      html += '        var st = document.createElement("div"); ';
      html += '        st.className = "stock " + cl; ';
      html += '        st.textContent = fmtNum(i.current_stock) + ';
      html += '        " " + unit; ';
      html += '        a.appendChild(st);';
      html += '      }';
      html += '      container.appendChild(a);';
      html += '    });';

      html += '    var pag = document.getElementById("pagination"); ';
      html += '    while (pag.firstChild) pag.removeChild(pag.firstChild);';
      html += '    if (totalPages > 1) {';
      html += '      var prevBtn = document.createElement("button"); ';
      html += '      prevBtn.className = "cat-btn"; ';
      html += '      prevBtn.innerText = "←"; ';
      html += '      prevBtn.disabled = currentPage === 1; ';
      html += '      prevBtn.onclick = function(){ currentPage--; ';
      html += '      render(); window.scrollTo(0,0); }; ';
      html += '      if(currentPage === 1) prevBtn.style.opacity = "0.3";';
      
      html += '      var nextBtn = document.createElement("button"); ';
      html += '      nextBtn.className = "cat-btn"; ';
      html += '      nextBtn.innerText = "→"; ';
      html += '      nextBtn.disabled = currentPage === totalPages; ';
      html += '      nextBtn.onclick = function(){ currentPage++; ';
      html += '      render(); window.scrollTo(0,0); }; ';
      html += '      if(currentPage === totalPages) ';
      html += '      nextBtn.style.opacity = "0.3";';
      
      html += '      var txt = document.createElement("span"); ';
      html += '      txt.style = "display:flex; align-items:center; ';
      html += '      font-weight:600; font-size:14px;"; ';
      html += '      txt.innerText = currentPage + " / " + totalPages;';
      
      html += '      pag.appendChild(prevBtn); pag.appendChild(txt); ';
      html += '      pag.appendChild(nextBtn);';
      html += '    }';
      html += '  } catch (err) {';
      html += '    var errDiv = document.createElement("div");';
      html += '    errDiv.style = "color:red;text-align:center;padding:20px;";';
      html += '    errDiv.textContent = "Ошибка отрисовки: " + err.message;';
      html += '    container.appendChild(errDiv);';
      html += '  }';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) {
      console.error('Inventory error:', e.message);
      res.status(500).send('Ошибка сервера');
    }
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
        'i.retail_price, ' +
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

  // ====== 8. API УСТАНОВКИ РОЗНИЧНОЙ ЦЕНЫ ======
  app.post('/api/warehouse/item/set-price', async (req, res) => {
    try {
      const itemId = parseInt(req.body.id);
      const price = parseFloat(req.body.price);
      if (!itemId || isNaN(itemId) || isNaN(price) || price <= 0) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }
      await pool.query(
        'UPDATE wh_shop_items SET retail_price = $1 WHERE id = $2',
        [price, itemId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 9. API ПЕРЕИМЕНОВАНИЯ ======
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

  // ====== 10. API ЗАКРЕПЛЕНИЯ ======
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

  // ====== 11. API ОБЪЕДИНЕНИЯ ======
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

  // ====== 12. API УСТАНОВКИ ФОТО ======
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

  // ====== 13. КАРТОЧКА ТОВАРА (ВЫПИСКА) ======
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
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); ';
    html += 'text-decoration: none; color: ' + brandColor + '; ';
    html += 'border-left: 5px solid transparent; transition: 0.2s; }';
    html += '.history-card:active { transform: scale(0.98); }';
    html += '.history-card.sale { border-left-color: #3C7A89; }';
    html += '.history-card.receipt { border-left-color: ' + successColor + '; }';
    html += '.history-card.writeoff { border-left-color: ' + dangerColor + '; }';
    
    html += '.h-left { display: flex; flex-direction: column; gap: 4px; }';
    html += '.h-title { font-weight: 700; font-size: 15px; display: flex; ';
    html += 'align-items: center; gap: 6px; }';
    html += '.h-meta { font-size: 12px; color: #888; }';
    html += '.h-badge { font-size: 11px; padding: 2px 8px; ';
    html += 'border-radius: 10px; font-weight: 700; display: inline-block; }';
    html += '.badge-sale { background: #E3F2FD; color: #3C7A89; }';
    html += '.badge-receipt { background: #E8F5E9; color: ' + successColor + '; }';
    html += '.badge-writeoff { background: #FFEBEE; color: ' + dangerColor + '; }';
    
    html += '.h-right { text-align: right; display: flex; ';
    html += 'flex-direction: column; align-items: flex-end; gap: 4px; }';
    html += '.h-amount { font-weight: 800; font-size: 16px; }';
    html += '.h-stock { font-size: 11px; color: #aaa; font-weight: 600; }';
    
    html += '.actions { display: flex; gap: 8px; margin-top: 15px; ';
    html += 'justify-content: center; margin-bottom: 20px; ';
    html += 'flex-wrap: wrap; }';
    html += '.btn-act { padding: 10px 15px; border-radius: 12px; ';
    html += 'border: none; font-weight: 600; color: #fff; font-size: 13px; ';
    html += 'font-family: inherit; cursor: pointer; display: flex; ';
    html += 'align-items: center; gap: 5px; }';
    html += '.btn-act svg { width: 16px; height: 16px; }';
    html += '.btn-rename { background: #E67E22; }';
    html += '.btn-merge { background: ' + dangerColor + '; }';
    html += '.btn-photo { background: #3C7A89; }';
    html += '.btn-pin { background: ' + (brandColor) + '; }';
    html += '.btn-pin.active { background: #E67E22; }';
    html += '.btn-set-price { background: ' + accentColor + '; }';
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
    // Правка 3: Кнопка задать цену
    html += '<button class="btn-act btn-set-price" ';
    html += 'id="btnSetPrice" style="display:none;" ';
    html += 'onclick="setRetailPrice()">Задать цену</button>';
    html += '<button class="btn-act btn-pin" id="btnPin" ';
    html += 'onclick="togglePin()"><svg viewBox="0 0 24 24" fill="none" ';
    html += 'stroke="currentColor" stroke-width="2">';
    html += '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 ';
    html += '18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 ';
    html += '8.91 8.26 12 2"></polygon></svg> Закрепить</button>';
    html += '<button class="btn-act btn-rename" onclick="renameItem()">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ';
    html += 'stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 ';
    html += '20.5 2 22l1.5-5.5L17 3z"></path></svg> Имя</button>';
    html += '<button class="btn-act btn-merge" onclick="mergeItem()">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ';
    html += 'stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 ';
    html += '0 0 0-7.07-7.07l-1.72 1.71"></path>';
    html += '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 ';
    html += '7.07 7.07l1.71-1.71"></path></svg> Объединить</button>';
    html += '<button class="btn-act btn-photo" ';
    html += 'onclick="document.getElementById(\'photoInput\').click()">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ';
    html += 'stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 ';
    html += '1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z">';
    html += '</path><circle cx="12" cy="13" r="4"></circle></svg> Фото';
    html += '</button>';
    html += '</div>';

    html += '<div id="list">Загрузка...</div>';

    html += '<script>';
    html += 'var urlParams = new URLSearchParams(window.location.search);';
    html += 'var itemId = parseInt(urlParams.get("id")) || 0;';
    html += 'var itemName = ""; var itemUnit = "шт"; var isPinned = false;';
    html += 'var itemPrice = 0;';

    html += 'function fmtNum(n) {';
    html += '  var num = parseFloat(n);';
    html += '  if (isNaN(num)) return "0";';
    html += '  return num % 1 === 0 ? num.toString() : ';
    html += 'num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");';
    html += '}';

    html += 'fetch("/api/warehouse/item/history?id=" + itemId)';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) {';
    html += '  var b = document.getElementById("list"); ';
    html += '  while (b.firstChild) b.removeChild(b.firstChild);';
    html += '  var hi = document.getElementById("header-info");';
    html += '  if (!d.ok) {';
    html += '    hi.innerHTML = "<div style=\'color:red\'>Ошибка: " + ';
    html += '    d.error + "</div>"; return; }';
    html += '  if (d.item) {';
    html += '    itemName = d.item.name;';
    html += '    itemUnit = d.item.unit || "шт";';
    html += '    isPinned = d.item.is_pinned === true;';
    html += '    itemPrice = parseFloat(d.item.retail_price) || 0;';
    
    html += '    document.getElementById("actions").style.display = "flex";';
    html += '    updatePinBtn();';
    html += '    if (itemPrice === 0) { ';
    html += '      document.getElementById("btnSetPrice")';
    html += '      .style.display = "flex"; }';
    
    html += '    var isPos = parseFloat(d.item.current_stock) > 0;';
    html += '    var cl = isPos ? "' + successColor + '" : "';
    html += dangerColor + '";';
    
    html += '    var h2 = document.createElement("h2");';
    html += '    h2.style.margin = "0"; h2.style.fontSize = "24px";';
    html += '    h2.textContent = itemName;';
    html += '    hi.appendChild(h2);';
    
    html += '    var stockDiv = document.createElement("div");';
    html += '    stockDiv.style.fontSize = "20px";';
    html += '    stockDiv.style.fontWeight = "800";';
    html += '    stockDiv.style.color = cl;';
    html += '    stockDiv.style.marginTop = "5px";';
    html += '    stockDiv.textContent = "Остаток: " + ';
    html += '    fmtNum(d.item.current_stock) + " " + itemUnit;';
    html += '    hi.appendChild(stockDiv);';
    html += '  }';
    html += '  if (d.history.length === 0) {';
    html += '    var empty = document.createElement("div"); ';
    html += '    empty.style = "text-align:center; color:#888; ';
    html += '    margin-top:20px;"; empty.innerText = "Нет операций"; ';
    html += '    b.appendChild(empty); return; }';

    html += '  d.history.forEach(function(h) {';
    html += '    var a = document.createElement("a");';
    html += '    var ds = new Date(h.date).toLocaleString("ru-RU", { ';
    html += '    day: "2-digit", month: "2-digit", hour: "2-digit", ';
    html += '    minute: "2-digit" });';
    
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
    html += '    stockFlow.textContent = fmtNum(h.stock_before) + ';
    html += '    " → " + fmtNum(h.stock_after);';

    html += '    if (h.type === "sale") {';
    html += '      a.className = "history-card sale";';
    html += '      a.href = "/warehouse/sale/details?id=" + h.id;';
    html += '      title.innerHTML = "<span class=\'h-badge badge-sale\'>';
    html += '      Продажа</span> №" + h.id;';
    html += '      amt.textContent = "-" + fmtNum(h.qty) + " " + itemUnit;';
    html += '      amt.style.color = "#3C7A89";';
    html += '    } else if (h.type === "writeoff") {';
    html += '      a.className = "history-card writeoff";';
    html += '      a.href = "/warehouse/documents/details?id=" + h.id + ';
    html += '      "&type=writeoffs";';
    html += '      title.innerHTML = "<span class=\'h-badge badge-writeoff\'>';
    html += '      Списание</span> №" + h.id;';
    html += '      meta.textContent += " · " + translateReason(h.reason);';
    html += '      amt.textContent = "-" + fmtNum(h.qty) + " " + itemUnit;';
    html += '      amt.style.color = "' + dangerColor + '";';
    html += '    } else {';
    html += '      a.className = "history-card receipt";';
    html += '      a.href = "/warehouse/documents/details?id=" + h.id + ';
    html += '      "&type=receipts";';
    html += '      title.innerHTML = "<span class=\'h-badge badge-receipt\'>';
    html += '      Приход</span> №" + h.id;';
    html += '      amt.textContent = "+" + fmtNum(h.qty) + " " + itemUnit;';
    html += '      amt.style.color = "' + successColor + '";';
    html += '    }';

    html += '    left.appendChild(title); left.appendChild(meta);';
    html += '    right.appendChild(amt); right.appendChild(stockFlow);';
    html += '    a.appendChild(left); a.appendChild(right);';
    html += '    b.appendChild(a);';
    html += '  });';
    html += '}).catch(function() {';
    html += '  document.getElementById("list").textContent = "Ошибка";';
    html += '});';

    // Правка 3: Логика задать цену
    html += 'function setRetailPrice() {';
    html += '  var p = prompt("Введите розничную цену (₽):");';
    html += '  if (!p) return;';
    html += '  var num = parseFloat(p.replace(",", "."));';
    html += '  if (isNaN(num) || num <= 0) { ';
    html += '    showAlert("Ошибка", "Неверная цена", false); return; }';
    html += '  fetch("/api/warehouse/item/set-price", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ id: itemId, price: num }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { ';
    html += '    if (d.ok) { showAlert("Готово", "Цена установлена", true); ';
    html += '    setTimeout(function() { location.reload(); }, 1000); } ';
    html += '    else showAlert("Ошибка", d.error, false); })';
    html += '  .catch(function() {});';
    html += '}';

    html += 'function togglePin() {';
    html += '  var newVal = !isPinned;';
    html += '  fetch("/api/warehouse/item/pin", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ id: itemId, val: newVal }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { if (d.ok) { isPinned = newVal; ';
    html += '  updatePinBtn(); } })';
    html += '  .catch(function() {});';
    html += '}';
    
    html += 'function updatePinBtn() {';
    html += '  var b = document.getElementById("btnPin");';
    html += '  if (isPinned) { b.classList.add("active"); b.innerHTML = ';
    html += '  "<svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' ';
    html += '  stroke-width=\'2\'><polygon points=\'12 2 15.09 8.26 22 9.27 ';
    html += '  17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 ';
    html += '  8.91 8.26 12 2\'></polygon></svg> Открепить"; }';
    html += '  else { b.classList.remove("active"); b.innerHTML = ';
    html += '  "<svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' ';
    html += '  stroke-width=\'2\'><polygon points=\'12 2 15.09 8.26 22 9.27 ';
    html += '  17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 ';
    html += '  8.91 8.26 12 2\'></polygon></svg> Закрепить"; }';
    html += '}';

    html += 'function renameItem() {';
    html += '  var newName = prompt("Введите новое название:", itemName);';
    html += '  if (!newName || newName === itemName) return;';
    html += '  fetch("/api/warehouse/item/rename", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ id: itemId, name: newName }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) { if (d.ok) { ';
    html += 'showAlert("Готово", "Переименовано", true); ';
    html += 'setTimeout(function() { location.reload(); }, 1000); ';
    html += '} else showAlert("Ошибка", d.error, false); })';
    html += '  .catch(function() { showAlert("Ошибка сети", ';
    html += '  "Проверьте интернет или отключите VPN", false); });';
    html += '}';

    html += 'function mergeItem() {';
    html += '  var targetName = prompt("Название товара, В КОТОРЫЙ ';
    html += '  объединить:");';
    html += '  if (!targetName) return;';
    html += '  showConfirm("Объединение", ';
    html += '  "Вы уверены? Этот товар будет удален, а данные перейдут в \'" + ';
    html += '  targetName + "\'.", ';
    html += '  function() {';
    html += '    fetch("/api/warehouse/item/merge", { method: "POST", ';
    html += '    headers: { "Content-Type": "application/json" }, ';
    html += '    body: JSON.stringify({ source_id: itemId, ';
    html += '    target_name: targetName }) })';
    html += '    .then(function(r) { return r.json(); })';
    html += '    .then(function(d) { if (d.ok) { window.location.href = ';
    html += '    "/warehouse/inventory"; } ';
    html += '    else showAlert("Ошибка", d.error, false); })';
    html += '    .catch(function() { showAlert("Ошибка сети", ';
    html += '    "Проверьте интернет или отключите VPN", false); });';
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
    html += '    else { showAlert("Ошибка", d.error || ';
    html += '    "Сервер не принял фото", false); }';
    html += '  }).catch(function() { showAlert("Ошибка сети", ';
    html += '  "Проверьте интернет или отключите VPN", false); });';
    html += '}';

    html += 'function savePhoto(url) {';
    html += '  fetch("/api/warehouse/item/set-photo", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ id: itemId, url: url }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) {';
    html += '    if (d.ok) { showAlert("Готово", "Фото обновлено", true); ';
    html += '    setTimeout(function() { location.reload(); }, 1000); }';
    html += '    else showAlert("Ошибка базы", d.error, false);';
    html += '  }).catch(function() { showAlert("Ошибка", ';
    html += '  "Сбой при сохранении", false); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 14. API ЖУРНАЛА ======
  app.get('/api/warehouse/audit', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const period = req.query.period || 'today';
      const targetDate = req.query.date;
      
      let dateFilter = '';
      let params = [shopId];

      if (targetDate) {
        dateFilter = 'AND DATE(l.date) = $2';
        params.push(targetDate);
      } else if (period === 'today') {
        dateFilter = 'AND DATE(l.date) = CURRENT_DATE';
      } else if (period === 'week') {
        dateFilter = 'AND l.date >= NOW() - INTERVAL \'7 days\'';
      } else if (period === 'month') {
        dateFilter = 'AND l.date >= NOW() - INTERVAL \'1 month\'';
      }

      const r = await pool.query(
        'SELECT l.action, l.details, l.date, l.ref_id, ' +
        'a.name as person ' +
        'FROM wh_audit_log l ' +
        'LEFT JOIN admins a ON a.chat_id = l.chat_id ' +
        'WHERE l.shop_id = $1 ' + dateFilter + ' ' +
        'ORDER BY l.date DESC LIMIT 100',
        params
      );
      res.json({ ok: true, logs: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 15. ЭКРАН ЖУРНАЛА ======
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

    // Правка 7: Выбор конкретной даты
    html += '.date-row { display: flex; margin-bottom: 15px; }';
    html += '.date-row input { width: 100%; padding: 10px; margin: 0; }';

    html += '.log-card { background: #fff; border-radius: 16px; ';
    html += 'padding: 15px; margin-bottom: 10px; ';
    html += 'cursor: pointer; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); ';
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
    html += '<div class="filter active" id="f-today" ';
    html += 'onclick="setPeriod(\'today\')">Сегодня</div>';
    html += '<div class="filter" id="f-week" ';
    html += 'onclick="setPeriod(\'week\')">Неделя</div>';
    html += '<div class="filter" id="f-month" ';
    html += 'onclick="setPeriod(\'month\')">Месяц</div>';
    html += '</div>';

    // Правка 7: Поле ввода даты
    html += '<div class="date-row">';
    html += '<input type="date" id="auditDate" ';
    html += 'onchange="setCustomDate(this.value)">';
    html += '</div>';

    html += '<div id="list">Загрузка...</div>';

    html += '<script>';
    html += 'var currentPeriod = "today"; var currentDate = "";';
    
    html += 'function setPeriod(p) {';
    html += '  currentPeriod = p; currentDate = "";';
    html += '  document.getElementById("auditDate").value = "";';
    html += '  document.querySelectorAll(".filter").forEach(function(el){';
    html += '    el.classList.remove("active");});';
    html += '  document.getElementById("f-" + p).classList.add("active");';
    html += '  loadData();';
    html += '}';

    // Правка 7: Установка кастомной даты
    html += 'function setCustomDate(val) {';
    html += '  currentDate = val;';
    html += '  if (val) {';
    html += '    document.querySelectorAll(".filter").forEach(function(el){';
    html += '      el.classList.remove("active");});';
    html += '  } else { setPeriod("today"); }';
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
    html += '  listEl.textContent = "Загрузка...";';
    html += '  var url = "/api/warehouse/audit?shop=kupidon";';
    html += '  if (currentDate) { url += "&date=" + currentDate; }';
    html += '  else { url += "&period=" + currentPeriod; }';
    
    html += '  fetch(url)';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) {';
    html += '    while (listEl.firstChild) ';
    html += '    listEl.removeChild(listEl.firstChild);';
    html += '    if (!d.ok || d.logs.length === 0) {';
    html += '      listEl.textContent = "Журнал пуст"; return; }';

    html += '    d.logs.forEach(function(l) {';
    html += '      var div = document.createElement("div");';
    html += '      var acts = ["sale","receipt","writeoff","shift"];';
    html += '      var actClass = acts.indexOf(l.action) >= 0 ? ';
    html += '      l.action : "";';
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

  // ====== 16. ЭКРАН СМЕНЫ ======
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
      html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
      html += '.btn { width: 100%; padding: 15px; color: #fff; ';
      html += 'border: none; border-radius: 12px; font-size: 16px; ';
      html += 'font-weight: 800; margin-top: 15px; ';
      html += 'font-family: inherit; }';
      html += '.btn-green { background: ' + successColor + '; }';
      html += '.btn-red { background: ' + dangerColor + '; }';
      html += 'input { width: 100%; padding: 15px; font-size: 20px; ';
      html += 'border: none; border-radius: 12px; ';
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
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false);';
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
      html += 'showAlert("Готово", "Смена закрыта", true); ';
      html += '      setTimeout(function() { ';
      html += 'window.location.href = "/warehouse-app"; }, 1500); ';
      html += '    } else showAlert("Ошибка", d.error, false);';
      html += '  })';
      html += '  .catch(function() {';
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false);';
      html += '  });';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) { res.status(500).send(e.message); }
  });
  // ====== 17. API СМЕНЫ ======
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
          return res.json({ ok: false, error: 'Смена уже открыта' });
        }
        const startCash = parseFloat(req.body.val) || 0;
        if (startCash < 0) {
          return res.json({ ok: false, error: 'Некорректная сумма' });
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
          return res.json({ ok: false, error: 'Смена не найдена' });
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
        const total = parseFloat(st.t || 0);

        const expected = parseFloat(shift.start_cash) + cash;
        const actual = parseFloat(req.body.val);
        if (isNaN(actual)) {
          return res.json({ ok: false, error: 'Некорректная сумма' });
        }
        const discrepancy = actual - expected;

        await pool.query(
          'UPDATE wh_shifts SET close_time = NOW(), ' +
          'end_cash_fact = $1, total_sales = $2, cash_sales = $3, ' +
          'card_sales = $4, qr_sales = $5, discrepancy = $6, ' +
          'status = \'closed\' WHERE id = $7',
          [actual, total, cash, parseFloat(st.k || 0), 
           parseFloat(st.q || 0), discrepancy, shift.id]
        );
        await logAction('kupidon', chatId, 'shift',
          'Закрыта смена. Расхождение: ' + discrepancy);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 18. ЭКРАН ПРОДАЖИ (КАССА) ======
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
        errHtml += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
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
      html += 'padding: 15px; background: ';
      html += bgGradient + '; color: ' + brandColor + '; ';
      html += 'overflow-x: hidden; width: 100%; }'; // Правка 2
      html += '.header { display: flex; align-items: center; ';
      html += 'margin-bottom: 15px; justify-content: space-between; }';
      html += '.header-left { display: flex; align-items: center; }';
      html += '.back { font-size: 24px; text-decoration: none; ';
      html += 'color: ' + brandColor + '; margin-right: 15px; }';
      html += '.burger { font-size: 24px; background: none; ';
      html += 'border: none; color: ' + brandColor + '; ';
      html += 'cursor: pointer; padding: 0; }';

      // Правка 10: Кнопка очистки поиска
      html += '.search-wrapper { position: relative; ';
      html += 'margin-bottom: 15px; }';
      html += '.search { width: 100%; padding: 15px; border: none; ';
      html += 'border-radius: 12px; box-sizing: border-box; ';
      html += 'font-family: inherit; font-size: 16px; ';
      html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
      html += '.clear-search { position: absolute; right: 15px; ';
      html += 'top: 50%; transform: translateY(-50%); ';
      html += 'font-size: 20px; color: #aaa; cursor: pointer; ';
      html += 'display: none; background: none; border: none; padding: 0; }';
      
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

      // Правка 8: Гибкая сетка
      html += '.grid-controls { display: flex; gap: 5px; ';
      html += 'margin-bottom: 15px; justify-content: flex-end; }';
      html += '.grid-btn { background: #fff; border: 1px solid #ddd; ';
      html += 'border-radius: 8px; padding: 4px 8px; font-size: 12px; ';
      html += 'font-weight: 600; color: #666; cursor: pointer; }';
      html += '.grid-btn.active { background: ' + brandColor + '; ';
      html += 'color: #fff; border-color: ' + brandColor + '; }';

      html += '.grid { display: grid; gap: 8px; width: 100%; }';
      html += '.grid-3 { grid-template-columns: repeat(3, 1fr); }';
      html += '.grid-4 { grid-template-columns: repeat(4, 1fr); }';
      html += '.grid-5 { grid-template-columns: repeat(5, 1fr); }';
      html += '.grid-6 { grid-template-columns: repeat(6, 1fr); }';

      html += '.card { background: #fff; padding: 8px; ';
      html += 'border-radius: 12px; text-align: center; ';
      html += 'cursor: pointer; position: relative; ';
      html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
      html += '.card img { width: 100%; height: 60px; ';
      html += 'object-fit: cover; border-radius: 8px; ';
      html += 'margin-bottom: 4px; }';
      html += '.card .ph { height: 60px; border-radius: 8px; ';
      html += 'background: #F0F4F4; display: flex; ';
      html += 'align-items: center; justify-content: center; ';
      html += 'margin-bottom: 4px; }';
      html += '.card .ph svg { width: 24px; height: 24px; }';
      html += '.card .name { font-size: 11px; font-weight: 600; ';
      html += 'margin-bottom: 2px; line-height: 1.2; ';
      html += 'word-break: break-word; }'; // Правка 2
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
      html += 'left: 0; width: 100%; height: 92vh; background: #fafaf8; ';
      html += 'border-radius: 24px 24px 0 0; ';
      html += 'transition: bottom 0.3s ease; z-index: 1001; ';
      html += 'display: flex; flex-direction: column; }';
      html += '.bottom-sheet.open { bottom: 0; }';
      html += '.sheet-header { padding: 10px 15px; display: flex; ';
      html += 'justify-content: space-between; align-items: center; ';
      html += 'flex-shrink: 0; }';
      html += '.sheet-handle { width: 40px; height: 5px; ';
      html += 'background: #ccc; border-radius: 5px; margin: 0 auto; }';
      html += '.close-sheet { background: none; border: none; ';
      html += 'font-size: 24px; color: #888; cursor: pointer; ';
      html += 'padding: 0; line-height: 1; }';
      
      html += '.sheet-body { display: flex; flex-direction: row; ';
      html += 'flex: 1; overflow: hidden; }';
      html += '.sheet-content { flex: 1.2; padding: 0 10px; ';
      html += 'overflow-y: auto; border-right: 1px solid #eee; }';
      html += '.calc-panel { flex: 1; padding: 10px; overflow-y: auto; ';
      html += 'background: #fafaf8; min-width: 170px; }';

      html += '.b-row { display: grid; ';
      html += 'grid-template-columns: 1fr 90px 20px; gap: 4px; ';
      html += 'align-items: center; margin-bottom: 6px; ';
      html += 'font-size: 12px; background: #fff; padding: 8px; ';
      html += 'border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); }';
      html += '.qty-btn { background: #F0F4F4; border: none; ';
      html += 'width: 28px; height: 28px; border-radius: 8px; ';
      html += 'font-weight: bold; font-size: 14px; color: ' + brandColor + '; ';
      html += 'display: flex; align-items: center; justify-content: center; }';
      html += '.qty-input { width: 32px; height: 28px; text-align: center; ';
      html += 'font-size: 14px; font-weight: bold; ';
      html += 'border: 1px solid #ddd; border-radius: 8px; padding: 0; }';

      // Правка 3: Кнопки оплаты
      html += '.pay-input-row { display: flex; gap: 5px; ';
      html += 'margin-top: 10px; }';
      
      html += '.pay-input-row input { font-size: 18px; ';
      html += 'font-weight: 800; text-align: right; flex: 1; ';
      html += 'padding: 10px; border: 1px solid #ddd; ';
      html += 'border-radius: 10px; box-sizing: border-box; ';
      html += 'width: 100%; background: #fff; }';
      
      html += '.pay-input-row button { background: ' + brandColor + '; ';
      html += 'color: #fff; border: none; border-radius: 10px; ';
      html += 'padding: 0 10px; font-size: 14px; font-weight: bold; ';
      html += 'white-space: nowrap; flex-shrink: 0; }';

      html += '.numpad { display: grid; ';
      html += 'grid-template-columns: 1fr 1fr 1fr; gap: 4px; ';
      html += 'margin-top: 5px; }';
      html += '.numpad button { padding: 8px; font-size: 14px; ';
      html += 'border: none; background: #fff; border-radius: 8px; ';
      html += 'font-family: inherit; font-weight: 600; color: ' + brandColor + '; ';
      html += 'box-shadow: 0 2px 4px rgba(0,0,0,0.05); }';

      html += '.btn-submit { width: 100%; padding: 12px; ';
      html += 'font-size: 14px; font-weight: 800; color: #fff; ';
      html += 'background: #ccc; border: none; border-radius: 12px; ';
      html += 'margin-top: 10px; }';
      html += '.btn-submit.ready { background: ' + successColor + '; }';
      
      html += '.total-inp { font-size: 18px; font-weight: 800; ';
      html += 'width: 100%; border: none; background: #fff; ';
      html += 'padding: 10px; border-radius: 10px; ';
      html += 'box-sizing: border-box; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }';
      
      html += '.swipe-hint { text-align: center; font-size: 10px; color: #aaa; ';
      html += 'margin-top: 5px; margin-bottom: 10px; font-style: italic; }';

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

      // Правка 10: Поле с крестиком
      html += '<div class="search-wrapper">';
      html += '<input type="text" class="search" id="search" ';
      html += 'placeholder="🔍 Поиск..." oninput="onSearchInput()" ';
      html += 'autocomplete="off">';
      html += '<button class="clear-search" id="clearSearch" ';
      html += 'onclick="clearSearchText()">✕</button>';
      html += '</div>';

      // Правка 8: Кнопки переключения сетки
      html += '<div class="grid-controls">';
      html += '<button class="grid-btn active" id="btn-grid-3" ';
      html += 'onclick="setGridCols(3)">3</button>';
      html += '<button class="grid-btn" id="btn-grid-4" ';
      html += 'onclick="setGridCols(4)">4</button>';
      html += '<button class="grid-btn" id="btn-grid-5" ';
      html += 'onclick="setGridCols(5)">5</button>';
      html += '<button class="grid-btn" id="btn-grid-6" ';
      html += 'onclick="setGridCols(6)">6</button>';
      html += '</div>';

      html += '<div class="h-scroll" id="catList">';
      html += '<button class="cat-btn active" id="cat-0" ';
      html += 'onclick="setCat(0)">Все</button>';
      html += '<button class="cat-btn bouquets-btn" ';
      html += 'id="cat-bouquets" onclick="toggleBouquetsMode()">';
      html += '🎁 Букеты</button>';
      html += '</div>';

      html += '<div class="grid grid-3" id="itemsGrid"></div>';

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

      html += '<div class="sheet-body">';
      
      html += '<div class="sheet-content">';
      html += '<div class="swipe-hint">← Смахните влево, чтобы очистить</div>';
      html += '<div id="bList" class="swipeable-cart"></div>';
      html += '</div>';

      html += '<div class="calc-panel">';
      
      html += '<div style="margin-bottom:10px;">';
      html += '<label style="font-size:11px; font-weight:600; color:#666;">';
      html += 'Сумма чека</label>';
      html += '<input type="text" id="totalPrice" class="total-inp" ';
      html += 'value="0" inputmode="none" readonly ';
      html += 'onclick="setActiveInput(\'totalPrice\')">';
      html += '</div>';

      // Правка 3 и 7: Кнопки оплаты без эмодзи, SVG, уменьшенные
      html += '<div style="display:flex; gap:5px; margin-bottom:10px; ';
      html += 'width:100%; box-sizing:border-box;">';
      html += '<div class="pay-btn" id="btn-cash" ';
      html += 'onclick="setPay(\'cash\')">' + getIconSvg('cash') + 'Нал</div>';
      html += '<div class="pay-btn" id="btn-card" ';
      html += 'onclick="setPay(\'card\')">' + getIconSvg('card') + 'Карта</div>';
      html += '<div class="pay-btn" id="btn-qr" ';
      html += 'onclick="setPay(\'qr\')">' + getIconSvg('qr') + 'QR</div>';
      html += '</div>';

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
      html += '<button onclick="num(\'C\')" style="color:red;">C</button>';
      html += '<button onclick="num(\'0\')">0</button>';
      html += '<button onclick="num(\'X\')">⌫</button>';
      html += '</div>';

      html += '<div class="pay-list" id="payList" ';
      html += 'style="font-size:12px; margin-top:10px;"></div>';
      html += '<div style="text-align:center; margin-top:10px; ';
      html += 'font-size:14px; font-weight:800;" ';
      html += 'id="remainTxt"></div>';

      html += '<button class="btn-submit" id="btnSubmit" ';
      html += 'onclick="openPrecheck()">Принять</button>';
      html += '</div>';

      html += '</div>';
      html += '</div>';
      // МОДАЛЬНОЕ ОКНО ПРЕ-ЧЕК
      html += '<div class="sheet-overlay" id="precheckModal" ';
      html += 'style="z-index:2000; align-items:center; ';
      html += 'justify-content:center;">';
      html += '<div style="background:#fff; padding:20px; ';
      html += 'border-radius:24px; width:90%; max-width:400px; ';
      html += 'max-height:80vh; display:flex; flex-direction:column;">';
      html += '<h2 style="margin:0 0 15px 0; text-align:center;">';
      html += 'Проверьте чек</h2>';
      html += '<div id="precheckList" style="overflow-y:auto; flex:1; ';
      html += 'margin-bottom:15px; border-top:1px solid #eee; ';
      html += 'border-bottom:1px solid #eee; padding:10px 0;">';
      html += '</div>';
      
      // Блок сдачи в пре-чеке
      html += '<div id="precheckChangeBlock" style="display:none; ';
      html += 'margin-bottom:15px; text-align:center;">';
      html += '<div style="font-size:14px; color:#888; ';
      html += 'margin-bottom:5px;">Сдача:</div>';
      html += '<div style="font-size:24px; font-weight:800; ';
      html += 'color:' + brandColor + ';" id="precheckChangeAmt">';
      html += '0 ₽</div>';
      html += '<div style="font-size:12px; color:#888; ';
      html += 'margin-top:10px; margin-bottom:5px;">Куда выдать?</div>';
      html += '<div style="display:flex; gap:5px;">';
      html += '<div class="pay-btn active" id="pcm-cash" ';
      html += 'onclick="setPrecheckChangeMethod(\'cash\')">' + 
              getIconSvg('cash') + 'Нал</div>';
      html += '<div class="pay-btn" id="pcm-card" ';
      html += 'onclick="setPrecheckChangeMethod(\'card\')">' + 
              getIconSvg('card') + 'Карта</div>';
      html += '<div class="pay-btn" id="pcm-qr" ';
      html += 'onclick="setPrecheckChangeMethod(\'qr\')">' + 
              getIconSvg('qr') + 'QR</div>';
      html += '</div></div>';

      html += '<div style="display:flex; justify-content:space-between; ';
      html += 'font-weight:800; font-size:18px; margin-bottom:15px;">';
      html += '<span>Итого:</span><span id="precheckTotal">0 ₽</span>';
      html += '</div>';
      html += '<div style="display:flex; gap:10px;">';
      html += '<button onclick="closePrecheck()" style="flex:1; ';
      html += 'padding:15px; border:none; border-radius:12px; ';
      html += 'font-weight:800; font-size:16px; background:#eee; ';
      html += 'color:#333;">Вернуться</button>';
      html += '<button onclick="saveSale()" style="flex:2; padding:15px; ';
      html += 'border:none; border-radius:12px; font-weight:800; ';
      html += 'font-size:16px; background:' + successColor + '; ';
      html += 'color:#fff;">Подтвердить</button>';
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
      html += getIconSvg('inventory') + 'Обзор склада</a>';
      html += '<a href="/warehouse/history" class="menu-item">';
      html += getIconSvg('history') + 'История смены</a>';
      html += '<a href="/warehouse/documents" class="menu-item">';
      html += getIconSvg('docs') + 'Документы</a>';
      html += '<a href="/warehouse/reports" class="menu-item">';
      html += getIconSvg('reports') + 'Отчёты</a>';
      html += '<a href="/warehouse/audit" class="menu-item">';
      html += getIconSvg('audit') + 'Журнал</a>';
      html += '</div>';

      // МОДАЛЬНОЕ ОКНО УСПЕХА
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
      html += '</div>';

      html += '<button onclick="closeSuccess()" style="width:100%; ';
      html += 'padding:15px; border:none; border-radius:12px; ';
      html += 'font-size:16px; font-weight:800; color:#fff; ';
      html += 'background:' + successColor + '; margin-top:15px;">';
      html += 'Готово</button>';
      html += '</div></div>';

      html += '<script>';
      
      // Глобальные переменные
      html += 'var allItems = []; var currentCat = 0; ';
      html += 'var bouquetsMode = false; var bouquetsList = [];';
      html += 'var cart = []; var payMethod = ""; var payments = []; ';
      html += 'var changeMethod = "cash"; var precheckChangeMethod = "cash";';
      html += 'var gridCols = 3;';
      html += 'var activeInputId = "payAmount"; var isFirstInput = true; ';
      html += 'var isPayAmountEdited = false; ';
      // Правка 1: Флаг ручного редактирования суммы чека
      html += 'var isTotalPriceEdited = false;';
      
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

      // Сетка
      html += 'if (localStorage.getItem("wh_sale_grid_cols")) {';
      html += '  gridCols = parseInt(';
      html += 'localStorage.getItem("wh_sale_grid_cols"));';
      html += '}';
      html += 'function initGrid() {';
      html += '  var g = document.getElementById("itemsGrid");';
      html += '  g.className = "grid grid-" + gridCols;';
      html += '  document.querySelectorAll(".grid-btn").forEach(';
      html += '  function(b){b.classList.remove("active");});';
      html += '  var btn = document.getElementById("btn-grid-" + gridCols);';
      html += '  if (btn) btn.classList.add("active");';
      html += '}';
      html += 'function setGridCols(cols) {';
      html += '  gridCols = cols; ';
      html += 'localStorage.setItem("wh_sale_grid_cols", cols);';
      html += '  initGrid();';
      html += '}';
      html += 'initGrid();';

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

      // Правка 10: Очистка поиска
      html += 'function onSearchInput() {';
      html += '  var val = document.getElementById("search").value;';
      html += '  var btn = document.getElementById("clearSearch");';
      html += '  if (val.length > 0) { btn.style.display = "block"; }';
      html += '  else { btn.style.display = "none"; }';
      html += '  filterItems();';
      html += '}';
      html += 'function clearSearchText() {';
      html += '  document.getElementById("search").value = "";';
      html += '  document.getElementById("clearSearch").style.display = "none";';
      html += '  filterItems();';
      html += '}';

      html += 'function toggleBouquetsMode() {';
      html += '  bouquetsMode = !bouquetsMode;';
      html += '  var bqBtn = document.getElementById("cat-bouquets");';
      html += '  var allBtns = document.querySelectorAll(".cat-btn");';
      html += '  if (bouquetsMode) {';
      html += '    allBtns.forEach(function(el) { ';
      html += '      el.classList.remove("active"); });';
      html += '    bqBtn.classList.add("active"); currentCat = -1;';
      html += '    document.getElementById("search").value = ""; ';
      html += '    document.getElementById("clearSearch")';
      html += '    .style.display = "none";';
      html += '    loadBouquets();';
      html += '  } else {';
      html += '    bqBtn.classList.remove("active"); currentCat = 0;';
      html += '    document.getElementById("cat-0").classList.add("active"); ';
      html += '    filterItems();';
      html += '  }';
      html += '}';

      html += 'function loadBouquets() {';
      html += '  var g = document.getElementById("itemsGrid"); ';
      html += '  while(g.firstChild) g.removeChild(g.firstChild);';
      html += '  var ld = document.createElement("div"); ';
      html += '  ld.style = "grid-column:1/-1; text-align:center; ';
      html += '  padding:20px; color:#888;"; ld.innerText = "Загрузка...";';
      html += '  g.appendChild(ld);';
      html += '  fetch("/api/warehouse/bouquets?shop=kupidon")';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { ';
      html += '      while(g.firstChild) g.removeChild(g.firstChild);';
      html += '      var er = document.createElement("div"); ';
      html += '      er.style = "grid-column:1/-1; text-align:center; ';
      html += '      padding:20px; color:#e74c3c;"; er.innerText = "Ошибка";';
      html += '      g.appendChild(er); return; }';
      html += '    bouquetsList = d.bouquets; renderBouquets(bouquetsList);';
      html += '  }).catch(function() {});';
      html += '}';

      html += 'function renderBouquets(list) {';
      html += '  var g = document.getElementById("itemsGrid"); ';
      html += '  while(g.firstChild) g.removeChild(g.firstChild);';
      html += '  if (list.length === 0) {';
      html += '    var em = document.createElement("div"); ';
      html += '    em.style = "grid-column:1/-1; text-align:center; ';
      html += '    padding:20px; color:#888;";';
      html += '    em.innerText = "Нет связанных букетов"; ';
      html += '    g.appendChild(em); return;';
      html += '  }';
      html += '  list.forEach(function(b) {';
      html += '    var d = document.createElement("div"); ';
      html += '    d.className = "card bouquet";';
      
      html += '    if (b.photo_url) { ';
      html += '      var img = document.createElement("img"); ';
      html += '      img.src = b.photo_url; d.appendChild(img); } ';
      html += '    else { ';
      html += '      var ph = document.createElement("div"); ';
      html += '      ph.className = "ph"; ph.innerHTML = svgPh; ';
      html += '      d.appendChild(ph); }';
      
      html += '    var nm = document.createElement("div"); ';
      html += '    nm.className = "name"; nm.textContent = b.name; ';
      html += '    d.appendChild(nm);';
      
      html += '    var tag = document.createElement("div"); ';
      html += '    tag.className = "bouquet-tag";';
      html += '    var ok = b.all_in_stock !== false;';
      html += '    tag.textContent = ok ? "✓ в наличии" : "⚠ нет ингр.";';
      html += '    if (!ok) tag.style.color = "#e74c3c";';
      html += '    d.appendChild(tag);';
      
      html += '    d.onclick = function() { addBouquetToCart(b); };';
      html += '    g.appendChild(d);';
      html += '  });';
      html += '}';

      html += 'function addBouquetToCart(b) {';
      html += '  fetch("/api/warehouse/bouquet/expand", { ';
      html += '  method: "POST", headers: { "Content-Type": ';
      html += '  "application/json" }, body: JSON.stringify({ ';
      html += '  bouquet_id: b.id }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { showAlert("Ошибка", d.error || ';
      html += '    "Не удалось", false); return; }';
      html += '    var items = d.ingredients || [];';
      html += '    items.forEach(function(it) {';
      html += '      var ex = cart.find(function(c) { ';
      html += '        return c.id === it.shop_item_id; });';
      html += '      if (ex) { ex.qty += it.qty; }';
      html += '      else { cart.push({ id: it.shop_item_id, ';
      html += '      name: it.name, qty: it.qty, ';
      html += '      retail: it.retail_price || 0 }); }';
      html += '    });';
      html += '    resetPayments(); openSheet();';
      html += '  }).catch(function() { showAlert("Ошибка сети", ';
      html += '  "Проверьте интернет", false); });';
      html += '}';

      html += 'function setCat(id) {';
      html += '  bouquetsMode = false; ';
      html += '  document.getElementById("cat-bouquets")';
      html += '  .classList.remove("active");';
      html += '  currentCat = id;';
      html += '  var els = document.querySelectorAll(".cat-btn"); ';
      html += '  els.forEach(function(el) { el.classList.remove("active"); });';
      html += '  document.getElementById("cat-" + id).classList.add("active");';
      html += '  filterItems();';
      html += '}';

      html += 'function render() { filterItems(); renderBasket(); }';

      html += 'function filterItems() {';
      html += '  if (bouquetsMode) { renderBouquets(bouquetsList); return; }';
      html += '  var q = document.getElementById("search")';
      html += '  .value.toLowerCase();';
      html += '  var items = allItems.filter(function(i) {';
      html += '    var matchQ = i.name.toLowerCase().includes(q);';
      html += '    var matchC = (currentCat === 0 || ';
      html += '    i.category_id === currentCat);';
      html += '    return matchQ && matchC; });';
      html += '  drawCards(items);';
      html += '}';

      html += 'function drawCards(items) {';
      html += '  var g = document.getElementById("itemsGrid"); ';
      html += '  while(g.firstChild) g.removeChild(g.firstChild);';
      html += '  items.forEach(function(item) {';
      html += '    var d = document.createElement("div");';
      html += '    d.className = item.is_pinned ? "card pinned" : "card";';
      
      html += '    if (item.is_pinned) {';
      html += '      var pin = document.createElement("div"); ';
      html += '      pin.className = "pin-badge"; pin.textContent = "🔥"; ';
      html += '      d.appendChild(pin);';
      html += '    }';

      html += '    if (item.photo_url) { ';
      html += '      var img = document.createElement("img"); ';
      html += '      img.src = item.photo_url; d.appendChild(img); } ';
      html += '    else { ';
      html += '      var ph = document.createElement("div"); ';
      html += '      ph.className = "ph"; ph.innerHTML = svgPh; ';
      html += '      d.appendChild(ph); }';
      
      html += '    var nm = document.createElement("div"); ';
      html += '    nm.className = "name"; nm.textContent = item.name; ';
      html += '    d.appendChild(nm);';
      
      html += '    var st = document.createElement("div"); ';
      html += '    st.className = "stock";';
      html += '    st.textContent = "Ост: " + fmtNum(item.current_stock) ';
      html += '    + " " + (item.unit || "шт");';
      html += '    d.appendChild(st);';
      
      html += '    d.onclick = function() { addToCart(item); };';

      html += '    var pressTimer;';
      html += '    d.addEventListener("touchstart", function() {';
      html += '      pressTimer = setTimeout(function() { ';
      html += '        togglePin(item); }, 600);';
      html += '    });';
      html += '    d.addEventListener("touchend", function() { ';
      html += '      clearTimeout(pressTimer); });';
      html += '    d.addEventListener("touchmove", function() { ';
      html += '      clearTimeout(pressTimer); });';

      html += '    g.appendChild(d);';
      html += '  });';
      html += '}';

      html += 'function togglePin(item) {';
      html += '  var newVal = !item.is_pinned;';
      html += '  fetch("/api/warehouse/item/pin", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ id: item.id, val: newVal }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) {';
      html += '      item.is_pinned = newVal;';
      html += '      showAlert("Готово", newVal ? "Закреплено 🔥" : ';
      html += '      "Откреплено", true);';
      html += '      allItems.sort(function(a,b){ ';
      html += '        if(a.is_pinned && !b.is_pinned) return -1; ';
      html += '        if(!a.is_pinned && b.is_pinned) return 1; ';
      html += '        return 0; });';
      html += '      filterItems();';
      html += '    }';
      html += '  }).catch(function(){});';
      html += '}';

      html += 'function addToCart(item) {';
      html += '  var ex = cart.find(function(c) { return c.id === item.id; });';
      html += '  if (ex) ex.qty += 1; ';
      html += '  else cart.push({ id: item.id, name: item.name, qty: 1, ';
      html += '  retail: item.retail_price || 0 });';
      html += '  resetPayments();';
      html += '}';

      // Правка 1: Сброс флага при изменении корзины
      html += 'function resetPayments() { ';
      html += 'payments = []; isPayAmountEdited = false; ';
      html += 'isTotalPriceEdited = false; saveCart(); renderBasket(); }';

      html += 'function saveCart() {';
      html += '  localStorage.setItem("wh_cart_kupidon", ';
      html += '  JSON.stringify(cart));';
      html += '}';
      html += 'function loadCart() {';
      html += '  var c = localStorage.getItem("wh_cart_kupidon");';
      html += '  if (c) { try { cart = JSON.parse(c); } ';
      html += '  catch(e) { cart = []; } }';
      html += '}';

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
      html += '    cartList.style.background = "rgba(217, 83, 79, " + ';
      html += '    (Math.abs(diff)/150) + ")";';
      html += '    cartList.style.borderRadius = "12px";';
      html += '  }';
      html += '});';
      
      html += 'cartList.addEventListener("touchend", function(e) {';
      html += '  if (!isSwiping) return; isSwiping = false;';
      html += '  var diff = e.changedTouches[0].clientX - startX;';
      html += '  cartList.style.transition = ';
      html += '  "transform 0.3s, background 0.3s";';
      html += '  if (diff < -100) {';
      html += '    cartList.style.transform = "translateX(-100%)";';
      html += '    setTimeout(function() { ';
      html += '      clearCartDirect(); ';
      html += '      cartList.style.transform = "translateX(0)"; ';
      html += '      cartList.style.background = "transparent"; }, 300);';
      html += '  } else {';
      html += '    cartList.style.transform = "translateX(0)";';
      html += '    cartList.style.background = "transparent";';
      html += '  }';
      html += '});';

      html += 'var fc = document.getElementById("floatingCart");';
      html += 'fc.addEventListener("touchstart", function(e) { ';
      html += '  startX = e.touches[0].clientX; });';
      html += 'fc.addEventListener("touchend", function(e) {';
      html += '  var diff = e.changedTouches[0].clientX - startX;';
      html += '  if (diff > -30 && diff < 30) { openSheet(); }';
      html += '});';

      html += 'function clearCartDirect() {';
      html += '  cart = []; payments = []; isPayAmountEdited = false;';
      html += '  isTotalPriceEdited = false;';
      html += '  localStorage.removeItem("wh_cart_kupidon");';
      html += '  renderBasket();';
      html += '}';

      html += 'loadCart();';

      html += 'function openSheet() {';
      html += '  document.getElementById("sheetOverlay")';
      html += '  .classList.add("open");';
      html += '  document.getElementById("bottomSheet")';
      html += '  .classList.add("open");';
      html += '}';
      html += 'function closeSheet() {';
      html += '  document.getElementById("sheetOverlay")';
      html += '  .classList.remove("open");';
      html += '  document.getElementById("bottomSheet")';
      html += '  .classList.remove("open");';
      html += '}';

      // Правка 1: Запрет перезаписи суммы чека
      html += 'function renderBasket() {';
      html += '  var b = document.getElementById("bList");';
      html += '  var fc = document.getElementById("floatingCart");';
      html += '  if (cart.length === 0) { ';
      html += '    fc.classList.remove("show"); ';
      html += '    while(b.firstChild) b.removeChild(b.firstChild); ';
      html += '    document.getElementById("totalPrice").value = "0";';
      html += '    document.getElementById("payAmount").value = "";';
      html += '    renderPayments(); return; ';
      html += '  }';
      
      html += '  fc.classList.add("show"); ';
      html += '  while(b.firstChild) b.removeChild(b.firstChild); ';
      html += '  var total = 0; var count = 0;';
      html += '  cart.forEach(function(item, idx) {';
      html += '    total += (item.retail * item.qty); count += item.qty;';
      html += '    var div = document.createElement("div"); ';
      html += '    div.className = "b-row";';
      html += '    var name = document.createElement("div"); ';
      html += '    name.textContent = item.name;';
      html += '    var ctrl = document.createElement("div"); ';
      html += '    ctrl.style = "display:flex; justify-content:space-between; ';
      html += '    align-items:center; gap:4px;";';
      
      html += '    var mn = document.createElement("button"); ';
      html += '    mn.innerText = "-"; mn.className = "qty-btn";';
      html += '    mn.onclick = function() { changeQty(idx, -1); };';
      
      html += '    var vl = document.createElement("input"); ';
      html += '    vl.type = "number"; vl.className = "qty-input"; ';
      html += '    vl.value = item.qty; vl.readOnly = true; ';
      html += '    vl.id = "qty_" + idx;';
      html += '    vl.onclick = function() { setActiveInput(this.id); };';
      
      html += '    var pl = document.createElement("button"); ';
      html += '    pl.innerText = "+"; pl.className = "qty-btn";';
      html += '    pl.onclick = function() { changeQty(idx, 1); };';
      
      html += '    ctrl.appendChild(mn); ctrl.appendChild(vl); ';
      html += '    ctrl.appendChild(pl);';
      
      // Правка 4: Фикс создания элемента del
      html += '    var del = document.createElement("span"); ';
      html += '    del.innerText = "✕";';
      html += '    del.style = "color:red; cursor:pointer; font-size:20px; ';
      html += '    text-align:center;";';
      
      // Правка 5: Защита от удаления
      html += '    del.onclick = function() { ';
      html += '      showConfirm("Удаление", "Убрать " + item.name + "?", ';
      html += '      function() { ';
      html += '        cart.splice(idx, 1); resetPayments(); ';
      html += '      }, true); ';
      html += '    };';
      
      html += '    div.appendChild(name); div.appendChild(ctrl); ';
      html += '    div.appendChild(del); b.appendChild(div);';
      html += '  });';
      
      // Правка 1: Не перезаписываем, если меняли вручную
      html += '  if (!isTotalPriceEdited) { ';
      html += '    document.getElementById("totalPrice").value = total; ';
      html += '  }';
      
      // Синхронизация поля Внести
      html += '  if (!isPayAmountEdited && payments.length === 0) { ';
      html += '    document.getElementById("payAmount").value = total; ';
      html += '  } else if (payments.length > 0) { ';
      html += '    var paid = 0; ';
      html += '    payments.forEach(function(p) { paid += p.amount; }); ';
      html += '    var rem = total - paid; ';
      html += '    if (rem > 0 && !isPayAmountEdited) { ';
      html += '      document.getElementById("payAmount").value = rem; ';
      html += '    } ';
      html += '  }';
      
      html += '  document.getElementById("fcCount").innerText = ';
      html += '  count + " товар(ов)";';
      html += '  document.getElementById("fcTotal").innerText = total + " ₽";';
      html += '  renderPayments();';
      html += '}';

      html += 'function changeQty(idx, delta) {';
      html += '  cart[idx].qty += delta;';
      html += '  if (cart[idx].qty <= 0) {';
      html += '    showConfirm("Удаление", "Убрать товар?", function() {';
      html += '      cart.splice(idx, 1); resetPayments();';
      html += '    }, true);';
      html += '  } else { resetPayments(); }';
      html += '}';
      // Правка 7: Сброс выбора оплаты
      html += 'function setPay(method) {';
      html += '  payMethod = method;';
      html += '  var els = document.querySelectorAll(".pay-btn"); ';
      html += '  els.forEach(function(b) { b.classList.remove("active"); });';
      html += '  var btn = document.getElementById("btn-" + method);';
      html += '  if (btn) btn.classList.add("active");';
      html += '}';

      // Правка 1 и 5: Умный ввод и синхронизация
      html += 'function setActiveInput(id) {';
      html += '  if (activeInputId !== id) { isFirstInput = true; }';
      html += '  activeInputId = id;';
      html += '  var allInps = document.querySelectorAll(';
      html += '  ".total-inp, .qty-input, .pay-input-row input");';
      html += '  allInps.forEach(function(el) { ';
      html += '    el.classList.remove("input-active"); });';
      html += '  var el = document.getElementById(id);';
      html += '  if (el) { ';
      html += '    el.classList.add("input-active"); ';
      html += '    el.value = ""; ';
      html += '    isFirstInput = false; ';
      html += '  }';
      html += '  if (id === "payAmount") { isPayAmountEdited = true; }';
      html += '  if (id === "totalPrice") { isTotalPriceEdited = true; }';
      html += '}';

      html += 'function num(v) {';
      html += '  var inp = document.getElementById(activeInputId);';
      html += '  if (!inp) return;';
      
      html += '  if (v === "C") { inp.value = ""; isFirstInput = false; }';
      html += '  else if (v === "X") { ';
      html += '    inp.value = inp.value.slice(0, -1); ';
      html += '    isFirstInput = false; }';
      html += '  else {';
      html += '    if (isFirstInput) { inp.value = ""; isFirstInput = false; }';
      html += '    inp.value += v;';
      html += '  }';

      html += '  if (activeInputId === "payAmount") { ';
      html += '    isPayAmountEdited = true; ';
      html += '    renderPayments(); }';
      
      // Правка 1: Синхронизация при ручном вводе суммы чека
      html += '  if (activeInputId === "totalPrice") { ';
      html += '    isTotalPriceEdited = true; ';
      html += '    var nt = parseFloat(inp.value) || 0; ';
      html += '    if (!isPayAmountEdited && payments.length === 0) { ';
      html += '      document.getElementById("payAmount").value = ';
      html += '      nt > 0 ? nt : ""; ';
      html += '    } ';
      html += '    renderPayments(); }';
      
      html += '  if (activeInputId.startsWith("qty_")) {';
      html += '    var idx = parseInt(activeInputId.replace("qty_", ""));';
      html += '    var newQty = parseFloat(inp.value) || 0;';
      html += '    if (newQty > 0) { ';
      html += '      cart[idx].qty = newQty; saveCart(); }';
      html += '    renderBasket(); '; 
      html += '  }';
      html += '}';

      // Правка 7: Проверка выбора оплаты
      html += 'function addPayment() {';
      html += '  if (!payMethod) { ';
      html += '    showAlert("Внимание", "Выберите способ оплаты", false); ';
      html += '    return; }';
      
      html += '  var val = parseFloat(';
      html += '  document.getElementById("payAmount").value);';
      html += '  if (!val || val <= 0) { ';
      html += '    showAlert("Внимание", "Введите сумму", false); return; }';
      
      html += '  payments.push({ method: payMethod, amount: val });';
      html += '  document.getElementById("payAmount").value = "";';
      html += '  isPayAmountEdited = false;';
      html += '  setPay(""); ';
      html += '  renderBasket();';
      html += '}';

      html += 'function renderPayments() {';
      html += '  var total = parseFloat(';
      html += '  document.getElementById("totalPrice").value) || 0;';
      html += '  var paid = 0; ';
      html += '  var pl = document.getElementById("payList"); ';
      html += '  while(pl.firstChild) pl.removeChild(pl.firstChild);';
      
      html += '  payments.forEach(function(p, i) {';
      html += '    paid += p.amount;';
      html += '    var mn = p.method === "cash" ? "Нал" : ';
      html += '    (p.method === "card" ? "Карта" : "QR");';
      html += '    var row = document.createElement("div");';
      html += '    row.style = "display:flex; justify-content:space-between; ';
      html += '    align-items:center; color:' + successColor + '; ';
      html += '    font-weight:bold; margin-bottom:5px;";';
      html += '    var txt = document.createElement("span"); ';
      html += '    txt.textContent = mn + " " + p.amount + " ₽";';
      
      html += '    var delBtn = document.createElement("span"); ';
      html += '    delBtn.textContent = " ✕";';
      html += '    delBtn.style = "color:red; cursor:pointer; ';
      html += '    font-size:16px; margin-left:10px;";';
      html += '    delBtn.onclick = function() { ';
      html += '      payments.splice(i, 1); ';
      html += '      isPayAmountEdited = false; ';
      html += '      renderBasket(); };';
      
      html += '    row.appendChild(txt); row.appendChild(delBtn); ';
      html += '    pl.appendChild(row);';
      html += '  });';
      
      html += '  var typed = parseFloat(';
      html += '  document.getElementById("payAmount").value) || 0;';
      html += '  var remain = total - paid;';
      html += '  var rTxt = document.getElementById("remainTxt"); ';
      html += '  var btn = document.getElementById("btnSubmit");';
      
      html += '  if (total <= 0) { ';
      html += '    rTxt.innerText = "Укажите сумму"; ';
      html += '    rTxt.style.color = "' + dangerColor + '"; ';
      html += '    btn.classList.remove("ready"); return; }';
      
      html += '  if (remain > 0) { ';
      html += '    rTxt.innerText = "Осталось: " + remain + " ₽"; ';
      html += '    rTxt.style.color = "' + dangerColor + '"; ';
      html += '    btn.classList.remove("ready"); ';
      html += '  } else if (remain === 0) {';
      html += '    if (payments.length === 0 && typed > 0) { ';
      html += '      rTxt.innerText = "Нажмите Внести"; ';
      html += '      rTxt.style.color = "' + accentColor + '"; ';
      html += '      btn.classList.remove("ready"); ';
      html += '    } else { ';
      html += '      rTxt.innerText = "Оплачено"; ';
      html += '      rTxt.style.color = "' + successColor + '"; ';
      html += '      btn.classList.add("ready"); }';
      html += '  } else { ';
      html += '    rTxt.innerText = "Сдача: " + Math.abs(remain) + " ₽"; ';
      html += '    rTxt.style.color = "#3C7A89"; ';
      html += '    btn.classList.add("ready"); }';
      html += '}';

      // Правка 2: Выбор способа сдачи в пре-чеке
      html += 'function setPrecheckChangeMethod(m) { ';
      html += 'precheckChangeMethod = m; ';
      html += 'var els = document.querySelectorAll(".pay-btn"); ';
      html += 'els.forEach(function(el) { el.classList.remove("active"); });';
      html += 'document.getElementById("pcm-" + m).classList.add("active"); }';

      html += 'function openPrecheck() {';
      html += '  var btn = document.getElementById("btnSubmit");';
      html += '  if (!btn.classList.contains("ready")) { ';
      html += '    showAlert("Внимание", "Оплата не завершена", false); ';
      html += '    return; }';
      
      html += '  var total = parseFloat(';
      html += '  document.getElementById("totalPrice").value);';
      html += '  var typed = parseFloat(';
      html += '  document.getElementById("payAmount").value) || 0;';
      
      html += '  if (typed > 0) { ';
      html += '    if (!payMethod) { ';
      html += '      showAlert("Внимание", "Выберите способ", false); ';
      html += '      return; }';
      html += '    payments.push({ method: payMethod, amount: typed }); ';
      html += '    document.getElementById("payAmount").value = ""; ';
      html += '    renderPayments(); }';
      
      html += '  var list = document.getElementById("precheckList"); ';
      html += '  while(list.firstChild) list.removeChild(list.firstChild);';
      html += '  cart.forEach(function(item) {';
      html += '    var row = document.createElement("div");';
      html += '    row.style = "display:flex; justify-content:space-between; ';
      html += '    margin-bottom:5px; font-size:14px;";';
      html += '    var n = document.createElement("span"); ';
      html += '    n.textContent = item.name + " x" + fmtNum(item.qty);';
      html += '    var p = document.createElement("span"); ';
      html += '    p.textContent = (item.retail * item.qty) + " ₽";';
      html += '    row.appendChild(n); row.appendChild(p); ';
      html += '    list.appendChild(row);';
      html += '  });';
      
      html += '  var paid = 0; ';
      html += '  payments.forEach(function(p) { paid += p.amount; });';
      html += '  var change = paid - total;';
      
      html += '  var changeBlock = document.getElementById(';
      html += '  "precheckChangeBlock");';
      html += '  if (change > 0) { ';
      html += '    changeBlock.style.display = "block"; ';
      html += '    document.getElementById("precheckChangeAmt")';
      html += '    .innerText = change + " ₽"; ';
      html += '    precheckChangeMethod = "cash"; ';
      html += '    setPrecheckChangeMethod("cash"); ';
      html += '  } else { changeBlock.style.display = "none"; }';
      
      html += '  document.getElementById("precheckTotal")';
      html += '  .innerText = total + " ₽";';
      html += '  document.getElementById("precheckModal")';
      html += '  .style.display = "flex";';
      html += '}';
      
      html += 'function closePrecheck() { ';
      html += 'document.getElementById("precheckModal")';
      html += '.style.display = "none"; }';

      // Правка 2: Умный вычет сдачи при сохранении
      html += 'function saveSale() {';
      html += '  var btn = document.getElementById("btnSubmit");';
      html += '  btn.disabled = true; btn.innerText = "Отправка...";';
      html += '  var total = parseFloat(';
      html += '  document.getElementById("totalPrice").value);';
      
      html += '  var paid = 0; ';
      html += '  payments.forEach(function(p) { paid += p.amount; });';
      html += '  var change = paid - total; ';
      html += '  var finalPayments = JSON.parse(JSON.stringify(payments));';
      
      html += '  if (change > 0) {';
      html += '    var remChange = change;';
      html += '    for (var i = 0; i < finalPayments.length; i++) {';
      html += '      var p = finalPayments[i];';
      html += '      if (p.amount <= 0) continue;';
      
      html += '      if (p.method === precheckChangeMethod) {';
      html += '        if (p.amount >= remChange) { ';
      html += '          p.amount -= remChange; remChange = 0; break; }';
      html += '        else { remChange -= p.amount; p.amount = 0; }';
      html += '      }';
      html += '    }';
      
      html += '    if (remChange > 0) {';
      html += '      for (var j = 0; j < finalPayments.length; j++) {';
      html += '        var p2 = finalPayments[j];';
      html += '        if (p2.amount <= 0) continue;';
      html += '        if (p2.amount >= remChange) { ';
      html += '          p2.amount -= remChange; remChange = 0; break; }';
      html += '        else { remChange -= p2.amount; p2.amount = 0; }';
      html += '      }';
      html += '    }';
      
      html += '    if (remChange > 0) { ';
      html += '      btn.disabled = false; btn.innerText = "Принять"; ';
      html += '      showAlert("Ошибка", "Мало средств для сдачи", false); ';
      html += '      return; }';
      html += '  }';
      
      html += '  finalPayments = finalPayments.filter(function(p) { ';
      html += '    return p.amount > 0; });';
      
      html += '  var payload = { shopId: "kupidon", real_price: total, ';
      html += '  payments: finalPayments, items: cart };';
      html += '  fetch("/api/warehouse/sale", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify(payload) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) {';
      html += '      localStorage.removeItem("wh_cart_kupidon");';
      html += '      var cBlock = document.getElementById("changeBlock");';
      html += '      if (change > 0) { ';
      html += '        document.getElementById("changeAmount")';
      html += '        .innerText = change + " ₽"; ';
      html += '        cBlock.style.display = "block"; }';
      html += '      else { cBlock.style.display = "none"; }';
      html += '      document.getElementById("precheckModal")';
      html += '      .style.display = "none";';
      html += '      document.getElementById("successModal")';
      html += '      .style.display = "flex";';
      html += '    } else { ';
      html += '      btn.disabled = false; btn.innerText = "Принять"; ';
      html += '      showAlert("Ошибка", d.error || "unknown", false); }';
      html += '  }).catch(function(err) { ';
      html += '    btn.disabled = false; btn.innerText = "Принять"; ';
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false); });';
      html += '}';

      html += 'function closeSuccess() { window.location.reload(); }';
      html += 'function toggleMenu() { ';
      html += 'document.getElementById("sidebar").classList.toggle("open"); ';
      html += 'document.getElementById("overlay")';
      html += '.classList.toggle("open"); }';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) {
      console.error('Sale page error:', e?.message || e);
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 19. API ПРОДАЖИ ======
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
        // Минусовой остаток разрешен
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
  // ====== 20. API БУКЕТОВ ДЛЯ КАССЫ ======
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

  // ====== 21. API РАСКРЫТИЯ БУКЕТА ======
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

  // ====== 22. ЭКРАН СПИСКА НАКЛАДНЫХ ======
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
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.doc.completed { border-left: 4px solid ';
    html += successColor + '; }';
    html += '.doc.draft { border-left: 4px solid #E67E22; }';
    html += '.meta { font-size: 12px; color: #888; margin-top: 4px; }';
    html += '.meta-edited { font-size: 11px; color: ';
    html += accentColor + '; font-weight: 600; margin-top: 2px; }';
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
    html += '  while(b.firstChild) b.removeChild(b.firstChild);';
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
    
    // Правка 9: Вывод даты изменения
    html += '    if (doc.updated_at && doc.updated_at !== doc.date) {';
    html += '      var upd = new Date(doc.updated_at)';
    html += '      .toLocaleString("ru-RU");';
    html += '      var metaEd = document.createElement("div");';
    html += '      metaEd.className = "meta-edited";';
    html += '      metaEd.textContent = "Изменено: " + upd;';
    html += '      div.appendChild(metaEd);';
    html += '    }';
    
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
    html += '      showAlert("Ошибка сети", "Проверьте интернет", false); });';
    html += '  }, true);';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 23. API СПИСКА НАКЛАДНЫХ ======
  app.get('/api/warehouse/receipts', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT r.id, r.date, r.updated_at, r.total_sum, r.status, ' +
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

  // ====== 24. API УДАЛЕНИЯ ЧЕРНОВИКА ======
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

  // ====== 25. СОЗДАНИЕ ЧЕРНОВИКА ======
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

  // ====== 26. ЭКРАН РЕДАКТИРОВАНИЯ ЧЕРНОВИКА ======
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
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += 'label { display: block; font-size: 13px; color: #666; ';
    html += 'margin-bottom: 5px; font-weight: 600; }';
    html += '.btn-add { width: 100%; background: ' + brandColor + '; ';
    html += 'color: #fff; border: none; padding: 16px; ';
    html += 'border-radius: 12px; font-size: 16px; font-weight: 800; ';
    html += 'margin-bottom: 15px; }';
    html += '.basket { background: #fff; border-radius: 12px; ';
    html += 'padding: 15px; margin-bottom: 15px; ';
    html += 'border: 2px solid ' + brandColor + '; display: none; }';
    
    html += '.b-row { display: grid; grid-template-columns: 1fr 90px 20px; ';
    html += 'gap: 5px; align-items: center; margin-bottom: 6px; ';
    html += 'font-size: 13px; padding-bottom: 6px; ';
    html += 'border-bottom: 1px solid #eee; }';
    html += '.qty-btn { background: #F0F4F4; border: none; ';
    html += 'width: 26px; height: 26px; ';
    html += 'border-radius: 6px; font-weight: bold; font-size: 14px; ';
    html += 'color: ' + brandColor + '; }';
    html += '.qty-input { width: 30px; height: 26px; text-align: center; ';
    html += 'font-size: 13px; font-weight: bold; border: 1px solid #ddd; ';
    html += 'border-radius: 6px; padding: 0; margin: 0; }';
    
    html += '.btn-save { width: 100%; background: ' + successColor + '; ';
    html += 'color: #fff; border: none; padding: 16px; ';
    html += 'border-radius: 12px; font-size: 16px; font-weight: 800; }';
    html += '.hint-cost { font-size: 12px; margin-top: -10px; ';
    html += 'margin-bottom: 10px; font-weight: 600; }';
    html += '.img-preview { width: 60px; height: 60px; ';
    html += 'border-radius: 8px; object-fit: cover; display: none; ';
    html += 'margin-bottom: 10px; }';
    
    // Правка 2 и 10: Кастомный дропдаун и крестик
    html += '.dropdown-wrap { position: relative; }';
    html += '.dropdown-list { position: absolute; top: 100%; left: 0; ';
    html += 'right: 0; background: #fff; border: 1px solid #eee; ';
    html += 'border-radius: 12px; margin-top: -10px; z-index: 100; ';
    html += 'box-shadow: 0 4px 15px rgba(0,0,0,0.1); ';
    html += 'max-height: 220px; overflow-y: auto; display: none; }';
    html += '.dd-item { padding: 12px 15px; border-bottom: 1px solid #eee; ';
    html += 'cursor: pointer; display: flex; justify-content: space-between; ';
    html += 'align-items: center; }';
    html += '.dd-item:last-child { border-bottom: none; }';
    html += '.dd-name { font-weight: 600; font-size: 14px; ';
    html += 'color: ' + brandColor + '; }';
    html += '.dd-stock { font-size: 12px; font-weight: 800; }';
    
    html += '.clear-search { position: absolute; right: 15px; ';
    html += 'top: 22px; font-size: 20px; color: #aaa; cursor: pointer; ';
    html += 'display: none; background: none; border: none; padding: 0; }';
    html += '</style></head><body>';

    html += '<div class="header">';
    html += '<a href="/warehouse/receipts" class="back">←</a>';
    html += '<h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('receipt') + 'Накладная</h2></div>';

    html += '<div class="card">';
    html += '<label>Название товара</label>';
    html += '<div class="dropdown-wrap">';
    html += '<input type="text" id="itemName" class="input-cap" ';
    html += 'oninput="onNameInput()" ';
    html += 'placeholder="Начните вводить..." autocomplete="off">';
    html += '<button class="clear-search" id="clearSearch" ';
    html += 'onclick="clearSearchText()">✕</button>';
    html += '<div class="dropdown-list" id="ddList"></div>';
    html += '</div>';

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

    html += '<label>Розничная цена (необязательно)</label>';
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
    html += 'var receiptItems = [];';

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

    // Правка 10: Поиск с крестиком и дропдаун
    html += 'function onNameInput() {';
    html += '  var val = document.getElementById("itemName").value;';
    html += '  var dd = document.getElementById("ddList");';
    html += '  var btn = document.getElementById("clearSearch");';
    html += '  while(dd.firstChild) dd.removeChild(dd.firstChild);';
    
    html += '  if (val.length > 0) { btn.style.display = "block"; }';
    html += '  else { btn.style.display = "none"; }';

    html += '  if (!val || val.length < 1) { ';
    html += '    dd.style.display = "none"; return; }';
    
    html += '  var found = itemsCatalog.filter(function(i) { ';
    html += '    return i.name.toLowerCase().includes(val.toLowerCase()); ';
    html += '  }).slice(0, 20);';

    html += '  if (found.length === 0) { ';
    html += '    dd.style.display = "none"; return; }';

    html += '  found.forEach(function(i) {';
    html += '    var row = document.createElement("div"); ';
    html += '    row.className = "dd-item";';
    html += '    var nm = document.createElement("div"); ';
    html += '    nm.className = "dd-name"; nm.textContent = i.name;';
    html += '    var st = document.createElement("div"); ';
    html += '    st.className = "dd-stock"; ';
    html += '    var s = parseFloat(i.current_stock);';
    html += '    st.textContent = fmtNum(s) + " " + (i.unit || "шт");';
    html += '    st.style.color = s > 0 ? "' + successColor + '" : "';
    html += dangerColor + '";';
    
    html += '    row.appendChild(nm); row.appendChild(st);';
    html += '    row.onclick = function() {';
    html += '      document.getElementById("itemName").value = i.name;';
    html += '      document.getElementById("itemRetail").value = ';
    html += '      i.retail_price || "";';
    html += '      currentLastCost = parseFloat(i.last_cost) || 0;';
    html += '      document.getElementById("clearSearch")';
    html += '      .style.display = "none";';
    html += '      dd.style.display = "none";';
    html += '      calcCostDiff();';
    html += '    };';
    html += '    dd.appendChild(row);';
    html += '  });';
    html += '  dd.style.display = "block";';
    html += '}';

    html += 'function clearSearchText() {';
    html += '  document.getElementById("itemName").value = "";';
    html += '  document.getElementById("clearSearch").style.display = "none";';
    html += '  document.getElementById("ddList").style.display = "none";';
    html += '}';

    html += 'document.addEventListener("click", function(e) {';
    html += '  var dd = document.getElementById("ddList");';
    html += '  var inp = document.getElementById("itemName");';
    html += '  if (dd && inp && e.target !== dd && ';
    html += '  e.target !== inp && !dd.contains(e.target)) {';
    html += '    dd.style.display = "none";';
    html += '  }';
    html += '});';

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
    html += '} }).catch(function() {});';

    html += 'fetch("/api/warehouse/receipt/items?id=" + receiptId)';
    html += '.then(function(r) { return r.json(); })';
    html += '.then(function(d) { if (d.ok) { ';
    html += '  receiptItems = d.items; renderList(); } })';
    html += '.catch(function() {});';

    html += 'function addToBasket() {';
    html += '  var name = document.getElementById("itemName").value;';
    html += '  var qty = document.getElementById("itemQty")';
    html += '  .value.replace(",", ".");';
    html += '  var price = document.getElementById("itemPrice")';
    html += '  .value.replace(",", ".");';
    html += '  var retail = document.getElementById("itemRetail")';
    html += '  .value.replace(",", ".") || 0;';
    html += '  var catId = document.getElementById("itemCategory").value;';
    html += '  var unitEl = document.getElementById("itemUnit");';
    html += '  var unit = "шт";';
    html += '  if (document.getElementById("unitBlock")';
    html += '  .style.display !== "none") { unit = unitEl.value; }';
    html += '  if (!name || !qty || !price) { ';
    html += '    showAlert("Внимание", "Заполните поля", false); ';
    html += '    return; }';

    html += '  var btn = document.getElementById("btnAdd");';
    html += '  btn.disabled = true; btn.innerText = "Добавление...";';

    html += '  var f = document.getElementById("itemPhoto").files[0];';
    html += '  var finish = function(url) {';
    html += '    fetch("/api/warehouse/receipt/item/add", { ';
    html += '    method: "POST", headers: { "Content-Type": ';
    html += '    "application/json" }, ';
    html += '    body: JSON.stringify({ receipt_id: receiptId, ';
    html += '    name: name, qty: qty, price: price, retail: retail, ';
    html += '    cat_id: catId, unit: unit, photo_url: url }) })';
    html += '    .then(function(r) { return r.json(); })';
    html += '    .then(function(d) {';
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
    html += '        document.getElementById("clearSearch")';
    html += '        .style.display = "none";';
    html += '        receiptItems = d.items; renderList();';
    html += '      } else { showAlert("Ошибка", d.error, false); }';
    html += '    }).catch(function(err) { btn.disabled = false; ';
    html += '    btn.innerText = "+ Добавить в накладную"; ';
    html += '    showAlert("Ошибка", "Сбой: " + err.message, false); });';
    html += '  };';

    html += '  if (f) {';
    html += '    var rd = new FileReader();';
    html += '    rd.onload = function(e) {';
    html += '      var img = new Image();';
    html += '      img.onload = function() {';
    html += '        var canvas = document.createElement("canvas"); ';
    html += '        var MAX = 800; var w = img.width, h = img.height;';
    html += '        if (w > h) { if (w > MAX) { ';
    html += '          h *= MAX / w; w = MAX; } } ';
    html += '        else { if (h > MAX) { w *= MAX / h; h = MAX; } }';
    html += '        canvas.width = w; canvas.height = h; ';
    html += '        var ctx = canvas.getContext("2d"); ';
    html += '        ctx.drawImage(img, 0, 0, w, h);';
    html += '        var dataUrl = canvas.toDataURL("image/jpeg", 0.7);';
    html += '        fetch("/api/warehouse/upload", { method: "POST", ';
    html += '        headers: { "Content-Type": "application/json" }, ';
    html += '        body: JSON.stringify({ image: dataUrl }) })';
    html += '        .then(function(r) { return r.json(); })';
    html += '        .then(function(d) { ';
    html += '          finish(d.ok ? d.url : null); })';
    html += '        .catch(function() { finish(null); });';
    html += '      }; img.src = e.target.result;';
    html += '    }; rd.readAsDataURL(f);';
    html += '  } else { finish(null); }';
    html += '}';

    html += 'function changeQty(idx, delta) {';
    html += '  receiptItems[idx].qty = ';
    html += '  parseFloat(receiptItems[idx].qty) + delta;';
    html += '  if (receiptItems[idx].qty <= 0) {';
    html += '    showConfirm("Удаление", "Удалить позицию?", function() {';
    html += '      receiptItems.splice(idx, 1); renderList();';
    html += '    }, true);';
    html += '  } else { renderList(); }';
    html += '}';

    // Правка 1 (Сумма на лету), Правка 4 (Фикс del), Правка 5 (Защита)
    html += 'function renderList() {';
    html += '  var b = document.getElementById("basket"); ';
    html += '  var list = document.getElementById("bList");';
    html += '  if (receiptItems.length === 0) { ';
    html += '    b.style.display = "none"; ';
    html += '    while(list.firstChild) list.removeChild(list.firstChild); ';
    html += '    return; }';
    html += '  b.style.display = "block"; ';
    html += '  while(list.firstChild) list.removeChild(list.firstChild);';
    html += '  var totalSum = 0;';
    html += '  receiptItems.forEach(function(item, idx) {';
    html += '    var q = parseFloat(item.qty) || 0;';
    html += '    var p = parseFloat(item.unit_cost) || 0;';
    html += '    var rowSum = Math.round(q * p * 100) / 100;';
    html += '    totalSum += rowSum;';
    
    html += '    var div = document.createElement("div"); ';
    html += '    div.className = "b-row";';
    html += '    var n = document.createElement("div"); ';
    html += '    n.textContent = item.name || "Товар";';
    html += '    var ctrl = document.createElement("div"); ';
    html += '    ctrl.style = "display:flex; gap:2px; align-items:center;";';
    html += '    var mn = document.createElement("button"); ';
    html += '    mn.textContent = "-"; mn.className = "qty-btn"; ';
    html += '    mn.onclick = function() { changeQty(idx, -1); };';
    
    // Правка 4: Обязательное создание элемента input
    html += '    var inp = document.createElement("input"); ';
    html += '    inp.type = "number"; inp.className = "qty-input"; ';
    html += '    inp.value = item.qty; inp.readOnly = true;';
    
    html += '    var pl = document.createElement("button"); ';
    html += '    pl.textContent = "+"; pl.className = "qty-btn"; ';
    html += '    pl.onclick = function() { changeQty(idx, 1); };';
    html += '    ctrl.appendChild(mn); ctrl.appendChild(inp); ';
    html += '    ctrl.appendChild(pl);';
    
    // Правка 4 и 5: Создание del и защита от удаления
    html += '    var del = document.createElement("span"); ';
    html += '    del.textContent = "✕"; ';
    html += '    del.style = "color:red; cursor:pointer; font-size:18px;";';
    html += '    del.onclick = function() { ';
    html += '      showConfirm("Удаление", "Убрать " + item.name + "?", ';
    html += '      function() { ';
    html += '        receiptItems.splice(idx, 1); renderList(); ';
    html += '      }, true); ';
    html += '    };';
    
    html += '    div.appendChild(n); div.appendChild(ctrl); ';
    html += '    div.appendChild(del); list.appendChild(div);';
    html += '  });';
    html += '  document.getElementById("totalSum").innerText = ';
    html += '  fmtNum(totalSum) + " ₽";';
    html += '}';

    // Правка 3 и 5: Проверка на пустоту и нулевую цену
    html += 'function saveReceipt() {';
    html += '  if (receiptItems.length === 0) { ';
    html += '    showAlert("Ошибка", "Накладная пуста. Добавьте товары.", false); ';
    html += '    return; }';

    html += '  var noPriceCount = 0;';
    html += '  receiptItems.forEach(function(it) {';
    html += '    var catItem = itemsCatalog.find(function(c) { ';
    html += '      return c.id === it.shop_item_id; });';
    html += '    if (!catItem || parseFloat(catItem.retail_price) === 0) {';
    html += '      noPriceCount++;';
    html += '    }';
    html += '  });';
    
    html += '  if (noPriceCount > 0) {';
    html += '    showConfirm("Внимание", "Товаров без розничной цены: " + ';
    html += '    noPriceCount + ". Они не появятся в Кассе. Вернуться к ним ';
    html += '    можно в разделе «Обзор склада» (фильтр «Без цены»). ';
    html += '    Провести накладную?", function() { _doSave(); }, false);';
    html += '  } else { _doSave(); }';
    html += '}';

    html += 'function _doSave() {';
    html += '  var btn = document.getElementById("btnSaveReceipt");';
    html += '  btn.disabled = true; btn.innerText = "Сохранение...";';
    html += '  fetch("/api/warehouse/receipt/save-all", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ receipt_id: receiptId, ';
    html += '  items: receiptItems }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(d) {';
    html += '    if (d.ok) { ';
    html += '      showAlert("Готово", "Накладная проведена!", true); ';
    html += '      setTimeout(function() { ';
    html += '        window.location.href = "/warehouse/receipts"; ';
    html += '      }, 1500); ';
    html += '    } else { ';
    html += '      btn.disabled = false; ';
    html += '      btn.innerText = "Провести накладную"; ';
    html += '      showAlert("Ошибка", d.error || "unknown", false); }';
    html += '  }).catch(function() { ';
    html += '    btn.disabled = false; ';
    html += '    btn.innerText = "Провести накладную"; ';
    html += '    showAlert("Ошибка сети", "Проверьте интернет", false); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });
  // ====== 27. API ПОЛУЧЕНИЯ ПОЗИЦИЙ НАКЛАДНОЙ ======
  app.get('/api/warehouse/receipt/items', async (req, res) => {
    try {
      const receiptId = parseInt(req.query.id);
      if (!receiptId || isNaN(receiptId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      const r = await pool.query(
        'SELECT ri.id, ri.qty, ri.unit_cost, ri.sum, ri.shop_item_id, ' +
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

  // ====== 28. API ДОБАВЛЕНИЯ ПОЗИЦИИ ======
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
      if (checkR.rows.length === 0 || checkR.rows[0].status !== 'draft') {
        return res.json({ ok: false, error: 'Накладная не черновик' });
      }

      const name = capWords(String(req.body.name || '').trim());
      const numQty = parseFloat(String(req.body.qty).replace(',', '.'));
      const numPrice = parseFloat(String(req.body.price).replace(',', '.'));
      const numRetail = parseFloat(String(req.body.retail)
        .replace(',', '.')) || 0; // Правка 3: 0 разрешен

      if (!name || isNaN(numQty) || isNaN(numPrice) || 
          numQty <= 0 || numPrice <= 0) {
        return res.json({ ok: false, error: 'Неверные данные' });
      }

      const catId = req.body.cat_id ? parseInt(req.body.cat_id) : null;
      const unit = req.body.unit || 'шт';
      const photoUrl = req.body.photo_url || null;

      let itemRes = await pool.query(
        'SELECT id FROM wh_items WHERE name = $1', [name]
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
        if (photoUrl) await pool.query(
          'UPDATE wh_items SET photo_url = $1 WHERE id = $2', 
          [photoUrl, itemId]
        );
      }

      let shopItemRes = await pool.query(
        'SELECT id FROM wh_shop_items WHERE shop_id = $1 AND item_id = $2', 
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
      } else { shopItemId = shopItemRes.rows[0].id; }

      const sum = Math.round(numQty * numPrice * 100) / 100;

      const existing = await pool.query(
        'SELECT id, qty, sum FROM wh_receipt_items ' +
        'WHERE receipt_id = $1 AND shop_item_id = $2', 
        [receiptId, shopItemId]
      );
      if (existing.rows.length > 0) {
        const ex = existing.rows[0];
        const exQty = parseFloat(ex.qty); const exSum = parseFloat(ex.sum);
        const newQty = exQty + numQty; const newSum = exSum + sum;
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
        'UPDATE wh_receipts SET total_sum = total_sum + $1, ' +
        'updated_at = NOW() WHERE id = $2', 
        [sum, receiptId]
      );
      
      await pool.query(
        'UPDATE wh_shop_items SET retail_price = $1 WHERE id = $2', 
        [numRetail, shopItemId]
      );

      const items = await pool.query(
        'SELECT ri.id, ri.qty, ri.unit_cost, ri.sum, ri.shop_item_id, ' +
        'COALESCE(shi.custom_name, i.name) as name ' +
        'FROM wh_receipt_items ri ' +
        'JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE ri.receipt_id = $1', [receiptId]
      );
      res.json({ ok: true, items: items.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ====== 29. API СОХРАНЕНИЯ И ПРОВЕДЕНИЯ ======
  app.post('/api/warehouse/receipt/save-all', async (req, res) => {
    const client = await pool.connect();
    try {
      const receiptId = parseInt(req.body.receipt_id);
      const items = req.body.items;
      
      if (!receiptId || isNaN(receiptId) || !Array.isArray(items)) {
        client.release(); 
        return res.json({ ok: false, error: 'Неверные данные' });
      }

      await client.query('BEGIN');
      const checkR = await client.query(
        'SELECT status FROM wh_receipts WHERE id = $1 FOR UPDATE', 
        [receiptId]
      );
      if (checkR.rows.length === 0 || 
          checkR.rows[0].status !== 'draft') {
        await client.query('ROLLBACK'); client.release();
        return res.json({ 
          ok: false, error: 'Накладная не найдена или уже проведена' 
        });
      }

      await client.query(
        'DELETE FROM wh_receipt_items WHERE receipt_id = $1', 
        [receiptId]
      );

      let totalSum = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const qty = parseFloat(it.qty);
        const price = parseFloat(it.unit_cost);
        const sum = Math.round(qty * price * 100) / 100;
        totalSum += sum;

        await client.query(
          'INSERT INTO wh_receipt_items (receipt_id, shop_item_id, ' +
          'qty, unit_cost, sum) VALUES ($1, $2, $3, $4, $5)',
          [receiptId, it.shop_item_id, qty, price, sum]
        );
      }
      await client.query(
        'UPDATE wh_receipts SET total_sum = $1 WHERE id = $2', 
        [totalSum, receiptId]
      );

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const curr = await client.query(
          'SELECT current_stock, avg_cost FROM wh_shop_items ' +
          'WHERE id = $1 FOR UPDATE', [it.shop_item_id]
        );
        let oldStock = parseFloat(curr.rows[0].current_stock) || 0;
        let oldAvg = parseFloat(curr.rows[0].avg_cost) || 0;
        let qty = parseFloat(it.qty) || 0;
        let price = parseFloat(it.unit_cost) || 0;

        let newStock = oldStock + qty;
        let newAvg = 0;
        if (newStock > 0) { 
          newAvg = (oldStock * oldAvg + qty * price) / newStock; 
          newAvg = Math.round(newAvg * 100) / 100; 
        }

        await client.query(
          'UPDATE wh_shop_items SET current_stock = $1, ' +
          'last_cost = $2, avg_cost = $3 WHERE id = $4',
          [newStock, price, newAvg, it.shop_item_id]
        );
      }

      // Правка 9: Обновляем updated_at
      await client.query(
        'UPDATE wh_receipts SET status = \'completed\', ' +
        'updated_at = NOW() WHERE id = $1', [receiptId]
      );
      await client.query('COMMIT');
      client.release();

      await logAction('kupidon', null, 'receipt', 
        'Проведена накладная ID ' + receiptId, receiptId);
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 30. ЭКРАН СПИСАНИЯ ======
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
    
    // Правка 10: Поиск с крестиком
    html += '.search-wrap { position: relative; margin-bottom: 15px; }';
    html += '.search { width: 100%; padding: 15px; border: none; ';
    html += 'border-radius: 12px; box-sizing: border-box; ';
    html += 'font-family: inherit; font-size: 16px; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.clear-search { position: absolute; right: 15px; ';
    html += 'top: 50%; transform: translateY(-50%); ';
    html += 'font-size: 20px; color: #aaa; cursor: pointer; ';
    html += 'display: none; background: none; border: none; padding: 0; }';
    
    // Правка 3: Выпадающий список с остатками
    html += '.dropdown-list { position: absolute; top: 100%; left: 0; ';
    html += 'right: 0; background: #fff; border: 1px solid #eee; ';
    html += 'border-radius: 12px; margin-top: 5px; z-index: 100; ';
    html += 'box-shadow: 0 4px 15px rgba(0,0,0,0.1); ';
    html += 'max-height: 250px; overflow-y: auto; display: none; }';
    html += '.dd-item { padding: 12px 15px; border-bottom: 1px solid #eee; ';
    html += 'cursor: pointer; display: flex; justify-content: space-between; ';
    html += 'align-items: center; }';
    html += '.dd-item:last-child { border-bottom: none; }';
    html += '.dd-name { font-weight: 600; font-size: 14px; ';
    html += 'color: ' + brandColor + '; }';
    html += '.dd-stock { font-size: 12px; font-weight: 800; }';

    html += '.grid { display: grid; grid-template-columns: ';
    html += 'repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; ';
    html += 'margin-bottom: 15px; }';
    html += '.card { background: #fff; padding: 10px; ';
    html += 'border-radius: 16px; text-align: center; ';
    html += 'cursor: pointer; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
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
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); ';
    html += 'display: none; border-left: 4px solid ';
    html += accentColor + '; }';
    
    html += '.b-row { display: grid; grid-template-columns: 1fr 90px 20px; ';
    html += 'gap: 5px; align-items: center; margin-bottom: 6px; ';
    html += 'font-size: 13px; padding-bottom: 6px; ';
    html += 'border-bottom: 1px solid #eee; }';
    html += '.qty-btn { background: #F0F4F4; border: none; width: 26px; ';
    html += 'height: 26px; border-radius: 6px; font-weight: bold; ';
    html += 'font-size: 14px; color: ' + brandColor + '; }';
    html += '.qty-input { width: 30px; height: 26px; text-align: center; ';
    html += 'font-size: 13px; font-weight: bold; border: 1px solid #ddd; ';
    html += 'border-radius: 6px; padding: 0; margin: 0; }';

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
    html += 'border-radius:12px; border:none; ';
    html += 'margin-bottom:15px; font-family:inherit; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06);"></textarea>';
    
    html += '<label style="font-size:13px; font-weight:600; ';
    html += 'color:#666;">Фото (необязательно)</label>';
    html += '<input type="file" id="wPhoto" accept="image/*" ';
    html += 'style="margin-bottom:15px; box-shadow: none; padding: 0;">';
    
    html += '<button class="btn-save" id="btnSaveWriteoff" ';
    html += 'onclick="saveWriteoff()">Списать всё</button>';
    html += '</div>';

    html += '<div class="search-wrap">';
    html += '<input type="text" class="search" id="search" ';
    html += 'placeholder="🔍 Поиск..." oninput="onSearchInput()" ';
    html += 'autocomplete="off">';
    html += '<button class="clear-search" id="clearSearch" ';
    html += 'onclick="clearSearchText()">✕</button>';
    html += '<div class="dropdown-list" id="ddList"></div>';
    html += '</div>';

    html += '<div class="grid" id="itemsGrid"></div>';

    html += '<div class="custom-modal-overlay" id="qtyModal">';
    html += '<div class="custom-modal">';
    html += '<h3 style="margin-top:0;">Сколько списать?</h3>';
    html += '<input type="number" id="qtyInput" inputmode="decimal" ';
    html += 'style="font-size:24px; text-align:center; width:100%; ';
    html += 'box-sizing:border-box; padding:12px; ';
    html += 'border:none; border-radius:10px; ';
    html += 'margin-bottom:15px; font-family:inherit; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06);">';
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
    html += '.then(function(d) { allItems = d.items; renderGrid(); })';
    html += '.catch(function() {});';

    html += 'document.addEventListener("click", function(e) {';
    html += '  var dd = document.getElementById("ddList");';
    html += '  var inp = document.getElementById("search");';
    html += '  if (dd && inp && e.target !== dd && ';
    html += '  e.target !== inp && !dd.contains(e.target)) {';
    html += '    dd.style.display = "none";';
    html += '  }';
    html += '});';

    html += 'function onSearchInput() {';
    html += '  var q = document.getElementById("search").value.toLowerCase();';
    html += '  var dd = document.getElementById("ddList");';
    html += '  var btn = document.getElementById("clearSearch");';
    html += '  while(dd.firstChild) dd.removeChild(dd.firstChild);';

    html += '  if (q.length > 0) { btn.style.display = "block"; }';
    html += '  else { btn.style.display = "none"; }';

    html += '  if (q.length > 0) {';
    html += '    var found = allItems.filter(function(i) { ';
    html += '      return i.name.toLowerCase().includes(q); }).slice(0, 20);';
    
    html += '    if (found.length > 0) {';
    html += '      found.forEach(function(i) {';
    html += '        var row = document.createElement("div"); ';
    html += '        row.className = "dd-item";';
    html += '        var nm = document.createElement("div"); ';
    html += '        nm.className = "dd-name"; nm.textContent = i.name;';
    html += '        var st = document.createElement("div"); ';
    html += '        st.className = "dd-stock"; ';
    html += '        var s = parseFloat(i.current_stock);';
    html += '        st.textContent = fmtNum(s) + " " + (i.unit || "шт");';
    html += '        st.style.color = s > 0 ? "' + successColor + '" : "';
    html += dangerColor + '";';
    html += '        row.appendChild(nm); row.appendChild(st);';
    html += '        row.onclick = function() { ';
    html += '          document.getElementById("search").value = "";';
    html += '          document.getElementById("clearSearch")';
    html += '          .style.display = "none";';
    html += '          dd.style.display = "none"; ';
    html += '          addToBasket(i); };';
    html += '        dd.appendChild(row);';
    html += '      });';
    html += '      dd.style.display = "block";';
    html += '    } else { dd.style.display = "none"; }';
    html += '  } else { dd.style.display = "none"; }';
    
    html += '  renderGrid();';
    html += '}';

    html += 'function clearSearchText() {';
    html += '  document.getElementById("search").value = "";';
    html += '  document.getElementById("clearSearch").style.display = "none";';
    html += '  document.getElementById("ddList").style.display = "none";';
    html += '  renderGrid();';
    html += '}';

    html += 'function renderGrid() {';
    html += '  var q = document.getElementById("search").value.toLowerCase();';
    html += '  var items = allItems.filter(function(i) { ';
    html += '    return i.name.toLowerCase().includes(q); });';
    html += '  drawCards(items);';
    html += '}';

    html += 'function drawCards(items) {';
    html += '  var g = document.getElementById("itemsGrid");';
    html += '  while (g.firstChild) g.removeChild(g.firstChild);';
    html += '  items.forEach(function(i) {';
    html += '    var d = document.createElement("div");';
    html += '    d.className = "card";';
    html += '    if (i.photo_url) { ';
    html += '      var img = document.createElement("img"); ';
    html += '      img.src = i.photo_url; d.appendChild(img); } ';
    html += '    else { ';
    html += '      var ph = document.createElement("div"); ';
    html += '      ph.className = "ph"; ph.innerHTML = svgPh; ';
    html += '      d.appendChild(ph); }';
    
    html += '    var nm = document.createElement("div");';
    html += '    nm.className = "name"; nm.textContent = i.name;';
    html += '    var st = document.createElement("div");';
    html += '    st.className = "stock";';
    html += '    st.textContent = "Ост: " + ';
    html += '    fmtNum(i.current_stock) + " " + (i.unit || "шт");';
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

    html += 'function changeQty(idx, delta) {';
    html += '  cart[idx].qty += delta;';
    html += '  if (cart[idx].qty <= 0) {';
    html += '    showConfirm("Удаление", "Убрать товар из списка?", ';
    html += '    function() {';
    html += '      cart.splice(idx, 1); renderBasket();';
    html += '    }, true);';
    html += '  } else { renderBasket(); }';
    html += '}';

    html += 'function renderBasket() {';
    html += '  var b = document.getElementById("basket");';
    html += '  var list = document.getElementById("bList");';
    html += '  if (cart.length === 0) { ';
    html += '    b.style.display = "none"; return; }';
    html += '  b.style.display = "block"; ';
    html += '  while(list.firstChild) list.removeChild(list.firstChild);';
    html += '  cart.forEach(function(item, idx) {';
    html += '    var div = document.createElement("div"); ';
    html += '    div.className = "b-row";';
    html += '    var n = document.createElement("div"); ';
    html += '    n.textContent = item.name;';
    html += '    var ctrl = document.createElement("div"); ';
    html += '    ctrl.style = "display:flex; gap:2px; align-items:center;";';
    html += '    var mn = document.createElement("button"); ';
    html += '    mn.textContent = "-"; mn.className = "qty-btn"; ';
    html += '    mn.onclick = function() { changeQty(idx, -1); };';
    html += '    var inp = document.createElement("input"); ';
    html += '    inp.type = "number"; inp.className = "qty-input"; ';
    html += '    inp.value = item.qty; inp.readOnly = true;';
    html += '    var pl = document.createElement("button"); ';
    html += '    pl.textContent = "+"; pl.className = "qty-btn"; ';
    html += '    pl.onclick = function() { changeQty(idx, 1); };';
    html += '    ctrl.appendChild(mn); ctrl.appendChild(inp); ';
    html += '    ctrl.appendChild(pl);';
    
    // Правка 4 и 5: Создание del и защита от удаления
    html += '    var del = document.createElement("span"); ';
    html += '    del.textContent = "✕"; ';
    html += '    del.style = "color:red; cursor:pointer; font-size:18px;";';
    html += '    del.onclick = function() { ';
    html += '      showConfirm("Удаление", "Убрать " + item.name + "?", ';
    html += '      function() { ';
    html += '        cart.splice(idx, 1); renderBasket(); ';
    html += '      }, true); ';
    html += '    };';
    
    html += '    div.appendChild(n); div.appendChild(ctrl); ';
    html += '    div.appendChild(del); list.appendChild(div);';
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
    html += '      showAlert("Готово", "Успешно списано!", true);';
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
    html += '    showAlert("Ошибка сети", "Проверьте интернет", false);';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 31. API СПИСАНИЯ ======
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
        // Минусовой остаток разрешен
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
      await logAction(req.body.shopId, chatId, 'writeoff', 
        'Списание: ' + itemName + ' (и др.)', wId);

      const shopRes = await pool.query(
        'SELECT settings FROM shops WHERE shop_id = $1', 
        [req.body.shopId]
      );
      let threshold = 1000;
      if (shopRes.rows.length > 0 && shopRes.rows[0].settings) {
        threshold = shopRes.rows[0].settings.writeoff_threshold || 1000;
      }
      if (totalLoss >= threshold) {
        await notifyOwner(bot, req.body.shopId, 
          '🗑 Крупное списание на ' + Math.round(totalLoss) + ' ₽', 
          'writeoff');
      }

      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 32. API ЗАГРУЗКИ ФОТО (S3) ======
  app.post('/api/warehouse/upload', async (req, res) => {
    try {
      if (!s3) {
        return res.status(503).json({ 
          ok: false, error: 'S3 не настроен на сервере' 
        });
      }
      
      const base64Data = req.body.image;
      if (!base64Data) return res.json({ ok: false, error: 'Нет фото' });

      const base64Image = base64Data.split(';base64,').pop();
      const buffer = Buffer.from(base64Image, 'base64');
      const key = 'wh_' + Date.now() + '_' + 
        Math.random().toString(36).slice(2, 6) + '.jpg';
      
      const cmd = new PutObjectCommand({ 
        Bucket: YC_BUCKET, Key: key, 
        Body: buffer, ContentType: 'image/jpeg' 
      });
      await s3.send(cmd);
      const url = 'https://' + YC_BUCKET + 
        '.storage.yandexcloud.net/' + key;
      
      let urlBackup = null;
      if (s3backup && BC_BUCKET && BC_ENDPOINT) {
        try {
          const cmd2 = new PutObjectCommand({ 
            Bucket: BC_BUCKET, Key: key, 
            Body: buffer, ContentType: 'image/jpeg' 
          });
          await s3backup.send(cmd2);
          urlBackup = BC_ENDPOINT + '/' + BC_BUCKET + '/' + key;
        } catch (err) {}
      }
      
      res.json({ ok: true, url: url, urlBackup: urlBackup });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 33. API ДОКУМЕНТОВ ======
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
          'SELECT w.id, w.date, w.qty as amount, w.reason, ' +
          'a.name as author, ' +
          'COALESCE(shi.custom_name, i.name) as item_name ' +
          'FROM wh_writeoffs w ' +
          'LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
          'LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ' +
          'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
          'WHERE w.shop_id = $1 ORDER BY w.date DESC LIMIT 50', [shopId]
        );
        res.json({ ok: true, docs: r.rows });
      }
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // ====== 34. ЭКРАН ДОКУМЕНТОВ ======
  app.get('/warehouse/documents', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } ';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    html += '.tabs { display: flex; gap: 10px; margin-bottom: 15px; } ';
    html += '.tab { flex: 1; padding: 12px; border: 1px solid #ddd; ';
    html += 'border-radius: 12px; background: #fff; text-align: center; ';
    html += 'cursor: pointer; text-decoration: none; font-weight: 600; ';
    html += 'color: ' + brandColor + '; }';
    html += '.tab.active { background: ' + brandColor + '; color: #fff; } ';
    html += '.doc { background: #fff; border-radius: 12px; padding: 15px; ';
    html += 'margin-bottom: 10px; text-decoration: none; color: ' + 
            brandColor + '; display: flex; justify-content: space-between; ';
    html += 'align-items: center; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.doc.receipt { border-left: 4px solid #3C7A89; } ';
    html += '.doc.writeoff { border-left: 4px solid ' + accentColor + '; } ';
    html += '.meta { font-size: 12px; color: #888; margin-top: 4px; } ';
    html += '.amount { font-weight: 800; font-size: 16px; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h2 style="margin:0; display:flex; align-items:center;">' + 
            getIconSvg('docs') + 'Документы</h2></div>';
    html += '<div class="tabs"><a href="/warehouse/documents?type=receipts" ';
    html += 'class="tab" id="tab-receipts">Приходы</a>';
    html += '<a href="/warehouse/documents?type=writeoffs" class="tab" ';
    html += 'id="tab-writeoffs">Списания</a></div><div id="list">';
    html += 'Загрузка...</div>';

    html += '<script>';
    html += 'function translateReason(r) { ';
    html += 'var map = { spoilage: "Порча", loss: "Потеря", ';
    html += 'markdown: "Уценка", sorting: "Пересорт" }; ';
    html += 'return map[r] || r; }';
    html += 'function fmtNum(n) { var num = parseFloat(n); ';
    html += 'if (isNaN(num)) return "0"; return num % 1 === 0 ? ';
    html += 'num.toString() : num.toFixed(3).replace(/0+$/, "")';
    html += '.replace(/\\.$/, ""); }';
    html += 'var currentType = new URLSearchParams(window.location.search)';
    html += '.get("type") || "receipts";';
    html += 'var tab = document.getElementById("tab-" + currentType); ';
    html += 'if (tab) tab.classList.add("active");';
    html += 'fetch("/api/warehouse/documents?shop=kupidon&type=" + ';
    html += 'currentType).then(function(r){return r.json();})';
    html += '.then(function(d){';
    html += '  var b = document.getElementById("list"); ';
    html += '  while(b.firstChild) b.removeChild(b.firstChild); ';
    html += '  if (!d.ok) { b.textContent = "Ошибка"; return; } ';
    html += '  if (d.docs.length === 0) { ';
    html += '  b.textContent = "Документов нет"; return; }';
    html += '  d.docs.forEach(function(doc){ ';
    html += '    var a = document.createElement("a"); ';
    html += '    a.className = "doc " + (currentType === "receipts" ? ';
    html += '    "receipt" : "writeoff"); ';
    html += '    a.href = "/warehouse/documents/details?id=" + doc.id + ';
    html += '    "&type=" + currentType;';
    html += '    var ds = new Date(doc.date).toLocaleString("ru-RU"); ';
    html += '    var author = doc.author || "Система"; ';
    html += '    var left = document.createElement("div"); ';
    html += '    var title = document.createElement("b"); ';
    html += '    var meta = document.createElement("div"); ';
    html += '    var amount = document.createElement("div"); ';
    html += '    meta.className = "meta"; amount.className = "amount";';
    html += '    if (currentType === "receipts") { ';
    html += '      title.textContent = "Накладная №" + doc.id; ';
    html += '      meta.textContent = ds + " · " + author; ';
    html += '      amount.textContent = parseFloat(doc.amount)';
    html += '      .toLocaleString("ru-RU") + " ₽"; ';
    html += '      amount.style.color = "#3C7A89"; ';
    html += '    } else { ';
    html += '      title.textContent = "Акт списания №" + doc.id; ';
    html += '      var itm = doc.item_name || ""; ';
    html += '      var reason = translateReason(doc.reason); ';
    html += '      meta.textContent = ds + " · " + author + " (" + ';
    html += '      itm + " / " + reason + ")"; ';
    html += '      amount.textContent = "-" + fmtNum(doc.amount) + " шт"; ';
    html += '      amount.style.color = "' + accentColor + '"; }';
    html += '    left.appendChild(title); left.appendChild(meta); ';
    html += '    a.appendChild(left); a.appendChild(amount); ';
    html += '    b.appendChild(a); });';
    html += '}).catch(function(){ ';
    html += 'document.getElementById("list").textContent = "Ошибка"; });';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 35. API ДЕТАЛЕЙ ДОКУМЕНТА ======
  app.get('/api/warehouse/documents/details', async (req, res) => {
    try {
      const id = parseInt(req.query.id); const type = req.query.type;
      if (!id || isNaN(id)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      if (type === 'receipts') {
        const header = await pool.query(
          'SELECT r.id, r.date, r.total_sum, r.status, ' +
          'a.name as author FROM wh_receipts r ' +
          'LEFT JOIN admins a ON a.chat_id = r.chat_id WHERE r.id = $1', 
          [id]
        );
        const items = await pool.query(
          'SELECT ri.shop_item_id, ri.qty, ri.unit_cost, ri.sum, ' +
          'COALESCE(shi.custom_name, i.name) as name ' +
          'FROM wh_receipt_items ri ' +
          'LEFT JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
          'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
          'WHERE ri.receipt_id = $1', [id]
        );
        res.json({ ok: true, header: header.rows[0], items: items.rows });
      } else {
        const header = await pool.query(
          'SELECT w.id, w.date, w.qty as total_sum, w.reason, ' +
          'a.name as author FROM wh_writeoffs w ' +
          'LEFT JOIN admins a ON a.chat_id = w.chat_id WHERE w.id = $1', 
          [id]
        );
        const items = await pool.query(
          'SELECT w.shop_item_id, w.qty, 0 as unit_cost, 0 as sum, ' +
          'COALESCE(shi.custom_name, i.name) as name ' +
          'FROM wh_writeoffs w ' +
          'LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ' +
          'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
          'WHERE w.id = $1', [id]
        );
        res.json({ ok: true, header: header.rows[0], items: items.rows });
      }
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ====== 36. ЭКРАН ДЕТАЛЕЙ ДОКУМЕНТА ======
  app.get('/warehouse/documents/details', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } .back { font-size: 24px; ';
    html += 'text-decoration: none; color: ' + brandColor + '; ';
    html += 'margin-right: 15px; }';
    html += '.card { background: #fff; border-radius: 16px; ';
    html += 'padding: 20px; margin-bottom: 15px; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.item-row { display: flex; justify-content: space-between; ';
    html += 'padding: 12px 0; border-bottom: 1px solid #eee; ';
    html += 'text-decoration: none; color: ' + brandColor + '; } ';
    html += '.item-row:last-child { border-bottom: none; } ';
    html += '.item-name { font-weight: 600; } ';
    html += '.item-qty { text-align: right; font-weight: 800; }';
    html += '.total-row { margin-top: 15px; padding-top: 15px; ';
    html += 'border-top: 2px solid ' + brandColor + '; display: flex; ';
    html += 'justify-content: space-between; font-size: 18px; ';
    html += 'font-weight: 800; }';
    html += '.btn-cancel-doc { width: 100%; padding: 15px; ';
    html += 'background: #fff; border: 2px solid ' + dangerColor + '; ';
    html += 'color: ' + dangerColor + '; border-radius: 12px; ';
    html += 'font-weight: 800; font-size: 16px; margin-top: 20px; ';
    html += 'cursor: pointer; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse/documents" class="back">';
    html += '←</a><h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('docs') + 'Документ</h2></div>';
    html += '<div class="card" id="content">Загрузка...</div>';

    html += '<script>';
    html += 'function translateReason(r) { ';
    html += 'var map = { spoilage: "Порча", loss: "Потеря", ';
    html += 'markdown: "Уценка", sorting: "Пересорт" }; ';
    html += 'return map[r] || r; }';
    html += 'function fmtNum(n) { var num = parseFloat(n); ';
    html += 'if (isNaN(num)) return "0"; return num % 1 === 0 ? ';
    html += 'num.toString() : num.toFixed(3).replace(/0+$/, "")';
    html += '.replace(/\\.$/, ""); }';
    html += 'var urlParams = new URLSearchParams(window.location.search); ';
    html += 'var docId = parseInt(urlParams.get("id")) || 0; ';
    html += 'var docType = urlParams.get("type") || "receipts";';
    html += 'fetch("/api/warehouse/documents/details?id=" + docId + ';
    html += '"&type=" + docType).then(function(r){return r.json();})';
    html += '.then(function(d){';
    html += '  var content = document.getElementById("content"); ';
    html += '  while(content.firstChild) content.removeChild(content.firstChild); ';
    html += '  if (!d.ok) { content.textContent = "Ошибка: " + d.error; return; }';
    html += '  var h = d.header; ';
    html += '  var ds = new Date(h.date).toLocaleString("ru-RU"); ';
    html += '  var titleTxt = docType === "receipts" ? ';
    html += '  "Приходная накладная №" : "Акт списания №";';
    html += '  var title = document.createElement("div"); ';
    html += '  title.style = "font-size:20px; font-weight:800;"; ';
    html += '  title.textContent = titleTxt + h.id; content.appendChild(title);';
    html += '  var meta = document.createElement("div"); ';
    html += '  meta.style = "font-size:13px; color:#666; margin-bottom:15px;"; ';
    html += '  meta.textContent = ds + " · Сделал: " + (h.author || "Неизвестно"); ';
    html += '  content.appendChild(meta);';
    html += '  d.items.forEach(function(i){ ';
    html += '    var a = document.createElement("a"); ';
    html += '    a.href = "/warehouse/item?id=" + (parseInt(i.shop_item_id) || 0); ';
    html += '    a.className = "item-row"; ';
    html += '    var left = document.createElement("div"); ';
    html += '    var nm = document.createElement("div"); ';
    html += '    nm.className = "item-name"; nm.textContent = i.name; ';
    html += '    left.appendChild(nm);';
    html += '    if (docType === "receipts") { ';
    html += '      var cost = document.createElement("div"); ';
    html += '      cost.style = "font-size:12px; color:#888;"; ';
    html += '      cost.textContent = parseFloat(i.unit_cost)';
    html += '      .toLocaleString("ru-RU") + " ₽/шт"; left.appendChild(cost); ';
    html += '    } else { ';
    html += '      var rsn = document.createElement("div"); ';
    html += '      rsn.style = "font-size:12px; color:#888;"; ';
    html += '      rsn.textContent = "Причина: " + translateReason(h.reason); ';
    html += '      left.appendChild(rsn); }';
    html += '    var right = document.createElement("div"); ';
    html += '    right.className = "item-qty"; ';
    html += '    right.textContent = fmtNum(i.qty) + " шт";';
    html += '    if (docType === "receipts") { ';
    html += '      var sum = document.createElement("div"); ';
    html += '      sum.style = "font-size:12px; color:#888; font-weight:400;"; ';
    html += '      sum.textContent = parseFloat(i.sum)';
    html += '      .toLocaleString("ru-RU") + " ₽"; right.appendChild(sum); }';
    html += '    a.appendChild(left); a.appendChild(right); ';
    html += '    content.appendChild(a); });';
    html += '  var total = document.createElement("div"); ';
    html += '  total.className = "total-row";';
    html += '  var totalTxt = docType === "receipts" ? ';
    html += '  parseFloat(h.total_sum).toLocaleString("ru-RU") + " ₽" : ';
    html += '  fmtNum(h.total_sum) + " шт";';
    html += '  total.innerHTML = "<span>Итого:</span><span>" + ';
    html += '  totalTxt + "</span>"; content.appendChild(total);';
    
    // Отмена проведения
    html += '  if (docType === "receipts" && h.status === "completed") {';
    html += '    var cancelBtn = document.createElement("button"); ';
    html += '    cancelBtn.className = "btn-cancel-doc"; ';
    html += '    cancelBtn.innerText = "Отменить проведение";';
    html += '    cancelBtn.onclick = function() { ';
    html += '      showConfirm("Отмена", "Вы уверены? Товары спишутся ';
    html += '      со склада, накладная станет черновиком.", function() {';
    html += '        fetch("/api/warehouse/receipt/cancel", { ';
    html += '        method: "POST", headers: { "Content-Type": ';
    html += '        "application/json" }, body: JSON.stringify({ ';
    html += '        id: docId }) })';
    html += '        .then(function(r){return r.json();})';
    html += '        .then(function(res){ ';
    html += '        if(res.ok){ showAlert("Готово", ';
    html += '        "Накладная отменена", true); ';
    html += '        setTimeout(function(){window.location.href=';
    html += '        "/warehouse/receipts";}, 1000); } ';
    html += '        else showAlert("Ошибка", res.error, false); })';
    html += '        .catch(function(){});';
    html += '      }, true); };';
    html += '    content.appendChild(cancelBtn);';
    html += '  }';
    html += '}).catch(function(){ ';
    html += 'document.getElementById("content").textContent = ';
    html += '"Ошибка загрузки"; });';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 37. API ОТМЕНЫ ПРОВЕДЕНИЯ НАКЛАДНОЙ ======
  app.post('/api/warehouse/receipt/cancel', async (req, res) => {
    const client = await pool.connect();
    try {
      const receiptId = parseInt(req.body.id);
      if (!receiptId || isNaN(receiptId)) { 
        client.release(); 
        return res.json({ ok: false, error: 'Неверный ID' }); 
      }
      
      await client.query('BEGIN');
      const checkR = await client.query(
        'SELECT status FROM wh_receipts WHERE id = $1 FOR UPDATE', 
        [receiptId]
      );
      if (checkR.rows.length === 0 || 
          checkR.rows[0].status !== 'completed') {
        await client.query('ROLLBACK'); client.release(); 
        return res.json({ 
          ok: false, error: 'Накладная не найдена или не проведена' 
        });
      }

      const items = await client.query(
        'SELECT shop_item_id, qty FROM wh_receipt_items ' +
        'WHERE receipt_id = $1', [receiptId]
      );
      for (let i = 0; i < items.rows.length; i++) {
        const item = items.rows[i];
        await client.query(
          'UPDATE wh_shop_items SET current_stock = ' +
          'current_stock - $1 WHERE id = $2',
          [item.qty, item.shop_item_id]
        );
      }
      
      await client.query(
        'UPDATE wh_receipts SET status = \'draft\', ' +
        'updated_at = NOW() WHERE id = $1', [receiptId]
      );
      await client.query('COMMIT');
      client.release();
      
      await logAction('kupidon', null, 'receipt_cancel', 
        'Отменено проведение накладной ' + receiptId, receiptId);
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== 38. API ОТЧЁТОВ ======
  app.get('/api/warehouse/reports', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const start = req.query.start;
      const end = req.query.end;
      
      let dateFilterSales = '';
      let dateFilterWriteoffs = '';
      let dateFilterReceipts = '';
      let paramsSales = [shopId];
      let paramsWriteoffs = [shopId];
      let paramsReceipts = [shopId];

      if (start && end) {
        dateFilterSales = 'AND s.date >= $2 AND s.date <= $3 ';
        dateFilterWriteoffs = 'AND w.date >= $2 AND w.date <= $3 ';
        dateFilterReceipts = 'AND r.date >= $2 AND r.date <= $3 ';
        paramsSales.push(start, end + ' 23:59:59');
        paramsWriteoffs.push(start, end + ' 23:59:59');
        paramsReceipts.push(start, end + ' 23:59:59');
      }

      const rev = await pool.query(
        'SELECT COALESCE(SUM(real_price), 0) AS total, ' +
        'COALESCE(SUM(pay_cash), 0) as cash, ' +
        'COALESCE(SUM(pay_card), 0) as card, ' +
        'COALESCE(SUM(pay_qr), 0) as qr, COUNT(id) as count ' +
        'FROM wh_sales s WHERE s.shop_id = $1 ' + dateFilterSales,
        paramsSales
      );
      
      const cost = await pool.query(
        'SELECT COALESCE(SUM(si.qty * si.cost_at_sale), 0) AS total ' +
        'FROM wh_sale_items si ' +
        'JOIN wh_sales s ON s.id = si.sale_id ' +
        'WHERE s.shop_id = $1 ' + dateFilterSales,
        paramsSales
      );

      const loss = await pool.query(
        'SELECT COALESCE(SUM(w.qty * i.avg_cost), 0) AS total, ' +
        'w.reason ' +
        'FROM wh_writeoffs w ' +
        'JOIN wh_shop_items i ON i.id = w.shop_item_id ' +
        'WHERE w.shop_id = $1 ' + dateFilterWriteoffs +
        'GROUP BY w.reason',
        paramsWriteoffs
      );

      // Правка 4: ID товара для перехода
      const top = await pool.query(
        'SELECT shi.id as shop_item_id, ' +
        'COALESCE(shi.custom_name, i.name) as name, ' +
        'SUM(si.qty) as total_qty, ' +
        'SUM(si.qty * (s.real_price / ' +
        '(SELECT SUM(qty) FROM wh_sale_items WHERE sale_id = s.id))) ' +
        'as total_rev ' +
        'FROM wh_sale_items si ' +
        'JOIN wh_sales s ON s.id = si.sale_id ' +
        'JOIN wh_shop_items shi ON shi.id = si.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE s.shop_id = $1 ' + dateFilterSales +
        'GROUP BY shi.id, shi.custom_name, i.name ' +
        'ORDER BY total_rev DESC LIMIT 5',
        paramsSales
      );

      const receiptSum = await pool.query(
        'SELECT COALESCE(SUM(total_sum), 0) AS total ' +
        'FROM wh_receipts r ' +
        'WHERE r.shop_id = $1 AND r.status = \'completed\' ' +
        dateFilterReceipts,
        paramsReceipts
      );

      const revenue = parseFloat(rev.rows[0].total) || 0;
      const costVal = parseFloat(cost.rows[0].total) || 0;
      const profit = revenue - costVal;
      
      let losses = 0;
      let lossReasons = {};
      loss.rows.forEach(function(r) {
        let amt = parseFloat(r.total) || 0;
        losses += amt;
        lossReasons[r.reason] = amt;
      });

      let lossPercent = 0;
      if ((revenue + losses) > 0) {
        lossPercent = Math.round((losses / (revenue + losses)) * 100);
      }

      res.json({
        ok: true,
        finance: {
          revenue: revenue,
          cost: costVal,
          profit: profit,
          avg_check: rev.rows[0].count > 0 ? 
            (revenue / rev.rows[0].count) : 0,
          cash: parseFloat(rev.rows[0].cash) || 0,
          card: parseFloat(rev.rows[0].card) || 0,
          qr: parseFloat(rev.rows[0].qr) || 0,
          count: parseInt(rev.rows[0].count) || 0
        },
        losses: {
          total: losses,
          percent: lossPercent,
          reasons: lossReasons
        },
        top: top.rows,
        movement: {
          receipts: parseFloat(receiptSum.rows[0].total) || 0,
          sales: revenue,
          writeoffs: losses
        }
      });
    } catch (e) {
      console.error('Report error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  // ====== 39. ЭКРАН ОТЧЁТОВ ======
  app.get('/warehouse/reports', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } ';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    
    html += '.date-row { display: flex; gap: 10px; margin-bottom: 15px; }';
    html += '.date-row input { flex: 1; padding: 10px; border: none; ';
    html += 'border-radius: 10px; font-family: inherit; font-size: 14px; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.quick-dates { display: flex; gap: 8px; margin-bottom: 15px; }';
    html += '.q-btn { flex: 1; padding: 8px; border: 1px solid #ddd; ';
    html += 'border-radius: 10px; background: #fff; text-align: center; ';
    html += 'font-size: 12px; font-weight: 600; cursor: pointer; }';
    html += '.q-btn.active { background: ' + brandColor + '; color: #fff; }';

    html += '.tabs { display: flex; gap: 5px; margin-bottom: 15px; ';
    html += 'overflow-x: auto; padding-bottom: 5px; }';
    html += '.tab { padding: 8px 15px; border-radius: 20px; background: #fff; ';
    html += 'border: 1px solid #ddd; font-size: 13px; font-weight: 600; ';
    html += 'white-space: nowrap; cursor: pointer; color: ' + brandColor + '; }';
    html += '.tab.active { background: ' + brandColor + '; color: #fff; }';

    html += '.card { background: #fff; border-radius: 16px; padding: 20px; ';
    html += 'margin-bottom: 15px; text-align: center; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.val { font-size: 28px; font-weight: 800; }';
    html += '.blue { color: #3C7A89; } .green { color: ' + successColor + '; } ';
    html += '.red { color: ' + accentColor + '; }';
    html += '.list-item { display: flex; justify-content: space-between; ';
    html += 'padding: 10px 0; border-bottom: 1px solid #eee; font-size: 14px; }';
    html += '.list-item:last-child { border-bottom: none; }';
    html += '</style></head><body>';

    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('reports') + 'Отчёты</h2></div>';

    html += '<div class="date-row">';
    html += '<input type="date" id="dateStart" onchange="setCustom()">';
    html += '<input type="date" id="dateEnd" onchange="setCustom()">';
    html += '</div>';
    html += '<div class="quick-dates">';
    html += '<div class="q-btn" onclick="setQuick(\'today\')">Сегодня</div>';
    html += '<div class="q-btn" onclick="setQuick(\'week\')">Неделя</div>';
    html += '<div class="q-btn" onclick="setQuick(\'month\')">Месяц</div>';
    html += '<div class="q-btn" onclick="setQuick(\'all\')">Всё</div>';
    html += '</div>';

    html += '<div class="tabs">';
    html += '<div class="tab active" id="t-fin" onclick="setTab(\'fin\')">';
    html += 'Финансы</div>';
    html += '<div class="tab" id="t-loss" onclick="setTab(\'loss\')">';
    html += 'Потери</div>';
    html += '<div class="tab" id="t-top" onclick="setTab(\'top\')">';
    html += 'Топ-5</div>';
    html += '<div class="tab" id="t-move" onclick="setTab(\'move\')">';
    html += 'Движение</div>';
    html += '<div class="tab" id="t-shifts" onclick="setTab(\'shifts\')">';
    html += 'Смены</div>';
    html += '</div>';

    html += '<div id="content">Загрузка...</div>';

    html += '<script>';
    html += 'var currentTab = "fin"; var reportData = null; ';
    html += 'var shiftsData = null;';
    
    html += 'function fmtMoney(v) { ';
    html += 'return Math.round(v).toLocaleString("ru-RU") + " ₽"; }';
    html += 'function fmtNum(n) { var num = parseFloat(n); ';
    html += 'if (isNaN(num)) return "0"; return num % 1 === 0 ? ';
    html += 'num.toString() : num.toFixed(3).replace(/0+$/, "")';
    html += '.replace(/\\.$/, ""); }';

    // Правка 6: Фикс зависания при смене периода
    html += 'function setCustom() {';
    html += '  document.querySelectorAll(".q-btn").forEach(function(b){';
    html += '    b.classList.remove("active");});';
    html += '  if (currentTab === "shifts") { loadShifts(); } ';
    html += '  else { loadData(); }';
    html += '}';

    html += 'function setQuick(type) {';
    html += '  document.querySelectorAll(".q-btn").forEach(function(b){';
    html += '    b.classList.remove("active");});';
    html += '  var d = new Date(); var start = ""; var end = "";';
    html += '  var y = d.getFullYear(); ';
    html += '  var m = String(d.getMonth() + 1).padStart(2, "0");';
    html += '  var day = String(d.getDate()).padStart(2, "0");';
    html += '  end = y + "-" + m + "-" + day;';
    
    html += '  if (type === "today") { start = end; }';
    html += '  else if (type === "week") { ';
    html += '    d.setDate(d.getDate() - 7); ';
    html += '    start = d.getFullYear() + "-" + ';
    html += '    String(d.getMonth() + 1).padStart(2, "0") + "-" + ';
    html += '    String(d.getDate()).padStart(2, "0"); }';
    html += '  else if (type === "month") { ';
    html += '    d.setMonth(d.getMonth() - 1); ';
    html += '    start = d.getFullYear() + "-" + ';
    html += '    String(d.getMonth() + 1).padStart(2, "0") + "-" + ';
    html += '    String(d.getDate()).padStart(2, "0"); }';
    html += '  else if (type === "all") { start = ""; end = ""; }';
    
    html += '  document.getElementById("dateStart").value = start;';
    html += '  document.getElementById("dateEnd").value = end;';
    html += '  if (currentTab === "shifts") { loadShifts(); } ';
    html += '  else { loadData(); }';
    html += '}';

    html += 'function setTab(t) {';
    html += '  currentTab = t;';
    html += '  document.querySelectorAll(".tab").forEach(function(el){';
    html += '    el.classList.remove("active");});';
    html += '  document.getElementById("t-" + t).classList.add("active");';
    html += '  if (t === "shifts") { loadShifts(); } ';
    html += '  else if (reportData) { renderTab(); } ';
    html += '  else { loadData(); }';
    html += '}';

    html += 'function loadData() {';
    html += '  var st = document.getElementById("dateStart").value;';
    html += '  var en = document.getElementById("dateEnd").value;';
    html += '  var url = "/api/warehouse/reports?shop=kupidon";';
    html += '  if (st && en) { url += "&start=" + st + "&end=" + en; }';
    
    html += '  var c = document.getElementById("content");';
    html += '  c.textContent = "Загрузка...";';
    
    html += '  fetch(url).then(function(r){return r.json();})';
    html += '  .then(function(d){';
    html += '    if (d.ok) { reportData = d; renderTab(); }';
    html += '    else { c.textContent = "Ошибка"; }';
    html += '  }).catch(function(){ c.textContent = "Ошибка сети"; });';
    html += '}';

    html += 'function loadShifts() {';
    html += '  var c = document.getElementById("content");';
    html += '  c.textContent = "Загрузка смен...";';
    html += '  var st = document.getElementById("dateStart").value;';
    html += '  var en = document.getElementById("dateEnd").value;';
    html += '  var url = "/api/warehouse/shifts/report?shop=kupidon";';
    html += '  if (st && en) { url += "&start=" + st + "&end=" + en; }';
    
    html += '  fetch(url).then(function(r){return r.json();})';
    html += '  .then(function(d){';
    html += '    if (d.ok) { shiftsData = d.shifts; renderShifts(); }';
    html += '    else { c.textContent = "Ошибка"; }';
    html += '  }).catch(function(){ c.textContent = "Ошибка сети"; });';
    html += '}';

    html += 'function renderTab() {';
    html += '  var c = document.getElementById("content");';
    html += '  while(c.firstChild) c.removeChild(c.firstChild);';
    html += '  if (!reportData) return;';
    html += '  var f = reportData.finance; var l = reportData.losses;';
    
    html += '  if (currentTab === "fin") {';
    html += '    var card1 = document.createElement("div"); ';
    html += '    card1.className = "card";';
    html += '    var v1 = document.createElement("div"); ';
    html += '    v1.className = "val blue"; ';
    html += '    v1.textContent = fmtMoney(f.revenue);';
    html += '    var lbl1 = document.createElement("div"); ';
    html += '    lbl1.style = "font-size:14px;color:#666;"; ';
    html += '    lbl1.textContent = "Выручка (чеков: " + f.count + ")";';
    html += '    card1.appendChild(v1); card1.appendChild(lbl1); ';
    html += '    c.appendChild(card1);';

    html += '    var card2 = document.createElement("div"); ';
    html += '    card2.className = "card";';
    html += '    var v2 = document.createElement("div"); ';
    html += '    v2.className = "val green"; ';
    html += '    v2.textContent = fmtMoney(f.profit);';
    html += '    var lbl2 = document.createElement("div"); ';
    html += '    lbl2.style = "font-size:14px;color:#666;"; ';
    html += '    lbl2.textContent = "Прибыль (Себест: " + ';
    html += '    fmtMoney(f.cost) + ")";';
    html += '    card2.appendChild(v2); card2.appendChild(lbl2); ';
    html += '    c.appendChild(card2);';

    html += '    var card3 = document.createElement("div"); ';
    html += '    card3.className = "card";';
    html += '    var v3 = document.createElement("div"); ';
    html += '    v3.className = "val"; v3.style = "font-size:20px;";';
    html += '    v3.textContent = "Нал: " + fmtMoney(f.cash) + ';
    html += '    " | Карта: " + fmtMoney(f.card) + ';
    html += '    " | QR: " + fmtMoney(f.qr);';
    html += '    card3.appendChild(v3); c.appendChild(card3);';

    html += '  } else if (currentTab === "loss") {';
    html += '    var cardL = document.createElement("div"); ';
    html += '    cardL.className = "card"; ';
    html += '    cardL.style.border = "2px solid ' + accentColor + '";';
    html += '    var vL = document.createElement("div"); ';
    html += '    vL.className = "val red"; ';
    html += '    vL.textContent = fmtMoney(l.total);';
    html += '    var lblL = document.createElement("div"); ';
    html += '    lblL.style = "font-size:14px;color:#666;"; ';
    html += '    lblL.textContent = "Потери (" + l.percent + ';
    html += '    "% от закупок)";';
    html += '    cardL.appendChild(vL); cardL.appendChild(lblL); ';
    html += '    c.appendChild(cardL);';

    html += '    var reasons = { spoilage: "Порча", loss: "Потеря", ';
    html += '    markdown: "Уценка", sorting: "Пересорт" };';
    html += '    var listCard = document.createElement("div"); ';
    html += '    listCard.className = "card";';
    html += '    for (var key in reasons) {';
    html += '      var amt = l.reasons[key] || 0;';
    html += '      if (amt > 0) {';
    html += '        var row = document.createElement("div"); ';
    html += '        row.className = "list-item";';
    html += '        var n = document.createElement("span"); ';
    html += '        n.textContent = reasons[key];';
    html += '        var v = document.createElement("span"); ';
    html += '        v.style = "font-weight:800; color:' + dangerColor + ';";';
    html += '        v.textContent = fmtMoney(amt);';
    html += '        row.appendChild(n); row.appendChild(v); ';
    html += '        listCard.appendChild(row);';
    html += '      }';
    html += '    }';
    html += '    c.appendChild(listCard);';

    html += '  } else if (currentTab === "top") {';
    html += '    var topCard = document.createElement("div"); ';
    html += '    topCard.className = "card";';
    html += '    if (reportData.top.length === 0) {';
    html += '      topCard.textContent = "Нет продаж";';
    html += '    } else {';
    html += '      reportData.top.forEach(function(t, idx) {';
    html += '        var row = document.createElement("a"); ';
    html += '        row.className = "list-item";';
    html += '        row.style.textDecoration = "none"; ';
    html += '        row.style.color = "' + brandColor + '";';
    html += '        row.href = "/warehouse/item?id=" + t.shop_item_id;';
    html += '        var n = document.createElement("span"); ';
    html += '        n.textContent = (idx+1) + ". " + t.name + ';
    html += '        " (" + fmtNum(t.total_qty) + " шт) →";';
    html += '        var v = document.createElement("span"); ';
    html += '        v.style = "font-weight:800; color:' + successColor + ';";';
    html += '        v.textContent = fmtMoney(t.total_rev);';
    html += '        row.appendChild(n); row.appendChild(v); ';
    html += '        topCard.appendChild(row);';
    html += '      });';
    html += '    }';
    html += '    c.appendChild(topCard);';

    html += '  } else if (currentTab === "move") {';
    html += '    var m = reportData.movement;';
    html += '    var mCard = document.createElement("div"); ';
    html += '    mCard.className = "card";';
    
    html += '    var r1 = document.createElement("div"); ';
    html += '    r1.className = "list-item";';
    html += '    r1.innerHTML = "<span>Приход (закупка)</span><span ';
    html += '    style=\'color:' + successColor + ';font-weight:800;\'>" + ';
    html += '    fmtMoney(m.receipts) + "</span>"; mCard.appendChild(r1);';
    
    html += '    var r2 = document.createElement("div"); ';
    html += '    r2.className = "list-item";';
    html += '    r2.innerHTML = "<span>Продажи (выручка)</span><span ';
    html += '    style=\'color:#3C7A89;font-weight:800;\'>" + ';
    html += '    fmtMoney(m.sales) + "</span>"; mCard.appendChild(r2);';
    
    html += '    var r3 = document.createElement("div"); ';
    html += '    r3.className = "list-item";';
    html += '    r3.innerHTML = "<span>Списания (потери)</span><span ';
    html += '    style=\'color:' + dangerColor + ';font-weight:800;\'>-" + ';
    html += '    fmtMoney(m.writeoffs) + "</span>"; mCard.appendChild(r3);';
    
    html += '    c.appendChild(mCard);';
    html += '  }';
    html += '}';

    html += 'function renderShifts() {';
    html += '  var c = document.getElementById("content");';
    html += '  while(c.firstChild) c.removeChild(c.firstChild);';
    
    html += '  if (!shiftsData || shiftsData.length === 0) {';
    html += '    c.textContent = "Нет закрытых смен за период"; return;';
    html += '  }';
    
    html += '  shiftsData.forEach(function(s) {';
    html += '    var card = document.createElement("div"); ';
    html += '    card.className = "card";';
    html += '    card.style.textAlign = "left";';
    html += '    card.style.marginBottom = "10px";';
    
    html += '    var title = document.createElement("div");';
    html += '    title.style = "font-weight:800; font-size:16px; ';
    html += '    margin-bottom:5px;";';
    html += '    title.textContent = "Смена: " + (s.author || "Флорист");';
    html += '    card.appendChild(title);';
    
    html += '    var ds = new Date(s.open_time).toLocaleString("ru-RU");';
    html += '    var de = s.close_time ? ';
    html += '    new Date(s.close_time).toLocaleString("ru-RU") : "Открыта";';
    html += '    var timeDiv = document.createElement("div");';
    html += '    timeDiv.style = "font-size:12px; color:#888; ';
    html += '    margin-bottom:10px;";';
    html += '    timeDiv.textContent = "С: " + ds + " По: " + de;';
    html += '    card.appendChild(timeDiv);';
    
    html += '    var row = document.createElement("div");';
    html += '    row.className = "list-item";';
    html += '    row.innerHTML = "<span>Выручка:</span><b>" + ';
    html += '    fmtMoney(s.total_sales) + "</b>";';
    html += '    card.appendChild(row);';
    
    html += '    var disp = parseFloat(s.discrepancy) || 0;';
    html += '    var dispColor = disp === 0 ? "' + successColor + '" : "';
    html += dangerColor + '";';
    html += '    var row2 = document.createElement("div");';
    html += '    row2.className = "list-item";';
    html += '    row2.innerHTML = "<span>Расхождение кассы:</span>';
    html += '    <b style=\'color:" + dispColor + "\'>" + ';
    html += '    fmtMoney(disp) + "</b>";';
    html += '    card.appendChild(row2);';
    
    html += '    c.appendChild(card);';
    html += '  });';
    html += '}';

    html += 'setQuick("month");';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 40. API СМЕН ДЛЯ ОТЧЕТА ======
  app.get('/api/warehouse/shifts/report', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const start = req.query.start;
      const end = req.query.end;
      
      let dateFilter = '';
      let params = [shopId];

      if (start && end) {
        dateFilter = 'AND s.open_time >= $2 AND s.open_time <= $3 ';
        params.push(start, end + ' 23:59:59');
      }

      const r = await pool.query(
        'SELECT s.id, s.open_time, s.close_time, ' +
        's.total_sales, s.discrepancy, a.name as author ' +
        'FROM wh_shifts s ' +
        'LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'WHERE s.shop_id = $1 AND s.status = \'closed\' ' +
        dateFilter + 'ORDER BY s.open_time DESC LIMIT 50',
        params
      );
      res.json({ ok: true, shifts: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 41. API ФЛОРИСТОВ ======
  app.get('/api/warehouse/staff', async (req, res) => {
    try {
      const cookie = req.headers.cookie || ''; 
      const match = cookie.match(/wh_auth=(\d+)/); 
      const chatId = match ? Number(match[1]) : null;
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]
      );
      if (!ownerCheck.rows[0] || ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false, error: 'Только владелец' });
      }
      const r = await pool.query(
        'SELECT a.name, a.warehouse_pin, a.can_receipt, a.can_sale, ' +
        'a.can_writeoff, a.chat_id, COALESCE(SUM(s.real_price), 0) ' +
        'as total_sales FROM admins a ' +
        'LEFT JOIN wh_sales s ON a.chat_id = s.chat_id ' +
        'WHERE a.shop_id = $1 AND a.role = \'florist\' ' +
        'GROUP BY a.chat_id, a.name, a.warehouse_pin, a.can_receipt, ' +
        'a.can_sale, a.can_writeoff', [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, staff: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 42. ЭКРАН ФЛОРИСТОВ ======
  app.get('/warehouse/staff', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } .back { font-size: 24px; ';
    html += 'text-decoration: none; color: ' + brandColor + '; ';
    html += 'margin-right: 15px; } ';
    html += '.card { background: #fff; border-radius: 16px; ';
    html += 'padding: 15px; margin-bottom: 15px; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); } ';
    html += '.name { font-size: 18px; font-weight: 800; } ';
    html += '.sales { font-size: 16px; color: ' + successColor + '; ';
    html += 'margin-top: 5px; font-weight: 600; }';
    html += '.row { display: flex; justify-content: space-between; ';
    html += 'margin-top: 10px; border-top: 1px solid #eee; ';
    html += 'padding-top: 10px; } ';
    html += '.btn-pin { margin-top:10px; padding:8px 15px; ';
    html += 'border-radius:10px; border:none; background:' + brandColor + '; ';
    html += 'color:#fff; font-weight:600; font-family:inherit; } ';
    html += 'input[type="checkbox"] { transform: scale(1.3); ';
    html += 'accent-color: ' + brandColor + '; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">';
    html += '←</a><h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('staff') + 'Флористы</h2></div><div id="list"></div>';

    html += '<script>';
    html += 'fetch("/api/warehouse/staff?shop=kupidon")';
    html += '.then(function(r){return r.json();}).then(function(d){ ';
    html += '  var b = document.getElementById("list"); ';
    html += '  if (!d.ok) { b.textContent = "Доступ запрещен"; return; } ';
    html += '  if (d.staff.length === 0) { ';
    html += '  b.textContent = "Нет флористов"; return; }';
    html += '  d.staff.forEach(function(f){ ';
    html += '    var c = document.createElement("div"); c.className = "card"; ';
    html += '    var name = f.name || "Флорист"; ';
    html += '    var nDiv = document.createElement("div"); ';
    html += '    nDiv.className = "name"; nDiv.textContent = name; ';
    html += '    c.appendChild(nDiv);';
    html += '    var sum = parseFloat(f.total_sales).toLocaleString("ru-RU"); ';
    html += '    var sDiv = document.createElement("div"); ';
    html += '    sDiv.className = "sales"; sDiv.textContent = "Продано: " + ';
    html += '    sum + " ₽"; c.appendChild(sDiv);';
    html += '    var pDiv = document.createElement("div"); ';
    html += '    pDiv.style = "font-size:12px;color:#888;"; ';
    html += '    pDiv.textContent = "PIN: " + (f.warehouse_pin || "нет"); ';
    html += '    c.appendChild(pDiv);';
    html += '    var btn = document.createElement("button"); ';
    html += '    btn.innerText = "Задать PIN"; btn.className = "btn-pin"; ';
    html += '    btn.onclick = function(){setPin(f.chat_id);}; ';
    html += '    c.appendChild(btn);';
    html += '    c.appendChild(makeCheck("Приход", "receipt", ';
    html += '    f.can_receipt, f.chat_id)); ';
    html += '    c.appendChild(makeCheck("Продажа", "sale", ';
    html += '    f.can_sale, f.chat_id)); ';
    html += '    c.appendChild(makeCheck("Списание", "writeoff", ';
    html += '    f.can_writeoff, f.chat_id)); b.appendChild(c); }); ';
    html += '}).catch(function(){});';
    html += 'function makeCheck(label, field, checked, chatId) { ';
    html += 'var r = document.createElement("div"); r.className = "row"; ';
    html += 'var sp = document.createElement("span"); sp.textContent = label; ';
    html += 'r.appendChild(sp); var cb = document.createElement("input"); ';
    html += 'cb.type = "checkbox"; cb.checked = checked; ';
    html += 'cb.onchange = function(){setRights(chatId, field, cb.checked);}; ';
    html += 'r.appendChild(cb); return r; }';
    html += 'function setPin(id) { var p = prompt("Введите 4 цифры:"); ';
    html += 'if (p && p.length === 4) { ';
    html += 'fetch("/api/warehouse/florist/pin", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shop: "kupidon", chatId: id, ';
    html += 'pin: p }) }).then(function(){location.reload();})';
    html += '.catch(function(){}); } }';
    html += 'function setRights(id, field, val) { ';
    html += 'fetch("/api/warehouse/florist/rights", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shop: "kupidon", chatId: id, ';
    html += 'field: field, val: val }) }).catch(function(){}); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 43. API ПРАВ ФЛОРИСТОВ ======
  app.post('/api/warehouse/florist/pin', async (req, res) => {
    try {
      const cookie = req.headers.cookie || ''; 
      const match = cookie.match(/wh_auth=(\d+)/); 
      const chatId = match ? Number(match[1]) : null;
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]
      );
      if (!ownerCheck.rows[0] || ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false });
      }
      await pool.query(
        'UPDATE admins SET warehouse_pin = $1 ' +
        'WHERE shop_id = $2 AND chat_id = $3', 
        [req.body.pin, req.body.shop, req.body.chatId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/florist/rights', async (req, res) => {
    try {
      const cookie = req.headers.cookie || ''; 
      const match = cookie.match(/wh_auth=(\d+)/); 
      const chatId = match ? Number(match[1]) : null;
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]
      );
      if (!ownerCheck.rows[0] || ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false });
      }
      var col = 'can_receipt'; 
      if (req.body.field === 'sale') col = 'can_sale'; 
      if (req.body.field === 'writeoff') col = 'can_writeoff';
      await pool.query(
        'UPDATE admins SET ' + col + ' = $1 ' +
        'WHERE shop_id = $2 AND chat_id = $3', 
        [req.body.val, req.body.shop, req.body.chatId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 44. API НАСТРОЕК ======
  app.get('/api/warehouse/settings', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT settings FROM shops WHERE shop_id = $1', 
        [req.query.shop || 'kupidon']
      );
      if (r.rows.length === 0) return res.json({ ok: true, settings: {} });
      res.json({ ok: true, settings: r.rows[0].settings || {} });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/settings', async (req, res) => {
    try {
      var obj = {}; obj[req.body.key] = req.body.val;
      await pool.query(
        'UPDATE shops SET settings = COALESCE(settings, \'{}\'::jsonb) ' +
        '|| $1::jsonb WHERE shop_id = $2', 
        [JSON.stringify(obj), req.body.shop || 'kupidon']
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // ====== 39. ЭКРАН ОТЧЁТОВ ======
  app.get('/warehouse/reports', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } ';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; }';
    
    html += '.date-row { display: flex; gap: 10px; margin-bottom: 15px; }';
    html += '.date-row input { flex: 1; padding: 10px; border: none; ';
    html += 'border-radius: 10px; font-family: inherit; font-size: 14px; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.quick-dates { display: flex; gap: 8px; margin-bottom: 15px; }';
    html += '.q-btn { flex: 1; padding: 8px; border: 1px solid #ddd; ';
    html += 'border-radius: 10px; background: #fff; text-align: center; ';
    html += 'font-size: 12px; font-weight: 600; cursor: pointer; }';
    html += '.q-btn.active { background: ' + brandColor + '; color: #fff; }';

    html += '.tabs { display: flex; gap: 5px; margin-bottom: 15px; ';
    html += 'overflow-x: auto; padding-bottom: 5px; }';
    html += '.tab { padding: 8px 15px; border-radius: 20px; background: #fff; ';
    html += 'border: 1px solid #ddd; font-size: 13px; font-weight: 600; ';
    html += 'white-space: nowrap; cursor: pointer; color: ' + brandColor + '; }';
    html += '.tab.active { background: ' + brandColor + '; color: #fff; }';

    html += '.card { background: #fff; border-radius: 16px; padding: 20px; ';
    html += 'margin-bottom: 15px; text-align: center; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.val { font-size: 28px; font-weight: 800; }';
    html += '.blue { color: #3C7A89; } .green { color: ' + successColor + '; } ';
    html += '.red { color: ' + accentColor + '; }';
    html += '.list-item { display: flex; justify-content: space-between; ';
    html += 'padding: 10px 0; border-bottom: 1px solid #eee; font-size: 14px; }';
    html += '.list-item:last-child { border-bottom: none; }';
    html += '</style></head><body>';

    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('reports') + 'Отчёты</h2></div>';

    html += '<div class="date-row">';
    html += '<input type="date" id="dateStart" onchange="setCustom()">';
    html += '<input type="date" id="dateEnd" onchange="setCustom()">';
    html += '</div>';
    html += '<div class="quick-dates">';
    html += '<div class="q-btn" onclick="setQuick(\'today\')">Сегодня</div>';
    html += '<div class="q-btn" onclick="setQuick(\'week\')">Неделя</div>';
    html += '<div class="q-btn" onclick="setQuick(\'month\')">Месяц</div>';
    html += '<div class="q-btn" onclick="setQuick(\'all\')">Всё</div>';
    html += '</div>';

    html += '<div class="tabs">';
    html += '<div class="tab active" id="t-fin" onclick="setTab(\'fin\')">';
    html += 'Финансы</div>';
    html += '<div class="tab" id="t-loss" onclick="setTab(\'loss\')">';
    html += 'Потери</div>';
    html += '<div class="tab" id="t-top" onclick="setTab(\'top\')">';
    html += 'Топ-5</div>';
    html += '<div class="tab" id="t-move" onclick="setTab(\'move\')">';
    html += 'Движение</div>';
    html += '<div class="tab" id="t-shifts" onclick="setTab(\'shifts\')">';
    html += 'Смены</div>';
    html += '</div>';

    html += '<div id="content">Загрузка...</div>';

    html += '<script>';
    html += 'var currentTab = "fin"; var reportData = null; ';
    html += 'var shiftsData = null;';
    
    html += 'function fmtMoney(v) { ';
    html += 'return Math.round(v).toLocaleString("ru-RU") + " ₽"; }';
    html += 'function fmtNum(n) { var num = parseFloat(n); ';
    html += 'if (isNaN(num)) return "0"; return num % 1 === 0 ? ';
    html += 'num.toString() : num.toFixed(3).replace(/0+$/, "")';
    html += '.replace(/\\.$/, ""); }';

    // Правка 6: Фикс зависания при смене периода
    html += 'function setCustom() {';
    html += '  document.querySelectorAll(".q-btn").forEach(function(b){';
    html += '    b.classList.remove("active");});';
    html += '  if (currentTab === "shifts") { loadShifts(); } ';
    html += '  else { loadData(); }';
    html += '}';

    html += 'function setQuick(type) {';
    html += '  document.querySelectorAll(".q-btn").forEach(function(b){';
    html += '    b.classList.remove("active");});';
    html += '  var d = new Date(); var start = ""; var end = "";';
    html += '  var y = d.getFullYear(); ';
    html += '  var m = String(d.getMonth() + 1).padStart(2, "0");';
    html += '  var day = String(d.getDate()).padStart(2, "0");';
    html += '  end = y + "-" + m + "-" + day;';
    
    html += '  if (type === "today") { start = end; }';
    html += '  else if (type === "week") { ';
    html += '    d.setDate(d.getDate() - 7); ';
    html += '    start = d.getFullYear() + "-" + ';
    html += '    String(d.getMonth() + 1).padStart(2, "0") + "-" + ';
    html += '    String(d.getDate()).padStart(2, "0"); }';
    html += '  else if (type === "month") { ';
    html += '    d.setMonth(d.getMonth() - 1); ';
    html += '    start = d.getFullYear() + "-" + ';
    html += '    String(d.getMonth() + 1).padStart(2, "0") + "-" + ';
    html += '    String(d.getDate()).padStart(2, "0"); }';
    html += '  else if (type === "all") { start = ""; end = ""; }';
    
    html += '  document.getElementById("dateStart").value = start;';
    html += '  document.getElementById("dateEnd").value = end;';
    html += '  if (currentTab === "shifts") { loadShifts(); } ';
    html += '  else { loadData(); }';
    html += '}';

    html += 'function setTab(t) {';
    html += '  currentTab = t;';
    html += '  document.querySelectorAll(".tab").forEach(function(el){';
    html += '    el.classList.remove("active");});';
    html += '  document.getElementById("t-" + t).classList.add("active");';
    html += '  if (t === "shifts") { loadShifts(); } ';
    html += '  else if (reportData) { renderTab(); } ';
    html += '  else { loadData(); }';
    html += '}';

    html += 'function loadData() {';
    html += '  var st = document.getElementById("dateStart").value;';
    html += '  var en = document.getElementById("dateEnd").value;';
    html += '  var url = "/api/warehouse/reports?shop=kupidon";';
    html += '  if (st && en) { url += "&start=" + st + "&end=" + en; }';
    
    html += '  var c = document.getElementById("content");';
    html += '  c.textContent = "Загрузка...";';
    
    html += '  fetch(url).then(function(r){return r.json();})';
    html += '  .then(function(d){';
    html += '    if (d.ok) { reportData = d; renderTab(); }';
    html += '    else { c.textContent = "Ошибка"; }';
    html += '  }).catch(function(){ c.textContent = "Ошибка сети"; });';
    html += '}';

    html += 'function loadShifts() {';
    html += '  var c = document.getElementById("content");';
    html += '  c.textContent = "Загрузка смен...";';
    html += '  var st = document.getElementById("dateStart").value;';
    html += '  var en = document.getElementById("dateEnd").value;';
    html += '  var url = "/api/warehouse/shifts/report?shop=kupidon";';
    html += '  if (st && en) { url += "&start=" + st + "&end=" + en; }';
    
    html += '  fetch(url).then(function(r){return r.json();})';
    html += '  .then(function(d){';
    html += '    if (d.ok) { shiftsData = d.shifts; renderShifts(); }';
    html += '    else { c.textContent = "Ошибка"; }';
    html += '  }).catch(function(){ c.textContent = "Ошибка сети"; });';
    html += '}';

    html += 'function renderTab() {';
    html += '  var c = document.getElementById("content");';
    html += '  while(c.firstChild) c.removeChild(c.firstChild);';
    html += '  if (!reportData) return;';
    html += '  var f = reportData.finance; var l = reportData.losses;';
    
    html += '  if (currentTab === "fin") {';
    html += '    var card1 = document.createElement("div"); ';
    html += '    card1.className = "card";';
    html += '    var v1 = document.createElement("div"); ';
    html += '    v1.className = "val blue"; ';
    html += '    v1.textContent = fmtMoney(f.revenue);';
    html += '    var lbl1 = document.createElement("div"); ';
    html += '    lbl1.style = "font-size:14px;color:#666;"; ';
    html += '    lbl1.textContent = "Выручка (чеков: " + f.count + ")";';
    html += '    card1.appendChild(v1); card1.appendChild(lbl1); ';
    html += '    c.appendChild(card1);';

    html += '    var card2 = document.createElement("div"); ';
    html += '    card2.className = "card";';
    html += '    var v2 = document.createElement("div"); ';
    html += '    v2.className = "val green"; ';
    html += '    v2.textContent = fmtMoney(f.profit);';
    html += '    var lbl2 = document.createElement("div"); ';
    html += '    lbl2.style = "font-size:14px;color:#666;"; ';
    html += '    lbl2.textContent = "Прибыль (Себест: " + ';
    html += '    fmtMoney(f.cost) + ")";';
    html += '    card2.appendChild(v2); card2.appendChild(lbl2); ';
    html += '    c.appendChild(card2);';

    html += '    var card3 = document.createElement("div"); ';
    html += '    card3.className = "card";';
    html += '    var v3 = document.createElement("div"); ';
    html += '    v3.className = "val"; v3.style = "font-size:20px;";';
    html += '    v3.textContent = "Нал: " + fmtMoney(f.cash) + ';
    html += '    " | Карта: " + fmtMoney(f.card) + ';
    html += '    " | QR: " + fmtMoney(f.qr);';
    html += '    card3.appendChild(v3); c.appendChild(card3);';

    html += '  } else if (currentTab === "loss") {';
    html += '    var cardL = document.createElement("div"); ';
    html += '    cardL.className = "card"; ';
    html += '    cardL.style.border = "2px solid ' + accentColor + '";';
    html += '    var vL = document.createElement("div"); ';
    html += '    vL.className = "val red"; ';
    html += '    vL.textContent = fmtMoney(l.total);';
    html += '    var lblL = document.createElement("div"); ';
    html += '    lblL.style = "font-size:14px;color:#666;"; ';
    html += '    lblL.textContent = "Потери (" + l.percent + ';
    html += '    "% от закупок)";';
    html += '    cardL.appendChild(vL); cardL.appendChild(lblL); ';
    html += '    c.appendChild(cardL);';

    html += '    var reasons = { spoilage: "Порча", loss: "Потеря", ';
    html += '    markdown: "Уценка", sorting: "Пересорт" };';
    html += '    var listCard = document.createElement("div"); ';
    html += '    listCard.className = "card";';
    html += '    for (var key in reasons) {';
    html += '      var amt = l.reasons[key] || 0;';
    html += '      if (amt > 0) {';
    html += '        var row = document.createElement("div"); ';
    html += '        row.className = "list-item";';
    html += '        var n = document.createElement("span"); ';
    html += '        n.textContent = reasons[key];';
    html += '        var v = document.createElement("span"); ';
    html += '        v.style = "font-weight:800; color:' + dangerColor + ';";';
    html += '        v.textContent = fmtMoney(amt);';
    html += '        row.appendChild(n); row.appendChild(v); ';
    html += '        listCard.appendChild(row);';
    html += '      }';
    html += '    }';
    html += '    c.appendChild(listCard);';

    html += '  } else if (currentTab === "top") {';
    html += '    var topCard = document.createElement("div"); ';
    html += '    topCard.className = "card";';
    html += '    if (reportData.top.length === 0) {';
    html += '      topCard.textContent = "Нет продаж";';
    html += '    } else {';
    html += '      reportData.top.forEach(function(t, idx) {';
    html += '        var row = document.createElement("a"); ';
    html += '        row.className = "list-item";';
    html += '        row.style.textDecoration = "none"; ';
    html += '        row.style.color = "' + brandColor + '";';
    html += '        row.href = "/warehouse/item?id=" + t.shop_item_id;';
    html += '        var n = document.createElement("span"); ';
    html += '        n.textContent = (idx+1) + ". " + t.name + ';
    html += '        " (" + fmtNum(t.total_qty) + " шт) →";';
    html += '        var v = document.createElement("span"); ';
    html += '        v.style = "font-weight:800; color:' + successColor + ';";';
    html += '        v.textContent = fmtMoney(t.total_rev);';
    html += '        row.appendChild(n); row.appendChild(v); ';
    html += '        topCard.appendChild(row);';
    html += '      });';
    html += '    }';
    html += '    c.appendChild(topCard);';

    html += '  } else if (currentTab === "move") {';
    html += '    var m = reportData.movement;';
    html += '    var mCard = document.createElement("div"); ';
    html += '    mCard.className = "card";';
    
    html += '    var r1 = document.createElement("div"); ';
    html += '    r1.className = "list-item";';
    html += '    r1.innerHTML = "<span>Приход (закупка)</span><span ';
    html += '    style=\'color:' + successColor + ';font-weight:800;\'>" + ';
    html += '    fmtMoney(m.receipts) + "</span>"; mCard.appendChild(r1);';
    
    html += '    var r2 = document.createElement("div"); ';
    html += '    r2.className = "list-item";';
    html += '    r2.innerHTML = "<span>Продажи (выручка)</span><span ';
    html += '    style=\'color:#3C7A89;font-weight:800;\'>" + ';
    html += '    fmtMoney(m.sales) + "</span>"; mCard.appendChild(r2);';
    
    html += '    var r3 = document.createElement("div"); ';
    html += '    r3.className = "list-item";';
    html += '    r3.innerHTML = "<span>Списания (потери)</span><span ';
    html += '    style=\'color:' + dangerColor + ';font-weight:800;\'>-" + ';
    html += '    fmtMoney(m.writeoffs) + "</span>"; mCard.appendChild(r3);';
    
    html += '    c.appendChild(mCard);';
    html += '  }';
    html += '}';

    html += 'function renderShifts() {';
    html += '  var c = document.getElementById("content");';
    html += '  while(c.firstChild) c.removeChild(c.firstChild);';
    
    html += '  if (!shiftsData || shiftsData.length === 0) {';
    html += '    c.textContent = "Нет закрытых смен за период"; return;';
    html += '  }';
    
    html += '  shiftsData.forEach(function(s) {';
    html += '    var card = document.createElement("div"); ';
    html += '    card.className = "card";';
    html += '    card.style.textAlign = "left";';
    html += '    card.style.marginBottom = "10px";';
    
    html += '    var title = document.createElement("div");';
    html += '    title.style = "font-weight:800; font-size:16px; ';
    html += '    margin-bottom:5px;";';
    html += '    title.textContent = "Смена: " + (s.author || "Флорист");';
    html += '    card.appendChild(title);';
    
    html += '    var ds = new Date(s.open_time).toLocaleString("ru-RU");';
    html += '    var de = s.close_time ? ';
    html += '    new Date(s.close_time).toLocaleString("ru-RU") : "Открыта";';
    html += '    var timeDiv = document.createElement("div");';
    html += '    timeDiv.style = "font-size:12px; color:#888; ';
    html += '    margin-bottom:10px;";';
    html += '    timeDiv.textContent = "С: " + ds + " По: " + de;';
    html += '    card.appendChild(timeDiv);';
    
    html += '    var row = document.createElement("div");';
    html += '    row.className = "list-item";';
    html += '    row.innerHTML = "<span>Выручка:</span><b>" + ';
    html += '    fmtMoney(s.total_sales) + "</b>";';
    html += '    card.appendChild(row);';
    
    html += '    var disp = parseFloat(s.discrepancy) || 0;';
    html += '    var dispColor = disp === 0 ? "' + successColor + '" : "';
    html += dangerColor + '";';
    html += '    var row2 = document.createElement("div");';
    html += '    row2.className = "list-item";';
    html += '    row2.innerHTML = "<span>Расхождение кассы:</span>';
    html += '    <b style=\'color:" + dispColor + "\'>" + ';
    html += '    fmtMoney(disp) + "</b>";';
    html += '    card.appendChild(row2);';
    
    html += '    c.appendChild(card);';
    html += '  });';
    html += '}';

    html += 'setQuick("month");';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 40. API СМЕН ДЛЯ ОТЧЕТА ======
  app.get('/api/warehouse/shifts/report', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const start = req.query.start;
      const end = req.query.end;
      
      let dateFilter = '';
      let params = [shopId];

      if (start && end) {
        dateFilter = 'AND s.open_time >= $2 AND s.open_time <= $3 ';
        params.push(start, end + ' 23:59:59');
      }

      const r = await pool.query(
        'SELECT s.id, s.open_time, s.close_time, ' +
        's.total_sales, s.discrepancy, a.name as author ' +
        'FROM wh_shifts s ' +
        'LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'WHERE s.shop_id = $1 AND s.status = \'closed\' ' +
        dateFilter + 'ORDER BY s.open_time DESC LIMIT 50',
        params
      );
      res.json({ ok: true, shifts: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 41. API ФЛОРИСТОВ ======
  app.get('/api/warehouse/staff', async (req, res) => {
    try {
      const cookie = req.headers.cookie || ''; 
      const match = cookie.match(/wh_auth=(\d+)/); 
      const chatId = match ? Number(match[1]) : null;
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]
      );
      if (!ownerCheck.rows[0] || ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false, error: 'Только владелец' });
      }
      const r = await pool.query(
        'SELECT a.name, a.warehouse_pin, a.can_receipt, a.can_sale, ' +
        'a.can_writeoff, a.chat_id, COALESCE(SUM(s.real_price), 0) ' +
        'as total_sales FROM admins a ' +
        'LEFT JOIN wh_sales s ON a.chat_id = s.chat_id ' +
        'WHERE a.shop_id = $1 AND a.role = \'florist\' ' +
        'GROUP BY a.chat_id, a.name, a.warehouse_pin, a.can_receipt, ' +
        'a.can_sale, a.can_writeoff', [req.query.shop || 'kupidon']
      );
      res.json({ ok: true, staff: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 42. ЭКРАН ФЛОРИСТОВ ======
  app.get('/warehouse/staff', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } .back { font-size: 24px; ';
    html += 'text-decoration: none; color: ' + brandColor + '; ';
    html += 'margin-right: 15px; } ';
    html += '.card { background: #fff; border-radius: 16px; ';
    html += 'padding: 15px; margin-bottom: 15px; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); } ';
    html += '.name { font-size: 18px; font-weight: 800; } ';
    html += '.sales { font-size: 16px; color: ' + successColor + '; ';
    html += 'margin-top: 5px; font-weight: 600; }';
    html += '.row { display: flex; justify-content: space-between; ';
    html += 'margin-top: 10px; border-top: 1px solid #eee; ';
    html += 'padding-top: 10px; } ';
    html += '.btn-pin { margin-top:10px; padding:8px 15px; ';
    html += 'border-radius:10px; border:none; background:' + brandColor + '; ';
    html += 'color:#fff; font-weight:600; font-family:inherit; } ';
    html += 'input[type="checkbox"] { transform: scale(1.3); ';
    html += 'accent-color: ' + brandColor + '; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">';
    html += '←</a><h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('staff') + 'Флористы</h2></div><div id="list"></div>';

    html += '<script>';
    html += 'fetch("/api/warehouse/staff?shop=kupidon")';
    html += '.then(function(r){return r.json();}).then(function(d){ ';
    html += '  var b = document.getElementById("list"); ';
    html += '  if (!d.ok) { b.textContent = "Доступ запрещен"; return; } ';
    html += '  if (d.staff.length === 0) { ';
    html += '  b.textContent = "Нет флористов"; return; }';
    html += '  d.staff.forEach(function(f){ ';
    html += '    var c = document.createElement("div"); c.className = "card"; ';
    html += '    var name = f.name || "Флорист"; ';
    html += '    var nDiv = document.createElement("div"); ';
    html += '    nDiv.className = "name"; nDiv.textContent = name; ';
    html += '    c.appendChild(nDiv);';
    html += '    var sum = parseFloat(f.total_sales).toLocaleString("ru-RU"); ';
    html += '    var sDiv = document.createElement("div"); ';
    html += '    sDiv.className = "sales"; sDiv.textContent = "Продано: " + ';
    html += '    sum + " ₽"; c.appendChild(sDiv);';
    html += '    var pDiv = document.createElement("div"); ';
    html += '    pDiv.style = "font-size:12px;color:#888;"; ';
    html += '    pDiv.textContent = "PIN: " + (f.warehouse_pin || "нет"); ';
    html += '    c.appendChild(pDiv);';
    html += '    var btn = document.createElement("button"); ';
    html += '    btn.innerText = "Задать PIN"; btn.className = "btn-pin"; ';
    html += '    btn.onclick = function(){setPin(f.chat_id);}; ';
    html += '    c.appendChild(btn);';
    html += '    c.appendChild(makeCheck("Приход", "receipt", ';
    html += '    f.can_receipt, f.chat_id)); ';
    html += '    c.appendChild(makeCheck("Продажа", "sale", ';
    html += '    f.can_sale, f.chat_id)); ';
    html += '    c.appendChild(makeCheck("Списание", "writeoff", ';
    html += '    f.can_writeoff, f.chat_id)); b.appendChild(c); }); ';
    html += '}).catch(function(){});';
    html += 'function makeCheck(label, field, checked, chatId) { ';
    html += 'var r = document.createElement("div"); r.className = "row"; ';
    html += 'var sp = document.createElement("span"); sp.textContent = label; ';
    html += 'r.appendChild(sp); var cb = document.createElement("input"); ';
    html += 'cb.type = "checkbox"; cb.checked = checked; ';
    html += 'cb.onchange = function(){setRights(chatId, field, cb.checked);}; ';
    html += 'r.appendChild(cb); return r; }';
    html += 'function setPin(id) { var p = prompt("Введите 4 цифры:"); ';
    html += 'if (p && p.length === 4) { ';
    html += 'fetch("/api/warehouse/florist/pin", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shop: "kupidon", chatId: id, ';
    html += 'pin: p }) }).then(function(){location.reload();})';
    html += '.catch(function(){}); } }';
    html += 'function setRights(id, field, val) { ';
    html += 'fetch("/api/warehouse/florist/rights", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shop: "kupidon", chatId: id, ';
    html += 'field: field, val: val }) }).catch(function(){}); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 43. API ПРАВ ФЛОРИСТОВ ======
  app.post('/api/warehouse/florist/pin', async (req, res) => {
    try {
      const cookie = req.headers.cookie || ''; 
      const match = cookie.match(/wh_auth=(\d+)/); 
      const chatId = match ? Number(match[1]) : null;
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]
      );
      if (!ownerCheck.rows[0] || ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false });
      }
      await pool.query(
        'UPDATE admins SET warehouse_pin = $1 ' +
        'WHERE shop_id = $2 AND chat_id = $3', 
        [req.body.pin, req.body.shop, req.body.chatId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/florist/rights', async (req, res) => {
    try {
      const cookie = req.headers.cookie || ''; 
      const match = cookie.match(/wh_auth=(\d+)/); 
      const chatId = match ? Number(match[1]) : null;
      const ownerCheck = await pool.query(
        'SELECT role FROM admins WHERE chat_id = $1 LIMIT 1', [chatId]
      );
      if (!ownerCheck.rows[0] || ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ ok: false });
      }
      var col = 'can_receipt'; 
      if (req.body.field === 'sale') col = 'can_sale'; 
      if (req.body.field === 'writeoff') col = 'can_writeoff';
      await pool.query(
        'UPDATE admins SET ' + col + ' = $1 ' +
        'WHERE shop_id = $2 AND chat_id = $3', 
        [req.body.val, req.body.shop, req.body.chatId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 44. API НАСТРОЕК ======
  app.get('/api/warehouse/settings', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT settings FROM shops WHERE shop_id = $1', 
        [req.query.shop || 'kupidon']
      );
      if (r.rows.length === 0) return res.json({ ok: true, settings: {} });
      res.json({ ok: true, settings: r.rows[0].settings || {} });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  app.post('/api/warehouse/settings', async (req, res) => {
    try {
      var obj = {}; obj[req.body.key] = req.body.val;
      await pool.query(
        'UPDATE shops SET settings = COALESCE(settings, \'{}\'::jsonb) ' +
        '|| $1::jsonb WHERE shop_id = $2', 
        [JSON.stringify(obj), req.body.shop || 'kupidon']
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // ====== 45. ЭКРАН НАСТРОЕК ======
  app.get('/warehouse/settings', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } .back { font-size: 24px; ';
    html += 'text-decoration: none; color: ' + brandColor + '; ';
    html += 'margin-right: 15px; } ';
    html += '.card { background: #fff; border-radius: 16px; ';
    html += 'padding: 20px; margin-bottom: 15px; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.row { display: flex; justify-content: space-between; ';
    html += 'margin-top: 10px; border-top: 1px solid #eee; ';
    html += 'padding-top: 10px; } ';
    html += 'input[type="checkbox"] { transform: scale(1.3); ';
    html += 'accent-color: ' + brandColor + '; } ';
    html += 'input[type="radio"] { transform: scale(1.3); ';
    html += 'accent-color: ' + brandColor + '; margin-right: 10px; } ';
    html += 'label { display: flex; align-items: center; margin-top: 10px; } ';
    html += '.btn-save { background: ' + brandColor + '; color: #fff; ';
    html += 'border: none; padding: 10px 15px; border-radius: 8px; ';
    html += 'font-weight: 600; font-family: inherit; margin-top: 10px; }';
    html += '</style></head><body>';
    html += '<div class="header"><a href="/warehouse-app" class="back">';
    html += '←</a><h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('settings') + 'Настройки</h2></div>';
    html += '<div class="card"><h3 style="margin-top:0;">Уведомления';
    html += '</h3><div id="notifs"></div></div>';
    html += '<div class="card"><h3 style="margin-top:0;">Отображение';
    html += '</h3><div id="views"></div></div>';
    html += '<div class="card"><h3 style="margin-top:0;">Списания</h3>';
    html += '<label style="font-size:13px; font-weight:600; color:#666;">';
    html += 'Порог уведомления (₽)</label>';
    html += '<input type="number" id="writeoffThreshold" ';
    html += 'style="width:100%; padding:10px; border:none; ';
    html += 'border-radius:8px; margin-top:5px; box-sizing:border-box; ';
    html += 'font-family:inherit; box-shadow: 0 4px 12px rgba(15,61,62,0.06);" ';
    html += 'placeholder="1000">';
    html += '<button class="btn-save" onclick="saveThreshold()">';
    html += 'Сохранить</button></div>';

    html += '<script>';
    html += 'var shopSettings = {}; ';
    html += 'fetch("/api/warehouse/settings?shop=kupidon")';
    html += '.then(function(r){return r.json();}).then(function(d){ ';
    html += '  if (!d.ok) return; var s = d.settings; shopSettings = s;';
    html += '  var nOpts = [{k:"notif_discount",t:"Уведомлять о скидках"},';
    html += '  {k:"notif_cancel",t:"Уведомлять об отмене"},';
    html += '  {k:"notif_writeoff",t:"Уведомлять о списаниях"}]; ';
    html += '  var nb = document.getElementById("notifs");';
    html += '  nOpts.forEach(function(o){ ';
    html += '    var r = document.createElement("div"); r.className = "row"; ';
    html += '    var sp = document.createElement("span"); ';
    html += '    sp.textContent = o.t; r.appendChild(sp); ';
    html += '    var cb = document.createElement("input"); cb.type = "checkbox"; ';
    html += '    cb.checked = s[o.k] !== false; ';
    html += '    cb.onchange = function(){saveSet(o.k, cb.checked);}; ';
    html += '    r.appendChild(cb); nb.appendChild(r); });';
    html += '  var vOpts = [{v:"all",t:"Все товары (включая нулевые)"},';
    html += '  {v:"nonzero",t:"Только ненулевые"},';
    html += '  {v:"pos",t:"Только в наличии"}]; ';
    html += '  var currentV = s.inv_view || "pos"; ';
    html += '  var vb = document.getElementById("views");';
    html += '  vOpts.forEach(function(o){ ';
    html += '    var lb = document.createElement("label"); ';
    html += '    var rb = document.createElement("input"); rb.type = "radio"; ';
    html += '    rb.name = "inv_view"; rb.value = o.v; ';
    html += '    rb.checked = (currentV === o.v); ';
    html += '    rb.onchange = function(){saveSet("inv_view", o.v);}; ';
    html += '    lb.appendChild(rb); ';
    html += '    lb.appendChild(document.createTextNode(o.t)); ';
    html += '    vb.appendChild(lb); });';
    html += '  document.getElementById("writeoffThreshold").value = ';
    html += '  s.writeoff_threshold || "";';
    html += '}).catch(function(){});';
    html += 'function saveSet(k, v) { ';
    html += 'fetch("/api/warehouse/settings", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ shop: "kupidon", key: k, val: v }) })';
    html += '.catch(function(){}); }';
    html += 'function saveThreshold() { ';
    html += 'var v = document.getElementById("writeoffThreshold").value; ';
    html += 'saveSet("writeoff_threshold", v); ';
    html += 'showAlert("Готово", "Настройка сохранена", true); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 46. API ИСТОРИИ (С ФИЛЬТРОМ ПО СОТРУДНИКУ) ======
  app.get('/api/warehouse/history', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const targetDate = req.query.date || 
        new Date().toISOString().slice(0, 10);
      const filterChatId = req.query.chat_id;
      
      let chatFilterSales = '';
      let chatFilterWriteoffs = '';
      let chatFilterReceipts = '';
      let params = [shopId, targetDate];
      
      if (filterChatId) {
        chatFilterSales = 'AND s.chat_id = $3 ';
        chatFilterWriteoffs = 'AND w.chat_id = $3 ';
        chatFilterReceipts = 'AND r.chat_id = $3 ';
        params.push(filterChatId);
      }
      
      const sales = await pool.query(
        'SELECT s.id, s.real_price as amount, s.date, ' +
        '\'sale\' as type, a.name as person, ' +
        '(SELECT STRING_AGG(COALESCE(shi.custom_name, i.name) ' +
        '|| \' x\' || TRIM(TRAILING \'.\' FROM TRIM(TRAILING \'0\' ' +
        'FROM si.qty::text)), \', \') ' +
        'FROM wh_sale_items si ' +
        'JOIN wh_shop_items shi ON shi.id = si.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE si.sale_id = s.id) as items ' +
        'FROM wh_sales s ' +
        'LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'WHERE s.shop_id = $1 AND DATE(s.date) = $2 ' +
        chatFilterSales + 'ORDER BY s.date DESC', 
        params
      );
      
      const writeoffs = await pool.query(
        'SELECT w.id, w.qty as amount, w.date, ' +
        '\'writeoff\' as type, a.name as person, ' +
        'COALESCE(shi.custom_name, i.name) as items, w.reason ' +
        'FROM wh_writeoffs w ' +
        'LEFT JOIN admins a ON a.chat_id = w.chat_id ' +
        'LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id ' +
        'LEFT JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE w.shop_id = $1 AND DATE(w.date) = $2 ' +
        chatFilterWriteoffs + 'ORDER BY w.date DESC', 
        params
      );
      
      const receipts = await pool.query(
        'SELECT r.id, r.total_sum as amount, r.date, ' +
        '\'receipt\' as type, a.name as person, ' +
        '(SELECT STRING_AGG(COALESCE(shi.custom_name, i.name) ' +
        '|| \' x\' || TRIM(TRAILING \'.\' FROM TRIM(TRAILING \'0\' ' +
        'FROM ri.qty::text)), \', \') ' +
        'FROM wh_receipt_items ri ' +
        'JOIN wh_shop_items shi ON shi.id = ri.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE ri.receipt_id = r.id) as items ' +
        'FROM wh_receipts r ' +
        'LEFT JOIN admins a ON a.chat_id = r.chat_id ' +
        'WHERE r.shop_id = $1 AND DATE(r.date) = $2 ' +
        'AND r.status = \'completed\' ' + chatFilterReceipts +
        'ORDER BY r.date DESC', 
        params
      );
      
      let list = [...sales.rows, ...writeoffs.rows, ...receipts.rows];
      list.sort(function(a, b) { 
        return new Date(b.date) - new Date(a.date); 
      });
      res.json({ ok: true, history: list, date: targetDate });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ====== 47. ЭКРАН ИСТОРИИ (С ФИЛЬТРОМ И ИТОГАМИ) ======
  app.get('/warehouse/history', async (req, res) => {
    let staffList = [];
    try {
      const st = await pool.query(
        'SELECT chat_id, name FROM admins WHERE shop_id = $1', 
        ['kupidon']
      );
      staffList = st.rows;
    } catch (e) {}

    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } ';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; } ';
    html += '.calendar { display: flex; overflow-x: auto; gap: 10px; ';
    html += 'margin-bottom: 15px; } ';
    html += '.day-btn { background: #fff; border: 1px solid #ddd; ';
    html += 'border-radius: 10px; padding: 10px; text-align: center; ';
    html += 'min-width: 60px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; font-weight: 600; }';
    html += '.day-btn.active { background: ' + brandColor + '; ';
    html += 'color: #fff; } ';
    html += '.totals-banner { background: #fff; padding: 15px; ';
    html += 'border-radius: 12px; margin-bottom: 15px; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); ';
    html += 'display: flex; justify-content: space-between; font-weight: 800; }';
    html += '.item { background: #fff; border-radius: 12px; padding: 15px; ';
    html += 'margin-bottom: 10px; display: flex; justify-content: space-between; ';
    html += 'align-items: flex-start; cursor: pointer; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); } ';
    html += '.item.sale { border-left: 4px solid #3C7A89; } ';
    html += '.item.writeoff { border-left: 4px solid ' + accentColor + '; } ';
    html += '.item.receipt { border-left: 4px solid ' + successColor + '; }';
    html += '.date { font-size: 11px; color: #888; margin-top: 5px; } ';
    html += '.amount { font-weight: 800; font-size: 16px; text-align: right; } ';
    html += '.items-list { font-size: 13px; color: #555; margin-top: 4px; ';
    html += 'font-style: italic; } ';
    html += '.btn-cancel { background: #fff; border: 1px solid ' + dangerColor + '; ';
    html += 'color: ' + dangerColor + '; border-radius: 6px; ';
    html += 'padding: 5px 10px; font-size: 12px; margin-top: 5px; ';
    html += 'font-weight: 600; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">←</a>';
    html += '<h2 style="margin:0; display:flex; align-items:center;">' + 
            getIconSvg('history') + 'История смены</h2></div>';
    
    html += '<div class="calendar" id="calendar"></div>';
    
    html += '<select id="staffFilter" onchange="onFilterChange()" ';
    html += 'style="margin-bottom:15px; padding:10px; border:none; ';
    html += 'border-radius:10px; box-shadow: 0 4px 12px rgba(15,61,62,0.06);">';
    html += '<option value="">Все сотрудники</option>';
    staffList.forEach(function(s) {
      html += '<option value="' + s.chat_id + '">' + 
              (s.name || 'Флорист') + '</option>';
    });
    html += '</select>';

    html += '<div class="totals-banner" id="totalsBanner" style="display:none;">';
    html += '<span id="totSales">Выручка: 0 ₽</span>';
    html += '<span id="totCount">Чеков: 0</span>';
    html += '<span id="totLoss">Списания: 0 шт</span>';
    html += '</div>';

    html += '<div id="list">Загрузка...</div>';

    html += '<script>';
    html += 'function translateReason(r) { var map = { spoilage: "Порча", ';
    html += 'loss: "Потеря", markdown: "Уценка", sorting: "Пересорт" }; ';
    html += 'return map[r] || r || ""; }';
    html += 'function fmtNum(n) { var num = parseFloat(n); if (isNaN(num)) ';
    html += 'return "0"; return num % 1 === 0 ? num.toString() : ';
    html += 'num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, ""); }';
    html += 'function fmtMoney(n) { return Math.round(n)';
    html += '.toLocaleString("ru-RU") + " ₽"; }';
    
    html += 'var selectedDate = new URLSearchParams(window.location.search)';
    html += '.get("date") || new Date().toISOString().slice(0, 10);';
    
    html += 'function renderCalendar() { ';
    html += 'var cal = document.getElementById("calendar"); ';
    html += 'while(cal.firstChild) cal.removeChild(cal.firstChild); ';
    html += 'var today = new Date(); ';
    html += 'var daysRu = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]; ';
    html += 'for (var i = 0; i < 7; i++) { ';
    html += '  var d = new Date(today); d.setDate(today.getDate() - i); ';
    html += '  var dStr = d.getFullYear() + "-" + ';
    html += '  String(d.getMonth() + 1).padStart(2, "0") + "-" + ';
    html += '  String(d.getDate()).padStart(2, "0"); ';
    html += '  var a = document.createElement("a"); ';
    html += '  a.href = "/warehouse/history?date=" + dStr; ';
    html += '  a.className = "day-btn"; ';
    html += '  if (dStr === selectedDate) a.classList.add("active"); ';
    html += '  var label = i === 0 ? "Сегодня" : daysRu[d.getDay()]; ';
    html += '  a.innerHTML = "<div style=\'font-size:10px;\'>" + label + ';
    html += '  "</div><div style=\'font-size:18px;font-weight:800;\'>" + ';
    html += '  d.getDate() + "</div>"; ';
    html += '  cal.appendChild(a); } }';
    html += 'renderCalendar();';
    
    html += 'function onFilterChange() { loadHistory(); }';

    html += 'function loadHistory() {';
    html += '  var listEl = document.getElementById("list");';
    html += '  listEl.textContent = "Загрузка...";';
    html += '  var filter = document.getElementById("staffFilter").value;';
    html += '  var url = "/api/warehouse/history?shop=kupidon&date=" + ';
    html += '  selectedDate;';
    html += '  if (filter) url += "&chat_id=" + filter;';
    
    html += '  fetch(url).then(function(r){return r.json();}).then(function(d){';
    html += '    while(listEl.firstChild) listEl.removeChild(listEl.firstChild); ';
    html += '    if (!d.ok) { listEl.textContent = "Ошибка"; return; }';
    html += '    if (!d.history || d.history.length === 0) { ';
    html += '      listEl.textContent = "За этот день операций нет"; ';
    html += '      document.getElementById("totalsBanner")';
    html += '      .style.display = "none"; return; }';
    
    html += '    var totSales = 0; var totCount = 0; var totLoss = 0;';
    html += '    d.history.forEach(function(h){ ';
    html += '      if (h.type === "sale") { totSales += parseFloat(h.amount); ';
    html += '      totCount++; } else if (h.type === "writeoff") { ';
    html += '      totLoss += parseFloat(h.amount); } });';
    
    html += '    document.getElementById("totalsBanner")';
    html += '    .style.display = "flex";';
    html += '    document.getElementById("totSales").textContent = ';
    html += '    "Выручка: " + fmtMoney(totSales);';
    html += '    document.getElementById("totCount").textContent = ';
    html += '    "Чеков: " + totCount;';
    html += '    document.getElementById("totLoss").textContent = ';
    html += '    "Списания: " + fmtNum(totLoss) + " шт";';
    
    html += '    d.history.forEach(function(h){ ';
    html += '      var div = document.createElement("div"); ';
    html += '      var ds = new Date(h.date).toLocaleString("ru-RU", ';
    html += '      { hour: "2-digit", minute: "2-digit" }); ';
    html += '      var seller = h.person || "Флорист";';
    
    html += '      if (h.type === "sale") { ';
    html += '        div.className = "item sale"; ';
    html += '        var saleId = parseInt(h.id) || 0; ';
    html += '        div.onclick = function() { window.location.href = ';
    html += '        "/warehouse/sale/details?id=" + saleId; };';
    html += '        var left = document.createElement("div"); ';
    html += '        var title = document.createElement("b"); ';
    html += '        title.textContent = "💰 Продажа (" + seller + ")"; ';
    html += '        var dateDiv = document.createElement("div"); ';
    html += '        dateDiv.className = "date"; dateDiv.textContent = ds; ';
    html += '        var itemsDiv = document.createElement("div"); ';
    html += '        itemsDiv.className = "items-list"; ';
    html += '        itemsDiv.textContent = h.items || ""; ';
    html += '        left.appendChild(title); left.appendChild(dateDiv); ';
    html += '        left.appendChild(itemsDiv);';
    html += '        var right = document.createElement("div"); ';
    html += '        var amtDiv = document.createElement("div"); ';
    html += '        amtDiv.className = "amount"; ';
    html += '        amtDiv.textContent = "+" + ';
    html += '        parseFloat(h.amount).toLocaleString("ru-RU") + " ₽"; ';
    html += '        right.appendChild(amtDiv);';
    html += '        div.appendChild(left); div.appendChild(right);';
    
    html += '      } else if (h.type === "receipt") { ';
    html += '        div.className = "item receipt"; ';
    html += '        var docId = parseInt(h.id) || 0; ';
    html += '        div.onclick = function() { window.location.href = ';
    html += '        "/warehouse/documents/details?id=" + docId + ';
    html += '        "&type=receipts"; }; ';
    html += '        var left = document.createElement("div"); ';
    html += '        var title = document.createElement("b"); ';
    html += '        title.textContent = "📥 Приход (" + seller + ")"; ';
    html += '        var dateDiv = document.createElement("div"); ';
    html += '        dateDiv.className = "date"; dateDiv.textContent = ds; ';
    html += '        var itemsDiv = document.createElement("div"); ';
    html += '        itemsDiv.className = "items-list"; ';
    html += '        itemsDiv.textContent = h.items || ""; ';
    html += '        left.appendChild(title); left.appendChild(dateDiv); ';
    html += '        left.appendChild(itemsDiv);';
    html += '        var right = document.createElement("div"); ';
    html += '        var amtDiv = document.createElement("div"); ';
    html += '        amtDiv.className = "amount"; ';
    html += '        amtDiv.style.color = "' + successColor + '"; ';
    html += '        amtDiv.textContent = "+" + ';
    html += '        parseFloat(h.amount).toLocaleString("ru-RU") + " ₽"; ';
    html += '        right.appendChild(amtDiv);';
    html += '        div.appendChild(left); div.appendChild(right);';
    
    html += '      } else { ';
    html += '        div.className = "item writeoff"; ';
    html += '        var docId = parseInt(h.id) || 0; ';
    html += '        div.onclick = function() { window.location.href = ';
    html += '        "/warehouse/documents/details?id=" + docId + ';
    html += '        "&type=writeoffs"; }; ';
    html += '        var left = document.createElement("div"); ';
    html += '        var title = document.createElement("b"); ';
    html += '        title.textContent = "🗑 Списание (" + seller + ")"; ';
    html += '        var dateDiv = document.createElement("div"); ';
    html += '        dateDiv.className = "date"; dateDiv.textContent = ds; ';
    html += '        var itemsDiv = document.createElement("div"); ';
    html += '        itemsDiv.className = "items-list"; ';
    html += '        itemsDiv.textContent = (h.items || "") + " (" + ';
    html += '        translateReason(h.reason) + ")"; ';
    html += '        left.appendChild(title); left.appendChild(dateDiv); ';
    html += '        left.appendChild(itemsDiv);';
    html += '        var right = document.createElement("div"); ';
    html += '        var amtDiv = document.createElement("div"); ';
    html += '        amtDiv.className = "amount"; ';
    html += '        amtDiv.style.color = "' + accentColor + '"; ';
    html += '        amtDiv.textContent = "-" + fmtNum(h.amount) + " шт"; ';
    html += '        right.appendChild(amtDiv);';
    html += '        div.appendChild(left); div.appendChild(right);';
    html += '      }';
    html += '      listEl.appendChild(div); });';
    html += '  }).catch(function(){ ';
    html += '  listEl.textContent = "Ошибка загрузки"; });';
    html += '}';

    html += 'loadHistory();';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 48. API ДЕТАЛЕЙ ПРОДАЖИ ======
  app.get('/api/warehouse/sale/details', async (req, res) => {
    try {
      const saleId = parseInt(req.query.id);
      if (!saleId || isNaN(saleId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      const sale = await pool.query(
        'SELECT s.id, s.real_price, s.date, a.name as seller ' +
        'FROM wh_sales s LEFT JOIN admins a ON a.chat_id = s.chat_id ' +
        'WHERE s.id = $1', [saleId]
      );
        
      if (sale.rows.length === 0) {
        return res.json({ ok: false, error: 'Не найдено' });
      }
      
      const items = await pool.query(
        'SELECT si.qty, si.cost_at_sale, ' +
        'COALESCE(shi.custom_name, i.name) as name, ' +
        'shi.id as shop_item_id FROM wh_sale_items si ' +
        'JOIN wh_shop_items shi ON shi.id = si.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE si.sale_id = $1', [saleId]
      );
        
      res.json({ ok: true, sale: sale.rows[0], items: items.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 49. ЭКРАН ДЕТАЛЕЙ ПРОДАЖИ ======
  app.get('/warehouse/sale/details', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } ';
    html += '.back { font-size: 24px; text-decoration: none; ';
    html += 'color: ' + brandColor + '; margin-right: 15px; } ';
    html += '.card { background: #fff; border-radius: 16px; padding: 20px; ';
    html += 'margin-bottom: 15px; box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.total { font-size: 28px; font-weight: 800; ';
    html += 'color: ' + successColor + '; margin-bottom: 10px; } ';
    html += '.meta { font-size: 13px; color: #666; margin-bottom: 20px; } ';
    html += '.item-row { display: flex; justify-content: space-between; ';
    html += 'padding: 15px 0; border-bottom: 1px solid #eee; ';
    html += 'text-decoration: none; color: ' + brandColor + '; } ';
    html += '.item-row:last-child { border-bottom: none; } ';
    html += '.item-name { font-weight: 600; font-size: 16px; } ';
    html += '.item-qty { color: ' + dangerColor + '; font-weight: 800; }';
    html += '.btn-cancel-sale { width: 100%; padding: 15px; ';
    html += 'background: #fff; border: 2px solid ' + dangerColor + '; ';
    html += 'color: ' + dangerColor + '; border-radius: 12px; ';
    html += 'font-weight: 800; font-size: 16px; margin-top: 20px; ';
    html += 'cursor: pointer; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse/history" ';
    html += 'class="back">←</a><h2 style="margin:0;">🧾 Чек</h2></div>';
    html += '<div class="card" id="content">Загрузка...</div>';

    html += '<script>';
    html += 'function fmtNum(n) { var num = parseFloat(n); ';
    html += 'if (isNaN(num)) return "0"; return num % 1 === 0 ? ';
    html += 'num.toString() : num.toFixed(3).replace(/0+$/, "")';
    html += '.replace(/\\.$/, ""); }';
    html += 'var saleId = parseInt(new URLSearchParams(window.location.search)';
    html += '.get("id")) || 0;';
    html += 'fetch("/api/warehouse/sale/details?id=" + saleId)';
    html += '.then(function(r){return r.json();}).then(function(d){';
    html += '  var content = document.getElementById("content"); ';
    html += '  while(content.firstChild) content.removeChild(content.firstChild); ';
    html += '  if (!d.ok) { content.textContent = "Ошибка"; return; }';
    html += '  var s = d.sale; ';
    html += '  var ds = new Date(s.date).toLocaleString("ru-RU");';
    html += '  var tot = document.createElement("div"); ';
    html += '  tot.className = "total"; ';
    html += '  tot.textContent = parseFloat(s.real_price)';
    html += '  .toLocaleString("ru-RU") + " ₽"; content.appendChild(tot);';
    html += '  var meta = document.createElement("div"); ';
    html += '  meta.className = "meta"; ';
    html += '  meta.textContent = "Продал: " + (s.seller || "Неизвестно") + ';
    html += '  " · Дата: " + ds; content.appendChild(meta);';
    html += '  d.items.forEach(function(i){ ';
    html += '    var a = document.createElement("a"); ';
    html += '    a.href = "/warehouse/item?id=" + ';
    html += '    (parseInt(i.shop_item_id)||0); ';
    html += '    a.className = "item-row"; ';
    html += '    var left = document.createElement("div"); ';
    html += '    var n = document.createElement("div"); ';
    html += '    n.className = "item-name"; n.textContent = i.name; ';
    html += '    var c = document.createElement("div"); ';
    html += '    c.style = "font-size:12px;color:#888;"; ';
    html += '    c.textContent = "Себестоимость: " + ';
    html += '    parseFloat(i.cost_at_sale) + " ₽/шт"; ';
    html += '    left.appendChild(n); left.appendChild(c); ';
    html += '    var right = document.createElement("div"); ';
    html += '    right.className = "item-qty"; ';
    html += '    right.textContent = "x" + fmtNum(i.qty); ';
    html += '    a.appendChild(left); a.appendChild(right); ';
    html += '    content.appendChild(a); });';
    
    html += '  var cancelBtn = document.createElement("button"); ';
    html += '  cancelBtn.className = "btn-cancel-sale"; ';
    html += '  cancelBtn.innerText = "Отменить продажу (Возврат)";';
    html += '  cancelBtn.onclick = function() { ';
    html += '    showConfirm("Отмена продажи", ';
    html += '    "Вы уверены? Товары вернутся на склад.", function() {';
    html += '      fetch("/api/warehouse/sale/cancel", { method: "POST", ';
    html += '      headers: { "Content-Type": "application/json" }, ';
    html += '      body: JSON.stringify({ shopId: "kupidon", ';
    html += '      saleId: saleId, action: "return" }) })';
    html += '      .then(function(r){return r.json();}).then(function(res){ ';
    html += '      if(res.ok){ showAlert("Готово", "Возврат оформлен", true); ';
    html += '      setTimeout(function(){window.location.href=';
    html += '      "/warehouse/history";}, 1000); } ';
    html += '      else showAlert("Ошибка", res.error, false); })';
    html += '      .catch(function(){});';
    html += '    }, true); };';
    html += '  content.appendChild(cancelBtn);';
    html += '}).catch(function(){ document.getElementById("content")';
    html += '.textContent = "Ошибка загрузки"; });';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 50. API ОТМЕНЫ ПРОДАЖИ ======
  app.post('/api/warehouse/sale/cancel', async (req, res) => {
    const client = await pool.connect();
    try {
      const shopId = req.body.shopId;
      const saleId = parseInt(req.body.saleId);
      const action = req.body.action;
      
      if (!saleId || isNaN(saleId)) {
        client.release(); 
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      await client.query('BEGIN');
      const itemsRes = await client.query(
        'SELECT shop_item_id, qty FROM wh_sale_items WHERE sale_id = $1', 
        [saleId]
      );
        
      for (let i = 0; i < itemsRes.rows.length; i++) {
        const item = itemsRes.rows[i];
        if (action === 'return') {
          await client.query(
            'UPDATE wh_shop_items SET current_stock = ' +
            'current_stock + $1 WHERE id = $2', 
            [item.qty, item.shop_item_id]
          );
        } else {
          await client.query(
            'INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, ' +
            'reason, comment, date) VALUES ($1, $2, $3, $4, $5, NOW())', 
            [shopId, item.shop_item_id, item.qty, 'loss', 'Отмена продажи']
          );
        }
      }
      
      await client.query(
        'DELETE FROM wh_sale_items WHERE sale_id = $1', [saleId]
      );
      await client.query(
        'DELETE FROM wh_sales WHERE id = $1', [saleId]
      );
      
      await client.query('COMMIT');
      client.release();
      
      await logAction(shopId, null, 'cancel', 
        'Возврат/списание продажи ID: ' + saleId, saleId);
      await notifyOwner(bot, shopId, 
        '⚠️ Отмена продажи ID: ' + saleId, 'cancel');
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); 
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  // ====== 51. API ВСЕХ БУКЕТОВ ======
  app.get('/api/warehouse/bouquets/all', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT id, name, price, photos, wh_linked FROM bouquets ' +
        'WHERE shop_id = $1 AND deleted = FALSE ORDER BY name ASC',
        [req.query.shop || 'kupidon']
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
          wh_linked: b.wh_linked
        };
      });
      
      res.json({ ok: true, bouquets: result });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 52. ЭКРАН УПРАВЛЕНИЯ БУКЕТАМИ ======
  app.get('/warehouse/bouquets', (req, res) => {
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } .back { font-size: 24px; ';
    html += 'text-decoration: none; color: ' + brandColor + '; ';
    html += 'margin-right: 15px; } ';
    
    // Правка 7: Карточка с фото, ценой и тумблером
    html += '.b-card { background: #fff; border-radius: 16px; ';
    html += 'padding: 15px; margin-bottom: 12px; display: flex; ';
    html += 'align-items: center; gap: 15px; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    html += '.b-img { width: 64px; height: 64px; border-radius: 12px; ';
    html += 'object-fit: cover; background: #F0F4F4; flex-shrink: 0; }';
    html += '.b-ph { width: 64px; height: 64px; border-radius: 12px; ';
    html += 'background: #F0F4F4; display: flex; align-items: center; ';
    html += 'justify-content: center; flex-shrink: 0; }';
    html += '.b-ph svg { width: 32px; height: 32px; }';
    html += '.b-info { flex: 1; min-width: 0; }';
    html += '.b-name { font-size: 15px; font-weight: 800; ';
    html += 'margin-bottom: 4px; word-break: break-word; }';
    html += '.b-price { font-size: 13px; color: ' + successColor + '; ';
    html += 'font-weight: 600; margin-bottom: 8px; }';
    
    // Тумблер (Switch)
    html += '.switch { position: relative; display: inline-block; ';
    html += 'width: 44px; height: 24px; }';
    html += '.switch input { opacity: 0; width: 0; height: 0; }';
    html += '.slider { position: absolute; cursor: pointer; top: 0; ';
    html += 'left: 0; right: 0; bottom: 0; background-color: #ccc; ';
    html += 'transition: .3s; border-radius: 24px; }';
    html += '.slider:before { position: absolute; content: ""; ';
    html += 'height: 18px; width: 18px; left: 3px; bottom: 3px; ';
    html += 'background-color: white; transition: .3s; ';
    html += 'border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }';
    html += 'input:checked + .slider { background-color: ' + successColor + '; }';
    html += 'input:checked + .slider:before { transform: translateX(20px); }';
    
    html += '.btn-setup { background: #F0F4F4; color: ' + brandColor + '; ';
    html += 'border: none; padding: 8px 12px; border-radius: 8px; ';
    html += 'font-weight: 600; font-family: inherit; margin-top: 8px; ';
    html += 'font-size: 12px; }';
    html += '</style></head><body>';
    
    html += '<div class="header"><a href="/warehouse-app" class="back">';
    html += '←</a><h2 style="margin:0; display:flex; align-items:center;">';
    html += getIconSvg('bouquets') + 'Букеты</h2></div>';
    html += '<div id="list">Загрузка...</div>';

    html += '<script>';
    html += 'var svgPh = \'<svg viewBox="0 0 24 24" fill="#A0B4B4">';
    html += '<path d="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22';
    html += 'L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3';
    html += 'C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5';
    html += 'C2,15.5 3.5,17.5 6.5,17.5C7.21,17.5 7.87,17.36 ';
    html += '8.5,17.12C11.24,16.08 13.44,14.57 15,12.5';
    html += 'C15,12.5 15.5,14.5 15.5,16.5C15.5,18.5 14.5,20 ';
    html += '14.5,20C17,20 19.5,17.5 20.5,14.5C21.5,11.5 ';
    html += '21.5,8 21.5,8C21.5,8 19.5,6 17,8Z"/></svg>\';';

    html += 'fetch("/api/warehouse/bouquets/all?shop=kupidon")';
    html += '.then(function(r){return r.json();}).then(function(d){ ';
    html += '  var b = document.getElementById("list"); ';
    html += '  while(b.firstChild) b.removeChild(b.firstChild);';
    html += '  if (!d.ok || d.bouquets.length === 0) { ';
    html += '    b.textContent = "Букетов нет"; return; }';
    html += '  d.bouquets.forEach(function(bq){ ';
    html += '    var card = document.createElement("div"); ';
    html += '    card.className = "b-card";';
    
    html += '    if (bq.photo_url) { ';
    html += '      var img = document.createElement("img"); ';
    html += '      img.className = "b-img"; img.src = bq.photo_url; ';
    html += '      card.appendChild(img); } ';
    html += '    else { ';
    html += '      var ph = document.createElement("div"); ';
    html += '      ph.className = "b-ph"; ph.innerHTML = svgPh; ';
    html += '      card.appendChild(ph); }';
    
    html += '    var info = document.createElement("div"); ';
    html += '    info.className = "b-info";';
    html += '    var name = document.createElement("div"); ';
    html += '    name.className = "b-name"; name.textContent = bq.name; ';
    html += '    info.appendChild(name);';
    
    html += '    var price = document.createElement("div"); ';
    html += '    price.className = "b-price"; ';
    html += '    price.textContent = parseFloat(bq.price || 0)';
    html += '    .toLocaleString("ru-RU") + " ₽"; info.appendChild(price);';
    
    // Тумблер
    html += '    var sw = document.createElement("label"); ';
    html += '    sw.className = "switch";';
    html += '    var cb = document.createElement("input"); cb.type = "checkbox"; ';
    html += '    cb.checked = bq.wh_linked; ';
    html += '    cb.onchange = function(){toggleLink(bq.id, cb.checked);}; ';
    html += '    sw.appendChild(cb);';
    html += '    var sl = document.createElement("span"); ';
    html += '    sl.className = "slider"; sw.appendChild(sl); ';
    html += '    info.appendChild(sw);';
    
    html += '    if (bq.wh_linked) { ';
    html += '      var btn = document.createElement("button"); ';
    html += '      btn.className = "btn-setup"; ';
    html += '      btn.textContent = "Настроить состав"; ';
    html += '      btn.onclick = function() { ';
    html += '        window.location.href = "/warehouse/bouquets/recipe?id=" ';
    html += '        + bq.id; }; ';
    html += '      info.appendChild(btn); }';
    
    html += '    card.appendChild(info); b.appendChild(card); });';
    html += '}).catch(function(){});';

    html += 'function toggleLink(id, val) { ';
    html += 'fetch("/api/warehouse/bouquet/toggle", { method: "POST", ';
    html += 'headers: { "Content-Type": "application/json" }, ';
    html += 'body: JSON.stringify({ id: id, val: val }) })';
    html += '.then(function(r){return r.json();}).then(function(d){ ';
    html += 'if (d.ok) { location.reload(); } else { ';
    html += 'showAlert("Ошибка", "Не удалось сохранить", false); } })';
    html += '.catch(function(){}); }';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 53. API ПЕРЕКЛЮЧЕНИЯ СВЯЗИ ======
  app.post('/api/warehouse/bouquet/toggle', async (req, res) => {
    try {
      await pool.query(
        'UPDATE bouquets SET wh_linked = $1 WHERE id = $2',
        [req.body.val, req.body.id]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 54. API ДАННЫХ БУКЕТА ======
  app.get('/api/warehouse/bouquets/info', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT id, name, price FROM bouquets WHERE id = $1',
        [req.query.id]
      );
      if (r.rows.length === 0) return res.json({ ok: false });
      res.json({ ok: true, bouquet: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 55. API ПОЛУЧЕНИЯ РЕЦЕПТА ======
  app.get('/api/warehouse/bouquets/recipe', async (req, res) => {
    try {
      const r = await pool.query(
        'SELECT r.id, r.shop_item_id, r.qty, ' +
        'COALESCE(shi.custom_name, i.name) as name, ' +
        'i.unit, shi.current_stock, shi.retail_price ' +
        'FROM wh_bouquet_recipes r ' +
        'JOIN wh_shop_items shi ON shi.id = r.shop_item_id ' +
        'JOIN wh_items i ON i.id = shi.item_id ' +
        'WHERE r.bouquet_id = $1 ORDER BY r.id ASC',
        [req.query.id]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ====== 56. ЭКРАН СОСТАВА (РЕЦЕПТА) ======
  app.get('/warehouse/bouquets/recipe', (req, res) => {
    const bId = parseInt(req.query.id);
    if (!bId || isNaN(bId)) return res.status(400).send('Неверный ID');

    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { font-family: "Manrope", sans-serif; margin: 0; ';
    html += 'padding: 15px; background: ' + bgGradient + '; ';
    html += 'color: ' + brandColor + '; }';
    html += '.header { display: flex; align-items: center; ';
    html += 'margin-bottom: 15px; } .back { font-size: 24px; ';
    html += 'text-decoration: none; color: ' + brandColor + '; ';
    html += 'margin-right: 15px; } ';
    html += '.card { background: #fff; border-radius: 16px; ';
    html += 'padding: 20px; margin-bottom: 15px; ';
    html += 'box-shadow: 0 4px 12px rgba(15,61,62,0.06); }';
    
    html += '.b-row { display: grid; grid-template-columns: 1fr 90px 20px; ';
    html += 'gap: 5px; align-items: center; margin-bottom: 6px; ';
    html += 'font-size: 13px; padding-bottom: 6px; ';
    html += 'border-bottom: 1px solid #eee; }';
    html += '.qty-btn { background: #F0F4F4; border: none; ';
    html += 'width: 26px; height: 26px; ';
    html += 'border-radius: 6px; font-weight: bold; font-size: 14px; ';
    html += 'color: ' + brandColor + '; }';
    html += '.qty-input { width: 30px; height: 26px; text-align: center; ';
    html += 'font-size: 13px; font-weight: bold; border: 1px solid #ddd; ';
    html += 'border-radius: 6px; padding: 0; margin: 0; }';
    
    html += '.btn-save { width: 100%; background: ' + successColor + '; ';
    html += 'color: #fff; border: none; padding: 16px; ';
    html += 'border-radius: 12px; font-size: 16px; font-weight: 800; ';
    html += 'margin-top: 15px; }';

    html += '.dropdown-wrap { position: relative; margin-bottom: 15px; }';
    html += '.dropdown-list { position: absolute; top: 100%; left: 0; ';
    html += 'right: 0; background: #fff; border: 1px solid #eee; ';
    html += 'border-radius: 12px; margin-top: -10px; z-index: 100; ';
    html += 'box-shadow: 0 4px 15px rgba(0,0,0,0.1); ';
    html += 'max-height: 200px; overflow-y: auto; display: none; }';
    html += '.dd-item { padding: 12px 15px; border-bottom: 1px solid #eee; ';
    html += 'cursor: pointer; display: flex; justify-content: space-between; ';
    html += 'align-items: center; }';
    html += '.dd-item:last-child { border-bottom: none; }';
    html += '.dd-name { font-weight: 600; font-size: 14px; }';
    html += '.dd-stock { font-size: 12px; font-weight: 800; }';
    html += '.clear-search { position: absolute; right: 15px; ';
    html += 'top: 22px; font-size: 20px; color: #aaa; cursor: pointer; ';
    html += 'display: none; background: none; border: none; padding: 0; }';
    html += '</style></head><body>';

    html += '<div class="header"><a href="/warehouse/bouquets" ';
    html += 'class="back">←</a><h2 style="margin:0; display:flex; ';
    html += 'align-items:center;" id="bTitle">Состав...</h2></div>';

    html += '<div class="card">';
    html += '<div id="recipeList"><div style="color:#888;text-align:center;">';
    html += 'Загрузка...</div></div>';
    html += '</div>';

    html += '<div class="card">';
    html += '<h3 style="margin-top:0; font-size:16px;">Добавить ингредиент</h3>';
    html += '<label>Поиск по складу</label>';
    html += '<div class="dropdown-wrap">';
    html += '<input type="text" id="searchItem" oninput="onSearchInput()" ';
    html += 'placeholder="Начните вводить..." autocomplete="off">';
    html += '<button class="clear-search" id="clearSearch" ';
    html += 'onclick="clearSearchText()">✕</button>';
    html += '<div class="dropdown-list" id="ddList"></div>';
    html += '</div>';
    
    html += '<div style="display:flex; gap:10px; align-items:center;">';
    html += '<div style="flex:1;">';
    html += '<label>Количество</label>';
    html += '<input type="number" id="qtyAdd" placeholder="1" step="0.1">';
    html += '</div>';
    html += '<button onclick="addItem()" style="background:' + brandColor + '; ';
    html += 'color:#fff; border:none; border-radius:12px; padding:15px; ';
    html += 'font-weight:800; font-family:inherit; margin-top:15px;">+';
    html += '</button></div>';
    html += '</div>';

    html += '<button class="btn-save" onclick="saveRecipe()">';
    html += 'Сохранить состав</button>';
    html += '<script>';
    html += 'var bId = ' + bId + ';';
    html += 'var catalog = []; var recipe = [];';
    html += 'var selectedItem = null;';

    html += 'function fmtNum(n) { var num = parseFloat(n); ';
    html += 'if (isNaN(num)) return "0"; return num % 1 === 0 ? ';
    html += 'num.toString() : num.toFixed(3).replace(/0+$/, "")';
    html += '.replace(/\\.$/, ""); }';

    html += 'fetch("/api/warehouse/bouquets/info?id=" + bId)';
    html += '.then(function(r){return r.json();}).then(function(d){ ';
    html += 'if (d.ok) { document.getElementById("bTitle").textContent = ';
    html += '"Букет: " + d.bouquet.name; } });';

    html += 'fetch("/api/warehouse/items?shop=kupidon")';
    html += '.then(function(r){return r.json();}).then(function(d){ ';
    html += 'if (d.ok) catalog = d.items; });';

    html += 'fetch("/api/warehouse/bouquets/recipe?id=" + bId)';
    html += '.then(function(r){return r.json();}).then(function(d){ ';
    html += 'if (d.ok) { recipe = d.items; renderRecipe(); } });';

    html += 'document.addEventListener("click", function(e) {';
    html += '  var dd = document.getElementById("ddList");';
    html += '  var inp = document.getElementById("searchItem");';
    html += '  if (dd && inp && e.target !== dd && ';
    html += '  e.target !== inp && !dd.contains(e.target)) {';
    html += '    dd.style.display = "none";';
    html += '  }';
    html += '});';

    html += 'function onSearchInput() {';
    html += '  var val = document.getElementById("searchItem").value;';
    html += '  var dd = document.getElementById("ddList");';
    html += '  var btn = document.getElementById("clearSearch");';
    html += '  while(dd.firstChild) dd.removeChild(dd.firstChild);';
    
    html += '  if (val.length > 0) { btn.style.display = "block"; }';
    html += '  else { btn.style.display = "none"; }';
    html += '  if (!val) { dd.style.display = "none"; return; }';

    html += '  var found = catalog.filter(function(i) { ';
    html += '    return i.name.toLowerCase().includes(val.toLowerCase()); ';
    html += '  }).slice(0, 20);';

    html += '  if (found.length === 0) { dd.style.display = "none"; return; }';

    html += '  found.forEach(function(i) {';
    html += '    var row = document.createElement("div"); ';
    html += '    row.className = "dd-item";';
    html += '    var nm = document.createElement("div"); ';
    html += '    nm.className = "dd-name"; nm.textContent = i.name;';
    html += '    var st = document.createElement("div"); ';
    html += '    st.className = "dd-stock"; ';
    html += '    var s = parseFloat(i.current_stock);';
    html += '    st.textContent = fmtNum(s) + " " + (i.unit || "шт");';
    html += '    st.style.color = s > 0 ? "' + successColor + '" : "';
    html += dangerColor + '";';
    html += '    row.appendChild(nm); row.appendChild(st);';
    html += '    row.onclick = function() {';
    html += '      document.getElementById("searchItem").value = i.name;';
    html += '      document.getElementById("clearSearch")';
    html += '      .style.display = "none";';
    html += '      selectedItem = i;';
    html += '      dd.style.display = "none";';
    html += '    };';
    html += '    dd.appendChild(row);';
    html += '  });';
    html += '  dd.style.display = "block";';
    html += '}';

    html += 'function clearSearchText() {';
    html += '  document.getElementById("searchItem").value = "";';
    html += '  document.getElementById("clearSearch").style.display = "none";';
    html += '  document.getElementById("ddList").style.display = "none";';
    html += '  selectedItem = null;';
    html += '}';

    html += 'function addItem() {';
    html += '  if (!selectedItem) { ';
    html += '    showAlert("Внимание", "Выберите товар из списка", false); ';
    html += '    return; }';
    html += '  var q = parseFloat(document.getElementById("qtyAdd").value);';
    html += '  if (!q || q <= 0) { ';
    html += '    showAlert("Внимание", "Введите количество", false); ';
    html += '    return; }';
    
    html += '  var ex = recipe.find(function(r) { ';
    html += '    return r.shop_item_id === selectedItem.id; });';
    html += '  if (ex) { ex.qty = parseFloat(ex.qty) + q; }';
    html += '  else { ';
    html += '    recipe.push({ shop_item_id: selectedItem.id, ';
    html += '      name: selectedItem.name, ';
    html += '      qty: q, unit: selectedItem.unit || "шт" }); ';
    html += '  }';
    
    html += '  clearSearchText();';
    html += '  document.getElementById("qtyAdd").value = "";';
    html += '  renderRecipe();';
    html += '}';

    html += 'function renderRecipe() {';
    html += '  var list = document.getElementById("recipeList");';
    html += '  while(list.firstChild) list.removeChild(list.firstChild);';
    html += '  if (recipe.length === 0) { ';
    html += '    list.textContent = "Состав пуст. Добавьте ингредиенты."; ';
    html += '    return; }';
    
    html += '  recipe.forEach(function(item, idx) {';
    html += '    var div = document.createElement("div"); ';
    html += '    div.className = "b-row";';
    html += '    var n = document.createElement("div"); ';
    html += '    n.textContent = item.name;';
    html += '    var ctrl = document.createElement("div"); ';
    html += '    ctrl.style = "display:flex; gap:2px; align-items:center;";';
    html += '    var mn = document.createElement("button"); ';
    html += '    mn.textContent = "-"; mn.className = "qty-btn"; ';
    html += '    mn.onclick = function() { changeQty(idx, -1); };';
    html += '    var inp = document.createElement("input"); ';
    html += '    inp.type = "number"; inp.className = "qty-input"; ';
    html += '    inp.value = item.qty; inp.readOnly = true;';
    html += '    var pl = document.createElement("button"); ';
    html += '    pl.textContent = "+"; pl.className = "qty-btn"; ';
    html += '    pl.onclick = function() { changeQty(idx, 1); };';
    html += '    ctrl.appendChild(mn); ctrl.appendChild(inp); ';
    html += '    ctrl.appendChild(pl);';
    
    html += '    var del = document.createElement("span"); ';
    html += '    del.textContent = "✕"; ';
    html += '    del.style = "color:red; cursor:pointer; font-size:18px;";';
    html += '    del.onclick = function() { ';
    html += '      showConfirm("Удаление", "Убрать " + item.name + "?", ';
    html += '      function() { ';
    html += '        recipe.splice(idx, 1); renderRecipe(); ';
    html += '      }, true); ';
    html += '    };';
    
    html += '    div.appendChild(n); div.appendChild(ctrl); ';
    html += '    div.appendChild(del); list.appendChild(div);';
    html += '  });';
    html += '}';

    html += 'function changeQty(idx, delta) {';
    html += '  recipe[idx].qty = parseFloat(recipe[idx].qty) + delta;';
    html += '  if (recipe[idx].qty <= 0) {';
    html += '    showConfirm("Удаление", "Удалить позицию?", function() {';
    html += '      recipe.splice(idx, 1); renderRecipe();';
    html += '    }, true);';
    html += '  } else { renderRecipe(); }';
    html += '}';

    html += 'function saveRecipe() {';
    html += '  fetch("/api/warehouse/bouquets/recipe/save", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ bouquet_id: bId, items: recipe }) })';
    html += '  .then(function(r){return r.json();}).then(function(d){ ';
    html += '    if (d.ok) { showAlert("Готово", "Состав сохранен", true); ';
    html += '    setTimeout(function(){window.location.href=';
    html += '    "/warehouse/bouquets";}, 1000); } ';
    html += '    else showAlert("Ошибка", d.error, false); })';
    html += '  .catch(function(){ showAlert("Ошибка", "Сеть", false); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 57. API СОХРАНЕНИЯ РЕЦЕПТА ======
  app.post('/api/warehouse/bouquets/recipe/save', async (req, res) => {
    const client = await pool.connect();
    try {
      const bId = parseInt(req.body.bouquet_id);
      const items = req.body.items;
      if (!bId || !Array.isArray(items)) {
        client.release(); 
        return res.json({ ok: false, error: 'Неверные данные' });
      }

      await client.query('BEGIN');
      await client.query(
        'DELETE FROM wh_bouquet_recipes WHERE bouquet_id = $1', 
        [bId]
      );
      
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(
          'INSERT INTO wh_bouquet_recipes (bouquet_id, shop_item_id, qty) ' +
          'VALUES ($1, $2, $3)',
          [bId, it.shop_item_id, it.qty]
        );
      }
      
      await client.query('COMMIT');
      client.release();
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release(); 
      res.status(500).json({ ok: false, error: e.message });
    }
  });

}

module.exports = { setupWarehouse };