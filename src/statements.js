const pool = require('./db');
const config = require('./config');

async function ensureExtension() {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements;');
    return true;
  } catch (err) {
    console.error('\nCould not enable pg_stat_statements:', err.message);
    console.error(
      [
        'This usually means it is not in shared_preload_libraries yet. To fix:',
        '  1. ALTER SYSTEM SET shared_preload_libraries = \'pg_stat_statements\';',
        '  2. Restart the container: docker restart ' + (config.dockerContainer || '<your_container>'),
        '  3. Then: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;',
        '  4. Re-run this benchmark.',
      ].join('\n')
    );
    return false;
  }
}

// pg_stat_statements normalizes literals to $1, $2, ... We can't safely re-execute
// those without knowing real parameter values, so we separate runnable (plain SELECTs,
// no placeholders) from parameterized (reported from stats only, not re-executed).
function classify(row) {
  const q = row.query.trim();
  const isSelect = /^select\b/i.test(q);
  const isSystemQuery = /pg_stat_statements|pg_stat_activity/i.test(q);
  const hasPlaceholders = /\$\d+/.test(q);
  const runnable = isSelect && !isSystemQuery && !hasPlaceholders;
  return { ...row, runnable, isSelect, hasPlaceholders };
}

async function fetchTopQueries() {
  const hasExtension = await ensureExtension();
  if (!hasExtension) return [];

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
  const statQueries = rows.map((r, i) => ({ id: `Q${String(i + 1).padStart(2, '0')}`, ...classify(r) }));

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
