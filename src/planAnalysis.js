function walk(node, acc) {
  acc.nodeTypes.add(node['Node Type']);
  if (node['Node Type'] === 'Seq Scan') {
    acc.seqScans.push(node['Relation Name'] || '(unknown)');
  }
  if (node['Node Type'] && node['Node Type'].includes('Index')) {
    acc.indexScans.push(node['Relation Name'] || node['Index Name'] || '(unknown)');
  }
  acc.sharedHit += node['Shared Hit Blocks'] || 0;
  acc.sharedRead += node['Shared Read Blocks'] || 0;
  acc.sharedDirtied += node['Shared Dirtied Blocks'] || 0;
  acc.sharedWritten += node['Shared Written Blocks'] || 0;
  acc.tempRead += node['Temp Read Blocks'] || 0;
  acc.tempWritten += node['Temp Written Blocks'] || 0;
  acc.ioReadTime += node['I/O Read Time'] || 0;
  acc.ioWriteTime += node['I/O Write Time'] || 0;

  if (Array.isArray(node['Plans'])) {
    for (const child of node['Plans']) walk(child, acc);
  }
}

// planJson is the array returned by EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
function analyzePlan(planJson) {
  const top = planJson[0];
  const root = top['Plan'];

  const acc = {
    nodeTypes: new Set(),
    seqScans: [],
    indexScans: [],
    sharedHit: 0,
    sharedRead: 0,
    sharedDirtied: 0,
    sharedWritten: 0,
    tempRead: 0,
    tempWritten: 0,
    ioReadTime: 0,
    ioWriteTime: 0,
  };
  walk(root, acc);

  const estimatedRows = root['Plan Rows'];
  const actualRows = root['Actual Rows'];
  const estimateRatio = estimatedRows > 0 ? actualRows / estimatedRows : null;

  return {
    planningTimeMs: top['Planning Time'],
    executionTimeMs: top['Execution Time'],
    topNodeType: root['Node Type'],
    estimatedRows,
    actualRows,
    estimateRatio,
    sharedHit: acc.sharedHit,
    sharedRead: acc.sharedRead,
    sharedDirtied: acc.sharedDirtied,
    sharedWritten: acc.sharedWritten,
    tempRead: acc.tempRead,
    tempWritten: acc.tempWritten,
    ioReadTimeMs: acc.ioReadTime,
    ioWriteTimeMs: acc.ioWriteTime,
    seqScanTables: [...new Set(acc.seqScans)],
    indexScanTargets: [...new Set(acc.indexScans)],
    hasSeqScan: acc.seqScans.length > 0,
    hasIndexScan: acc.indexScans.length > 0,
    allNodeTypes: [...acc.nodeTypes],
  };
}

module.exports = { analyzePlan };
