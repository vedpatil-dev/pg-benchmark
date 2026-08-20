require('dotenv').config();
const fs = require('fs');
const path = require('path');

function bool(val, def) {
  if (val === undefined || val === '') return def;
  return String(val).toLowerCase() === 'true';
}

function int(val, def) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

// ------------------------------------------------------------------------------
// CLI Argument Parser
// ------------------------------------------------------------------------------
const args = process.argv.slice(2);
let cliSqlFile = null;
let cliRawQuery = null;
let cliDatabase = null;
let cliHost = null;
let cliPort = null;
let cliUser = null;
let cliPassword = null;
let cliConcurrency = null;
let cliDuration = null;
let cliOutput = null;
let cliMeasuredRuns = null;
let cliWarmupRuns = null;
let cliFullBenchmark = false;
let showHelp = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-h' || arg === '--help') {
    showHelp = true;
  } else if (arg === '-f' || arg === '--file') {
    cliSqlFile = args[++i];
  } else if (arg === '-q' || arg === '--query') {
    cliRawQuery = args[++i];
  } else if (arg === '-d' || arg === '--database') {
    cliDatabase = args[++i];
  } else if (arg === '--host') {
    cliHost = args[++i];
  } else if (arg === '-p' || arg === '--port') {
    cliPort = args[++i];
  } else if (arg === '-u' || arg === '--user') {
    cliUser = args[++i];
  } else if (arg === '-W' || arg === '--password') {
    cliPassword = args[++i];
  } else if (arg === '-c' || arg === '--concurrency' || arg === '--users') {
    cliConcurrency = args[++i];
  } else if (arg === '-b' || arg === '--benchmark') {
    cliFullBenchmark = true;
    if (args[i + 1] && /^\d+(,\d+)*$/.test(args[i + 1])) {
      cliConcurrency = args[++i];
    }
  } else if (arg === '--duration') {
    cliDuration = args[++i];
  } else if (arg === '-o' || arg === '--output') {
    cliOutput = args[++i];
  } else if (arg === '--runs') {
    cliMeasuredRuns = args[++i];
  } else if (arg === '--warmup') {
    cliWarmupRuns = args[++i];
  } else if (!arg.startsWith('-')) {
    if (/^\d+(,\d+)*$/.test(arg)) {
      cliConcurrency = arg;
    } else if (!cliSqlFile) {
      cliSqlFile = arg;
    }
  }
}

if (showHelp) {
  console.log(`
===================================================================
 PostgreSQL Query Performance Benchmarking Tool (pg-benchmark)
===================================================================

Usage:
  node index.js [sql_file] [dummy_user_count] [options]
  npm start -- [sql_file] [dummy_user_count] [options]
  npx pg-benchmark [sql_file] [dummy_user_count] [options]

Examples:
  node index.js 1500                    (Runs ONLY the 1500 user load test)
  node index.js --benchmark 1500        (Runs FULL single-query benchmark AND 1500 user load test)
  node index.js queries.sql -b 50       (Runs FULL benchmark on queries.sql with 50 users)
  node index.js --query "SELECT count(*) FROM information_schema.tables;" --output report.xlsx

Options:
  [sql_file], -f, --file <path>   Path to .sql file containing query/queries
  [dummyuser_count], -c, --users  Number of simulated concurrent dummy users/connections (e.g. 50 or 1500)
  -b, --benchmark [count]         Force FULL single-query profiling + user load test
  -q, --query "<sql>"             Raw SQL statement to benchmark
  -d, --database <name>           PostgreSQL database name
  -h, --host <host>               PostgreSQL host (default: localhost)
  -p, --port <port>               PostgreSQL port (default: 5432)
  -u, --user <user>               PostgreSQL username
  -W, --password <pass>           PostgreSQL password
  --duration <seconds>            Duration per concurrency level in seconds
  -o, --output <filename>         Excel report filename (auto-generated based on user count if omitted)
  --runs <count>                  Measured runs per query (default: 100)
  --warmup <count>                Warmup runs per query (default: 10)
  --help                          Display this help card
`);
  process.exit(0);
}

// Helper to parse queries from a SQL file
function parseSqlFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const fileContent = fs.readFileSync(filePath, 'utf8');
  return fileContent
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ------------------------------------------------------------------------------
// Load Queries
// ------------------------------------------------------------------------------
let customQueries = [];

if (cliRawQuery) {
  customQueries.push(cliRawQuery);
}

