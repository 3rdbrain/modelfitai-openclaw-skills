#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG_FILE = '/var/log/modelfitai/security-updates.log';
const STATUS_FILE = '/var/log/modelfitai/last-update.json';
const CUSTOMERS_DIR = '/root/modelfitai/docker/customers';
const OPENCLAW_IMAGE = 'modelfitai/openclaw:latest';
const HEALTH_CHECK_TIMEOUT_S = 60;

function log(msg) {
  const line = `[${new Date().toISOString()}] [security-updater] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync('/var/log/modelfitai', { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

function run(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      encoding: 'utf8',
      stdio: opts.silent ? 'pipe' : 'inherit',
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
    });
    return (out || '').trim();
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

function saveStatus(data) {
  try {
    fs.mkdirSync('/var/log/modelfitai', { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...data, timestamp: new Date().toISOString() }, null, 2));
  } catch (_) {}
}

function getOpenClawContainers() {
  return run('docker ps --filter "name=openclaw-" --format "{{.Names}}"', { silent: true })
    .split('\n').filter(Boolean);
}

function waitForHealthy(containerName, timeoutSecs) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < timeoutSecs) {
    const status = run(`docker inspect ${containerName} --format "{{.State.Health.Status}}" 2>/dev/null`, { allowFail: true, silent: true });
    if (status === 'healthy') return true;
    if (status === 'unhealthy') return false;
    // If no health check configured, check if it's running
    const running = run(`docker inspect ${containerName} --format "{{.State.Running}}" 2>/dev/null`, { allowFail: true, silent: true });
    if (running === 'true' && status === '') return true; // no healthcheck, running = ok
    execSync('sleep 5', { stdio: 'ignore' });
  }
  return false;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdCheck() {
  console.log('Checking for available updates...\n');

  // OS security updates
  run('apt-get update -qq', { silent: true });
  const securityPackages = run(
    'apt-get --just-print upgrade 2>&1 | grep "^Inst" | grep -i security | awk \'{print $2}\'',
    { allowFail: true, silent: true }
  );
  const pkgList = securityPackages.split('\n').filter(Boolean);
  console.log(`OS security patches available: ${pkgList.length}`);
  if (pkgList.length > 0) {
    pkgList.slice(0, 10).forEach(p => console.log(`  - ${p}`));
    if (pkgList.length > 10) console.log(`  ... and ${pkgList.length - 10} more`);
  }

  // Docker version check
  const currentDocker = run('docker --version 2>/dev/null | grep -oP "\\d+\\.\\d+\\.\\d+"', { allowFail: true, silent: true });
  const latestDocker = run('apt-cache policy docker-ce 2>/dev/null | grep Candidate | grep -oP "\\d+\\.\\d+\\.\\d+"', { allowFail: true, silent: true });
  const dockerUpdateAvail = currentDocker && latestDocker && currentDocker !== latestDocker;
  console.log(`\nDocker engine: ${currentDocker || 'unknown'} → ${latestDocker || 'unknown'} ${dockerUpdateAvail ? '[UPDATE AVAILABLE]' : '[up to date]'}`);

  // OpenClaw image check
  const currentImageId = run(`docker images ${OPENCLAW_IMAGE} --format "{{.ID}}" 2>/dev/null`, { allowFail: true, silent: true });
  console.log(`\nOpenClaw image: ${currentImageId ? currentImageId.substring(0, 12) : 'not pulled'}`);
  console.log('  Run `update-openclaw` to check for newer image.');

  console.log('');
  saveStatus({ last_check: new Date().toISOString(), os_patches: pkgList.length, docker_update: dockerUpdateAvail });
}

function cmdRun() {
  log('Starting OS security update run...');
  console.log('Running OS security updates...\n');

  // Only security-tagged packages, fully non-interactive
  run('apt-get update -qq');
  const secPkgs = run(
    'apt-get --just-print upgrade 2>&1 | grep "^Inst" | grep -i security | awk \'{print $2}\' | tr "\\n" " "',
    { allowFail: true, silent: true }
  ).trim();

  if (secPkgs) {
    log(`Installing security packages: ${secPkgs}`);
    run([
      `apt-get install -y --only-upgrade`,
      `-o Dpkg::Options::="--force-confdef"`,
      `-o Dpkg::Options::="--force-confold"`,
      secPkgs,
    ].join(' '), { allowFail: true });
  } else {
    log('No security packages to update');
    console.log('  No security packages to update.');
  }

  // Docker engine upgrade if available
  const currentDocker = run('docker --version 2>/dev/null | grep -oP "\\d+\\.\\d+\\.\\d+"', { allowFail: true, silent: true });
  const latestDocker = run('apt-cache policy docker-ce 2>/dev/null | grep Candidate | grep -oP "\\d+\\.\\d+\\.\\d+"', { allowFail: true, silent: true });
  if (currentDocker && latestDocker && currentDocker !== latestDocker) {
    log(`Upgrading Docker: ${currentDocker} → ${latestDocker}`);
    run('apt-get install -y --only-upgrade docker-ce docker-ce-cli containerd.io');
    log('Docker engine upgraded');
  }

  log('OS security update run complete');
  console.log('\nOS update run complete.');
  saveStatus({ last_run: new Date().toISOString(), type: 'os_security' });
}

function cmdUpdateOpenclaw() {
  log('Starting OpenClaw image update...');
  console.log('Checking for new OpenClaw image...\n');

  const oldId = run(`docker images ${OPENCLAW_IMAGE} --format "{{.ID}}" 2>/dev/null`, { allowFail: true, silent: true });
  run(`docker pull ${OPENCLAW_IMAGE}`);
  const newId = run(`docker images ${OPENCLAW_IMAGE} --format "{{.ID}}" 2>/dev/null`, { allowFail: true, silent: true });

  if (oldId === newId && oldId !== '') {
    console.log('Already on latest OpenClaw image. No containers to update.');
    log('OpenClaw image already up to date');
    return;
  }

  log(`New image: ${oldId?.substring(0, 12) || 'none'} → ${newId?.substring(0, 12)}`);
  console.log(`New image detected. Rolling update starting...\n`);

  const containers = getOpenClawContainers();
  if (containers.length === 0) {
    console.log('No running openclaw containers to update.');
    return;
  }

  let updated = 0;
  let rolledBack = 0;

  for (const name of containers) {
    console.log(`  Updating: ${name}`);
    log(`Updating container: ${name}`);

    // Find the compose project working directory via Docker label (works for both
    // shared VPS customers/ layout and dedicated VPS /opt/openclaw/ layout)
    let customerDir = run(
      `docker inspect ${name} --format "{{index .Config.Labels \\"com.docker.compose.project.working_dir\\"}}" 2>/dev/null`,
      { allowFail: true, silent: true }
    );

    // Fallback: try to extract from bind mounts (legacy layout)
    if (!customerDir || !fs.existsSync(customerDir)) {
      const binds = run(`docker inspect ${name} --format "{{.HostConfig.Binds}}" 2>/dev/null`, { allowFail: true, silent: true });
      // Match any directory containing a docker-compose file
      const dirMatch = binds.match(/(\S+)\/(?:openclaw\.json|soul\.md|docker-compose\.yml):/);
      if (dirMatch) customerDir = dirMatch[1];
    }

    if (!customerDir || !fs.existsSync(customerDir)) {
      console.log(`    Could not find compose dir for ${name}, skipping`);
      continue;
    }

    // Save the current image ID for this specific container so rollback is safe
    // even when updating multiple containers in sequence.
    const containerImageId = run(
      `docker inspect ${name} --format "{{.Image}}" 2>/dev/null`,
      { allowFail: true, silent: true }
    );
    const rollbackTag = `${OPENCLAW_IMAGE.replace(':latest', '')}:rollback-${name}`;
    if (containerImageId) {
      run(`docker tag ${containerImageId} ${rollbackTag}`, { allowFail: true, silent: true });
    }

    try {
      run(`cd ${customerDir} && docker compose pull && docker compose up -d --force-recreate`);

      const healthy = waitForHealthy(name, HEALTH_CHECK_TIMEOUT_S);
      if (healthy) {
        console.log(`    [OK] ${name} updated and healthy`);
        log(`Updated: ${name}`);
        updated++;
        // Clean up per-container rollback tag on success
        run(`docker rmi ${rollbackTag} 2>/dev/null`, { allowFail: true, silent: true });
      } else {
        throw new Error('Health check failed after update');
      }
    } catch (err) {
      console.log(`    [ROLLBACK] ${name} — ${err.message}`);
      log(`Rolling back ${name}: ${err.message}`);
      // Restore this container's specific previous image and restart
      if (containerImageId) {
        run(`docker tag ${rollbackTag} ${OPENCLAW_IMAGE}`, { allowFail: true, silent: true });
      }
      run(`cd ${customerDir} && docker compose up -d --force-recreate`, { allowFail: true });
      run(`docker rmi ${rollbackTag} 2>/dev/null`, { allowFail: true, silent: true });
      rolledBack++;
    }
  }

  const summary = `OpenClaw update done: ${updated} updated, ${rolledBack} rolled back, ${containers.length - updated - rolledBack} skipped`;
  console.log(`\n${summary}`);
  log(summary);
  saveStatus({ last_openclaw_update: new Date().toISOString(), updated, rolled_back: rolledBack });
}

function cmdStatus() {
  if (!fs.existsSync(STATUS_FILE)) {
    console.log('No update history found.');
    return;
  }
  const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  console.log('Last update status:\n');
  console.log(JSON.stringify(data, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const cmd = process.argv[2];
switch (cmd) {
  case 'check':           cmdCheck();          break;
  case 'run':             cmdRun();            break;
  case 'update-openclaw': cmdUpdateOpenclaw(); break;
  case 'status':          cmdStatus();         break;
  default:
    console.log('Usage: security-updater.js <check|run|update-openclaw|status>');
    process.exit(1);
}
