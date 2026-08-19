const pool = require('./db');
const config = require('./config');

async function ensureExtension() {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements;');
    return true;
  } catch (err) {
    console.log('Note: pg_stat_statements extension not available. Benchmarking specified SQL queries directly.');
    return false;
  }
}

function classify(row) {
  const q = row.query.trim();
  const isSelect = /^select\b/i.test(q);
  const isSystemQuery = /pg_stat_statements|pg_stat_activity/i.test(q);
  const hasPlaceholders = /\$\d+/.test(q);
  const runnable = isSelect && !isSystemQuery && !hasPlaceholders;
  return { ...row, runnable, isSelect, hasPlaceholders };
}

async function fetchTopQueries() {
  let statQueries = [];
  const hasExtension = await ensureExtension();
  if (hasExtension) {
    try {
      const { rows } = await pool.query(
        `SELECT
            query,
            calls,
            total_exec_time,
            mean_exec_time,
            min_exec_time,
            max_exec_time,
            stddev_exec_time,
            rows
         FROM pg_stat_statements
         WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND calls >= $1
         ORDER BY total_exec_time DESC
         LIMIT $2;`,
        [config.minCalls, config.topN]
      );
      statQueries = rows.map((r, i) => ({ id: `Q${String(i + 1).padStart(2, '0')}`, ...classify(r) }));
    } catch (err) {
      console.warn('Note: Could not query pg_stat_statements:', err.message);
    }
  }

  const customQueries = config.customQueries.map((sql, i) => ({
    id: `CQ${String(i + 1).padStart(2, '0')}`,
    query: sql,
    calls: 0,
    total_exec_time: 0,
    mean_exec_time: 0,
    min_exec_time: 0,
    max_exec_time: 0,
    stddev_exec_time: 0,
    rows: 0,
    runnable: true,
    isSelect: /^select\b/i.test(sql.trim()),
    hasPlaceholders: false,
  }));

  return [...customQueries, ...statQueries];
}

module.exports = { fetchTopQueries };
