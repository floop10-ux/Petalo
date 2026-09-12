const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Ошибка подключения к БД:', err.stack);
  }
  console.log('✅ Успешное подключение к PostgreSQL');
  release();
});

module.exports = pool;
