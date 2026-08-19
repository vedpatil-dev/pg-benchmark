const { Pool } = require('pg');
const config = require('./config');
const { summarize } = require('./stats');
const { getDockerStats } = require('./system');

async function runWorker(pool, sql, deadline, latencies, errors) {
  while (Date.now() < deadline) {
    const start = process.hrtime.bigint();
    let client = null;
    try {
      client = await pool.connect();
      client.on('error', () => {
        // Suppress unhandled error event emitted by Client instance on server kill
      });
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('ROLLBACK');
      const end = process.hrtime.bigint();
      latencies.push(Number(end - start) / 1e6); // ms
    } catch (err) {
      errors.count = (errors.count || 0) + 1;
      errors.lastMsg = err.message;
    } finally {
      if (client) {
        try { client.release(true); } catch (_) {}
      }
    }
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
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    // Suppress unhandled pool error events when PostgreSQL server kills connections
  });

  const latencies = [];
  const errors = { count: 0, lastMsg: null };
  const deadline = Date.now() + durationSeconds * 1000;
  const workers = Array.from({ length: concurrency }, () =>
    runWorker(pool, sql, deadline, latencies, errors)
  );

  const startedAt = Date.now();
  await Promise.all(workers);
  const elapsedSeconds = (Date.now() - startedAt) / 1000;

  try { await pool.end(); } catch (_) {}

  const stats = summarize(latencies);
  const dockerStats = getDockerStats(config.dockerContainer);

  return {
    concurrency,
    totalQueries: latencies.length,
    tps: elapsedSeconds > 0 ? latencies.length / elapsedSeconds : 0,
    errors: errors.count,
    lastError: errors.lastMsg,
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
    if (result.errors > 0) {
      console.log(`${result.tps.toFixed(1)} TPS, p95 ${result.p95 ? result.p95.toFixed(2) : 0} ms (${result.errors} connection drops/errors: ${result.lastError})`);
    } else {
      console.log(`${result.tps.toFixed(1)} TPS, p95 ${result.p95 ? result.p95.toFixed(2) : 0} ms`);
    }
    levelResults.push(result);
  }
  return levelResults;
}

module.exports = { runConcurrencySweep };
