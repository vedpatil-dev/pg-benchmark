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

-- ==============================================================================
-- HEAVY RAM & CPU STRESS QUERIES
-- Purpose: Saturate PostgreSQL work_mem, CPU cores, and executor buffers.
--          These are intentionally expensive for load/benchmark testing.
-- ==============================================================================

-- 11. [CPU+RAM] Multi-level Window Function Stack on Full Attendance Table
--     Forces PostgreSQL to sort + buffer ALL attendance rows for 3 OVER() frames.
SELECT
    da.employeeid,
    da.date,
    da.hoursworked,
    SUM(da.hoursworked)   OVER (PARTITION BY da.employeeid ORDER BY da.date
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)   AS cumulative_hours,
    AVG(da.hoursworked)   OVER (PARTITION BY da.employeeid ORDER BY da.date
                                ROWS BETWEEN 29 PRECEDING AND CURRENT ROW)          AS rolling_30d_avg_hours,
    RANK()                OVER (PARTITION BY da.employeeid ORDER BY da.hoursworked DESC) AS hours_rank,
    NTILE(100)            OVER (PARTITION BY da.employeeid ORDER BY da.date)         AS percentile_bucket,
    LAG(da.hoursworked, 1, 0) OVER (PARTITION BY da.employeeid ORDER BY da.date)   AS prev_day_hours,
    LEAD(da.hoursworked, 1, 0) OVER (PARTITION BY da.employeeid ORDER BY da.date)  AS next_day_hours
FROM tbl_dailyattendancen da
ORDER BY da.employeeid, da.date;

-- 12. [CPU+RAM] Recursive CTE Fibonacci Sequence (depth 35) + Cross Join
--     Deep recursion + materialized CTE forces repeated buffer flushes.
WITH RECURSIVE fib(n, a, b) AS (
    SELECT 1, 0::bigint, 1::bigint
    UNION ALL
    SELECT n + 1, b, a + b FROM fib WHERE n < 35
),
big_series AS (
    SELECT generate_series(1, 50000) AS val
)
SELECT
    fib.n                        AS fib_depth,
    fib.b                        AS fib_value,
    md5(big_series.val::text)    AS row_hash,
    sha256(big_series.val::text::bytea) AS row_sha256,
    big_series.val * fib.b       AS stress_product
FROM fib
CROSS JOIN big_series
WHERE big_series.val % fib.n = 0
ORDER BY fib.n, big_series.val;

-- 13. [CPU+RAM] Full Payroll Hash Aggregation — All-column GROUP BY + STDDEV + PERCENTILE
--     Forces hash-aggregate spill when work_mem is tight; computes heavy stats.
SELECT
    e.employeeid,
    CONCAT(e.efirstname, ' ', e.elastname)            AS employee_name,
    COUNT(ma.id)                                       AS payroll_months,
    SUM(ma.grosssalary)                                AS lifetime_gross,
    ROUND(AVG(ma.grosssalary), 4)                      AS avg_gross,
    ROUND(STDDEV_POP(ma.grosssalary), 4)               AS gross_stddev,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ma.grosssalary) AS p25_salary,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ma.grosssalary) AS median_salary,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ma.grosssalary) AS p75_salary,
    PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ma.grosssalary) AS p90_salary,
    MAX(ma.grosssalary) - MIN(ma.grosssalary)          AS salary_spread,
    SUM(ma.deductions)                                 AS total_deductions,
    ROUND(100.0 * SUM(ma.deductions) / NULLIF(SUM(ma.grosssalary), 0), 4) AS deduction_ratio_pct
FROM tbl_monthlyattendance ma
JOIN tbl_employee e ON ma.employeeid = e.employeeid
GROUP BY e.employeeid, e.efirstname, e.elastname
ORDER BY lifetime_gross DESC;

-- 14. [CPU+RAM] JSONB Build Aggregation — Serialize full employee structure per employee
--     Forces large in-memory JSONB document construction + sort.
SELECT
    e.employeeid,
    jsonb_build_object(
        'employee_id',       e.employeeid,
        'name',              CONCAT(e.efirstname, ' ', e.elastname),
        'email',             e.ecompanyemail,
        'status',            e.eemployeestatus,
        'join_date',         e.employeementdate,
        'dob',               e.dateofbirth,
        'pan',               e.panno,
        'aadhaar',           e.aadharno,
        'attendance_days',   COUNT(da.attendanceid),
        'total_hours',       SUM(da.hoursworked),
        'avg_hours',         ROUND(AVG(da.hoursworked), 4),
        'late_count',        SUM(CASE WHEN da.islate = true THEN 1 ELSE 0 END),
        'early_count',       SUM(CASE WHEN da.isearly = true THEN 1 ELSE 0 END),
        'absent_count',      SUM(CASE WHEN da.presentabsent = 'Absent' THEN 1 ELSE 0 END),
        'days_hash',         md5(STRING_AGG(da.date::text, ',' ORDER BY da.date))
    )                                                   AS employee_profile_json
