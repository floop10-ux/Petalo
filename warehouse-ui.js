const pool = require('./db');

function setupWarehouse(app) {
  const brandColor = '#124444';
  const accentColor = '#E08567';

  // 1. Главный экран
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
        `SELECT role, name, can_receipt, ` +
        `can_sale, can_writeoff ` +
        `FROM admins WHERE chat_id = $1 LIMIT 1`, [chatId]
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

      let html = '<!DOCTYPE html><html><head>';
      html += '<meta charset="UTF-8">';
      html += '<meta name="viewport" ';
      html += 'content="width=device-width, initial-scale=1.0">';
      html += '<script src="https://telegram.org/js/';
      html += 'telegram-web-app.js"><\/script>';
      html += '<style>';
      html += `body { font-family: sans-serif; margin: 0; `;
      html += `padding: 20px; background: #fafaf8; `;
      html += `color: ${brandColor}; text-align: center; }`;
      html += `.header { background: #fff; padding: 20px; `;
      html += `border-radius: 20px; margin-bottom: 20px; `;
      html += `border-bottom: 4px solid ${brandColor}; `;
      html += `box-shadow: 0 4px 20px rgba(0,0,0,0.05); }`;
      html += `h1 { margin: 0; font-size: 24px; }`;
      html += `.grid { display: grid; `;
      html += `grid-template-columns: 1fr 1fr; gap: 15px; }`;
      html += `.btn { background: #fff; padding: 20px 10px; `;
      html += `border-radius: 20px; text-decoration: none; `;
      html += `color: ${brandColor}; font-weight: bold; `;
      html += `font-size: 16px; display: flex; `;
      html += `flex-direction: column; align-items: center; `;
      html += `justify-content: center; border: 1px solid #eee; `;
      html += `box-shadow: 0 4px 15px rgba(0,0,0,0.05); }`;
      html += `.btn span { font-size: 28px; margin-bottom: 8px; }`;
      html += `.full { grid-column: 1 / -1; }`;
      html += '</style></head><body>';
      
      html += '<div class="header">';
      html += '<h1>📦 Склад</h1>';
      html += '<p style="color:#888;margin:5px 0 0;">';
      html += `Вы вошли как: <b>${userName}</b> `;
      html += `(${isOwner ? 'Владелец' : 'Флорист'})</p>`;
      html += '</div>';
      
      html += '<div class="grid">';
      
      if (isOwner || canSale) {
        html += '<a href="/warehouse/sale" class="btn">';
        html += '<span>💰</span>Продажа</a>';
      }
      if (isOwner || canWriteoff) {
        html += '<a href="/warehouse/writeoff" class="btn">';
        html += '<span>🗑</span>Списание</a>';
      }
      if (isOwner || canReceipt) {
        html += '<a href="/warehouse/receipt" class="btn">';
        html += '<span>📥</span>Приход</a>';
      }
      
      html += '<a href="/warehouse/history" class="btn">';
      html += '<span>📋</span>История</a>';
      
      if (isOwner) {
        html += '<a href="/warehouse/reports" class="btn">';
        html += '<span>📊</span>Отчёты</a>';
        html += '<a href="/warehouse/settings" class="btn full">';
        html += '<span>⚙️</span>Настройки</a>';
      }
      
      html += '</div>';
      html += '<script>Telegram.WebApp.ready();<\/script>';
      html += '</body></html>';
      
      res.send(html);
    } catch (e) {
      res.status(500).send('Ошибка сервера');
    }
  });

  // 2. Вход
  app.get('/warehouse-login', (req, res) => {
    const shopId = req.query.shop || '';
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += `body { font-family: sans-serif; text-align: center; `;
    html += `padding: 50px 20px; background: #fafaf8; }`;
    html += `.card { background: #fff; border-radius: 20px; `;
    html += `padding: 30px; max-width: 400px; margin: 0 auto; `;
    html += `border-bottom: 5px solid ${brandColor}; `;
    html += `box-shadow: 0 4px 20px rgba(0,0,0,0.08); }`;
    html += `input { font-size: 24px; padding: 10px; `;
    html += `width: 120px; text-align: center; `;
    html += `border: 2px solid #ddd; border-radius: 10px; `;
    html += `margin: 20px 0; }`;
    html += `button { background: ${brandColor}; color: white; `;
    html += `border: none; padding: 15px 40px; `;
    html += `font-size: 18px; border-radius: 30px; `;
    html += `font-weight: bold; }`;
    html += '</style></head><body>';
    
    html += '<div class="card">';
    html += '<h1>📦 Склад</h1>';
    html += '<p>Введите PIN-код</p>';
    html += '<input type="password" id="pin" maxlength="4" ';
    html += 'inputmode="numeric" placeholder="****">';
    html += '<br><button onclick="login()">Войти</button>';
    html += '</div>';
    
    html += '<script>';
    html += 'function login() {';
    html += '  var pin = document.getElementById("pin").value;';
    html += '  fetch("/api/warehouse/auth", {';
    html += '    method: "POST",';
    html += '    headers: { "Content-Type": "application/json" },';
    html += `    body: JSON.stringify({ shopId: "${shopId}", pin: pin })`;
    html += '  }).then(function(r) { return r.json(); })';
    html += '  .then(function(data) {';
    html += '    if (data.ok) window.location.href = "/warehouse-app";';
    html += '    else alert("Неверный PIN-код");';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    
    res.send(html);
  });

  // 3. API Авторизации
  app.post('/api/warehouse/auth', async (req, res) => {
    try {
      const { shopId, pin } = req.body;
      const r = await pool.query(
        `SELECT chat_id, role FROM admins ` +
        `WHERE shop_id = $1 AND warehouse_pin = $2`,
        [shopId, pin]
      );
      if (r.rows.length === 0) {
        return res.json({ ok: false });
      }
      
      const user = r.rows[0];
      res.setHeader('Set-Cookie', 
        'wh_auth=' + user.chat_id + '; Path=/; Max-Age=2592000; HttpOnly'
      );
      res.json({ ok: true, role: user.role });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  // 4. API Товаров
  app.get('/api/warehouse/items', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const r = await pool.query(
        `SELECT i.id, i.current_stock, ` +
        `COALESCE(i.custom_name, w.name) AS name, ` +
        `w.photo_url ` +
        `FROM wh_shop_items i ` +
        `JOIN wh_items w ON w.id = i.item_id ` +
        `WHERE i.shop_id = $1 AND i.current_stock > 0`,
        [shopId]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });
  // 5. API Продажи
  app.post('/api/warehouse/sale', async (req, res) => {
    try {
      const shopId = req.body.shopId;
      const real_price = req.body.real_price;
      const items = req.body.items;
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;

      const saleRes = await pool.query(
        `INSERT INTO wh_sales (shop_id, real_price, chat_id) ` +
        `VALUES ($1, $2, $3) RETURNING id`,
        [shopId, real_price, chatId]
      );
      const saleId = saleRes.rows[0].id;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await pool.query(
          `UPDATE wh_shop_items SET ` +
          `current_stock = current_stock - $1 WHERE id = $2`,
          [item.qty, item.id]
        );
        const costQ = await pool.query(
          `SELECT avg_cost FROM wh_shop_items WHERE id = $1`,
          [item.id]
        );
        const cost = costQ.rows[0].avg_cost || 0;
        await pool.query(
          `INSERT INTO wh_sale_items ` +
          `(sale_id, shop_item_id, qty, cost_at_sale) ` +
          `VALUES ($1, $2, $3, $4)`,
          [saleId, item.id, item.qty, cost]
        );
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  // 6. Экран Продажи
  app.get('/warehouse/sale', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += `body { font-family: sans-serif; margin: 0; `;
    html += `padding: 15px; background: #fafaf8; `;
    html += `color: ${brandColor}; }`;
    html += `.header { display: flex; align-items: center; `;
    html += `margin-bottom: 15px; }`;
    html += `.back { font-size: 24px; text-decoration: none; `;
    html += `color: ${brandColor}; margin-right: 15px; }`;
    html += `.search { width: 100%; padding: 12px; `;
    html += `border: 2px solid #eee; border-radius: 10px; `;
    html += `font-size: 16px; margin-bottom: 15px; `;
    html += `box-sizing: border-box; }`;
    html += `.grid { display: grid; `;
    html += `grid-template-columns: `;
    html += `repeat(auto-fill, minmax(110px, 1fr)); `;
    html += `gap: 8px; margin-bottom: 20px; }`;
    html += `.card { background: #fff; padding: 8px; `;
    html += `border-radius: 10px; text-align: center; `;
    html += `cursor: pointer; `;
    html += `box-shadow: 0 2px 8px rgba(0,0,0,0.05); }`;
    html += `.card img { width: 100%; height: 80px; `;
    html += `object-fit: cover; border-radius: 6px; `;
    html += `margin-bottom: 5px; }`;
    html += `.card .ph { height: 80px; font-size: 30px; `;
    html += `display: flex; align-items: center; `;
    html += `justify-content: center; margin-bottom: 5px; }`;
    html += `.card .name { font-size: 12px; font-weight: bold; }`;
    html += `.card .stock { font-size: 11px; color: #27ae60; }`;
    html += `.basket { background: #fff; border-radius: 15px; `;
    html += `padding: 15px; margin-bottom: 15px; `;
    html += `border: 2px solid ${brandColor}; display: none; }`;
    html += `.b-row { display: flex; justify-content: space-between; `;
    html += `align-items: center; margin-bottom: 8px; `;
    html += `border-bottom: 1px solid #eee; padding-bottom: 8px; }`;
    html += `.btn-save { width: 100%; padding: 15px; `;
    html += `background: ${brandColor}; color: #fff; `;
    html += `border: none; border-radius: 10px; `;
    html += `font-size: 18px; font-weight: bold; margin-top: 10px; }`;
    html += '</style></head><body>';

    html += '<div class="header">';
    html += '<a href="/warehouse-app" class="back">←</a>';
    html += '<h1>💰 Продажа</h1></div>';

    html += '<div class="basket" id="basket">';
    html += '<h3 style="margin-top:0; font-size:16px;">Выбрано:</h3>';
    html += '<div id="bList"></div>';
    html += '<label style="font-size:12px; color:#666;">Сумма</label>';
    html += '<input type="number" id="totalPrice" step="0.01" ';
    html += 'style="width:100%; padding:10px; border:1px solid #ddd; ';
    html += 'border-radius:8px; margin-top:5px; box-sizing:border-box;">';
    html += '<button class="btn-save" onclick="saveSale()">Продать</button>';
    html += '</div>';

    html += '<input type="text" class="search" id="search" ';
    html += 'placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    html += '<div class="grid" id="itemsGrid"></div>';

    html += '<script>';
    html += 'var allItems = []; var cart = [];';
    html += 'fetch("/api/warehouse/items?shop=kupidon")';
    html += '.then(r => r.json()).then(d => {';
    html += '  allItems = d.items; render(allItems);';
    html += '});';
    
    html += 'function render(items) {';
    html += '  var g = document.getElementById("itemsGrid");';
    html += '  g.innerHTML = "";';
    html += '  items.forEach(item => {';
    html += '    var div = document.createElement("div");';
    html += '    div.className = "card";';
    html += '    var img = item.photo_url ? ';
    html += '      \'<img src="\' + item.photo_url + \'">\' :';
    html += '      \'<div class="ph">📷</div>\';';
    html += '    div.innerHTML = img + ';
    html += '      \'<div class="name">\' + item.name + \'</div>\';';
    html += '    div.innerHTML += ';
    html += '      \'<div class="stock">Ост: \' + item.current_stock + \'</div>\';';
    html += '    div.onclick = function() { addToCart(item); };';
    html += '    g.appendChild(div);';
    html += '  });';
    html += '}';

    html += 'function filterItems() {';
    html += '  var q = document.getElementById("search").value.toLowerCase();';
    html += '  render(allItems.filter(i => i.name.toLowerCase().includes(q)));';
    html += '}';

    html += 'function addToCart(item) {';
    html += '  var ex = cart.find(c => c.id === item.id);';
    html += '  if (ex) ex.qty += 1; ';
    html += '  else cart.push({ id: item.id, name: item.name, qty: 1 });';
    html += '  renderBasket();';
    html += '}';

    html += 'function renderBasket() {';
    html += '  var b = document.getElementById("basket");';
    html += '  var list = document.getElementById("bList");';
    html += '  if (cart.length === 0) { b.style.display = "none"; return; }';
    html += '  b.style.display = "block"; list.innerHTML = "";';
    html += '  cart.forEach((item, idx) => {';
    html += '    var div = document.createElement("div");';
    html += '    div.className = "b-row";';
    html += '    div.innerHTML = \'<span>\' + item.name + \'</span>\' +';
    html += '      \'<input type="number" step="0.1" value="\' + item.qty + \'"\';';
    html += '      \'onchange="upQty(\' + idx + \', this.value)"\';';
    html += '      \'style="width:60px; text-align:center;">\' +';
    html += '      \'<button onclick="cart.splice(\' + idx + \', 1);\';';
    html += '      \'renderBasket();" \';';
    html += '      \'style="border:none;color:red;font-size:20px;">✕</button>\';';
    html += '    list.appendChild(div);';
    html += '  });';
    html += '}';

    html += 'function upQty(idx, val) {';
    html += '  var v = parseFloat(val);';
    html += '  if (isNaN(v) || v <= 0) v = 1;';
    html += '  cart[idx].qty = v;';
    html += '}';

    html += 'function saveSale() {';
    html += '  var total = document.getElementById("totalPrice").value;';
    html += '  if (!total) { alert("Введите сумму"); return; }';
    html += '  fetch("/api/warehouse/sale", {';
    html += '    method: "POST",';
    html += '    headers: { "Content-Type": "application/json" },';
    html += '    body: JSON.stringify({ shopId: "kupidon", ';
    html += '      real_price: total, items: cart })';
    html += '  }).then(r => r.json()).then(d => {';
    html += '    if (d.ok) { alert("Продано!"); ';
    html += '      window.location.href="/warehouse-app"; }';
    html += '    else alert("Ошибка");';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 7. Экран Прихода
  app.get('/warehouse/receipt', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += `body { font-family: sans-serif; margin: 0; `;
    html += `padding: 20px; background: #fafaf8; `;
    html += `color: ${brandColor}; }`;
    html += `.header { display: flex; align-items: center; `;
    html += `margin-bottom: 15px; }`;
    html += `.back { font-size: 24px; text-decoration: none; `;
    html += `color: ${brandColor}; margin-right: 15px; }`;
    html += `.card { background: #fff; border-radius: 15px; `;
    html += `padding: 15px; margin-bottom: 15px; }`;
    html += `label { display: block; font-size: 12px; `;
    html += `color: #888; margin-bottom: 5px; }`;
    html += `input[type="text"], input[type="number"] { `;
    html += `width: 100%; padding: 12px; border: 1px solid #ddd; `;
    html += `border-radius: 8px; font-size: 16px; `;
    html += `margin-bottom: 15px; box-sizing: border-box; }`;
    html += `.btn-save { width: 100%; background: ${brandColor}; `;
    html += `color: #fff; border: none; padding: 15px; `;
    html += `border-radius: 10px; font-size: 18px; font-weight: bold; }`;
    html += '</style></head><body>';
    
    html += '<div class="header">';
    html += '<a href="/warehouse-app" class="back">←</a>';
    html += '<h1>📥 Приход</h1></div>';
    
    html += '<div class="card">';
    html += '<label>Название</label>';
    html += '<input type="text" id="itemName" placeholder="Роза">';
    html += '<label>Количество (можно 0.5)</label>';
    html += '<input type="number" id="itemQty" step="0.1" placeholder="0">';
    html += '<label>Цена закупки</label>';
    html += '<input type="number" id="itemPrice" placeholder="0">';
    html += '<label>Фото (необязательно)</label>';
    html += '<input type="file" id="itemPhoto" accept="image/*">';
    html += '</div>';
    
    html += '<button class="btn-save" onclick="saveReceipt()">';
    html += 'Добавить</button>';
    
    html += '<script>';
    html += 'function saveReceipt() {';
    html += '  var name = document.getElementById("itemName").value;';
    html += '  var qty = document.getElementById("itemQty").value;';
    html += '  var price = document.getElementById("itemPrice").value;';
    html += '  if (!name || !qty || !price) { ';
    html += '    alert("Заполните поля"); return; }';
    html += '  var file = document.getElementById("itemPhoto").files[0];';
    html += '  if (file) {';
    html += '    var reader = new FileReader();';
    html += '    reader.onload = function(e) { ';
    html += '      upload(e.target.result, name, qty, price); };';
    html += '    reader.readAsDataURL(file);';
    html += '  } else submit(name, qty, price, null, null);';
    html += '}';
    
    html += 'function upload(base64, name, qty, price) {';
    html += '  fetch("/api/warehouse/upload", {';
    html += '    method: "POST",';
    html += '    headers: { "Content-Type": "application/json" },';
    html += '    body: JSON.stringify({ image: base64 })';
    html += '  }).then(r => r.json()).then(d => {';
    html += '    submit(name, qty, price, d.url, d.urlBackup);';
    html += '  }).catch(() => { ';
    html += '    submit(name, qty, price, null, null); });';
    html += '}';
    
    html += 'function submit(name, qty, price, url, url2) {';
    html += '  fetch("/api/warehouse/receipt", {';
    html += '    method: "POST",';
    html += '    headers: { "Content-Type": "application/json" },';
    html += '    body: JSON.stringify({ shopId: "kupidon", name: name, ';
    html += '      qty: qty, price: price, photo: url, photoBackup: url2 })';
    html += '  }).then(r => r.json()).then(d => {';
    html += '    if (d.ok) { alert("Добавлено!"); ';
    html += '      window.location.href="/warehouse-app"; }';
    html += '    else alert("Ошибка");';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 8. API Списания
  app.post('/api/warehouse/writeoff', async (req, res) => {
    try {
      const shopId = req.body.shopId;
      const items = req.body.items;
      const reason = req.body.reason;
      const comment = req.body.comment;
      const photo = req.body.photo;
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await pool.query(
          `UPDATE wh_shop_items SET ` +
          `current_stock = current_stock - $1 WHERE id = $2`,
          [item.qty, item.id]
        );
        await pool.query(
          `INSERT INTO wh_writeoffs ` +
          `(shop_id, shop_item_id, qty, reason, comment, photo_url) ` +
          `VALUES ($1, $2, $3, $4, $5, $6)`,
          [shopId, item.id, item.qty, reason, comment, photo]
        );
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  // 9. Экран Списания
  app.get('/warehouse/writeoff', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += `body { font-family: sans-serif; margin: 0; `;
    html += `padding: 15px; background: #fafaf8; `;
    html += `color: ${brandColor}; }`;
    html += `.header { display: flex; align-items: center; `;
    html += `margin-bottom: 15px; }`;
    html += `.back { font-size: 24px; text-decoration: none; `;
    html += `color: ${brandColor}; margin-right: 15px; }`;
    html += `.search { width: 100%; padding: 12px; `;
    html += `border: 2px solid #eee; border-radius: 10px; `;
    html += `margin-bottom: 15px; box-sizing: border-box; }`;
    html += `.grid { display: grid; `;
    html += `grid-template-columns: `;
    html += `repeat(auto-fill, minmax(110px, 1fr)); `;
    html += `gap: 8px; margin-bottom: 15px; }`;
    html += `.card { background: #fff; padding: 8px; `;
    html += `border-radius: 10px; text-align: center; `;
    html += `cursor: pointer; }`;
    html += `.card img { width: 100%; height: 80px; `;
    html += `object-fit: cover; border-radius: 6px; }`;
    html += `.card .ph { height: 80px; font-size: 30px; }`;
    html += `.reasons { display: grid; `;
    html += `grid-template-columns: 1fr 1fr; gap: 10px; `;
    html += `margin-bottom: 15px; }`;
    html += `.reason { padding: 12px; border-radius: 10px; `;
    html += `border: 2px solid #eee; background: #fff; `;
    html += `text-align: center; }`;
    html += `.reason.active { border-color: ${accentColor}; `;
    html += `color: ${accentColor}; font-weight: bold; }`;
    html += `.btn-save { width: 100%; padding: 15px; `;
    html += `background: ${accentColor}; color: #fff; `;
    html += `border: none; border-radius: 10px; `;
    html += `font-size: 18px; font-weight: bold; margin-top: 15px; }`;
    html += '</style></head><body>';
    
    html += '<div class="header">';
    html += '<a href="/warehouse-app" class="back">←</a>';
    html += '<h1>🗑 Списание</h1></div>';
    
    html += '<input type="text" class="search" id="search" ';
    html += 'placeholder="🔍 Поиск..." onkeyup="filterItems()">';
    html += '<div class="grid" id="itemsGrid"></div>';
    
    html += '<div id="form" style="display:none;">';
    html += '<h3>Причина</h3><div class="reasons">';
    html += '<div class="reason active" ';
    html += 'onclick="setR(this,\'spoilage\')">Порча</div>';
    html += '<div class="reason" ';
    html += 'onclick="setR(this,\'loss\')">Потеря</div>';
    html += '<div class="reason" ';
    html += 'onclick="setR(this,\'markdown\')">Уценка</div>';
    html += '<div class="reason" ';
    html += 'onclick="setR(this,\'sorting\')">Пересорт</div>';
    html += '</div>';
    html += '<label>Комментарий</label>';
    html += '<textarea id="comment" style="width:100%; ';
    html += 'padding:10px; border-radius:10px; ';
    html += 'border:1px solid #ddd; margin-bottom:10px; ';
    html += 'box-sizing:border-box;"></textarea>';
    html += '<label>Фото</label>';
    html += '<input type="file" id="wPhoto" accept="image/*" ';
    html += 'style="margin-bottom:15px;">';
    html += '<button class="btn-save" onclick="saveWriteoff()">';
    html += 'Списать</button></div>';
    
    html += '<script>';
    html += 'var allItems = []; var selItem = null; var selReason = "spoilage";';
    html += 'fetch("/api/warehouse/items?shop=kupidon")';
    html += '.then(r => r.json()).then(d => { ';
    html += '  allItems = d.items; render(); });';
    
    html += 'function render() { drawCards(allItems); }';
    html += 'function filterItems() {';
    html += '  var q = document.getElementById("search").value.toLowerCase();';
    html += '  drawCards(allItems.filter(i => i.name.toLowerCase().includes(q)));';
    html += '}';
    
    html += 'function drawCards(items) {';
    html += '  var g = document.getElementById("itemsGrid"); g.innerHTML = "";';
    html += '  items.forEach(i => {';
    html += '    var d = document.createElement("div"); d.className = "card";';
    html += '    var img = i.photo_url ? ';
    html += '      \'<img src="\' + i.photo_url + \'">\' :';
    html += '      \'<div class="ph">📷</div>\';';
    html += '    d.innerHTML = img + \'<div>\' + i.name + \'</div>\';';
    html += '    d.onclick = () => selectItem(i); g.appendChild(d);';
    html += '  });';
    html += '}';
    
    html += 'function selectItem(item) {';
    html += '  var q = prompt("Сколько списать?", "1");';
    html += '  if (q && parseFloat(q) > 0) {';
    html += '    selItem = { id: item.id, qty: parseFloat(q) };';
    html += '    document.getElementById("form").style.display = "block";';
    html += '  }';
    html += '}';
    
    html += 'function setR(el, r) {';
    html += '  document.querySelectorAll(".reason").forEach(b => ';
    html += '    b.classList.remove("active"));';
    html += '  el.classList.add("active"); selReason = r;';
    html += '}';
    
    html += 'function saveWriteoff() {';
    html += '  if (!selItem) return; ';
    html += '  var c = document.getElementById("comment").value;';
    html += '  var f = document.getElementById("wPhoto").files[0];';
    html += '  if (f) { ';
    html += '    var rd = new FileReader(); ';
    html += '    rd.onload = e => upload(e.target.result, c); ';
    html += '    rd.readAsDataURL(f); ';
    html += '  } else submit(null, c);';
    html += '}';
    
    html += 'function upload(base64, c) {';
    html += '  fetch("/api/warehouse/upload", { ';
    html += '    method: "POST", ';
    html += '    headers: { "Content-Type": "application/json" }, ';
    html += '    body: JSON.stringify({ image: base64 }) ';
    html += '  }).then(r => r.json()).then(d => submit(d.url, c))';
    html += '  .catch(() => submit(null, c));';
    html += '}';
    
    html += 'function submit(url, c) {';
    html += '  fetch("/api/warehouse/writeoff", { ';
    html += '    method: "POST", ';
    html += '    headers: { "Content-Type": "application/json" }, ';
    html += '    body: JSON.stringify({ shopId: "kupidon", ';
    html += '      items: [selItem], reason: selReason, ';
    html += '      comment: c, photo: url }) ';
    html += '  }).then(r => r.json()).then(d => { ';
    html += '    if (d.ok) { alert("Списано!"); ';
    html += '      window.location.href="/warehouse-app"; } ';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 9.1 API Загрузки фото
  app.post('/api/warehouse/upload', async (req, res) => {
    try {
      const base64Data = req.body.image;
      if (!base64Data) return res.json({ ok: false });
      const base64Image = base64Data.split(';base64,').pop();
      const buffer = Buffer.from(base64Image, 'base64');
      const key = 'wh_' + Date.now() + '.jpg';
      
      const cmd = new PutObjectCommand({
        Bucket: YC_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: 'image/jpeg'
      });
      await s3.send(cmd);
      
      const url = `https://${YC_BUCKET}.storage.yandexcloud.net/${key}`;
      let urlBackup = null;
      
      if (s3backup) {
        const cmd2 = new PutObjectCommand({
          Bucket: BC_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: 'image/jpeg'
        });
        await s3backup.send(cmd2);
        urlBackup = BC_ENDPOINT + '/' + BC_BUCKET + '/' + key;
      }
      
      res.json({ ok: true, url: url, urlBackup: urlBackup });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });
  // 10. API Отчётов
  app.get('/api/warehouse/reports', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      
      const rev = await pool.query(
        `SELECT COALESCE(SUM(real_price), 0) AS total ` +
        `FROM wh_sales WHERE shop_id = $1`, [shopId]
      );
      
      const loss = await pool.query(
        `SELECT COALESCE(SUM(w.qty * i.avg_cost), 0) AS total ` +
        `FROM wh_writeoffs w ` +
        `JOIN wh_shop_items i ON i.id = w.shop_item_id ` +
        `WHERE w.shop_id = $1`, [shopId]
      );
      
      const cost = await pool.query(
        `SELECT COALESCE(SUM(s.qty * s.cost_at_sale), 0) AS total ` +
        `FROM wh_sale_items s ` +
        `JOIN wh_sales sa ON sa.id = s.sale_id ` +
        `WHERE sa.shop_id = $1`, [shopId]
      );
      
      const revenue = parseInt(rev.rows[0].total) || 0;
      const losses = parseInt(loss.rows[0].total) || 0;
      const costVal = parseInt(cost.rows[0].total) || 0;
      const profit = revenue - costVal;
      
      let lossPercent = 0;
      if ((revenue + losses) > 0) {
        lossPercent = Math.round((losses / (revenue + losses)) * 100);
      }
      
      res.json({ 
        ok: true, revenue, profit, losses, lossPercent 
      });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  // 11. Экран Отчётов
  app.get('/warehouse/reports', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += `body { font-family: sans-serif; margin: 0; `;
    html += `padding: 15px; background: #fafaf8; `;
    html += `color: ${brandColor}; }`;
    html += `.header { display: flex; align-items: center; `;
    html += `margin-bottom: 15px; }`;
    html += `.back { font-size: 24px; text-decoration: none; `;
    html += `color: ${brandColor}; margin-right: 15px; }`;
    html += `.card { background: #fff; border-radius: 15px; `;
    html += `padding: 20px; margin-bottom: 15px; `;
    html += `text-align: center; }`;
    html += `.val { font-size: 28px; font-weight: bold; }`;
    html += `.blue { color: #2980b9; }`;
    html += `.green { color: #27ae60; }`;
    html += `.red { color: ${accentColor}; }`;
    html += '</style></head><body>';
    
    html += '<div class="header">';
    html += '<a href="/warehouse-app" class="back">←</a>';
    html += '<h1>📊 Отчёты</h1></div>';
    
    html += '<div id="load" style="text-align:center;">Загрузка...</div>';
    html += '<div id="cont" style="display:none;">';
    html += '<div class="card">';
    html += '<div>Выручка</div>';
    html += '<div class="val blue" id="rev">0</div></div>';
    
    html += '<div class="card">';
    html += '<div>Прибыль</div>';
    html += '<div class="val green" id="prof">0</div></div>';
    
    html += `<div class="card" style="border: 2px solid ${accentColor};">`;
    html += '<div>Потери</div>';
    html += '<div class="val red" id="loss">0</div>';
    html += '<div id="pct"></div></div>';
    html += '</div>';
    
    html += '<script>';
    html += 'fetch("/api/warehouse/reports?shop=kupidon")';
    html += '.then(r => r.json()).then(d => {';
    html += '  if (d.ok) {';
    html += '    document.getElementById("load").style.display="none";';
    html += '    document.getElementById("cont").style.display="block";';
    html += '    var r = d.revenue.toLocaleString("ru-RU");';
    html += '    var p = d.profit.toLocaleString("ru-RU");';
    html += '    var l = d.losses.toLocaleString("ru-RU");';
    html += '    document.getElementById("rev").innerText = r + " ₽";';
    html += '    document.getElementById("prof").innerText = p + " ₽";';
    html += '    document.getElementById("loss").innerText = l + " ₽";';
    html += '    document.getElementById("pct").innerText = ';
    html += '      d.lossPercent + "% от закупок";';
    html += '  }';
    html += '});';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 12. API Флористов
  app.get('/api/warehouse/florists', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const r = await pool.query(
        `SELECT chat_id, name, warehouse_pin, can_receipt, ` +
        `can_sale, can_writeoff ` +
        `FROM admins WHERE shop_id = $1 AND role = 'florist'`,
        [shopId]
      );
      res.json({ ok: true, florists: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  app.post('/api/warehouse/florist/pin', async (req, res) => {
    try {
      const shopId = req.body.shop;
      const chatId = req.body.chatId;
      const pin = req.body.pin;
      await pool.query(
        `UPDATE admins SET warehouse_pin = $1 ` +
        `WHERE shop_id = $2 AND chat_id = $3`,
        [pin, shopId, chatId]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  app.post('/api/warehouse/florist/rights', async (req, res) => {
    try {
      const shopId = req.body.shop;
      const chatId = req.body.chatId;
      const val = req.body.val;
      let col = 'can_receipt';
      if (req.body.field === 'sale') col = 'can_sale';
      if (req.body.field === 'writeoff') col = 'can_writeoff';
      
      await pool.query(
        `UPDATE admins SET ` + col + ` = $1 ` +
        `WHERE shop_id = $2 AND chat_id = $3`,
        [val, shopId, chatId]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  // 13. Экран Настроек
  app.get('/warehouse/settings', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += `body { font-family: sans-serif; margin: 0; `;
    html += `padding: 15px; background: #fafaf8; `;
    html += `color: ${brandColor}; }`;
    html += `.header { display: flex; align-items: center; `;
    html += `margin-bottom: 15px; }`;
    html += `.back { font-size: 24px; text-decoration: none; `;
    html += `color: ${brandColor}; margin-right: 15px; }`;
    html += `.card { background: #fff; border-radius: 15px; `;
    html += `padding: 15px; margin-bottom: 15px; }`;
    html += `.row { display: flex; justify-content: space-between; `;
    html += `margin-top: 10px; border-top: 1px solid #eee; `;
    html += `padding-top: 10px; }`;
    html += `.btn-pin { margin-top:10px; padding:8px 15px; `;
    html += `border-radius:8px; border:none; `;
    html += `background:${brandColor}; color:#fff; }`;
    html += `input[type="checkbox"] { transform: scale(1.3); `;
    html += `accent-color: ${brandColor}; }`;
    html += '</style></head><body>';
    
    html += '<div class="header">';
    html += '<a href="/warehouse-app" class="back">←</a>';
    html += '<h1>⚙️ Флористы</h1></div><div id="list"></div>';
    
    html += '<script>';
    html += 'fetch("/api/warehouse/florists?shop=kupidon")';
    html += '.then(r => r.json()).then(d => {';
    html += '  var b = document.getElementById("list");';
    html += '  if (!d.ok || d.florists.length === 0) {';
    html += '    b.innerHTML = "Нет флористов"; return;';
    html += '  }';
    html += '  d.florists.forEach(f => {';
    html += '    var c = document.createElement("div");';
    html += '    c.className = "card";';
    html += '    c.innerHTML = "<b>" + (f.name || "Флорист") + "</b><br>";';
    html += '    c.innerHTML += "PIN: " + (f.warehouse_pin || "нет") + "<br>";';
    html += '    var btn = document.createElement("button");';
    html += '    btn.innerText = "Задать PIN"; btn.className = "btn-pin";';
    html += '    btn.onclick = () => setPin(f.chat_id); c.appendChild(btn);';
    html += '    c.appendChild(makeCheck("Приход", "receipt", f.can_receipt, f.chat_id));';
    html += '    c.appendChild(makeCheck("Продажа", "sale", f.can_sale, f.chat_id));';
    html += '    c.appendChild(makeCheck("Списание", "writeoff", f.can_writeoff, f.chat_id));';
    html += '    b.appendChild(c);';
    html += '  });';
    html += '});';
    
    html += 'function makeCheck(label, field, checked, chatId) {';
    html += '  var r = document.createElement("div");';
    html += '  r.className = "row"; r.innerHTML = "<span>" + label + "</span>";';
    html += '  var cb = document.createElement("input");';
    html += '  cb.type = "checkbox"; cb.checked = checked;';
    html += '  cb.onchange = () => setRights(chatId, field, cb.checked);';
    html += '  r.appendChild(cb); return r;';
    html += '}';
    
    html += 'function setPin(id) {';
    html += '  var p = prompt("Введите 4 цифры:");';
    html += '  if (p && p.length === 4) {';
    html += '    fetch("/api/warehouse/florist/pin", {';
    html += '      method: "POST",';
    html += '      headers: { "Content-Type": "application/json" },';
    html += '      body: JSON.stringify({ shop: "kupidon", ';
    html += '        chatId: id, pin: p })';
    html += '    }).then(() => location.reload());';
    html += '  }';
    html += '}';
    
    html += 'function setRights(id, field, val) {';
    html += '  fetch("/api/warehouse/florist/rights", {';
    html += '    method: "POST",';
    html += '    headers: { "Content-Type": "application/json" },';
    html += '    body: JSON.stringify({ shop: "kupidon", ';
    html += '      chatId: id, field: field, val: val })';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

  // 14. API Отмены продажи
  app.post('/api/warehouse/sale/cancel', async (req, res) => {
    try {
      const shopId = req.body.shopId;
      const saleId = req.body.saleId;
      const action = req.body.action;
      
      const itemsRes = await pool.query(
        `SELECT shop_item_id, qty FROM wh_sale_items ` +
        `WHERE sale_id = $1`, [saleId]
      );
      
      for (let i = 0; i < itemsRes.rows.length; i++) {
        const item = itemsRes.rows[i];
        if (action === 'return') {
          await pool.query(
            `UPDATE wh_shop_items SET ` +
            `current_stock = current_stock + $1 WHERE id = $2`,
            [item.qty, item.shop_item_id]
          );
        } else {
          await pool.query(
            `INSERT INTO wh_writeoffs ` +
            `(shop_id, shop_item_id, qty, reason, comment, date) ` +
            `VALUES ($1, $2, $3, $4, $5, NOW())`,
            [shopId, item.shop_item_id, item.qty, 'loss', 'Отмена']
          );
        }
      }
      
      await pool.query(
        `DELETE FROM wh_sale_items WHERE sale_id = $1`, [saleId]
      );
      await pool.query(
        `DELETE FROM wh_sales WHERE id = $1`, [saleId]
      );
      
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  // 15. API Истории
  app.get('/api/warehouse/history', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      
      const sales = await pool.query(
        `SELECT id, real_price as amount, date, ` +
        `'sale' as type FROM wh_sales ` +
        `WHERE shop_id = $1 ORDER BY date DESC LIMIT 15`, [shopId]
      );
      
      const writeoffs = await pool.query(
        `SELECT id, qty, date, reason, ` +
        `'writeoff' as type FROM wh_writeoffs ` +
        `WHERE shop_id = $1 ORDER BY date DESC LIMIT 15`, [shopId]
      );
      
      let list = [...sales.rows, ...writeoffs.rows];
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      res.json({ ok: true, history: list });
    } catch (e) {
      res.status(500).json({ ok: false });
    }
  });

  // 16. Экран Истории
  app.get('/warehouse/history', (req, res) => {
    let html = '<!DOCTYPE html><html><head>';
    html += '<meta charset="UTF-8">';
    html += '<meta name="viewport" ';
    html += 'content="width=device-width, initial-scale=1.0">';
    html += '<style>';
    html += `body { font-family: sans-serif; margin: 0; `;
    html += `padding: 15px; background: #fafaf8; `;
    html += `color: ${brandColor}; }`;
    html += `.header { display: flex; align-items: center; `;
    html += `margin-bottom: 15px; }`;
    html += `.back { font-size: 24px; text-decoration: none; `;
    html += `color: ${brandColor}; margin-right: 15px; }`;
    html += `.item { background: #fff; border-radius: 10px; `;
    html += `padding: 15px; margin-bottom: 10px; `;
    html += `display: flex; justify-content: space-between; }`;
    html += `.item.sale { border-left: 4px solid #27ae60; }`;
    html += `.item.writeoff { border-left: 4px solid ${accentColor}; }`;
    html += `.date { font-size: 11px; color: #888; }`;
    html += `.amount { font-weight: bold; font-size: 16px; }`;
    html += `.btn-cancel { background: #fff; `;
    html += `border: 1px solid #e74c3c; color: #e74c3c; `;
    html += `border-radius: 5px; padding: 5px 10px; `;
    html += `font-size: 12px; margin-left: 10px; }`;
    html += '</style></head><body>';
    
    html += '<div class="header">';
    html += '<a href="/warehouse-app" class="back">←</a>';
    html += '<h1>📋 История</h1></div>';
    html += '<div id="list">Загрузка...</div>';
    
    html += '<script>';
    html += 'fetch("/api/warehouse/history?shop=kupidon")';
    html += '.then(r => r.json()).then(d => {';
    html += '  var b = document.getElementById("list"); b.innerHTML = "";';
    html += '  if (!d.ok || d.history.length === 0) {';
    html += '    b.innerHTML = "История пуста"; return;';
    html += '  }';
    html += '  d.history.forEach(h => {';
    html += '    var div = document.createElement("div");';
    html += '    var dObj = new Date(h.date);';
    html += '    var ds = dObj.toLocaleString("ru-RU", {';
    html += '      day: "2-digit", month: "2-digit", ';
    html += '      hour: "2-digit", minute: "2-digit" });';
    
    html += '    if (h.type === "sale") {';
    html += '      div.className = "item sale";';
    html += '      div.innerHTML = "<div><b>💰 Продажа</b>";';
    html += '      div.innerHTML += "<div class=\'date\'>" + ds + "</div></div>";';
    html += '      var btn = "<button class=\'btn-cancel\' ";';
    html += '      btn += "onclick=\'cancelSale(" + h.id + ")\'>Отменить</button>";';
    html += '      div.innerHTML += "<div style=\'display:flex;\'>";';
    html += '      div.innerHTML += "<div class=\'amount\'>+" + ';
    html += '        h.amount.toLocaleString("ru-RU") + " ₽</div>";';
    html += '      div.innerHTML += btn + "</div>";';
    html += '    } else {';
    html += '      div.className = "item writeoff";';
    html += '      div.innerHTML = "<div><b>🗑 Списание</b>";';
    html += '      div.innerHTML += " (" + h.reason + ")";';
    html += '      div.innerHTML += "<div class=\'date\'>" + ds + "</div></div>";';
    html += '      div.innerHTML += "<div class=\'amount\' ";';
    html += `      div.innerHTML += "style='color:${accentColor}'>`;`;
    html += '      div.innerHTML += "-" + h.qty + " шт</div>";';
    html += '    }';
    html += '    b.appendChild(div);';
    html += '  });';
    html += '});';

    html += 'function cancelSale(id) {';
    html += '  var ret = confirm("Вернуть товары на склад?\\n\\n";';
    html += '    + "ОК = вернуть. Отмена = списать.");';
    html += '  fetch("/api/warehouse/sale/cancel", {';
    html += '    method: "POST",';
    html += '    headers: { "Content-Type": "application/json" },';
    html += '    body: JSON.stringify({ shopId: "kupidon", ';
    html += '      saleId: id, action: ret ? "return" : "writeoff" })';
    html += '  }).then(r => r.json()).then(d => {';
    html += '    if (d.ok) { alert("Отменено"); location.reload(); }';
    html += '    else alert("Ошибка");';
    html += '  });';
    html += '}';
    html += '<\/script></body></html>';
    res.send(html);
  });

}
module.exports = { setupWarehouse };