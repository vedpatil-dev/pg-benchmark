# PostgreSQL Query Performance Benchmark Tool (pg-benchmark) - Complete Guide & Parameter Reference

This document explains **execution modes & CLI usage**, **what each report sheet shows**, **what every column name denotes**, **the technical meaning of metrics**, **how to judge performance**, and **what happens if Docker is not used**.

---

## Quick Command & Execution Mode Reference

| Command | Execution Mode & Behavior | Excel Report Name Generated |
|---|---|---|
| `node index.js` | **Default Mode**: Discovers `.sql` files, runs single-query profiling (`CQ01...`, `Q01...`). | `benchmark-report.xlsx` |
| `node index.js 1500` | **Fast User Load Test Mode**: Skips single-query profiling loop, runs **ONLY** 1500 user load test directly. | `benchmark-report-1500users.xlsx` |
| `node index.js --benchmark 1500`<br>`node index.js -b 1500` | **Full Benchmark Mode**: Runs **BOTH** full single-query profiling **AND** 1500 user load test. | `benchmark-report-1500users.xlsx` |
| `node index.js queries.sql 50` | Fast 50 user load test on [queries.sql](file:///home/ved1345/Documents/Emgage/postgress_test/pg-benchmark/queries.sql). | `benchmark-report-queries-50users.xlsx` |
| `node index.js queries.sql -b 50` | Full single-query profiling + 50 user load test on `queries.sql`. | `benchmark-report-queries-50users.xlsx` |
| `node index.js -o custom.xlsx` | Benchmark run with explicit output file name `-o`. | `custom.xlsx` |

---

## Part 1: What Each Report Sheet Shows & Its Purpose

| Sheet Name | Purpose & What It Shows | When to Use It |
|---|---|---|
| **1. Environment** | Displays system hardware specs, PostgreSQL version, database disk size, index count, container limits, largest tables, and active connection state counts. | Check database environment, table sizes, and system resources. |
| **2. Query Benchmark Summary** | The **Executive Report Card** for all queries. Summarizes execution latency (`P50`, `P95`, `P99`), cache hit ratios, top plan operators, and status indicators. | First sheet to inspect. Identify which queries are slow or missing indexes. |
| **3. Full Query Text** | Maps Query IDs (`CQ01`, `Q01`, etc.) to complete, untruncated SQL text strings. | Copy full SQL text to run `EXPLAIN ANALYZE` manually in pgAdmin or psql. |
| **4. Buffer & Plan Analysis** | **DBA Diagnostic Sheet**. Detailed breakdown of Sequential Scans, Index Scans, shared RAM buffers vs disk I/O reads, and planner estimate accuracy. | Find missing indexes and check if PostgreSQL statistics are up to date. |
| **5. Raw Runs** | Granular execution time and planning time recorded for every individual run (Run #1 to #100/200). | Verify latency stability and detect intermittent latency spikes. |
| **6. Skipped (Parameterized)** | Lists queries from `pg_stat_statements` containing `$1` parameters that were not re-executed, displaying their lifetime aggregate stats. | Review production queries captured from background app traffic. |
| **7. Concurrency Sweep** | Single-query stress test evaluating throughput (`TPS`) and latency under increasing connection levels (`10` to `500`). | Determine query scalability under high connection concurrency. |
| **8. Multi-User Load & Limits** | Real-world multi-user load simulation running mixed workload queries across concurrent user levels. | Find database capacity limits, connection pool bottlenecks, and breaking points. |

---

## Part 2: Column Name Definitions Glossary

### Summary & Execution Time Columns
- **ID**: Unique query code (`CQ01`, `CQ02` = Custom queries; `Q01`, `Q02` = `pg_stat_statements` queries).
- **Query (truncated)**: First 120 characters of the SQL statement.
- **Calls (all-time)**: Total historical execution count recorded in PostgreSQL's `pg_stat_statements`.
- **Runs**: Total measured benchmark iterations performed by this tool (default: 100 or 200).
- **Min (ms)**: Fastest execution latency recorded.
- **Avg (ms)**: Arithmetic mean execution time across all measured runs.
- **P50 (ms)**: **50th Percentile (Median)**. Half of all query executions ran faster than this value.
- **P95 (ms)**: **95th Percentile (Primary SLA Metric)**. 95% of query executions ran faster than this value. This is the industry-standard benchmark metric.
- **P99 (ms)**: **99th Percentile (Tail Latency)**. Indicates worst-case execution performance under load.
- **Max (ms)**: Slowest single execution latency recorded.
- **Stddev (ms)**: **Standard Deviation**. Measures latency stability. Low values mean consistent speed; high values mean unpredictable latency.
- **Network delay avg (ms)**: Client-to-database round-trip communication overhead.
- **First run (ms)**: Execution latency of the 1st iteration (uncached cold buffer).
- **Steady-state run (ms)**: Execution latency after buffer cache warm-up runs.

### Buffer & Query Plan Columns
- **Top plan node**: Main plan operator node (e.g., `Index Scan`, `Seq Scan`, `Hash Join`, `Aggregate`).
- **Seq scan?**: Indicates if a **Sequential Table Scan** occurred (`YES` or `no`). Sequential scans read full tables row-by-row and usually indicate missing indexes.
- **Seq scan tables**: Names of specific database tables subjected to sequential table scans.
- **Index scan?**: Indicates if an **Index Scan** was utilized (`yes` or `no`).
- **Avg shared hit**: Average number of 8KB database pages read directly from PostgreSQL RAM (`shared_buffers`).
- **Avg shared read**: Average number of 8KB database pages read from physical disk storage.
- **Avg temp written**: Pages written to disk temporary files during heavy sorting or hash join operations.
- **Avg I/O read time (ms)**: Milliseconds spent waiting for physical disk storage reads.
- **Planning time avg / p95 (ms)**: Time taken by PostgreSQL optimizer to parse SQL and build query plans.
- **Est. vs actual rows / Estimate ratio**: Ratio comparing optimizer's estimated row count to actual returned rows (`actual / estimated`).

### Concurrency & Multi-User Load Columns
- **Simulated Users / Connections**: Number of active concurrent client connections hammering the database.
- **TPS (Transactions Per Second)**: Number of completed successful query transactions per second.
- **Conn Wait Avg / P95 (ms)**: Time spent waiting in application connection pool queue before acquiring a connection.
- **Exec Avg / P95 (ms)**: Pure server-side query processing execution latency under concurrent load.
- **Total Latency Avg / P95 (ms)**: End-to-end total latency (`Conn Wait + Query Exec Time`).
- **Error Count / Drops**: Connection timeouts, connection pool exhaustion, or database server rejections.

---

## Part 3: How to JUDGE Performance (Evaluation Criteria & Fix Rules)

### Rule 1: Judging Query Speed (`P95 Latency`)
- **GOOD (`< 10ms`)**: Excellent for transactional OLTP queries (lookups, single row fetches).
- **ACCEPTABLE (`10ms - 50ms`)**: Normal for complex reporting or aggregation queries.
- **WARNING (`50ms - 100ms`)**: Query is starting to become a bottleneck under high user concurrency.
- **BAD (`> 100ms`)**: Marked with `⚠️ slow (p95 > 100ms)`. Requires immediate optimization (add index, rewrite query, or add `LIMIT`).

### Rule 2: Judging Index Utilization (`Seq Scan?`)
- **GOOD (`Seq scan? = no`)**: Query uses an Index Scan. PostgreSQL jumps directly to matching rows.
- **BAD (`Seq scan? = YES`)**: Marked with `⚠️ seq scan`. Full table scan forced!
- **How to Fix**: Create an index on the table columns referenced in `WHERE`, `JOIN ON`, or `ORDER BY`.
  ```sql
  CREATE INDEX idx_tablename_column ON table_name(column_name);
  ```

### Rule 3: Judging Memory vs Disk Cache (`Buffer Hit Ratio`)
- Calculate Buffer Hit Ratio:
  $$\text{Hit Ratio} = \frac{\text{Shared Hit}}{\text{Shared Hit} + \text{Shared Read}} \times 100\%$$
- **GOOD (`> 99%`)**: Almost all data is served instantly from RAM (`shared_buffers`).
- **BAD (`< 95%`)**: Database is bottlenecked by physical disk storage reads (`Shared Read` is high).
- **How to Fix**: Increase PostgreSQL `shared_buffers` setting in `postgresql.conf` or allocate more RAM to server.

### Rule 4: Judging Optimizer Statistics Accuracy (`Estimate Ratio`)
- **GOOD (`0.5x` to `2.0x`)**: Optimizer accurately estimates row counts and picks optimal plans.
- **BAD (`< 0.1x` or `> 10x`)**: Optimizer is severely misjudging row counts (e.g. estimated 1 row, actually returned 100,000 rows). Leads to terrible plan selection (using nested loops instead of hash joins).
- **How to Fix**: Update database table statistics:
  ```sql
  ANALYZE table_name;
  ```

### Rule 5: Judging Multi-User Concurrency & Capacity Limits
- **Healthy Scaling**: As concurrent users increase from `10` to `100`, throughput (`TPS`) increases while connection wait time stays low (`Conn Wait P95 < 20ms`).
- **Database Saturation / Bottleneck**:
  - `TPS` flattens or drops while `Conn Wait P95` or `Exec P95` spikes dramatically (>1000ms).
  - High `Errors / Drops` occur.
- **Causes**: Connection pool size is too small, or queries are holding database connections for too long due to missing indexes.

---

## Part 4: Docker Requirements (What if Docker is NOT installed?)

> **Docker is 100% OPTIONAL**. **pg-benchmark** connects to PostgreSQL using standard TCP/IP network protocol.
> - Works with **local PostgreSQL**, **remote servers**, **AWS RDS**, **GCP Cloud SQL**, or **Azure**.
> - Simply leave `DOCKER_CONTAINER=` empty in `.env`.
> - All SQL benchmarks, EXPLAIN ANALYZE plan profiling, buffer hit ratios, latency percentiles (`P95`), concurrency load sweeps, and Excel exports run with **100% full functionality**.
> - In the report, Docker CPU/RAM stats will simply show `'n/a'`.

---

## Part 5: Quick Summary Table for Judging Benchmark Results

| Metric Header | Ideal Good Value | Problem Value | Action Required |
|---|---|---|---|
| **Status** | `✅` | `⚠️ seq scan`<br>`⚠️ slow (p95 > 100ms)`<br>`❌ error` | Inspect `Buffer & Plan Analysis` sheet to add missing indexes. |
| **P95 (ms)** | `< 10ms` (OLTP)<br>`< 50ms` (Report) | `> 100ms` | Add index, optimize joins, limit returned columns. |
| **Seq Scan?** | `no` | `YES` | Create index on `WHERE` / `JOIN` columns of flagged table. |
| **Avg shared read** | `0` (Fully cached in RAM) | High numbers | Upgrade RAM or increase `shared_buffers`. |
| **Estimate Ratio** | `0.8` – `1.2` | `< 0.1` or `> 10.0` | Run `ANALYZE <table>;` to update table stats. |
| **Conn Wait P95** | `< 10ms` | `> 100ms` | Increase connection pool size or optimize slow queries holding locks. |
| **Multi-User Errors** | `0` | `> 0` (Timeouts/Drops) | Database hardware or connection pool limit exceeded. |
