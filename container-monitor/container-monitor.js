#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

const LOG_FILE = '/var/log/modelfitai/guardian.log';

// Admin-managed extra hosts file.
// Each line is a hostname (or # comment). Editable at runtime — no restart needed.
const EXTRA_HOSTS_FILE = '/etc/modelfitai/allowed-hosts.txt';

// Known-good outbound hostnames for OpenClaw agents.
// Resolved to IPs at startup so conntrack matches work.
const ALLOWED_HOSTNAMES = [
  // AI providers
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.openrouter.ai',
  'api.deepseek.com',
  // Communication channels
  'api.telegram.org',
  'discord.com',
  'gateway.discord.gg',
  'web.whatsapp.com',
  // Web search / scraping APIs (used by lead gen + autopilot templates)
  'api.search.brave.com',
  'api.tavily.com',
  'serpapi.com',
  'api.serper.dev',
  'hn.algolia.com',
  'www.reddit.com',
  'oauth.reddit.com',
  // X (Twitter) API
  'api.twitter.com',
  'api.x.com',
  'upload.twitter.com',
  // Email enrichment
  'api.hunter.io',
  // Supabase (health reporter posts here)
  'supabase.co',
];

// Load admin-added hostnames from the extra hosts file (runtime editable).
function loadExtraHostnames() {
  try {
    if (!fs.existsSync(EXTRA_HOSTS_FILE)) return [];
    return fs.readFileSync(EXTRA_HOSTS_FILE, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch (_) { return []; }
}

// Read ALLOWED_EXTRA_HOSTS env var from a container's inspect data.
// Customers set this at deploy time: ALLOWED_EXTRA_HOSTS=api.mycrm.com,hooks.zapier.com
function getContainerExtraHosts(info) {
  const envs = (info.Config?.Env || []);
  const entry = envs.find(e => e.startsWith('ALLOWED_EXTRA_HOSTS='));
  if (!entry) return [];
  return entry.slice('ALLOWED_EXTRA_HOSTS='.length)
    .split(',')
    .map(h => h.trim())
    .filter(Boolean);
}

// Resolve a list of hostnames to a Set of IPs.
function resolveHostnamesToIPs(hostnames) {
  const ips = new Set(['127.0.0.1', '::1']);
  for (const host of hostnames) {
    try {
      const result = run(`getent ahosts ${host} 2>/dev/null`);
      for (const line of result.trim().split('\n')) {
        const ip = (line.split(/\s+/)[0] || '').trim();
        if (ip) ips.add(ip);
      }
    } catch (_) {}
  }
  return ips;
}

// Global allowlist: built-in + admin extra hosts file.
// Re-read the file every call so runtime edits take effect without restart.
function getAllowedIPs() {
  const extra = loadExtraHostnames();
  return resolveHostnamesToIPs([...ALLOWED_HOSTNAMES, ...extra]);
}

// Best-effort reverse DNS for human-readable alert messages.
// 5-second timeout to prevent scan hangs on slow/broken DNS.
function reverseResolve(ip) {
  try {
    const out = execSync(`dig +short +time=3 +tries=1 -x ${ip} 2>/dev/null`, { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }).trim();
    if (out) return out.split('\n')[0].replace(/\.$/, '');
  } catch (_) {}
  try {
    const out = execSync(`timeout 5 host ${ip} 2>/dev/null`, { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }).trim();
    const m = out.match(/pointer (.+)/);
    if (m) return m[1].replace(/\.$/, '');
  } catch (_) {}
  return null;
}

const RESTART_THRESHOLD = 5;
const CPU_THRESHOLD = 80;    // percent
const MEM_THRESHOLD_RATIO = 0.90; // alert at 90% of container's memory limit
const MEM_FALLBACK_LIMIT_MB = 256; // fallback if container has no memory limit

const isSilent = process.argv.includes('--silent');

// ─── Alert deduplication ──────────────────────────────────────────────────────
// Suppress repeated alerts for the same container+issue within a cooldown window.
const DEDUP_FILE = '/var/log/modelfitai/alert-dedup.json';
const DEDUP_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function loadDedupState() {
  try {
    if (fs.existsSync(DEDUP_FILE)) return JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function saveDedupState(state) {
  try { fs.writeFileSync(DEDUP_FILE, JSON.stringify(state)); } catch (_) {}
}

function shouldAlert(container, issue) {
  const state = loadDedupState();
  const key = `${container}::${issue}`;
  const now = Date.now();
  if (state[key] && (now - state[key]) < DEDUP_COOLDOWN_MS) return false;
  state[key] = now;
  // Prune entries older than 24h to prevent file growth
  for (const k of Object.keys(state)) {
    if ((now - state[k]) > 24 * 60 * 60 * 1000) delete state[k];
  }
  saveDedupState(state);
  return true;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] [container-monitor] ${msg}`;
  if (!isSilent) console.log(line);
  try {
    fs.mkdirSync('/var/log/modelfitai', { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
  } catch (_) {
    return '';
  }
}

function getOpenClawContainers() {
  const output = run('docker ps --filter "name=openclaw-" --format "{{.Names}}"');
  return output.trim().split('\n').filter(Boolean);
}

function inspectContainer(name) {
  try {
    const raw = run(`docker inspect ${name}`);
    return JSON.parse(raw)[0];
  } catch (_) {
    return null;
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdScan() {
  const containers = getOpenClawContainers();
  if (containers.length === 0) {
    if (!isSilent) console.log('No openclaw containers running.');
    return;
  }

  const alerts = [];

  for (const name of containers) {
    const info = inspectContainer(name);
    if (!info) continue;

    // 1. Restart count
    const restarts = info.RestartCount || 0;
    if (restarts > RESTART_THRESHOLD) {
      alerts.push({
        severity: 'CRITICAL',
        container: name,
        issue: `Restarted ${restarts} times (threshold: ${RESTART_THRESHOLD})`,
        action: 'Auto-stopping container',
      });
      run(`docker stop ${name}`);
      log(`CRITICAL: Auto-stopped ${name} after ${restarts} restarts`);
    }

    // 2. Resource usage (from docker stats snapshot)
    const statsRaw = run(`docker stats ${name} --no-stream --format "{{.CPUPerc}},{{.MemUsage}}"`);
    if (statsRaw) {
      const [cpuStr, memStr] = statsRaw.trim().split(',');
      const cpu = parseFloat(cpuStr);

      // Parse memory: "134MiB / 256MiB" or "1.2GiB / 2GiB"
      function parseMemMB(str) {
        const m = (str || '').match(/([\d.]+)\s*(GiB|MiB|KiB)/);
        if (!m) return 0;
        const val = parseFloat(m[1]);
        return m[2] === 'GiB' ? val * 1024 : m[2] === 'KiB' ? val / 1024 : val;
      }

      const memParts = (memStr || '').split('/');
      const memUsedMB = parseMemMB(memParts[0]);
      // Read actual container memory limit; fall back to hardcoded default
      const memLimitMB = memParts[1] ? parseMemMB(memParts[1]) : 0;
      const effectiveLimitMB = memLimitMB > 0 ? memLimitMB : MEM_FALLBACK_LIMIT_MB;
      const memThresholdMB = effectiveLimitMB * MEM_THRESHOLD_RATIO;

      if (cpu > CPU_THRESHOLD) {
        alerts.push({
          severity: 'HIGH',
          container: name,
          issue: `CPU usage at ${cpu.toFixed(1)}% (threshold: ${CPU_THRESHOLD}%)`,
          action: 'None (monitoring)',
        });
        log(`HIGH: ${name} CPU at ${cpu.toFixed(1)}%`);
      }

      if (memUsedMB > memThresholdMB) {
        alerts.push({
          severity: 'HIGH',
          container: name,
          issue: `Memory usage at ${Math.round(memUsedMB)}MB / ${Math.round(effectiveLimitMB)}MB (${Math.round(memUsedMB / effectiveLimitMB * 100)}%, threshold: ${Math.round(MEM_THRESHOLD_RATIO * 100)}%)`,
          action: 'None (monitoring)',
        });
        log(`HIGH: ${name} memory at ${Math.round(memUsedMB)}MB / ${Math.round(effectiveLimitMB)}MB`);
      }
    }

    // 3. Check if container is still privileged (should never be)
    if (info.HostConfig && info.HostConfig.Privileged) {
      alerts.push({
        severity: 'CRITICAL',
        container: name,
        issue: 'Container is running in PRIVILEGED mode',
        action: 'Immediate investigation required',
      });
      log(`CRITICAL: ${name} is running privileged`);
    }
  }

  if (alerts.length === 0) {
    if (!isSilent) console.log(`All ${containers.length} containers healthy. No anomalies detected.`);
    return;
  }

  // Deduplicate: only print alerts that haven't been reported within the cooldown window
  const newAlerts = alerts.filter(a => shouldAlert(a.container, a.issue));

  if (newAlerts.length === 0) {
    if (!isSilent) console.log(`${alerts.length} known anomaly(ies) — already reported within the last hour. Suppressing.`);
    return;
  }

  // Print only new/re-triggered alerts
  console.log(`\n${newAlerts.length} NEW ANOMALY(IES) DETECTED (${alerts.length} total):\n`);
  for (const a of newAlerts) {
    console.log(`[${a.severity}] ALERT — Container Anomaly`);
    console.log(`  Container: ${a.container}`);
    console.log(`  Issue:     ${a.issue}`);
    console.log(`  Action:    ${a.action}`);
    console.log('');
  }

  log(`Scan complete: ${newAlerts.length} new, ${alerts.length} total anomalies across ${containers.length} containers`);
  process.exit(newAlerts.length > 0 ? 2 : 0); // exit 2 signals alerts to calling agent
}

function cmdStats() {
  const containers = getOpenClawContainers();
  if (containers.length === 0) {
    console.log('No openclaw containers running.');
    return;
  }

  console.log(`Live stats for ${containers.length} containers:\n`);
  console.log(run(`docker stats --no-stream --filter "name=openclaw-" --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.PIDs}}"`));
}

function cmdRestarts() {
  const containers = getOpenClawContainers();
  let found = 0;
  console.log('Restart counts:\n');
  for (const name of containers) {
    const info = inspectContainer(name);
    if (!info) continue;
    const restarts = info.RestartCount || 0;
    const flag = restarts > RESTART_THRESHOLD ? ' [HIGH]' : '';
    console.log(`  ${name}: ${restarts} restarts${flag}`);
    if (restarts > RESTART_THRESHOLD) found++;
  }
  if (found === 0) console.log('\nNo containers above restart threshold.');
}

function cmdConnections() {
  console.log('Checking outbound connections per container...\n');
  const containers = getOpenClawContainers();

  for (const name of containers) {
    const info = inspectContainer(name);
    if (!info) continue;

    const containerIP = info.NetworkSettings &&
      Object.values(info.NetworkSettings.Networks || {})[0]?.IPAddress;

    if (!containerIP) {
      console.log(`  ${name}: Could not determine container IP`);
      continue;
    }

    // Per-container extra allowlist from ALLOWED_EXTRA_HOSTS env var
    const containerExtraHosts = getContainerExtraHosts(info);
    const containerExtraIPs = containerExtraHosts.length > 0
      ? resolveHostnamesToIPs(containerExtraHosts)
      : new Set();

    // Read host conntrack to find established connections from this container IP
    const conntrack = run(`conntrack -L 2>/dev/null | grep "src=${containerIP}" | grep "ESTABLISHED"`) ||
                      run(`cat /proc/net/nf_conntrack 2>/dev/null | grep "${containerIP}"`) || '';

    const lines = conntrack.trim().split('\n').filter(Boolean);
    const allowed = getAllowedIPs();
    const unknownEntries = [];

    for (const line of lines) {
      const destMatch = line.match(/dst=([\d.]+)/);
      if (!destMatch) continue;
      const destIP = destMatch[1];

      // Skip Docker-internal and loopback ranges
      if (destIP.startsWith('127.') || destIP.startsWith('172.') || destIP.startsWith('10.')) continue;

      if (!allowed.has(destIP) && !containerExtraIPs.has(destIP)) {
        const hostname = reverseResolve(destIP);
        unknownEntries.push({ ip: destIP, hostname });
      }
    }

    if (unknownEntries.length > 0) {
      console.log(`  [WARN] ${name} → ${unknownEntries.length} unknown destination(s):`);
      for (const { ip, hostname } of unknownEntries) {
        const display = hostname ? `${ip} (${hostname})` : ip;
        console.log(`    • ${display}`);
        console.log(`      ➤ If this is expected, allow it with:`);
        if (hostname) {
          console.log(`        node container-monitor.js add-host ${hostname}`);
          console.log(`        Or message Guardian: "allow host ${hostname}"`);
        } else {
          console.log(`        echo "# replace with hostname for ${ip}" >> ${EXTRA_HOSTS_FILE}`);
          console.log(`        Or message Guardian: "allow host <hostname-for-${ip}>"`);
        }
      }
      log(`HIGH: ${name} connecting to unknown IPs: ${unknownEntries.map(e => e.hostname || e.ip).join(', ')}`);
    } else {
      console.log(`  [OK]   ${name} (${containerIP}) — ${lines.length} tracked connections, all destinations known`);
      if (containerExtraHosts.length > 0) {
        console.log(`         (customer allowlist active: ${containerExtraHosts.join(', ')})`);
      }
    }
  }
}

function cmdAudit() {
  const containers = getOpenClawContainers();
  if (containers.length === 0) {
    console.log('No openclaw containers to audit.');
    return;
  }

  console.log(`Security audit for ${containers.length} containers:\n`);
  let issues = 0;

  for (const name of containers) {
    const info = inspectContainer(name);
    if (!info) continue;

    const hc = info.HostConfig || {};
    const checks = [
      { label: 'Privileged',        pass: !hc.Privileged,                              flag: 'CRITICAL' },
      { label: 'No-new-privileges', pass: (hc.SecurityOpt || []).includes('no-new-privileges:true'), flag: 'HIGH' },
      { label: 'Memory limit set',  pass: hc.Memory > 0,                               flag: 'MEDIUM' },
      { label: 'CPU limit set',     pass: hc.NanoCpus > 0,                             flag: 'MEDIUM' },
      { label: 'Docker socket not mounted',
        pass: !(hc.Binds || []).some(b => b.includes('/var/run/docker.sock')),          flag: 'CRITICAL' },
      { label: 'Read-only rootfs',  pass: hc.ReadonlyRootfs,                           flag: 'HIGH' },
      { label: 'Not host network',  pass: (hc.NetworkMode || '') !== 'host',           flag: 'CRITICAL' },
    ];

    const failures = checks.filter(c => !c.pass);
    const status = failures.length === 0 ? '[PASS]' : `[${failures.length} ISSUE(S)]`;
    console.log(`  ${name}: ${status}`);

    for (const f of failures) {
      console.log(`    [${f.flag}] Failed: ${f.label}`);
      log(`${f.flag}: ${name} audit failed — ${f.label}`);
      issues++;
    }
  }

  console.log(`\nAudit complete: ${issues} issue(s) across ${containers.length} containers.`);
}

// ─── add-host: append a hostname to the admin extra-hosts file ───────────────

function cmdAddHost() {
  const hostname = process.argv[3];
  if (!hostname || hostname.startsWith('-')) {
    console.log('Usage: container-monitor.js add-host <hostname>');
    process.exit(1);
  }
  // Strict validation — only safe hostname characters allowed
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/.test(hostname)) {
    console.log(`Error: "${hostname}" is not a valid hostname.`);
    console.log('Only letters, digits, dots, hyphens, and underscores are allowed.');
    process.exit(1);
  }
  const existing = loadExtraHostnames();
  if (existing.includes(hostname)) {
    console.log(`"${hostname}" is already in the allowlist.`);
    return;
  }
  try {
    fs.mkdirSync('/etc/modelfitai', { recursive: true });
    if (!fs.existsSync(EXTRA_HOSTS_FILE)) {
      fs.writeFileSync(EXTRA_HOSTS_FILE, '# Admin-added extra allowed hostnames (one per line)\n# Added by: node container-monitor.js add-host <hostname>\n');
    }
    fs.appendFileSync(EXTRA_HOSTS_FILE, `${hostname}\n`);
  } catch (err) {
    console.log(`Error writing to ${EXTRA_HOSTS_FILE}: ${err.message}`);
    process.exit(1);
  }
  const resolved = run(`getent ahosts ${hostname} 2>/dev/null`)
    .trim().split('\n').map(l => l.split(/\s+/)[0]).filter(Boolean);
  console.log(`✓ Added "${hostname}" to ${EXTRA_HOSTS_FILE}`);
  if (resolved.length > 0) {
    console.log(`  Resolves to: ${resolved.join(', ')}`);
  } else {
    console.log('  (could not resolve now — will be checked on next scan)');
  }
  log(`Admin added "${hostname}" to extra hosts allowlist`);
}

