const pool = require('./db');
const { 
  extractTagsFromName, 
  isConfirmedRecently 
} = require('./config');

// ========== ОНБОРДИНГ ==========
async function getOwnerOnboardingState(shopId) {
  const res = await pool.query(
    'SELECT settings FROM shops WHERE shop_id = $1',
    [shopId]
  );
  if (res.rows.length === 0) return null;
  const settings = res.rows[0].settings || {};
  return {
    step: settings.onboardingStep || null,
    passed: settings.onboardingPassed === true
  };
}

async function setOwnerOnboardingStep(shopId, step) {
  var stepObj = { onboardingStep: step };
  await pool.query(
    'UPDATE shops SET settings = ' +
    'COALESCE(settings, \'{}\'::jsonb) || $1::jsonb ' +
    'WHERE shop_id = $2',
    [JSON.stringify(stepObj), shopId]
  );
}

async function setOwnerOnboardingPassed(shopId) {
  var passedObj = { onboardingPassed: true };
  await pool.query(
    'UPDATE shops SET settings = ' +
    'COALESCE(settings, \'{}\'::jsonb) || $1::jsonb ' +
    'WHERE shop_id = $2',
    [JSON.stringify(passedObj), shopId]
  );
}

async function getFloristOnboardingState(chatId, shopId) {
  const res = await pool.query(
    'SELECT id, onboarding_step, ' +
    'onboarding_passed FROM admins ' +
    'WHERE chat_id = $1 AND shop_id = $2',
    [chatId, shopId]
  );
  if (res.rows.length === 0) return null;
  return {
    id: res.rows[0].id,
    step: res.rows[0].onboarding_step || null,
    passed: res.rows[0].onboarding_passed === true
  };
}

async function setFloristOnboardingStep(chatId, shopId, step) {
  await pool.query(
    'UPDATE admins SET onboarding_step = $3 ' +
    'WHERE chat_id = $1 AND shop_id = $2',
    [chatId, shopId, step]
  );
}

async function setFloristOnboardingPassed(chatId, shopId) {
  await pool.query(
    'UPDATE admins SET onboarding_passed = TRUE ' +
    'WHERE chat_id = $1 AND shop_id = $2',
    [chatId, shopId]
  );
}

