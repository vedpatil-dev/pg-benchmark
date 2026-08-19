function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return sortedArr[Math.max(0, idx)];
}

function summarize(values) {
  if (!values.length) {
    return { runs: 0, min: null, avg: null, p50: null, p95: null, p99: null, max: null, stddev: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const avg = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - avg) ** 2, 0) / n;
  return {
    runs: n,
    min: sorted[0],
    avg,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[n - 1],
    stddev: Math.sqrt(variance),
  };
}

module.exports = { percentile, summarize };
