const pool = require('./db');

async function initWarehouseDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      parent_id INTEGER REFERENCES wh_categories(id)
        ON DELETE SET NULL,
      sort_order INTEGER DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_items (
      id SERIAL PRIMARY KEY,
      category_id INTEGER
        REFERENCES wh_categories(id)
        ON DELETE SET NULL,
      name VARCHAR(200) NOT NULL,
      unit VARCHAR(10) NOT NULL DEFAULT 'шт'
        CHECK (unit IN ('шт','г','м','уп')),
      photo_url TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
await pool.query(
    `ALTER TABLE wh_items ` +
    `ADD COLUMN IF NOT EXISTS photo_url_backup TEXT`
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_shop_items (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL
        REFERENCES shops(shop_id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL
        REFERENCES wh_items(id) ON DELETE RESTRICT,
      custom_name VARCHAR(200),
      min_stock NUMERIC(10,3) DEFAULT 0,
      avg_cost INTEGER DEFAULT 0,
      last_cost INTEGER DEFAULT 0,
      current_stock NUMERIC(10,3) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (shop_id, item_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_suppliers (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL
        REFERENCES shops(shop_id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      phone VARCHAR(50),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_receipts (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL
        REFERENCES shops(shop_id) ON DELETE CASCADE,
      supplier_id INTEGER
        REFERENCES wh_suppliers(id) ON DELETE SET NULL,
      date TIMESTAMPTZ DEFAULT NOW(),
      total_sum INTEGER DEFAULT 0,
      delivery_cost INTEGER DEFAULT 0,
      comment TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_receipt_items (
      id SERIAL PRIMARY KEY,
      receipt_id INTEGER NOT NULL
        REFERENCES wh_receipts(id) ON DELETE CASCADE,
      shop_item_id INTEGER NOT NULL
        REFERENCES wh_shop_items(id) ON DELETE RESTRICT,
      qty NUMERIC(10,3) NOT NULL,
      unit_cost INTEGER NOT NULL,
      sum INTEGER NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_writeoffs (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL
        REFERENCES shops(shop_id) ON DELETE CASCADE,
      shop_item_id INTEGER NOT NULL
        REFERENCES wh_shop_items(id) ON DELETE RESTRICT,
      qty NUMERIC(10,3) NOT NULL,
      reason VARCHAR(20) NOT NULL
        CHECK (reason IN ('markdown','loss','spoilage','sorting')),
      date TIMESTAMPTZ DEFAULT NOW(),
      comment TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_sales (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) NOT NULL
        REFERENCES shops(shop_id) ON DELETE CASCADE,
      bouquet_id INTEGER
        REFERENCES bouquets(id) ON DELETE SET NULL,
      real_price INTEGER NOT NULL,
      chat_id BIGINT,
      date TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL
        REFERENCES wh_sales(id) ON DELETE CASCADE,
      shop_item_id INTEGER NOT NULL
        REFERENCES wh_shop_items(id) ON DELETE RESTRICT,
      qty NUMERIC(10,3) NOT NULL,
      cost_at_sale INTEGER NOT NULL
    );
  `);

  // Индексы
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wh_shop_items ON wh_shop_items(shop_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wh_receipts ON wh_receipts(shop_id, date DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wh_receipt_items ON wh_receipt_items(receipt_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wh_writeoffs ON wh_writeoffs(shop_id, date DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wh_sales ON wh_sales(shop_id, date DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wh_sale_items ON wh_sale_items(sale_id)`);

  console.log('✅ Таблицы склада готовы (v2.0)');
}

module.exports = { initWarehouseDb };
