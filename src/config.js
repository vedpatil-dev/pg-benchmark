require('dotenv').config();

function bool(val, def) {
  if (val === undefined || val === '') return def;
  return String(val).toLowerCase() === 'true';
}

function int(val, def) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

const config = {
  pg: {
    host: process.env.PGHOST || 'localhost',
    port: int(process.env.PGPORT, 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE,
  },
  dockerContainer: process.env.DOCKER_CONTAINER || null,
  topN: int(process.env.TOP_N_QUERIES, 20),
  minCalls: int(process.env.MIN_CALLS, 5),
  warmupRuns: int(process.env.WARMUP_RUNS, 10),
  measuredRuns: int(process.env.MEASURED_RUNS, 100),
  runColdCacheTest: bool(process.env.RUN_COLD_CACHE_TEST, false),
  concurrencyLevels: (process.env.CONCURRENCY_LEVELS || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0),
  concurrencyDurationSeconds: int(process.env.CONCURRENCY_DURATION_SECONDS, 5),
  concurrencyQuery: process.env.CONCURRENCY_QUERY || 'top',
  customQueries: (process.env.CUSTOM_QUERIES || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean),
  outputFile: process.env.OUTPUT_FILE || 'benchmark-report.xlsx',
};

if (!config.pg.database) {
  console.error('ERROR: PGDATABASE is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

module.exports = config;