FROM tbl_employee e
LEFT JOIN tbl_dailyattendancen da ON e.employeeid = da.employeeid
GROUP BY e.employeeid, e.efirstname, e.elastname, e.ecompanyemail,
         e.eemployeestatus, e.employeementdate, e.dateofbirth, e.panno, e.aadharno
ORDER BY e.employeeid;

-- 15. [CPU] Pure CPU Hash Chain Stress — 500,000 iterated MD5+SHA256 computations
--     No table I/O; forces CPU to run flat-out on cryptographic hashing.
SELECT
    s.i,
    md5(sha256(md5(s.i::text)::bytea)::text)            AS triple_hash,
    length(sha256((md5(s.i::text) || s.i::text)::bytea)::text) AS hash_len,
    s.i * s.i                                           AS i_squared,
    s.i % 97                                            AS mod_97,
    (s.i * 6364136223846793005 + 1442695040888963407)::bigint AS lcg_prng
FROM generate_series(1, 500000) AS s(i)
WHERE s.i % 7 <> 0
ORDER BY triple_hash;

-- 16. [RAM] Large Cross-Schema Cartesian Sort — Employee × Branch × Department
--     Materializes O(E × B × D) rows; exercises sort spill & temp disk I/O.
SELECT
    e.employeeid,
    CONCAT(e.efirstname, ' ', e.elastname)              AS employee_name,
    b.branchid,
    b.branchname,
    d.id                                                 AS dept_id,
    d.departmentname,
    md5(e.employeeid::text || b.branchid::text || d.id::text) AS combo_key
FROM tbl_employee e
CROSS JOIN tbl_branchmaster b
CROSS JOIN tbl_departmentofcompany d
WHERE e.eemployeestatus IN ('Active', 'User')
ORDER BY combo_key;

-- 17. [CPU] Full Regex Scan — POSIX pattern match across all employee name strings
--     Forces sequential scan + regex engine on every row; no index possible.
SELECT
    e.employeeid,
    e.ecompanyemail,
    CONCAT(e.efirstname, ' ', COALESCE(e.emiddlename, ''), ' ', e.elastname) AS full_name,
    e.eemployeestatus,
    regexp_replace(
        CONCAT(e.efirstname, ' ', COALESCE(e.emiddlename, ''), ' ', e.elastname),
        '\s+', '_', 'g'
    )                                                    AS slugified_name,
    (e.ecompanyemail ~ '^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$') AS valid_email_regex,
    md5(e.ecompanyemail || e.employeeid::text)           AS identity_hash
FROM tbl_employee e
WHERE regexp_replace(CONCAT(e.efirstname, ' ', e.elastname), '[^a-zA-Z ]', '', 'g') ~* '[aeiou]{2,}'
ORDER BY slugified_name;

-- 18. [CPU+RAM] Multi-CTE Fan-Out — 5 parallel heavy aggregations unified by UNION ALL
--     Each CTE branch is independently computed; planner cannot merge them.
WITH
branch_stats AS (
    SELECT 'branch_payroll'::text AS metric_type, b.branchname AS dimension,
           SUM(ma.grosssalary) AS total_value, COUNT(*) AS row_count
    FROM tbl_monthlyattendance ma
    JOIN tbl_employee e ON ma.employeeid = e.employeeid
    JOIN tbl_employeestructure es ON e.employeeid = es.employeeid AND es.erunning = true
    JOIN tbl_branchmaster b ON es.branchid = b.branchid
    GROUP BY b.branchname
),
dept_leave AS (
    SELECT 'dept_leave'::text AS metric_type, dept.departmentname AS dimension,
           SUM(lh.noofdays)::numeric AS total_value, COUNT(*) AS row_count
    FROM tbl_leaveapplicationheader lh
    JOIN tbl_employee e ON lh.employeeid = e.employeeid
    JOIN tbl_employeestructure es ON e.employeeid = es.employeeid AND es.erunning = true
    JOIN tbl_departmentofcompany dept ON es.newdepartmentid = dept.id
    GROUP BY dept.departmentname
),
employee_hours AS (
    SELECT 'employee_hours'::text AS metric_type, e.employeeid::text AS dimension,
           SUM(da.hoursworked) AS total_value, COUNT(*) AS row_count
    FROM tbl_dailyattendancen da
    JOIN tbl_employee e ON da.employeeid = e.employeeid
    GROUP BY e.employeeid
),
expense_by_type AS (
    SELECT 'expense_category'::text AS metric_type, exp.requesttype AS dimension,
           SUM(exp.approvedamount) AS total_value, COUNT(*) AS row_count
    FROM tbl_expenseclaimmaster exp
    GROUP BY exp.requesttype
),
resign_by_branch AS (
    SELECT 'resignation_branch'::text AS metric_type, b.branchname AS dimension,
           COUNT(*)::numeric AS total_value, COUNT(*) AS row_count
    FROM tbl_resignationmaster rm
    JOIN tbl_employee e ON rm.employeeid = e.employeeid
    JOIN tbl_employeestructure es ON e.employeeid = es.employeeid AND es.erunning = true
    JOIN tbl_branchmaster b ON es.branchid = b.branchid
    GROUP BY b.branchname
)
SELECT metric_type, dimension,
       ROUND(total_value, 2)  AS total_value,
       row_count,
       RANK() OVER (PARTITION BY metric_type ORDER BY total_value DESC) AS metric_rank
