const pool = require('./db');

function setupWarehouseAdminViews(app, bot, s3ctx, getAuth, 
  fmtNum, translateReason, esc, getUnifiedMenu, 
  metaSafari, fontLink, uiScript) {

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
      html += '  if (!d.ok) { b.textContent = "Доступ запрещен"; return; } ';
      html += '  if (d.inviteCode) { ';
      html += '    globalInvite = "https://t.me/flowind_rus_bot?start=inv_" + ';
      html += '    d.inviteCode; ';
      html += '    document.getElementById("btnInvite").style.display = "flex"; ';
      html += '  }';
      html += '  if (d.staff.length === 0) { ';
      html += '    b.innerHTML = "<div class=\'empty-state\'>" + ';
      html += '    "<div class=\'empty-state-title\'>Нет флористов</div>" + ';
      html += '    "<div class=\'empty-state-text\'>Отправьте приглашение</div></div>"; ';
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
      html += '}).catch(function(){});';

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

  // ====== 3. ЭКРАН НАСТРОЕК ======
  app.get('/warehouse/settings', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.card { padding: 20px; border-radius: var(--r-lg); }';
      html += 'h3 { margin-top: 0; font-size: 18px; font-weight: 800; ';
      html += 'margin-bottom: 8px; }';
      html += '.hint { font-size: 13px; color: var(--f-text-2); ';
      html += 'margin-bottom: 16px; }';
      
      html += '.row { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-top: 12px; ';
      html += 'border-top: 1px solid var(--f-border); padding-top: 12px; } ';
      html += '.row span { font-weight: 500; font-size: 15px; }';
      html += 'input[type="checkbox"] { width: 24px; height: 24px; ';
      html += 'accent-color: var(--f-brand); margin: 0; } ';
      html += 'input[type="radio"] { width: 20px; height: 20px; ';
      html += 'accent-color: var(--f-brand); margin-right: 12px; } ';
      html += 'label.radio-lbl { display: flex; align-items: center; ';
      html += 'margin-top: 12px; font-size: 15px; font-weight: 500; } ';
      html += '.btn-save { background: var(--f-brand); color: #fff; ';
      html += 'border: none; padding: 12px 20px; border-radius: var(--r-md); ';
      html += 'font-weight: 700; font-family: inherit; margin-top: 16px; ';
      html += 'width: 100%; }';
      html += '</style></head><body>';
      
      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">Настройки</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<div class="card" style="margin-bottom:16px;">';
      html += '<h3>Безопасность (Владелец)</h3>';
      html += '<p class="hint">Задайте логин и пароль, чтобы входить ';
      html += 'в склад с компьютера.</p>';
      html += '<label>Логин</label>';
      html += '<input type="text" id="ownerLogin" placeholder="admin">';
      html += '<label>Новый пароль</label>';
      html += '<input type="password" id="ownerPassword" ';
      html += 'placeholder="Минимум 4 символа">';
      html += '<button class="btn-save" onclick="saveOwnerPassword()">';
      html += 'Сохранить пароль</button>';
      html += '</div>';

      html += '<div class="card" style="margin-bottom:16px;">';
      html += '<h3>Уведомления</h3><div id="notifs"></div></div>';
      
      html += '<div class="card" style="margin-bottom:16px;">';
      html += '<h3>Отображение</h3><div id="views"></div></div>';
      
      html += '<div class="card">';
      html += '<h3>Списания</h3>';
      html += '<p class="hint">Порог уведомления (₽)</p>';
      html += '<input type="number" id="writeoffThreshold" ';
      html += 'placeholder="1000">';
      html += '<button class="btn-save" onclick="saveThreshold()">';
      html += 'Сохранить</button></div>';

      html += getUnifiedMenu('settings');

      html += '<script>';
      html += 'var shopSettings = {}; ';
      html += 'fetch("/api/warehouse/settings")';
      html += '.then(function(r){return r.json();}).then(function(d){ ';
      html += '  if (!d.ok) return; var s = d.settings; shopSettings = s;';
      html += '  document.getElementById("ownerLogin").value = d.currentLogin;';
      
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
      html += '    lb.className = "radio-lbl";';
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
      
      html += 'function saveOwnerPassword() {';
      html += '  var l = document.getElementById("ownerLogin").value;';
      html += '  var p = document.getElementById("ownerPassword").value;';
      html += '  if (!l || !p) { ';
      html += '    showAlert("Ошибка", "Заполните поля", false); return; }';
      html += '  fetch("/api/warehouse/owner/set-password", { method: "POST", ';
      html += '  headers: { "Content-Type": "application/json" }, ';
      html += '  body: JSON.stringify({ login: l, password: p }) })';
      html += '  .then(function(r){return r.json();}).then(function(d){';
      html += '    if (d.ok) { showAlert("Готово", "Пароль сохранен", true); ';
      html += '    document.getElementById("ownerPassword").value = ""; } ';
      html += '    else showAlert("Ошибка", d.error, false);';
      html += '  }).catch(function(){ showAlert("Ошибка", "Сеть", false); });';
      html += '}';

      html += 'function saveSet(k, v) { ';
      html += 'fetch("/api/warehouse/settings", { method: "POST", ';
      html += 'headers: { "Content-Type": "application/json" }, ';
      html += 'body: JSON.stringify({ key: k, val: v }) })';
      html += '.catch(function(){}); }';
      
      html += 'function saveThreshold() { ';
      html += 'var v = document.getElementById("writeoffThreshold").value; ';
      html += 'saveSet("writeoff_threshold", v); ';
      html += 'showAlert("Готово", "Настройка сохранена", true); }';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 4. ЭКРАН ИСТОРИИ ======
  app.get('/warehouse/history', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let staffList = [];
      try {
        const st = await pool.query(
          'SELECT chat_id, name FROM admins WHERE shop_id = $1', 
          [auth.shopId]
        );
        staffList = st.rows;
      } catch (e) {}

      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.calendar { display: flex; overflow-x: auto; gap: 8px; ';
      html += 'margin-bottom: 16px; padding-bottom: 4px; } ';
      html += '.calendar::-webkit-scrollbar { display: none; }';
      html += '.day-btn { background: #fff; border: 1px solid var(--f-border); ';
      html += 'border-radius: var(--r-md); padding: 10px; text-align: center; ';
      html += 'min-width: 60px; text-decoration: none; ';
      html += 'color: var(--f-text); font-weight: 600; flex-shrink: 0; }';
      html += '.day-btn.active { background: var(--f-brand); color: #fff; ';
      html += 'border-color: var(--f-brand); } ';
      
      html += '.totals-banner { background: #fff; padding: 16px; ';
      html += 'border-radius: var(--r-md); margin-bottom: 16px; ';
      html += 'box-shadow: var(--sh-1); display: flex; justify-content: space-between; ';
      html += 'font-weight: 800; flex-wrap: wrap; gap: 12px; }';
      
      html += '.filters-box { background: #fff; border-radius: var(--r-md); ';
      html += 'padding: 16px; margin-bottom: 16px; box-shadow: var(--sh-1); }';
      html += '.filter-row { display: flex; justify-content: space-between; ';
      html += 'align-items: center; margin-bottom: 12px; }';
      html += '.filter-row:last-child { margin-bottom: 0; }';
      html += '.pill-group { display: flex; gap: 6px; }';
      html += '.pill { padding: 6px 12px; border-radius: 15px; ';
      html += 'background: #F0F4F4; font-size: 13px; font-weight: 600; ';
      html += 'cursor: pointer; border: 1px solid transparent; }';
      html += '.pill.active { background: #E0F2F1; color: var(--f-brand); ';
      html += 'border-color: var(--f-brand); }';
      html += '.switch-label { display: flex; align-items: center; gap: 8px; ';
      html += 'font-size: 14px; font-weight: 600; cursor: pointer; }';
      html += '.switch-label input { width: 20px; height: 20px; margin: 0; }';

      html += '.item { background: #fff; border-radius: var(--r-md); padding: 16px; ';
      html += 'margin-bottom: 10px; display: flex; justify-content: space-between; ';
      html += 'align-items: flex-start; cursor: pointer; ';
      html += 'box-shadow: var(--sh-1); border-left: 4px solid transparent; } ';
      html += '.item.sale { border-left-color: #3C7A89; } ';
      html += '.item.writeoff { border-left-color: var(--f-accent); } ';
      html += '.item.receipt { border-left-color: var(--f-success); }';
      html += '.date { font-size: 12px; color: var(--f-text-2); margin-top: 4px; } ';
      html += '.amount { font-weight: 800; font-size: 16px; text-align: right; } ';
      html += '.items-list { font-size: 13px; color: var(--f-text-2); ';
      html += 'margin-top: 6px; font-style: italic; } ';
      html += '</style></head><body>';
      
      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse-app" class="back-btn">←</a>';
      html += '<h2 class="page-title">История смены</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<div class="calendar" id="calendar"></div>';
      
      html += '<div class="filters-box">';
      html += '<div class="filter-row">';
      html += '<select id="staffFilter" onchange="loadHistory()" ';
      html += 'style="padding:10px; border:1px solid var(--f-border); ';
      html += 'border-radius:var(--r-md); font-family:inherit; font-weight:600; ';
      html += 'background:#F0F4F4; flex:1; margin:0;">';
      html += '<option value="">Все сотрудники</option>';
      staffList.forEach(function(s) {
        html += '<option value="' + s.chat_id + '">' + 
                esc(s.name || 'Флорист') + '</option>';
      });
      html += '</select>';
      html += '</div>';
      
      html += '<div class="filter-row">';
      html += '<label class="switch-label">';
      html += '<input type="checkbox" id="onlySales" onchange="loadHistory()">';
      html += 'Только чеки</label>';
      html += '<div class="pill-group">';
      html += '<div class="pill active" id="pay-all" ';
      html += 'onclick="setPayFilter(\'all\')">Все</div>';
      html += '<div class="pill" id="pay-cash" ';
      html += 'onclick="setPayFilter(\'cash\')">Нал</div>';
      html += '<div class="pill" id="pay-card" ';
      html += 'onclick="setPayFilter(\'card\')">Карта</div>';
      html += '<div class="pill" id="pay-qr" ';
      html += 'onclick="setPayFilter(\'qr\')">QR</div>';
      html += '</div>';
      html += '</div>';
      html += '</div>';

      html += '<div class="totals-banner" id="totalsBanner" style="display:none;">';
      html += '<span id="totSales">Выручка: 0 ₽</span>';
      html += '<span id="totCount">Чеков: 0</span>';
      html += '<span id="totLoss">Списания: 0 шт</span>';
      html += '</div>';

      html += '<div id="list">Загрузка...</div>';

      html += getUnifiedMenu('history');

      html += '<script>';
      html += 'var selectedDate = new URLSearchParams(window.location.search)';
      html += '.get("date") || new Date().toISOString().slice(0, 10);';
      html += 'var payFilter = "all";';
      html += 'var rawHistory = [];';
      
      html += 'function fmtMoney(n) { return Math.round(n)';
      html += '.toLocaleString("ru-RU") + " ₽"; }';
      
      html += 'function setPayFilter(p) {';
      html += '  payFilter = p;';
      html += '  document.querySelectorAll(".pill").forEach(function(el){';
      html += '    el.classList.remove("active");});';
      html += '  document.getElementById("pay-" + p).classList.add("active");';
      html += '  if (p !== "all") { ';
      html += '    document.getElementById("onlySales").checked = true; }';
      html += '  renderList();';
      html += '}';
      
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

      html += 'function loadHistory() {';
      html += '  var listEl = document.getElementById("list");';
      html += '  listEl.textContent = "Загрузка...";';
      html += '  var filter = document.getElementById("staffFilter").value;';
      html += '  var url = "/api/warehouse/history?date=" + selectedDate;';
      html += '  if (filter) url += "&chat_id=" + filter;';
      
      html += '  fetch(url).then(function(r){return r.json();}).then(function(d){';
      html += '    if (!d.ok) { listEl.textContent = "Ошибка"; return; }';
      html += '    rawHistory = d.history || [];';
      html += '    renderList();';
      html += '  }).catch(function(){ listEl.textContent = "Ошибка"; });';
      html += '}';

      html += 'function renderList() {';
      html += '  var listEl = document.getElementById("list");';
      html += '  while(listEl.firstChild) listEl.removeChild(listEl.firstChild);';
      
      html += '  var onlySales = document.getElementById("onlySales").checked;';
      html += '  var filtered = rawHistory.filter(function(h){';
      html += '    if (onlySales && h.type !== "sale") return false;';
      html += '    if (h.type === "sale" && payFilter !== "all") {';
      html += '      if (payFilter === "cash" && parseFloat(h.pay_cash) <= 0) ';
      html += '        return false;';
      html += '      if (payFilter === "card" && parseFloat(h.pay_card) <= 0) ';
      html += '        return false;';
      html += '      if (payFilter === "qr" && parseFloat(h.pay_qr) <= 0) ';
      html += '        return false;';
      html += '    }';
      html += '    return true;';
      html += '  });';
      
      html += '  if (filtered.length === 0) { ';
      html += '    listEl.innerHTML = "<div class=\'empty-state\'>" + ';
      html += '    "<div class=\'empty-state-title\'>Нет операций</div>" + ';
      html += '    "<div class=\'empty-state-text\'>По выбранным фильтрам</div></div>"; ';
      html += '    document.getElementById("totalsBanner")';
      html += '    .style.display = "none";';
      html += '    return; }';
      
      html += '  var totSales = 0; var totCount = 0; var totLoss = 0;';
      html += '  filtered.forEach(function(h){ ';
      html += '    if (h.type === "sale") { totSales += parseFloat(h.amount); ';
      html += '    totCount++; } else if (h.type === "writeoff") { ';
      html += '    totLoss += parseFloat(h.amount); } });';
      
      html += '  document.getElementById("totalsBanner").style.display = "flex";';
      html += '  document.getElementById("totSales").textContent = "Выручка: " + ';
      html += '  fmtMoney(totSales);';
      html += '  document.getElementById("totCount").textContent = "Чеков: " + ';
      html += '  totCount;';
      html += '  document.getElementById("totLoss").textContent = "Списания: " + ';
      html += '  fmtNum(totLoss) + " шт";';
      
      html += '  filtered.forEach(function(h){ ';
      html += '    var div = document.createElement("div"); ';
      html += '    var ds = new Date(h.date).toLocaleString("ru-RU", ';
      html += '    { hour: "2-digit", minute: "2-digit" }); ';
      html += '    var seller = h.person || "Флорист";';
      
      html += '    if (h.type === "sale") { ';
      html += '      div.className = "item sale"; ';
      html += '      var saleId = parseInt(h.id) || 0; ';
      html += '      div.onclick = function() { window.location.href = ';
      html += '      "/warehouse/sale/details?id=" + saleId; };';
      html += '      var left = document.createElement("div"); ';
      html += '      var title = document.createElement("b"); ';
      html += '      title.textContent = "Продажа (" + seller + ")"; ';
      html += '      var dateDiv = document.createElement("div"); ';
      html += '      dateDiv.className = "date"; dateDiv.textContent = ds; ';
      html += '      var itemsDiv = document.createElement("div"); ';
      html += '      itemsDiv.className = "items-list"; ';
      html += '      itemsDiv.textContent = h.items || ""; ';
      html += '      left.appendChild(title); left.appendChild(dateDiv); ';
      html += '      left.appendChild(itemsDiv);';
      html += '      var right = document.createElement("div"); ';
      html += '      var amtDiv = document.createElement("div"); ';
      html += '      amtDiv.className = "amount"; ';
      html += '      amtDiv.textContent = "+" + ';
      html += '      parseFloat(h.amount).toLocaleString("ru-RU") + " ₽"; ';
      html += '      right.appendChild(amtDiv);';
      html += '      div.appendChild(left); div.appendChild(right);';
    
      html += '    } else if (h.type === "receipt") { ';
      html += '      div.className = "item receipt"; ';
      html += '      var docId = parseInt(h.id) || 0; ';
      html += '      div.onclick = function() { window.location.href = ';
      html += '      "/warehouse/documents/details?id=" + docId + ';
      html += '      "&type=receipts"; }; ';
      html += '      var left = document.createElement("div"); ';
      html += '      var title = document.createElement("b"); ';
      html += '      title.textContent = "Приход (" + seller + ")"; ';
      html += '      var dateDiv = document.createElement("div"); ';
      html += '      dateDiv.className = "date"; dateDiv.textContent = ds; ';
      html += '      var itemsDiv = document.createElement("div"); ';
      html += '      itemsDiv.className = "items-list"; ';
      html += '      itemsDiv.textContent = h.items || ""; ';
      html += '      left.appendChild(title); left.appendChild(dateDiv); ';
      html += '      left.appendChild(itemsDiv);';
      html += '      var right = document.createElement("div"); ';
      html += '      var amtDiv = document.createElement("div"); ';
      html += '      amtDiv.className = "amount"; ';
      html += '      amtDiv.style.color = "var(--f-success)"; ';
      html += '      amtDiv.textContent = "+" + ';
      html += '      parseFloat(h.amount).toLocaleString("ru-RU") + " ₽"; ';
      html += '      right.appendChild(amtDiv);';
      html += '      div.appendChild(left); div.appendChild(right);';
    
      html += '    } else { ';
      html += '      div.className = "item writeoff"; ';
      html += '      var docId = h.id; ';
      html += '      div.onclick = function() { window.location.href = ';
      html += '      "/warehouse/documents/details?id=" + docId + ';
      html += '      "&type=writeoffs"; }; ';
      html += '      var left = document.createElement("div"); ';
      html += '      var title = document.createElement("b"); ';
      html += '      title.textContent = "Списание (" + seller + ")"; ';
      html += '      var dateDiv = document.createElement("div"); ';
      html += '      dateDiv.className = "date"; dateDiv.textContent = ds; ';
      html += '      var itemsDiv = document.createElement("div"); ';
      html += '      itemsDiv.className = "items-list"; ';
      html += '      itemsDiv.textContent = (h.items || "") + " (" + ';
      html += '      translateReason(h.reason) + ")"; ';
      html += '      left.appendChild(title); left.appendChild(dateDiv); ';
      html += '      left.appendChild(itemsDiv);';
      html += '      var right = document.createElement("div"); ';
      html += '      var amtDiv = document.createElement("div"); ';
      html += '      amtDiv.className = "amount"; ';
      html += '      amtDiv.style.color = "var(--f-accent)"; ';
      html += '      amtDiv.textContent = "-" + fmtNum(h.amount) + " шт"; ';
      html += '      right.appendChild(amtDiv);';
      html += '      div.appendChild(left); div.appendChild(right);';
      html += '    }';
      html += '    listEl.appendChild(div); });';
      html += '}';

      html += 'loadHistory();';
      html += '<\/script></body></html>';
      res.send(html);
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });
  // ====== 5. ЭКРАН ДЕТАЛЕЙ ПРОДАЖИ ======
  app.get('/warehouse/sale/details', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.redirect('/warehouse-login?shop=kupidon');
      
      let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
      html += metaSafari;
      html += '<meta name="viewport" content="width=device-width, ';
      html += 'initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
      html += fontLink + uiScript + '<style>';
      html += 'body { padding: 0 16px 32px 16px; }';
      
      html += '.card { padding: 24px; border-radius: var(--r-lg); }';
      html += '.total { font-size: 32px; font-weight: 800; ';
      html += 'color: var(--f-success); margin-bottom: 8px; } ';
      html += '.meta { font-size: 14px; color: var(--f-text-2); ';
      html += 'margin-bottom: 24px; } ';
      html += '.item-row { display: flex; justify-content: space-between; ';
      html += 'padding: 16px 0; border-bottom: 1px solid var(--f-border); ';
      html += 'text-decoration: none; color: var(--f-text); } ';
      html += '.item-row:last-child { border-bottom: none; } ';
      html += '.item-name { font-weight: 600; font-size: 16px; } ';
      html += '.item-qty { color: var(--f-danger); font-weight: 800; }';
      html += '.btn-cancel-sale { width: 100%; padding: 16px; ';
      html += 'background: #fff; border: 2px solid var(--f-danger); ';
      html += 'color: var(--f-danger); border-radius: var(--r-md); ';
      html += 'font-weight: 800; font-size: 16px; margin-top: 24px; ';
      html += 'cursor: pointer; }';
      html += '</style></head><body>';
      
      html += '<div class="page-header">';
      html += '<div class="page-header-left">';
      html += '<a href="/warehouse/history" class="back-btn">←</a>';
      html += '<h2 class="page-title">Чек</h2></div>';
      html += '<button class="burger-btn" onclick="toggleMenu()">☰</button>';
      html += '</div>';
      
      html += '<div class="card" id="content">Загрузка...</div>';

      html += getUnifiedMenu('history');

      html += '<script>';
      html += 'var saleId = parseInt(new URLSearchParams(window.location.search)';
      html += '.get("id")) || 0;';
      html += 'fetch("/api/warehouse/sale/details?id=" + saleId)';
      html += '.then(function(r){return r.json();}).then(function(d){';
      html += '  var content = document.getElementById("content"); ';
      html += '  while(content.firstChild) ';
      html += '  content.removeChild(content.firstChild); ';
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
      html += '    c.style = "font-size:12px;color:var(--f-text-2);"; ';
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
      html += '      body: JSON.stringify({ saleId: saleId, ';
      html += '      action: "return" }) })';
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
    } catch(e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== 6. ЭКРАН БУКЕТОВ ======
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

      html += '.b-grid { display: grid; grid-template-columns: 1fr 1fr; ';
      html += 'gap: 12px; align-items: stretch; }';
      html += '.b-card-grid { background: #fff; border-radius: var(--r-lg); ';
      html += 'padding: 12px; display: flex; flex-direction: column; ';
      html += 'height: 100%; box-shadow: var(--sh-1); }';
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
      html += 'box-shadow: var(--sh-1); }';
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
      
      html += 'var svgPh = "<svg viewBox=\\"0 0 24 24\\" fill=\\"currentColor\\">";';
      html += '<path d="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22';
      html += 'L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3';
      html += 'C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5';
      html += 'C2,15.5 3.5,17.5 6.5,17.5C7.21,17.5 7.87,17.36 ';
      html += '8.5,17.12C11.24,16.08 13.44,14.57 15,12.5';
      html += 'C15,12.5 15.5,14.5 15.5,16.5C15.5,18.5 14.5,20 ';
      html += '14.5,20C17,20 19.5,17.5 20.5,14.5C21.5,11.5 ';
      html += '21.5,8 21.5,8C21.5,8 19.5,6 17,8Z"/></svg>";';

      html += 'if (localStorage.getItem("wh_bq_view")) { ';
      html += 'currentView = localStorage.getItem("wh_bq_view"); }';
      
      html += 'function setView(v) { ';
      html += 'currentView = v; localStorage.setItem("wh_bq_view", v); ';
      html += 'updateViewBtns(); render(); }';
      
      html += 'function updateViewBtns() {';
      html += '  document.getElementById("btn-v-grid").classList.remove("active");';
      html += '  document.getElementById("btn-v-list").classList.remove("active");';
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
      html += '    document.getElementById("list").innerHTML = ';
      html += '    "<div style=\'color:red;\'>Ошибка: " + d.error + "</div>";';
      html += '  }';
      html += '}).catch(function(e){ ';
      html += '  document.getElementById("list").innerHTML = ';
      html += '  "<div style=\'color:red;\'>Сеть: " + e.message + "</div>";';
      html += '});';

      html += 'function render() {';
      html += '  var container = document.getElementById("list");';
      html += '  while(container.firstChild) ';
      html += '  container.removeChild(container.firstChild);';
      html += '  var q = document.getElementById("search").value.toLowerCase();';
      
      html += '  var filtered = allBouquets.filter(function(b) {';
      html += '    var matchQ = b.name.toLowerCase().includes(q);';
      html += '    var matchF = true;';
      html += '    if (currentFilter === "active") matchF = (b.wh_linked && !b.deleted);';
      html += '    if (currentFilter === "inactive") matchF = (!b.wh_linked && !b.deleted);';
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
      html += '      var cb = document.createElement("input"); cb.type = "checkbox"; ';
      html += '      cb.checked = bq.wh_linked; ';
      html += '      cb.onchange = function(){toggleLink(bq.id, cb.checked, bq);}; ';
      html += '      sw.appendChild(cb);';
      html += '      var sl = document.createElement("span"); ';
      html += '      sl.className = "slider"; sw.appendChild(sl); ';
      html += '      info.appendChild(sw);';
      html += '    }';
      
      html += '    var btnRow = document.createElement("div"); ';
      html += '    btnRow.style = "display:flex; gap:6px; margin-top:auto;";';
      
      html += '    if (bq.deleted) {';
      html += '      var btnRestore = document.createElement("button"); ';
      html += '      btnRestore.className = "btn-setup"; ';
      html += '      btnRestore.style = "flex:1; color:var(--f-success);"';
      html += '      btnRestore.innerHTML = "Восстановить"; ';
      html += '      btnRestore.onclick = function() { restoreBouquet(bq.id); }; ';
      html += '      btnRow.appendChild(btnRestore);';
      html += '    } else {';
      html += '      var btnEdit = document.createElement("button"); ';
      html += '      btnEdit.className = "btn-setup"; ';
      html += '      btnEdit.style = "flex:1;";';
      html += '      btnEdit.innerHTML = "Изм."; ';
      html += '      btnEdit.onclick = function() { ';
      html += '        window.location.href = "/warehouse/bouquet/edit?id=" ';
      html += '        + bq.id; }; ';
      html += '      btnRow.appendChild(btnEdit);';
      
      html += '      var btnSetup = document.createElement("button"); ';
      html += '      btnSetup.className = "btn-setup"; ';
      html += '      btnSetup.style = "flex:2; color:var(--f-brand); ';
      html += '      font-weight:700;";';
      html += '      btnSetup.textContent = "Рецепт"; ';
      html += '      btnSetup.onclick = function() { ';
      html += '        window.location.href = "/warehouse/bouquets/recipe?id=" ';
      html += '        + bq.id; }; ';
      html += '      btnRow.appendChild(btnSetup);';
      
      html += '      var btnDel = document.createElement("button"); ';
      html += '      btnDel.className = "btn-setup"; ';
      html += '      btnDel.style = "flex:1; color:var(--f-danger);";';
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
      html += '  showConfirm("Удаление", "Удалить букет в корзину?", function() {';
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

}
module.exports = { setupWarehouseAdminViews };