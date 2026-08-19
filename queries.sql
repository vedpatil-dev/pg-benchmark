-- ==============================================================================
-- PostgreSQL Query Performance Benchmark Suite (queries.sql)
--
-- HOW TO ADD YOUR OWN QUERIES:
-- 1. Simply write any valid PostgreSQL SELECT query below.
-- 2. Separate multiple SQL statements with semicolons (;).
-- 3. Use standard SQL comments (-- comment) to organize query groups.
-- 4. To run this benchmark file, execute:
--      node index.js queries.sql
-- ==============================================================================

-- ==============================================================================
-- SECTION 1: SYSTEM CATALOG & UNIVERSAL DB BENCHMARK QUERIES
-- ==============================================================================

-- Query 1.1: PostgreSQL Version & Build Environment Info
SELECT version();

-- Query 1.2: Current Database Size Calculation
SELECT datname, pg_size_pretty(pg_database_size(datname)) AS db_size FROM pg_database WHERE datname = current_database();

-- Query 1.3: User Tables & Tuple Metrics
SELECT relname AS table_name, n_live_tup AS live_rows, n_dead_tup AS dead_rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;

-- Query 1.4: Synthetic High-CPU & Memory Test (10,000 series integers)
SELECT generate_series(1, 10000) AS val;



-- ==============================================================================
-- ADD YOUR CUSTOM BENCHMARK QUERIES BELOW
-- Example:
-- SELECT * FROM your_custom_table WHERE created_at >= CURRENT_DATE;
-- ==============================================================================
