const ExcelJS = require('exceljs');
const config = require('./config');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true };

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  row.height = 20;
}

function autoWidth(sheet, minWidth = 10, maxWidth = 60) {
  sheet.columns.forEach((col) => {
    let max = minWidth;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > max) max = Math.min(len + 2, maxWidth);
    });
    col.width = max;
  });
}

function statusFor(q) {
  if (q.skipped) return '⏭️ skipped (parameterized)';
  if (q.error) return '❌ error';
  if (q.hasSeqScan) return '⚠️ seq scan';
  if (q.execStats.p95 > 100) return '⚠️ slow (p95 > 100ms)';
  return '✅';
}

function buildEnvironmentSheet(wb, baseline) {
  const sheet = wb.addWorksheet('Environment');
  sheet.columns = [{ width: 28 }, { width: 80 }];
  const rows = [
    ['Test date', baseline.testDate],
    ['Database', baseline.databaseName],
    ['PostgreSQL version', baseline.pgVersion],
    ['Database size', baseline.databaseSize],
    ['Index count', baseline.indexCount],
    ['track_io_timing', baseline.trackIoTiming],
    ['Docker container', baseline.dockerContainer || 'n/a'],
    ['Docker image', baseline.dockerImage || 'n/a'],
    ['Docker CPU limit', baseline.dockerCpuLimit || 'n/a'],
    ['Docker memory limit', baseline.dockerMemoryLimit || 'n/a'],
  ];
  if (baseline.dockerStatsSnapshot) {
    const d = baseline.dockerStatsSnapshot;
    rows.push(
      ['Docker CPU % (snapshot)', d.cpuPerc],
      ['Docker Mem usage (snapshot)', d.memUsage],
      ['Docker Mem % (snapshot)', d.memPerc],
      ['Docker Net I/O (snapshot)', d.netIO],
      ['Docker Block I/O (snapshot)', d.blockIO]
    );
  }
  rows.forEach((r) => sheet.addRow(r));
  sheet.getColumn(1).font = { bold: true };

  sheet.addRow([]);
  const connHeader = sheet.addRow(['Connection state', 'Count']);
  styleHeader(connHeader);
  baseline.connectionStates.forEach((s) => sheet.addRow([s.state || '(none)', s.count]));

  sheet.addRow([]);
  const tblHeader = sheet.addRow(['Largest tables', 'Size']);
  styleHeader(tblHeader);
  baseline.largestTables.forEach((t) => sheet.addRow([`${t.schemaname}.${t.relname}`, t.total_size]));

  return sheet;
}

function buildSummarySheet(wb, benchmarked) {
  const sheet = wb.addWorksheet('Query Benchmark Summary');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Query (truncated)', key: 'query', width: 50 },
    { header: 'Calls (all-time)', key: 'calls', width: 14 },
    { header: 'Runs', key: 'runs', width: 8 },
    { header: 'Min (ms)', key: 'min', width: 10 },
    { header: 'Avg (ms)', key: 'avg', width: 10 },
    { header: 'P50 (ms)', key: 'p50', width: 10 },
    { header: 'P95 (ms)', key: 'p95', width: 10 },
    { header: 'P99 (ms)', key: 'p99', width: 10 },
    { header: 'Max (ms)', key: 'max', width: 10 },
    { header: 'Stddev (ms)', key: 'stddev', width: 12 },
    { header: 'Network delay avg (ms)', key: 'networkDelay', width: 22 },
    { header: 'First run (ms)', key: 'first', width: 13 },
    { header: 'Steady-state run (ms)', key: 'last', width: 18 },
    { header: 'Top plan node', key: 'topNode', width: 16 },
    { header: 'Avg shared hit', key: 'sharedHit', width: 14 },
    { header: 'Avg shared read', key: 'sharedRead', width: 15 },
    { header: 'Est. vs actual rows', key: 'rowsRatio', width: 18 },
    { header: 'Status', key: 'status', width: 22 },
  ];
  styleHeader(sheet.getRow(1));

  benchmarked.forEach((q) => {
    if (q.skipped || q.error) {
      sheet.addRow({
        id: q.id,
        query: q.query.slice(0, 120),
        calls: q.calls,
        status: statusFor(q),
      });
      return;
    }
    sheet.addRow({
      id: q.id,
      query: q.query.slice(0, 120),
      calls: q.calls,
      runs: q.execStats.runs,
      min: round(q.execStats.min),
      avg: round(q.execStats.avg),
      p50: round(q.execStats.p50),
      p95: round(q.execStats.p95),
      p99: round(q.execStats.p99),
      max: round(q.execStats.max),
      stddev: round(q.execStats.stddev),
      networkDelay: round(q.avgNetworkDelayMs),
      first: round(q.firstRunMs),
      last: round(q.lastRunMs),
      topNode: q.topNodeType,
      sharedHit: round(q.avgSharedHit),
      sharedRead: round(q.avgSharedRead),
      rowsRatio: q.estimateRatio != null ? `${q.estimatedRows} -> ${q.actualRows} (${q.estimateRatio.toFixed(1)}x)` : 'n/a',
      status: statusFor(q),
    });
  });

  sheet.autoFilter = { from: 'A1', to: 'S1' };
  return sheet;
}

