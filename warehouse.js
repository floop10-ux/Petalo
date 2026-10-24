const pool = require('./db');

async function initWarehouseDb() {
  // 1. Категории
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      parent_id INTEGER REFERENCES wh_categories(id)
        ON DELETE SET NULL,
      sort_order INTEGER DEFAULT 0
    );
  `);

  // 2. Глобальный каталог
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_items (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES wh_categories(id)
        ON DELETE SET NULL,
      name VARCHAR(200) NOT NULL,
      unit VARCHAR(10) NOT NULL DEFAULT 'шт'
        CHECK (unit IN ('шт','г','м','уп')),
      photo_url TEXT,
      photo_url_backup TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 3. Товары на складе
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_shop_items (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL REFERENCES shops(shop_id)
        ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES wh_items(id)
        ON DELETE RESTRICT,
      custom_name VARCHAR(200),
      min_stock NUMERIC(10,3) DEFAULT 0,
      avg_cost NUMERIC(10,2) DEFAULT 0,
      last_cost NUMERIC(10,2) DEFAULT 0,
      current_stock NUMERIC(10,3) DEFAULT 0,
      retail_price NUMERIC(10,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (shop_id, item_id)
    );
  `);

  // 4. Поставщики
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_suppliers (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL REFERENCES shops(shop_id)
        ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      phone VARCHAR(50),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 5. Приходные накладные
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_receipts (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL REFERENCES shops(shop_id)
        ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES wh_suppliers(id)
        ON DELETE SET NULL,
      date TIMESTAMPTZ DEFAULT NOW(),
      total_sum NUMERIC(10,2) DEFAULT 0,
      delivery_cost NUMERIC(10,2) DEFAULT 0,
      comment TEXT,
      chat_id BIGINT,
      status VARCHAR(20) DEFAULT 'completed',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 6. Позиции накладной
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_receipt_items (
      id SERIAL PRIMARY KEY,
      receipt_id INTEGER NOT NULL REFERENCES wh_receipts(id)
        ON DELETE CASCADE,
      shop_item_id INTEGER NOT NULL REFERENCES wh_shop_items(id)
        ON DELETE RESTRICT,
      qty NUMERIC(10,3) NOT NULL,
      unit_cost NUMERIC(10,2) NOT NULL,
      sum NUMERIC(10,2) NOT NULL
    );
  `);

  // 7. Списания
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_writeoffs (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL REFERENCES shops(shop_id)
        ON DELETE CASCADE,
      shop_item_id INTEGER NOT NULL REFERENCES wh_shop_items(id)
        ON DELETE RESTRICT,
      qty NUMERIC(10,3) NOT NULL,
      reason VARCHAR(20) NOT NULL
        CHECK (reason IN ('markdown','loss','spoilage','sorting')),
      date TIMESTAMPTZ DEFAULT NOW(),
      comment TEXT,
      photo_url TEXT,
      chat_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 8. Продажи
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_sales (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL REFERENCES shops(shop_id)
        ON DELETE CASCADE,
      bouquet_id INTEGER REFERENCES bouquets(id)
        ON DELETE SET NULL,
      real_price NUMERIC(10,2) NOT NULL,
      retail_price NUMERIC(10,2) DEFAULT 0,
      discount_reason TEXT,
      chat_id BIGINT,
      pay_cash NUMERIC(10,2) DEFAULT 0,
      pay_card NUMERIC(10,2) DEFAULT 0,
      pay_qr NUMERIC(10,2) DEFAULT 0,
      date TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 9. Позиции продажи
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES wh_sales(id)
        ON DELETE CASCADE,
      shop_item_id INTEGER NOT NULL REFERENCES wh_shop_items(id)
        ON DELETE RESTRICT,
      qty NUMERIC(10,3) NOT NULL,
      cost_at_sale NUMERIC(10,2) NOT NULL
    );
  `);

  // 10. Журнал действий
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_audit_log (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50),
      chat_id BIGINT,
      action VARCHAR(50),
      details TEXT,
      ref_id INTEGER,
      date TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 11. Смены (Касса)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_shifts (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL REFERENCES shops(shop_id)
        ON DELETE CASCADE,
      chat_id BIGINT,
      open_time TIMESTAMPTZ DEFAULT NOW(),
      close_time TIMESTAMPTZ,
      start_cash NUMERIC(10,2) DEFAULT 0,
      end_cash_fact NUMERIC(10,2) DEFAULT 0,
      total_sales NUMERIC(10,2) DEFAULT 0,
      cash_sales NUMERIC(10,2) DEFAULT 0,
      card_sales NUMERIC(10,2) DEFAULT 0,
      qr_sales NUMERIC(10,2) DEFAULT 0,
      discrepancy NUMERIC(10,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'open'
    );
  `);

  // 12. Рецепты букетов (Связка с витриной)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_bouquet_recipes (
      id SERIAL PRIMARY KEY,
      bouquet_id INTEGER NOT NULL REFERENCES bouquets(id)
        ON DELETE CASCADE,
      shop_item_id INTEGER NOT NULL REFERENCES wh_shop_items(id)
        ON DELETE CASCADE,
      qty NUMERIC(10,3) NOT NULL DEFAULT 1
    );
  `);

  // --- МИГРАЦИИ ---
  await pool.query(
    'ALTER TABLE wh_items ADD COLUMN ' +
    'IF NOT EXISTS photo_url_backup TEXT'
  );
  await pool.query(
    'ALTER TABLE wh_receipts ADD COLUMN ' +
    'IF NOT EXISTS chat_id BIGINT'
  );
  await pool.query(
    'ALTER TABLE wh_receipts ADD COLUMN ' +
    'IF NOT EXISTS status VARCHAR(20) DEFAULT \'completed\''
  );
  await pool.query(
    'ALTER TABLE wh_writeoffs ADD COLUMN ' +
    'IF NOT EXISTS chat_id BIGINT'
  );
  await pool.query(
    'ALTER TABLE wh_writeoffs ADD COLUMN ' +
    'IF NOT EXISTS photo_url TEXT'
  );
  await pool.query(
    'ALTER TABLE wh_sales ADD COLUMN ' +
    'IF NOT EXISTS retail_price NUMERIC(10,2) DEFAULT 0'
  );
  await pool.query(
    'ALTER TABLE wh_sales ADD COLUMN ' +
    'IF NOT EXISTS discount_reason TEXT'
  );
  await pool.query(
    'ALTER TABLE wh_sales ADD COLUMN ' +
    'IF NOT EXISTS chat_id BIGINT'
  );
  await pool.query(
    'ALTER TABLE wh_sales ADD COLUMN ' +
    'IF NOT EXISTS pay_cash NUMERIC(10,2) DEFAULT 0'
  );
  await pool.query(
    'ALTER TABLE wh_sales ADD COLUMN ' +
    'IF NOT EXISTS pay_card NUMERIC(10,2) DEFAULT 0'
  );
  await pool.query(
    'ALTER TABLE wh_sales ADD COLUMN ' +
    'IF NOT EXISTS pay_qr NUMERIC(10,2) DEFAULT 0'
  );
  await pool.query(
    'ALTER TABLE wh_audit_log ADD COLUMN ' +
    'IF NOT EXISTS ref_id INTEGER'
  );

  // Подготовка к интеграции с витриной
  await pool.query(
    'ALTER TABLE bouquets ADD COLUMN IF NOT EXISTS ' +
    'wh_linked BOOLEAN DEFAULT FALSE'
  );
  await pool.query(
    'ALTER TABLE bouquets ADD COLUMN IF NOT EXISTS ' +
    'lifetime_type VARCHAR(20) DEFAULT \'auto_3_days\''
  );

  // Смена типов с INTEGER на NUMERIC(10,2)
  await pool.query(
    'ALTER TABLE wh_shop_items ALTER COLUMN avg_cost ' +
    'TYPE NUMERIC(10,2) USING avg_cost::numeric(10,2)'
  );
  await pool.query(
    'ALTER TABLE wh_shop_items ALTER COLUMN last_cost ' +
    'TYPE NUMERIC(10,2) USING last_cost::numeric(10,2)'
  );
  await pool.query(
    'ALTER TABLE wh_shop_items ALTER COLUMN retail_price ' +
    'TYPE NUMERIC(10,2) USING retail_price::numeric(10,2)'
  );
  await pool.query(
    'ALTER TABLE wh_sales ALTER COLUMN real_price ' +
    'TYPE NUMERIC(10,2) USING real_price::numeric(10,2)'
  );
  await pool.query(
    'ALTER TABLE wh_sales ALTER COLUMN retail_price ' +
    'TYPE NUMERIC(10,2) USING retail_price::numeric(10,2)'
  );
  await pool.query(
    'ALTER TABLE wh_receipts ALTER COLUMN total_sum ' +
    'TYPE NUMERIC(10,2) USING total_sum::numeric(10,2)'
  );
  await pool.query(
    'ALTER TABLE wh_receipts ALTER COLUMN delivery_cost ' +
    'TYPE NUMERIC(10,2) USING delivery_cost::numeric(10,2)'
  );
  await pool.query(
    'ALTER TABLE wh_receipt_items ALTER COLUMN unit_cost ' +
    'TYPE NUMERIC(10,2) USING unit_cost::numeric(10,2)'
  );
  await pool.query(
    'ALTER TABLE wh_receipt_items ALTER COLUMN sum ' +
    'TYPE NUMERIC(10,2) USING sum::numeric(10,2)'
  );
  await pool.query(
    'ALTER TABLE wh_sale_items ALTER COLUMN cost_at_sale ' +
    'TYPE NUMERIC(10,2) USING cost_at_sale::numeric(10,2)'
  );

  // Индексы
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_wh_shop_items ' +
    'ON wh_shop_items(shop_id)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_wh_receipts ' +
    'ON wh_receipts(shop_id, date DESC)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_wh_receipt_items ' +
    'ON wh_receipt_items(receipt_id)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_wh_writeoffs ' +
    'ON wh_writeoffs(shop_id, date DESC)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_wh_sales ' +
    'ON wh_sales(shop_id, date DESC)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_wh_sale_items ' +
    'ON wh_sale_items(sale_id)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_wh_shifts ' +
    'ON wh_shifts(shop_id, status)'
  );

  // --- ДОБАВЛЕНИЕ БАЗОВЫХ КАТЕГОРИЙ ---
  const defaultCats = [
    'Цветы', 'Упаковка', 'Декор', 'Игрушки', 'Канцелярия'
  ];
  
  for (var i = 0; i < defaultCats.length; i++) {
    var catName = defaultCats[i];
    var checkRes = await pool.query(
      'SELECT id FROM wh_categories WHERE name = $1', [catName]
    );
    if (checkRes.rows.length === 0) {
      await pool.query(
        'INSERT INTO wh_categories (name, sort_order) ' +
        'VALUES ($1, $2)', [catName, i]
      );
    }
  }

  console.log('✅ Таблицы склада готовы (v5.0)');
  console.log('✅ Базовые категории проверены');
}

module.exports = { initWarehouseDb };