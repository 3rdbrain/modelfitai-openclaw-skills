#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');

const LOG_FILE = '/var/log/modelfitai/guardian.log';
const STATUS_FILE = '/var/log/modelfitai/last-update.json';

// Injected at deploy time
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VPS_ID = process.env.VPS_ID || require('os').hostname();

function log(msg) {
  const line = `[${new Date().toISOString()}] [health-reporter] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync('/var/log/modelfitai', { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (_) {
    return '';
  }
}

function collectMetrics() {
  // Container count
  const containerNames = run('docker ps --filter "name=openclaw-" --format "{{.Names}}"')
    .split('\n').filter(Boolean);

  // Host CPU
  const cpuIdle = parseFloat(run("top -bn1 | grep 'Cpu(s)' | awk '{print $8}' | tr -d '%id,'") || '0');
  const cpuUsed = Math.max(0, 100 - cpuIdle);

  // Host memory (from /proc/meminfo)
  const memInfo = run('cat /proc/meminfo');
  const memTotal = parseInt((memInfo.match(/MemTotal:\s+(\d+)/) || [])[1] || 0) / 1024;
  const memAvail = parseInt((memInfo.match(/MemAvailable:\s+(\d+)/) || [])[1] || 0) / 1024;
  const memUsed = memTotal - memAvail;

  // Disk usage
  const diskLine = run("df -h / | tail -1 | awk '{print $5}'");
  const diskUsedPercent = parseInt(diskLine) || 0;

  // Uptime
  const uptimeSecs = parseFloat(run('cat /proc/uptime').split(' ')[0] || 0);

  // Network isolation check
  const dockerUserRules = run('iptables -L DOCKER-USER -n 2>/dev/null');
  const networkRulesOk = dockerUserRules.includes('modelfitai-isolation');

  // Last update info
  let lastUpdate = null;
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      lastUpdate = s.last_run || s.last_openclaw_update || s.timestamp;
    }
  } catch (_) {}

  // Anomaly count: containers with high restart counts
  let anomalyCount = 0;
  for (const name of containerNames) {
    const restarts = parseInt(run(`docker inspect ${name} --format "{{.RestartCount}}" 2>/dev/null`) || '0');
    if (restarts > 5) anomalyCount++;
  }

  return {
    vps_id: VPS_ID,
    container_count: containerNames.length,
    // containers list kept for local summary but stripped before Supabase POST
    _containers: containerNames,
    cpu_usage_percent: Math.round(cpuUsed * 10) / 10,
    memory_used_mb: Math.round(memUsed),
    memory_total_mb: Math.round(memTotal),
    disk_used_percent: diskUsedPercent,
    uptime_seconds: Math.round(uptimeSecs),
    network_rules_ok: networkRulesOk,
    anomaly_count: anomalyCount,
    last_update: lastUpdate,
    reported_at: new Date().toISOString(),
  };
}

function postToSupabase(metrics) {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      reject(new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY not set in environment'));
      return;
    }

    const url = new URL(`${SUPABASE_URL}/rest/v1/vps_health_reports`);
    const body = JSON.stringify(metrics);

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal',
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(res.statusCode);
      } else {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${data}`)));
      }
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdReport() {
  const metrics = collectMetrics();
  log(`Reporting health: ${metrics.container_count} containers, CPU ${metrics.cpu_usage_percent}%, anomalies: ${metrics.anomaly_count}`);

  try {
    // Strip local-only fields before sending to Supabase
    const { _containers, ...supabaseMetrics } = metrics;
    await postToSupabase(supabaseMetrics);
    console.log(`Health report sent: ${metrics.container_count} containers, ${metrics.anomaly_count} anomalies`);
    log('Health report sent to Supabase');
  } catch (err) {
    console.log(`[WARN] Could not send to Supabase: ${err.message}`);
    log(`WARN: Supabase report failed — ${err.message}`);
    // Still print local summary so agent can relay it
    printSummary(metrics);
  }
}

function printSummary(metrics) {
  console.log('\n=== VPS Health Summary ===');
  console.log(`  VPS ID:            ${metrics.vps_id}`);
  console.log(`  Containers:        ${metrics.container_count} running`);
  console.log(`  CPU usage:         ${metrics.cpu_usage_percent}%`);
  console.log(`  Memory:            ${metrics.memory_used_mb}MB / ${metrics.memory_total_mb}MB`);
  console.log(`  Disk:              ${metrics.disk_used_percent}% used`);
  console.log(`  Uptime:            ${Math.floor(metrics.uptime_seconds / 3600)}h ${Math.floor((metrics.uptime_seconds % 3600) / 60)}m`);
  console.log(`  Network isolation: ${metrics.network_rules_ok ? 'OK' : 'BROKEN - needs re-apply'}`);
  console.log(`  Anomalies:         ${metrics.anomaly_count}`);
  console.log(`  Last update:       ${metrics.last_update || 'never'}`);
  console.log('');
}

function cmdSummary() {
  printSummary(collectMetrics());
}

function cmdContainers() {
  const containers = run('docker ps --filter "name=openclaw-" --format "{{.Names}}\t{{.Status}}\t{{.CreatedAt}}"')
    .split('\n').filter(Boolean);

  if (containers.length === 0) {
    console.log('No openclaw containers running.');
    return;
  }

  console.log(`\n${containers.length} container(s) running:\n`);
  for (const line of containers) {
    const [name, status, created] = line.split('\t');
    const tier = run(`docker inspect ${name} --format "{{index .Config.Labels \\"com.modelfitai.tier\\"}}" 2>/dev/null`) || 'unknown';
    const expires = run(`docker inspect ${name} --format "{{index .Config.Labels \\"com.modelfitai.expires\\"}}" 2>/dev/null`) || 'never';
    const restarts = run(`docker inspect ${name} --format "{{.RestartCount}}" 2>/dev/null`) || '0';

    console.log(`  ${name}`);
    console.log(`    Status:   ${status}`);
    console.log(`    Tier:     ${tier}`);
    console.log(`    Expires:  ${expires}`);
    console.log(`    Restarts: ${restarts}`);
    console.log('');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const cmd = process.argv[2];
switch (cmd) {
  case 'report':     cmdReport();     break;
  case 'summary':    cmdSummary();    break;
  case 'containers': cmdContainers(); break;
  default:
    console.log('Usage: health-reporter.js <report|summary|containers>');
    process.exit(1);
}