if (cliSqlFile) {
  if (fs.existsSync(cliSqlFile)) {
    const fileQueries = parseSqlFile(cliSqlFile);
    customQueries = [...customQueries, ...fileQueries];
    console.log(`Loaded ${fileQueries.length} query statement(s) from specified file: ${path.basename(cliSqlFile)}`);
  } else {
    console.warn(`Warning: Specified SQL file '${cliSqlFile}' not found.`);
  }
} else if (process.env.CUSTOM_QUERIES_FILE && fs.existsSync(process.env.CUSTOM_QUERIES_FILE)) {
  const fileQueries = parseSqlFile(process.env.CUSTOM_QUERIES_FILE);
  customQueries = [...customQueries, ...fileQueries];
  console.log(`Loaded ${fileQueries.length} query statement(s) from env file: ${path.basename(process.env.CUSTOM_QUERIES_FILE)}`);
} else {
  // If no SQL file argument is provided, default to default_queries.sql (or queries.sql)
  const defaultFile = fs.existsSync(path.join(__dirname, '..', 'default_queries.sql'))
    ? path.join(__dirname, '..', 'default_queries.sql')
    : fs.existsSync(path.join(__dirname, '..', 'queries.sql'))
      ? path.join(__dirname, '..', 'queries.sql')
      : null;

  if (defaultFile) {
    const fileQueries = parseSqlFile(defaultFile);
    customQueries = [...customQueries, ...fileQueries];
    console.log(`Loaded ${fileQueries.length} query statement(s) from default file: ${path.basename(defaultFile)}`);
  }
}

if (process.env.CUSTOM_QUERIES) {
  const envQueries = process.env.CUSTOM_QUERIES.split(';').map((s) => s.trim()).filter(Boolean);
  customQueries = [...customQueries, ...envQueries];
}

// Deduplicate queries
customQueries = Array.from(new Set(customQueries.map((s) => s.trim()))).filter(Boolean);

// Universal database-agnostic fallback queries if no queries found
if (!customQueries.length) {
  customQueries = [
    'SELECT version();',
    'SELECT datname, pg_size_pretty(pg_database_size(datname)) AS db_size FROM pg_database WHERE datname = current_database();',
    'SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN (\'pg_catalog\', \'information_schema\') ORDER BY table_name LIMIT 50;',
    'SELECT relname AS table_name, n_live_tup AS live_rows, n_dead_tup AS dead_rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;',
    'SELECT count(*) FROM pg_catalog.pg_tables;',
    'SELECT generate_series(1, 10000) AS val;'
  ];
  console.log(`Loaded ${customQueries.length} universal default PostgreSQL queries.`);
}

const concurrencyLevels = (cliConcurrency || process.env.CONCURRENCY_LEVELS || '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);

// Dynamic Report Filename Construction
let defaultOutputFile = 'benchmark-report.xlsx';
if (cliConcurrency) {
  const usersTag = concurrencyLevels.join('-');
  const sqlTag = cliSqlFile ? `-${path.basename(cliSqlFile, '.sql')}` : '';
  defaultOutputFile = `benchmark-report${sqlTag}-${usersTag}users.xlsx`;
} else if (cliSqlFile) {
  const sqlTag = path.basename(cliSqlFile, '.sql');
  defaultOutputFile = `benchmark-report-${sqlTag}.xlsx`;
}

const outputFile = cliOutput || (process.env.OUTPUT_FILE && process.env.OUTPUT_FILE !== 'benchmark-report.xlsx' ? process.env.OUTPUT_FILE : defaultOutputFile);

const config = {
  pg: {
    host: cliHost || process.env.PGHOST || 'localhost',
    port: int(cliPort || process.env.PGPORT, 5432),
    user: cliUser || process.env.PGUSER || 'postgres',
    password: cliPassword || process.env.PGPASSWORD || '',
    database: cliDatabase || process.env.PGDATABASE,
  },
  dockerContainer: process.env.DOCKER_CONTAINER || null,
  topN: int(process.env.TOP_N_QUERIES, 20),
  minCalls: int(process.env.MIN_CALLS, 5),
  warmupRuns: int(cliWarmupRuns || process.env.WARMUP_RUNS, 10),
  measuredRuns: int(cliMeasuredRuns || process.env.MEASURED_RUNS, 100),
  runColdCacheTest: bool(process.env.RUN_COLD_CACHE_TEST, false),
  concurrencyLevels,
  concurrencyDurationSeconds: int(cliDuration || process.env.CONCURRENCY_DURATION_SECONDS, 5),
  concurrencyQuery: process.env.CONCURRENCY_QUERY || 'top',
  customQueries,
  fullBenchmark: cliFullBenchmark,
  outputFile,
};

if (!config.pg.database) {
  console.error('ERROR: PGDATABASE is not set. Use -d <dbname> or set PGDATABASE in .env file.');
  process.exit(1);
}

module.exports = config;
