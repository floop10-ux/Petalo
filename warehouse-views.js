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
    spoilage: 'Порча',
    loss: 'Потеря',
    markdown: 'Уценка',
    sorting: 'Пересорт'
  };
  return map[r] || r || '';
}

function getIconSvg(type) {
  var c = 'xmlns="http://www.w3.org/2000/svg" ' +
          'viewBox="0 0 24 24" ' +
          'fill="none" stroke="currentColor" ' +
          'stroke-width="2" stroke-linecap="round" ' +
          'stroke-linejoin="round" class="svg-ico"';
  if (type === 'home') return '<svg ' + c +
    '><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
    '<polyline points="9 22 9 12 15 12 15 22"/></svg>';
  if (type === 'sale') return '<svg ' + c +
    '><rect x="2" y="5" width="20" height="14" rx="2"/>' +
    '<line x1="2" y1="10" x2="22" y2="10"/></svg>';
  if (type === 'receipt') return '<svg ' + c +
    '><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 ' +
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
  if (type === 'bouquets') return '<svg ' + c +
    '><path d="M12 2v20M17 5l-5 5-5-5M7 19l5-5 5 5"/></svg>';
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
  if (type === 'search') return '<svg ' + c +
    '><circle cx="11" cy="11" r="8"/>' +
    '<line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  if (type === 'warn') return '<svg ' + c +
    '><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94' +
    'a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
    '<line x1="12" y1="9" x2="12" y2="13"/>' +
    '<line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  return '';
}

function getUnifiedMenu(active) {
  const items = [
    { id: 'home', url: '/warehouse-app', text: 'Главная', icon: 'home' },
    { id: 'sale', url: '/warehouse/sale', text: 'Касса', icon: 'sale' },
    { id: 'receipts', url: '/warehouse/receipts', text: 'Приход',
      icon: 'receipt' },
    { id: 'writeoff', url: '/warehouse/writeoff', text: 'Списание',
      icon: 'writeoff' },
    { id: 'inventory', url: '/warehouse/inventory', text: 'Обзор',
      icon: 'inventory' },
    { id: 'history', url: '/warehouse/history', text: 'История',
      icon: 'history' },
    { id: 'bouquets', url: '/warehouse/bouquets', text: 'Букеты',
      icon: 'bouquets' },
    { id: 'documents', url: '/warehouse/documents', text: 'Документы',
      icon: 'docs' },
    { id: 'reports', url: '/warehouse/reports', text: 'Отчёты',
      icon: 'reports' },
    { id: 'staff', url: '/warehouse/staff', text: 'Флористы',
      icon: 'staff' },
    { id: 'audit', url: '/warehouse/audit', text: 'Журнал', icon: 'audit' },
    { id: 'settings', url: '/warehouse/settings', text: 'Настройки',
      icon: 'settings' }
  ];

  let html = '<div class="sidebar-overlay" ';
  html += 'id="unifiedMenuOverlay" onclick="toggleMenu()"></div>';
  html += '<div class="sidebar" id="unifiedMenuSidebar">';
  html += '<h3 style="margin-top:0; font-weight:800;">Меню</h3>';
  
  items.forEach(function(it) {
    let isActive = (active === it.id) ? 'active' : '';
    html += '<a href="' + it.url + '" class="menu-item ' + isActive;
    html += '">' + getIconSvg(it.icon) + it.text + '</a>';
  });
  
  html += '</div>';
  return html;
}

const metaSafari = '<meta name="format-detection" ' +
  'content="telephone=no">';
const fontLink = '<link href="https://fonts.googleapis.com/css2?' +
  'family=Manrope:wght@400;600;800&family=Inter:wght@400;600&' +
  'display=swap" rel="stylesheet">';

