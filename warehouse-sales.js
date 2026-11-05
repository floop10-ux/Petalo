const pool = require('./db');

async function logAction(shopId, chatId, action, details, refId) {
  try {
    await pool.query(
      "INSERT INTO wh_audit_log (shop_id, chat_id, " +
      "action, details, ref_id) VALUES ($1, $2, $3, $4, $5)",
      [shopId, chatId, action, details, refId || null]
    );
  } catch (e) { 
    console.error('Log error:', e.message); 
  }
}

function setupWarehouseSales(app, bot, s3ctx, getAuth) {
  
  // Миграция для idempotency_key (защита от двойных чеков)
  pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_wh_sales_idem " +
    "ON wh_sales (shop_id, idempotency_key) " +
    "WHERE idempotency_key IS NOT NULL"
  ).catch(function(e) { console.error('Migration idem:', e); });

  // ====== ПРОДАЖИ ======
  app.post('/api/warehouse/sale', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { 
        client.release(); 
        return res.status(401).json({ ok: false }); 
      }

      const perm = await client.query(
        "SELECT role, can_sale FROM admins " +
        "WHERE chat_id = $1 AND shop_id = $2", 
        [auth.chatId, auth.shopId]
      );
      
      if (perm.rows.length === 0 || 
          (perm.rows[0].role !== 'owner' && !perm.rows[0].can_sale)) {
        client.release();
        return res.status(403).json({ 
          ok: false, error: 'Нет прав на продажу' 
        });
      }

      const shopId = auth.shopId;
      const chatId = auth.chatId;

      const real_price = parseFloat(
        String(req.body.real_price).replace(',', '.')
      );
      if (!real_price || real_price <= 0) {
        client.release(); 
        return res.json({ ok: false, error: 'Сумма > 0' });
      }

      const items = req.body.items;
      if (!Array.isArray(items) || items.length === 0) {
        client.release(); 
        return res.json({ ok: false, error: 'Корзина пуста' });
      }

      const idempotency_key = req.body.idempotency_key || null;

      const payments = Array.isArray(req.body.payments) ? 
        req.body.payments : [];
        
      let payCash = 0, payCard = 0, payQr = 0;
      payments.forEach(function(p) {
        const amt = Number(p.amount) || 0;
        if (p.method === 'cash') payCash += amt;
        if (p.method === 'card') payCard += amt;
        if (p.method === 'qr') payQr += amt;
      });

      await client.query('BEGIN');
      
      let saleId;
      try {
        const saleRes = await client.query(
          "INSERT INTO wh_sales (shop_id, real_price, chat_id, " +
          "pay_cash, pay_card, pay_qr, idempotency_key, status) " +
          "VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') " +
          "RETURNING id",
          [shopId, real_price, chatId, payCash, payCard, payQr, 
           idempotency_key]
        );
        saleId = saleRes.rows[0].id;
      } catch (err) {
        if (err.code === '23505') { // Unique violation
          await client.query('ROLLBACK'); client.release();
          return res.json({ ok: true, duplicated: true });
        }
        throw err;
      }

      let itemsStr = '';

      for (let i = 0; i < items.length; i++) {
        let item = items[i];
        let qty = parseFloat(String(item.qty).replace(',', '.'));
        
        if (!qty || qty <= 0) continue;
        
        const stockRes = await client.query(
          "SELECT current_stock, avg_cost FROM wh_shop_items " +
          "WHERE id = $1 AND shop_id = $2 FOR UPDATE", 
          [item.id, shopId]
        );
        
        if (stockRes.rows.length === 0) {
          await client.query('ROLLBACK'); client.release();
          return res.json({ ok: false, error: 'Товар не найден' });
        }
        
        await client.query(
          "UPDATE wh_shop_items SET current_stock = " +
          "current_stock - $1, stock_version = stock_version + 1 " +
          "WHERE id = $2 AND shop_id = $3",
          [qty, item.id, shopId]
        );
        
        let costVal = 0;
        if (stockRes.rows[0].avg_cost) {
          costVal = Math.round(
            parseFloat(stockRes.rows[0].avg_cost) * 100
          ) / 100;
        }
        
        await client.query(
          "INSERT INTO wh_sale_items (sale_id, shop_item_id, " +
          "qty, cost_at_sale) VALUES ($1, $2, $3, $4)",
          [saleId, item.id, qty, costVal]
        );
        
        itemsStr += item.name + ' x' + qty + ', ';
      }
      if (itemsStr.length > 2) { itemsStr = itemsStr.slice(0, -2); }

      await client.query('COMMIT');
      client.release();

      await logAction(shopId, chatId, 'sale',
        'Продажа на ' + real_price + ' ₽. Товары: ' + itemsStr, saleId);
        
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      console.error('Sale error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/warehouse/sale/cancel', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { client.release(); return res.status(401).json({ ok: false }); }
      
      const shopId = auth.shopId;
      const saleId = parseInt(req.body.saleId);
      if (!saleId || isNaN(saleId)) {
        client.release(); return res.json({ ok: false, error: 'Неверный ID' });
      }
      
      await client.query('BEGIN');
      const checkSale = await client.query(
        "SELECT status FROM wh_sales WHERE id = $1 " +
        "AND shop_id = $2 FOR UPDATE", [saleId, shopId]
      );
      
      if (checkSale.rows.length === 0) {
        await client.query('ROLLBACK'); client.release();
        return res.json({ ok: false, error: 'Чек не найден' });
      }
      if (checkSale.rows[0].status === 'cancelled') {
        await client.query('ROLLBACK'); client.release();
        return res.json({ ok: false, error: 'Чек уже отменен' });
      }
      
      const itemsRes = await client.query(
        "SELECT shop_item_id, qty FROM wh_sale_items " +
        "WHERE sale_id = $1", [saleId]
      );
      
      for (let i = 0; i < itemsRes.rows.length; i++) {
        const item = itemsRes.rows[i];
        if (item.shop_item_id) {
          await client.query(
            "UPDATE wh_shop_items SET current_stock = " +
            "current_stock + $1, stock_version = stock_version + 1 " +
            "WHERE id = $2 AND shop_id = $3",
            [item.qty, item.shop_item_id, shopId]
          );
        }
      }
      
      await client.query(
        "UPDATE wh_sales SET status = 'cancelled' " +
        "WHERE id = $1 AND shop_id = $2", [saleId, shopId]
      );
      await client.query('COMMIT');
      client.release();
      
      await logAction(shopId, auth.chatId, 'cancel',
        'Возврат продажи (Отмена чека): ID ' + saleId, saleId);
      res.json({ ok: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      client.release();
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== СМЕНЫ ======
  app.post('/api/warehouse/shift', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { client.release(); return res.status(401).json({ ok: false }); }
      
      const shopId = auth.shopId; 
      const chatId = auth.chatId;
      
      await client.query('BEGIN');
      
      if (req.body.action === 'open') {
        // Блокируем, чтобы не открыть две смены одновременно
        const existing = await client.query(
          "SELECT id FROM wh_shifts WHERE shop_id = $1 " +
          "AND chat_id = $2 AND status = 'open' LIMIT 1 FOR UPDATE",
          [shopId, chatId]
        );
        
        if (existing.rows.length > 0) {
          await client.query('ROLLBACK'); client.release();
          return res.json({ ok: false, error: 'Смена уже открыта' });
        }
        
        const startCash = parseFloat(req.body.val) || 0;
        if (startCash < 0) {
          await client.query('ROLLBACK'); client.release();
          return res.json({ ok: false, error: 'Некорректная сумма' });
        }
        
        await client.query(
          "INSERT INTO wh_shifts (shop_id, chat_id, start_cash) " +
          "VALUES ($1, $2, $3)",
          [shopId, chatId, startCash]
        );
      } else {
        const shiftRes = await client.query(
          "SELECT id, start_cash, cash_in, cash_out, open_time " +
          "FROM wh_shifts " +
          "WHERE shop_id = $1 AND chat_id = $2 " +
          "AND status = 'open' ORDER BY open_time DESC LIMIT 1 FOR UPDATE",
          [shopId, chatId]
        );
        
        if (shiftRes.rows.length === 0) {
          await client.query('ROLLBACK'); client.release();
          return res.json({ ok: false, error: 'Смена не найдена' });
        }
        
        const shift = shiftRes.rows[0];
        const salesRes = await client.query(
          "SELECT SUM(pay_cash) as c, SUM(pay_card) as k, " +
          "SUM(pay_qr) as q, SUM(real_price) as t FROM wh_sales " +
          "WHERE shop_id = $1 AND date >= $2 AND status = 'active'",
          [shopId, shift.open_time]
        );
        
        const st = salesRes.rows[0];
        const cash = parseFloat(st.c || 0);
        const total = parseFloat(st.t || 0);
        
        const startCash = parseFloat(shift.start_cash);
        const cashIn = parseFloat(shift.cash_in) || 0;
        const cashOut = parseFloat(shift.cash_out) || 0;
        
        const expected = startCash + cash + cashIn - cashOut;
        const actual = parseFloat(req.body.val);
        
        if (isNaN(actual)) {
          await client.query('ROLLBACK'); client.release();
          return res.json({ ok: false, error: 'Некорректная сумма' });
        }
        
        const discrepancy = actual - expected;
        await client.query(
          "UPDATE wh_shifts SET close_time = NOW(), " +
          "end_cash_fact = $1, total_sales = $2, " +
          "cash_sales = $3, card_sales = $4, qr_sales = $5, " +
          "discrepancy = $6, status = 'closed' WHERE id = $7",
          [actual, total, cash, parseFloat(st.k || 0),
           parseFloat(st.q || 0), discrepancy, shift.id]
        );
        
        await logAction(shopId, chatId, 'shift',
          'Закрыта смена. Расхождение: ' + discrepancy);
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

  app.post('/api/warehouse/shift/cash', async (req, res) => {
    const client = await pool.connect();
    try {
      const auth = getAuth(req);
      if (!auth) { client.release(); return res.status(401).json({ ok: false }); }
      
      const shopId = auth.shopId; 
      const chatId = auth.chatId;
      const type = String(req.body.type);
      const amount = parseFloat(req.body.amount);
      const comment = req.body.comment || '';
      
      // Строгая проверка type
      if (type !== 'in' && type !== 'out') {
        client.release(); return res.json({ ok: false, error: 'Неверный тип' });
      }
      if (!amount || amount <= 0) {
        client.release(); return res.json({ ok: false, error: 'Неверная сумма' });
      }

      await client.query('BEGIN');
      
      const shiftRes = await client.query(
        "SELECT id FROM wh_shifts WHERE shop_id = $1 " +
        "AND chat_id = $2 AND status = 'open' LIMIT 1 FOR UPDATE",
        [shopId, chatId]
      );
      
      if (shiftRes.rows.length === 0) {
        await client.query('ROLLBACK'); client.release();
        return res.json({ ok: false, error: 'Смена не открыта' });
      }
      const shiftId = shiftRes.rows[0].id;

      await client.query(
        "INSERT INTO wh_cash_ops (shift_id, shop_id, chat_id, " +
        "type, amount, comment) VALUES ($1, $2, $3, $4, $5, $6)",
        [shiftId, shopId, chatId, type, amount, comment]
      );

      if (type === 'in') {
        await client.query(
          "UPDATE wh_shifts SET cash_in = cash_in + $1 " +
          "WHERE id = $2",
          [amount, shiftId]
        );
        await logAction(shopId, chatId, 'cash_in', 
          'Внесение: ' + amount + ' ₽. ' + comment, shiftId);
      } else {
        await client.query(
          "UPDATE wh_shifts SET cash_out = cash_out + $1 " +
          "WHERE id = $2",
          [amount, shiftId]
        );
        await logAction(shopId, chatId, 'cash_out', 
          'Изъятие: ' + amount + ' ₽. ' + comment, shiftId);
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

  app.get('/api/warehouse/shift/ops', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const shopId = auth.shopId; 
      const chatId = auth.chatId;

      const shiftRes = await pool.query(
        "SELECT id FROM wh_shifts WHERE shop_id = $1 " +
        "AND chat_id = $2 AND status = 'open' LIMIT 1",
        [shopId, chatId]
      );
      
      if (shiftRes.rows.length === 0) {
        return res.json({ ok: true, ops: [] });
      }
      const shiftId = shiftRes.rows[0].id;

      const r = await pool.query(
        "SELECT type, amount, comment, created_at " +
        "FROM wh_cash_ops WHERE shift_id = $1 " +
        "ORDER BY created_at DESC",
        [shiftId]
      );
      res.json({ ok: true, ops: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/warehouse/shift/verify-pin', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      
      const pin = String(req.body.pin);
      
      const r = await pool.query(
        "SELECT warehouse_pin_hash FROM admins " +
        "WHERE shop_id = $1 AND chat_id = $2", 
        [auth.shopId, auth.chatId]
      );

      if (r.rows.length === 0 || !r.rows[0].warehouse_pin_hash) {
        return res.json({ ok: false, error: 'PIN не установлен' });
      }
      
      const bcrypt = require('bcryptjs');
      const isMatch = await bcrypt.compare(pin, r.rows[0].warehouse_pin_hash);
      
      if (!isMatch) {
        return res.json({ ok: false, error: 'Неверный PIN' });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ДЕТАЛИ ПРОДАЖИ ======
  app.get('/api/warehouse/sale/details', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const saleId = parseInt(req.query.id);
      if (!saleId || isNaN(saleId)) {
        return res.json({ ok: false, error: 'Неверный ID' });
      }
      const sale = await pool.query(
        "SELECT s.id, s.real_price, s.date, s.status, " +
        "s.pay_cash, s.pay_card, s.pay_qr, " +
        "a.name as seller FROM wh_sales s " +
        "LEFT JOIN admins a ON a.chat_id = s.chat_id AND a.shop_id = s.shop_id " +
        "WHERE s.id = $1 AND s.shop_id = $2",
        [saleId, auth.shopId]
      );
      if (sale.rows.length === 0) {
        return res.json({ ok: false, error: 'Не найдено' });
      }
      const items = await pool.query(
        "SELECT si.qty, si.cost_at_sale, " +
        "COALESCE(shi.custom_name, i.name) as name, " +
        "shi.id as shop_item_id " +
        "FROM wh_sale_items si " +
        "JOIN wh_shop_items shi ON shi.id = si.shop_item_id " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE si.sale_id = $1 AND si.qty > 0", [saleId]
      );
      res.json({
        ok: true, sale: sale.rows[0], items: items.rows
      });
    } catch (e) { 
      res.status(500).json({ ok: false }); 
    }
  });

  // ====== УМНЫЕ ОТЧЁТЫ ======
  app.get('/api/warehouse/reports', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const shopId = auth.shopId;
      const start = req.query.start;
      const end = req.query.end;
      
      let fSales = ''; let fWrites = ''; let fRec = '';
      let pSales = [shopId]; let pWrites = [shopId]; let pRec = [shopId];
      
      if (start && end) {
        fSales = "AND s.date >= $2 AND s.date < $3 ";
        fWrites = "AND w.date >= $2 AND w.date < $3 ";
        fRec = "AND r.date >= $2 AND r.date < $3 ";
        let endNext = new Date(end);
        endNext.setDate(endNext.getDate() + 1);
        let endStr = endNext.toISOString().slice(0, 10);
        pSales.push(start, endStr);
        pWrites.push(start, endStr);
        pRec.push(start, endStr);
      }

      const rev = await pool.query(
        "SELECT COALESCE(SUM(real_price), 0) AS total, " +
        "COALESCE(SUM(pay_cash), 0) as cash, " +
        "COALESCE(SUM(pay_card), 0) as card, " +
        "COALESCE(SUM(pay_qr), 0) as qr, COUNT(id) as count " +
        "FROM wh_sales s WHERE s.shop_id = $1 " + fSales +
        "AND s.status = 'active'", pSales
      );
      
      const cost = await pool.query(
        "SELECT COALESCE(SUM(si.qty * si.cost_at_sale), 0) AS " +
        "total FROM wh_sale_items si " +
        "JOIN wh_sales s ON s.id = si.sale_id " +
        "WHERE s.shop_id = $1 " + fSales +
        "AND s.status = 'active'", pSales
      );
      
      const loss = await pool.query(
        "SELECT COALESCE(SUM(w.qty * i.avg_cost), 0) AS total, " +
        "w.reason FROM wh_writeoffs w " +
        "JOIN wh_shop_items i ON i.id = w.shop_item_id " +
        "WHERE w.shop_id = $1 " + fWrites +
        "AND w.status = 'completed' GROUP BY w.reason", pWrites
      );

      const lossDetails = await pool.query(
        "SELECT COALESCE(shi.custom_name, wi.name) as name, " +
        "SUM(w.qty) as qty, SUM(w.qty * i.avg_cost) as total_cost, " +
        "w.reason FROM wh_writeoffs w " +
        "JOIN wh_shop_items i ON i.id = w.shop_item_id " +
        "JOIN wh_items wi ON wi.id = i.item_id " +
        "LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id " +
        "WHERE w.shop_id = $1 " + fWrites +
        "AND w.status = 'completed' " +
        "GROUP BY shi.custom_name, wi.name, w.reason", pWrites
      );
      
      const top = await pool.query(
        "SELECT shi.id as shop_item_id, " +
        "COALESCE(shi.custom_name, i.name) as name, " +
        "SUM(si.qty) as total_qty, " +
        "SUM(si.qty * (s.real_price / " +
        "(SELECT SUM(qty) FROM wh_sale_items " +
        "WHERE sale_id = s.id))) as total_rev, " +
        "SUM(si.qty * (s.real_price / (SELECT SUM(qty) " +
        "FROM wh_sale_items WHERE sale_id = s.id))) - " +
        "SUM(si.qty * si.cost_at_sale) as total_profit " +
        "FROM wh_sale_items si " +
        "JOIN wh_sales s ON s.id = si.sale_id " +
        "JOIN wh_shop_items shi ON shi.id = si.shop_item_id " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE s.shop_id = $1 " + fSales +
        "AND s.status = 'active' " +
        "GROUP BY shi.id, shi.custom_name, i.name " +
        "ORDER BY total_rev DESC LIMIT 5", pSales
      );
      
      const receiptSum = await pool.query(
        "SELECT COALESCE(SUM(total_sum), 0) AS total " +
        "FROM wh_receipts r WHERE r.shop_id = $1 " +
        "AND r.status = 'completed' " + fRec, pRec
      );
      
      const daily = await pool.query(
        "SELECT DATE(s.date) as day, " +
        "SUM(s.real_price) as total, " +
        "SUM((SELECT SUM(si.qty * si.cost_at_sale) " +
        "FROM wh_sale_items si WHERE si.sale_id = s.id)) as cost " +
        "FROM wh_sales s WHERE s.shop_id = $1 " + fSales +
        "AND s.status = 'active' " +
        "GROUP BY DATE(s.date) ORDER BY DATE(s.date) DESC", pSales
      );

      const abcRaw = await pool.query(
        "SELECT COALESCE(shi.custom_name, i.name) as name, " +
        "SUM(si.qty * (s.real_price / (SELECT SUM(qty) " +
        "FROM wh_sale_items WHERE sale_id = s.id))) as total_rev " +
        "FROM wh_sale_items si " +
        "JOIN wh_sales s ON s.id = si.sale_id " +
        "JOIN wh_shop_items shi ON shi.id = si.shop_item_id " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE s.shop_id = $1 " + fSales + "AND s.status = 'active' " +
        "GROUP BY shi.id, shi.custom_name, i.name " +
        "ORDER BY total_rev DESC", pSales
      );
      
      let abc = { A: [], B: [], C: [] };
      let abcTotal = abcRaw.rows.reduce(
        (sum, r) => sum + parseFloat(r.total_rev), 0
      );
      let runningSum = 0;
      
      abcRaw.rows.forEach(function(r) {
        let revVal = parseFloat(r.total_rev);
        runningSum += revVal;
        let pct = abcTotal > 0 ? (runningSum / abcTotal) * 100 : 0;
        let item = { name: r.name, rev: revVal };
        if (pct <= 80) abc.A.push(item);
        else if (pct <= 95) abc.B.push(item);
        else abc.C.push(item);
      });

      const frozen = await pool.query(
        "SELECT COALESCE(shi.custom_name, i.name) as name, " +
        "shi.current_stock, shi.avg_cost, " +
        "(shi.current_stock * shi.avg_cost) as total_cost " +
        "FROM wh_shop_items shi " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE shi.shop_id = $1 AND shi.current_stock > 0 " +
        "AND (shi.hidden = FALSE OR shi.hidden IS NULL) " +
        "ORDER BY total_cost DESC", [shopId]
      );

      const revenue = parseFloat(rev.rows[0].total) || 0;
      const costVal = parseFloat(cost.rows[0].total) || 0;
      const profit = revenue - costVal;
      let marginPct = 0;
      if (revenue > 0) marginPct = Math.round((profit / revenue) * 100);
      
      let losses = 0; let lossReasons = {};
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
          revenue: revenue, cost: costVal, profit: profit,
          margin_pct: marginPct,
          avg_check: rev.rows[0].count > 0 ? 
            (revenue / rev.rows[0].count) : 0,
          cash: parseFloat(rev.rows[0].cash) || 0,
          card: parseFloat(rev.rows[0].card) || 0,
          qr: parseFloat(rev.rows[0].qr) || 0,
          count: parseInt(rev.rows[0].count) || 0
        },
        losses: { total: losses, percent: lossPercent, reasons: lossReasons },
        loss_details: lossDetails.rows,
        top: top.rows,
        abc: abc,
        frozen: frozen.rows,
        movement: {
          receipts: parseFloat(receiptSum.rows[0].total) || 0,
          sales: revenue, writeoffs: losses
        },
        daily: daily.rows
      });
    } catch (e) {
      console.error('Report error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ====== ЭКСПОРТ ОТЧЕТА В CSV ======
  app.get('/api/warehouse/reports/export', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).send('Unauthorized');
      
      const shopId = auth.shopId;
      const start = req.query.start;
      const end = req.query.end;
      
      let fSales = '';
      let pSales = [shopId];
      
      if (start && end) {
        fSales = "AND s.date >= $2 AND s.date < $3 ";
        let endNext = new Date(end);
        endNext.setDate(endNext.getDate() + 1);
        let endStr = endNext.toISOString().slice(0, 10);
        pSales.push(start, endStr);
      }

      const daily = await pool.query(
        "SELECT DATE(s.date) as day, " +
        "SUM(s.real_price) as total, " +
        "SUM((SELECT SUM(si.qty * si.cost_at_sale) " +
        "FROM wh_sale_items si WHERE si.sale_id = s.id)) as cost, " +
        "SUM(pay_cash) as cash, SUM(pay_card) as card, " +
        "SUM(pay_qr) as qr " +
        "FROM wh_sales s WHERE s.shop_id = $1 " + fSales +
        "AND s.status = 'active' " +
        "GROUP BY DATE(s.date) ORDER BY DATE(s.date) DESC",
        pSales
      );

      let csv = '\uFEFF';
      csv += 'Дата;Выручка;Себестоимость;Прибыль;';
      csv += 'Наличные;Карта;QR\n';

      daily.rows.forEach(function(r) {
        let d = new Date(r.day).toLocaleDateString('ru-RU');
        let revVal = parseFloat(r.total) || 0;
        let costVal = parseFloat(r.cost) || 0;
        let prof = revVal - costVal;
        let cash = parseFloat(r.cash) || 0;
        let card = parseFloat(r.card) || 0;
        let qr = parseFloat(r.qr) || 0;

        let revStr = revVal.toFixed(2).replace('.', ',');
        let costStr = costVal.toFixed(2).replace('.', ',');
        let profStr = prof.toFixed(2).replace('.', ',');
        let cashStr = cash.toFixed(2).replace('.', ',');
        let cardStr = card.toFixed(2).replace('.', ',');
        let qrStr = qr.toFixed(2).replace('.', ',');

        csv += d + ';' + revStr + ';' + costStr + ';';
        csv += profStr + ';' + cashStr + ';' + cardStr + ';';
        csv += qrStr + '\n';
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 
        'attachment; filename="report.csv"');
      res.send(csv);
    } catch (e) {
      console.error('Export error:', e.message);
      res.status(500).send('Ошибка сервера');
    }
  });

  // ====== ИСТОРИЯ СМЕНЫ ======
  app.get('/api/warehouse/history', async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth) return res.status(401).json({ ok: false });
      const shopId = auth.shopId;
      const targetDate = req.query.date || 
        new Date().toISOString().slice(0, 10);
      const filterChatId = req.query.chat_id;
      let fSales = ''; let fWrites = ''; 
      let fRec = ''; let params = [shopId, targetDate];
      
      if (filterChatId) {
        fSales = "AND s.chat_id = $3 ";
        fWrites = "AND w.chat_id = $3 ";
        fRec = "AND r.chat_id = $3 ";
        params.push(filterChatId);
      }
      
      const sales = await pool.query(
        "SELECT s.id::text, s.real_price as amount, s.date, " +
        "'sale' as type, a.name as person, s.pay_cash, " +
        "s.pay_card, s.pay_qr, " +
        "(SELECT STRING_AGG(COALESCE(shi.custom_name, " +
        "i.name) || ' x' || TRIM(TRAILING '.' FROM " +
        "TRIM(TRAILING '0' FROM si.qty::text)), ', ') " +
        "FROM wh_sale_items si " +
        "JOIN wh_shop_items shi ON shi.id = si.shop_item_id " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE si.sale_id = s.id AND si.qty > 0) as items " +
        "FROM wh_sales s " +
        "LEFT JOIN admins a ON a.chat_id = s.chat_id AND a.shop_id = s.shop_id " +
        "WHERE s.shop_id = $1 AND s.status = 'active' " +
        "AND s.date >= $2::date AND s.date < ($2::date + 1) " +
        fSales + "ORDER BY s.date DESC", params
      );
      
      const cancels = await pool.query(
        "SELECT s.id::text, s.real_price as amount, s.date, " +
        "'cancel' as type, a.name as person, s.pay_cash, " +
        "s.pay_card, s.pay_qr, " +
        "(SELECT STRING_AGG(COALESCE(shi.custom_name, " +
        "i.name) || ' x' || TRIM(TRAILING '.' FROM " +
        "TRIM(TRAILING '0' FROM si.qty::text)), ', ') " +
        "FROM wh_sale_items si " +
        "JOIN wh_shop_items shi ON shi.id = si.shop_item_id " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE si.sale_id = s.id AND si.qty > 0) as items " +
        "FROM wh_sales s " +
        "LEFT JOIN admins a ON a.chat_id = s.chat_id AND a.shop_id = s.shop_id " +
        "WHERE s.shop_id = $1 AND s.status = 'cancelled' " +
        "AND s.date >= $2::date AND s.date < ($2::date + 1) " +
        fSales + "ORDER BY s.date DESC", params
      );
      
      const writeoffs = await pool.query(
        "SELECT COALESCE(MAX(w.doc_id), MIN(w.id)::text) as id, " +
        "SUM(w.qty) as amount, " +
        "DATE_TRUNC('minute', w.date) as date, " +
        "'writeoff' as type, MAX(a.name) as person, " +
        "MAX(w.reason) as reason, " +
        "STRING_AGG(COALESCE(shi.custom_name, i.name) || " +
        "' x' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' " +
        "FROM w.qty::text)), ', ') as items " +
        "FROM wh_writeoffs w " +
        "LEFT JOIN admins a ON a.chat_id = w.chat_id AND a.shop_id = w.shop_id " +
        "LEFT JOIN wh_shop_items shi ON shi.id = w.shop_item_id " +
        "LEFT JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE w.shop_id = $1 AND w.date >= $2::date " +
        "AND w.date < ($2::date + 1) " + fWrites +
        "AND w.status = 'completed' " +
        "GROUP BY COALESCE(w.doc_id, w.id::text), " +
        "DATE_TRUNC('minute', w.date) " +
        "ORDER BY DATE_TRUNC('minute', w.date) DESC", params
      );
      
      const receipts = await pool.query(
        "SELECT r.id::text, r.total_sum as amount, r.date, " +
        "'receipt' as type, a.name as person, " +
        "(SELECT STRING_AGG(COALESCE(shi.custom_name, " +
        "i.name) || ' x' || TRIM(TRAILING '.' FROM " +
        "TRIM(TRAILING '0' FROM ri.qty::text)), ', ') " +
        "FROM wh_receipt_items ri " +
        "JOIN wh_shop_items shi ON shi.id = ri.shop_item_id " +
        "JOIN wh_items i ON i.id = shi.item_id " +
        "WHERE ri.receipt_id = r.id) as items " +
        "FROM wh_receipts r " +
        "LEFT JOIN admins a ON a.chat_id = r.chat_id AND a.shop_id = r.shop_id " +
        "WHERE r.shop_id = $1 AND r.date >= $2::date " +
        "AND r.date < ($2::date + 1) " +
        "AND r.status = 'completed' " + fRec +
        "ORDER BY r.date DESC", params
      );
      
      let list = [...sales.rows, ...cancels.rows, 
        ...writeoffs.rows, ...receipts.rows];
      list.sort(function(a, b) {
        return new Date(b.date) - new Date(a.date);
      });
      res.json({ ok: true, history: list, date: targetDate });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { setupWarehouseSales };