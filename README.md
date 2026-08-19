# pg-benchmark

A repeatable Node.js benchmark tool for a Dockerized PostgreSQL instance. It automatically pulls your
real top queries from `pg_stat_statements`, runs each one through a warm-up + measured cycle with
`EXPLAIN (ANALYZE, BUFFERS)`, and produces a full Excel report: latency percentiles, buffer/cache
behavior, query plan analysis (seq scans, estimated vs. actual rows), and an optional connection
concurrency sweep.

Tested end-to-end against a local PostgreSQL 16 instance during development.

## What it measures

| Sheet | Contents |
|---|---|
| **Environment** | PG version, database size, largest tables, index count, `track_io_timing`, docker CPU/mem snapshot & limits, connection states |
| **Query Benchmark Summary** | Per query: min/avg/p50/p95/p99/max/stddev execution time, first-run vs. steady-state time, top plan node, avg buffer hit/read, estimated vs. actual rows, pass/warn status |
| **Full Query Text** | Untruncated SQL for every query ID |
| **Buffer & Plan Analysis** | Seq scan vs. index scan detection (with table names), shared/temp buffers, I/O timing, planning time |
| **Raw Runs** | Every individual run's execution time, planning time, and buffers — for your own charting/statistics |
| **Skipped (Parameterized)** | Queries from `pg_stat_statements` that use `$1`-style parameters and can't be safely re-executed without real values — reported using pg_stat_statements' own lifetime stats instead |
| **Concurrency Sweep** | TPS and latency percentiles at each connection level you configure |

## Setup

```bash
npm install
cp .env.example .env
# edit .env with your Docker Postgres connection details
```

Requires `pg_stat_statements` to be enabled:

```sql
-- one-time, requires a restart:
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
```
```bash
docker restart <your_container>
```
```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

If you skip this, the tool will tell you and exit — it won't guess or fall back silently.

## Run

```bash
node index.js
```

This will:
1. Connect and record environment/database baseline info.
2. Pull the top `TOP_N_QUERIES` queries by total execution time.
3. For each **plain SELECT with no parameters**, run `WARMUP_RUNS` warm-up executions
   (populates the buffer cache) followed by `MEASURED_RUNS` measured executions via
   `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, wrapped in a transaction that's always rolled back
   so nothing is ever mutated.
4. Queries pulled from `pg_stat_statements` that contain `$1`-style parameters are **not**
   re-executed (there's no safe way to guess real parameter values) — they're listed separately
   using pg_stat_statements' own aggregate stats.
5. If `CONCURRENCY_LEVELS` is set, runs a TPS/latency sweep at each connection level.
6. Writes `benchmark-report.xlsx` (or your configured `OUTPUT_FILE`).

## Config reference (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | — | Standard connection info |
| `DOCKER_CONTAINER` | — | Optional container name, used for `docker stats` / `docker inspect` snapshots |
| `TOP_N_QUERIES` | 20 | How many queries to pull from `pg_stat_statements` |
| `MIN_CALLS` | 5 | Ignore queries called fewer times than this |
| `WARMUP_RUNS` | 10 | Discarded runs before measurement starts |
| `MEASURED_RUNS` | 100 | Runs used for percentile calculation |
| `CONCURRENCY_LEVELS` | (empty = skip) | e.g. `1,5,10,25,50,100` |
| `CONCURRENCY_DURATION_SECONDS` | 5 | How long to hammer each concurrency level |
| `CONCURRENCY_QUERY` | `top` | `top` = highest total_exec_time query, or paste a literal SQL string |
| `OUTPUT_FILE` | `benchmark-report.xlsx` | Output path |

## Notes / things worth knowing

- **Cold-cache testing**: this tool doesn't automate a Docker restart mid-run (that would also drop
  your connection). To test cold-cache behavior, manually run `docker restart <container>`, then run
  this tool with `MEASURED_RUNS=1` immediately after, and compare against a normal run.
- **`EXPLAIN ANALYZE` overhead**: it measures real server-side execution but adds some profiling
  overhead of its own. Treat these numbers as relative/comparable, not as exact end-to-end
  application latency (network + app-side processing isn't included).
- Only `SELECT` statements are ever executed, and every execution happens inside a transaction that
  is immediately rolled back — this tool never writes to your database.
- Re-run this after adding an index or rewriting a slow query, and diff the "Query Benchmark
  Summary" sheet against the previous report for a before/after comparison.
