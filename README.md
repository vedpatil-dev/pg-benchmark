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

## Config Reference & Documentation

For a detailed explanation of all connection settings, CLI flags, benchmark tuning parameters, and Excel report metric definitions, see [PARAMETERS.md](file:///home/ved1345/Documents/Emgage/postgress_test/pg-benchmark/PARAMETERS.md).

| Variable / CLI Flag | Default | Description |
|---|---|---|
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` (`-d`) | — | Standard connection parameters |
| `[sql_file]` / `-f` / `--file` | Auto-discovery | SQL file path to benchmark (or scans all `.sql` files in repo) |
| `-q` / `--query` | — | Direct SQL statement to benchmark |
| `WARMUP_RUNS` / `--warmup` | 10 | Discarded initial runs before measurement |
| `MEASURED_RUNS` / `--runs` | 100 | Measured runs per query for latency percentiles |
| `CONCURRENCY_LEVELS` / `-c` | (disabled) | e.g. `10,25,50,100,200,300,500` |
| `CONCURRENCY_DURATION_SECONDS` / `--duration` | 5 | Duration in seconds per concurrency level |
| `OUTPUT_FILE` / `-o` | `benchmark-report.xlsx` | Excel output report path |


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
