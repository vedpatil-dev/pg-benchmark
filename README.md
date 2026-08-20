# PostgreSQL Query Performance Benchmark Tool (pg-benchmark)

A repeatable Node.js performance benchmark and load testing tool for PostgreSQL databases (local, remote server, or Dockerized). It automatically pulls top queries, benchmarks warm-up vs steady-state latency percentiles via `EXPLAIN (ANALYZE, BUFFERS)`, detects sequential table scans, measures multi-user connection concurrency limits, and generates comprehensive Excel diagnostic reports.

---

## Quick Usage

```bash
# 1. Default Mode: Discovers .sql files in repo and runs full single-query profiling
node index.js

# 2. Fast User Load Test Mode: Runs ONLY user load test (skips single-query warm-ups)
node index.js 1500

# 3. Full Benchmark Mode: Runs BOTH single-query profiling AND user load test
node index.js --benchmark 1500
node index.js -b 1500

# 4. Custom SQL File Load Test: Runs load test on specific .sql file
node index.js queries.sql 50
node index.js queries.sql -b 50
```

---

## Excel Reports Generated

Every run automatically generates a distinct Excel report:
- `benchmark-report.xlsx` (Default run)
- `benchmark-report-1500users.xlsx` (`node index.js 1500`)
- `benchmark-report-queries-50users.xlsx` (`node index.js queries.sql 50`)

### Report Sheets Included:

| Sheet | Purpose & Contents |
|---|---|
| **1. Environment** | PG version, DB size, largest tables, index count, `track_io_timing`, connection state breakdown, and Docker CPU/RAM snapshot. |
| **2. Query Benchmark Summary** | Executive report card: Min/Avg/P50/P95/P99/Max/StdDev latency, warm-up vs steady-state time, top plan node, RAM vs disk buffers, and status indicators. |
| **3. Full Query Text** | Untruncated SQL text for every query ID (`CQ01`, `Q01`, etc.). |
| **4. Buffer & Plan Analysis** | DBA Diagnostic sheet: Sequential scan table list, index scan usage, temp buffer writes, I/O read wait times, planning times, and row estimation ratios (`actual / estimated`). |
| **5. Raw Runs** | Per-run granular execution time, planning time, and buffer hits for statistical plotting. |
| **6. Skipped (Parameterized)** | Parameterized queries from `pg_stat_statements` reported via lifetime aggregates without re-execution. |
| **7. Concurrency Sweep** | TPS throughput and latency percentiles under single-query concurrency sweeps. |
| **8. Multi-User Load & Limits** | Multi-user simulated workload evaluating TPS capacity limits, connection pool queueing (`Conn Wait P95`), and error drop rates. |

---

## Configuration & CLI Options

For full documentation on parameters, report metric definitions, and evaluation rules, see **[PARAMETERS.md](file:///home/ved1345/Documents/Emgage/postgress_test/pg-benchmark/PARAMETERS.md)**.

| Variable / CLI Flag | Default | Description |
|---|---|---|
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` (`-d`) | — | Standard PostgreSQL connection settings |
| `[sql_file]` / `-f` / `--file` | Auto-discovery | SQL file path to benchmark (or scans all `.sql` files in repo) |
| `[dummy_user_count]` / `-c` / `--users` | — | Concurrent dummy user connection count (e.g. `50` or `1500`) |
| `-b` / `--benchmark` | — | Force full single-query profiling + user load test |
| `-q` / `--query` | — | Direct SQL query statement string to benchmark |
| `WARMUP_RUNS` / `--warmup` | 10 | Unmeasured initial runs to warm up buffer cache |
| `MEASURED_RUNS` / `--runs` | 100 | Measured runs per query for latency percentiles |
| `CONCURRENCY_DURATION_SECONDS` / `--duration` | 5 | Duration in seconds per concurrency level |
| `OUTPUT_FILE` / `-o` | Auto-generated | Target Excel report path |

---

## Safety & Database Protection

- **Read-Only / Rollback Protection**: Every query execution occurs inside a transaction (`BEGIN ... ROLLBACK`) that is immediately rolled back. The benchmark **never mutates database data**.
- **Docker Optional**: Works with local PostgreSQL, remote servers, AWS RDS, GCP Cloud SQL, or Azure Database. Docker is 100% optional.