// ========== ИНИЦИАЛИЗАЦИЯ БД ==========
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shops (
      shop_id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      display_name VARCHAR(200),
      address VARCHAR(200),
      hours VARCHAR(100),
      phone VARCHAR(50),
      telegram_username VARCHAR(100),
      invite_code VARCHAR(10),
      trial_start TIMESTAMPTZ,
      trial_end TIMESTAMPTZ,
      settings JSONB DEFAULT '{}'::jsonb,
      stats JSONB DEFAULT '{}'::jsonb
    );
  `);
  
  await pool.query(
    `ALTER TABLE shops ` +
    `ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(50)`
  );
  await pool.query(
    `ALTER TABLE shops ` +
    `ADD COLUMN IF NOT EXISTS max_username VARCHAR(500)`
  );
  await pool.query(
    `ALTER TABLE shops ` +
    `ADD COLUMN IF NOT EXISTS blocked BOOLEAN ` +
    `DEFAULT FALSE`
  );
  await pool.query(
    `ALTER TABLE shops ` +
    `ADD COLUMN IF NOT EXISTS blocked_reason TEXT`
  );
  await pool.query(
    `ALTER TABLE shops ` +
    `ADD COLUMN IF NOT EXISTS country VARCHAR(10)`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      shop_id VARCHAR(50) REFERENCES shops(shop_id) 
      ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      name VARCHAR(100),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(chat_id, shop_id)
    );
  `);
  
  await pool.query(
    `ALTER TABLE admins ` +
    `ADD COLUMN IF NOT EXISTS on_shift_until TIMESTAMPTZ`
  );
  await pool.query(
    `ALTER TABLE admins ` +
    `ADD COLUMN IF NOT EXISTS onboarding_step VARCHAR(40)`
  );
  await pool.query(
    `ALTER TABLE admins ` +
    `ADD COLUMN IF NOT EXISTS onboarding_passed ` +
    `BOOLEAN DEFAULT FALSE`
  );
  await pool.query(
    `ALTER TABLE admins ` +
    `ADD COLUMN IF NOT EXISTS warehouse_pin VARCHAR(10)`
  );
  await pool.query(
    `ALTER TABLE admins ` +
    `ADD COLUMN IF NOT EXISTS can_receipt BOOLEAN ` +
    `DEFAULT FALSE`
  );
  await pool.query(
    `ALTER TABLE admins ` +
    `ADD COLUMN IF NOT EXISTS can_sale BOOLEAN ` +
    `DEFAULT TRUE`
  );
  await pool.query(
    `ALTER TABLE admins ` +
    `ADD COLUMN IF NOT EXISTS can_writeoff BOOLEAN ` +
    `DEFAULT TRUE`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bouquets (
      id SERIAL PRIMARY KEY,
      shop_id VARCHAR(50) REFERENCES shops(shop_id) 
      ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      price INTEGER NOT NULL,
      description TEXT,
      photos JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ DEFAULT NOW(),
      hidden BOOLEAN DEFAULT FALSE,
      deleted BOOLEAN DEFAULT FALSE,
      is_pinned BOOLEAN DEFAULT FALSE,
      chat_id BIGINT,
      reminded BOOLEAN DEFAULT FALSE,
      clicks INTEGER DEFAULT 0
    );
  `);

  await pool.query(
    `ALTER TABLE bouquets ` +
    `ADD COLUMN IF NOT EXISTS shop_number INTEGER`
  );
  await pool.query(
    `ALTER TABLE bouquets ` +
    `ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb`
  );
  await pool.query(
    `ALTER TABLE bouquets ` +
    `ADD COLUMN IF NOT EXISTS wh_linked BOOLEAN ` +
    `DEFAULT FALSE`
  );
  await pool.query(
    `ALTER TABLE bouquets ` +
    `ADD COLUMN IF NOT EXISTS lifetime_type VARCHAR(20) ` +
    `DEFAULT 'auto_3_days'`
  );

  await pool.query(`
    UPDATE bouquets SET shop_number = sub.rn
    FROM (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY shop_id ORDER BY id
        ) AS rn
      FROM bouquets WHERE shop_number IS NULL
    ) sub
    WHERE bouquets.id = sub.id
  `);

  try {
    const existing = await pool.query(
      `SELECT id, name FROM bouquets ` +
      `WHERE tags IS NULL OR tags = '[]'::jsonb`
    );
    for (const row of existing.rows) {
      const tags = extractTagsFromName(row.name);
      if (tags.length > 0) {
        await pool.query(
          `UPDATE bouquets SET tags = $2 WHERE id = $1`,
          [row.id, JSON.stringify(tags)]
        );
      }
    }
    if (existing.rows.length > 0) {
      console.log(
        `🏷 Проставлены теги у ` +
        `${existing.rows.length} букетов`
      );
    }
  } catch (e) {
    console.error(
      '⚠️ Миграция тегов:', e?.message || e
    );
  }

  await pool.query(
    `CREATE INDEX IF NOT EXISTS ` +
    `idx_bouquets_shop_active ON bouquets(` +
    `shop_id, deleted, is_pinned, confirmed_at DESC)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ` +
    `idx_bouquets_shop_number ` +
    `ON bouquets(shop_id, shop_number)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ` +
    `idx_admins_chat_id ON admins(chat_id)`
  );

  console.log('✅ Таблицы БД готовы');
}

// ========== ФУНКЦИИ БД ==========
async function getShopFromDb(shopId) {
  const res = await pool.query(
    'SELECT * FROM shops WHERE shop_id = $1',
    [shopId]
  );
  if (res.rows.length === 0) return null;
  const s = res.rows[0];
  
  const admins = await pool.query(
    'SELECT * FROM admins WHERE shop_id = $1',
    [shopId]
  );
  
  return {
    shopId: s.shop_id,
    name: s.name,
    displayName: s.display_name,
    address: s.address,
    hours: s.hours,
    phone: s.phone,
    telegramUsername: s.telegram_username,
    whatsappPhone: s.whatsapp_phone,
    maxLink: s.max_username,
    inviteCode: s.invite_code,
    trialStart: s.trial_start,
    trialEnd: s.trial_end,
    country: s.country || null,
    blocked: !!s.blocked,
    blockedReason: s.blocked_reason || null,
    settings: s.settings || {
      logo: null, cover: null,
      background: null, buttonColor: 'red',
      currency: 'RUB', markupPercent: 20,
      aiEnabled: false
    },
    stats: s.stats || {
      views: 0, orders: 0, calls: 0,
      startedAt: new Date().toISOString()
    },
    admins: admins.rows.map(a => ({
      chatId: parseInt(a.chat_id),
      role: a.role,
      name: a.name,
      joinedAt: a.joined_at,
      onShift: !!(
        a.on_shift_until &&
        new Date(a.on_shift_until) > new Date()
      )
    }))
  };
}

async function createShopInDb(shop) {
  await pool.query(`
    INSERT INTO shops (
      shop_id, name, display_name, address, hours,
      phone, telegram_username, whatsapp_phone,
      max_username, invite_code, trial_start, trial_end,
      settings, stats, country
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
      $12,$13,$14,$15)
  `, [
    shop.shopId, shop.name, shop.displayName,
    shop.address, shop.hours, shop.phone,
    shop.telegramUsername,
    shop.whatsappPhone || null,
    shop.maxLink || null,
    shop.inviteCode, shop.trialStart, shop.trialEnd,
    JSON.stringify(shop.settings),
    JSON.stringify(shop.stats),
    shop.country || null
  ]);
}

async function updateShopField(shopId, field, value) {
  const allowed = [
    'display_name', 'address', 'hours', 'phone',
    'telegram_username', 'whatsapp_phone',
    'max_username', 'country'
  ];
  if (!allowed.includes(field)) return;
  await pool.query(
    `UPDATE shops SET ${field} = $2 WHERE shop_id = $1`,
    [shopId, value]
  );
}

async function saveShopSettings(shopId, settings) {
  await pool.query(
    'UPDATE shops SET settings = $2 WHERE shop_id = $1',
    [shopId, JSON.stringify(settings)]
  );
}

async function incrementShopStat(shopId, field) {
  await pool.query(
    `UPDATE shops SET stats = stats || ` +
    `jsonb_build_object('${field}', ` +
    `COALESCE((stats->>'${field}')::int, 0) + 1) ` +
    `WHERE shop_id = $1`,
    [shopId]
  );
}

async function addAdminToDb(chatId, shopId, role, name) {
  await pool.query(
    `INSERT INTO admins (chat_id, shop_id, role, name) ` +
    `VALUES ($1,$2,$3,$4) ` +
    `ON CONFLICT (chat_id, shop_id) DO NOTHING`,
    [chatId, shopId, role, name]
  );
}

async function removeAdminFromDb(chatId, shopId) {
  await pool.query(
    'DELETE FROM admins WHERE chat_id = $1 AND shop_id = $2',
    [chatId, shopId]
  );
}

async function setUserOnShift(chatId, shopId, on) {
  if (on) {
    await pool.query(
      `UPDATE admins SET on_shift_until = ` +
      `NOW() + INTERVAL '14 hours' ` +
      `WHERE chat_id = $1 AND shop_id = $2`,
      [chatId, shopId]
    );
  } else {
    await pool.query(
      `UPDATE admins SET on_shift_until = NULL ` +
      `WHERE chat_id = $1 AND shop_id = $2`,
      [chatId, shopId]
    );
  }
}

async function getBouquetsFromDb(shopId, includeDeleted) {
  let query = 'SELECT * FROM bouquets WHERE shop_id = $1';
  if (!includeDeleted) query += ' AND deleted = FALSE';
  query += ' ORDER BY is_pinned DESC, ';
  query += 'confirmed_at DESC NULLS LAST, created_at DESC';
  const res = await pool.query(query, [shopId]);
  return res.rows.map(mapBouquet);
}

async function getBouquetById(shopId, bouquetId) {
  const res = await pool.query(
    'SELECT * FROM bouquets ' +
    'WHERE id = $1 AND shop_id = $2 AND deleted = FALSE',
    [bouquetId, shopId]
  );
  if (res.rows.length === 0) return null;
  return mapBouquet(res.rows[0]);
}

function mapBouquet(b) {
  return {
    id: b.id,
    shopId: b.shop_id,
    shopNumber: b.shop_number,
    name: b.name,
    price: b.price,
    description: b.description,
    photos: b.photos || [],
    createdAt: b.created_at,
    confirmedAt: b.confirmed_at,
    hidden: b.hidden,
    deleted: b.deleted,
    isPinned: b.is_pinned,
    chatId: parseInt(b.chat_id),
    reminded: b.reminded,
    clicks: b.clicks,
    tags: b.tags || [],
    whLinked: b.wh_linked || false,
    lifetimeType: b.lifetime_type || 'auto_3_days'
  };
}

async function addBouquetToDb(shopId, bouquet) {
  const r = await pool.query(
    `SELECT COALESCE(MAX(shop_number), 0) + 1 AS next ` +
    `FROM bouquets WHERE shop_id = $1`,
    [shopId]
  );
  const shopNumber = r.rows[0].next;
  const res = await pool.query(`
    INSERT INTO bouquets (
      shop_id, shop_number, name, price, description,
      photos, confirmed_at, is_pinned, chat_id, clicks,
      tags, wh_linked, lifetime_type
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id, shop_number
  `, [
    shopId, shopNumber, bouquet.name, bouquet.price,
    bouquet.description,
    JSON.stringify(bouquet.photos),
    new Date().toISOString(),
    bouquet.isPinned, bouquet.chatId,
    bouquet.clicks || 0,
    JSON.stringify(bouquet.tags || []),
    bouquet.whLinked || false,
    bouquet.lifetimeType || 'auto_3_days'
  ]);
  return {
    id: res.rows[0].id,
    shopNumber: res.rows[0].shop_number
  };
}

async function updateBouquetField(id, field, value) {
  await pool.query(
    `UPDATE bouquets SET ${field} = $2 WHERE id = $1`,
    [id, value]
  );
}

async function updateBouquetFields(id, updates) {
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setStr = keys
    .map((k, i) => `${k} = $${i + 2}`)
    .join(', ');
  await pool.query(
    `UPDATE bouquets SET ${setStr} WHERE id = $1`,
    [id, ...values]
  );
}

async function getShopByInvite(inviteCode) {
  const res = await pool.query(
    'SELECT shop_id FROM shops WHERE invite_code = $1',
    [inviteCode]
  );
  return res.rows.length > 0
    ? res.rows[0].shop_id
    : null;
}

async function findUserShop(chatId) {
  const res = await pool.query(
    'SELECT shop_id FROM admins ' +
    'WHERE chat_id = $1 LIMIT 1',
    [chatId]
  );
  return res.rows.length > 0
    ? res.rows[0].shop_id
    : null;
}

async function getAllShopsAdmin() {
  const res = await pool.query(`
    SELECT 
      s.shop_id, s.display_name, s.trial_end, 
      s.stats, s.blocked, s.country,
      (SELECT COUNT(*) FROM bouquets b 
        WHERE b.shop_id = s.shop_id 
        AND b.deleted = FALSE) AS bouquets_count,
      (SELECT COUNT(*) FROM admins a 
        WHERE a.shop_id = s.shop_id) AS team_count
    FROM shops s
    ORDER BY s.trial_end DESC NULLS LAST
  `);
  return res.rows.map(r => {
    const stats = r.stats || {};
    return {
      shopId: r.shop_id,
      displayName: r.display_name,
      trialEnd: r.trial_end,
      country: r.country || null,
      blocked: !!r.blocked,
      bouquetsCount: parseInt(r.bouquets_count) || 0,
      teamCount: parseInt(r.team_count) || 0,
      orders: stats.orders || 0,
      calls: stats.calls || 0
    };
  });
}

async function extendShopTrial(shopId, days) {
  await pool.query(
    `UPDATE shops SET trial_end = ` +
    `GREATEST(COALESCE(trial_end, NOW()), NOW()) ` +
    `+ ($2 || ' days')::INTERVAL ` +
    `WHERE shop_id = $1`,
    [shopId, String(days)]
  );
}

async function blockShop(shopId, reason) {
  await pool.query(
    `UPDATE shops SET blocked = TRUE, ` +
    `blocked_reason = $2 WHERE shop_id = $1`,
    [shopId, reason]
  );
}

async function unblockShop(shopId) {
  await pool.query(
    `UPDATE shops SET blocked = FALSE, ` +
    `blocked_reason = NULL WHERE shop_id = $1`,
    [shopId]
  );
}

module.exports = {
  getOwnerOnboardingState,
  setOwnerOnboardingStep,
  setOwnerOnboardingPassed,
  getFloristOnboardingState,
  setFloristOnboardingStep,
  setFloristOnboardingPassed,
  initDb,
  getShopFromDb,
  createShopInDb,
  updateShopField,
  saveShopSettings,
  incrementShopStat,
  addAdminToDb,
  removeAdminFromDb,
  setUserOnShift,
  getBouquetsFromDb,
  getBouquetById,
  addBouquetToDb,
  updateBouquetField,
  updateBouquetFields,
  getShopByInvite,
  findUserShop,
  getAllShopsAdmin,
  extendShopTrial,
  blockShop,
  unblockShop
};