function buildQueryTextSheet(wb, benchmarked) {
  const sheet = wb.addWorksheet('Full Query Text');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Full query text', key: 'query', width: 120 },
  ];
  styleHeader(sheet.getRow(1));
  benchmarked.forEach((q) => sheet.addRow({ id: q.id, query: q.query }));
  sheet.getColumn('query').alignment = { wrapText: true };
  return sheet;
}

function buildPlanAnalysisSheet(wb, benchmarked) {
  const sheet = wb.addWorksheet('Buffer & Plan Analysis');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Top plan node', key: 'topNode', width: 16 },
    { header: 'Seq scan?', key: 'seqScan', width: 10 },
    { header: 'Seq scan tables', key: 'seqTables', width: 30 },
    { header: 'Index scan?', key: 'idxScan', width: 11 },
    { header: 'Avg shared hit (buffers)', key: 'hit', width: 22 },
    { header: 'Avg shared read (buffers)', key: 'read', width: 24 },
    { header: 'Avg temp written (buffers)', key: 'tempWritten', width: 24 },
    { header: 'Avg I/O read time (ms)', key: 'ioTime', width: 20 },
    { header: 'Planning time avg (ms)', key: 'planAvg', width: 20 },
    { header: 'Planning time p95 (ms)', key: 'planP95', width: 20 },
    { header: 'Estimated rows', key: 'estRows', width: 14 },
    { header: 'Actual rows', key: 'actRows', width: 12 },
    { header: 'Estimate ratio (actual/est)', key: 'ratio', width: 24 },
  ];
  styleHeader(sheet.getRow(1));
  benchmarked
    .filter((q) => !q.skipped && !q.error)
    .forEach((q) =>
      sheet.addRow({
        id: q.id,
        topNode: q.topNodeType,
        seqScan: q.hasSeqScan ? 'YES' : 'no',
        seqTables: q.seqScanTables.join(', '),
        idxScan: q.hasIndexScan ? 'yes' : 'no',
        hit: round(q.avgSharedHit),
        read: round(q.avgSharedRead),
        tempWritten: round(q.avgTempWritten),
        ioTime: round(q.avgIoReadTimeMs),
        planAvg: round(q.planStats.avg),
        planP95: round(q.planStats.p95),
        estRows: q.estimatedRows,
        actRows: q.actualRows,
        ratio: q.estimateRatio != null ? q.estimateRatio.toFixed(2) : 'n/a',
      })
    );
  return sheet;
}

function buildRawRunsSheet(wb, benchmarked) {
  const sheet = wb.addWorksheet('Raw Runs');
  sheet.columns = [
    { header: 'Query ID', key: 'id', width: 10 },
    { header: 'Run #', key: 'run', width: 8 },
    { header: 'Execution time (ms)', key: 'exec', width: 18 },
    { header: 'Planning time (ms)', key: 'plan', width: 18 },
    { header: 'Shared hit', key: 'hit', width: 12 },
    { header: 'Shared read', key: 'read', width: 12 },
  ];
  styleHeader(sheet.getRow(1));
  benchmarked
    .filter((q) => !q.skipped && !q.error)
    .forEach((q) => {
      q.results.forEach((r, i) => {
        sheet.addRow({
          id: q.id,
          run: i + 1,
          exec: round(r.executionTimeMs),
          plan: round(r.planningTimeMs),
          hit: r.sharedHit,
          read: r.sharedRead,
        });
      });
    });
  return sheet;
}