// ─── list-hosts: show the full allowlist ──────────────────────────────────────

function cmdListHosts() {
  const extra = loadExtraHostnames();
  console.log(`=== Built-in allowed hosts (${ALLOWED_HOSTNAMES.length}) ===`);
  for (const h of ALLOWED_HOSTNAMES) console.log(`  ${h}`);
  console.log(`\n=== Admin-added hosts (${extra.length}) — ${EXTRA_HOSTS_FILE} ===`);
  if (extra.length === 0) {
    console.log('  (none yet)');
    console.log('  To add: node container-monitor.js add-host <hostname>');
    console.log('  Or message Guardian: "allow host <hostname>"');
  } else {
    for (const h of extra) console.log(`  ${h}`);
  }
  console.log('\n=== Per-container ALLOWED_EXTRA_HOSTS (set at deploy time) ===');
  const containers = getOpenClawContainers();
  if (containers.length === 0) {
    console.log('  (no containers running)');
  } else {
    for (const name of containers) {
      const info = inspectContainer(name);
      if (!info) continue;
      const perContainer = getContainerExtraHosts(info);
      if (perContainer.length > 0) {
        console.log(`  ${name}: ${perContainer.join(', ')}`);
      }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const cmd = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);
switch (cmd) {
  case 'scan':        cmdScan();        break;
  case 'stats':       cmdStats();       break;
  case 'restarts':    cmdRestarts();    break;
  case 'connections': cmdConnections(); break;
  case 'audit':       cmdAudit();       break;
  case 'add-host':    cmdAddHost();     break;
  case 'list-hosts':  cmdListHosts();   break;
  default:
    console.log('Usage: container-monitor.js <scan|stats|restarts|connections|audit|add-host|list-hosts> [--silent]');
    process.exit(1);
}
