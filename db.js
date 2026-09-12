const { Pool } = require('pg');
require('dotenv').config();

// Убираем sslmode из строки подключения — задаём SSL только через опции
let connectionString = process.env.DATABASE_URL || '';
connectionString = connectionString.replace(/\?.*$/, ''); // убираем всё после ?

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err.stack);
    return;
  }
  console.log('✅ Успешное подключение к PostgreSQL');
  release();
});

module.exports = pool;