let uiScript = `
  <style>
    :root {
      --f-brand: #064C49;
      --f-accent: #E1846D;
      --f-bg: #F5F8F7;
      --f-surface: #FFFFFF;
      --f-text: #183B39;
      --f-text-2: #6A8785;
      --f-border: #E1EAE9;
      --f-success: #2E8B57;
      --f-danger: #D9534F;
      --f-warn: #F0AD4E;
      --r-sm: 8px;
      --r-md: 12px;
      --r-lg: 16px;
      --r-xl: 24px;
      --sh-1: 0 2px 8px rgba(6,76,73,0.04);
      --sh-2: 0 4px 16px rgba(6,76,73,0.08);
      --sh-3: 0 10px 30px rgba(6,76,73,0.15);
    }

    *, *::before, *::after { box-sizing: border-box; }
    html, body { 
      overflow-x: hidden; width: 100%; margin: 0; 
      background: var(--f-bg); color: var(--f-text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 
        'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    
    body { 
      -webkit-touch-callout: none; 
      -webkit-user-select: none; user-select: none; 
      padding-bottom: env(safe-area-inset-bottom);
    }
    input, textarea { 
      -webkit-user-select: text; user-select: text; 
    }

    input:not([type="checkbox"]):not([type="radio"]), select, textarea {
      width: 100%; padding: 14px 16px;
      border: 1px solid var(--f-border);
      border-radius: var(--r-md);
      background: var(--f-surface);
      font-family: inherit; font-size: 16px;
      color: var(--f-text); font-weight: 500;
      transition: all 0.2s ease; margin-bottom: 16px;
      -webkit-appearance: none; box-shadow: var(--sh-1);
    }
    input:focus, select:focus, textarea:focus {
      outline: none; border-color: var(--f-brand);
      box-shadow: 0 0 0 3px rgba(6,76,73,0.1);
    }
    input::placeholder, textarea::placeholder {
      color: var(--f-text-2); font-weight: 400;
    }
    input[type="file"] {
      background: transparent; box-shadow: none;
      border: 1px dashed var(--f-border); cursor: pointer;
    }

    @keyframes blinkCaret {
      0%, 100% { box-shadow: none; }
      50% { box-shadow: inset -2px 0 0 var(--f-brand); }
    }
    .input-active {
      border: 2px solid var(--f-brand) !important;
      animation: blinkCaret 1s step-end infinite !important;
    }

    h1, h2, h3, h4 { margin: 0; color: var(--f-text); }
    .page-title { font-size: 22px; font-weight: 800; }
    .card-title { font-size: 16px; font-weight: 700; }
    .text-muted { color: var(--f-text-2); font-size: 13px; }

    .btn {
      display: flex; align-items: center; justify-content: center;
      padding: 14px 20px; border-radius: var(--r-md);
      font-weight: 600; font-size: 16px; font-family: inherit;
      border: none; cursor: pointer; transition: 0.2s; 
      text-decoration: none;
    }
    .btn-primary { 
      background: var(--f-brand); color: #fff; 
      box-shadow: 0 4px 12px rgba(6,76,73,0.2); 
    }
    .btn-primary:active { transform: scale(0.98); }
    .btn-secondary { 
      background: var(--f-surface); color: var(--f-brand);
      border: 1px solid var(--f-border); box-shadow: var(--sh-1);
    }
    .btn-danger { background: var(--f-danger); color: #fff; }

    .card {
      background: var(--f-surface); border-radius: var(--r-lg);
      padding: 16px; box-shadow: var(--sh-1);
      border: 1px solid rgba(0,0,0,0.02); margin-bottom: 12px;
    }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    
    .page-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 0; margin-bottom: 12px;
    }
    .page-header-left { display: flex; align-items: center; gap: 12px; }
    .back-btn {
      font-size: 24px; text-decoration: none; color: var(--f-brand);
      display: flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; background: #fff;
      border-radius: 50%; box-shadow: var(--sh-1);
    }
    .burger-btn {
      font-size: 24px; background: #fff; border: none;
      color: var(--f-brand); cursor: pointer; width: 40px; height: 40px;
      border-radius: 50%; display: flex; align-items: center;
      justify-content: center; box-shadow: var(--sh-1);
    }

    .flowind-watermark { 
      position: fixed; bottom: calc(16px + env(safe-area-inset-bottom));
      left: 16px; display: flex; align-items: center; gap: 6px; 
      font-weight: 700; font-size: 12px; color: var(--f-brand); 
      opacity: 0.15; pointer-events: none; z-index: 900; 
    }

    .svg-ico { 
      width: 24px; height: 24px; vertical-align: middle; 
      margin-right: 12px; color: currentColor; 
    }

    .sidebar { 
      position: fixed; top: 0; right: -300px; width: 280px; height: 100%; 
      background: var(--f-surface); box-shadow: var(--sh-3); 
      transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
      z-index: 3000; padding: 24px; 
      padding-bottom: env(safe-area-inset-bottom); overflow-y: auto; 
    }
    .sidebar.open { right: 0; }
    .sidebar-overlay { 
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
      background: rgba(0,0,0,0.4); backdrop-filter: blur(2px);
      display: none; z-index: 2999; 
    }
    .sidebar-overlay.open { display: block; }
    .menu-item { 
      display: flex; align-items: center; padding: 12px 16px; 
      text-decoration: none; color: var(--f-text); font-size: 15px; 
      border-radius: var(--r-md); margin-bottom: 4px; font-weight: 600;
      transition: 0.2s;
    }
    .menu-item.active {
      background: rgba(6,76,73,0.06); color: var(--f-brand); 
      font-weight: 700;
    }

    .custom-modal-overlay { 
      display: none; position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(6, 76, 73, 0.4); z-index: 4000;
      align-items: center; justify-content: center;
      backdrop-filter: blur(4px); 
    }
    .custom-modal { 
      background: #fff; padding: 24px; border-radius: var(--r-xl); 
      width: 90%; max-width: 340px; text-align: center; 
      box-shadow: var(--sh-3); 
    }
    
    .modal-icon-wrap { 
      margin: 0 auto 16px; width: 56px; height: 56px;
      border-radius: 50%; display: flex; align-items: center; 
      justify-content: center; 
    }
    
    .custom-modal h3 { margin: 0 0 8px 0; font-size: 20px; 
      font-weight: 800; }
    .custom-modal p { margin: 0 0 24px 0; font-size: 15px; 
      color: var(--f-text-2); line-height: 1.5; }
    
    .custom-modal-btns { display: flex; gap: 12px; }
    .custom-modal-btns button { 
      flex: 1; padding: 14px; border: none; border-radius: var(--r-md);
      font-size: 16px; font-weight: 700; font-family: inherit; 
      cursor: pointer; 
    }
      
    .btn-cancel { background: var(--f-bg); color: var(--f-text-2); }
    .btn-ok { background: var(--f-brand); color: #fff; }
    .btn-danger { background: var(--f-danger); color: #fff; }

    .empty-state { text-align: center; padding: 40px 20px; 
      color: var(--f-text-2); }
    .empty-state-title { font-size: 18px; font-weight: 800; 
      color: var(--f-text); margin-bottom: 8px; }
    .empty-state-text { font-size: 14px; margin-bottom: 20px; }
  </style>
  <script>
    function fmtNum(n) {
      var num = parseFloat(String(n).replace(",", "."));
      if (isNaN(num)) return "0";
      return num % 1 === 0 ? num.toString() :
        num.toFixed(3).replace(/0+$/, "").replace(/\\.$/, "");
    }
    function translateReason(r) {
      var map = { spoilage: "Порча", loss: "Потеря",
        markdown: "Уценка", sorting: "Пересорт" };
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
      icon.innerHTML = isDanger 
        ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
        : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';

      document.getElementById('uiModalTitle').innerText = title;
      document.getElementById('uiModalText').innerText = text;
      var btns = document.getElementById('uiModalBtns');
      var btnClass = isDanger ? 'btn-danger' : 'btn-ok';
      btns.innerHTML = '<button class="btn-cancel" onclick="closeModal()">Отмена</button>' +
        '<button class="' + btnClass + '" id="uiModalConfirmBtn">Да</button>';
      ov.style.display = 'flex';
      document.getElementById('uiModalConfirmBtn').onclick = function() { 
        closeModal(); onConfirm(); 
      };
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
      btns.innerHTML = '<button class="btn-cancel" onclick="closeModal()">Отмена</button>' +
        '<button class="btn-ok" id="uiModalOkBtn">ОК</button>';
      ov.style.display = 'flex';
      
      setTimeout(function() {
        var inp = document.getElementById('uiPromptInput');
        if (inp) { inp.focus(); inp.select(); }
      }, 100);

      document.getElementById('uiModalOkBtn').onclick = function() {
        var val = document.getElementById('uiPromptInput').value;
        closeModal(); onOk(val);
      };
    }
    
    function closeModal() {
      var ov = document.getElementById('uiModal');
      ov.style.display = 'none';
      document.getElementById('uiModalBtns').innerHTML = '';
      document.getElementById('uiModalText').innerHTML = '';
    }

    function toggleMenu() {
      var sb = document.getElementById('unifiedMenuSidebar');
      var ov = document.getElementById('unifiedMenuOverlay');
      if (sb && ov) { sb.classList.toggle('open'); ov.classList.toggle('open'); }
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
function setupWarehouseViews(app, bot, s3ctx, getAuth) {

  // ====== 1. ВХОД ======
  app.get('/warehouse-login', (req, res) => {
    const shopId = req.query.shop || 'kupidon';
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += metaSafari;
    html += '<meta name="viewport" content="width=device-width, ';
    html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
    html += fontLink;
    html += uiScript;
    html += '<style>';
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
        'AND shop_id = $2 LIMIT 1',
        [chatId, shopId]
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

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
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
  // ====== 3. ОБЗОР СКЛАДА ======
  app.get('/warehouse/inventory', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const shopId = auth.shopId;

      const statsRes = await pool.query(
        'SELECT COALESCE(SUM(current_stock), 0) as stems, ' +
        'COALESCE(SUM(current_stock * avg_cost), 0) as cost, ' +
        'COALESCE(SUM(current_stock * retail_price), 0) as retail ' +
        'FROM wh_shop_items WHERE shop_id = $1 ' +
        'AND current_stock > 0 AND (hidden = FALSE OR hidden IS NULL)',
        [shopId]
      );
      const stats = statsRes.rows[0];

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.stats-bar { display: flex; gap: 12px; margin-bottom: 16px; }';
      html += '.stat-box { flex: 1; background: #fff; padding: 12px; ';
      html += 'border-radius: var(--r-md); text-align: center; ';
      html += 'box-shadow: var(--sh-1); }';
      html += '.stat-val { font-size: 18px; font-weight: 800; }';
      html += '.stat-lbl { font-size: 12px; color: var(--f-text-2); ';
      html += 'font-weight: 600; margin-top: 4px; }';

      html += '.search-wrap { position: relative; margin-bottom: 16px; }';
      html += '.search { width: 100%; padding: 14px 16px; border: none; ';
      html += 'border-radius: var(--r-md); box-sizing: border-box; ';
      html += 'font-family: inherit; font-size: 16px; ';
      html += 'box-shadow: var(--sh-1); }';
      
      html += '.controls { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 16px; gap: 8px; }';
      html += '.view-toggles { display: flex; gap: 4px; ';
      html += 'background: #e0e0e0; padding: 4px; border-radius: 10px; }';
      html += '.view-btn { border: none; background: none; padding: 8px; ';
      html += 'border-radius: 8px; cursor: pointer; color: #666; ';
      html += 'display: flex; }';
      html += '.view-btn.active { background: #fff; ';
      html += 'box-shadow: var(--sh-1); color: var(--f-brand); }';
      html += '.view-btn svg { width: 20px; height: 20px; }';
      
      html += '.limit-select { padding: 8px 12px; border-radius: 10px; ';
      html += 'border: none; font-family: inherit; font-weight: 600; ';
      html += 'color: var(--f-brand); background: #fff; ';
      html += 'box-shadow: var(--sh-1); width: 80px; text-align: center; ';
      html += 'margin: 0; }';

      html += '.h-scroll { display: flex; overflow-x: auto; ';
      html += 'gap: 8px; margin-bottom: 16px; padding-bottom: 4px; }';
      html += '.h-scroll::-webkit-scrollbar { display: none; }';
      
      html += '.cat-btn { padding: 8px 16px; border: none; ';
      html += 'border-radius: 20px; background: #fff; cursor: pointer; ';
      html += 'font-size: 14px; white-space: nowrap; ';
      html += 'font-family: inherit; color: var(--f-text); ';
      html += 'font-weight: 600; box-shadow: var(--sh-1); }';
      html += '.cat-btn.active { background: var(--f-brand); color: #fff; }';
      
      html += '.spec-btn { padding: 6px 12px; border: none; ';
      html += 'border-radius: 12px; background: #fff; cursor: pointer; ';
      html += 'font-size: 13px; font-weight: 600; font-family: inherit; ';
      html += 'box-shadow: var(--sh-1); color: var(--f-text); }';
      html += '.spec-btn.active { background: var(--f-brand); color: #fff; }';
      
      html += '.grid-tiles { display: grid; grid-template-columns: 1fr 1fr; ';
      html += 'gap: 12px; }';
      html += '.card-tile { background: #fff; padding: 12px; ';
      html += 'border-radius: var(--r-lg); text-align: center; ';
      html += 'text-decoration: none; color: var(--f-text); ';
      html += 'position: relative; box-shadow: var(--sh-1); }';
      html += '.card-tile img { width: 100%; height: 100px; ';
      html += 'object-fit: cover; border-radius: var(--r-md); ';
      html += 'margin-bottom: 8px; }';
      html += '.card-tile .ph { height: 100px; border-radius: var(--r-md); ';
      html += 'background: #F0F4F4; display: flex; align-items: center; ';
      html += 'justify-content: center; margin-bottom: 8px; }';
      
      html += '.grid-rows { display: flex; flex-direction: column; gap: 8px; }';
      html += '.card-row { background: #fff; padding: 12px 16px; ';
      html += 'border-radius: var(--r-md); display: flex; align-items: center; ';
      html += 'justify-content: space-between; text-decoration: none; ';
      html += 'color: var(--f-text); box-shadow: var(--sh-1); }';
      html += '.card-row .row-left { display: flex; align-items: center; ';
      html += 'gap: 12px; }';
      html += '.card-row img, .card-row .ph { width: 48px; height: 48px; ';
      html += 'border-radius: var(--r-sm); object-fit: cover; }';
      html += '.card-row .ph { background: #F0F4F4; display: flex; ';
      html += 'align-items: center; justify-content: center; }';
      
      html += '.name { font-size: 14px; font-weight: 600; margin-bottom: 4px; ';
      html += 'line-height: 1.2; word-break: break-word; }';
      html += '.card-row .name { font-size: 15px; margin-bottom: 0; }';
      html += '.stock { font-size: 13px; font-weight: 800; }';
      html += '.green { color: var(--f-success); } ';
      html += '.red { color: var(--f-danger); }';
      html += '.pin-icon { position: absolute; top: 8px; right: 8px; ';
      html += 'color: #E67E22; font-size: 18px; line-height: 1; }';
      html += '.card-row .pin-icon { position: static; margin-left: 6px; }';
      html += '.price-warn { font-size: 11px; color: var(--f-accent); ';
      html += 'font-weight: 800; margin-top: 4px; }';
      html += '.cost-info { font-size: 11px; color: var(--f-text-2); ';
      html += 'margin-top: 4px; font-weight: 600; }';
      
      html += '.archived-item { opacity: 0.6; }';
      html += '.archived-badge { font-size: 10px; color: #666; ';
      html += 'background: #eee; padding: 2px 6px; border-radius: 4px; ';
      html += 'display: inline-block; margin-top: 4px; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Обзор склада</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
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

      html += '<div class="search-wrap">';
      html += '<input type="text" class="search" id="search" ';
      html += 'placeholder="Поиск по названию..." onkeyup="applyFilters()">';
      html += '</div>';
      
      html += '<div class="controls">';
      html += '  <div style="display:flex; gap:6px; flex-wrap:wrap;">';
      html += '    <button class="spec-btn" id="cat-noprice" ';
      html += 'onclick="toggleNoPrice()">Без цены</button>';
      html += '    <button class="spec-btn" id="cat-minus" ';
      html += 'onclick="toggleMinus()">Минус</button>';
      html += '    <button class="spec-btn" id="cat-archive" ';
      html += 'onclick="toggleArchive()">Архив</button>';
      html += '  </div>';
      html += '  <div style="display:flex; gap:8px; align-items:center;">';
      html += '    <div class="view-toggles">';
      html += '      <button class="view-btn active" id="btn-view-tile" ';
      html += 'onclick="setViewMode(&apos;tile&apos;)">';
      html += '<svg viewBox="0 0 24 24" fill="none" ';
      html += 'stroke="currentColor" stroke-width="2">';
      html += '<rect x="3" y="3" width="7" height="7"/>';
      html += '<rect x="14" y="3" width="7" height="7"/>';
      html += '<rect x="14" y="14" width="7" height="7"/>';
      html += '<rect x="3" y="14" width="7" height="7"/></svg></button>';
      html += '      <button class="view-btn" id="btn-view-row" ';
      html += 'onclick="setViewMode(&apos;row&apos;)">';
      html += '<svg viewBox="0 0 24 24" fill="none" ';
      html += 'stroke="currentColor" stroke-width="2">';
      html += '<line x1="8" y1="6" x2="21" y2="6"/>';
      html += '<line x1="8" y1="12" x2="21" y2="12"/>';
      html += '<line x1="8" y1="18" x2="21" y2="18"/>';
      html += '<line x1="3" y1="6" x2="3.01" y2="6"/>';
      html += '<line x1="3" y1="12" x2="3.01" y2="12"/>';
      html += '<line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>';
      html += '    </div>';
      html += '    <select class="limit-select" id="limitSelect" ';
      html += 'onchange="setLimit(this.value)">';
      html += '      <option value="10">10 шт</option>';
      html += '      <option value="30">30 шт</option>';
      html += '      <option value="50">50 шт</option>';
      html += '      <option value="100">100 шт</option>';
      html += '    </select>';
      html += '  </div>';
      html += '</div>';

      html += '<div class="h-scroll" id="catList">';
      html += '<button class="cat-btn active" id="cat-0" ';
      html += 'onclick="setCat(0)">Все</button></div>';
      
      html += '<div id="itemsContainer"></div>';
      html += '<div id="pagination" style="display:flex; ';
      html += 'justify-content:center; gap:10px; margin-top:20px;"></div>';

      html += getUnifiedMenu('inventory');

      html += '<script>';
      html += 'var allItems = []; var currentCat = 0;';
      html += 'var currentPage = 1; var pageLimit = 10; ';
      html += 'var viewMode = "tile"; ';
      html += 'var noPriceFilter = false; var minusFilter = false; ';
      html += 'var showArchive = false;';

      html += 'var svgPh = \'<div style="width:100%;height:100px;';
      html += 'background:#F0F4F4;border-radius:8px;"></div>\';';
      html += 'var svgPhRow = \'<div style="width:48px;height:48px;';
      html += 'background:#F0F4F4;border-radius:8px;"></div>\';';

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
      html += '  noPriceFilter = !noPriceFilter; minusFilter = false; ';
      html += 'showArchive = false;';
      html += '  updateFilterUI(); currentPage = 1; applyFilters();';
      html += '}';
      
      html += 'function toggleMinus() {';
      html += '  minusFilter = !minusFilter; noPriceFilter = false; ';
      html += 'showArchive = false;';
      html += '  updateFilterUI(); currentPage = 1; applyFilters();';
      html += '}';
      
      html += 'function toggleArchive() {';
      html += '  showArchive = !showArchive; noPriceFilter = false; ';
      html += 'minusFilter = false;';
      html += '  updateFilterUI(); fetchItems();';
      html += '}';

      html += 'function updateFilterUI() {';
      html += '  var npBtn = document.getElementById("cat-noprice");';
      html += '  var mBtn = document.getElementById("cat-minus");';
      html += '  var aBtn = document.getElementById("cat-archive");';
      html += '  if (noPriceFilter) { npBtn.classList.add("active"); } ';
      html += '  else { npBtn.classList.remove("active"); }';
      html += '  if (minusFilter) { mBtn.classList.add("active"); } ';
      html += '  else { mBtn.classList.remove("active"); }';
      html += '  if (showArchive) { aBtn.classList.add("active"); } ';
      html += '  else { aBtn.classList.remove("active"); }';
      
      html += '  if (noPriceFilter || minusFilter || showArchive) {';
      html += '    document.querySelectorAll(".cat-btn").forEach(';
      html += '    function(b){ if(b.id !== "cat-noprice" && ';
      html += '    b.id !== "cat-minus" && b.id !== "cat-archive") ';
      html += '    b.classList.remove("active"); });';
      html += '  } else {';
      html += '    document.getElementById("cat-" + currentCat)';
      html += '    .classList.add("active");';
      html += '  }';
      html += '}';

      html += 'fetch("/api/warehouse/categories")';
      html += '.then(function(r){return r.json();}).then(function(d){';
      html += '  if (d.ok) { ';
      html += '  var cl = document.getElementById("catList"); ';
      html += '  d.categories.forEach(function(c){ ';
      html += '    var b = document.createElement("button"); ';
      html += '    b.className = "cat-btn"; b.id = "cat-" + c.id; ';
      html += '    b.innerText = c.name; ';
      html += '    b.onclick = function(){setCat(c.id);}; ';
      html += '    cl.appendChild(b); }); }';
      html += '}).catch(function(){});';

      html += 'function fetchItems() {';
      html += '  var url = "/api/warehouse/items?t=" + Date.now();';
      html += '  if (showArchive) url += "&show_archive=true";';
      html += '  fetch(url)';
      html += '  .then(function(r){return r.json();}).then(function(d){';
      html += '    if (d.ok) { allItems = d.items; applyFilters(); } ';
      html += '    else { ';
      html += '      var g = document.getElementById("itemsContainer"); ';
      html += '      g.textContent = "Ошибка API"; ';
      html += '    }';
      html += '  }).catch(function(err){ ';
      html += '    var g = document.getElementById("itemsContainer"); ';
      html += '    g.textContent = "Ошибка сети"; ';
      html += '  });';
      html += '}';
      html += 'fetchItems();';

      html += 'function setCat(id) { ';
      html += 'noPriceFilter = false; minusFilter = false; showArchive = false;';
      html += 'updateFilterUI();';
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
      html += '    i.category_id === currentCat);';
      html += '    var matchP = !noPriceFilter || ';
      html += '    (parseFloat(i.retail_price) === 0);';
      html += '    var matchM = !minusFilter || ';
      html += '    (parseFloat(i.current_stock) < 0);';
      html += '    return matchQ && matchC && matchP && matchM;';
      html += '  });';
      html += '  currentPage = 1; render(filtered);';
      html += '}';

      html += 'var filteredItems = [];';
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
      html += '      empty.style = "grid-column: 1 / -1; text-align:center; ';
      html += '      padding:30px; color:#888;";';
      html += '      empty.innerText = "Ничего не найдено"; ';
      html += '      container.appendChild(empty); }';
      
      html += '    pageItems.forEach(function(i) {';
      html += '      var a = document.createElement("a");';
      html += '      a.href = "/warehouse/item?id=" + i.id;';
      html += '      var stock = parseFloat(i.current_stock) || 0;';
      html += '      var cl = stock > 0 ? "green" : "red";';
      html += '      var unit = i.unit || "шт";';
      html += '      var hasPrice = parseFloat(i.retail_price) > 0;';
      html += '      var isArchived = i.hidden === true;';
      
      html += '      var costStr = "";';
      html += '      if (stock > 0 && !isArchived) {';
      html += '        var avgCost = parseFloat(i.avg_cost) || 0;';
      html += '        var totalCost = stock * avgCost;';
      html += '        costStr = "(" + Math.round(avgCost) + " ₽/шт) = " + ';
      html += 'Math.round(totalCost).toLocaleString("ru-RU") + " ₽";';
      html += '      }';
      
      html += '      if (viewMode === "tile") {';
      html += '        a.className = "card-tile";';
      html += '        if (isArchived) a.classList.add("archived-item");';
      html += '        if (i.photo_url) { ';
      html += '          var img = document.createElement("img"); ';
      html += '          img.src = i.photo_url; a.appendChild(img); } ';
      html += '        else { ';
      html += '          var ph = document.createElement("div"); ';
      html += '          ph.className = "ph"; ph.innerHTML = svgPh; ';
      html += '          a.appendChild(ph); }';
      
      html += '        if (i.is_pinned) { ';
      html += '          var pin = document.createElement("div"); ';
      html += '          pin.className = "pin-icon"; ';
      html += '          pin.textContent = "★"; a.appendChild(pin); }';
      
      html += '        var nm = document.createElement("div"); ';
      html += '        nm.className = "name"; nm.textContent = i.name; ';
      html += '        a.appendChild(nm);';
      
      html += '        var st = document.createElement("div"); ';
      html += '        st.className = "stock " + cl; ';
      html += '        st.textContent = fmtNum(stock) + " " + unit; ';
      html += '        a.appendChild(st);';
      
      html += '        if (costStr) { ';
      html += '          var cDiv = document.createElement("div"); ';
      html += '          cDiv.className = "cost-info"; ';
      html += '          cDiv.textContent = costStr; ';
      html += '          a.appendChild(cDiv); }';
      
      html += '        if (!hasPrice && !isArchived) { ';
      html += '          var pw = document.createElement("div"); ';
      html += '          pw.className = "price-warn"; ';
      html += '          pw.textContent = "Нет цены"; a.appendChild(pw); }';
      
      html += '        if (isArchived) {';
      html += '          var ab = document.createElement("div");';
      html += '          ab.className = "archived-badge"; ';
      html += '          ab.textContent = "Архив"; a.appendChild(ab); }';
      
      html += '      } else {';
      html += '        a.className = "card-row";';
      html += '        if (isArchived) a.classList.add("archived-item");';
      html += '        var left = document.createElement("div"); ';
      html += '        left.className = "row-left";';
      
      html += '        if (i.photo_url) { ';
      html += '          var img = document.createElement("img"); ';
      html += '          img.src = i.photo_url; left.appendChild(img); } ';
      html += '        else { ';
      html += '          var ph = document.createElement("div"); ';
      html += '          ph.className = "ph"; ph.innerHTML = svgPhRow; ';
      html += '          left.appendChild(ph); }';
      
      html += '        var nmWrap = document.createElement("div");';
      html += '        var nm = document.createElement("div"); ';
      html += '        nm.className = "name"; nm.textContent = i.name; ';
      html += '        nmWrap.appendChild(nm);';
      
      html += '        if (!hasPrice && !isArchived) { ';
      html += '          var pw = document.createElement("div"); ';
      html += '          pw.className = "price-warn"; ';
      html += '          pw.textContent = "Нет цены"; nmWrap.appendChild(pw); }';
      
      html += '        if (isArchived) {';
      html += '          var ab = document.createElement("div");';
      html += '          ab.className = "archived-badge"; ';
      html += '          ab.textContent = "Архив"; nmWrap.appendChild(ab); }';
      
      html += '        if (i.is_pinned) { ';
      html += '          var pin = document.createElement("span"); ';
      html += '          pin.className = "pin-icon"; ';
      html += '          pin.textContent = "★"; nmWrap.appendChild(pin); }';
      html += '        left.appendChild(nmWrap); a.appendChild(left);';
      
      html += '        var right = document.createElement("div");';
      html += '        right.style = "text-align:right;";';
      
      html += '        var st = document.createElement("div"); ';
      html += '        st.className = "stock " + cl; ';
      html += '        st.textContent = fmtNum(stock) + " " + unit; ';
      html += '        right.appendChild(st);';
      
      html += '        if (costStr) { ';
      html += '          var cDiv = document.createElement("div"); ';
      html += '          cDiv.className = "cost-info"; ';
      html += '          cDiv.textContent = costStr; ';
      html += '          right.appendChild(cDiv); }';
      
      html += '        a.appendChild(right);';
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
  // ====== 4. КАРТОЧКА ТОВАРА (ВЫПИСКА) ======
  app.get('/warehouse/item', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.history-card { background: #fff; border-radius: var(--r-md); ';
      html += 'padding: 16px; margin-bottom: 10px; display: flex; ';
      html += 'justify-content: space-between; align-items: center; ';
      html += 'box-shadow: var(--sh-1); text-decoration: none; ';
      html += 'color: var(--f-text); border-left: 4px solid transparent; }';
      html += '.history-card.sale { border-left-color: #3C7A89; }';
      html += '.history-card.receipt { border-left-color: var(--f-success); }';
      html += '.history-card.writeoff { border-left-color: var(--f-danger); }';
      
      html += '.h-left { display: flex; flex-direction: column; gap: 4px; }';
      html += '.h-title { font-weight: 700; font-size: 15px; display: flex; ';
      html += 'align-items: center; gap: 6px; }';
      html += '.h-meta { font-size: 12px; color: var(--f-text-2); }';
      html += '.h-badge { font-size: 11px; padding: 2px 8px; ';
      html += 'border-radius: 10px; font-weight: 700; display: inline-block; }';
      html += '.badge-sale { background: #E3F2FD; color: #3C7A89; }';
      html += '.badge-receipt { background: #E8F5E9; color: var(--f-success); }';
      html += '.badge-writeoff { background: #FFEBEE; color: var(--f-danger); }';
      
      html += '.h-right { text-align: right; display: flex; ';
      html += 'flex-direction: column; align-items: flex-end; gap: 4px; }';
      html += '.h-amount { font-weight: 800; font-size: 16px; }';
      html += '.h-stock { font-size: 11px; color: #aaa; font-weight: 600; }';
      
      html += '.actions { display: grid; grid-template-columns: 1fr 1fr; ';
      html += 'gap: 8px; margin-top: 16px; margin-bottom: 24px; }';
      html += '.btn-act { padding: 12px; border-radius: var(--r-md); ';
      html += 'border: 1px solid var(--f-border); font-weight: 600; ';
      html += 'color: var(--f-text); font-size: 14px; background: #fff;';
      html += 'font-family: inherit; display: flex; align-items: center; ';
      html += 'justify-content: center; gap: 6px; box-shadow: var(--sh-1); }';
      html += '.btn-act svg { width: 18px; height: 18px; }';
      html += '.btn-act.primary { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); }';
      html += '.btn-act.danger { color: var(--f-danger); }';
      html += '.btn-act.full { grid-column: 1 / -1; }';
      
      html += '.controls { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 16px; }';
      html += '.limit-select { padding: 8px 12px; border-radius: 10px; ';
      html += 'border: 1px solid var(--f-border); font-family: inherit; ';
      html += 'font-weight: 600; color: var(--f-text); background: #fff; ';
      html += 'box-shadow: var(--sh-1); width: 80px; text-align: center; ';
      html += 'margin: 0; }';
      html += '.pag-btn { background: #fff; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'padding: 8px 12px; border-radius: 10px; font-weight: 600; ';
      html += 'color: var(--f-text); box-shadow: var(--sh-1); }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse/inventory" class="back-btn">←</a>';
      html += '<h2 class="page-title">Выписка</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<input type="file" id="photoInput" accept="image/*" ';
      html += 'style="display:none;" onchange="uploadPhoto()">';
      
      html += '<div id="header-info" style="text-align:center; ';
      html += 'margin-bottom:20px;"></div>';

      html += '<div class="actions" id="actions" style="display:none;">';
      html += '<button class="btn-act primary" id="btnSetPrice" ';
      html += 'style="display:none;" onclick="setRetailPrice()">';
      html += 'Задать цену</button>';
      html += '<button class="btn-act" id="btnPin" ';
      html += 'onclick="togglePin()">Закрепить</button>';
      html += '<button class="btn-act" onclick="renameItem()">';
      html += 'Переименовать</button>';
      html += '<button class="btn-act" onclick="clickPhoto()">';
      html += 'Загрузить фото</button>';
      html += '<button class="btn-act danger full" ';
      html += 'onclick="deleteItem()">Удалить товар</button>';
      html += '</div>';

      html += '<div class="controls" id="historyControls" ';
      html += 'style="display:none;">';
      html += '<h3 style="margin:0; font-size:16px;">История операций</h3>';
      html += '<select class="limit-select" id="limitSelect" ';
      html += 'onchange="changeLimit(this.value)">';
      html += '<option value="10">10</option>';
      html += '<option value="30">30</option>';
      html += '<option value="50">50</option>';
      html += '<option value="100">100</option>';
      html += '</select>';
      html += '</div>';

      html += '<div style="display:flex; justify-content:center; ';
      html += 'gap:10px; align-items:center; margin-bottom:16px;">';
      html += '<button class="pag-btn" id="btnPrev" onclick="prevPage()" ';
      html += 'style="opacity:0.3;">←</button>';
      html += '<span id="pageInfo" style="font-weight:800; font-size:14px;">';
      html += '1 / 1</span>';
      html += '<button class="pag-btn" id="btnNext" onclick="nextPage()" ';
      html += 'style="opacity:0.3;">→</button>';
      html += '</div>';

      html += '<div id="list">Загрузка...</div>';
      
      html += getUnifiedMenu('inventory');

      html += '<script>';
      html += 'var itemId = parseInt(new URLSearchParams(';
      html += 'window.location.search).get("id")) || 0;';
      html += 'var itemName = ""; var itemUnit = "шт"; var isPinned = false;';
      html += 'var itemPrice = 0; var totalHistory = 0; var currentPage = 1;';
      html += 'var pageLimit = parseInt(localStorage.getItem(';
      html += '"wh_item_limit")) || 10;';
      html += 'document.getElementById("limitSelect").value = pageLimit;';

      html += 'function clickPhoto() {';
      html += '  document.getElementById("photoInput").click();';
      html += '}';

      html += 'function changeLimit(v) {';
      html += '  pageLimit = parseInt(v); ';
      html += 'localStorage.setItem("wh_item_limit", v);';
      html += '  currentPage = 1; loadHistory();';
      html += '}';

      html += 'function prevPage() { ';
      html += '  if (currentPage > 1) { currentPage--; loadHistory(); } }';
      html += 'function nextPage() { ';
      html += '  var maxP = Math.ceil(totalHistory / pageLimit) || 1; ';
      html += '  if (currentPage < maxP) { currentPage++; loadHistory(); } }';

      html += 'function loadHistory() {';
      html += '  var list = document.getElementById("list");';
      html += '  if (currentPage === 1) list.textContent = "Загрузка...";';
      html += '  var offset = (currentPage - 1) * pageLimit;';
      html += '  fetch("/api/warehouse/item/history?id=" + itemId + ';
      html += '  "&limit=" + pageLimit + "&offset=" + offset)';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { ';
      html += '      list.textContent = "Ошибка: " + (d.error || "unknown"); ';
      html += '      return; ';
      html += '    }';
      html += '    totalHistory = d.total || 0;';
      
      html += '    if (currentPage === 1) {';
      html += '      var hi = document.getElementById("header-info");';
      html += '      while (hi.firstChild) hi.removeChild(hi.firstChild);';
      html += '      itemName = d.item.name; itemUnit = d.item.unit || "шт";';
      html += '      isPinned = d.item.is_pinned === true;';
      html += '      itemPrice = parseFloat(d.item.retail_price) || 0;';
      html += '      document.getElementById("actions")';
      html += '      .style.display = "grid";';
      html += '      document.getElementById("historyControls")';
      html += '      .style.display = "flex";';
      html += '      updatePinBtn();';
      html += '      if (itemPrice === 0) { ';
      html += '        var bsp = document.getElementById("btnSetPrice");';
      html += '        bsp.style.display = "flex"; ';
      html += '        bsp.innerText = "Задать цену"; }';
      html += '      else { ';
      html += '        var bsp2 = document.getElementById("btnSetPrice");';
      html += '        bsp2.style.display = "flex"; ';
      html += '        bsp2.innerText = "Изменить цену"; }';
      
      html += '      var isPos = parseFloat(d.item.current_stock) > 0;';
      html += '      var cl = isPos ? "var(--f-success)" : "var(--f-danger)";';
      html += '      var h2 = document.createElement("h2");';
      html += '      h2.style.margin = "0"; h2.style.fontSize = "24px";';
      html += '      h2.style.fontWeight = "800";';
      html += '      h2.textContent = itemName; hi.appendChild(h2);';
      html += '      var stockDiv = document.createElement("div");';
      html += '      stockDiv.style.fontSize = "20px";';
      html += '      stockDiv.style.fontWeight = "800";';
      html += '      stockDiv.style.color = cl;';
      html += '      stockDiv.style.marginTop = "8px";';
      html += '      stockDiv.textContent = "Остаток: " + ';
      html += '      fmtNum(d.item.current_stock) + " " + itemUnit;';
      html += '      hi.appendChild(stockDiv);';
      html += '      if (itemPrice > 0) {';
      html += '        var prDiv = document.createElement("div");';
      html += '        prDiv.style.fontSize = "16px";';
      html += '        prDiv.style.fontWeight = "600";';
      html += '        prDiv.style.color = "var(--f-brand)";';
      html += '        prDiv.style.marginTop = "4px";';
      html += '        prDiv.textContent = "Цена: " + ';
      html += '        itemPrice.toLocaleString("ru-RU") + " ₽";';
      html += '        hi.appendChild(prDiv);';
      html += '      }';
      html += '    }';
      
      html += '    var maxP = Math.ceil(totalHistory / pageLimit) || 1;';
      html += '    document.getElementById("pageInfo").textContent = ';
      html += '    currentPage + " / " + maxP;';
      html += '    document.getElementById("btnPrev").style.opacity = ';
      html += '    currentPage === 1 ? "0.3" : "1";';
      html += '    document.getElementById("btnNext").style.opacity = ';
      html += '    currentPage === maxP ? "0.3" : "1";';

      html += '    while (list.firstChild) list.removeChild(list.firstChild);';
      html += '    var histList = d.history || [];';
      html += '    if (histList.length === 0) {';
      html += '      list.textContent = "Нет операций"; return; }';

      html += '    histList.forEach(function(h) {';
      html += '      var a = document.createElement("a");';
      html += '      var hDate = h.date ? new Date(h.date) : new Date();';
      html += '      if (isNaN(hDate.getTime())) hDate = new Date();';
      html += '      var ds = hDate.toLocaleString("ru-RU", { ';
      html += '      day: "2-digit", month: "2-digit", hour: "2-digit", ';
      html += '      minute: "2-digit" });';
      
      html += '      var left = document.createElement("div");';
      html += '      left.className = "h-left";';
      html += '      var title = document.createElement("div");';
      html += '      title.className = "h-title";';
      html += '      var meta = document.createElement("div");';
      html += '      meta.className = "h-meta";';
      html += '      meta.textContent = ds + " · " + (h.person || "Система");';
      
      html += '      var right = document.createElement("div");';
      html += '      right.className = "h-right";';
      html += '      var amt = document.createElement("div");';
      html += '      amt.className = "h-amount";';
      html += '      var stockFlow = document.createElement("div");';
      html += '      stockFlow.className = "h-stock";';
      html += '      stockFlow.textContent = fmtNum(h.stock_before) + ';
      html += '      " → " + fmtNum(h.stock_after);';

      html += '      if (h.type === "sale") {';
      html += '        a.className = "history-card sale";';
      html += '        a.href = "/warehouse/sale/details?id=" + h.id;';
      html += '        var bdg = document.createElement("span");';
      html += '        bdg.className = "h-badge badge-sale";';
      html += '        bdg.innerText = "Продажа";';
      html += '        title.appendChild(bdg);';
      html += '        var tId = document.createTextNode(" №" + h.id);';
      html += '        title.appendChild(tId);';
      html += '        amt.textContent = "-" + fmtNum(h.qty) + " " + itemUnit;';
      html += '        amt.style.color = "#3C7A89";';
      html += '      } else if (h.type === "writeoff") {';
      html += '        a.className = "history-card writeoff";';
      html += '        a.href = "/warehouse/documents/details?id=" + h.id + ';
      html += '        "&type=writeoffs";';
      html += '        var bdg2 = document.createElement("span");';
      html += '        bdg2.className = "h-badge badge-writeoff";';
      html += '        bdg2.innerText = "Списание";';
      html += '        title.appendChild(bdg2);';
      html += '        var tId2 = document.createTextNode(" №" + h.id);';
      html += '        title.appendChild(tId2);';
      html += '        meta.textContent += " · " + translateReason(h.reason);';
      html += '        amt.textContent = "-" + fmtNum(h.qty) + " " + itemUnit;';
      html += '        amt.style.color = "var(--f-danger)";';
      html += '      } else {';
      html += '        a.className = "history-card receipt";';
      html += '        a.href = "/warehouse/documents/details?id=" + h.id + ';
      html += '        "&type=receipts";';
      html += '        var bdg3 = document.createElement("span");';
      html += '        bdg3.className = "h-badge badge-receipt";';
      html += '        bdg3.innerText = "Приход";';
      html += '        title.appendChild(bdg3);';
      html += '        var tId3 = document.createTextNode(" №" + h.id);';
      html += '        title.appendChild(tId3);';
      html += '        amt.textContent = "+" + fmtNum(h.qty) + " " + itemUnit;';
      html += '        amt.style.color = "var(--f-success)";';
      html += '      }';

      html += '      left.appendChild(title); left.appendChild(meta);';
      html += '      right.appendChild(amt); right.appendChild(stockFlow);';
      html += '      a.appendChild(left); a.appendChild(right);';
      html += '      list.appendChild(a);';
      html += '    });';
      html += '  }).catch(function(err) {';
      html += '    document.getElementById("list").textContent = ';
      html += '    "Ошибка сети: " + err.message;';
      html += '  });';
      html += '}';

      html += 'loadHistory();';
      
      html += 'function deleteItem() {';
      html += '  showConfirm("Удаление", "Вы уверены, что хотите удалить " + ';
      html += '  itemName + "? Если есть история, он будет скрыт.", ';
      html += '  function() {';
      html += '    fetch("/api/warehouse/item/delete", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ id: itemId }) })';
      html += '    .then(function(r) { return r.json(); })';
      html += '    .then(function(d) { if (d.ok) { ';
      html += '      showAlert("Готово", "Товар удален", true); ';
      html += '      setTimeout(function() { window.location.href = ';
      html += '      "/warehouse/inventory"; }, 1000); ';
      html += '    } else showAlert("Ошибка", d.error, false); })';
      html += '    .catch(function(){});';
      html += '  }, true);';
      html += '}';

      html += 'function setRetailPrice() {';
      html += '  var def = itemPrice > 0 ? itemPrice : "";';
      html += '  showPrompt("Розничная цена", "Введите цену (₽)", def, ';
      html += '  function(p) {';
      html += '    if (!p) return;';
      html += '    var num = parseFloat(String(p).replace(",", "."));';
      html += '    if (isNaN(num) || num <= 0) { ';
      html += '      showAlert("Ошибка", "Неверная цена", false); return; }';
      html += '    fetch("/api/warehouse/item/set-price", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ id: itemId, price: num }) })';
      html += '    .then(function(r) { return r.json(); })';
      html += '    .then(function(d) { ';
      html += '      if (d.ok) { showAlert("Готово", ';
      html += '      "Цена установлена", true); ';
      html += '      setTimeout(function() { location.reload(); }, 1000); } ';
      html += '      else showAlert("Ошибка", d.error, false); })';
      html += '    .catch(function() {});';
      html += '  });';
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
      html += '  if (isPinned) { b.style.background = "#FFF3E0"; ';
      html += '    b.style.color = "#E67E22"; b.style.borderColor = "#E67E22";';
      html += '    b.innerText = "Открепить"; }';
      html += '  else { b.style.background = "#fff"; ';
      html += '    b.style.color = "var(--f-text)"; ';
      html += '    b.style.borderColor = "var(--f-border)";';
      html += '    b.innerText = "Закрепить"; }';
      html += '}';

      html += 'function renameItem() {';
      html += '  showPrompt("Новое название", "Введите имя", itemName, ';
      html += '  function(newName) {';
      html += '    if (!newName || newName === itemName) return;';
      html += '    fetch("/api/warehouse/item/rename", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ id: itemId, name: newName }) })';
      html += '    .then(function(r) { return r.json(); })';
      html += '    .then(function(d) { if (d.ok) { ';
      html += '      showAlert("Готово", "Переименовано", true); ';
      html += '      setTimeout(function() { location.reload(); }, 1000); ';
      html += '    } else showAlert("Ошибка", d.error, false); })';
      html += '    .catch(function() {});';
      html += '  });';
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
      html += '  "Проверьте интернет", false); });';
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
    } catch(e) {
      console.error('Item page error:', e.message);
      res.status(500).send('Ошибка сервера');
    }
  });
  // ====== 5. ЭКРАН ПРОДАЖИ (КАССА) ======
  app.get('/warehouse/sale', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const shopId = auth.shopId;
      const chatId = auth.chatId;

      const shiftRes = await pool.query(
        'SELECT id FROM wh_shifts WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND status = \'open\' LIMIT 1',
        [shopId, chatId]
      );

      if (shiftRes.rows.length === 0) {
        let errHtml = '<!DOCTYPE html><html><head>';
        errHtml += '<meta charset="UTF-8">';
        errHtml += metaSafari;
        errHtml += '<meta name="viewport" content="width=device-width, ';
        errHtml += 'initial-scale=1.0, maximum-scale=1.0, ';
        errHtml += 'user-scalable=no">';
        errHtml += fontLink;
        errHtml += uiScript;
        errHtml += '<style>';
        errHtml += 'body { display: flex; flex-direction: column; ';
        errHtml += 'align-items: center; justify-content: center; ';
        errHtml += 'height: 100vh; padding: 20px; text-align: center; }';
        errHtml += '.card { max-width: 340px; width: 100%; ';
        errHtml += 'padding: 40px 24px; }';
        errHtml += '</style></head><body>';
        errHtml += '<div class="card">';
        errHtml += '<h1 style="font-size:48px; margin:0 0 16px 0;">⏱</h1>';
        errHtml += '<h2 style="margin:0 0 8px 0; font-size:20px;">';
        errHtml += 'Смена не открыта</h2>';
        errHtml += '<p class="text-muted" style="margin-bottom:24px;">';
        errHtml += 'Для оформления продаж сначала откройте смену.</p>';
        errHtml += '<a href="/warehouse/shift" class="btn btn-primary">';
        errHtml += 'Открыть смену</a>';
        errHtml += '</div></body></html>';
        return res.send(errHtml);
      }

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 80px 16px; }';
      
      html += '.search-wrapper { position: relative; margin-bottom: 16px; }';
      html += '.search { width: 100%; padding: 14px 16px; border: none; ';
      html += 'border-radius: var(--r-md); box-sizing: border-box; ';
      html += 'font-family: inherit; font-size: 16px; ';
      html += 'box-shadow: var(--sh-1); }';
      html += '.clear-search { position: absolute; right: 14px; ';
      html += 'top: 50%; transform: translateY(-50%); font-size: 18px; ';
      html += 'color: #aaa; cursor: pointer; display: none; ';
      html += 'background: none; border: none; padding: 0; }';
      
      html += '.h-scroll { display: flex; overflow-x: auto; gap: 8px; ';
      html += 'margin-bottom: 16px; padding-bottom: 4px; }';
      html += '.h-scroll::-webkit-scrollbar { display: none; }';
      html += '.cat-btn { padding: 8px 16px; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: 20px; background: #fff; cursor: pointer; ';
      html += 'font-size: 14px; white-space: nowrap; font-family: inherit; ';
      html += 'color: var(--f-text); font-weight: 600; }';
      html += '.cat-btn.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); }';
      html += '.cat-btn.bouquets-btn { background: #FFF3E0; ';
      html += 'color: var(--f-accent); font-weight: 700; border: none; }';
      html += '.cat-btn.bouquets-btn.active { background: var(--f-accent); ';
      html += 'color: #fff; }';
      
      html += '.grid-controls { display: flex; gap: 6px; ';
      html += 'margin-bottom: 12px; justify-content: flex-end; }';
      html += '.grid-btn { background: #fff; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: 6px; padding: 4px 8px; font-size: 12px; ';
      html += 'font-weight: 600; color: var(--f-text-2); cursor: pointer; }';
      html += '.grid-btn.active { background: var(--f-brand); ';
      html += 'color: #fff; border-color: var(--f-brand); }';

      html += '.grid { display: grid; gap: 8px; width: 100%; }';
      html += '.grid-3 { grid-template-columns: repeat(3, 1fr); }';
      html += '.grid-4 { grid-template-columns: repeat(4, 1fr); }';
      html += '.grid-5 { grid-template-columns: repeat(5, 1fr); }';
      html += '.grid-6 { grid-template-columns: repeat(6, 1fr); }';

      html += '.card { background: #fff; padding: 8px; border-radius: 12px; ';
      html += 'text-align: center; cursor: pointer; position: relative; ';
      html += 'box-shadow: var(--sh-1); ';
      html += 'display: flex; flex-direction: column; }';
      html += '.card img { width: 100%; aspect-ratio: 1; object-fit: cover; ';
      html += 'border-radius: 8px; margin-bottom: 6px; }';
      html += '.card .ph { width: 100%; aspect-ratio: 1; ';
      html += 'border-radius: 8px; background: #F0F4F4; ';
      html += 'display: flex; align-items: center; ';
      html += 'justify-content: center; margin-bottom: 6px; }';
      html += '.card .name { font-size: 12px; font-weight: 600; ';
      html += 'margin-bottom: 4px; line-height: 1.2; word-break: break-word; ';
      html += 'display: -webkit-box; -webkit-line-clamp: 2; ';
      html += '-webkit-box-orient: vertical; overflow: hidden; }';
      html += '.card .stock { font-size: 11px; font-weight: 800; ';
      html += 'margin-top: auto; }';
      html += '.card .stock.green { color: var(--f-success); }';
      html += '.card .stock.red { color: var(--f-danger); }';
      html += '.card.bouquet { background: #FFF8F3; ';
      html += 'border: 1px solid var(--f-accent); }';
      html += '.card .bouquet-tag { font-size: 10px; ';
      html += 'color: var(--f-accent); font-weight: 800; margin-top: auto; }';
      html += '.card.pinned { border: 2px solid var(--f-accent); }';
      html += '.pin-badge { position: absolute; top: 4px; right: 4px; ';
      html += 'background: var(--f-accent); color: #fff; font-size: 10px; ';
      html += 'width: 20px; height: 20px; border-radius: 50%; ';
      html += 'display: flex; align-items: center; justify-content: center; }';

      html += '.floating-cart { position: fixed; bottom: 20px; left: 16px; ';
      html += 'right: 16px; background: var(--f-brand); color: #fff; ';
      html += 'padding: 16px 20px; border-radius: 16px; display: none; ';
      html += 'justify-content: space-between; align-items: center; ';
      html += 'box-shadow: var(--sh-3); z-index: 900; cursor: pointer; ';
      html += 'font-weight: 800; font-size: 16px; transition: 0.3s; }';
      html += '.floating-cart.show { display: flex; }';

      html += '.sheet-overlay { position: fixed; top: 0; left: 0; ';
      html += 'width: 100%; height: 100%; background: rgba(0,0,0,0.5); ';
      html += 'display: none; z-index: 2000; backdrop-filter: blur(2px); }';
      html += '.sheet-overlay.open { display: block; }';
      
      html += '.bottom-sheet { position: fixed; bottom: -100%; left: 0; ';
      html += 'width: 100%; height: 90vh; background: var(--f-bg); ';
      html += 'border-radius: 24px 24px 0 0; transition: bottom 0.3s ease; ';
      html += 'z-index: 2001; display: flex; flex-direction: column; }';
      html += '.bottom-sheet.open { bottom: 0; }';
      html += '.sheet-header { padding: 12px 16px; display: flex; ';
      html += 'justify-content: space-between; align-items: center; }';
      html += '.sheet-handle { width: 40px; height: 5px; background: #ccc; ';
      html += 'border-radius: 5px; margin: 0 auto; }';
      html += '.close-sheet { background: none; border: none; ';
      html += 'font-size: 24px; color: #888; cursor: pointer; ';
      html += 'padding: 0; line-height: 1; }';
      
      html += '.sheet-body { display: flex; flex-direction: row; flex: 1; ';
      html += 'overflow: hidden; }';
      html += '.sheet-content { flex: 1.2; padding: 0 16px; ';
      html += 'overflow-y: auto; border-right: 1px solid var(--f-border); }';
      html += '.calc-panel { flex: 1; padding: 16px; overflow-y: auto; ';
      html += 'background: var(--f-surface); min-width: 180px; }';

      html += '.b-row { display: grid; grid-template-columns: 1fr 110px 24px; ';
      html += 'gap: 8px; align-items: center; margin-bottom: 8px; ';
      html += 'font-size: 13px; background: #fff; padding: 10px; ';
      html += 'border-radius: 12px; box-shadow: var(--sh-1); }';
      html += '.qty-btn { background: #F0F4F4; border: none; width: 28px; ';
      html += 'height: 28px; border-radius: 8px; font-weight: bold; ';
      html += 'font-size: 14px; color: var(--f-text); display: flex; ';
      html += 'align-items: center; justify-content: center; }';

      html += '.pay-input-row { display: flex; gap: 6px; margin-top: 12px; }';
      html += '.pay-input-row input { font-size: 18px; font-weight: 800; ';
      html += 'text-align: right; flex: 1; padding: 12px; margin: 0; ';
      html += 'border: 1px solid var(--f-border); border-radius: 10px; }';
      html += '.pay-input-row button { background: var(--f-brand); ';
      html += 'color: #fff; border: none; border-radius: 10px; ';
      html += 'padding: 0 16px; font-size: 14px; font-weight: bold; }';

      html += '.numpad { display: grid; grid-template-columns: 1fr 1fr 1fr; ';
      html += 'gap: 6px; margin-top: 12px; }';
      html += '.numpad button { padding: 12px; font-size: 18px; border: none; ';
      html += 'background: #fff; border-radius: 10px; font-family: inherit; ';
      html += 'font-weight: 600; color: var(--f-text); ';
      html += 'box-shadow: var(--sh-1); }';
      html += '.numpad button:active { background: #eee; }';

      html += '.btn-submit { width: 100%; padding: 16px; font-size: 16px; ';
      html += 'font-weight: 800; color: #fff; background: #ccc; border: none; ';
      html += 'border-radius: 12px; margin-top: 16px; }';
      html += '.btn-submit.ready { background: var(--f-success); }';
      
      html += '.total-inp { font-size: 20px; font-weight: 800; width: 100%; ';
      html += 'border: 1px solid var(--f-border); background: #fff; ';
      html += 'padding: 12px; border-radius: 10px; box-sizing: border-box; ';
      html += 'text-align: right; }';
      
      html += '.pay-btn { padding: 10px 4px; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: 10px; background: #fff; cursor: pointer; ';
      html += 'flex: 1; display: flex; align-items: center; ';
      html += 'justify-content: center; gap: 4px; font-weight: 600; ';
      html += 'font-size: 13px; transition: 0.2s; color: var(--f-text-2); }';
      html += '.pay-btn.active { background: #E0F2F1; ';
      html += 'border-color: var(--f-brand); color: var(--f-brand); ';
      html += 'font-weight: 800; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Касса</h2>';
      html += '</div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<div class="search-wrapper">';
      html += '<input type="text" class="search" id="search" ';
      html += 'placeholder="Поиск..." oninput="onSearchInput()" ';
      html += 'autocomplete="off">';
      html += '<button class="clear-search" id="clearSearch" ';
      html += 'onclick="clearSearchText()">✕</button>';
      html += '</div>';

      html += '<div class="grid-controls">';
      html += '<button class="grid-btn" id="btn-grid-3" ';
      html += 'onclick="setGridCols(3)">3</button>';
      html += '<button class="grid-btn active" id="btn-grid-4" ';
      html += 'onclick="setGridCols(4)">4</button>';
      html += '<button class="grid-btn" id="btn-grid-5" ';
      html += 'onclick="setGridCols(5)">5</button>';
      html += '<button class="grid-btn" id="btn-grid-6" ';
      html += 'onclick="setGridCols(6)">6</button>';
      html += '</div>';

      html += '<div class="h-scroll" id="catList">';
      html += '<button class="cat-btn active" id="cat-0" ';
      html += 'onclick="setCat(0)">Все</button>';
      html += '<button class="cat-btn bouquets-btn" id="cat-bouquets" ';
      html += 'onclick="toggleBouquetsMode()">Букеты</button>';
      html += '</div>';

      html += '<div class="grid grid-4" id="itemsGrid"></div>';

      html += '<div class="floating-cart" id="floatingCart">';
      html += '<span id="fcCount">0 товаров</span>';
      html += '<span id="fcTotal">0 ₽</span>';
      html += '</div>';

      html += '<div class="sheet-overlay" id="sheetOverlay" ';
      html += 'onclick="closeSheet()"></div>';
      html += '<div class="bottom-sheet" id="bottomSheet">';
      html += '<div class="sheet-header">';
      html += '<div class="sheet-handle"></div>';
      html += '<button class="close-sheet" onclick="closeSheet()">✕</button>';
      html += '</div>';

      html += '<div class="sheet-body">';
      html += '<div class="sheet-content">';
      html += '<div id="bList" class="swipeable-cart"></div>';
      html += '</div>';

      html += '<div class="calc-panel">';
      html += '<div style="margin-bottom:12px;">';
      html += '<label style="font-size:12px; font-weight:700; ';
      html += 'color:var(--f-text-2);">Сумма чека</label>';
      html += '<input type="text" id="totalPrice" class="total-inp" ';
      html += 'value="0" inputmode="none" readonly ';
      html += 'onclick="setActiveInput(&apos;totalPrice&apos;)">';
      html += '</div>';

      html += '<div style="display:flex; gap:6px; margin-bottom:12px;">';
      html += '<div class="pay-btn" id="btn-cash" ';
      html += 'onclick="setPay(&apos;cash&apos;)">';
      html += getIconSvg('cash') + 'Нал</div>';
      html += '<div class="pay-btn" id="btn-card" ';
      html += 'onclick="setPay(&apos;card&apos;)">';
      html += getIconSvg('card') + 'Карта</div>';
      html += '<div class="pay-btn" id="btn-qr" ';
      html += 'onclick="setPay(&apos;qr&apos;)">';
      html += getIconSvg('qr') + 'QR</div>';
      html += '</div>';

      html += '<div class="pay-input-row">';
      html += '<input type="text" id="payAmount" placeholder="Сумма" ';
      html += 'inputmode="none" readonly ';
      html += 'onclick="setActiveInput(&apos;payAmount&apos;)">';
      html += '<button onclick="addPayment()">Внести</button>';
      html += '</div>';

      html += '<div class="numpad">';
      html += '<button onclick="num(&apos;1&apos;)">1</button>';
      html += '<button onclick="num(&apos;2&apos;)">2</button>';
      html += '<button onclick="num(&apos;3&apos;)">3</button>';
      html += '<button onclick="num(&apos;4&apos;)">4</button>';
      html += '<button onclick="num(&apos;5&apos;)">5</button>';
      html += '<button onclick="num(&apos;6&apos;)">6</button>';
      html += '<button onclick="num(&apos;7&apos;)">7</button>';
      html += '<button onclick="num(&apos;8&apos;)">8</button>';
      html += '<button onclick="num(&apos;9&apos;)">9</button>';
      html += '<button onclick="num(&apos;C&apos;)" ';
      html += 'style="color:red;">C</button>';
      html += '<button onclick="num(&apos;0&apos;)">0</button>';
      html += '<button onclick="num(&apos;X&apos;)">⌫</button>';
      html += '</div>';

      html += '<div class="pay-list" id="payList" style="font-size:13px; ';
      html += 'margin-top:12px;"></div>';
      html += '<div style="text-align:center; margin-top:12px; ';
      html += 'font-size:14px; font-weight:800;" id="remainTxt"></div>';

      html += '<button class="btn-submit" id="btnSubmit" ';
      html += 'onclick="openPrecheck()">Принять</button>';
      html += '</div></div></div>';

      html += '<div class="sheet-overlay" id="precheckModal" ';
      html += 'style="z-index:3000; align-items:center; ';
      html += 'justify-content:center;">';
      html += '<div style="background:#fff; padding:24px; ';
      html += 'border-radius:24px; width:90%; max-width:400px; ';
      html += 'max-height:80vh; display:flex; flex-direction:column; ';
      html += 'box-shadow:var(--sh-3);">';
      html += '<h2 style="margin:0 0 16px 0; text-align:center; ';
      html += 'font-size:20px; font-weight:800;">Проверьте чек</h2>';
      html += '<div id="precheckList" style="overflow-y:auto; flex:1; ';
      html += 'margin-bottom:16px; border-top:1px solid #eee; ';
      html += 'border-bottom:1px solid #eee; padding:12px 0;"></div>';
      
      html += '<div id="precheckChangeBlock" style="display:none; ';
      html += 'margin-bottom:16px; text-align:center;">';
      html += '<div style="font-size:14px; color:#888; margin-bottom:4px;">';
      html += 'Сдача:</div>';
      html += '<div style="font-size:24px; font-weight:800; ';
      html += 'color:var(--f-brand);" id="precheckChangeAmt">0 ₽</div>';
      html += '<div style="font-size:12px; color:#888; margin-top:10px; ';
      html += 'margin-bottom:6px;">Куда выдать?</div>';
      html += '<div style="display:flex; gap:6px;">';
      html += '<div class="pay-btn active" id="pcm-cash" ';
      html += 'onclick="setPrecheckChangeMethod(&apos;cash&apos;)">Нал</div>';
      html += '<div class="pay-btn" id="pcm-card" ';
      html += 'onclick="setPrecheckChangeMethod(&apos;card&apos;)">';
      html += 'Карта</div>';
      html += '<div class="pay-btn" id="pcm-qr" ';
      html += 'onclick="setPrecheckChangeMethod(&apos;qr&apos;)">QR</div>';
      html += '</div></div>';
      
      html += '<div style="display:flex; justify-content:space-between; ';
      html += 'font-weight:800; font-size:18px; margin-bottom:16px;">';
      html += '<span>Итого:</span><span id="precheckTotal">0 ₽</span></div>';
      html += '<div style="display:flex; gap:12px;">';
      html += '<button onclick="closePrecheck()" style="flex:1; ';
      html += 'padding:14px; border:none; border-radius:12px; ';
      html += 'font-weight:800; font-size:16px; background:#F0F4F4; ';
      html += 'color:var(--f-text);">Вернуться</button>';
      html += '<button onclick="saveSale()" style="flex:2; padding:14px; ';
      html += 'border:none; border-radius:12px; font-weight:800; ';
      html += 'font-size:16px; background:var(--f-success); color:#fff;">';
      html += 'Подтвердить</button>';
      html += '</div></div></div>';

      html += '<div class="sheet-overlay" id="successModal" ';
      html += 'style="z-index:3000; align-items:center; ';
      html += 'justify-content:center;">';
      html += '<div style="background:#fff; padding:32px 24px; ';
      html += 'border-radius:24px; width:85%; max-width:340px; ';
      html += 'text-align:center; box-shadow:var(--sh-3);">';
      html += '<div style="width:64px; height:64px; background:#E8F5E9; ';
      html += 'color:var(--f-success); border-radius:50%; ';
      html += 'margin:0 auto 16px; display:flex; align-items:center; ';
      html += 'justify-content:center;">';
      html += '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" ';
      html += 'stroke="currentColor" stroke-width="3" stroke-linecap="round" ';
      html += 'stroke-linejoin="round"><polyline points="20 6 9 17 4 12">';
      html += '</polyline></svg></div>';
      html += '<h1 style="color:var(--f-text); font-size:24px; ';
      html += 'margin:0 0 8px 0;">Готово!</h1>';
      html += '<div style="font-size:16px; margin-bottom:16px; ';
      html += 'color:var(--f-text-2);">Продажа оформлена</div>';
      html += '<div id="changeBlock" style="display:none;">';
      html += '<div style="font-size:14px; color:#888; margin-top:16px;">';
      html += 'СДАЧА:</div>';
      html += '<div style="font-size:36px; font-weight:800; ';
      html += 'color:var(--f-brand);" id="changeAmount">0</div></div>';
      html += '<button onclick="closeSuccess()" style="width:100%; ';
      html += 'padding:14px; border:none; border-radius:12px; ';
      html += 'font-size:16px; font-weight:800; color:#fff; ';
      html += 'background:var(--f-success); margin-top:20px;">';
      html += 'Готово</button></div></div>';

      html += '<script>';
      html += 'var allItems = []; var currentCat = 0; ';
      html += 'var bouquetsMode = false; var bouquetsList = [];';
      html += 'var cart = []; var payMethod = ""; var payments = []; ';
      html += 'var precheckChangeMethod = "cash"; var gridCols = 4; ';
      html += 'var currentIdempotencyKey = null;';
      html += 'var activeInputId = "payAmount"; var isFirstInput = true; ';
      html += 'var isPayAmountEdited = false; ';
      html += 'var isTotalPriceEdited = false;';
      
      html += 'var svgPh = "<div style=width:40px;height:40px;';
      html += 'background:#D8E4E4;border-radius:50%;></div>";';

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

      html += 'fetch("/api/warehouse/items?t=" + Date.now())';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) { ';
      html += '  if (d.ok) { allItems = d.items; render(); } ';
      html += '  else { ';
      html += '    var g = document.getElementById("itemsGrid"); ';
      html += '    var ed = document.createElement("div"); ';
      html += '    ed.style.color = "red"; ';
      html += '    ed.style.textAlign = "center"; ';
      html += '    ed.style.padding = "20px"; ';
      html += '    ed.style.gridColumn = "1/-1"; ';
      html += '    ed.textContent = d.error || "Ошибка загрузки"; ';
      html += '    g.appendChild(ed); ';
      html += '  }';
      html += '}).catch(function(e) { ';
      html += '  var g = document.getElementById("itemsGrid"); ';
      html += '  var ed = document.createElement("div"); ';
      html += '  ed.style.color = "red"; ';
      html += '  ed.style.textAlign = "center"; ';
      html += '  ed.style.padding = "20px"; ';
      html += '  ed.style.gridColumn = "1/-1"; ';
      html += '  ed.textContent = "Сеть: " + e.message; ';
      html += '  g.appendChild(ed); ';
      html += '});';

      html += 'function onSearchInput() {';
      html += '  var val = document.getElementById("search").value;';
      html += '  var btn = document.getElementById("clearSearch");';
      html += '  if (val.length > 0) { btn.style.display = "block"; }';
      html += '  else { btn.style.display = "none"; }';
      html += '  filterItems();';
      html += '}';
      html += 'function clearSearchText() {';
      html += '  document.getElementById("search").value = "";';
      html += '  document.getElementById("clearSearch").style.display = ';
      html += '  "none";';
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
      html += '  fetch("/api/warehouse/bouquets")';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { ';
      html += '      while(g.firstChild) g.removeChild(g.firstChild);';
      html += '      var er = document.createElement("div"); ';
      html += '      er.style = "grid-column:1/-1; text-align:center; ';
      html += '      padding:20px; color:red;"; er.innerText = "Ошибка";';
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
      html += '    if (!ok) tag.style.color = "red";';
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
      html += '  document.getElementById("cat-" + id)';
      html += '  .classList.add("active");';
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
      html += '      pin.className = "pin-badge"; pin.innerText = "★";';
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
      html += '    var stockVal = parseFloat(item.current_stock) || 0;';
      html += '    st.className = "stock " + (stockVal > 0 ? "green" : "red");';
      html += '    st.textContent = "Ост: " + fmtNum(stockVal) ';
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
      html += '      showAlert("Готово", newVal ? "Закреплено" : ';
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

      html += 'function resetPayments() { ';
      html += 'payments = []; isPayAmountEdited = false; ';
      html += 'isTotalPriceEdited = false; currentIdempotencyKey = null; ';
      html += 'saveCart(); renderBasket(); }';

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
      html += '  if (payments.length > 0) return;';
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
      html += '  isTotalPriceEdited = false; currentIdempotencyKey = null;';
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

      html += 'function renderBasket() {';
      html += '  var b = document.getElementById("bList");';
      html += '  var fc = document.getElementById("floatingCart");';
      html += '  if (cart.length === 0) { ';
      html += '    fc.classList.remove("show"); ';
      html += '    while(b.firstChild) b.removeChild(b.firstChild); ';
      html += '    payments = []; isPayAmountEdited = false; ';
      html += '    isTotalPriceEdited = false;';
      html += '    document.getElementById("totalPrice").value = "0";';
      html += '    document.getElementById("payAmount").value = "";';
      html += '    renderPayments(); return; ';
      html += '  }';
      
      html += '  fc.classList.add("show"); ';
      html += '  while(b.firstChild) b.removeChild(b.firstChild); ';
      html += '  var total = 0; var count = 0;';
      html += '  cart.forEach(function(item, idx) {';
      html += '    var q = parseFloat(String(item.qty).replace(",", ".")) || 0;';
      html += '    var r = parseFloat(String(item.retail).replace(",", ".")) || 0;';
      html += '    total += (r * q); count += q;';
      html += '    var div = document.createElement("div"); ';
      html += '    div.className = "b-row";';
      html += '    var name = document.createElement("div"); ';
      html += '    name.textContent = item.name; name.style.fontWeight = "600";';
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
      html += '    vl.style = "width:40px; height:28px; text-align:center; ';
      html += '    border:none; background:#F0F4F4; border-radius:6px; ';
      html += '    font-weight:bold; padding:0; margin:0;";';
      html += '    vl.onclick = function() { setActiveInput(this.id); };';
      
      html += '    var pl = document.createElement("button"); ';
      html += '    pl.innerText = "+"; pl.className = "qty-btn";';
      html += '    pl.onclick = function() { changeQty(idx, 1); };';
      
      html += '    ctrl.appendChild(mn); ctrl.appendChild(vl); ';
      html += '    ctrl.appendChild(pl);';
      
      html += '    var del = document.createElement("span"); ';
      html += '    del.innerText = "✕";';
      html += '    del.style = "color:var(--f-danger); cursor:pointer; ';
      html += '    font-size:18px; text-align:center;";';
      
      html += '    del.onclick = function() { ';
      html += '      showConfirm("Удаление", "Убрать " + item.name + "?", ';
      html += '      function() { ';
      html += '        cart.splice(idx, 1); resetPayments(); ';
      html += '      }, true); ';
      html += '    };';
      
      html += '    div.appendChild(name); div.appendChild(ctrl); ';
      html += '    div.appendChild(del); b.appendChild(div);';
      html += '  });';
      
      html += '  if (!isTotalPriceEdited) { ';
      html += '    document.getElementById("totalPrice").value = total; ';
      html += '  }';
      
      html += '  var displayTotal = parseFloat(';
      html += '  document.getElementById("totalPrice").value) || 0;';
      html += '  if (!isPayAmountEdited && payments.length === 0) { ';
      html += '    document.getElementById("payAmount").value = displayTotal; ';
      html += '  } else if (payments.length > 0) { ';
      html += '    var paid = 0; ';
      html += '    payments.forEach(function(p) { paid += p.amount; }); ';
      html += '    var rem = displayTotal - paid; ';
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
      html += '  var cur = parseFloat(String(cart[idx].qty) || "0");';
      html += '  cart[idx].qty = cur + delta;';
      html += '  if (cart[idx].qty <= 0) {';
      html += '    showConfirm("Удаление", "Убрать товар?", function() {';
      html += '      cart.splice(idx, 1); resetPayments();';
      html += '    }, true);';
      html += '  } else { resetPayments(); }';
      html += '}';

      html += 'function setPay(method) {';
      html += '  payMethod = method;';
      html += '  var els = document.querySelectorAll(".pay-btn"); ';
      html += '  els.forEach(function(b) { b.classList.remove("active"); });';
      html += '  var btn = document.getElementById("btn-" + method);';
      html += '  if (btn) btn.classList.add("active");';
      html += '}';

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
      
      html += '  if (activeInputId === "totalPrice") { ';
      html += '    isTotalPriceEdited = true; ';
      html += '    var nt = parseFloat(inp.value) || 0; ';
      html += '    if (!isPayAmountEdited) { ';
      html += '      var paid = 0; ';
      html += '      payments.forEach(function(p) { paid += p.amount; }); ';
      html += '      var rem = nt - paid; ';
      html += '      document.getElementById("payAmount").value = ';
      html += '      rem > 0 ? rem : ""; ';
      html += '    } ';
      html += '    renderPayments(); ';
      html += '  }';
      
      html += '  if (activeInputId.indexOf("qty_") === 0) {';
      html += '    var idx = parseInt(activeInputId.replace("qty_", ""));';
      html += '    var newQty = parseFloat(inp.value) || 0;';
      html += '    if (newQty > 0) { ';
      html += '      cart[idx].qty = newQty; saveCart(); }';
      html += '    renderBasket(); '; 
      html += '  }';
      html += '}';

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
      html += '    align-items:center; color:var(--f-success); ';
      html += '    font-weight:bold; margin-bottom:6px;";';
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
      html += '    rTxt.style.color = "var(--f-danger)"; ';
      html += '    btn.classList.remove("ready"); return; }';
      html += '  if (remain > 0) { ';
      html += '    rTxt.innerText = "Осталось: " + remain + " ₽"; ';
      html += '    rTxt.style.color = "var(--f-danger)"; ';
      html += '    btn.classList.remove("ready"); ';
      html += '  } else if (remain === 0) {';
      html += '    if (payments.length === 0 && typed > 0) { ';
      html += '      rTxt.innerText = "Нажмите Внести"; ';
      html += '      rTxt.style.color = "var(--f-accent)"; ';
      html += '      btn.classList.remove("ready"); ';
      html += '    } else { ';
      html += '      rTxt.innerText = "Оплачено"; ';
      html += '      rTxt.style.color = "var(--f-success)"; ';
      html += '      btn.classList.add("ready"); }';
      html += '  } else { ';
      html += '    rTxt.innerText = "Сдача: " + Math.abs(remain) + " ₽"; ';
      html += '    rTxt.style.color = "#3C7A89"; ';
      html += '    btn.classList.add("ready"); }';
      html += '}';

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
      html += '  if (!currentIdempotencyKey) {';
      html += '    currentIdempotencyKey = Math.random().toString(36)';
      html += '    .substring(2) + Date.now().toString(36);';
      html += '  }';
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
      html += '    margin-bottom:6px; font-size:14px;";';
      html += '    var n = document.createElement("span"); ';
      html += '    n.textContent = item.name + " x" + fmtNum(item.qty);';
      html += '    var p = document.createElement("span"); ';
      html += '    p.textContent = (item.retail * item.qty) + " ₽";';
      html += '    row.appendChild(n); row.appendChild(p); ';
      html += '    list.appendChild(row);';
      html += '  });';
      html += '  if (payments.length > 0) {';
      html += '    var hr = document.createElement("hr");';
      html += '    hr.style = "border:none; border-top:1px dashed #ccc; ';
      html += '    margin: 10px 0;";';
      html += '    list.appendChild(hr);';
      html += '    payments.forEach(function(p) {';
      html += '      var mn = p.method === "cash" ? "Наличные" : ';
      html += '      (p.method === "card" ? "Карта" : "QR");';
      html += '      var pr = document.createElement("div");';
      html += '      pr.style = "display:flex; justify-content:space-between; ';
      html += '      font-size:13px; color:#666; margin-bottom:4px;";';
      html += '      var n = document.createElement("span"); ';
      html += '      n.textContent = mn;';
      html += '      var v = document.createElement("span"); ';
      html += '      v.textContent = p.amount + " ₽";';
      html += '      pr.appendChild(n); pr.appendChild(v);';
      html += '      list.appendChild(pr);';
      html += '    });';
      html += '  }';
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

      html += 'function saveSale() {';
      html += '  var btn = document.getElementById("btnSubmit");';
      html += '  if (btn.disabled) return;';
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
      html += '      if (p.method === precheckChangeMethod) {';
      html += '        if (p.amount >= remChange) { ';
      html += '          p.amount -= remChange; remChange = 0; break; }';
      html += '        else { remChange -= p.amount; p.amount = 0; }';
      html += '      }';
      html += '    }';
      html += '    if (remChange > 0) {';
      html += '      finalPayments.push({ method: precheckChangeMethod, ';
      html += '      amount: -remChange });';
      html += '    }';
      html += '  }';
      html += '  finalPayments = finalPayments.filter(function(p) { ';
      html += '    return p.amount !== 0; });';
      html += '  var payload = { real_price: total, ';
      html += '  payments: finalPayments, items: cart, ';
      html += '  idempotency_key: currentIdempotencyKey };';
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
      html += '      cart = []; payments = []; currentIdempotencyKey = null;';
      html += '    } else { ';
      html += '      btn.disabled = false; btn.innerText = "Принять"; ';
      html += '      showAlert("Ошибка", d.error || "unknown", false); }';
      html += '  }).catch(function(err) { ';
      html += '    btn.disabled = false; btn.innerText = "Принять"; ';
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false); });';
      html += '}';

      html += 'function closeSuccess() { window.location.reload(); }';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) {
      console.error('Sale page error:', e.message);
      res.status(500).send('Ошибка сервера');
    }
  });
  // ====== 6. ЭКРАН СПИСКА НАКЛАДНЫХ (ПРИХОДЫ) ======
  app.get('/warehouse/receipts', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.btn-new { display: flex; align-items: center; ';
      html += 'justify-content: center; width: 100%; padding: 16px; ';
      html += 'background: var(--f-brand); color: #fff; ';
      html += 'text-decoration: none; border-radius: var(--r-md); ';
      html += 'font-size: 16px; font-weight: 800; margin-bottom: 20px; ';
      html += 'box-sizing: border-box; ';
      html += 'box-shadow: 0 4px 12px rgba(6,76,73,0.2); }';
      
      html += '.doc { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 16px; margin-bottom: 12px; text-decoration: none; ';
      html += 'color: var(--f-text); display: flex; ';
      html += 'justify-content: space-between; align-items: center; ';
      html += 'box-shadow: var(--sh-1); border-left: 4px solid transparent; }';
      html += '.doc.completed { border-left-color: var(--f-success); }';
      html += '.doc.draft { border-left-color: var(--f-warn); }';
      
      html += '.doc-left { display: flex; flex-direction: column; gap: 4px; }';
      html += '.doc-title { font-weight: 700; font-size: 16px; }';
      html += '.meta { font-size: 13px; color: var(--f-text-2); }';
      html += '.meta-edited { font-size: 12px; color: var(--f-accent); ';
      html += 'font-weight: 600; margin-top: 2px; }';
      html += '.amount { font-weight: 800; font-size: 18px; text-align: right; }';
      
      html += '.del-btn { font-size: 20px; color: var(--f-danger); ';
      html += 'margin-left: 12px; cursor: pointer; padding: 8px; }';
      
      html += '#docPreviewModal .custom-modal { ';
      html += 'text-align: left; padding: 24px; }';
      html += '.dp-row { display: flex; justify-content: space-between; ';
      html += 'margin-bottom: 8px; font-size: 14px; }';
      html += '.dp-total { font-weight: 800; font-size: 18px; ';
      html += 'margin-top: 12px; text-align: right; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Приходы</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<a href="/warehouse/receipt/new" class="btn-new">';
      html += '+ Создать накладную</a>';
      html += '<div id="list">Загрузка...</div>';

      html += '<div class="custom-modal-overlay" id="docPreviewModal">';
      html += '<div class="custom-modal">';
      html += '<h3 id="docPreviewTitle" style="margin:0 0 16px 0; ';
      html += 'text-align:center;">Загрузка...</h3>';
      html += '<div id="docPreviewList" style="max-height:50vh; ';
      html += 'overflow-y:auto; border-top:1px solid #eee; ';
      html += 'border-bottom:1px solid #eee; padding:12px 0;"></div>';
      html += '<div id="docPreviewTotal" class="dp-total"></div>';
      html += '<button class="btn-cancel" style="margin-top:16px; ';
      html += 'width:100%; padding:14px; border:none; border-radius:12px; ';
      html += 'font-weight:700; background:#F0F4F4; color:var(--f-text);" ';
      html += 'onclick="closeDocPreview()">Закрыть</button>';
      html += '</div></div>';

      html += getUnifiedMenu('receipts');

      html += '<script>';
      html += 'fetch("/api/warehouse/receipts")';
      html += '.then(function(r) { return r.json(); })';
      html += '.then(function(d) {';
      html += '  var b = document.getElementById("list");';
      html += '  while(b.firstChild) b.removeChild(b.firstChild);';
      html += '  if (!d.ok || d.docs.length === 0) {';
      html += '    var empty = document.createElement("div");';
      html += '    empty.className = "empty-state";';
      html += '    var emTitle = document.createElement("div");';
      html += '    emTitle.className = "empty-state-title";';
      html += '    emTitle.textContent = "Накладных нет";';
      html += '    empty.appendChild(emTitle);';
      html += '    b.appendChild(empty); return; }';
      
      html += '  d.docs.forEach(function(doc) {';
      html += '    var a = document.createElement("a");';
      html += '    var st = doc.status === "draft" ? "draft" : "completed";';
      html += '    a.className = "doc " + st;';
      html += '    if (st === "draft") {';
      html += '      a.href = "/warehouse/receipt/edit?id=" + doc.id;';
      html += '    } else {';
      html += '      a.href = "/warehouse/documents/details?id=" + ';
      html += 'doc.id + "&type=receipts";';
      html += '    }';
      html += '    var ds = new Date(doc.date).toLocaleString("ru-RU");';
      html += '    var author = doc.author || "Флорист";';
      html += '    var statusTxt = st === "draft" ? "Черновик" : "Накладная";';
      
      html += '    var left = document.createElement("div");';
      html += '    left.className = "doc-left";';
      html += '    var title = document.createElement("div");';
      html += '    title.className = "doc-title";';
      html += '    title.textContent = statusTxt + " №" + doc.id;';
      html += '    left.appendChild(title);';
      html += '    var meta = document.createElement("div");';
      html += '    meta.className = "meta";';
      html += '    meta.textContent = ds + " · " + author;';
      html += '    left.appendChild(meta);';
      
      html += '    if (doc.updated_at && doc.updated_at !== doc.date) {';
      html += '      var upd = new Date(doc.updated_at).toLocaleString("ru-RU");';
      html += '      var metaEd = document.createElement("div");';
      html += '      metaEd.className = "meta-edited";';
      html += '      metaEd.textContent = "Изменено: " + upd;';
      html += '      left.appendChild(metaEd);';
      html += '    }';
      
      html += '    var right = document.createElement("div");';
      html += '    right.style.display = "flex";';
      html += '    right.style.alignItems = "center";';
      html += '    var amt = document.createElement("div");';
      html += '    amt.className = "amount";';
      html += '    amt.textContent = parseFloat(doc.total_sum)';
      html += '.toLocaleString("ru-RU") + " ₽";';
      html += '    right.appendChild(amt);';
      
      html += '    if (st === "draft") {';
      html += '      var del = document.createElement("span");';
      html += '      del.className = "del-btn";';
      html += '      del.textContent = "🗑";';
      html += '      del.onclick = function(e) {';
      html += '        e.preventDefault(); e.stopPropagation();';
      html += '        deleteDraft(doc.id);';
      html += '      };';
      html += '      right.appendChild(del);';
      html += '    }';
      
      html += '    var pressTimer;';
      html += '    a.addEventListener("touchstart", function() {';
      html += '      pressTimer = setTimeout(function() { ';
      html += '        a.dataset.longpress = "true";';
      html += '        showDocPreview(doc.id);';
      html += '        if (navigator.vibrate) navigator.vibrate(50);';
      html += '      }, 600);';
      html += '    });';
      html += '    a.addEventListener("touchend", function() { ';
      html += '      clearTimeout(pressTimer);';
      html += '      if (a.dataset.longpress === "true") {';
      html += '        closeDocPreview();';
      html += '      }';
      html += '    });';
      html += '    a.addEventListener("touchmove", function() { ';
      html += '      clearTimeout(pressTimer); });';
      html += '    a.addEventListener("click", function(e) {';
      html += '      if (a.dataset.longpress === "true") {';
      html += '        e.preventDefault(); a.dataset.longpress = "false";';
      html += '      }';
      html += '    });';
      
      html += '    a.appendChild(left); a.appendChild(right);';
      html += '    b.appendChild(a);';
      html += '  });';
      html += '}).catch(function() {';
      html += '  document.getElementById("list").textContent = "Ошибка";';
      html += '});';

      html += 'function showDocPreview(id) {';
      html += '  var ov = document.getElementById("docPreviewModal");';
      html += '  var title = document.getElementById("docPreviewTitle");';
      html += '  var list = document.getElementById("docPreviewList");';
      html += '  var total = document.getElementById("docPreviewTotal");';
      html += '  title.textContent = "Загрузка...";';
      html += '  list.innerHTML = ""; total.textContent = "";';
      html += '  ov.style.display = "flex";';
      html += '  fetch("/api/warehouse/documents/details?id=" + id + ';
      html += '  "&type=receipts")';
      html += '  .then(function(r){return r.json();})';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { title.textContent = "Ошибка"; return; }';
      html += '    title.textContent = "Накладная №" + id;';
      html += '    d.items.forEach(function(i) {';
      html += '      var row = document.createElement("div");';
      html += '      row.className = "dp-row";';
      html += '      var n = document.createElement("div");';
      html += '      n.textContent = i.name;';
      html += '      var q = document.createElement("div");';
      html += '      q.style.fontWeight = "bold";';
      html += '      q.textContent = fmtNum(i.qty) + " шт";';
      html += '      row.appendChild(n); row.appendChild(q);';
      html += '      list.appendChild(row);';
      html += '    });';
      html += '    total.textContent = "Итого: " + ';
      html += '    parseFloat(d.header.total_sum).toLocaleString("ru-RU") + ';
      html += '    " ₽";';
      html += '  }).catch(function(){ title.textContent = "Ошибка сети"; });';
      html += '}';
      
      html += 'function closeDocPreview() {';
      html += '  document.getElementById("docPreviewModal").style.display = ';
      html += '  "none";';
      html += '}';

      html += 'function deleteDraft(id) {';
      html += '  showConfirm("Удаление", "Удалить черновик №" + id + "?", ';
      html += '  function() {';
      html += '    fetch("/api/warehouse/receipt/delete", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ id: id }) })';
      html += '    .then(function(r) { return r.json(); })';
      html += '    .then(function(d) { if(d.ok) { location.reload(); } ';
      html += '    else showAlert("Ошибка", d.error, false); })';
      html += '    .catch(function() {});';
      html += '  }, true);';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 7. СОЗДАНИЕ ЧЕРНОВИКА ======
  app.get('/warehouse/receipt/new', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const r = await pool.query(
        'INSERT INTO wh_receipts (shop_id, chat_id, status) ' +
        'VALUES ($1, $2, \'draft\') RETURNING id',
        [auth.shopId, auth.chatId]
      );
      res.redirect('/warehouse/receipt/edit?id=' + r.rows[0].id);
    } catch (e) { 
      res.status(500).send('Ошибка создания'); 
    }
  });
  // ====== 8. ЭКРАН РЕДАКТИРОВАНИЯ ЧЕРНОВИКА ======
  app.get('/warehouse/receipt/edit', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const rawId = req.query.id;
      const receiptId = parseInt(rawId);
      if (!receiptId || isNaN(receiptId)) {
        return res.status(400).send('Неверный ID накладной');
      }

      const checkR = await pool.query(
        'SELECT status FROM wh_receipts ' +
        'WHERE id = $1 AND shop_id = $2',
        [receiptId, auth.shopId]
      );
      if (checkR.rows.length === 0 || checkR.rows[0].status !== 'draft') {
        return res.status(403).send('Накладная не найдена или уже проведена');
      }

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.card { padding: 20px; border-radius: var(--r-lg); ';
      html += 'margin-bottom: 16px; }';
      html += 'label { display: block; font-size: 13px; ';
      html += 'color: var(--f-text-2); margin-bottom: 6px; font-weight: 600; }';
      
      html += '.btn-add { width: 100%; background: var(--f-brand); ';
      html += 'color: #fff; border: none; padding: 16px; ';
      html += 'border-radius: var(--r-md); font-size: 16px; font-weight: 800; ';
      html += 'margin-bottom: 20px; box-shadow: 0 4px 12px rgba(6,76,73,0.2); }';
      
      html += '.basket { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 16px; margin-bottom: 16px; ';
      html += 'border: 2px solid var(--f-brand); display: none; }';
      
      html += '.b-row { display: flex; flex-direction: column; ';
      html += 'margin-bottom: 16px; padding-bottom: 16px; ';
      html += 'border-bottom: 1px solid var(--f-border); }';
      html += '.b-top { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 8px; font-weight: 700; }';
      html += '.b-controls { display: grid; ';
      html += 'grid-template-columns: 1fr 1fr 1fr; ';
      html += 'gap: 8px; align-items: end; }';
      html += '.b-controls label { font-size: 11px; margin-bottom: 4px; }';
      html += '.b-controls input { font-size: 14px; padding: 8px; ';
      html += 'text-align: center; margin-bottom: 0; }';
      
      html += '.btn-save { width: 100%; background: var(--f-success); ';
      html += 'color: #fff; border: none; padding: 16px; ';
      html += 'border-radius: var(--r-md); font-size: 16px; font-weight: 800; }';
      html += '.img-preview { width: 80px; height: 80px; border-radius: 12px; ';
      html += 'object-fit: cover; display: none; margin-bottom: 12px; }';
      
      html += '.dropdown-wrap { position: relative; }';
      html += '.dropdown-list { position: absolute; top: 100%; left: 0; ';
      html += 'right: 0; background: #fff; border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); margin-top: -8px; z-index: 100; ';
      html += 'box-shadow: var(--sh-2); max-height: 220px; ';
      html += 'overflow-y: auto; display: none; }';
      html += '.dd-item { padding: 12px 16px; ';
      html += 'border-bottom: 1px solid var(--f-border); cursor: pointer; ';
      html += 'display: flex; justify-content: space-between; ';
      html += 'align-items: center; }';
      html += '.dd-item:last-child { border-bottom: none; }';
      html += '.dd-name { font-weight: 600; font-size: 14px; }';
      html += '.dd-stock { font-size: 12px; font-weight: 800; }';
      
      html += '.clear-search { position: absolute; right: 14px; top: 14px; ';
      html += 'font-size: 18px; color: #aaa; cursor: pointer; ';
      html += 'display: none; background: none; border: none; padding: 0; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse/receipts" class="back-btn">←</a>';
      html += '<h2 class="page-title">Накладная</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

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
      html += 'onchange="previewPhoto()" style="margin-bottom:8px;">';
      html += '<img id="photoPreview" class="img-preview">';

      html += '<label>Количество</label>';
      html += '<input type="number" id="itemQty" step="0.1" ';
      html += 'inputmode="decimal">';
      html += '<label>Цена закупки</label>';
      html += '<input type="number" id="itemPrice" ';
      html += 'inputmode="decimal" oninput="calcCostDiff()">';
      html += '<div id="costDiff" class="hint-cost" ';
      html += 'style="font-size:12px; margin-top:-8px; margin-bottom:12px; ';
      html += 'font-weight:600;"></div>';

      html += '<label>Розничная цена (необязательно)</label>';
      html += '<input type="number" id="itemRetail" inputmode="decimal">';
      html += '</div>';

      html += '<button class="btn-add" id="btnAdd" ';
      html += 'onclick="addToBasket()">+ Добавить в накладную</button>';

      html += '<div class="basket" id="basket">';
      html += '<h3 style="margin-top:0; font-size:18px; font-weight:800; ';
      html += 'margin-bottom:16px;">В накладной:</h3>';
      html += '<div id="bList"></div>';
      html += '<div style="display:flex; justify-content:space-between; ';
      html += 'margin-top:16px; border-top:2px solid var(--f-brand); ';
      html += 'padding-top:12px; font-size:20px; font-weight:800;">';
      html += '<span>Итого:</span><span id="totalSum">0 ₽</span></div>';
      html += '<button class="btn-save" id="btnSaveReceipt" ';
      html += 'style="margin-top:20px;" ';
      html += 'onclick="saveReceipt()">Провести накладную</button>';
      html += '</div>';

      html += getUnifiedMenu('receipts');

      html += '<script>';
      html += 'var receiptId = ' + receiptId + ';';
      html += 'var currentLastCost = 0; var itemsCatalog = [];';
      html += 'var receiptItems = [];';

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
      html += '    var s = parseFloat(i.current_stock) || 0;';
      html += '    st.textContent = fmtNum(s) + " " + (i.unit || "шт");';
      html += '    st.style.color = s > 0 ? "var(--f-success)" : ';
      html += '    "var(--f-danger)";';
      html += '    row.appendChild(nm); row.appendChild(st);';
      html += '    row.onclick = function() {';
      html += '      document.getElementById("itemName").value = i.name;';
      html += '      document.getElementById("itemRetail").value = ';
      html += '      i.retail_price || ""     ;';
      html += '      currentLastCost = parseFloat(i.last_cost) || 0 dd;';
      html += '      document.getElementById("clearSearch")';
      html += '.style      .style.display = "none";';
      html += '.display = "none";';
      html += '      calcCostDiff();';
      html += '    };';
      html += '    dd.appendChild(row);';
      html += '  });';
      html += '  dd.style.display = "block";';
      html += '}';

      html += 'function clearSearchText() {';
      html += '  document.getElementById("itemName").value = "";';
      html += '  document.getElementById("clearSearch").style.display = ';
      html += '  "none";';
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
      html += '  var currentPrice = parseFloat(priceStr.replace(",", "."));';
      html += '  if (currentLastCost > 0 && currentPrice > 0) {';
      html += '    var diff = currentPrice - currentLastCost;';
      html += '    var sign = diff > 0 ? "+" : "";';
      html += '    var color = diff > 0 ? "var(--f-danger)" : ';
      html += '    "var(--f-success)";';
      html += '    hint.innerText = "Прошлая закупка: " + currentLastCost + ';
      html += '    " ₽ (" + sign + diff + " ₽)";';
      html += '    hint.style.color = color;';
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

      html += 'fetch("/api/warehouse/items")';
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
      html += '  var qty = document.getElementById("itemQty").value';
      html += '  .replace(",", ".");';
      html += '  var price = document.getElementById("itemPrice").value';
      html += '  .replace(",", ".");';
      html += '  var retail = document.getElementById("itemRetail").value';
      html += '  .replace(",", ".") || 0;';
      html += '  var catId = document.getElementById("itemCategory").value;';
      html += '  var unitEl = document.getElementById("itemUnit");';
      html += '  var unit = "шт";';
      html += '  if (document.getElementById("unitBlock").style.display !== ';
      html += '  "none") { unit = unitEl.value; }';
      html += '  if (!name || !qty || !price) { ';
      html += '    showAlert("Внимание", "Заполните поля", false); return; }';
      html += '  var btn = document.getElementById("btnAdd");';
      html += '  if (btn.disabled) return;';
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
      html += '    showAlert("Ошибка", "Сбой сети. Повторите.", false); });';
      html += '  };';
      html += '  if (f) {';
      html += '    var rd = new FileReader();';
      html += '    rd.onload = function(e) {';
      html += '      var img = new Image();';
      html += '      img.onload = function() {';
      html += '        var canvas = document.createElement("canvas"); ';
      html += '        var MAX = 800; var w = img.width, h = img.height;';
      html += '        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } ';
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
      html += '    var q = parseFloat(String(item.qty).replace(",", ".")) || 0;';
      html += '    var p = parseFloat(String(item.unit_cost)';
      html += '    .replace(",", ".")) || 0;';
      html += '    var rowSum = Math.round(q * p * 100) / 100;';
      html += '    totalSum += rowSum;';
      html += '    var div = document.createElement("div"); ';
      html += '    div.className = "b-row";';
      html += '    var top = document.createElement("div"); ';
      html += '    top.className = "b-top";';
      html += '    var n = document.createElement("div"); ';
      html += '    n.textContent = item.name || "Товар";';
      html += '    var del = document.createElement("span"); ';
      html += '    del.textContent = "✕"; ';
      html += '    del.style = "color:red; cursor:pointer; font-size:18px;";';
      html += '    del.onclick = function() { ';
      html += '      showConfirm("Удаление", "Убрать " + item.name + "?", ';
      html += '      function() { ';
      html += '        receiptItems.splice(idx, 1); renderList(); ';
      html += '      }, true); ';
      html += '    };';
      html += '    top.appendChild(n); top.appendChild(del); ';
      html += '    div.appendChild(top);';
      html += '    var ctrl = document.createElement("div"); ';
      html += '    ctrl.className = "b-controls";';
      
      html += '    var c1 = document.createElement("div");';
      html += '    var lbl1 = document.createElement("label");';
      html += '    lbl1.textContent = "Количество";';
      html += '    c1.appendChild(lbl1);';
      html += '    var inpQ = document.createElement("input"); ';
      html += '    inpQ.type = "number"; inpQ.value = fmtNum(item.qty); ';
      html += '    inpQ.step = "0.1"; inpQ.inputMode = "decimal";';
      html += '    inpQ.onchange = function() { ';
      html += '      var v = parseFloat(String(this.value)';
      html += '      .replace(",", ".")); ';
      html += '      if (v > 0) { receiptItems[idx].qty = v; renderList(); } ';
      html += '      else { this.value = fmtNum(item.qty); }';
      html += '    };';
      html += '    c1.appendChild(inpQ);';
      
      html += '    var c2 = document.createElement("div");';
      html += '    var lbl2 = document.createElement("label");';
      html += '    lbl2.textContent = "Закупка (₽)";';
      html += '    c2.appendChild(lbl2);';
      html += '    var inpP = document.createElement("input"); ';
      html += '    inpP.type = "number"; inpP.value = fmtNum(item.unit_cost); ';
      html += '    inpP.inputMode = "decimal";';
      html += '    inpP.onchange = function() { ';
      html += '      var v = parseFloat(String(this.value)';
      html += '      .replace(",", ".")); ';
      html += '      if (v > 0) { receiptItems[idx].unit_cost = v;';
      html += '      renderList(); } ';
      html += '      else { this.value = fmtNum(item.unit_cost); }';
      html += '    };';
      html += '    c2.appendChild(inpP);';
      
      html += '    var c3 = document.createElement("div");';
      html += '    var lbl3 = document.createElement("label");';
      html += '    lbl3.textContent = "Розница (₽)";';
      html += '    c3.appendChild(lbl3);';
      html += '    var inpR = document.createElement("input"); ';
      html += '    inpR.type = "number"; ';
      html += '    inpR.value = item.retail_price > 0 ? ';
      html += '    fmtNum(item.retail_price) : ""; ';
      html += '    inpR.inputMode = "decimal";';
      html += '    inpR.onchange = function() { ';
      html += '      var v = parseFloat(String(this.value)';
      html += '      .replace(",", ".")) || 0; ';
      html += '      receiptItems[idx].retail_price = v; ';
      html += '    };';
      html += '    c3.appendChild(inpR);';
      
      html += '    ctrl.appendChild(c1); ctrl.appendChild(c2); ';
      html += '    ctrl.appendChild(c3);';
      html += '    div.appendChild(ctrl); list.appendChild(div);';
      html += '  });';
      html += '  document.getElementById("totalSum").innerText = ';
      html += '  fmtNum(totalSum) + " ₽";';
      html += '}';

      html += 'function saveReceipt() {';
      html += '  if (receiptItems.length === 0) { ';
      html += '    showAlert("Ошибка", "Накладная пуста.", false); return; }';
      html += '  var noPriceCount = 0;';
      html += '  receiptItems.forEach(function(it) {';
      html += '    if (parseFloat(it.retail_price) === 0) { noPriceCount++; }';
      html += '  });';
      html += '  if (noPriceCount > 0) {';
      html += '    showConfirm("Внимание", "Товаров без цены: " + ';
      html += '    noPriceCount + ". Они не появятся в Кассе. ", ';
      html += '    function() { _doSave(); }, false);';
      html += '  } else { _doSave(); }';
      html += '}';

      html += 'function _doSave() {';
      html += '  var btn = document.getElementById("btnSaveReceipt");';
      html += '  if (btn.disabled) return;';
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
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });
  // ====== 9. ЭКРАН СПИСАНИЯ ======
  app.get('/warehouse/writeoff', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.search-wrap { position: relative; margin-bottom: 16px; }';
      
      html += '.dropdown-list { position: absolute; top: 100%; left: 0; ';
      html += 'right: 0; background: #fff; border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); margin-top: 4px; z-index: 100; ';
      html += 'box-shadow: var(--sh-2); max-height: 250px; ';
      html += 'overflow-y: auto; display: none; }';
      html += '.dd-item { padding: 12px 16px; ';
      html += 'border-bottom: 1px solid var(--f-border); cursor: pointer; ';
      html += 'display: flex; justify-content: space-between; ';
      html += 'align-items: center; }';
      html += '.dd-item:last-child { border-bottom: none; }';
      html += '.dd-name { font-weight: 600; font-size: 14px; }';
      html += '.dd-stock { font-size: 12px; font-weight: 800; }';

      html += '.grid { display: grid; grid-template-columns: ';
      html += 'repeat(auto-fill, minmax(110px, 1fr)); gap: 12px; ';
      html += 'margin-bottom: 16px; }';
      html += '.card { background: #fff; padding: 10px; ';
      html += 'border-radius: var(--r-lg); text-align: center; ';
      html += 'cursor: pointer; box-shadow: var(--sh-1); }';
      html += '.card img { width: 100%; aspect-ratio: 1; object-fit: cover; ';
      html += 'border-radius: var(--r-md); margin-bottom: 8px; }';
      html += '.card .ph { width: 100%; aspect-ratio: 1; ';
      html += 'border-radius: var(--r-md); background: #F0F4F4; ';
      html += 'display: flex; align-items: center; ';
      html += 'justify-content: center; margin-bottom: 8px; }';
      html += '.card .name { font-size: 13px; font-weight: 600; ';
      html += 'margin-bottom: 4px; line-height: 1.2; display: -webkit-box; ';
      html += '-webkit-line-clamp: 2; -webkit-box-orient: vertical; ';
      html += 'overflow: hidden; }';
      html += '.card .stock { font-size: 12px; font-weight: 800; }';
      html += '.card .stock.green { color: var(--f-success); }';
      html += '.card .stock.red { color: var(--f-danger); }';
      
      html += '.basket { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 16px; margin-bottom: 16px; ';
      html += 'box-shadow: var(--sh-1); display: none; ';
      html += 'border-left: 4px solid var(--f-accent); }';
      
      html += '.b-row { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 8px; ';
      html += 'font-size: 14px; padding-bottom: 8px; ';
      html += 'border-bottom: 1px solid var(--f-border); }';
      html += '.b-controls { display: flex; gap: 6px; align-items: center; }';
      html += '.qty-btn { background: #F0F4F4; border: none; width: 28px; ';
      html += 'height: 28px; border-radius: 8px; font-weight: bold; ';
      html += 'font-size: 14px; color: var(--f-text); }';
      html += '.qty-input { width: 70px !important; height: 28px; ';
      html += 'font-size: 14px; margin: 0; padding: 0 4px; ';
      html += 'text-align: center; border: 1px solid var(--f-border); }';
      
      html += '.btn-checkout { width: 100%; padding: 16px; ';
      html += 'background: var(--f-accent); color: #fff; ';
      html += 'border: none; border-radius: var(--r-md); font-size: 16px; ';
      html += 'font-weight: 800; margin-top: 12px; display: none; }';

      html += '.form-block { display: none; background: #fff; ';
      html += 'border-radius: var(--r-lg); padding: 16px; ';
      html += 'margin-bottom: 16px; box-shadow: var(--sh-1); }';
      html += '.reasons { display: grid; grid-template-columns: 1fr 1fr; ';
      html += 'gap: 10px; margin-bottom: 16px; }';
      html += '.reason { padding: 12px; border-radius: var(--r-md); ';
      html += 'border: 1px solid var(--f-border); background: #fff; ';
      html += 'text-align: center; cursor: pointer; font-size: 14px; ';
      html += 'font-weight: 600; color: var(--f-text); }';
      html += '.reason.active { border-color: var(--f-accent); ';
      html += 'color: var(--f-accent); background: #FFF3E0; }';
      html += '.btn-save { width: 100%; padding: 16px; ';
      html += 'background: var(--f-danger); color: #fff; ';
      html += 'border: none; border-radius: var(--r-md); font-size: 16px; ';
      html += 'font-weight: 800; }';
      
      html += '.totals-box { margin-top: 16px; padding-top: 16px; ';
      html += 'border-top: 2px solid var(--f-brand); ';
      html += 'display: flex; justify-content: space-between; ';
      html += 'font-size: 18px; font-weight: 800; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Списание</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<div class="search-wrap">';
      html += '<input type="text" class="search" id="search" ';
      html += 'placeholder="Поиск..." oninput="onSearchInput()" ';
      html += 'autocomplete="off">';
      html += '<div class="dropdown-list" id="ddList"></div>';
      html += '</div>';

      html += '<div class="basket" id="basket">';
      html += '<h3 style="margin-top:0; font-size:16px; font-weight:800; ';
      html += 'margin-bottom:12px;">К списанию:</h3>';
      html += '<div id="bList"></div>';
      html += '<div class="totals-box">';
      html += '<span id="totQty">Всего: 0 шт</span>';
      html += '<span id="totSum">0 ₽</span>';
      html += '</div>';
      html += '<button class="btn-checkout" id="btnCheckout" ';
      html += 'onclick="showForm()">Перейти к оформлению</button>';
      html += '</div>';

      html += '<div class="form-block" id="formBlock">';
      html += '<label style="display:block; font-size:13px; font-weight:600; ';
      html += 'color:var(--f-text-2); margin-bottom:8px;">';
      html += 'Причина списания</label>';
      html += '<div class="reasons">';
      html += '<div class="reason active" ';
      html += 'onclick="setR(this, &apos;spoilage&apos;)">Порча</div>';
      html += '<div class="reason" ';
      html += 'onclick="setR(this, &apos;loss&apos;)">Потеря</div>';
      html += '<div class="reason" ';
      html += 'onclick="setR(this, &apos;markdown&apos;)">Уценка</div>';
      html += '<div class="reason" ';
      html += 'onclick="setR(this, &apos;sorting&apos;)">Пересорт</div>';
      html += '</div>';
      
      html += '<label style="font-size:13px; font-weight:600; ';
      html += 'color:var(--f-text-2);">Комментарий</label>';
      html += '<textarea id="comment" style="width:100%; padding:12px; ';
      html += 'border-radius:var(--r-md); border:1px solid var(--f-border); ';
      html += 'margin-bottom:16px; font-family:inherit; ';
      html += 'box-shadow: var(--sh-1);"></textarea>';
      
      html += '<label style="font-size:13px; font-weight:600; ';
      html += 'color:var(--f-text-2);">Фото (необязательно)</label>';
      html += '<input type="file" id="wPhoto" accept="image/*" ';
      html += 'style="margin-bottom:16px; box-shadow: none; ';
      html += 'padding: 8px; border: 1px dashed var(--f-border);">';
      
      html += '<button class="btn-save" id="btnSaveWriteoff" ';
      html += 'onclick="saveWriteoff()">Списать всё</button>';
      html += '</div>';

      html += '<div class="grid" id="itemsGrid"></div>';

      html += getUnifiedMenu('writeoff');

      html += '<script>';
      html += 'var allItems = []; var cart = []; ';
      html += 'var selReason = "spoilage";';
      
      html += 'var svgPh = "<div style=width:40px;height:40px;';
      html += 'background:#D8E4E4;border-radius:50%;></div>";';

      html += 'fetch("/api/warehouse/items")';
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
      html += '  var q = document.getElementById("search").value';
      html += '  .toLowerCase();';
      html += '  var dd = document.getElementById("ddList");';
      html += '  while(dd.firstChild) dd.removeChild(dd.firstChild);';
      html += '  if (q.length > 0) {';
      html += '    var found = allItems.filter(function(i) { ';
      html += '      return i.name.toLowerCase().includes(q); ';
      html += '    }).slice(0, 20);';
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
      html += '        st.style.color = s > 0 ? "var(--f-success)" : ';
      html += '        "var(--f-danger)";';
      html += '        row.appendChild(nm); row.appendChild(st);';
      html += '        row.onclick = function() { ';
      html += '          document.getElementById("search").value = "";';
      html += '          dd.style.display = "none"; ';
      html += '          addToBasket(i); };';
      html += '        dd.appendChild(row);';
      html += '      });';
      html += '      dd.style.display = "block";';
      html += '    } else { dd.style.display = "none"; }';
      html += '  } else { dd.style.display = "none"; }';
      html += '  renderGrid();';
      html += '}';

      html += 'function renderGrid() {';
      html += '  var q = document.getElementById("search").value';
      html += '  .toLowerCase();';
      html += '  var items = allItems.filter(function(i) { ';
      html += '    return i.name.toLowerCase().includes(q); });';
      html += '  drawCards(items);';
      html += '}';

      html += 'function drawCards(items) {';
      html += '  var g = document.getElementById("itemsGrid");';
      html += '  while (g.firstChild) g.removeChild(g.firstChild);';
      html += '  items.forEach(function(i) {';
      html += '    var d = document.createElement("div"); ';
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
      html += '    var stockVal = parseFloat(i.current_stock) || 0;';
      html += '    st.className = "stock " + (stockVal > 0 ? "green" : "red");';
      html += '    st.textContent = "Ост: " + ';
      html += '    fmtNum(stockVal) + " " + (i.unit || "шт");';
      html += '    d.appendChild(nm); d.appendChild(st);';
      html += '    d.onclick = function() { addToBasket(i); };';
      html += '    g.appendChild(d);';
      html += '  });';
      html += '}';

      html += 'function addToBasket(item) {';
      html += '  var ex = cart.find(function(c) { return c.id === item.id; });';
      html += '  if (ex) { ex.qty += 1; }';
      html += '  else { cart.push({ id: item.id, name: item.name, qty: 1, ';
      html += '    avg_cost: item.avg_cost || 0 }); }';
      html += '  renderBasket(); ';
      html += '}';

      html += 'function changeQty(idx, delta) {';
      html += '  cart[idx].qty += delta;';
      html += '  if (cart[idx].qty <= 0) {';
      html += '    cart.splice(idx, 1); renderBasket();';
      html += '  } else { renderBasket(); }';
      html += '}';

      html += 'function renderBasket() {';
      html += '  var b = document.getElementById("basket");';
      html += '  var list = document.getElementById("bList");';
      html += '  var form = document.getElementById("formBlock");';
      html += '  if (cart.length === 0) { ';
      html += '    b.style.display = "none"; form.style.display = "none"; ';
      html += '    return; }';
      html += '  b.style.display = "block"; ';
      html += '  while(list.firstChild) list.removeChild(list.firstChild);';
      html += '  var totQty = 0; var totSum = 0;';
      html += '  cart.forEach(function(item, idx) {';
      html += '    var q = parseFloat(String(item.qty).replace(",", ".")) || 0;';
      html += '    var c = parseFloat(String(item.avg_cost)';
      html += '    .replace(",", ".")) || 0;';
      html += '    totQty += q; totSum += q * c;';
      html += '    var div = document.createElement("div");';
      html += '    div.className = "b-row";';
      html += '    var n = document.createElement("div"); ';
      html += '    n.textContent = item.name;';
      html += '    var ctrl = document.createElement("div"); ';
      html += '    ctrl.className = "b-controls";';
      html += '    var mn = document.createElement("button"); ';
      html += '    mn.textContent = "-"; mn.className = "qty-btn"; ';
      html += '    mn.onclick = function() { changeQty(idx, -1); };';
      html += '    var inp = document.createElement("input"); ';
      html += '    inp.type = "number"; inp.className = "qty-input"; ';
      html += '    inp.value = item.qty; inp.inputMode = "decimal";';
      html += '    inp.onchange = function() { ';
      html += '      var v = parseFloat(String(this.value)';
      html += '      .replace(",", ".")); ';
      html += '      if (v > 0) { cart[idx].qty = v; renderBasket(); } ';
      html += '      else { this.value = item.qty; }';
      html += '    };';
      html += '    var pl = document.createElement("button"); ';
      html += '    pl.textContent = "+"; pl.className = "qty-btn"; ';
      html += '    pl.onclick = function() { changeQty(idx, 1); };';
      html += '    ctrl.appendChild(mn); ctrl.appendChild(inp); ';
      html += '    ctrl.appendChild(pl);';
      html += '    var del = document.createElement("span"); ';
      html += '    del.textContent = "✕"; ';
      html += '    del.style = "color:red; cursor:pointer; font-size:18px; ';
      html += '    margin-left:10px;";';
      html += '    del.onclick = function() { ';
      html += '      cart.splice(idx, 1); renderBasket(); ';
      html += '    };';
      html += '    ctrl.appendChild(del);';
      html += '    div.appendChild(n); div.appendChild(ctrl); ';
      html += '    list.appendChild(div);';
      html += '  });';
      html += '  document.getElementById("totQty").textContent = ';
      html += '  "Всего: " + fmtNum(totQty) + " шт";';
      html += '  document.getElementById("totSum").textContent = ';
      html += '  Math.round(totSum).toLocaleString("ru-RU") + " ₽";';
      html += '  document.getElementById("btnCheckout").style.display = ';
      html += '  "block";';
      html += '}';

      html += 'function showForm() {';
      html += '  document.getElementById("formBlock").style.display = "block";';
      html += '  document.getElementById("btnCheckout").style.display = ';
      html += '  "none";';
      html += '  document.getElementById("formBlock").scrollIntoView({ ';
      html += '    behavior: "smooth" });';
      html += '}';

      html += 'function setR(el, r) {';
      html += '  document.querySelectorAll(".reason").forEach(function(b) {';
      html += '    b.classList.remove("active"); });';
      html += '  el.classList.add("active"); selReason = r;';
      html += '}';

      html += 'function saveWriteoff() {';
      html += '  if (cart.length === 0) return;';
      html += '  var btn = document.getElementById("btnSaveWriteoff");';
      html += '  if (btn.disabled) return;';
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
      html += '  .then(function(d) { submit(d.ok ? d.url : null, c); })';
      html += '  .catch(function() { submit(null, c); });';
      html += '}';

      html += 'function submit(url, c) {';
      html += '  var payload = { items: cart, ';
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
      html += '      document.getElementById("btnSaveWriteoff").disabled = ';
      html += '      false;';
      html += '      document.getElementById("btnSaveWriteoff").innerText = ';
      html += '      "Списать всё"; showAlert("Ошибка", d.error, false);';
      html += '    }';
      html += '  }).catch(function() {';
      html += '    document.getElementById("btnSaveWriteoff").disabled = false;';
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false);';
      html += '  });';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });
  // ====== 10. ЭКРАН ДОКУМЕНТОВ ======
  app.get('/warehouse/documents', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.tabs { display: flex; gap: 8px; margin-bottom: 16px; } ';
      html += '.tab { flex: 1; padding: 12px; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); background: #fff; ';
      html += 'text-align: center; cursor: pointer; text-decoration: none; ';
      html += 'font-weight: 600; font-size: 14px; color: var(--f-text); }';
      html += '.tab.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); } ';
      
      html += '.doc { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 16px; margin-bottom: 12px; text-decoration: none; ';
      html += 'color: var(--f-text); display: flex; ';
      html += 'justify-content: space-between; align-items: center; ';
      html += 'box-shadow: var(--sh-1); border-left: 4px solid transparent; }';
      html += '.doc.receipt { border-left-color: #3C7A89; } ';
      html += '.doc.writeoff { border-left-color: var(--f-accent); } ';
      
      html += '.doc-left { display: flex; flex-direction: column; gap: 4px; }';
      html += '.doc-title { font-weight: 700; font-size: 16px; }';
      html += '.meta { font-size: 13px; color: var(--f-text-2); } ';
      html += '.amount { font-weight: 800; font-size: 18px; text-align: right; }';
      
      html += '#docPreviewModal .custom-modal { ';
      html += 'text-align: left; padding: 24px; }';
      html += '.dp-row { display: flex; justify-content: space-between; ';
      html += 'margin-bottom: 8px; font-size: 14px; }';
      html += '.dp-total { font-weight: 800; font-size: 18px; ';
      html += 'margin-top: 12px; text-align: right; }';
      html += '</style></head><body>';
      
      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Документы</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<div class="tabs">';
      html += '<a href="/warehouse/documents?type=receipts" ';
      html += 'class="tab" id="tab-receipts">Приходы</a>';
      html += '<a href="/warehouse/documents?type=writeoffs" class="tab" ';
      html += 'id="tab-writeoffs">Списания</a></div><div id="list">';
      html += 'Загрузка...</div>';

      html += '<div class="custom-modal-overlay" id="docPreviewModal">';
      html += '<div class="custom-modal">';
      html += '<h3 id="docPreviewTitle" style="margin:0 0 16px 0; ';
      html += 'text-align:center;">Загрузка...</h3>';
      html += '<div id="docPreviewList" style="max-height:50vh; ';
      html += 'overflow-y:auto; border-top:1px solid #eee; ';
      html += 'border-bottom:1px solid #eee; padding:12px 0;"></div>';
      html += '<div id="docPreviewTotal" class="dp-total"></div>';
      html += '<button class="btn-cancel" style="margin-top:16px; ';
      html += 'width:100%; padding:14px; border:none; border-radius:12px; ';
      html += 'font-weight:700; background:#F0F4F4; color:var(--f-text);" ';
      html += 'onclick="closeDocPreview()">Закрыть</button>';
      html += '</div></div>';

      html += getUnifiedMenu('documents');

      html += '<script>';
      html += 'var currentType = new URLSearchParams(window.location.search)';
      html += '.get("type") || "receipts";';
      html += 'var tab = document.getElementById("tab-" + currentType); ';
      html += 'if (tab) tab.classList.add("active");';
      
      html += 'fetch("/api/warehouse/documents?type=" + currentType)';
      html += '.then(function(r){return r.json();})';
      html += '.then(function(d){';
      html += '  var b = document.getElementById("list"); ';
      html += '  while(b.firstChild) b.removeChild(b.firstChild); ';
      html += '  if (!d.ok) { b.textContent = "Ошибка"; return; } ';
      html += '  if (d.docs.length === 0) { ';
      html += '    var em = document.createElement("div"); ';
      html += '    em.className = "empty-state"; ';
      html += '    var emT = document.createElement("div"); ';
      html += '    emT.className = "empty-state-title"; ';
      html += '    emT.textContent = "Документов нет"; ';
      html += '    em.appendChild(emT); b.appendChild(em); ';
      html += '    return; }';
      
      html += '  d.docs.forEach(function(doc){ ';
      html += '    var a = document.createElement("a"); ';
      html += '    var cl = currentType === "receipts" ? "receipt" : "writeoff";';
      html += '    a.className = "doc " + cl; ';
      html += '    a.href = "/warehouse/documents/details?id=" + doc.id + ';
      html += '    "&type=" + currentType;';
      html += '    var ds = new Date(doc.date).toLocaleString("ru-RU"); ';
      html += '    var author = doc.author || "Система"; ';
      
      html += '    var left = document.createElement("div"); ';
      html += '    left.className = "doc-left"; ';
      html += '    var title = document.createElement("div"); ';
      html += '    title.className = "doc-title"; ';
      html += '    var meta = document.createElement("div"); ';
      html += '    meta.className = "meta"; ';
      html += '    var amount = document.createElement("div"); ';
      html += '    amount.className = "amount";';
      
      html += '    if (currentType === "receipts") { ';
      html += '      title.textContent = "Накладная №" + doc.id; ';
      html += '      meta.textContent = ds + " · " + author; ';
      html += '      amount.textContent = parseFloat(doc.amount)';
      html += '      .toLocaleString("ru-RU") + " ₽"; ';
      html += '      amount.style.color = "#3C7A89"; ';
      html += '    } else { ';
      html += '      title.textContent = "Акт списания №" + doc.id; ';
      html += '      var itm = doc.items || ""; ';
      html += '      var reason = translateReason(doc.reason); ';
      html += '      meta.textContent = ds + " · " + author + " (" + ';
      html += '      itm + " / " + reason + ")"; ';
      html += '      amount.textContent = "-" + fmtNum(doc.amount) + " шт"; ';
      html += '      amount.style.color = "var(--f-accent)"; }';
      
      html += '    left.appendChild(title); left.appendChild(meta); ';
      html += '    a.appendChild(left); a.appendChild(amount); ';

      html += '    var pressTimer;';
      html += '    a.addEventListener("touchstart", function() {';
      html += '      pressTimer = setTimeout(function() { ';
      html += '        a.dataset.longpress = "true";';
      html += '        showDocPreview(doc.id, currentType);';
      html += '        if (navigator.vibrate) navigator.vibrate(50);';
      html += '      }, 600);';
      html += '    });';
      html += '    a.addEventListener("touchend", function() { ';
      html += '      clearTimeout(pressTimer);';
      html += '      if (a.dataset.longpress === "true") {';
      html += '        closeDocPreview();';
      html += '      }';
      html += '    });';
      html += '    a.addEventListener("touchmove", function() { ';
      html += '      clearTimeout(pressTimer); });';
      html += '    a.addEventListener("click", function(e) {';
      html += '      if (a.dataset.longpress === "true") {';
      html += '        e.preventDefault(); a.dataset.longpress = "false";';
      html += '      }';
      html += '    });';

      html += '    b.appendChild(a); });';
      html += '}).catch(function(){ ';
      html += 'document.getElementById("list").textContent = "Ошибка"; });';

      html += 'function showDocPreview(id, type) {';
      html += '  var ov = document.getElementById("docPreviewModal");';
      html += '  var title = document.getElementById("docPreviewTitle");';
      html += '  var list = document.getElementById("docPreviewList");';
      html += '  var total = document.getElementById("docPreviewTotal");';
      html += '  title.textContent = "Загрузка...";';
      html += '  list.innerHTML = ""; total.textContent = "";';
      html += '  ov.style.display = "flex";';
      html += '  fetch("/api/warehouse/documents/details?id=" + id + ';
      html += '  "&type=" + type)';
      html += '  .then(function(r){return r.json();})';
      html += '  .then(function(d) {';
      html += '    if (!d.ok) { title.textContent = "Ошибка"; return; }';
      html += '    title.textContent = (type === "receipts" ? ';
      html += '    "Накладная №" : "Акт №") + id;';
      html += '    d.items.forEach(function(i) {';
      html += '      var row = document.createElement("div");';
      html += '      row.className = "dp-row";';
      html += '      var n = document.createElement("div");';
      html += '      n.textContent = i.name;';
      html += '      var q = document.createElement("div");';
      html += '      q.style.fontWeight = "bold";';
      html += '      q.textContent = fmtNum(i.qty) + " шт";';
      html += '      row.appendChild(n); row.appendChild(q);';
      html += '      list.appendChild(row);';
      html += '    });';
      html += '    var totalTxt = type === "receipts" ? ';
      html += '    parseFloat(d.header.total_sum).toLocaleString("ru-RU") ';
      html += '    + " ₽" : fmtNum(d.header.total_sum) + " шт";';
      html += '    total.textContent = "Итого: " + totalTxt;';
      html += '  }).catch(function(){ title.textContent = "Ошибка сети"; });';
      html += '}';
      
      html += 'function closeDocPreview() {';
      html += '  document.getElementById("docPreviewModal").style.display = ';
      html += '  "none";';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 11. ЭКРАН ДЕТАЛЕЙ ДОКУМЕНТА ======
  app.get('/warehouse/documents/details', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.card { padding: 20px; border-radius: var(--r-lg); ';
      html += 'margin-bottom: 16px; }';
      html += '.item-row { display: flex; justify-content: space-between; ';
      html += 'padding: 12px 0; border-bottom: 1px solid var(--f-border); ';
      html += 'text-decoration: none; color: var(--f-text); } ';
      html += '.item-row:last-child { border-bottom: none; } ';
      html += '.item-name { font-weight: 600; font-size: 15px; } ';
      html += '.item-qty { text-align: right; font-weight: 800; }';
      html += '.total-row { margin-top: 16px; padding-top: 16px; ';
      html += 'border-top: 2px solid var(--f-brand); display: flex; ';
      html += 'justify-content: space-between; font-size: 20px; ';
      html += 'font-weight: 800; }';
      html += '.btn-cancel-doc { width: 100%; padding: 16px; ';
      html += 'background: #fff; border: 2px solid var(--f-danger); ';
      html += 'color: var(--f-danger); border-radius: var(--r-md); ';
      html += 'font-weight: 800; font-size: 16px; margin-top: 24px; ';
      html += 'cursor: pointer; }';
      html += '</style></head><body>';
      
      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="#" onclick="history.back(); return false;" ';
      html += 'class="back-btn">←</a>';
      html += '<h2 class="page-title">Документ</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<div class="card" id="content">Загрузка...</div>';

      html += getUnifiedMenu('documents');

      html += '<script>';
      html += 'var urlParams = new URLSearchParams(window.location.search); ';
      html += 'var docId = urlParams.get("id") || ""; ';
      html += 'var docType = urlParams.get("type") || "receipts";';
      html += 'fetch("/api/warehouse/documents/details?id=" + docId + ';
      html += '"&type=" + docType).then(function(r){return r.json();})';
      html += '.then(function(d){';
      html += '  var content = document.getElementById("content"); ';
      html += '  while(content.firstChild) ';
      html += '  content.removeChild(content.firstChild); ';
      html += '  if (!d.ok) { ';
      html += '    content.textContent = "Ошибка: " + d.error; return; }';
      html += '  var h = d.header; ';
      html += '  var ds = new Date(h.date).toLocaleString("ru-RU"); ';
      html += '  var titleTxt = docType === "receipts" ? ';
      html += '  "Приходная накладная №" : "Акт списания №";';
      
      html += '  var title = document.createElement("div"); ';
      html += '  title.style = "font-size:20px; font-weight:800;дела"; ';
      html += '  title.textContent =л titleTxt + h.id; ';
      html += '  content.appendChild(title);';
      
      html += '  var meta = document ".createElement("div"); ';
      html += '  meta.style = "font-size:13px; color:var(--f-text-2); ';
      html += '  margin-bottom:16px;"; ';
      html += '  meta.textContent = ds + " · С ';
      html += '  (h.author || "Неизвестно"); ';
      html += '  content.appendChild(meta);';
      
      html += '  d.items.forEach(function(i){ ';
      html += '    var a = document.createElement("a"); ';
      html += '    a.href = "/warehouse/item?id=" + ';
      html += '    (parseInt(i.shop_item_id) || 0); ';
      html += '    a.className = "item-row"; ';
      html += '    var left = document.createElement("div"); ';
      html += '    var nm = document.createElement("div"); ';
      html += '    nm.className = "item-name"; nm.textContent = i.name; ';
      html += '    left.appendChild(nm);';
      
      html += '    if (docType === "receipts") { ';
      html += '      var cost = document.createElement("div"); ';
      html += '      cost.style = "font-size:12px; color:var(--f-text-2);"; ';
      html += '      cost.textContent = parseFloat(i.unit_cost)';
      html += '      .toLocaleString("ru-RU") + " ₽/шт"; ';
      html += '      left.appendChild(cost); ';
      html += '    } else { ';
      html += '      var rsn = document.createElement("div"); ';
      html += '      rsn.style = "font-size:12px; color:var(--f-text-2);"; ';
      html += '      rsn.textContent = "Причина: " + ';
      html += '      translateReason(h.reason); ';
      html += '      left.appendChild(rsn); }';
      
      html += '    var right = document.createElement("div"); ';
      html += '    right.className = "item-qty"; ';
      html += '    right.textContent = fmtNum(i.qty) + " шт";';
      html += '    if (docType === "receipts") { ';
      html += '      var sum = document.createElement("div"); ';
      html += '      sum.style = "font-size:12px; ';
      html += '      color:var(--f-text-2); font-weight:400;"; ';
      html += '      sum.textContent = parseFloat(i.sum)';
      html += '      .toLocaleString("ru-RU") + " ₽"; ';
      html += '      right.appendChild(sum); }';
      html += '    a.appendChild(left); a.appendChild(right); ';
      html += '    content.appendChild(a); });';
      
      html += '  var total = document.createElement("div"); ';
      html += '  total.className = "total-row";';
      html += '  var totalTxt = docType === "receipts" ? ';
      html += '  parseFloat(h.total_sum).toLocaleString("ru-RU") + " ₽" : ';
      html += '  fmtNum(h.total_sum) + " шт";';
      
      html += '  var spanLeft = document.createElement("span"); ';
      html += '  spanLeft.textContent = "Итого:"; ';
      html += '  var spanRight = document.createElement("span"); ';
      html += '  spanRight.textContent = totalTxt; ';
      html += '  total.appendChild(spanLeft); ';
      html += '  total.appendChild(spanRight); ';
      html += '  content.appendChild(total);';
      
      html += '  if (docType === "receipts" && h.status === "completed") {';
      html += '    var cancelBtn = document.createElement("button"); ';
      html += '    cancelBtn.className = "btn-cancel-doc"; ';
      html += '    cancelBtn.innerText = "Отменить проведение";';
      html += '    cancelBtn.onclick = function() { ';
      html += '      showConfirm("Отмена", "Вы уверены? Товары спишутся ';
      html += '      со склада, накладная станет черновиком.", ';
      html += '      function() {';
      html += '        fetch("/api/warehouse/receipt/cancel", { ';
      html += '        method: "POST", headers: { "Content-Type": ';
      html += '        "application/json" }, body: JSON.stringify({ ';
      html += '        id: docId }) })';
      html += '        .then(function(r){return r.json();})';
      html += '        .then(function(res){ ';
      html += '        if(res.ok){ showAlert("Готово", ';
      html += '        "Накладная отменена", true); ';
      html += '        setTimeout(function(){window.location.href=';
      html += '        "/warehouse/receipt/edit?id=" + docId;}, 1000); } ';
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
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });
  // ====== 12. ЭКРАН ОТЧЁТОВ ======
  app.get('/warehouse/reports', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.date-row { display: flex; gap: 8px; margin-bottom: 12px; }';
      html += '.date-row input { flex: 1; padding: 10px; border: none; ';
      html += 'border-radius: var(--r-md); font-family: inherit; ';
      html += 'font-size: 14px; box-shadow: var(--sh-1); margin: 0; }';
      
      html += '.quick-dates { display: flex; gap: 6px; margin-bottom: 16px; }';
      html += '.q-btn { flex: 1; padding: 10px; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); background: #fff; ';
      html += 'text-align: center; font-size: 13px; font-weight: 600; ';
      html += 'cursor: pointer; color: var(--f-text); }';
      html += '.q-btn.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); }';

      html += '.tabs { display: flex; gap: 6px; margin-bottom: 16px; ';
      html += 'overflow-x: auto; padding-bottom: 4px; }';
      html += '.tabs::-webkit-scrollbar { display: none; }';
      html += '.tab { padding: 10px 16px; border-radius: 20px; ';
      html += 'background: #fff; border: 1px solid var(--f-border); ';
      html += 'font-size: 14px; font-weight: 600; white-space: nowrap; ';
      html += 'cursor: pointer; color: var(--f-text); }';
      html += '.tab.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); }';

      html += '.card { padding: 20px; border-radius: var(--r-lg); ';
      html += 'margin-bottom: 16px; text-align: center; }';
      html += '.val { font-size: 28px; font-weight: 800; margin-bottom: 4px; }';
      html += '.val.blue { color: #3C7A89; } ';
      html += '.val.green { color: var(--f-success); } ';
      html += '.val.red { color: var(--f-danger); }';
      html += '.lbl { font-size: 14px; color: var(--f-text-2); }';
      
      html += '.list-item { display: flex; justify-content: space-between; ';
      html += 'padding: 12px 0; border-bottom: 1px solid var(--f-border); ';
      html += 'font-size: 15px; }';
      html += '.list-item:last-child { border-bottom: none; }';
      
      html += '.chart-container { margin-top: 20px; overflow-x: auto; ';
      html += 'padding-bottom: 12px; -webkit-overflow-scrolling: touch; }';
      html += '.chart-wrap { display: flex; align-items: flex-end; ';
      html += 'height: 140px; gap: 8px; min-width: 100%; width: max-content; }';
      html += '.bar-col { width: 44px; display: flex; flex-direction: column; ';
      html += 'justify-content: flex-end; align-items: center; height: 100%; }';
      html += '.bar { width: 100%; background: #E0F2F1; ';
      html += 'border-radius: 6px 6px 0 0; transition: background 0.2s; ';
      html += 'cursor: pointer; min-height: 4px; }';
      html += '.bar.active { background: var(--f-brand); }';
      html += '.bar-lbl { font-size: 11px; color: var(--f-text-2); ';
      html += 'margin-top: 6px; font-weight: 600; }';
      html += '.chart-info { font-size: 14px; font-weight: 700; ';
      html += 'margin-top: 12px; color: var(--f-brand); height: 20px; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Отчёты</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<div class="date-row">';
      html += '<input type="date" id="dateStart" onchange="setCustom()">';
      html += '<input type="date" id="dateEnd" onchange="setCustom()">';
      html += '</div>';
      
      html += '<div class="quick-dates">';
      html += '<div class="q-btn" id="q-today" ';
      html += 'onclick="setQuick(&apos;today&apos;)">Сегодня</div>';
      html += '<div class="q-btn" id="q-week" ';
      html += 'onclick="setQuick(&apos;week&apos;)">Неделя</div>';
      html += '<div class="q-btn" id="q-month" ';
      html += 'onclick="setQuick(&apos;month&apos;)">Месяц</div>';
      html += '<div class="q-btn" id="q-all" ';
      html += 'onclick="setQuick(&apos;all&apos;)">Всё</div>';
      html += '</div>';

      html += '<div class="tabs">';
      html += '<div class="tab active" id="t-fin" ';
      html += 'onclick="setTab(&apos;fin&apos;)">Финансы</div>';
      html += '<div class="tab" id="t-loss" ';
      html += 'onclick="setTab(&apos;loss&apos;)">Потери</div>';
      html += '<div class="tab" id="t-top" ';
      html += 'onclick="setTab(&apos;top&apos;)">Топ-5</div>';
      html += '<div class="tab" id="t-move" ';
      html += 'onclick="setTab(&apos;move&apos;)">Движение</div>';
      html += '</div>';

      html += '<div id="content">Загрузка...</div>';

      html += getUnifiedMenu('reports');

      html += '<script>';
      html += 'var currentTab = "fin"; var reportData = null;';
      html += 'function fmtMoney(v) { ';
      html += 'return Math.round(v).toLocaleString("ru-RU") + " ₽"; }';

      html += 'function setCustom() {';
      html += '  document.querySelectorAll(".q-btn").forEach(function(b){';
      html += '    b.classList.remove("active");});';
      html += '  loadData();';
      html += '}';

      html += 'function setQuick(type) {';
      html += '  document.querySelectorAll(".q-btn").forEach(function(b){';
      html += '    b.classList.remove("active");});';
      html += '  document.getElementById("q-" + type).classList.add("active");';
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
      html += '  loadData();';
      html += '}';

      html += 'function setTab(t) {';
      html += '  currentTab = t;';
      html += '  document.querySelectorAll(".tab").forEach(function(el){';
      html += '    el.classList.remove("active");});';
      html += '  document.getElementById("t-" + t).classList.add("active");';
      html += '  if (reportData) { renderTab(); } else { loadData(); }';
      html += '}';

      html += 'function loadData() {';
      html += '  var st = document.getElementById("dateStart").value;';
      html += '  var en = document.getElementById("dateEnd").value;';
      html += '  var url = "/api/warehouse/reports";';
      html += '  if (st && en) { url += "?start=" + st + "&end=" + en; }';
      html += '  var c = document.getElementById("content");';
      html += '  c.textContent = "Загрузка...";';
      html += '  fetch(url).then(function(r){return r.json();})';
      html += '  .then(function(d){';
      html += '    if (d.ok) { reportData = d; renderTab(); }';
      html += '    else { c.textContent = "Ошибка"; }';
      html += '  }).catch(function(){ c.textContent = "Ошибка сети"; });';
      html += '}';

      html += 'function showBarInfo(el, dateStr, sum) {';
      html += '  document.querySelectorAll(".bar").forEach(function(b){';
      html += '    b.classList.remove("active"); });';
      html += '  el.classList.add("active");';
      html += '  document.getElementById("chartInfo").textContent = ';
      html += '  dateStr + ": " + fmtMoney(sum);';
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
      html += '    lbl1.className = "lbl"; ';
      html += '    lbl1.textContent = "Выручка (чеков: " + f.count + ")";';
      html += '    card1.appendChild(v1); card1.appendChild(lbl1); ';
      html += '    c.appendChild(card1);';

      html += '    var card2 = document.createElement("div"); ';
      html += '    card2.className = "card";';
      html += '    var v2 = document.createElement("div"); ';
      html += '    v2.className = "val green"; ';
      html += '    v2.textContent = fmtMoney(f.profit);';
      html += '    var lbl2 = document.createElement("div"); ';
      html += '    lbl2.className = "lbl"; ';
      html += '    lbl2.textContent = "Прибыль (Себест: " + ';
      html += '    fmtMoney(f.cost) + ") · Маржа: " + f.margin_pct + "%";';
      html += '    card2.appendChild(v2); card2.appendChild(lbl2); ';
      html += '    c.appendChild(card2);';

      html += '    var card3 = document.createElement("div"); ';
      html += '    card3.className = "card";';
      html += '    var v3 = document.createElement("div"); ';
      html += '    v3.className = "val"; v3.style.fontSize = "18px";';
      html += '    v3.textContent = "Нал: " + fmtMoney(f.cash) + ';
      html += '    " | Карта: " + fmtMoney(f.card) + ';
      html += '    " | QR: " + fmtMoney(f.qr);';
      html += '    card3.appendChild(v3); c.appendChild(card3);';
      
      html += '    if (reportData.daily && reportData.daily.length > 0) {';
      html += '      var chartCard = document.createElement("div");';
      html += '      chartCard.className = "card";';
      html += '      var title = document.createElement("div");';
      html += '      title.style = "font-weight:800; text-align:left; ';
      html += '      margin-bottom:8px;";';
      html += '      title.textContent = "Выручка по дням";';
      html += '      chartCard.appendChild(title);';
      
      html += '      var maxVal = 0;';
      html += '      reportData.daily.forEach(function(d){ ';
      html += '        if(parseFloat(d.total) > maxVal) ';
      html += '        maxVal = parseFloat(d.total); });';
      
      html += '      var maxLbl = document.createElement("div");';
      html += '      maxLbl.style = "font-size:12px; color:#888; ';
      html += '      text-align:left; margin-bottom:16px;";';
      html += '      maxLbl.textContent = "Макс: " + fmtMoney(maxVal);';
      html += '      chartCard.appendChild(maxLbl);';
      
      html += '      var cont = document.createElement("div");';
      html += '      cont.className = "chart-container";';
      html += '      var wrap = document.createElement("div");';
      html += '      wrap.className = "chart-wrap";';
      
      html += '      reportData.daily.forEach(function(d){ ';
      html += '        var col = document.createElement("div");';
      html += '        col.className = "bar-col";';
      html += '        var bar = document.createElement("div");';
      html += '        bar.className = "bar";';
      html += '        var hPct = maxVal > 0 ? ';
      html += '        (parseFloat(d.total)/maxVal)*100 : 0;';
      html += '        bar.style.height = hPct + "%";';
      html += '        var parts = String(d.day).split("-");';
      html += '        var dayStr = parts.length === 3 ? ';
      html += '        parseInt(parts[2]) + "." + ';
      html += '        parseInt(parts[1]) : d.day;';
      html += '        bar.onclick = (function(dateStr, sum, el) { ';
      html += '          return function() { ';
      html += '            showBarInfo(el, dateStr, sum); };';
      html += '        })(dayStr, d.total, bar);';
      html += '        col.appendChild(bar);';
      html += '        var lbl = document.createElement("div");';
      html += '        lbl.className = "bar-lbl";';
      html += '        lbl.textContent = dayStr;';
      html += '        col.appendChild(lbl);';
      html += '        wrap.appendChild(col);';
      html += '      });';
      
      html += '      cont.appendChild(wrap);';
      html += '      chartCard.appendChild(cont);';
      html += '      var info = document.createElement("div");';
      html += '      info.id = "chartInfo";';
      html += '      info.className = "chart-info";';
      html += '      info.textContent = "Нажмите на столбик";';
      html += '      chartCard.appendChild(info);';
      html += '      c.appendChild(chartCard);';
      html += '    }';

      html += '  } else if (currentTab === "loss") {';
      html += '    var cardL = document.createElement("div"); ';
      html += '    cardL.className = "card"; ';
      html += '    cardL.style.border = "2px solid var(--f-accent)";';
      html += '    var vL = document.createElement("div"); ';
      html += '    vL.className = "val red"; ';
      html += '    vL.textContent = fmtMoney(l.total);';
      html += '    var lblL = document.createElement("div"); ';
      html += '    lblL.className = "lbl"; ';
      html += '    lblL.textContent = "Потери (" + l.percent + ';
      html += '    "% от закупок)";';
      html += '    cardL.appendChild(vL); cardL.appendChild(lblL); ';
      html += '    c.appendChild(cardL);';

      html += '    var reasons = { spoilage: "Порча", loss: "Потеря", ';
      html += '    markdown: "Уценка", sorting: "Пересорт" };';
      html += '    var listCard = document.createElement("div"); ';
      html += '    listCard.className = "card";';
      html += '    listCard.style.textAlign = "left";';
      html += '    for (var key in reasons) {';
      html += '      var amt = l.reasons[key] || 0;';
      html += '      if (amt > 0) {';
      html += '        var row = document.createElement("div"); ';
      html += '        row.className = "list-item";';
      html += '        var n = document.createElement("span"); ';
      html += '        n.textContent = reasons[key];';
      html += '        var v = document.createElement("span"); ';
      html += '        v.style = "font-weight:800; color:var(--f-danger);";';
      html += '        v.textContent = fmtMoney(amt);';
      html += '        row.appendChild(n); row.appendChild(v); ';
      html += '        listCard.appendChild(row);';
      html += '      }';
      html += '    }';
      html += '    c.appendChild(listCard);';

      html += '  } else if (currentTab === "top") {';
      html += '    var topCard = document.createElement("div"); ';
      html += '    topCard.className = "card";';
      html += '    topCard.style.textAlign = "left";';
      html += '    if (reportData.top.length === 0) {';
      html += '      topCard.textContent = "Нет продаж";';
      html += '      topCard.style.textAlign = "center";';
      html += '    } else {';
      html += '      reportData.top.forEach(function(t, idx) {';
      html += '        var row = document.createElement("a"); ';
      html += '        row.className = "list-item";';
      html += '        row.style.textDecoration = "none"; ';
      html += '        row.style.color = "var(--f-text)";';
      html += '        row.href = "/warehouse/item?id=" + t.shop_item_id;';
      html += '        var n = document.createElement("span"); ';
      html += '        n.textContent = (idx+1) + ". " + t.name + ';
      html += '        " (" + fmtNum(t.total_qty) + " шт) →";';
      html += '        var v = document.createElement("span"); ';
      html += '        v.style = "font-weight:800; color:var(--f-success);";';
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
      html += '    mCard.style.textAlign = "left";';
      
      html += '    var r1 = document.createElement("div"); ';
      html += '    r1.className = "list-item";';
      html += '    var n1 = document.createElement("span"); ';
      html += '    n1.textContent = "Приход (закупка)";';
      html += '    var v1 = document.createElement("span"); ';
      html += '    v1.style = "color:var(--f-success); font-weight:800;";';
      html += '    v1.textContent = fmtMoney(m.receipts);';
      html += '    r1.appendChild(n1); r1.appendChild(v1); ';
      html += '    mCard.appendChild(r1);';
      
      html += '    var r2 = document.createElement("div"); ';
      html += '    r2.className = "list-item";';
      html += '    var n2 = document.createElement("span"); ';
      html += '    n2.textContent = "Продажи (выручка)";';
      html += '    var v2 = document.createElement("span"); ';
      html += '    v2.style = "color:#3C7A89; font-weight:800;";';
      html += '    v2.textContent = fmtMoney(m.sales);';
      html += '    r2.appendChild(n2); r2.appendChild(v2); ';
      html += '    mCard.appendChild(r2);';
      
      html += '    var r3 = document.createElement("div"); ';
      html += '    r3.className = "list-item";';
      html += '    var n3 = document.createElement("span"); ';
      html += '    n3.textContent = "Списания (потери)";';
      html += '    var v3 = document.createElement("span"); ';
      html += '    v3.style = "color:var(--f-danger); font-weight:800;";';
      html += '    v3.textContent = "-" + fmtMoney(m.writeoffs);';
      html += '    r3.appendChild(n3); r3.appendChild(v3); ';
      html += '    mCard.appendChild(r3);';
      
      html += '    c.appendChild(mCard);';
      html += '  }';
      html += '}';

      html += 'setQuick("month");';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });
}

module.exports = { 
  setupWarehouseViews, 
  fmtNum, 
  translateReason, 
  esc, 
  getUnifiedMenu, 
  getIconSvg,
  metaSafari, 
  fontLink, 
  uiScript 
};