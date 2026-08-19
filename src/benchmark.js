const { performance } = require('perf_hooks');
const pool = require('./db');
const config = require('./config');
const { analyzePlan } = require('./planAnalysis');
const { summarize } = require('./stats');

// Runs EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) inside a transaction that is always
// rolled back, so benchmarking a SELECT can never leave side effects even if a
// non-SELECT slips through classification.
async function explainOnce(client, sql) {
  await client.query('BEGIN');
  try {
    const start = performance.now();
    const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
    const clientWallTimeMs = performance.now() - start;
    const plan = analyzePlan(rows[0]['QUERY PLAN']);
    plan.clientWallTimeMs = clientWallTimeMs;
    plan.networkDelayMs = Math.max(0, clientWallTimeMs - plan.executionTimeMs);
    return plan;
  } finally {
    await client.query('ROLLBACK');
  }
}

async function benchmarkQuery(queryRow, { onProgress } = {}) {
  const client = await pool.connect();
  const results = [];
  try {
    // Warm-up runs: discarded, just to populate the buffer cache.
    for (let i = 0; i < config.warmupRuns; i++) {
      try {
        await explainOnce(client, queryRow.query);
      } catch (err) {
        return { ...queryRow, error: err.message, results: [] };
      }
    }

    for (let i = 0; i < config.measuredRuns; i++) {
      const r = await explainOnce(client, queryRow.query);
      results.push(r);
      if (onProgress) onProgress(i + 1, config.measuredRuns);
    }
  } catch (err) {
    return { ...queryRow, error: err.message, results };
  } finally {
    client.release();
  }

  const execTimes = results.map((r) => r.executionTimeMs);
  const planTimes = results.map((r) => r.planningTimeMs);
  const clientTimes = results.map((r) => r.clientWallTimeMs);
  const networkDelays = results.map((r) => r.networkDelayMs);
  const last = results[results.length - 1];

  return {
    ...queryRow,
    error: null,
    execStats: summarize(execTimes),
    planStats: summarize(planTimes),
    clientStats: summarize(clientTimes),
    networkStats: summarize(networkDelays),
    avgSharedHit: avg(results.map((r) => r.sharedHit)),
    avgSharedRead: avg(results.map((r) => r.sharedRead)),
    avgTempWritten: avg(results.map((r) => r.tempWritten)),
    avgIoReadTimeMs: avg(results.map((r) => r.ioReadTimeMs)),
    avgNetworkDelayMs: avg(networkDelays),
    topNodeType: last.topNodeType,
    hasSeqScan: last.hasSeqScan,
    seqScanTables: last.seqScanTables,
    hasIndexScan: last.hasIndexScan,
    estimatedRows: last.estimatedRows,
    actualRows: last.actualRows,
    estimateRatio: last.estimateRatio,
    firstRunMs: execTimes[0],
    lastRunMs: execTimes[execTimes.length - 1],
    results,
  };
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

async function benchmarkAll(queries) {
  const benchmarked = [];
  for (const q of queries) {
    if (!q.runnable) {
      benchmarked.push({ ...q, skipped: true });
      continue;
    }
    process.stdout.write(`  ${q.id}: running ${config.warmupRuns} warm-up + ${config.measuredRuns} measured runs... `);
    const result = await benchmarkQuery(q);
    if (result.error) {
      console.log(`FAILED (${result.error})`);
    } else {
      console.log(`done (avg ${result.execStats.avg.toFixed(2)} ms, p95 ${result.execStats.p95.toFixed(2)} ms)`);
    }
    benchmarked.push({ ...result, skipped: false });
  }
  return benchmarked;
}

module.exports = { benchmarkAll, benchmarkQuery, explainOnce };
