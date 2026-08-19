-- ==============================================================================
-- Universal PostgreSQL Common Benchmark Queries
-- Works on ANY PostgreSQL database (System catalog, Stats, Performance)
-- ==============================================================================

-- 1. PostgreSQL Database & Version Info
SELECT version();

-- 2. Current Database Size Calculation
SELECT datname, pg_size_pretty(pg_database_size(datname)) AS db_size FROM pg_database WHERE datname = current_database();

-- 3. Information Schema Table Enumeration (First 50 User Tables)
SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_name LIMIT 50;

-- 4. User Tables Live/Dead Tuple Statistics
SELECT relname AS table_name, n_live_tup AS live_rows, n_dead_tup AS dead_rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;

-- 5. Total System and User Tables Count
SELECT count(*) FROM pg_catalog.pg_tables;

-- 6. Critical Memory & Connection Configuration Parameters
SELECT name, setting, unit, short_desc FROM pg_settings WHERE name IN ('max_connections', 'shared_buffers', 'work_mem', 'maintenance_work_mem', 'effective_cache_size');

-- 7. Active Connection State Diagnostics
SELECT pid, usename, client_addr, state, backend_type FROM pg_stat_activity WHERE datname = current_database();

-- 8. Top User Index Scan Utilization Stats
SELECT schemaname, relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes ORDER BY idx_scan DESC LIMIT 20;

-- 9. Synthetic Memory & CPU Series Generator Benchmark (10,000 rows)
SELECT generate_series(1, 10000) AS val;

-- 10. Synthetic CPU Hash Computation Benchmark (1,000 MD5 hashes)
SELECT md5(random()::text) FROM generate_series(1, 1000);
