const pool = require('./db');

function setupWarehouse(app) {
  
  const brandColor = '#124444'; // Тёмно-бирюзовый (основной)
  const accentColor = '#E08567'; // Терракотовый (акцент)

  // 1. Главный экран склада
  app.get('/warehouse-app', async (req, res) => {
    try {
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatIdStr = match ? match[1] : null;
      const chatId = chatIdStr ? Number(chatIdStr) : null;
      if (!chatId) return res.redirect('/warehouse-login?shop=kupidon');

      const r = await pool.query(
        `SELECT role, name, shop_id, can_receipt, can_sale, can_writeoff ` +
        `FROM admins WHERE chat_id = $1 LIMIT 1`, [chatId]
      );
      if (r.rows.length === 0) return res.redirect('/warehouse-login?shop=kupidon');

      const user = r.rows[0];
      const isOwner = user.role === 'owner';
      const userName = user.name || 'Флорист';
      const canSale = user.can_sale === true;
      const canWriteoff = user.can_writeoff === true;
      const canReceipt = user.can_receipt === true;

      let html = `
        <!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <script src="https://telegram.org/js/telegram-web-app.js"><\/script>
        <style>
          body { font-family: -apple-system, sans-serif; margin: 0; padding: 20px; background: #fafaf8; color: ${brandColor}; text-align: center; }
          .header { background: #fff; padding: 20px; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); margin-bottom: 20px; border-bottom: 4px solid ${brandColor}; }
          h1 { margin: 0; font-size: 24px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
          .btn { background: #fff; padding: 20px 10px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-decoration: none; color: ${brandColor}; font-weight: bold; font-size: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid #eee; }
          .btn span { font-size: 28px; margin-bottom: 8px; }
          .full { grid-column: 1 / -1; }
        </style></head><body>
        <div class="header">
          <h1>📦 Склад</h1>
          <p style="color:#888;margin:5px 0 0;">Вы вошли как: <b>${userName}</b> (${isOwner ? 'Владелец' : 'Флорист'})</p>
        </div>
        <div class="grid">
          ${(isOwner || canSale) ? '<a href="/warehouse/sale" class="btn"><span>💰</span>Продажа</a>' : ''}
          ${(isOwner || canWriteoff) ? '<a href="/warehouse/writeoff" class="btn"><span>🗑</span>Списание</a>' : ''}
          ${(isOwner || canReceipt) ? '<a href="/warehouse/receipt" class="btn"><span>📥</span>Приход</a>' : ''}
          <a href="/warehouse/history" class="btn"><span>📋</span>История</a>
          ${isOwner ? '<a href="/warehouse/reports" class="btn"><span>📊</span>Отчёты</a>' : ''}
          ${isOwner ? '<a href="/warehouse/settings" class="btn full"><span>⚙️</span>Настройки</a>' : ''}
        </div>
        <script>Telegram.WebApp.ready();<\/script>
        </body></html>
      `;
      res.send(html);
    } catch (e) { res.status(500).send('Ошибка сервера'); }
  });

  // 2. Вход
  app.get('/warehouse-login', (req, res) => {
    const shopId = req.query.shop || '';
    let html = `
      <!DOCTYPE html><html><head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: sans-serif; text-align: center; padding: 50px 20px; background: #fafaf8; }
        .card { background: #fff; border-radius: 20px; padding: 30px; max-width: 400px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border-bottom: 5px solid ${brandColor}; }
        input { font-size: 24px; padding: 10px; width: 120px; text-align: center; border: 2px solid #ddd; border-radius: 10px; margin: 20px 0; }
        button { background: ${brandColor}; color: white; border: none; padding: 15px 40px; font-size: 18px; border-radius: 30px; font-weight: bold; }
      </style></head><body>
      <div class="card"><h1>📦 Склад</h1><p>Введите PIN-код</p>
      <input type="password" id="pin" maxlength="4" inputmode="numeric" placeholder="****">
      <br><button onclick="login()">Войти</button></div>
      <script>
        function login() {
          var pin = document.getElementById("pin").value;
          fetch("/api/warehouse/auth", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shopId: "${shopId}", pin: pin })
          }).then(r => r.json()).then(data => {
            if (data.ok) window.location.href = "/warehouse-app";
            else alert("Неверный PIN-код");
          });
        }
      <\/script></body></html>
    `;
    res.send(html);
  });

  // 3. API Авторизации
  app.post('/api/warehouse/auth', async (req, res) => {
    try {
      const { shopId, pin } = req.body;
      const r = await pool.query(
        `SELECT chat_id, role FROM admins WHERE shop_id = $1 AND warehouse_pin = $2`,
        [shopId, pin]
      );
      if (r.rows.length === 0) return res.json({ ok: false });
      res.setHeader('Set-Cookie', 'wh_auth=' + r.rows[0].chat_id + '; Path=/; Max-Age=2592000; HttpOnly');
      res.json({ ok: true, role: r.rows[0].role });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 4. API Товаров
  app.get('/api/warehouse/items', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const r = await pool.query(
        `SELECT i.id, i.current_stock, COALESCE(i.custom_name, w.name) AS name, w.photo_url ` +
        `FROM wh_shop_items i JOIN wh_items w ON w.id = i.item_id ` +
        `WHERE i.shop_id = $1 AND i.current_stock > 0`, [shopId]
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 5. API Продажи
  app.post('/api/warehouse/sale', async (req, res) => {
    try {
      const { shopId, real_price, items } = req.body;
      const cookie = req.headers.cookie || '';
      const match = cookie.match(/wh_auth=(\d+)/);
      const chatId = match ? Number(match[1]) : null;

      const saleRes = await pool.query(
        `INSERT INTO wh_sales (shop_id, real_price, chat_id) VALUES ($1, $2, $3) RETURNING id`, 
        [shopId, real_price, chatId]
      );
      const saleId = saleRes.rows[0].id;
      
      for (var item of items) {
        await pool.query(`UPDATE wh_shop_items SET current_stock = current_stock - $1 WHERE id = $2`, [item.qty, item.id]);
        const costQ = await pool.query(`SELECT avg_cost FROM wh_shop_items WHERE id = $1`, [item.id]);
        await pool.query(`INSERT INTO wh_sale_items (sale_id, shop_item_id, qty, cost_at_sale) VALUES ($1, $2, $3, $4)`, [saleId, item.id, item.qty, costQ.rows[0].avg_cost || 0]);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 6. Экран Продажи
  app.get('/warehouse/sale', (req, res) => {
    let html = `
      <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
        body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ${brandColor}; }
        .header { display: flex; align-items: center; margin-bottom: 15px; }
        .back { font-size: 24px; text-decoration: none; color: ${brandColor}; margin-right: 15px; }
        .search { width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 10px; font-size: 16px; margin-bottom: 15px; box-sizing: border-box; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-bottom: 20px; }
        .card { background: #fff; padding: 8px; border-radius: 10px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05); cursor: pointer; }
        .card img { width: 100%; height: 80px; object-fit: cover; border-radius: 6px; margin-bottom: 5px; }
        .card .ph { height: 80px; font-size: 30px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; }
        .card .name { font-size: 12px; font-weight: bold; margin-bottom: 2px; }
        .card .stock { font-size: 11px; color: #27ae60; }
        .basket { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; border: 2px solid ${brandColor}; display: none; }
        .b-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
        .btn-save { width: 100%; padding: 15px; background: ${brandColor}; color: #fff; border: none; border-radius: 10px; font-size: 18px; font-weight: bold; margin-top: 10px; }
      </style></head><body>
      <div class="header"><a href="/warehouse-app" class="back">←</a><h1>💰 Продажа</h1></div>
      <div class="basket" id="basket">
        <h3 style="margin-top:0; font-size:16px;">Выбрано:</h3><div id="bList"></div>
        <label style="font-size:12px; color:#666;">Сумма продажи</label>
        <input type="number" id="totalPrice" step="0.01" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; margin-top:5px; box-sizing:border-box; font-size:16px;" placeholder="0">
        <button class="btn-save" onclick="saveSale()">Продать</button>
      </div>
      <input type="text" class="search" id="search" placeholder="🔍 Поиск..." onkeyup="filterItems()">
      <div class="grid" id="itemsGrid"></div>
      <script>
        var allItems = []; var cart = [];
        fetch("/api/warehouse/items?shop=kupidon").then(r => r.json()).then(d => { allItems = d.items; render(allItems); });
        function render(items) {
          var g = document.getElementById("itemsGrid"); g.innerHTML = "";
          items.forEach(item => {
            var div = document.createElement("div"); div.className = "card";
            var img = item.photo_url ? '<img src="' + item.photo_url + '">' : '<div class="ph">📷</div>';
            div.innerHTML = img + '<div class="name">' + item.name + '</div><div class="stock">Ост: ' + item.current_stock + '</div>';
            div.onclick = function() { addToCart(item); }; g.appendChild(div);
          });
        }
        function filterItems() { var q = document.getElementById("search").value.toLowerCase(); render(allItems.filter(i => i.name.toLowerCase().includes(q))); }
        function addToCart(item) {
          var ex = cart.find(c => c.id === item.id);
          if (ex) ex.qty += 1; else cart.push({ id: item.id, name: item.name, qty: 1 });
          renderBasket();
        }
        function renderBasket() {
          var b = document.getElementById("basket"); var list = document.getElementById("bList");
          if (cart.length === 0) { b.style.display = "none"; return; }
          b.style.display = "block"; list.innerHTML = "";
          cart.forEach((item, idx) => {
            var div = document.createElement("div"); div.className = "b-row";
            div.innerHTML = '<span style="font-size:14px;">' + item.name + '</span>' +
              '<input type="number" step="0.1" value="' + item.qty + '" onchange="upQty(' + idx + ', this.value)" style="width:60px; text-align:center; border:1px solid #ddd; border-radius:5px;">' +
              '<button onclick="cart.splice(' + idx + ', 1); renderBasket();" style="border:none; background:none; color:red; font-size:20px;">✕</button>';
            list.appendChild(div);
          });
        }
        function upQty(idx, val) { var v = parseFloat(val); if (isNaN(v) || v <= 0) v = 1; cart[idx].qty = v; }
        function saveSale() {
          var total = document.getElementById("totalPrice").value;
          if (!total) { alert("Введите сумму"); return; }
          fetch("/api/warehouse/sale", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shopId: "kupidon", real_price: total, items: cart })
          }).then(r => r.json()).then(d => { if (d.ok) { alert("Продано!"); window.location.href="/warehouse-app"; } else alert("Ошибка"); });
        }
      <\/script></body></html>
    `;
    res.send(html);
  });

  // 7. Экран Прихода
  app.get('/warehouse/receipt', (req, res) => {
    let html = `
      <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
        body { font-family: sans-serif; margin: 0; padding: 20px; background: #fafaf8; color: ${brandColor}; }
        .header { display: flex; align-items: center; margin-bottom: 15px; }
        .back { font-size: 24px; text-decoration: none; color: ${brandColor}; margin-right: 15px; }
        .card { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        label { display: block; font-size: 12px; color: #888; margin-bottom: 5px; }
        input[type="text"], input[type="number"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; margin-bottom: 15px; box-sizing: border-box; }
        .btn-save { width: 100%; background: ${brandColor}; color: #fff; border: none; padding: 15px; border-radius: 10px; font-size: 18px; font-weight: bold; }
      </style></head><body>
      <div class="header"><a href="/warehouse-app" class="back">←</a><h1>📥 Приход</h1></div>
      <div class="card">
        <label>Название</label><input type="text" id="itemName" placeholder="Роза">
        <label>Количество (можно 0.5)</label><input type="number" id="itemQty" step="0.1" placeholder="0">
        <label>Цена закупки</label><input type="number" id="itemPrice" placeholder="0">
        <label>Фото (необязательно)</label><input type="file" id="itemPhoto" accept="image/*">
      </div>
      <button class="btn-save" onclick="saveReceipt()">Добавить</button>
      <script>
        function saveReceipt() {
          var name = document.getElementById("itemName").value;
          var qty = document.getElementById("itemQty").value;
          var price = document.getElementById("itemPrice").value;
          if (!name || !qty || !price) { alert("Заполните поля"); return; }
          var file = document.getElementById("itemPhoto").files[0];
          if (file) {
            var reader = new FileReader();
            reader.onload = function(e) { upload(e.target.result, name, qty, price); };
            reader.readAsDataURL(file);
          } else submit(name, qty, price, null, null);
        }
        function upload(base64, name, qty, price) {
          fetch("/api/warehouse/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: base64 }) })
          .then(r => r.json()).then(d => { submit(name, qty, price, d.url, d.urlBackup); })
          .catch(() => { submit(name, qty, price, null, null); });
        }
        function submit(name, qty, price, url, url2) {
          fetch("/api/warehouse/receipt", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shopId: "kupidon", name: name, qty: qty, price: price, photo: url, photoBackup: url2 })
          }).then(r => r.json()).then(d => { if (d.ok) { alert("Добавлено!"); window.location.href="/warehouse-app"; } else alert("Ошибка"); });
        }
      <\/script></body></html>
    `;
    res.send(html);
  });

  // 8. API Списания
  app.post('/api/warehouse/writeoff', async (req, res) => {
    try {
      const { shopId, items, reason, comment, photo } = req.body;
      for (var item of items) {
        await pool.query(`UPDATE wh_shop_items SET current_stock = current_stock - $1 WHERE id = $2`, [item.qty, item.id]);
        await pool.query(`INSERT INTO wh_writeoffs (shop_id, shop_item_id, qty, reason, comment, photo_url) VALUES ($1, $2, $3, $4, $5, $6)`, [shopId, item.id, item.qty, reason, comment, photo]);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 9. Экран Списания (с фото)
  app.get('/warehouse/writeoff', (req, res) => {
    let html = `
      <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
        body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ${brandColor}; }
        .header { display: flex; align-items: center; margin-bottom: 15px; }
        .back { font-size: 24px; text-decoration: none; color: ${brandColor}; margin-right: 15px; }
        .search { width: 100%; padding: 12px; border: 2px solid #eee; border-radius: 10px; margin-bottom: 15px; box-sizing: border-box; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; margin-bottom: 15px; }
        .card { background: #fff; padding: 8px; border-radius: 10px; text-align: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
        .card img { width: 100%; height: 80px; object-fit: cover; border-radius: 6px; margin-bottom: 5px; }
        .card .ph { height: 80px; font-size: 30px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; }
        .card .name { font-size: 12px; font-weight: bold; margin-bottom: 2px; }
        .reasons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
        .reason { padding: 12px; border-radius: 10px; border: 2px solid #eee; background: #fff; text-align: center; }
        .reason.active { border-color: ${accentColor}; color: ${accentColor}; font-weight: bold; }
        .btn-save { width: 100%; padding: 15px; background: ${accentColor}; color: #fff; border: none; border-radius: 10px; font-size: 18px; font-weight: bold; margin-top: 15px; }
      </style></head><body>
      <div class="header"><a href="/warehouse-app" class="back">←</a><h1>🗑 Списание</h1></div>
      <input type="text" class="search" id="search" placeholder="🔍 Поиск..." onkeyup="filterItems()">
      <div class="grid" id="itemsGrid"></div>
      <div id="form" style="display:none;">
        <h3>Причина</h3><div class="reasons">
          <div class="reason active" onclick="setR(this,'spoilage')">Порча</div>
          <div class="reason" onclick="setR(this,'loss')">Потеря</div>
          <div class="reason" onclick="setR(this,'markdown')">Уценка</div>
          <div class="reason" onclick="setR(this,'sorting')">Пересорт</div>
        </div>
        <label>Комментарий</label><textarea id="comment" style="width:100%; padding:10px; border-radius:10px; border:1px solid #ddd; margin-bottom:10px; box-sizing:border-box;"></textarea>
        <label>Фото (необязательно)</label><input type="file" id="wPhoto" accept="image/*" style="margin-bottom:15px;">
        <button class="btn-save" onclick="saveWriteoff()">Списать</button>
      </div>
      <script>
        var allItems = []; var selItem = null; var selReason = "spoilage";
        fetch("/api/warehouse/items?shop=kupidon").then(r => r.json()).then(d => { allItems = d.items; render(); });
        function render() { drawCards(allItems); }
        function filterItems() { var q = document.getElementById("search").value.toLowerCase(); drawCards(allItems.filter(i => i.name.toLowerCase().includes(q))); }
        function drawCards(items) {
          var g = document.getElementById("itemsGrid"); g.innerHTML = "";
          items.forEach(i => {
            var d = document.createElement("div"); d.className = "card";
            var img = i.photo_url ? '<img src="' + i.photo_url + '">' : '<div class="ph">📷</div>';
            d.innerHTML = img + '<div class="name">' + i.name + '</div>Ост: ' + i.current_stock;
            d.onclick = () => selectItem(i); g.appendChild(d);
          });
        }
        function selectItem(item) { var q = prompt("Сколько списать?", "1"); if (q && parseFloat(q) > 0) { selItem = { id: item.id, qty: parseFloat(q) }; document.getElementById("form").style.display = "block"; } }
        function setR(el, r) { document.querySelectorAll(".reason").forEach(b => b.classList.remove("active")); el.classList.add("active"); selReason = r; }
        function saveWriteoff() {
          if (!selItem) return; var c = document.getElementById("comment").value;
          var f = document.getElementById("wPhoto").files[0];
          if (f) { var rd = new FileReader(); rd.onload = e => upload(e.target.result, c); rd.readAsDataURL(f); }
          else submit(null, c);
        }
        function upload(base64, c) { fetch("/api/warehouse/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: base64 }) }).then(r => r.json()).then(d => submit(d.url, c)).catch(() => submit(null, c)); }
        function submit(url, c) { fetch("/api/warehouse/writeoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId: "kupidon", items: [selItem], reason: selReason, comment: c, photo: url }) }).then(r => r.json()).then(d => { if (d.ok) { alert("Списано!"); window.location.href="/warehouse-app"; } }); }
      <\/script></body></html>
    `;
    res.send(html);
  });

  // 9.1 API для получения загрузки фото (этот роут нужен для Прихода и Списания)
  app.post('/api/warehouse/upload', async (req, res) => {
    try {
      const base64Data = req.body.image;
      if (!base64Data) return res.json({ ok: false });
      const base64Image = base64Data.split(';base64,').pop();
      const buffer = Buffer.from(base64Image, 'base64');
      const key = 'wh_' + Date.now() + '.jpg';
      const cmd = new PutObjectCommand({ Bucket: YC_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg' });
      await s3.send(cmd);
    const url = `https://${YC_BUCKET}.storage.yandexcloud.net/${key}`;
      let urlBackup = null;
      if (s3backup) {
        const cmd2 = new PutObjectCommand({ Bucket: BC_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg' });
        await s3backup.send(cmd2);
        urlBackup = BC_ENDPOINT + '/' + BC_BUCKET + '/' + key;
      }
      res.json({ ok: true, url: url, urlBackup: urlBackup });
    } catch (e) { res.status(500).json({ ok: false }); }
  });
  // 10. API Отчётов
  app.get('/api/warehouse/reports', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const rev = await pool.query(`SELECT COALESCE(SUM(real_price), 0) AS total FROM wh_sales WHERE shop_id = $1`, [shopId]);
      const loss = await pool.query(`SELECT COALESCE(SUM(w.qty * i.avg_cost), 0) AS total FROM wh_writeoffs w JOIN wh_shop_items i ON i.id = w.shop_item_id WHERE w.shop_id = $1`, [shopId]);
      const cost = await pool.query(`SELECT COALESCE(SUM(s.qty * s.cost_at_sale), 0) AS total FROM wh_sale_items s JOIN wh_sales sa ON sa.id = s.sale_id WHERE sa.shop_id = $1`, [shopId]);
      const revenue = parseInt(rev.rows[0].total) || 0; const losses = parseInt(loss.rows[0].total) || 0; const costVal = parseInt(cost.rows[0].total) || 0;
      const profit = revenue - costVal;
      const lossPercent = (revenue + losses) > 0 ? Math.round((losses / (revenue + losses)) * 100) : 0;
      res.json({ ok: true, revenue, profit, losses, lossPercent });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 11. Экран Отчётов
  app.get('/warehouse/reports', (req, res) => {
    let html = `
      <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
        body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ${brandColor}; }
        .header { display: flex; align-items: center; margin-bottom: 15px; }
        .back { font-size: 24px; text-decoration: none; color: ${brandColor}; margin-right: 15px; }
        .card { background: #fff; border-radius: 15px; padding: 20px; margin-bottom: 15px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        .val { font-size: 28px; font-weight: bold; margin: 5px 0; } 
        .blue { color: #2980b9; } .green { color: #27ae60; } .red { color: ${accentColor}; }
      </style></head><body>
      <div class="header"><a href="/warehouse-app" class="back">←</a><h1>📊 Отчёты</h1></div>
      <div id="load" style="text-align:center;">Загрузка...</div>
      <div id="cont" style="display:none;">
        <div class="card"><div>Выручка</div><div class="val blue" id="rev">0</div></div>
        <div class="card"><div>Прибыль</div><div class="val green" id="prof">0</div></div>
        <div class="card" style="border: 2px solid ${accentColor};"><div>Потери</div><div class="val red" id="loss">0</div><div id="pct"></div></div>
      </div>
      <script>
        fetch("/api/warehouse/reports?shop=kupidon").then(r => r.json()).then(d => {
          if (d.ok) {
            document.getElementById("load").style.display = "none";
            document.getElementById("cont").style.display = "block";
            document.getElementById("rev").innerText = d.revenue.toLocaleString("ru-RU") + " ₽";
            document.getElementById("prof").innerText = d.profit.toLocaleString("ru-RU") + " ₽";
            document.getElementById("loss").innerText = d.losses.toLocaleString("ru-RU") + " ₽";
            document.getElementById("pct").innerText = d.lossPercent + "% от закупок";
          }
        });
      <\/script></body></html>
    `;
    res.send(html);
  });

  // 12. API Флористов и Настроек
  app.get('/api/warehouse/florists', async (req, res) => {
    try { const r = await pool.query(`SELECT chat_id, name, warehouse_pin, can_receipt, can_sale, can_writeoff FROM admins WHERE shop_id = $1 AND role = 'florist'`, [req.query.shop || 'kupidon']); res.json({ ok: true, florists: r.rows }); } catch(e) { res.status(500).json({ ok: false }); }
  });
  app.post('/api/warehouse/florist/pin', async (req, res) => {
    try { await pool.query(`UPDATE admins SET warehouse_pin = $1 WHERE shop_id = $2 AND chat_id = $3`, [req.body.pin, req.body.shop, req.body.chatId]); res.json({ ok: true }); } catch(e) { res.status(500).json({ ok: false }); }
  });
  app.post('/api/warehouse/florist/rights', async (req, res) => {
    try { const col = req.body.field === 'sale' ? 'can_sale' : req.body.field === 'writeoff' ? 'can_writeoff' : 'can_receipt'; await pool.query(`UPDATE admins SET ` + col + ` = $1 WHERE shop_id = $2 AND chat_id = $3`, [req.body.val, req.body.shop, req.body.chatId]); res.json({ ok: true }); } catch(e) { res.status(500).json({ ok: false }); }
  });

  // 13. Экран Настроек (фирменные цвета)
  app.get('/warehouse/settings', (req, res) => {
    let html = `
      <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
        body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ${brandColor}; } 
        .header { display: flex; align-items: center; margin-bottom: 15px; } 
        .back { font-size: 24px; text-decoration: none; color: ${brandColor}; margin-right: 15px; }
        .card { background: #fff; border-radius: 15px; padding: 15px; margin-bottom: 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); } 
        .row { display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; }
        .btn-pin { margin-top:10px; padding:8px 15px; border-radius:8px; border:none; background:${brandColor}; color:#fff; font-weight: bold; }
        input[type="checkbox"] { transform: scale(1.3); accent-color: ${brandColor}; }
      </style></head><body>
      <div class="header"><a href="/warehouse-app" class="back">←</a><h1>⚙️ Флористы</h1></div><div id="list"></div>
      <script>
        fetch("/api/warehouse/florists?shop=kupidon").then(r => r.json()).then(d => {
          var b = document.getElementById("list");
          if (!d.ok || d.florists.length === 0) { b.innerHTML = "Нет флористов"; return; }
          d.florists.forEach(f => {
            var c = document.createElement("div"); c.className = "card";
            c.innerHTML = "<b>" + (f.name || "Флорист") + "</b><br>PIN: " + (f.warehouse_pin || "не задан") + "<br>";
            var btn = document.createElement("button"); btn.innerText = "Задать PIN"; btn.className = "btn-pin";
            btn.onclick = () => setPin(f.chat_id); c.appendChild(btn);
            c.appendChild(makeCheck("Приход", "receipt", f.can_receipt, f.chat_id));
            c.appendChild(makeCheck("Продажа", "sale", f.can_sale, f.chat_id));
            c.appendChild(makeCheck("Списание", "writeoff", f.can_writeoff, f.chat_id));
            b.appendChild(c);
          });
        });
        function makeCheck(label, field, checked, chatId) {
          var r = document.createElement("div"); r.className = "row"; r.innerHTML = "<span>" + label + "</span>";
          var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = checked; 
          cb.onchange = () => setRights(chatId, field, cb.checked); r.appendChild(cb); return r;
        }
        function setPin(id) {
          var p = prompt("Введите 4 цифры:");
          if (p && p.length === 4) {
            fetch("/api/warehouse/florist/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", chatId: id, pin: p }) }).then(() => location.reload());
          }
        }
        function setRights(id, field, val) {
          fetch("/api/warehouse/florist/rights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: "kupidon", chatId: id, field: field, val: val }) });
        }
      <\/script></body></html>
    `;
    res.send(html);
  });

  // 14. API Истории операций
  app.get('/api/warehouse/history', async (req, res) => {
    try {
      const shopId = req.query.shop || 'kupidon';
      const sales = await pool.query(`SELECT id, real_price as amount, date, chat_id, 'sale' as type FROM wh_sales WHERE shop_id = $1 ORDER BY date DESC LIMIT 15`, [shopId]);
      const writeoffs = await pool.query(`SELECT id, qty, date, reason, 'writeoff' as type FROM wh_writeoffs WHERE shop_id = $1 ORDER BY date DESC LIMIT 15`, [shopId]);
      
      let list = [...sales.rows, ...writeoffs.rows];
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      res.json({ ok: true, history: list });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // 15. Экран Истории операций
  app.get('/warehouse/history', (req, res) => {
    let html = `
      <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
        body { font-family: sans-serif; margin: 0; padding: 15px; background: #fafaf8; color: ${brandColor}; }
        .header { display: flex; align-items: center; margin-bottom: 15px; }
        .back { font-size: 24px; text-decoration: none; color: ${brandColor}; margin-right: 15px; }
        .item { background: #fff; border-radius: 10px; padding: 15px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
        .item.sale { border-left: 4px solid #27ae60; }
        .item.writeoff { border-left: 4px solid ${accentColor}; }
        .info { text-align: left; }
        .date { font-size: 11px; color: #888; margin-top: 5px; }
        .amount { font-weight: bold; font-size: 16px; }
      </style></head><body>
      <div class="header"><a href="/warehouse-app" class="back">←</a><h1>📋 История</h1></div>
      <div id="list">Загрузка...</div>
      <script>
        fetch("/api/warehouse/history?shop=kupidon").then(r => r.json()).then(d => {
          var b = document.getElementById("list"); b.innerHTML = "";
          if (!d.ok || d.history.length === 0) { b.innerHTML = "История пуста"; return; }
          
          d.history.forEach(h => {
            var div = document.createElement("div");
            var dateStr = new Date(h.date).toLocaleString("ru-RU", { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            
            if (h.type === 'sale') {
              div.className = "item sale";
              div.innerHTML = "<div class='info'><b>💰 Продажа</b><div class='date'>" + dateStr + "</div></div>" +
                              "<div class='amount'>+" + h.amount.toLocaleString("ru-RU") + " ₽</div>";
            } else {
              div.className = "item writeoff";
              div.innerHTML = "<div class='info'><b>🗑 Списание</b> (" + h.reason + ")<div class='date'>" + dateStr + "</div></div>" +
                              "<div class='amount' style='color:${accentColor}'>-" + h.qty + " шт</div>";
            }
            b.appendChild(div);
          });
        });
      <\/script></body></html>
    `;
    res.send(html);
  });

}
module.exports = { setupWarehouse };