FROM (
    SELECT * FROM branch_stats
    UNION ALL SELECT * FROM dept_leave
    UNION ALL SELECT * FROM employee_hours
    UNION ALL SELECT * FROM expense_by_type
    UNION ALL SELECT * FROM resign_by_branch
) combined
ORDER BY metric_type, metric_rank;

-- 19. [RAM] Large STRING_AGG Concatenation — Build full punch timeline per employee
--     Forces PostgreSQL to buffer and sort all punch strings in memory.
SELECT
    e.employeeid,
    CONCAT(e.efirstname, ' ', e.elastname)              AS employee_name,
    COUNT(da.attendanceid)                               AS total_days_tracked,
    LENGTH(
        STRING_AGG(
            da.date::text || '|'
                || COALESCE(TO_CHAR(da.actualintime,  'HH24:MI:SS'), 'NULL') || '→'
                || COALESCE(TO_CHAR(da.actualouttime, 'HH24:MI:SS'), 'NULL') || '|'
                || COALESCE(da.presence, 'N/A'),
            ',' ORDER BY da.date
        )
    )                                                    AS punch_timeline_length,
    md5(
        STRING_AGG(
            da.date::text || COALESCE(da.hoursworked::text, '0'),
            '|' ORDER BY da.date
        )
    )                                                    AS punch_fingerprint
FROM tbl_employee e
JOIN tbl_dailyattendancen da ON e.employeeid = da.employeeid
GROUP BY e.employeeid, e.efirstname, e.elastname
ORDER BY punch_timeline_length DESC;

-- 20. [CPU+RAM] Deep Nested Subquery with Correlated Exists + Window over Payroll History
--     Combines correlated subquery (per row) + window aggregation + multi-join.
SELECT
    outer_e.employeeid,
    CONCAT(outer_e.efirstname, ' ', outer_e.elastname)  AS employee_name,
    outer_ma.mayear,
    outer_ma.payslipmonth,
    outer_ma.grosssalary,
    AVG(outer_ma.grosssalary) OVER (
        PARTITION BY outer_e.employeeid
        ORDER BY outer_ma.mayear, outer_ma.payslipmonth
        ROWS BETWEEN 5 PRECEDING AND CURRENT ROW
    )                                                    AS rolling_6m_avg_salary,
    SUM(outer_ma.grosssalary) OVER (
        PARTITION BY outer_e.employeeid
    )                                                    AS employee_lifetime_gross,
    RANK() OVER (
        PARTITION BY outer_ma.mayear, outer_ma.payslipmonth
        ORDER BY outer_ma.grosssalary DESC
    )                                                    AS salary_rank_in_month,
    (
        SELECT ROUND(AVG(inner_ma.grosssalary), 2)
        FROM tbl_monthlyattendance inner_ma
        WHERE inner_ma.mayear = outer_ma.mayear
          AND inner_ma.payslipmonth = outer_ma.payslipmonth
          AND inner_ma.processed = true
    )                                                    AS cohort_avg_salary,
    (outer_ma.grosssalary - (
        SELECT ROUND(AVG(inner_ma2.grosssalary), 2)
        FROM tbl_monthlyattendance inner_ma2
        WHERE inner_ma2.mayear = outer_ma.mayear
          AND inner_ma2.payslipmonth = outer_ma.payslipmonth
          AND inner_ma2.processed = true
    ))                                                   AS delta_from_cohort_avg
FROM tbl_monthlyattendance outer_ma
JOIN tbl_employee outer_e ON outer_ma.employeeid = outer_e.employeeid
WHERE outer_ma.processed = true
ORDER BY outer_e.employeeid, outer_ma.mayear, outer_ma.payslipmonth;
