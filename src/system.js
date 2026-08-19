const { execSync } = require('child_process');
const pool = require('./db');
const config = require('./config');

async function getPgVersion() {
  const { rows } = await pool.query('SELECT version();');
  return rows[0].version;
}

async function getDatabaseSize() {
  const { rows } = await pool.query(
    'SELECT pg_size_pretty(pg_database_size(current_database())) AS size;'
  );
  return rows[0].size;
}

async function getLargestTables(limit = 20) {
  const { rows } = await pool.query(
    `SELECT schemaname, relname,
            pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
            pg_total_relation_size(relid) AS bytes
     FROM pg_catalog.pg_statio_user_tables
     ORDER BY pg_total_relation_size(relid) DESC
     LIMIT $1;`,
    [limit]
  );
  return rows;
}

async function getIndexCount() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema');`
  );
  return rows[0].count;
}

async function getConnectionStates() {
  const { rows } = await pool.query(
    `SELECT state, count(*)::int AS count FROM pg_stat_activity GROUP BY state ORDER BY count DESC;`
  );
  return rows;
}

async function getTrackIoTiming() {
  const { rows } = await pool.query('SHOW track_io_timing;');
  return rows[0].track_io_timing;
}

function getDockerStats(containerName) {
  if (!containerName) return null;
  try {
    const out = execSync(
      `docker stats --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}" ${containerName}`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    const [cpuPerc, memUsage, memPerc, netIO, blockIO, pids] = out.split('|');
    return { cpuPerc, memUsage, memPerc, netIO, blockIO, pids };
  } catch (err) {
    console.warn(`  (warning) could not read docker stats for "${containerName}": ${err.message.split('\n')[0]}`);
    return null;
  }
}

function getDockerInspect(containerName) {
  if (!containerName) return null;
  try {
    const out = execSync(
      `docker inspect --format "{{.Config.Image}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.Memory}}" ${containerName}`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    const [image, nanoCpus, memoryBytes] = out.split('|');
    return {
      image,
      cpuLimit: nanoCpus && nanoCpus !== '0' ? `${(parseInt(nanoCpus, 10) / 1e9).toFixed(2)} CPUs` : 'unlimited',
      memoryLimit: memoryBytes && memoryBytes !== '0'
        ? `${(parseInt(memoryBytes, 10) / (1024 ** 3)).toFixed(2)} GB`
        : 'unlimited',
    };
  } catch (err) {
    return null;
  }
}

async function collectBaseline() {
  console.log('Collecting environment baseline...');
  const [version, dbSize, largestTables, indexCount, connStates, trackIoTiming] = await Promise.all([
    getPgVersion(),
    getDatabaseSize(),
    getLargestTables(20),
    getIndexCount(),
    getConnectionStates(),
    getTrackIoTiming(),
  ]);
  const dockerStats = getDockerStats(config.dockerContainer);
  const dockerInspect = getDockerInspect(config.dockerContainer);

  return {
    testDate: new Date().toISOString(),
    pgVersion: version,
    databaseName: config.pg.database,
    databaseSize: dbSize,
    indexCount,
    trackIoTiming,
    dockerContainer: config.dockerContainer,
    dockerImage: dockerInspect ? dockerInspect.image : null,
    dockerCpuLimit: dockerInspect ? dockerInspect.cpuLimit : null,
    dockerMemoryLimit: dockerInspect ? dockerInspect.memoryLimit : null,
    dockerStatsSnapshot: dockerStats,
    connectionStates: connStates,
    largestTables,
  };
}

module.exports = { collectBaseline, getDockerStats, getConnectionStates };