function buildSkippedSheet(wb, benchmarked) {
  const skipped = benchmarked.filter((q) => q.skipped);
  const sheet = wb.addWorksheet('Skipped (Parameterized)');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Query (normalized, truncated)', key: 'query', width: 80 },
    { header: 'Calls (all-time)', key: 'calls', width: 14 },
    { header: 'Mean exec time (ms, from pg_stat_statements)', key: 'mean', width: 30 },
    { header: 'Max exec time (ms)', key: 'max', width: 16 },
    { header: 'Reason skipped', key: 'reason', width: 30 },
  ];
  styleHeader(sheet.getRow(1));
  skipped.forEach((q) =>
    sheet.addRow({
      id: q.id,
      query: q.query.slice(0, 200),
      calls: q.calls,
      mean: round(q.mean_exec_time),
      max: round(q.max_exec_time),
      reason: q.hasPlaceholders ? 'contains $1-style parameters' : !q.isSelect ? 'not a SELECT (safety)' : 'system query',
    })
  );
  sheet.addRow([]);
  sheet.addRow(['Note: these were not re-executed to avoid guessing real parameter values.']);
  sheet.addRow(['Stats above are pg_stat_statements\' own lifetime aggregates for that query shape.']);
  return sheet;
}

function buildConcurrencySheet(wb, levelResults, sql) {
  if (!levelResults.length) return null;
  const sheet = wb.addWorksheet('Concurrency Sweep');
  sheet.addRow(['Query used:', sql.slice(0, 300)]);
  sheet.addRow([]);
  const header = sheet.addRow([
    'Connections',
    'Total queries',
    'TPS',
    'Min (ms)',
    'Avg (ms)',
    'P50 (ms)',
    'P95 (ms)',
    'P99 (ms)',
    'Max (ms)',
    'Docker CPU %',
    'Docker Mem %',
  ]);
  styleHeader(header);
  levelResults.forEach((r) =>
    sheet.addRow([
      r.concurrency,
      r.totalQueries,
      round(r.tps),
      round(r.min),
      round(r.avg),
      round(r.p50),
      round(r.p95),
      round(r.p99),
      round(r.max),
      r.dockerStats ? r.dockerStats.cpuPerc : 'n/a',
      r.dockerStats ? r.dockerStats.memPerc : 'n/a',
    ])
  );
  autoWidth(sheet);
  return sheet;
}

function buildMultiUserSheet(wb, multiUserResults) {
  if (!multiUserResults || !multiUserResults.length) return null;
  const sheet = wb.addWorksheet('Multi-User Load & Limits');
  sheet.addRow(['Simulated Workload:', 'Multi-User Concurrent Query Execution & Connection Delay Test']);
  sheet.addRow([]);
  const header = sheet.addRow([
    'Simulated Users',
    'Total Queries',
    'Successes',
    'Errors / Rejections',
    'TPS',
    'Conn Wait Avg (ms)',
    'Conn Wait P95 (ms)',
    'Exec Avg (ms)',
    'Exec P95 (ms)',
    'Total Latency Avg (ms)',
    'Total Latency P95 (ms)',
    'Error Details',
  ]);
  styleHeader(header);
  multiUserResults.forEach((r) => {
    const errText = Object.entries(r.errors || {})
      .map(([msg, cnt]) => `${msg} (${cnt})`)
      .join('; ');
    sheet.addRow([
      r.simulatedUsers,
      r.totalQueries,
      r.successCount,
      r.errorCount,
      round(r.tps),
      round(r.connWaitStats.avg),
      round(r.connWaitStats.p95),
      round(r.execStats.avg),
      round(r.execStats.p95),
      round(r.totalStats.avg),
      round(r.totalStats.p95),
      errText || 'None',
    ]);
  });
  autoWidth(sheet);
  return sheet;
}

function round(n, digits = 3) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Number(n.toFixed(digits));
}

async function generateReport({ baseline, benchmarked, concurrencyResults, concurrencySql, multiUserResults }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'pg-benchmark';
  wb.created = new Date();

  buildEnvironmentSheet(wb, baseline);
  buildSummarySheet(wb, benchmarked);
  buildQueryTextSheet(wb, benchmarked);
  buildPlanAnalysisSheet(wb, benchmarked);
  buildRawRunsSheet(wb, benchmarked);
  buildSkippedSheet(wb, benchmarked);
  buildConcurrencySheet(wb, concurrencyResults || [], concurrencySql || '');
  buildMultiUserSheet(wb, multiUserResults || []);

  await wb.xlsx.writeFile(config.outputFile);
  return config.outputFile;
}

module.exports = { generateReport };
