const { Pool } = require('pg');
const config = require('./config');
const { summarize } = require('./stats');
const { getDockerStats } = require('./system');

async function runWorker(pool, sql, deadline, latencies) {
  while (Date.now() < deadline) {
    const start = process.hrtime.bigint();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const end = process.hrtime.bigint();
    latencies.push(Number(end - start) / 1e6); // ms
  }
}

async function runLevel(sql, concurrency, durationSeconds) {
  const pool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    password: config.pg.password,
    database: config.pg.database,
    max: concurrency,
  });

  const latencies = [];
  const deadline = Date.now() + durationSeconds * 1000;
  const workers = Array.from({ length: concurrency }, () => runWorker(pool, sql, deadline, latencies));
  const startedAt = Date.now();
  await Promise.all(workers);
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  await pool.end();

  const stats = summarize(latencies);
  const dockerStats = getDockerStats(config.dockerContainer);

  return {
    concurrency,
    totalQueries: latencies.length,
    tps: latencies.length / elapsedSeconds,
    ...stats,
    dockerStats,
  };
}

async function runConcurrencySweep(sql) {
  if (!config.concurrencyLevels.length) return [];
  console.log(`\nRunning concurrency sweep: [${config.concurrencyLevels.join(', ')}] connections, ${config.concurrencyDurationSeconds}s each`);
  const levelResults = [];
  for (const level of config.concurrencyLevels) {
    process.stdout.write(`  ${level} connections... `);
    const result = await runLevel(sql, level, config.concurrencyDurationSeconds);
    console.log(`${result.tps.toFixed(1)} TPS, p95 ${result.p95.toFixed(2)} ms`);
    levelResults.push(result);
  }
  return levelResults;
}

module.exports = { runConcurrencySweep };
