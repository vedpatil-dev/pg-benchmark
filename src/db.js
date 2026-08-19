const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  host: config.pg.host,
  port: config.pg.port,
  user: config.pg.user,
  password: config.pg.password,
  database: config.pg.database,
  max: 220, // headroom for the concurrency sweep (up to 200 connections)
});

pool.on('error', (err) => {
  console.error('Unexpected idle client error:', err.message);
});

module.exports = pool;
