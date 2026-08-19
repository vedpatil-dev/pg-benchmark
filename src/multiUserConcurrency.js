const { Pool } = require('pg');
const config = require('./config');
const { summarize } = require('./stats');
const { getDockerStats } = require('./system');

const DEFAULT_WORKLOAD = [
  'SELECT count(*), date(createddate) FROM tbl_userrolehistory GROUP BY date(createddate) ORDER BY count(*) DESC LIMIT 50;',
  'SELECT hoursworked, count(*) FROM tbl_dailyattendancen GROUP BY hoursworked ORDER BY count(*) DESC LIMIT 50;',
  'SELECT h.userrolegid, h.pageview, count(*) FROM tbl_userrolehistory h GROUP BY h.userrolegid, h.pageview ORDER BY count(*) DESC;',
  'SELECT * FROM tbl_userrole LIMIT 10;',
  'SELECT count(*) FROM tbl_dailyattendancen;',
];

async function runMultiUserWorker(pool, queries, deadline, metrics) {
  while (Date.now() < deadline) {
    const sql = queries[Math.floor(Math.random() * queries.length)];
    const t0 = process.hrtime.bigint();
    let client = null;
    let connAcquireMs = 0;
    try {
      client = await pool.connect();
      const t1 = process.hrtime.bigint();
      connAcquireMs = Number(t1 - t0) / 1e6;

      const tExecStart = process.hrtime.bigint();
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('ROLLBACK');
      const tExecEnd = process.hrtime.bigint();

      const execMs = Number(tExecEnd - tExecStart) / 1e6;
      const totalMs = Number(tExecEnd - t0) / 1e6;

      metrics.connWaits.push(connAcquireMs);
      metrics.execTimes.push(execMs);
      metrics.totalTimes.push(totalMs);
      metrics.successCount++;
    } catch (err) {
      metrics.errorCount++;
      if (!metrics.errors[err.message]) {
        metrics.errors[err.message] = 0;
      }
      metrics.errors[err.message]++;
    } finally {
      if (client) client.release();
    }
  }
}

async function runMultiUserLevel(userCount, durationSeconds, queries) {
  const pool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    password: config.pg.password,
    database: config.pg.database,
    max: userCount,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });

  const metrics = {
    connWaits: [],
    execTimes: [],
    totalTimes: [],
    successCount: 0,
    errorCount: 0,
    errors: {},
  };

  const deadline = Date.now() + durationSeconds * 1000;
  const workers = Array.from({ length: userCount }, () =>
    runMultiUserWorker(pool, queries, deadline, metrics)
  );

  const startedAt = Date.now();
  await Promise.all(workers);
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  await pool.end();

  const connWaitStats = summarize(metrics.connWaits);
  const execStats = summarize(metrics.execTimes);
  const totalStats = summarize(metrics.totalTimes);
  const dockerStats = getDockerStats(config.dockerContainer);

  return {
    simulatedUsers: userCount,
    poolSize: userCount,
    durationSeconds,
    totalQueries: metrics.successCount + metrics.errorCount,
    successCount: metrics.successCount,
    errorCount: metrics.errorCount,
    tps: metrics.successCount / elapsedSeconds,
    connWaitStats,
    execStats,
    totalStats,
    errors: metrics.errors,
    dockerStats,
  };
}

async function runMultiUserSimulation(levels = config.concurrencyLevels, durationSeconds = config.concurrencyDurationSeconds) {
  if (!levels.length) return [];
  const workloadQueries = config.customQueries.length ? config.customQueries : DEFAULT_WORKLOAD;
  console.log(`\nSimulating Multi-User Workload (${workloadQueries.length} distinct query types) across user connection levels: [${levels.join(', ')}] ...`);

  const results = [];
  for (const userCount of levels) {
    process.stdout.write(`  ${userCount} concurrent users... `);
    const res = await runMultiUserLevel(userCount, durationSeconds, workloadQueries);
    console.log(
      `${res.tps.toFixed(1)} TPS | Conn Wait Avg ${res.connWaitStats.avg ? res.connWaitStats.avg.toFixed(1) : 0}ms (p95 ${res.connWaitStats.p95 ? res.connWaitStats.p95.toFixed(1) : 0}ms) | Exec Avg ${res.execStats.avg ? res.execStats.avg.toFixed(1) : 0}ms | Errors: ${res.errorCount}`
    );
    results.push(res);
  }
  return results;
}

module.exports = { runMultiUserSimulation, runMultiUserLevel };
