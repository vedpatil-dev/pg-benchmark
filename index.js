const config = require('./src/config');
const pool = require('./src/db');
const { collectBaseline } = require('./src/system');
const { fetchTopQueries } = require('./src/statements');
const { benchmarkAll } = require('./src/benchmark');
const { runConcurrencySweep } = require('./src/concurrency');
const { runMultiUserSimulation } = require('./src/multiUserConcurrency');
const { generateReport } = require('./src/report');

async function main() {
  console.log(`Connecting to ${config.pg.database}@${config.pg.host}:${config.pg.port} ...`);
  await pool.query('SELECT 1;'); // fail fast if connection is bad

  const baseline = await collectBaseline();
  console.log(`  PostgreSQL: ${baseline.pgVersion.split(',')[0]}`);
  console.log(`  Database size: ${baseline.databaseSize}\n`);

  console.log(`Pulling top ${config.topN} queries from pg_stat_statements (min ${config.minCalls} calls)...`);
  const queries = await fetchTopQueries();
  if (!queries.length) {
    console.error('No queries found. Is pg_stat_statements enabled and has your app run any traffic yet?');
    process.exit(1);
  }
  const runnableCount = queries.filter((q) => q.runnable).length;
  console.log(`  Found ${queries.length} queries: ${runnableCount} runnable, ${queries.length - runnableCount} parameterized/skipped.\n`);

  console.log('Benchmarking each runnable query...');
  const benchmarked = await benchmarkAll(queries);

  let concurrencyResults = [];
  let concurrencySql = null;
  if (config.concurrencyLevels.length) {
    const target = config.concurrencyQuery === 'top'
      ? benchmarked.find((q) => !q.skipped && !q.error)
      : { query: config.concurrencyQuery };
    if (target) {
      concurrencySql = target.query;
      concurrencyResults = await runConcurrencySweep(concurrencySql);
    } else {
      console.warn('\nSkipping concurrency sweep: no runnable query available to use as the target.');
    }
  }

  let multiUserResults = [];
  if (config.concurrencyLevels.length) {
    multiUserResults = await runMultiUserSimulation();
  }

  console.log('\nWriting Excel report...');
  const outFile = await generateReport({ baseline, benchmarked, concurrencyResults, concurrencySql, multiUserResults });
  console.log(`Done: ${outFile}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('\nBenchmark failed:', err);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
