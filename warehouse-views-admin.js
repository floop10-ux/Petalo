
const pool = require('./db');
const { 
  esc, fmtNum, translateReason, getIconSvg, 
  getUnifiedMenu, metaSafari, fontLink, uiScript 
} = require('./warehouse-views-core');

function setupWarehouseAdminViews(app, bot, s3ctx, getAuth) {

  // ====== 1. ЭКРАН СМЕНЫ ======
  app.get('/warehouse/shift', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const shopId = auth.shopId;
      const chatId = auth.chatId;

      const shiftRes = await pool.query(
        'SELECT * FROM wh_shifts WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND status = \'open\' LIMIT 1',
        [shopId, chatId]
      );

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      html += '.card { padding: 24px; border-radius: var(--r-lg); }';
      html += '.stats { margin-top: 16px; font-size: 15px; }';
      html += '.stats div { display: flex; justify-content: space-between; ';
      html += 'margin-bottom: 12px; font-weight: 500; }';
      html += '.total-rev { font-size: 20px; font-weight: 800; ';
      html += 'margin-top: 16px; padding-top: 16px; ';
      html += 'border-top: 1px solid var(--f-border); }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Смена</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      if (shiftRes.rows.length === 0) {
        html += '<div class="card">';
        html += '<h3 style="margin-top:0; font-size:20px; font-weight:800; ';
        html += 'margin-bottom:8px;">Открытие смены</h3>';
        html += '<p class="text-muted" style="margin-bottom:20px;">';
        html += 'Укажите сумму наличных в кассе на начало дня.</p>';
        html += '<label>Наличные в кассе (₽)</label>';
        html += '<input type="number" id="startCash" placeholder="0">';
        html += '<button class="btn btn-primary" style="width:100%;" ';
        html += 'onclick="openShift()">Открыть смену</button></div>';
      } else {
        const shift = shiftRes.rows[0];
        const salesRes = await pool.query(
          'SELECT SUM(pay_cash) as c, SUM(pay_card) as k, ' +
          'SUM(pay_qr) as q, SUM(real_price) as t ' +
          'FROM wh_sales WHERE shop_id = $1 AND date >= $2',
          [shopId, shift.open_time]
        );
        const st = salesRes.rows[0];
        const cash = parseFloat(st.c || 0);
        const card = parseFloat(st.k || 0);
        const qr = parseFloat(st.q || 0);
        const total = parseFloat(st.t || 0);
        const start = parseFloat(shift.start_cash);

        html += '<div class="card">';
        html += '<h3 style="margin-top:0; font-size:20px; font-weight:800; ';
        html += 'margin-bottom:16px;">Смена открыта</h3>';
        html += '<div class="stats">';
        html += '<div><span>Наличные:</span> <b>' + cash + ' ₽</b></div>';
        html += '<div><span>Карта:</span> <b>' + card + ' ₽</b></div>';
        html += '<div><span>QR:</span> <b>' + qr + ' ₽</b></div>';
        html += '<div class="total-rev"><span>Выручка:</span> ';
        html += '<span>' + total + ' ₽</span></div>';
        html += '</div>';
        html += '<label style="margin-top:20px;">Фактически наличных ';
        html += 'в кассе (₽)</label>';
        html += '<input type="number" id="endCash" ';
        html += 'placeholder="' + (start + cash) + '">';
        html += '<p style="font-size:12px; color:var(--f-text-2); ';
        html += 'margin-top:-8px; margin-bottom:16px;">';
        html += 'Ожидается: ' + (start + cash) + ' ₽ ';
        html += '(Остаток + Нал)</p>';
        html += '<button class="btn btn-danger" style="width:100%;" ';
        html += 'onclick="closeShift()">Закрыть смену</button></div>';
      }

      html += getUnifiedMenu('shift');

      html += '<script>';
      html += 'function openShift() {';
      html += '  var v = document.getElementById("startCash").value || 0;';
      html += '  fetch("/api/warehouse/shift", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ action: "open", val: v }) })';
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
      html += '  if (!v) { ';
      html += '    showAlert("Внимание", "Введите сумму", false); ';
      html += '    return; }';
      html += '  fetch("/api/warehouse/shift", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ action: "close", val: v }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) { ';
      html += '      showAlert("Готово", "Смена закрыта", true); ';
      html += '      setTimeout(function() { ';
      html += '        window.location.href = "/warehouse-app"; }, 1500); ';
      html += '    } else showAlert("Ошибка", d.error, false);';
      html += '  })';
      html += '  .catch(function() {';
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false);';
      html += '  });';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) { 
      res.status(500).send('Ошибка сервера'); 
    }
  });

  // ====== 2. ЭКРАН ФЛОРИСТОВ ======
  app.get('/warehouse/staff', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.btn-invite { width: 100%; background: var(--f-success); ';
      html += 'color: #fff; border: none; padding: 16px; ';
      html += 'border-radius: var(--r-md); font-size: 16px; font-weight: 800; ';
      html += 'margin-bottom: 20px; display: flex; align-items: center; ';
      html += 'justify-content: center; gap: 8px; }';
      html += '.card { padding: 16px; border-radius: var(--r-lg); } ';
      html += '.name { font-size: 18px; font-weight: 800; margin-bottom: 4px; } ';
      html += '.sales { font-size: 15px; color: var(--f-success); ';
      html += 'font-weight: 600; }';
      html += '.row { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-top: 12px; ';
      html += 'border-top: 1px solid var(--f-border); padding-top: 12px; } ';
      html += '.row span { flex: 1; font-weight: 500; }';
      html += '.row input[type="checkbox"] { width: 24px; height: 24px; ';
      html += 'margin: 0; transform: none; accent-color: var(--f-brand); }';
      html += '.btn-pin { margin-top: 16px; padding: 10px 16px; ';
      html += 'border-radius: var(--r-md); border: 1px solid var(--f-border); ';
      html += 'background: #fff; color: var(--f-text); font-weight: 600; ';
      html += 'font-family: inherit; } ';
      html += '.btn-del { margin-top: 16px; padding: 10px 16px; ';
      html += 'border-radius: var(--r-md); border: 1px solid var(--f-danger); ';
      html += 'background: #fff; color: var(--f-danger); font-weight: 600; ';
      html += 'font-family: inherit; margin-left: 8px; } ';
      html += '</style></head><body>';
      
      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Флористы</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<button class="btn-invite" id="btnInvite" ';
      html += 'onclick="copyInvite()" style="display:none;">';
      html += '🔗 Скопировать ссылку-приглашение</button>';
      
      html += '<div id="list"></div>';

      html += getUnifiedMenu('staff');

      html += '<script>';
      html += 'var globalInvite = "";';
      html += 'fetch("/api/warehouse/staff")';
      html += '.then(function(r){return r.json();}).then(function(d){ ';
      html += '  var b = document.getElementById("list"); ';
      html += '  if (!d.ok) { ';
      html += '    b.textContent = "Ошибка доступа (только для владельца)"; ';
      html += '    return; ';
      html += '  } ';
      html += '  if (d.inviteCode) { ';
      html += '    globalInvite = "https://t.me/flowind_rus_bot?start=inv_" + ';
      html += '    d.inviteCode; ';
      html += '    document.getElementById("btnInvite").style.display = "flex"; ';
      html += '  }';
      html += '  if (!d.staff || d.staff.length === 0) { ';
      html += '    var em = document.createElement("div"); ';
      html += '    em.className = "empty-state"; ';
      html += '    var emT = document.createElement("div"); ';
      html += '    emT.className = "empty-state-title"; ';
      html += '    emT.textContent = "Нет флористов"; ';
      html += '    em.appendChild(emT); b.appendChild(em); ';
      html += '    return; }';
      
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
      html += '    pDiv.style = "font-size:13px;color:var(--f-text-2); ';
      html += '    margin-top:8px;"; ';
      html += '    pDiv.textContent = "PIN: " + (f.warehouse_pin || "нет"); ';
      html += '    c.appendChild(pDiv);';
      
      html += '    var btnWrap = document.createElement("div");';
      html += '    var btn = document.createElement("button"); ';
      html += '    btn.innerText = "Задать PIN"; btn.className = "btn-pin"; ';
      html += '    btn.onclick = function(){setPin(f.chat_id);}; ';
      html += '    btnWrap.appendChild(btn);';
      html += '    var delBtn = document.createElement("button"); ';
      html += '    delBtn.innerText = "Удалить"; delBtn.className = "btn-del"; ';
      html += '    delBtn.onclick = function(){delStaff(f.chat_id);}; ';
      html += '    btnWrap.appendChild(delBtn);';
      html += '    c.appendChild(btnWrap);';

      html += '    c.appendChild(makeCheck("Приход", "receipt", ';
      html += '    f.can_receipt, f.chat_id)); ';
      html += '    c.appendChild(makeCheck("Продажа", "sale", ';
      html += '    f.can_sale, f.chat_id)); ';
      html += '    c.appendChild(makeCheck("Списание", "writeoff", ';
      html += '    f.can_writeoff, f.chat_id)); b.appendChild(c); }); ';
      html += '}).catch(function(){ ';
      html += '  document.getElementById("list").textContent = "Ошибка сети"; ';
      html += '});';

      html += 'function copyInvite() {';
      html += '  if (!globalInvite) return;';
      html += '  if (navigator.share) {';
      html += '    navigator.share({ url: globalInvite, ';
      html += '    title: "Приглашение в Flowind", ';
      html += '    text: "Привет! Присоединяйся к складу: " })';
      html += '    .catch(function(){});';
      html += '  } else {';
      html += '    navigator.clipboard.writeText(globalInvite).then(function(){';
      html += '      showAlert("Готово", "Ссылка скопирована", true);';
      html += '    }).catch(function(){';
      html += '      showPrompt("Ссылка", "Скопируйте вручную", ';
      html += '      globalInvite, function(){});';
      html += '    });';
      html += '  }';
      html += '}';
      
      html += 'function makeCheck(label, field, checked, chatId) { ';
      html += 'var r = document.createElement("div"); r.className = "row"; ';
      html += 'var sp = document.createElement("span"); sp.textContent = label; ';
      html += 'r.appendChild(sp); var cb = document.createElement("input"); ';
      html += 'cb.type = "checkbox"; cb.checked = checked; ';
      html += 'cb.onchange = function(){setRights(chatId, field, cb.checked);}; ';
      html += 'r.appendChild(cb); return r; }';
      
      html += 'function setPin(id) { ';
      html += '  showPrompt("Новый PIN", "Введите 4 цифры", "", ';
      html += '  function(p) { ';
      html += '    if (p && p.length === 4) { ';
      html += '      fetch("/api/warehouse/florist/pin", { method: "POST", ';
      html += '      headers: { "Content-Type": "application/json" }, ';
      html += '      body: JSON.stringify({ chatId: id, pin: p }) })';
      html += '      .then(function(){location.reload();})';
      html += '      .catch(function(){}); } ';
      html += '    else if (p) showAlert("Ошибка", "Нужно 4 цифры", false); ';
      html += '  }); ';
      html += '}';

      html += 'function delStaff(id) { ';
      html += '  showConfirm("Удаление", "Уволить флориста? Он потеряет доступ.", ';
      html += '  function() {';
      html += '    fetch("/api/warehouse/florist/delete", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ chatId: id }) })';
      html += '    .then(function(){location.reload();})';
      html += '    .catch(function(){});';
      html += '  }, true);';
      html += '}';
      
      html += 'function setRights(id, field, val) { ';
      html += 'fetch("/api/warehouse/florist/rights", { method: "POST", ';
      html += 'headers: { "Content-Type": "application/json" }, ';
      html += 'body: JSON.stringify({ chatId: id, field: field, val: val }) })';
      html += '.catch(function(){}); }';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

const pool = require('./db');
const { 
  esc, fmtNum, translateReason, getIconSvg, 
  getUnifiedMenu, metaSafari, fontLink, uiScript 
} = require('./warehouse-views-core');


  // ====== 1. ЭКРАН СМЕНЫ ======
  app.get('/warehouse/shift', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const shopId = auth.shopId;
      const chatId = auth.chatId;

      const shiftRes = await pool.query(
        'SELECT * FROM wh_shifts WHERE shop_id = $1 ' +
        'AND chat_id = $2 AND status = \'open\' LIMIT 1',
        [shopId, chatId]
      );

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink;
      html += uiScript;
      html += '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      html += '.card { padding: 24px; border-radius: var(--r-lg); }';
      html += '.stats { margin-top: 16px; font-size: 15px; }';
      html += '.stats div { display: flex; justify-content: space-between; ';
      html += 'margin-bottom: 12px; font-weight: 500; }';
      html += '.total-rev { font-size: 20px; font-weight: 800; ';
      html += 'margin-top: 16px; padding-top: 16px; ';
      html += 'border-top: 1px solid var(--f-border); }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Смена</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      if (shiftRes.rows.length === 0) {
        html += '<div class="card">';
        html += '<h3 style="margin-top:0; font-size:20px; font-weight:800; ';
        html += 'margin-bottom:8px;">Открытие смены</h3>';
        html += '<p class="text-muted" style="margin-bottom:20px;">';
        html += 'Укажите сумму наличных в кассе на начало дня.</p>';
        html += '<label>Наличные в кассе (₽)</label>';
        html += '<input type="number" id="startCash" placeholder="0">';
        html += '<button class="btn btn-primary" style="width:100%;" ';
        html += 'onclick="openShift()">Открыть смену</button></div>';
      } else {
        const shift = shiftRes.rows[0];
        const salesRes = await pool.query(
          'SELECT SUM(pay_cash) as c, SUM(pay_card) as k, ' +
          'SUM(pay_qr) as q, SUM(real_price) as t ' +
          'FROM wh_sales WHERE shop_id = $1 AND date >= $2',
          [shopId, shift.open_time]
        );
        const st = salesRes.rows[0];
        const cash = parseFloat(st.c || 0);
        const card = parseFloat(st.k || 0);
        const qr = parseFloat(st.q || 0);
        const total = parseFloat(st.t || 0);
        const start = parseFloat(shift.start_cash);

        html += '<div class="card">';
        html += '<h3 style="margin-top:0; font-size:20px; font-weight:800; ';
        html += 'margin-bottom:16px;">Смена открыта</h3>';
        html += '<div class="stats">';
        html += '<div><span>Наличные:</span> <b>' + cash + ' ₽</b></div>';
        html += '<div><span>Карта:</span> <b>' + card + ' ₽</b></div>';
        html += '<div><span>QR:</span> <b>' + qr + ' ₽</b></div>';
        html += '<div class="total-rev"><span>Выручка:</span> ';
        html += '<span>' + total + ' ₽</span></div>';
        html += '</div>';
        html += '<label style="margin-top:20px;">Фактически наличных ';
        html += 'в кассе (₽)</label>';
        html += '<input type="number" id="endCash" ';
        html += 'placeholder="' + (start + cash) + '">';
        html += '<p style="font-size:12px; color:var(--f-text-2); ';
        html += 'margin-top:-8px; margin-bottom:16px;">';
        html += 'Ожидается: ' + (start + cash) + ' ₽ ';
        html += '(Остаток + Нал)</p>';
        html += '<button class="btn btn-danger" style="width:100%;" ';
        html += 'onclick="closeShift()">Закрыть смену</button></div>';
      }

      html += getUnifiedMenu('shift');

      html += '<script>';
      html += 'function openShift() {';
      html += '  var v = document.getElementById("startCash").value || 0;';
      html += '  fetch("/api/warehouse/shift", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ action: "open", val: v }) })';
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
      html += '  if (!v) { ';
      html += '    showAlert("Внимание", "Введите сумму", false); ';
      html += '    return; }';
      html += '  fetch("/api/warehouse/shift", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ action: "close", val: v }) })';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    if (d.ok) { ';
      html += '      showAlert("Готово", "Смена закрыта", true); ';
      html += '      setTimeout(function() { ';
      html += '        window.location.href = "/warehouse-app"; }, 1500); ';
      html += '    } else showAlert("Ошибка", d.error, false);';
      html += '  })';
      html += '  .catch(function() {';
      html += '    showAlert("Ошибка сети", "Проверьте интернет", false);';
      html += '  });';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch (e) { 
      res.status(500).send('Ошибка сервера'); 
    }
  });

  // ====== 2. ЭКРАН ФЛОРИСТОВ ======
  app.get('/warehouse/staff', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.btn-invite { width: 100%; background: var(--f-success); ';
      html += 'color: #fff; border: none; padding: 16px; ';
      html += 'border-radius: var(--r-md); font-size: 16px; font-weight: 800; ';
      html += 'margin-bottom: 20px; display: flex; align-items: center; ';
      html += 'justify-content: center; gap: 8px; }';
      html += '.card { padding: 16px; border-radius: var(--r-lg); } ';
      html += '.name { font-size: 18px; font-weight: 800; margin-bottom: 4px; } ';
      html += '.sales { font-size: 15px; color: var(--f-success); ';
      html += 'font-weight: 600; }';
      html += '.row { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-top: 12px; ';
      html += 'border-top: 1px solid var(--f-border); padding-top: 12px; } ';
      html += '.row span { flex: 1; font-weight: 500; }';
      html += '.row input[type="checkbox"] { width: 24px; height: 24px; ';
      html += 'margin: 0; transform: none; accent-color: var(--f-brand); }';
      html += '.btn-pin { margin-top: 16px; padding: 10px 16px; ';
      html += 'border-radius: var(--r-md); border: 1px solid var(--f-border); ';
      html += 'background: #fff; color: var(--f-text); font-weight: 600; ';
      html += 'font-family: inherit; } ';
      html += '.btn-del { margin-top: 16px; padding: 10px 16px; ';
      html += 'border-radius: var(--r-md); border: 1px solid var(--f-danger); ';
      html += 'background: #fff; color: var(--f-danger); font-weight: 600; ';
      html += 'font-family: inherit; margin-left: 8px; } ';
      html += '</style></head><body>';
      
      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Флористы</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<button class="btn-invite" id="btnInvite" ';
      html += 'onclick="copyInvite()" style="display:none;">';
      html += '🔗 Скопировать ссылку-приглашение</button>';
      
      html += '<div id="list"></div>';

      html += getUnifiedMenu('staff');

      html += '<script>';
      html += 'var globalInvite = "";';
      html += 'fetch("/api/warehouse/staff")';
      html += '.then(function(r){return r.json();}).then(function(d){ ';
      html += '  var b = document.getElementById("list"); ';
      html += '  if (!d.ok) { ';
      html += '    b.textContent = "Ошибка доступа (только для владельца)"; ';
      html += '    return; ';
      html += '  } ';
      html += '  if (d.inviteCode) { ';
      html += '    globalInvite = "https://t.me/flowind_rus_bot?start=inv_" + ';
      html += '    d.inviteCode; ';
      html += '    document.getElementById("btnInvite").style.display = "flex"; ';
      html += '  }';
      html += '  if (!d.staff || d.staff.length === 0) { ';
      html += '    var em = document.createElement("div"); ';
      html += '    em.className = "empty-state"; ';
      html += '    var emT = document.createElement("div"); ';
      html += '    emT.className = "empty-state-title"; ';
      html += '    emT.textContent = "Нет флористов"; ';
      html += '    em.appendChild(emT); b.appendChild(em); ';
      html += '    return; }';
      
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
      html += '    pDiv.style = "font-size:13px;color:var(--f-text-2); ';
      html += '    margin-top:8px;"; ';
      html += '    pDiv.textContent = "PIN: " + (f.warehouse_pin || "нет"); ';
      html += '    c.appendChild(pDiv);';
      
      html += '    var btnWrap = document.createElement("div");';
      html += '    var btn = document.createElement("button"); ';
      html += '    btn.innerText = "Задать PIN"; btn.className = "btn-pin"; ';
      html += '    btn.onclick = function(){setPin(f.chat_id);}; ';
      html += '    btnWrap.appendChild(btn);';
      html += '    var delBtn = document.createElement("button"); ';
      html += '    delBtn.innerText = "Удалить"; delBtn.className = "btn-del"; ';
      html += '    delBtn.onclick = function(){delStaff(f.chat_id);}; ';
      html += '    btnWrap.appendChild(delBtn);';
      html += '    c.appendChild(btnWrap);';

      html += '    c.appendChild(makeCheck("Приход", "receipt", ';
      html += '    f.can_receipt, f.chat_id)); ';
      html += '    c.appendChild(makeCheck("Продажа", "sale", ';
      html += '    f.can_sale, f.chat_id)); ';
      html += '    c.appendChild(makeCheck("Списание", "writeoff", ';
      html += '    f.can_writeoff, f.chat_id)); b.appendChild(c); }); ';
      html += '}).catch(function(){ ';
      html += '  document.getElementById("list").textContent = "Ошибка сети"; ';
      html += '});';

      html += 'function copyInvite() {';
      html += '  if (!globalInvite) return;';
      html += '  if (navigator.share) {';
      html += '    navigator.share({ url: globalInvite, ';
      html += '    title: "Приглашение в Flowind", ';
      html += '    text: "Привет! Присоединяйся к складу: " })';
      html += '    .catch(function(){});';
      html += '  } else {';
      html += '    navigator.clipboard.writeText(globalInvite).then(function(){';
      html += '      showAlert("Готово", "Ссылка скопирована", true);';
      html += '    }).catch(function(){';
      html += '      showPrompt("Ссылка", "Скопируйте вручную", ';
      html += '      globalInvite, function(){});';
      html += '    });';
      html += '  }';
      html += '}';
      
      html += 'function makeCheck(label, field, checked, chatId) { ';
      html += 'var r = document.createElement("div"); r.className = "row"; ';
      html += 'var sp = document.createElement("span"); sp.textContent = label; ';
      html += 'r.appendChild(sp); var cb = document.createElement("input"); ';
      html += 'cb.type = "checkbox"; cb.checked = checked; ';
      html += 'cb.onchange = function(){setRights(chatId, field, cb.checked);}; ';
      html += 'r.appendChild(cb); return r; }';
      
      html += 'function setPin(id) { ';
      html += '  showPrompt("Новый PIN", "Введите 4 цифры", "", ';
      html += '  function(p) { ';
      html += '    if (p && p.length === 4) { ';
      html += '      fetch("/api/warehouse/florist/pin", { method: "POST", ';
      html += '      headers: { "Content-Type": "application/json" }, ';
      html += '      body: JSON.stringify({ chatId: id, pin: p }) })';
      html += '      .then(function(){location.reload();})';
      html += '      .catch(function(){}); } ';
      html += '    else if (p) showAlert("Ошибка", "Нужно 4 цифры", false); ';
      html += '  }); ';
      html += '}';

      html += 'function delStaff(id) { ';
      html += '  showConfirm("Удаление", "Уволить флориста? Он потеряет доступ.", ';
      html += '  function() {';
      html += '    fetch("/api/warehouse/florist/delete", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ chatId: id }) })';
      html += '    .then(function(){location.reload();})';
      html += '    .catch(function(){});';
      html += '  }, true);';
      html += '}';
      
      html += 'function setRights(id, field, val) { ';
      html += 'fetch("/api/warehouse/florist/rights", { method: "POST", ';
      html += 'headers: { "Content-Type": "application/json" }, ';
      html += 'body: JSON.stringify({ chatId: id, field: field, val: val }) })';
      html += '.catch(function(){}); }';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });
// ====== 6. ЭКРАН БУКЕТОВ (СПИСОК) ======
  app.get('/warehouse/bouquets', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.btn-add { width: 100%; background: var(--f-brand); ';
      html += 'color: #fff; border: none; padding: 16px; ';
      html += 'border-radius: var(--r-md); font-size: 16px; font-weight: 800; ';
      html += 'margin-bottom: 20px; box-shadow: 0 4px 12px rgba(6,76,73,0.2); }';
      
      html += '.search { width: 100%; padding: 14px 16px; border: none; ';
      html += 'border-radius: var(--r-md); margin-bottom: 16px; ';
      html += 'box-sizing: border-box; font-family: inherit; ';
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
      
      html += '.filters { display: flex; gap: 8px; margin-bottom: 16px; ';
      html += 'overflow-x: auto; padding-bottom: 4px; }';
      html += '.filters::-webkit-scrollbar { display: none; }';
      html += '.f-btn { padding: 8px 16px; border-radius: 20px; ';
      html += 'background: #fff; border: 1px solid var(--f-border); ';
      html += 'font-size: 14px; font-weight: 600; cursor: pointer; ';
      html += 'color: var(--f-text); white-space: nowrap; }';
      html += '.f-btn.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); }';

      html += '.b-grid { display: grid; ';
      html += 'grid-template-columns: repeat(2, minmax(0, 1fr)); ';
      html += 'gap: 12px; align-items: stretch; }';
      
      html += '.b-card-grid { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 12px; display: flex; flex-direction: column; ';
      html += 'height: 100%; box-shadow: var(--sh-1); min-width: 0; }';
      
      html += '.b-img-grid { width: 100%; aspect-ratio: 1; ';
      html += 'border-radius: var(--r-md); object-fit: cover; ';
      html += 'background: #F0F4F4; margin-bottom: 8px; }';
      html += '.b-ph-grid { width: 100%; aspect-ratio: 1; ';
      html += 'border-radius: var(--r-md); background: #F0F4F4; ';
      html += 'display: flex; align-items: center; justify-content: center; ';
      html += 'margin-bottom: 8px; }';
      html += '.b-ph-grid svg { width: 32px; height: 32px; color: #A0B4B4; }';
      
      html += '.b-list { display: flex; flex-direction: column; gap: 10px; }';
      html += '.b-card-list { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 16px; display: flex; align-items: flex-start; gap: 16px; ';
      html += 'box-shadow: var(--sh-1); min-width: 0; }';
      html += '.b-img-list { width: 72px; height: 72px; ';
      html += 'border-radius: var(--r-md); object-fit: cover; ';
      html += 'background: #F0F4F4; flex-shrink: 0; }';
      html += '.b-ph-list { width: 72px; height: 72px; ';
      html += 'border-radius: var(--r-md); background: #F0F4F4; ';
      html += 'display: flex; align-items: center; justify-content: center; ';
      html += 'flex-shrink: 0; }';
      html += '.b-ph-list svg { width: 32px; height: 32px; color: #A0B4B4; }';
      
      html += '.b-info { flex: 1; min-width: 0; display: flex; ';
      html += 'flex-direction: column; }';
      html += '.b-name { font-size: 15px; font-weight: 800; ';
      html += 'margin-bottom: 4px; word-break: break-word; }';
      html += '.b-price { font-size: 14px; color: var(--f-success); ';
      html += 'font-weight: 600; margin-bottom: 8px; }';
      html += '.b-recipe { font-size: 12px; color: var(--f-text-2); ';
      html += 'margin-bottom: 8px; line-height: 1.3; }';
      
      html += '.badge-preorder { display: inline-block; ';
      html += 'background: #FFF0EC; color: #E1846D; ';
      html += 'font-size: 10px; font-weight: 800; padding: 2px 6px; ';
      html += 'border-radius: 4px; margin-bottom: 6px; }';
      
      html += '.switch { position: relative; display: inline-block; ';
      html += 'width: 44px; height: 24px; margin-bottom: 8px; }';
      html += '.switch input { opacity: 0; width: 0; height: 0; }';
      html += '.slider { position: absolute; cursor: pointer; top: 0; ';
      html += 'left: 0; right: 0; bottom: 0; background-color: #ccc; ';
      html += 'transition: .3s; border-radius: 24px; }';
      html += '.slider:before { position: absolute; content: ""; ';
      html += 'height: 18px; width: 18px; left: 3px; bottom: 3px; ';
      html += 'background-color: white; transition: .3s; ';
      html += 'border-radius: 50%; box-shadow: var(--sh-1); }';
      html += 'input:checked + .slider { ';
      html += 'background-color: var(--f-success); }';
      html += 'input:checked + .slider:before { ';
      html += 'transform: translateX(20px); }';
      
      html += '.btn-setup { background: #F0F4F4; color: var(--f-text); ';
      html += 'border: none; padding: 10px 12px; border-radius: var(--r-sm); ';
      html += 'font-weight: 600; font-family: inherit; font-size: 13px; ';
      html += 'margin-top: auto; display: flex; align-items: center; ';
      html += 'justify-content: center; gap: 6px; }';
      html += '.deleted-item { opacity: 0.6; }';
      html += '</style></head><body>';
      
      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Букеты</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<button class="btn-add" onclick="window.location.href=';
      html += '\'/warehouse/bouquet/edit\'">+ Создать новый букет</button>';

      html += '<input type="text" class="search" id="search" ';
      html += 'placeholder="Поиск по названию..." oninput="render()">';

      html += '<div class="controls">';
      html += '  <div class="view-toggles">';
      html += '    <button class="view-btn active" id="btn-v-grid" ';
      html += 'onclick="setView(\'grid\')"><svg viewBox="0 0 24 24" ';
      html += 'fill="none" stroke="currentColor" stroke-width="2">';
      html += '<rect x="3" y="3" width="7" height="7"/>';
      html += '<rect x="14" y="3" width="7" height="7"/>';
      html += '<rect x="14" y="14" width="7" height="7"/>';
      html += '<rect x="3" y="14" width="7" height="7"/></svg></button>';
      html += '    <button class="view-btn" id="btn-v-list" ';
      html += 'onclick="setView(\'list\')"><svg viewBox="0 0 24 24" ';
      html += 'fill="none" stroke="currentColor" stroke-width="2">';
      html += '<line x1="8" y1="6" x2="21" y2="6"/>';
      html += '<line x1="8" y1="12" x2="21" y2="12"/>';
      html += '<line x1="8" y1="18" x2="21" y2="18"/>';
      html += '<line x1="3" y1="6" x2="3.01" y2="6"/>';
      html += '<line x1="3" y1="12" x2="3.01" y2="12"/>';
      html += '<line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>';
      html += '  </div>';
      html += '</div>';

      html += '<div class="filters">';
      html += '<button class="f-btn active" id="f-all" ';
      html += 'onclick="setFilter(\'all\')">Все</button>';
      html += '<button class="f-btn" id="f-active" ';
      html += 'onclick="setFilter(\'active\')">На витрине</button>';
      html += '<button class="f-btn" id="f-inactive" ';
      html += 'onclick="setFilter(\'inactive\')">Сняты</button>';
      html += '<button class="f-btn" id="f-deleted" ';
      html += 'onclick="setFilter(\'deleted\')">В корзине</button>';
      html += '</div>';

      html += '<div id="list" class="b-grid">Загрузка...</div>';

      html += getUnifiedMenu('bouquets');

      html += '<script>';
      html += 'var allBouquets = []; var currentView = "grid"; ';
      html += 'var currentFilter = "all";';
      
      html += 'var svgPh = "<div style=background:#D8E4E4;';
      html += 'width:40px;height:40px;border-radius:50%>';
      html += '</div>";';

      html += 'if (localStorage.getItem("wh_bq_view")) { ';
      html += 'currentView = localStorage.getItem("wh_bq_view"); }';
      
      html += 'function setView(v) { ';
      html += 'currentView = v; localStorage.setItem("wh_bq_view", v); ';
      html += 'updateViewBtns(); render(); }';
      
      html += 'function updateViewBtns() {';
      html += '  document.getElementById("btn-v-grid")';
      html += '  .classList.remove("active");';
      html += '  document.getElementById("btn-v-list")';
      html += '  .classList.remove("active");';
      html += '  document.getElementById("btn-v-" + currentView)';
      html += '  .classList.add("active");';
      html += '  document.getElementById("list").className = ';
      html += '  currentView === "grid" ? "b-grid" : "b-list";';
      html += '}';
      html += 'updateViewBtns();';

      html += 'function setFilter(f) {';
      html += '  currentFilter = f;';
      html += '  document.querySelectorAll(".f-btn").forEach(function(b){';
      html += '    b.classList.remove("active");});';
      html += '  document.getElementById("f-" + f).classList.add("active");';
      html += '  render();';
      html += '}';

      html += 'fetch("/api/warehouse/bouquets/all")';
      html += '.then(function(r){return r.json();}).then(function(d){ ';
      html += '  if (d.ok) { allBouquets = d.bouquets; render(); }';
      html += '  else { ';
      html += '    var g = document.getElementById("list");';
      html += '    g.textContent = "Ошибка: " + (d.error || "API");';
      html += '  }';
      html += '}).catch(function(e){ ';
      html += '  var g = document.getElementById("list");';
      html += '  g.textContent = "Сеть: " + e.message;';
      html += '});';

      html += 'function render() {';
      html += '  var container = document.getElementById("list");';
      html += '  while(container.firstChild) ';
      html += '  container.removeChild(container.firstChild);';
      html += '  var q = document.getElementById("search").value.toLowerCase();';
      
      html += '  var filtered = allBouquets.filter(function(b) {';
      html += '    var matchQ = b.name.toLowerCase().includes(q);';
      html += '    var matchF = true;';
      html += '    if (currentFilter === "active") ';
      html += '      matchF = (b.wh_linked && !b.deleted);';
      html += '    if (currentFilter === "inactive") ';
      html += '      matchF = (!b.wh_linked && !b.deleted);';
      html += '    if (currentFilter === "deleted") matchF = b.deleted;';
      html += '    if (currentFilter === "all") matchF = !b.deleted;';
      html += '    return matchQ && matchF;';
      html += '  });';
      
      html += '  if (filtered.length === 0) { ';
      html += '    var em = document.createElement("div"); ';
      html += '    em.style = "grid-column:1/-1; text-align:center; ';
      html += '    padding:20px; color:var(--f-text-2);";';
      html += '    em.textContent = "Ничего не найдено"; ';
      html += '    container.appendChild(em); return; }';

      html += '  filtered.forEach(function(bq) {';
      html += '    var card = document.createElement("div"); ';
      html += '    card.className = currentView === "grid" ? ';
      html += '    "b-card-grid" : "b-card-list";';
      html += '    if (bq.deleted) card.classList.add("deleted-item");';
      
      html += '    if (bq.photo_url) { ';
      html += '      var img = document.createElement("img"); ';
      html += '      img.className = currentView === "grid" ? ';
      html += '      "b-img-grid" : "b-img-list";';
      html += '      img.src = bq.photo_url; card.appendChild(img); } ';
      html += '    else { ';
      html += '      var ph = document.createElement("div"); ';
      html += '      ph.className = currentView === "grid" ? ';
      html += '      "b-ph-grid" : "b-ph-list";';
      html += '      ph.innerHTML = svgPh; card.appendChild(ph); }';
      
      html += '    var info = document.createElement("div"); ';
      html += '    info.className = "b-info";';
      
      html += '    if (bq.preorder_only) {';
      html += '      var poBadge = document.createElement("div");';
      html += '      poBadge.className = "badge-preorder";';
      html += '      poBadge.textContent = "Только предзаказ";';
      html += '      info.appendChild(poBadge);';
      html += '    }';
      
      html += '    var name = document.createElement("div"); ';
      html += '    name.className = "b-name"; name.textContent = bq.name; ';
      html += '    info.appendChild(name);';
      html += '    var price = document.createElement("div"); ';
      html += '    price.className = "b-price"; ';
      html += '    price.textContent = parseFloat(bq.price || 0)';
      html += '    .toLocaleString("ru-RU") + " ₽"; info.appendChild(price);';
      
      html += '    if (bq.recipe_text) {';
      html += '      var rec = document.createElement("div");';
      html += '      rec.className = "b-recipe";';
      html += '      rec.textContent = bq.recipe_text;';
      html += '      info.appendChild(rec);';
      html += '    }';
      
      html += '    if (!bq.deleted) {';
      html += '      var sw = document.createElement("label"); ';
      html += '      sw.className = "switch";';
      html += '      var cb = document.createElement("input"); ';
      html += '      cb.type = "checkbox"; ';
      html += '      cb.checked = bq.wh_linked; ';
      html += '      cb.onchange = function(){toggleLink(bq.id, cb.checked, bq);}; ';
      html += '      sw.appendChild(cb);';
      html += '      var sl = document.createElement("span"); ';
      html += '      sl.className = "slider"; sw.appendChild(sl); ';
      html += '      info.appendChild(sw);';
      html += '    }';
      
      html += '    var btnRow = document.createElement("div"); ';
      html += '    btnRow.style.cssText = ';
      html += '    "display:flex; gap:6px; margin-top:auto;";';
      
      html += '    if (bq.deleted) {';
      html += '      var btnRestore = document.createElement("button"); ';
      html += '      btnRestore.className = "btn-setup"; ';
      html += '      btnRestore.style.cssText = ';
      html += '      "flex:1; color:var(--f-success);";';
      html += '      btnRestore.innerHTML = "Восстановить"; ';
      html += '      btnRestore.onclick = function() { restoreBouquet(bq.id); }; ';
      html += '      btnRow.appendChild(btnRestore);';
      html += '    } else {';
      html += '      var btnEdit = document.createElement("button"); ';
      html += '      btnEdit.className = "btn-setup"; ';
      html += '      btnEdit.style.cssText = "flex:1;";';
      html += '      btnEdit.innerHTML = "Изм."; ';
      html += '      btnEdit.onclick = function() { ';
      html += '        window.location.href = "/warehouse/bouquet/edit?id=" ';
      html += '        + bq.id; }; ';
      html += '      btnRow.appendChild(btnEdit);';
      
      html += '      var btnSetup = document.createElement("button"); ';
      html += '      btnSetup.className = "btn-setup"; ';
      html += '      btnSetup.style.cssText = ';
      html += '      "flex:2; color:var(--f-brand); font-weight:700;";';
      html += '      btnSetup.textContent = "Рецепт"; ';
      html += '      btnSetup.onclick = function() { ';
      html += '        window.location.href = "/warehouse/bouquet/edit?id=" ';
      html += '        + bq.id; }; ';
      html += '      btnRow.appendChild(btnSetup);';
      
      html += '      var btnDel = document.createElement("button"); ';
      html += '      btnDel.className = "btn-setup"; ';
      html += '      btnDel.style.cssText = "flex:1; color:var(--f-danger);";';
      html += '      btnDel.innerHTML = "Удал."; ';
      html += '      btnDel.onclick = function() { delBouquet(bq.id); }; ';
      html += '      btnRow.appendChild(btnDel);';
      html += '    }';
      
      html += '    info.appendChild(btnRow);';
      html += '    card.appendChild(info); container.appendChild(card);';
      html += '  });';
      html += '}';

      html += 'function toggleLink(id, val, bq) { ';
      html += 'fetch("/api/warehouse/bouquet/toggle", { method: "POST", ';
      html += 'headers: { "Content-Type": "application/json" }, ';
      html += 'body: JSON.stringify({ id: id, val: val }) })';
      html += '.then(function(r){return r.json();}).then(function(d){ ';
      html += '  if (d.ok) { ';
      html += '    bq.wh_linked = val; render();';
      html += '    if (val) { ';
      html += '      showAlert("Готово", "Букет добавлен в Кассу", true); ';
      html += '    } ';
      html += '  } else { ';
      html += '    showAlert("Ошибка", "Не удалось сохранить", false); ';
      html += '    render();';
      html += '  } ';
      html += '}).catch(function(){ ';
      html += '  showAlert("Ошибка сети", "Проверьте интернет", false); ';
      html += '  render();';
      html += '}); }';

      html += 'function delBouquet(id) {';
      html += '  showConfirm("Удаление", "Удалить букет в корзину?", ';
      html += '  function() {';
      html += '    fetch("/api/warehouse/bouquet/delete", { method: "POST", ';
      html += '    headers: { "Content-Type": "application/json" }, ';
      html += '    body: JSON.stringify({ id: id }) })';
      html += '    .then(function(r){return r.json();}).then(function(d){';
      html += '      if (d.ok) location.reload();';
      html += '      else showAlert("Ошибка", d.error, false);';
      html += '    }).catch(function(){});';
      html += '  }, true);';
      html += '}';

      html += 'function restoreBouquet(id) {';
      html += '  fetch("/api/warehouse/bouquet/restore", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ id: id }) })';
      html += '  .then(function(r){return r.json();}).then(function(d){';
      html += '    if (d.ok) location.reload();';
      html += '    else showAlert("Ошибка", d.error, false);';
      html += '  }).catch(function(){});';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 7. ЭКРАН РЕДАКТИРОВАНИЯ БУКЕТА ======
  app.get('/warehouse/bouquet/edit', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      const bId = req.query.id ? parseInt(req.query.id) : 0;
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.card { padding: 20px; border-radius: var(--r-lg); ';
      html += 'margin-bottom: 16px; }';
      html += 'label { display: block; font-size: 13px; ';
      html += 'color: var(--f-text-2); margin-bottom: 6px; font-weight: 600; }';
      
      html += '.btn-save { width: 100%; background: var(--f-success); ';
      html += 'color: #fff; border: none; padding: 16px; ';
      html += 'border-radius: var(--r-md); font-size: 16px; font-weight: 800; ';
      html += 'margin-top: 16px; }';
      html += '.img-preview { width: 120px; height: 120px; ';
      html += 'border-radius: 12px; object-fit: cover; display: none; ';
      html += 'margin-bottom: 16px; }';
      
      html += '.recipe-block { display: none; margin-top: 16px; ';
      html += 'border-top: 2px dashed var(--f-border); padding-top: 16px; }';
      html += '.b-row { display: flex; flex-direction: column; ';
      html += 'margin-bottom: 12px; padding-bottom: 12px; ';
      html += 'border-bottom: 1px solid #eee; }';
      html += '.b-main { display: flex; justify-content: space-between; ';
      html += 'align-items: center; font-size: 15px; font-weight: 700; }';
      html += '.b-controls { display: flex; gap: 6px; align-items: center; }';
      html += '.qty-btn { background: #F0F4F4; border: none; width: 28px; ';
      html += 'height: 28px; border-radius: 8px; font-weight: bold; ';
      html += 'font-size: 14px; color: var(--f-text); }';
      
      html += '.qty-input { width: 60px !important; height: 28px; ';
      html += 'font-size: 14px; margin: 0; padding: 0; text-align: center; }';
      
      html += '.btn-add-raw { width: 100%; background: var(--f-brand); ';
      html += 'color: #fff; border: none; padding: 12px; ';
      html += 'border-radius: var(--r-md); font-weight: 800; font-size: 14px; ';
      html += 'margin-top: 12px; transition: 0.2s; }';
      html += '.btn-add-raw.alt-mode { background: #E1846D; }';

      html += '.alt-box { margin-top: 8px; padding: 10px; ';
      html += 'background: #FFF8E1; border-radius: 8px; ';
      html += 'border: 1px dashed #FFE082; }';
      html += '.alt-title { font-size: 11px; font-weight: 800; ';
      html += 'color: #F57F17; margin-bottom: 6px; }';
      html += '.alt-item { display: flex; justify-content: space-between; ';
      html += 'font-size: 13px; margin-bottom: 4px; color: #555; }';
      html += '.btn-add-alt { background: none; border: none; ';
      html += 'color: #E1846D; font-size: 12px; font-weight: 700; ';
      html += 'cursor: pointer; padding: 0; margin-top: 4px; }';

      html += '.dropdown-wrap { position: relative; }';
      html += '.dropdown-list { position: absolute; top: 100%; left: 0; ';
      html += 'right: 0; background: #fff; border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); margin-top: -8px; z-index: 100; ';
      html += 'box-shadow: var(--sh-2); max-height: 200px; ';
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
      html += '<a href="/warehouse/bouquets" class="back-btn">←</a>';
      html += '<h2 class="page-title" id="pageTitle">Новый букет</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<div class="card">';
      html += '<label>Название</label>';
      html += '<input type="text" id="bqName" placeholder="Розы 51">';
      html += '<label>Цена (₽)</label>';
      html += '<input type="number" id="bqPrice" placeholder="3500">';
      html += '<label>Фото</label>';
      html += '<input type="file" id="bqPhoto" accept="image/*" ';
      html += 'onchange="uploadPhoto(this)" style="padding:8px;">';
      html += '<img id="bqPreview" class="img-preview">';
      html += '<input type="hidden" id="bqPhotoUrl" value="">';
      
      html += '<label style="display:flex; align-items:center; gap:10px; ';
      html += 'margin-top:20px; font-weight:800; font-size:15px; ';
      html += 'cursor:pointer;">';
      html += '<input type="checkbox" id="bqLinked" ';
      html += 'onchange="toggleRecipe()" ';
      html += 'style="width:24px; height:24px; margin:0; ';
      html += 'accent-color:var(--f-brand);"> ';
      html += 'Привязать к складу (Рецепт)</label>';
      
      html += '<label style="display:flex; align-items:center; gap:10px; ';
      html += 'margin-top:12px; font-weight:800; font-size:15px; ';
      html += 'cursor:pointer; color:#E1846D;">';
      html += '<input type="checkbox" id="bqPreorder" ';
      html += 'style="width:24px; height:24px; margin:0; ';
      html += 'accent-color:#E1846D;"> ';
      html += 'Только предзаказ (держать на витрине)</label>';
      
      html += '<div class="recipe-block" id="recipeSection">';
      html += '<h3 style="margin-top:0; font-size:16px; font-weight:800; ';
      html += 'margin-bottom:12px;">Состав:</h3>';
      html += '<div id="recipeList"></div>';
      
      html += '<div style="margin-top:16px; background:#fafaf8; ';
      html += 'padding:12px; border-radius:var(--r-md);">';
      
      html += '<div id="altIndicator" style="display:none; ';
      html += 'background:#FFF0EC; color:#E1846D; padding:8px; ';
      html += 'border-radius:8px; font-size:12px; font-weight:700; ';
      html += 'margin-bottom:8px; text-align:center;">';
      html += 'Выберите замену для: <span id="altIndicatorName"></span>';
      html += '<br><button onclick="cancelAlt()" style="background:none; ';
      html += 'border:none; color:red; text-decoration:underline; ';
      html += 'font-size:12px; margin-top:4px;">Отмена</button></div>';

      html += '<label>Поиск по складу</label>';
      html += '<div class="dropdown-wrap">';
      html += '<input type="text" id="searchItem" ';
      html += 'oninput="onSearchInput()" ';
      html += 'placeholder="Начните вводить..." autocomplete="off">';
      html += '<button class="clear-search" id="clearSearch" ';
      html += 'onclick="clearSearchText()">✕</button>';
      html += '<div class="dropdown-list" id="ddList"></div>';
      html += '</div>';
      
      html += '<label>Количество</label>';
      html += '<input type="number" id="qtyAdd" placeholder="1" step="0.1" ';
      html += 'inputmode="decimal">';
      
      html += '<button class="btn-add-raw" id="btnAdd" ';
      html += 'onclick="addItem()">';
      html += '+ Добавить ингредиент</button>';
      html += '</div></div>';

      html += '<button class="btn-save" id="btnSave" ';
      html += 'onclick="saveAll()">';
      html += 'Сохранить букет</button>';
      html += '</div>';

      html += getUnifiedMenu('bouquets');
      html += '<script>';
      html += 'var bId = ' + bId + ';';
      html += 'var catalog = [];';
      html += 'var recipe = [];'; 
      html += 'var selectedItem = null;';
      html += 'var activeAltIndex = null;'; 

      html += 'if (bId > 0) { ';
      html += '  document.getElementById("pageTitle").textContent = ';
      html += '  "Редактирование";';
      html += '  fetch("/api/warehouse/bouquets/info?id=" + bId)';
      html += '  .then(function(r){return r.json();}).then(function(d){';
      html += '    if (d.ok) {';
      html += '      document.getElementById("bqName").value = ';
      html += '      d.bouquet.name;';
      html += '      document.getElementById("bqPrice").value = ';
      html += '      d.bouquet.price;';
      html += '      if (d.bouquet.wh_linked) {';
      html += '        document.getElementById("bqLinked").checked = true;';
      html += '        toggleRecipe();';
      html += '      }';
      html += '      if (d.bouquet.preorder_only) {';
      html += '        document.getElementById("bqPreorder").checked = true;';
      html += '      }';
      html += '      if (d.bouquet.photos && d.bouquet.photos.length > 0) {';
      html += '        var p = d.bouquet.photos[0];';
      html += '        var url = (typeof p === "string") ? p : ';
      html += '        (p.s3 || p.s3b);';
      html += '        if (url) {';
      html += '          document.getElementById("bqPhotoUrl").value = url;';
      html += '          var img = document.getElementById("bqPreview");';
      html += '          img.src = url; img.style.display = "block";';
      html += '        }';
      html += '      }';
      html += '    }';
      html += '  }).catch(function(){});';

      html += '  fetch("/api/warehouse/bouquets/recipe?id=" + bId)';
      html += '  .then(function(r){return r.json();}).then(function(d){ ';
      html += '    if (d.ok) { ';
      html += '      recipe = d.items.map(function(it){';
      html += '        it.alternatives = it.alternatives || [];';
      html += '        return it;';
      html += '      });';
      html += '      renderRecipe(); ';
      html += '    } ';
      html += '  });';
      html += '}';

      html += 'fetch("/api/warehouse/items")';
      html += '.then(function(r){return r.json();}).then(function(d){ ';
      html += '  if (d.ok) catalog = d.items; ';
      html += '});';

      html += 'function toggleRecipe() {';
      html += '  var isChecked = document.getElementById("bqLinked").checked;';
      html += '  document.getElementById("recipeSection").style.display = ';
      html += '  isChecked ? "block" : "none";';
      html += '}';

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
      html += '    st.style.cssText = s > 0 ? ';
      html += '    "color:var(--f-success)" : "color:var(--f-danger)";';
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
      html += '  document.getElementById("clearSearch").style.display = ';
      html += '  "none";';
      html += '  document.getElementById("ddList").style.display = "none";';
      html += '  selectedItem = null;';
      html += '}';

      html += 'function addItem() {';
      html += '  if (!selectedItem) { ';
      html += '    showAlert("Внимание", "Выберите товар", false); return; }';
      
      html += '  if (activeAltIndex !== null) {';
      html += '    recipe[activeAltIndex].alternatives.push({';
      html += '      shop_item_id: selectedItem.id,';
      html += '      name: selectedItem.name';
      html += '    });';
      html += '    cancelAlt();';
      html += '    renderRecipe();';
      html += '    return;';
      html += '  }';
      
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
      html += '      qty: q, unit: selectedItem.unit || "шт", ';
      html += '      alternatives: [] }); ';
      html += '  }';
      html += '  clearSearchText();';
      html += '  document.getElementById("qtyAdd").value = "";';
      html += '  renderRecipe();';
      html += '}';

      html += 'function startAlt(idx) {';
      html += '  activeAltIndex = idx;';
      html += '  var name = recipe[idx].name;';
      html += '  document.getElementById("altIndicatorName")';
      html += '  .textContent = name;';
      html += '  document.getElementById("altIndicator")';
      html += '  .style.display = "block";';
      html += '  var btn = document.getElementById("btnAdd");';
      html += '  btn.innerText = "+ Добавить как замену";';
      html += '  btn.classList.add("alt-mode");';
      html += '  document.getElementById("searchItem").focus();';
      html += '}';

      html += 'function cancelAlt() {';
      html += '  activeAltIndex = null;';
      html += '  document.getElementById("altIndicator")';
      html += '  .style.display = "none";';
      html += '  var btn = document.getElementById("btnAdd");';
      html += '  btn.innerText = "+ Добавить ингредиент";';
      html += '  btn.classList.remove("alt-mode");';
      html += '  clearSearchText();';
      html += '}';

      html += 'function renderRecipe() {';
      html += '  var list = document.getElementById("recipeList");';
      html += '  while(list.firstChild) list.removeChild(list.firstChild);';
      html += '  if (recipe.length === 0) { ';
      html += '    list.textContent = "Состав пуст."; ';
      html += '    return; }';
      
      html += '  recipe.forEach(function(item, idx) {';
      html += '    var div = document.createElement("div"); ';
      html += '    div.className = "b-row";';
      
      html += '    var mainDiv = document.createElement("div"); ';
      html += '    mainDiv.className = "b-main";';
      html += '    var n = document.createElement("div"); ';
      html += '    n.textContent = item.name;';
      html += '    var ctrl = document.createElement("div"); ';
      html += '    ctrl.className = "b-controls";';
      
      html += '    var mn = document.createElement("button"); ';
      html += '    mn.textContent = "-"; mn.className = "qty-btn"; ';
      html += '    mn.onclick = function() { changeQty(idx, -1); };';
      
      html += '    var inp = document.createElement("input"); ';
      html += '    inp.type = "number"; inp.className = "qty-input"; ';
      html += '    inp.value = item.qty; inp.step = "0.1";';
      html += '    inp.onchange = function() { ';
      html += '      var val = parseFloat(this.value); ';
      html += '      if (!isNaN(val) && val > 0) { ';
      html += '        recipe[idx].qty = val; ';
      html += '      } else { renderRecipe(); }';
      html += '    };';
      
      html += '    var pl = document.createElement("button"); ';
      html += '    pl.textContent = "+"; pl.className = "qty-btn"; ';
      html += '    pl.onclick = function() { changeQty(idx, 1); };';
      
      html += '    var del = document.createElement("span"); ';
      html += '    del.textContent = "✕"; ';
      html += '    del.style.cssText = "color:red; cursor:pointer; ';
      html += '    font-size:18px; margin-left:10px;";';
      html += '    del.onclick = function() { ';
      html += '      recipe.splice(idx, 1); renderRecipe(); ';
      html += '    };';
      
      html += '    ctrl.appendChild(mn); ctrl.appendChild(inp); ';
      html += '    ctrl.appendChild(pl); ctrl.appendChild(del);';
      html += '    mainDiv.appendChild(n); mainDiv.appendChild(ctrl);';
      html += '    div.appendChild(mainDiv);';

      html += '    var altBox = document.createElement("div");';
      html += '    altBox.className = "alt-box";';
      html += '    var altTitle = document.createElement("div");';
      html += '    altTitle.className = "alt-title";';
      html += '    altTitle.textContent = "Альтернативы (замены):";';
      html += '    altBox.appendChild(altTitle);';
      
      html += '    if (item.alternatives && item.alternatives.length > 0) {';
      html += '      item.alternatives.forEach(function(alt, aIdx) {';
      html += '        var altRow = document.createElement("div");';
      html += '        altRow.className = "alt-item";';
      html += '        var altName = document.createElement("span");';
      html += '        altName.textContent = alt.name;';
      html += '        var altDel = document.createElement("span");';
      html += '        altDel.textContent = "✕";';
      html += '        altDel.style.cssText = ';
      html += '        "color:red; cursor:pointer;";';
      html += '        altDel.onclick = function() {';
      html += '          recipe[idx].alternatives.splice(aIdx, 1);';
      html += '          renderRecipe();';
      html += '        };';
      html += '        altRow.appendChild(altName);';
      html += '        altRow.appendChild(altDel);';
      html += '        altBox.appendChild(altRow);';
      html += '      });';
      html += '    }';
      
      html += '    var addAltBtn = document.createElement("button");';
      html += '    addAltBtn.className = "btn-add-alt";';
      html += '    addAltBtn.textContent = "+ Добавить альтернативу";';
      html += '    addAltBtn.onclick = function() { startAlt(idx); };';
      html += '    altBox.appendChild(addAltBtn);';
      html += '    div.appendChild(altBox);';

      html += '    list.appendChild(div);';
      html += '  });';
      html += '}';

      html += 'function changeQty(idx, delta) {';
      html += '  recipe[idx].qty = parseFloat(recipe[idx].qty) + delta;';
      html += '  if (recipe[idx].qty <= 0) {';
      html += '    recipe.splice(idx, 1); renderRecipe();';
      html += '  } else { renderRecipe(); }';
      html += '}';

      html += 'function uploadPhoto(input) {';
      html += '  var f = input.files[0]; if (!f) return;';
      html += '  var rd = new FileReader();';
      html += '  rd.onload = function(e) {';
      html += '    var img = new Image();';
      html += '    img.onload = function() {';
      html += '      var canvas = document.createElement("canvas");';
      html += '      var MAX = 800; var w = img.width, h = img.height;';
      html += '      if (w > h) { ';
      html += '        if (w > MAX) { h *= MAX / w; w = MAX; } ';
      html += '      } else { ';
      html += '        if (h > MAX) { w *= MAX / h; h = MAX; } ';
      html += '      }';
      html += '      canvas.width = w; canvas.height = h;';
      html += '      var ctx = canvas.getContext("2d");';
      html += '      ctx.drawImage(img, 0, 0, w, h);';
      html += '      var dataUrl = canvas.toDataURL("image/jpeg", 0.7);';
      html += '      showAlert("Загрузка", "Отправляем фото...", true);';
      html += '      fetch("/api/warehouse/upload", { method: "POST",';
      html += '      headers: { "Content-Type": "application/json" },';
      html += '      body: JSON.stringify({ image: dataUrl }) })';
      html += '      .then(function(r){return r.json();})';
      html += '      .then(function(d){';
      html += '        if (d.ok) {';
      html += '          document.getElementById("bqPhotoUrl").value = ';
      html += '          d.url;';
      html += '          var prev = document.getElementById("bqPreview");';
      html += '          prev.src = d.url; prev.style.display = "block";';
      html += '        } else showAlert("Ошибка", "Фото не принято", false);';
      html += '      }).catch(function(){ ';
      html += '        showAlert("Ошибка", "Сеть", false); });';
      html += '    }; img.src = e.target.result;';
      html += '  }; rd.readAsDataURL(f);';
      html += '}';

      html += 'function saveAll() {';
      html += '  var isLinked = document.getElementById("bqLinked").checked;';
      html += '  var isPreorder = document.getElementById("bqPreorder").checked;';
      html += '  var pendingItem = document.getElementById("searchItem").value;';
      html += '  var pendingQty = document.getElementById("qtyAdd").value;';
      
      html += '  if (isLinked && pendingItem && pendingQty && selectedItem) {';
      html += '    var q = parseFloat(pendingQty);';
      html += '    if (q > 0) {';
      html += '      var ex = recipe.find(function(r) { ';
      html += '        return r.shop_item_id === selectedItem.id; });';
      html += '      if (ex) { ex.qty = parseFloat(ex.qty) + q; }';
      html += '      else { recipe.push({ shop_item_id: selectedItem.id, ';
      html += '        name: selectedItem.name, qty: q, ';
      html += '        alternatives: [] }); }';
      html += '    }';
      html += '  }';
      
      html += '  var name = document.getElementById("bqName").value;';
      html += '  var price = parseFloat(';
      html += '  document.getElementById("bqPrice").value);';
      html += '  var photoUrl = document.getElementById("bqPhotoUrl").value;';
      html += '  if (!name || !price) { ';
      html += '    showAlert("Ошибка", "Заполните поля", false); return; }';
      
      html += '  var btn = document.getElementById("btnSave");';
      html += '  btn.disabled = true; btn.innerText = "Сохранение...";';
      
      html += '  var cleanRecipe = recipe.map(function(r) {';
      html += '    return {';
      html += '      shop_item_id: r.shop_item_id,';
      html += '      qty: r.qty,';
      html += '      alternatives: r.alternatives || []';
      html += '    };';
      html += '  });';

      html += '  fetch("/api/warehouse/bouquet/save", { method: "POST",';
      html += '  headers: { "Content-Type": "application/json" },';
      html += '  body: JSON.stringify({ id: bId, name: name, price: price,';
      html += '  photo_url: photoUrl, is_linked: isLinked, ';
      html += '  is_preorder: isPreorder }) })';
      html += '  .then(function(r){return r.json();}).then(function(d){';
      html += '    if (!d.ok) { btn.disabled = false; ';
      html += '      btn.innerText = "Сохранить"; ';
      html += '      showAlert("Ошибка", d.error, false); return; }';
      
      html += '    var newId = d.id;';
      html += '    if (isLinked) {';
      html += '      fetch("/api/warehouse/bouquets/recipe/save", { ';
      html += '      method: "POST",';
      html += '      headers: { "Content-Type": "application/json" },';
      html += '      body: JSON.stringify({ bouquet_id: newId, ';
      html += '      items: cleanRecipe }) })';
      html += '      .then(function(r){return r.json();})';
      html += '      .then(function(res){';
      html += '        if (res.ok) { ';
      html += '          window.location.href = "/warehouse/bouquets"; }';
      html += '        else { btn.disabled = false; ';
      html += '        btn.innerText = "Сохранить";';
      html += '        showAlert("Ошибка рецепта", res.error, false); }';
      html += '      }).catch(function(){ btn.disabled = false; ';
      html += '      btn.innerText = "Сохранить"; ';
      html += '      showAlert("Ошибка", "Сеть", false); });';
      html += '    } else {';
      html += '      window.location.href = "/warehouse/bouquets";';
      html += '    }';
      html += '  }).catch(function(){ btn.disabled = false;';
      html += '  btn.innerText = "Сохранить"; ';
      html += '  showAlert("Ошибка", "Сеть", false); });';
      html += '}';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) { res.status(500).send('Ошибка сервера'); }
  });

  // ====== 8. ЭКРАН ЖУРНАЛА ======
  app.get('/warehouse/audit', async (req, res) => {
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
      
      html += '.filters { display: flex; gap: 8px; margin-bottom: 16px; }';
      html += '.filter { flex: 1; padding: 12px; ';
      html += 'border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); background: #fff; text-align: center; ';
      html += 'cursor: pointer; font-size: 14px; font-weight: 600; ';
      html += 'color: var(--f-text); }';
      html += '.filter.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); }';
      
      html += '.date-label { font-size: 13px; font-weight: 600; ';
      html += 'color: var(--f-text-2); margin-bottom: 8px; }';
      html += '.date-row { display: flex; margin-bottom: 16px; }';
      html += '.date-row input { width: 100%; padding: 12px; margin: 0; ';
      html += 'border: 2px solid transparent; transition: border 0.2s; }';
      html += '.date-row input.active-date { ';
      html += 'border-color: var(--f-accent); }';
      
      html += '.log-card { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 16px; margin-bottom: 12px; cursor: pointer; ';
      html += 'box-shadow: var(--sh-1); border-left: 4px solid #ddd; }';
      html += '.log-card.sale { border-left-color: #3C7A89; }';
      html += '.log-card.receipt { border-left-color: var(--f-success); }';
      html += '.log-card.writeoff { border-left-color: var(--f-danger); }';
      html += '.log-card.shift { border-left-color: #E1846D; }';
      html += '.log-top { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 8px; }';
      html += '.log-title { font-weight: 800; font-size: 15px; ';
      html += 'display: flex; align-items: center; }';
      html += '.log-title svg { width: 18px; height: 18px; margin-right: 8px; }';
      html += '.log-date { font-size: 12px; color: var(--f-text-2); }';
      html += '.log-desc { font-size: 14px; color: #444; line-height: 1.4; }';
      html += '.log-link { font-size: 13px; color: #3C7A89; ';
      html += 'margin-top: 8px; font-weight: 600; }';
      html += '</style></head><body>';

      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Журнал</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';

      html += '<div class="filters">';
      html += '<div class="filter active" id="f-today" ';
      html += 'onclick="setPeriod(&apos;today&apos;)">Сегодня</div>';
      html += '<div class="filter" id="f-week" ';
      html += 'onclick="setPeriod(&apos;week&apos;)">Неделя</div>';
      html += '<div class="filter" id="f-month" ';
      html += 'onclick="setPeriod(&apos;month&apos;)">Месяц</div>';
      html += '</div>';
      
      html += '<div class="date-label">Или выберите конкретную дату:</div>';
      html += '<div class="date-row">';
      html += '<input type="date" id="auditDate" ';
      html += 'onchange="setCustomDate(this.value)">';
      html += '</div>';
      html += '<div id="list">Загрузка...</div>';
      
      html += getUnifiedMenu('audit');

      html += '<script>';
      html += 'var currentPeriod = "today"; var currentDate = "";';
      
      html += 'function setPeriod(p) {';
      html += '  currentPeriod = p; currentDate = "";';
      html += '  var dInp = document.getElementById("auditDate");';
      html += '  dInp.value = ""; dInp.classList.remove("active-date");';
      html += '  document.querySelectorAll(".filter").forEach(function(el){';
      html += '    el.classList.remove("active");});';
      html += '  document.getElementById("f-" + p).classList.add("active");';
      html += '  loadData();';
      html += '}';
      
      html += 'function setCustomDate(val) {';
      html += '  currentDate = val;';
      html += '  var dInp = document.getElementById("auditDate");';
      html += '  if (val) {';
      html += '    dInp.classList.add("active-date");';
      html += '    document.querySelectorAll(".filter").forEach(function(el){';
      html += '      el.classList.remove("active");});';
      html += '  } else { setPeriod("today"); }';
      html += '  loadData();';
      html += '}';
      
      html += 'function getActionIcon(action) {';
      html += '  var c = "class=\'svg-ico\' viewBox=\'0 0 24 24\' ';
      html += 'fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\'";';
      html += '  if (action === "sale") return "<svg " + c + ';
      html += '  "><rect x=\'2\' y=\'5\' width=\'20\' height=\'14\' ';
      html += '  rx=\'2\'/><line x1=\'2\' y1=\'10\' x2=\'22\' y2=\'10\'/></svg>";';
      html += '  if (action === "receipt") return "<svg " + c + ';
      html += '  "><path d=\'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 ';
      html += '  0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 ';
      html += '  2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z\'/></svg>";';
      html += '  if (action === "writeoff" || action === "cancel") ';
      html += '  return "<svg " + c + "><polyline points=\'3 6 5 6 21 ';
      html += '  6\'/><path d=\'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2';
      html += '  V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\'/></svg>";';
      html += '  if (action === "shift") return "<svg " + c + ';
      html += '  "><circle cx=\'12\' cy=\'12\' r=\'10\'/><polyline ';
      html += '  points=\'12 6 12 12 16 14\'/></svg>";';
      html += '  return "<svg " + c + "><circle cx=\'12\' cy=\'12\' ';
      html += '  r=\'3\'/></svg>";';
      html += '}';

      html += 'function loadData() {';
      html += '  var listEl = document.getElementById("list");';
      html += '  listEl.textContent = "Загрузка...";';
      html += '  var url = "/api/warehouse/audit";';
      html += '  if (currentDate) { url += "?date=" + currentDate; }';
      html += '  else { url += "?period=" + currentPeriod; }';
      html += '  fetch(url)';
      html += '  .then(function(r) { return r.json(); })';
      html += '  .then(function(d) {';
      html += '    while (listEl.firstChild) ';
      html += '    listEl.removeChild(listEl.firstChild);';
      html += '    if (!d.ok || !d.logs || d.logs.length === 0) {';
      html += '      var em = document.createElement("div");';
      html += '      em.className = "empty-state";';
      html += '      var emT = document.createElement("div");';
      html += '      emT.className = "empty-state-title";';
      html += '      emT.textContent = "Журнал пуст";';
      html += '      em.appendChild(emT); listEl.appendChild(em);';
      html += '      return; }';
      
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
      html += '      top.appendChild(titleDiv); top.appendChild(dateDiv);';
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
      html += '          window.location.href = ';
      html += '          "/warehouse/sale/details?id=" + ';
      html += '          l.ref_id + "&from=journal"; };';
      html += '        } else if (l.action === "receipt") {';
      html += '          link.textContent = "Накладная №" + l.ref_id + " →";';
      html += '          div.onclick = function() { ';
      html += '          window.location.href = ';
      html += '          "/warehouse/documents/details?id=" + ';
      html += '          l.ref_id + "&type=receipts"; };';
      html += '        } else if (l.action === "writeoff") {';
      html += '          link.textContent = "Акт списания №" + l.ref_id + " →";';
      html += '          div.onclick = function() { ';
      html += '          window.location.href = ';
      html += '          "/warehouse/documents/details?id=" + ';
      html += '          l.ref_id + "&type=writeoffs"; };';
      html += '        }';
      html += '        div.appendChild(link);';
      html += '      }';
      html += '      listEl.appendChild(div);';
      html += '    });';
      html += '  }).catch(function() { ';
      html += '    listEl.textContent = "Ошибка загрузки"; });';
      html += '}';
      html += 'loadData();';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

}

module.exports = { setupWarehouseAdminViews };