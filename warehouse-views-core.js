const pool = require('./db');

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n) {
  var num = parseFloat(String(n).replace(',', '.'));
  if (isNaN(num)) return '0';
  return num % 1 === 0 ? num.toString() :
    num.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function translateReason(r) {
  var map = {
    spoilage: 'Порча', loss: 'Потеря',
    markdown: 'Уценка', sorting: 'Пересорт'
  };
  return map[r] || r || '';
}

function getIconSvg(type) {
  var c = 'xmlns="http://www.w3.org/2000/svg" ' +
          'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2" stroke-linecap="round" ' +
          'stroke-linejoin="round" class="svg-ico"';
  if (type === 'home') return '<svg ' + c + '><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
  if (type === 'sale') return '<svg ' + c + '><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>';
  if (type === 'receipt') return '<svg ' + c + '><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
  if (type === 'writeoff') return '<svg ' + c + '><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  if (type === 'inventory') return '<svg ' + c + '><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>';
  if (type === 'history') return '<svg ' + c + '><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  if (type === 'docs') return '<svg ' + c + '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
  if (type === 'reports') return '<svg ' + c + '><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>';
  if (type === 'staff') return '<svg ' + c + '><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  if (type === 'settings') return '<svg ' + c + '><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  if (type === 'audit') return '<svg ' + c + '><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  if (type === 'bouquets') return '<svg ' + c + '><path d="M12 2v20M17 5l-5 5-5-5M7 19l5-5 5 5"/></svg>';
  if (type === 'cash') return '<svg ' + c + '><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>';
  if (type === 'card') return '<svg ' + c + '><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>';
  if (type === 'qr') return '<svg ' + c + '><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><path d="M3 14h7v7H3z"/></svg>';
  if (type === 'search') return '<svg ' + c + '><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  if (type === 'warn') return '<svg ' + c + '><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  return '';
}

function getUnifiedMenu(active) {
  const items = [
    { id: 'home', url: '/warehouse-app', text: 'Главная', icon: 'home' },
    { id: 'sale', url: '/warehouse/sale', text: 'Касса', icon: 'sale' },
    { id: 'receipts', url: '/warehouse/receipts', text: 'Приход', icon: 'receipt' },
    { id: 'writeoff', url: '/warehouse/writeoff', text: 'Списание', icon: 'writeoff' },
    { id: 'inventory', url: '/warehouse/inventory', text: 'Обзор', icon: 'inventory' },
    { id: 'history', url: '/warehouse/history', text: 'История', icon: 'history' },
    { id: 'bouquets', url: '/warehouse/bouquets', text: 'Букеты', icon: 'bouquets' },
    { id: 'documents', url: '/warehouse/documents', text: 'Документы', icon: 'docs' },
    { id: 'reports', url: '/warehouse/reports', text: 'Отчёты', icon: 'reports' },
    { id: 'staff', url: '/warehouse/staff', text: 'Флористы', icon: 'staff' },
    { id: 'audit', url: '/warehouse/audit', text: 'Журнал', icon: 'audit' },
    { id: 'settings', url: '/warehouse/settings', text: 'Настройки', icon: 'settings' }
  ];

  let html = '<div class="sidebar-overlay" id="unifiedMenuOverlay" onclick="toggleMenu()"></div>';
  html += '<div class="sidebar" id="unifiedMenuSidebar">';
  html += '<h3 style="margin-top:0; font-weight:800;">Меню</h3>';
  items.forEach(function(it) {
    let isActive = (active === it.id) ? 'active' : '';
    html += '<a href="' + it.url + '" class="menu-item ' + isActive + '">' + getIconSvg(it.icon) + it.text + '</a>';
  });
  html += '</div>';
  return html;
}

const metaSafari = '<meta name="format-detection" content="telephone=no">';
const fontLink = '<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&family=Inter:wght@400;600&display=swap" rel="stylesheet">';

let uiScript = `
  <style>
    :root {
      --f-brand: #064C49; --f-accent: #E1846D; --f-bg: #F5F8F7;
      --f-surface: #FFFFFF; --f-text: #183B39; --f-text-2: #6A8785;
      --f-border: #E1EAE9; --f-success: #2E8B57; --f-danger: #D9534F;
      --f-warn: #F0AD4E; --r-sm: 8px; --r-md: 12px; --r-lg: 16px;
      --r-xl: 24px; --sh-1: 0 2px 8px rgba(6,76,73,0.04);
      --sh-2: 0 4px 16px rgba(6,76,73,0.08);
      --sh-3: 0 10px 30px rgba(6,76,73,0.15);
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { 
      overflow-x: hidden; width: 100%; margin: 0; 
      background: var(--f-bg); color: var(--f-text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      touch-action: manipulation;
    }
    body { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; padding-bottom: env(safe-area-inset-bottom); }
    button, .btn, .numpad button { touch-action: manipulation; -webkit-user-select: none; user-select: none; }
    input, textarea { -webkit-user-select: text; user-select: text; }
    input:not([type="checkbox"]):not([type="radio"]), select, textarea {
      width: 100%; padding: 14px 16px; border: 1px solid var(--f-border);
      border-radius: var(--r-md); background: var(--f-surface);
      font-family: inherit; font-size: 16px; color: var(--f-text); font-weight: 500;
      transition: all 0.2s ease; margin-bottom: 16px;
      -webkit-appearance: none; box-shadow: var(--sh-1);
    }
    input:focus, select:focus, textarea:focus {
      outline: none; border-color: var(--f-brand); box-shadow: 0 0 0 3px rgba(6,76,73,0.1);
    }
    input::placeholder, textarea::placeholder { color: var(--f-text-2); font-weight: 400; }
    input[type="file"] { background: transparent; box-shadow: none; border: 1px dashed var(--f-border); cursor: pointer; }
    @keyframes blinkCaret { 0%, 100% { box-shadow: none; } 50% { box-shadow: inset -2px 0 0 var(--f-brand); } }
    .input-active { border: 2px solid var(--f-brand) !important; animation: blinkCaret 1s step-end infinite !important; }
    h1, h2, h3, h4 { margin: 0; color: var(--f-text); }
    .page-title { font-size: 22px; font-weight: 800; }
    .card-title { font-size: 16px; font-weight: 700; }
    .text-muted { color: var(--f-text-2); font-size: 13px; }
    .btn { display: flex; align-items: center; justify-content: center; padding: 14px 20px; border-radius: var(--r-md); font-weight: 600; font-size: 16px; font-family: inherit; border: none; cursor: pointer; transition: 0.2s; text-decoration: none; }
    .btn-primary { background: var(--f-brand); color: #fff; box-shadow: 0 4px 12px rgba(6,76,73,0.2); }
    .btn-primary:active { transform: scale(0.98); }
    .btn-secondary { background: var(--f-surface); color: var(--f-brand); border: 1px solid var(--f-border); box-shadow: var(--sh-1); }
    .btn-danger { background: var(--f-danger); color: #fff; }
    .card { background: var(--f-surface); border-radius: var(--r-lg); padding: 16px; box-shadow: var(--sh-1); border: 1px solid rgba(0,0,0,0.02); margin-bottom: 12px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .page-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 0; margin-bottom: 12px; }
    .page-header-left { display: flex; align-items: center; gap: 12px; }
    .back-btn { font-size: 24px; text-decoration: none; color: var(--f-brand); display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: #fff; border-radius: 50%; box-shadow: var(--sh-1); }
    .burger-btn { font-size: 24px; background: #fff; border: none; color: var(--f-brand); cursor: pointer; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: var(--sh-1); }
    .flowind-watermark { position: fixed; bottom: calc(16px + env(safe-area-inset-bottom)); left: 16px; display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12px; color: var(--f-brand); opacity: 0.15; pointer-events: none; z-index: 900; }
    .svg-ico { width: 24px; height: 24px; vertical-align: middle; margin-right: 12px; color: currentColor; }
    body.menu-open .page-header, body.menu-open input, body.menu-open select, body.menu-open textarea, body.menu-open button:not(.sidebar button) { pointer-events: none; }
    body.menu-open .sidebar, body.menu-open .sidebar-overlay { pointer-events: auto; }
    .sidebar { position: fixed; top: 0; right: -300px; width: 280px; height: 100%; background: var(--f-surface); box-shadow: var(--sh-3); transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1); z-index: 3000; padding: 24px; padding-bottom: env(safe-area-inset-bottom); overflow-y: auto; }
    .sidebar.open { right: 0; }
    .sidebar-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); display: none; z-index: 2999; }
    .sidebar-overlay.open { display: block; }
    .menu-item { display: flex; align-items: center; padding: 12px 16px; text-decoration: none; color: var(--f-text); font-size: 15px; border-radius: var(--r-md); margin-bottom: 4px; font-weight: 600; transition: 0.2s; }
    .menu-item.active { background: rgba(6,76,73,0.06); color: var(--f-brand); font-weight: 700; }
    .custom-modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(6, 76, 73, 0.4); z-index: 4000; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
    .custom-modal { background: #fff; padding: 24px; border-radius: var(--r-xl); width: 90%; max-width: 340px; text-align: center; box-shadow: var(--sh-3); }
    .modal-icon-wrap { margin: 0 auto 16px; width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
    .custom-modal h3 { margin: 0 0 8px 0; font-size: 20px; font-weight: 800; }
    .custom-modal p { margin: 0 0 24px 0; font-size: 15px; color: var(--f-text-2); line-height: 1.5; }
    .custom-modal-btns { display: flex; gap: 12px; }
    .custom-modal-btns button { flex: 1; padding: 14px; border: none; border-radius: var(--r-md); font-size: 16px; font-weight: 700; font-family: inherit; cursor: pointer; }
    .btn-cancel { background: var(--f-bg); color: var(--f-text-2); }
    .btn-ok { background: var(--f-brand); color: #fff; }
    .btn-danger { background: var(--f-danger); color: #fff; }
    .empty-state { text-align: center; padding: 40px 20px; color: var(--f-text-2); }
    .empty-state-title { font-size: 18px; font-weight: 800; color: var(--f-text); margin-bottom: 8px; }
  </style>
  <script>
    function fmtNum(n) {
      var num = parseFloat(String(n).replace(",", "."));
      if (isNaN(num)) return "0";
      return num % 1 === 0 ? num.toString() : num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");
    }
    function translateReason(r) {
      var map = { spoilage: "Порча", loss: "Потеря", markdown: "Уценка", sorting: "Пересорт" };
      return map[r] || r || "";
    }
  </script>
  <script>
    function showAlert(title, text, isSuccess) {
      var ov = document.getElementById('uiModal');
      var icon = document.getElementById('uiModalIcon');
      icon.innerHTML = '';
      if (isSuccess) {
        icon.style.background = '#E8F5E9'; icon.style.color = '#2E8B57';
        icon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        if (title === 'Успех') title = 'Готово';
      } else {
        icon.style.background = '#FFEBEE'; icon.style.color = '#D9534F';
        icon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
      }
      document.getElementById('uiModalTitle').innerText = title;
      document.getElementById('uiModalText').innerText = text;
      var btns = document.getElementById('uiModalBtns');
      var btnClass = isSuccess ? 'btn-ok' : 'btn-danger';
      btns.innerHTML = '<button class="' + btnClass + '" onclick="closeModal()">ОК</button>';
      ov.style.display = 'flex';
    }
    function showConfirm(title, text, onConfirm, isDanger) {
      var ov = document.getElementById('uiModal');
      var icon = document.getElementById('uiModalIcon');
      icon.innerHTML = '';
      icon.style.background = isDanger ? '#FFEBEE' : '#E0F2F1';
      icon.style.color = isDanger ? '#D9534F' : '#064C49';
      icon.innerHTML = isDanger ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>' : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
      document.getElementById('uiModalTitle').innerText = title;
      document.getElementById('uiModalText').innerText = text;
      var btns = document.getElementById('uiModalBtns');
      var btnClass = isDanger ? 'btn-danger' : 'btn-ok';
      btns.innerHTML = '<button class="btn-cancel" onclick="closeModal()">Отмена</button>' + '<button class="' + btnClass + '" id="uiModalConfirmBtn">Да</button>';
      ov.style.display = 'flex';
      document.getElementById('uiModalConfirmBtn').onclick = function() { closeModal(); onConfirm(); };
    }
    function showPrompt(title, placeholder, defaultVal, onOk) {
      var ov = document.getElementById('uiModal');
      var icon = document.getElementById('uiModalIcon');
      icon.innerHTML = '';
      icon.style.background = '#E0F2F1'; icon.style.color = '#064C49';
      icon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
      document.getElementById('uiModalTitle').innerText = title;
      var p = document.getElementById('uiModalText');
      p.innerHTML = '<input type="text" id="uiPromptInput" style="margin-bottom:0; margin-top:10px;" placeholder="' + placeholder + '" value="' + (defaultVal || '') + '">';
      var btns = document.getElementById('uiModalBtns');
      btns.innerHTML = '<button class="btn-cancel" onclick="closeModal()">Отмена</button>' + '<button class="btn-ok" id="uiModalOkBtn">ОК</button>';
      ov.style.display = 'flex';
      setTimeout(function() { var inp = document.getElementById('uiPromptInput'); if (inp) { inp.focus(); inp.select(); } }, 100);
      document.getElementById('uiModalOkBtn').onclick = function() {
        var val = document.getElementById('uiPromptInput').value;
        closeModal(); onOk(val);
      };
    }
    function closeModal() {
      document.getElementById('uiModal').style.display = 'none';
      document.getElementById('uiModalBtns').innerHTML = '';
      document.getElementById('uiModalText').innerHTML = '';
    }
    function toggleMenu() {
      var sb = document.getElementById('unifiedMenuSidebar');
      var ov = document.getElementById('unifiedMenuOverlay');
      if (sb && ov) { 
        sb.classList.toggle('open'); 
        ov.classList.toggle('open'); 
        document.body.classList.toggle('menu-open');
      }
    }
  </script>
  <div class="custom-modal-overlay" id="uiModal">
    <div class="custom-modal">
      <div id="uiModalIcon" class="modal-icon-wrap"></div>
      <h3 id="uiModalTitle"></h3>
      <p id="uiModalText"></p>
      <div class="custom-modal-btns" id="uiModalBtns"></div>
    </div>
  </div>
  <div class="flowind-watermark">
    <svg viewBox="0 0 100 100" style="width: 20px; height: 20px;">
      <rect x="10" y="10" width="80" height="80" rx="20" fill="currentColor"/>
      <path d="M25 30 L70 30 Q75 30 75 35 L75 60 Q75 65 70 65 L55 65 L45 75 L45 65 L30 65 Q25 65 25 60 L25 35 Q25 30 30 30 Z" fill="none" stroke="#fff" stroke-width="5"/>
      <path d="M40 45 Q55 35 60 50 Q45 60 40 45 Z" fill="#fff"/>
      <path d="M55 45 Q70 35 75 50 Q60 60 55 45 Z" fill="#fff"/>
    </svg>
    Flowind
  </div>
`;
function setupWarehouseViewsCore(app, bot, s3ctx, getAuth) {
  // ====== 1. ВХОД ======
  app.get('/warehouse-login', (req, res) => {
    const shopId = req.query.shop || 'kupidon';
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += metaSafari;
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink + uiScript + '<style>';
    html += 'body { text-align: center; padding: 40px 20px; }';
    html += '.login-card { background: var(--f-surface); ';
    html += 'border-radius: var(--r-xl); padding: 32px 24px; ';
    html += 'max-width: 400px; margin: 0 auto; box-shadow: var(--sh-2); }';
    html += 'input { font-size: 20px; padding: 16px; width: 100%; ';
    html += 'text-align: center; margin: 0 auto 16px; }';
    html += '.link-owner { display: block; margin-top: 24px; ';
    html += 'color: var(--f-text-2); font-size: 13px; cursor: pointer; }';
    html += '.login-block { display: none; }';
    html += '</style></head><body>';
    
    html += '<div class="login-card">';
    html += '<div style="display:flex; align-items:center; ';
    html += 'justify-content:center; margin-bottom:24px;">';
    html += '<svg viewBox="0 0 100 100" ';
    html += 'style="width: 48px; height: 48px; margin-right: 12px;">';
    html += '<rect x="10" y="10" width="80" height="80" rx="20" ';
    html += 'fill="var(--f-brand)"/>';
    html += '<path d="M25 30 L70 30 Q75 30 75 35 L75 60 Q75 65 70 65 ';
    html += 'L55 65 L45 75 L45 65 L30 65 Q25 65 25 60 L25 35 Q25 30 30 30 Z" ';
    html += 'fill="none" stroke="#fff" stroke-width="5"/>';
    html += '<path d="M40 45 Q55 35 60 50 Q45 60 40 45 Z" ';
    html += 'fill="var(--f-accent)"/>';
    html += '<path d="M55 45 Q70 35 75 50 Q60 60 55 45 Z" fill="#fff"/>';
    html += '</svg>';
    html += '<h1 style="margin:0; font-size:26px; font-weight:800; ';
    html += 'letter-spacing:-0.5px;">Flowind</h1>';
    html += '</div>';

    html += '<div id="pinBlock">';
    html += '<p class="text-muted" style="margin-bottom:16px;">';
    html += 'Введите PIN-код флориста</p>';
    html += '<input type="password" id="pin" maxlength="4" ';
    html += 'inputmode="numeric" placeholder="****">';
    html += '<button class="btn btn-primary" onclick="loginPin()">';
    html += 'Войти</button>';
    html += '<span class="link-owner" onclick="showOwnerLogin()">';
    html += 'Вход для владельца (Логин/Пароль)</span>';
    html += '</div>';

    html += '<div id="ownerBlock" class="login-block">';
    html += '<p class="text-muted" style="margin-bottom:16px;">';
    html += 'Вход для владельца</p>';
    html += '<input type="text" id="login" placeholder="Логин" ';
    html += 'autocomplete="username" style="text-align:left;">';
    html += '<input type="password" id="password" placeholder="Пароль" ';
    html += 'autocomplete="current-password" style="text-align:left;">';
    html += '<button class="btn btn-primary" onclick="loginOwner()">';
    html += 'Войти</button>';
    html += '<span class="link-owner" onclick="showPinLogin()">';
    html += 'Вход для флориста (PIN)</span>';
    html += '</div>';

    html += '</div>';

    html += '<script>';
    html += 'function showOwnerLogin() {';
    html += '  document.getElementById("pinBlock").style.display = "none";';
    html += '  document.getElementById("ownerBlock").style.display = "block";';
    html += '}';
    html += 'function showPinLogin() {';
    html += '  document.getElementById("ownerBlock").style.display = "none";';
    html += '  document.getElementById("pinBlock").style.display = "block";';
    html += '}';

    html += 'function loginPin() {';
    html += '  var pin = document.getElementById("pin").value;';
    html += '  var btn = document.querySelector("#pinBlock button");';
    html += '  btn.disabled = true; btn.innerText = "Вход...";';
    html += '  fetch("/api/warehouse/auth", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ shopId: "' + shopId + '", ';
    html += '  pin: pin }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(data) {';
    html += '    if (data.ok) window.location.href = "/warehouse-app"; ';
    html += '    else { btn.disabled = false; btn.innerText = "Войти";';
    html += '      if (data.rate_limited) showAlert("Стоп", ';
    html += '      "Аккаунт заблокирован на 15 минут.", false); ';
    html += '      else showAlert("Ошибка", "Неверный PIN", false); }';
    html += '  }).catch(function() { btn.disabled = false; ';
    html += '  btn.innerText = "Войти"; showAlert("Ошибка сети", ';
    html += '  "Проверьте интернет", false); });';
    html += '}';

    html += 'function loginOwner() {';
    html += '  var lg = document.getElementById("login").value;';
    html += '  var pw = document.getElementById("password").value;';
    html += '  var btn = document.querySelector("#ownerBlock button");';
    html += '  btn.disabled = true; btn.innerText = "Вход...";';
    html += '  fetch("/api/warehouse/auth-owner", { method: "POST", ';
    html += '  headers: { "Content-Type": "application/json" }, ';
    html += '  body: JSON.stringify({ login: lg, password: pw }) })';
    html += '  .then(function(r) { return r.json(); })';
    html += '  .then(function(data) {';
    html += '    if (data.ok) window.location.href = "/warehouse-app"; ';
    html += '    else { btn.disabled = false; btn.innerText = "Войти";';
    html += '      if (data.rate_limited) showAlert("Стоп", ';
    html += '      "Аккаунт заблокирован.", false); ';
    html += '      else showAlert("Ошибка", "Неверный логин/пароль", false); }';
    html += '  }).catch(function() { btn.disabled = false; ';
    html += '  btn.innerText = "Войти"; showAlert("Ошибка сети", ';
    html += '  "Проверьте интернет", false); });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // ====== 2. ГЛАВНЫЙ ЭКРАН ======
  app.get('/warehouse-app', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');

      const shopId = auth.shopId;
      const chatId = auth.chatId;

      const r = await pool.query(
        'SELECT role, name, can_receipt, can_sale, ' +
        'can_writeoff FROM admins WHERE chat_id = $1 ' +
        'AND shop_id = $2 LIMIT 1', [chatId, shopId]
      );
      
      if (r.rows.length === 0) {
        return res.redirect('/warehouse-login?shop=' + shopId);
      }

      const user = r.rows[0];
      const isOwner = user.role === 'owner';
      const userName = esc(user.name || 'Флорист');
      const canSale = user.can_sale === true;
      const canWriteoff = user.can_writeoff === true;
      const canReceipt = user.can_receipt === true;

      const shiftRes = await pool.query(
        'SELECT id FROM wh_shifts WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND status = \'open\' LIMIT 1',
        [shopId, chatId]
      );
      const hasOpenShift = shiftRes.rows.length > 0;

      const attRes = await pool.query(
        'SELECT ' +
        '(SELECT COUNT(*) FROM wh_shop_items WHERE shop_id = $1 ' +
        'AND retail_price = 0 AND (hidden = FALSE OR hidden IS NULL)) ' +
        'as no_price, ' +
        '(SELECT COUNT(*) FROM wh_shop_items WHERE shop_id = $1 ' +
        'AND current_stock < 0 AND (hidden = FALSE OR hidden IS NULL)) ' +
        'as minus_stock, ' +
        '(SELECT COUNT(*) FROM wh_shop_items WHERE shop_id = $1 ' +
        'AND current_stock = 0 AND retail_price > 0 ' +
        'AND (hidden = FALSE OR hidden IS NULL)) as zero_stock',
        [shopId]
      );
      
      const att = attRes.rows[0];
      const hasAttention = (parseInt(att.no_price) > 0 || 
                            parseInt(att.minus_stock) > 0 || 
                            parseInt(att.zero_stock) > 0);

      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink;
      html += '<script src="https://telegram.org/js/';
      html += 'telegram-web-app.js"><\/script>';
      html += uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      html += '.top-bar { display: flex; justify-content: space-between; ';
      html += 'align-items: center; padding: 16px 0; margin-bottom: 8px; }';
      html += '.logo-wrap { display: flex; align-items: center; gap: 10px; }';
      html += '.logo-svg { width: 40px; height: 40px; }';
      html += '.logo-text { font-size: 20px; font-weight: 800; line-height: 1; }';
      html += '.logo-text span { font-size: 10px; color: var(--f-text-2); ';
      html += 'font-weight: 600; letter-spacing: 1px; }';
      
      html += '.shift-badge { display: inline-flex; align-items: center; ';
      html += 'padding: 6px 12px; border-radius: 20px; font-size: 12px; ';
      html += 'font-weight: 700; text-decoration: none; margin-right: 12px; }';
      html += '.shift-open { background: #E8F5E9; color: #2E8B57; }';
      html += '.shift-closed { background: #FFEBEE; color: #D9534F; }';
      html += '.dot { width: 6px; height: 6px; border-radius: 50%; ';
      html += 'margin-right: 6px; }';
      html += '.dot-green { background: #2E8B57; }';
      html += '.dot-red { background: #D9534F; }';
      
      html += '.attention-box { background: #FFF8E1; border-radius: 16px; ';
      html += 'padding: 16px; margin-bottom: 20px; border: 1px solid #FFE082; }';
      html += '.attention-title { font-size: 14px; font-weight: 800; ';
      html += 'color: #F57F17; margin-bottom: 8px; display: flex; ';
      html += 'align-items: center; gap: 6px; }';
      html += '.att-item { display: flex; justify-content: space-between; ';
      html += 'font-size: 14px; margin-bottom: 4px; font-weight: 500; }';
      html += '.att-item.red { color: var(--f-danger); font-weight: 700; }';
      
      html += '.action-grid { display: grid; grid-template-columns: 1fr 1fr; ';
      html += 'gap: 12px; }';
      html += '.action-card { background: #fff; padding: 24px 16px; ';
      html += 'border-radius: 16px; text-decoration: none; ';
      html += 'color: var(--f-text); font-weight: 700; font-size: 15px; ';
      html += 'display: flex; flex-direction: column; align-items: center; ';
      html += 'justify-content: center; box-shadow: var(--sh-1); ';
      html += 'border: 1px solid rgba(0,0,0,0.02); transition: 0.2s; }';
      html += '.action-card:active { transform: scale(0.98); }';
      html += '.action-card svg { width: 32px; height: 32px; ';
      html += 'margin-bottom: 12px; color: var(--f-brand); }';
      html += '.full { grid-column: 1 / -1; }';
      html += '</style></head><body>';

      html += '<div class="top-bar">';
      html += '<div class="logo-wrap">';
      html += '<svg class="logo-svg" viewBox="0 0 100 100">';
      html += '<rect x="10" y="10" width="80" height="80" rx="20" ';
      html += 'fill="var(--f-brand)"/>';
      html += '<path d="M25 30 L70 30 Q75 30 75 35 L75 60 Q75 65 70 65 ';
      html += 'L55 65 L45 75 L45 65 L30 65 Q25 65 25 60 L25 35 Q25 30 30 30 Z" ';
      html += 'fill="none" stroke="#fff" stroke-width="5"/>';
      html += '<path d="M40 45 Q55 35 60 50 Q45 60 40 45 Z" ';
      html += 'fill="var(--f-accent)"/>';
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
      html += '<button class="burger-btn" onclick="toggleMenu()">';
      html += '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" ';
      html += 'stroke="currentColor" stroke-width="2" stroke-linecap="round">';
      html += '<line x1="3" y1="12" x2="21" y2="12"></line>';
      html += '<line x1="3" y1="6" x2="21" y2="6"></line>';
      html += '<line x1="3" y1="18" x2="21" y2="18"></line></svg>';
      html += '</button>';
      html += '</div></div>';

      html += '<h2 style="margin:0 0 20px 0; font-size:26px; font-weight:800;">';
      html += 'Привет, ' + userName + '!</h2>';

      if (hasAttention) {
        html += '<div class="attention-box">';
        html += '<div class="attention-title">';
        html += getIconSvg('warn') + ' Требует внимания:';
        html += '</div>';
        
        if (parseInt(att.no_price) > 0) {
          html += '<div class="att-item"><span>Без розничной цены:</span>';
          html += '<span>' + att.no_price + ' шт</span></div>';
        }
        if (parseInt(att.minus_stock) > 0) {
          html += '<div class="att-item red">';
          html += '<span>Минусовой остаток:</span>';
          html += '<span>' + att.minus_stock + ' шт</span></div>';
        }
        if (parseInt(att.zero_stock) > 0) {
          html += '<div class="att-item"><span>Закончился товар:</span>';
          html += '<span>' + att.zero_stock + ' шт</span></div>';
        }
        html += '</div>';
      }

      html += '<div class="action-grid">';
      if (isOwner || canSale) {
        html += '<a href="/warehouse/sale" class="action-card">';
        html += getIconSvg('sale') + 'Продажа</a>';
      }
      if (isOwner || canReceipt) {
        html += '<a href="/warehouse/receipts" class="action-card">';
        html += getIconSvg('receipt') + 'Приход</a>';
      }
      if (isOwner || canWriteoff) {
        html += '<a href="/warehouse/writeoff" class="action-card">';
        html += getIconSvg('writeoff') + 'Списание</a>';
      }
      html += '<a href="/warehouse/inventory" class="action-card">';
      html += getIconSvg('inventory') + 'Обзор склада</a>';
      
      html += '<a href="/warehouse/history" class="action-card full">';
      html += getIconSvg('history') + 'История смены</a>';
      html += '</div>';

      html += getUnifiedMenu('home');
      html += '<script>Telegram.WebApp.ready();<\/script>';
      html += '</body></html>';
      res.send(html);
    } catch (e) { 
      console.error('App error:', e.message);
      res.status(500).send('Ошибка сервера'); 
    }
  });
}

module.exports = {
  esc, fmtNum, translateReason, getIconSvg,
  getUnifiedMenu, metaSafari, fontLink, uiScript,
  setupWarehouseViewsCore
};