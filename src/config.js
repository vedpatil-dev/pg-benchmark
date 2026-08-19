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
  } else if (arg === '-c' || arg === '--concurrency') {
    cliConcurrency = args[++i];
  } else if (arg === '--duration') {
    cliDuration = args[++i];
  } else if (arg === '-o' || arg === '--output') {
    cliOutput = args[++i];
  } else if (arg === '--runs') {
    cliMeasuredRuns = args[++i];
  } else if (arg === '--warmup') {
    cliWarmupRuns = args[++i];
  } else if (!arg.startsWith('-') && !cliSqlFile) {
    cliSqlFile = arg;
  }
}

if (showHelp) {
  console.log(`
===================================================================
 PostgreSQL Query Performance Benchmarking Tool (pg-benchmark)
===================================================================

Usage:
  node index.js [sql_file] [options]
  npm start -- [sql_file] [options]
  npx pg-benchmark [sql_file] [options]

Examples:
  node index.js                         (Automatically benchmarks ALL .sql files in repo)
  node index.js queries.sql             (Benchmarks specific .sql file)
  node index.js --database my_db --concurrency 10,25,50
  node index.js --query "SELECT count(*) FROM information_schema.tables;" --output report.xlsx

Options:
  [sql_file], -f, --file <path>   Path to .sql file containing query/queries
  -q, --query "<sql>"             Raw SQL statement to benchmark
  -d, --database <name>           PostgreSQL database name
  -h, --host <host>               PostgreSQL host (default: localhost)
  -p, --port <port>               PostgreSQL port (default: 5432)
  -u, --user <user>               PostgreSQL username
  -W, --password <pass>           PostgreSQL password
  -c, --concurrency <levels>      Concurrency levels (e.g., "1,5,10,25,50")
  --duration <seconds>            Duration per concurrency level in seconds
  -o, --output <filename>         Excel report filename (default: benchmark-report.xlsx)
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

// Helper to recursively discover all .sql files in repository
function discoverSqlFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        results = results.concat(discoverSqlFiles(filePath));
      }
    } else if (file.endsWith('.sql')) {
      results.push(filePath);
    }
  });
  return results;
}

// ------------------------------------------------------------------------------
// Load Queries
// ------------------------------------------------------------------------------
let customQueries = [];

if (cliRawQuery) {
  customQueries.push(cliRawQuery);
}

if (cliSqlFile) {
  // User explicitly specified a single SQL file
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
  // Automatically discover and aggregate queries from ALL .sql files in repository
  const repoRoot = path.join(__dirname, '..');
  const sqlFiles = discoverSqlFiles(repoRoot);
  if (sqlFiles.length > 0) {
    console.log(`Discovered ${sqlFiles.length} .sql file(s) in repository: ${sqlFiles.map((f) => path.basename(f)).join(', ')}`);
    for (const sqlFile of sqlFiles) {
      const fileQueries = parseSqlFile(sqlFile);
      console.log(`  Loaded ${fileQueries.length} statement(s) from ${path.basename(sqlFile)}`);
      customQueries = [...customQueries, ...fileQueries];
    }
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
  concurrencyLevels: (cliConcurrency || process.env.CONCURRENCY_LEVELS || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0),
  concurrencyDurationSeconds: int(cliDuration || process.env.CONCURRENCY_DURATION_SECONDS, 5),
  concurrencyQuery: process.env.CONCURRENCY_QUERY || 'top',
  customQueries,
  outputFile: cliOutput || process.env.OUTPUT_FILE || 'benchmark-report.xlsx',
};

if (!config.pg.database) {
  console.error('ERROR: PGDATABASE is not set. Use -d <dbname> or set PGDATABASE in .env file.');
  process.exit(1);
}

module.exports = config;
