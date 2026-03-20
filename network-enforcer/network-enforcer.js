#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

const LOG_FILE = '/var/log/modelfitai/guardian.log';
const CONTROL_UI_PORT_START = 18800;
const CONTROL_UI_PORT_END = 19000;
const RULE_COMMENT = 'modelfitai-isolation';

/**
 * Detect the default outbound network interface dynamically.
 * Falls back to 'eth0' if detection fails.
 */
function detectDefaultInterface() {
  try {
    // `ip route` prints: "default via x.x.x.x dev <iface> ..."
    const out = execSync("ip route | grep '^default' | awk '{print $5}' | head -1", { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (out && /^[a-zA-Z0-9]+$/.test(out)) return out;
  } catch (_) {}
  return 'eth0';
}

const HOST_IFACE = detectDefaultInterface();
// Log detected interface on first run so admin can verify
if (!process.argv.includes('--silent')) {
  console.log(`Detected default network interface: ${HOST_IFACE}`);
}

function log(msg) {
  const line = `[${new Date().toISOString()}] [network-enforcer] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync('/var/log/modelfitai', { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit' });
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

function iptablesRuleExists(chain, ruleArgs) {
  try {
    execSync(`iptables -C ${chain} ${ruleArgs} 2>/dev/null`, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function applyRule(chain, ruleArgs, description) {
  if (iptablesRuleExists(chain, ruleArgs)) {
    console.log(`  already set: ${description}`);
    return;
  }
  run(`iptables -I ${chain} ${ruleArgs}`, { silent: true });
  log(`Applied rule: ${description}`);
  console.log(`  applied: ${description}`);
}

function persistRules() {
  // Install iptables-persistent if not present, then save current rules
  run('dpkg -l iptables-persistent 2>/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent 2>/dev/null', { allowFail: true, silent: true });
  run('mkdir -p /etc/iptables', { allowFail: true, silent: true });
  run('iptables-save > /etc/iptables/rules.v4', { allowFail: true, silent: true });
  log('iptables rules persisted to /etc/iptables/rules.v4');
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdApply() {
  console.log('Applying network isolation rules...\n');

  // 1. Block all Docker bridge-to-bridge traffic (container → container)
  applyRule(
    'DOCKER-USER',
    '-i docker+ -o docker+ -m comment --comment modelfitai-isolation -j DROP',
    'Block container-to-container traffic'
  );

  // 2. Allow containers → internet (outbound via detected interface)
  applyRule(
    'DOCKER-USER',
    `-i docker+ -o ${HOST_IFACE} -m comment --comment modelfitai-isolation -j ACCEPT`,
    `Allow container outbound to internet (via ${HOST_IFACE})`
  );

  // 3. Allow established/related return traffic back into containers
  applyRule(
    'DOCKER-USER',
    `-i ${HOST_IFACE} -o docker+ -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment modelfitai-isolation -j ACCEPT`,
    'Allow return traffic to containers'
  );

  // 4. Allow inbound to OpenClaw gateway port (18789) so Control UI works on dedicated VPS
  applyRule(
    'DOCKER-USER',
    `-i ${HOST_IFACE} -o docker+ -p tcp --dport 18789 -m conntrack --ctstate NEW -m comment --comment modelfitai-isolation -j ACCEPT`,
    'Allow inbound to OpenClaw gateway port 18789'
  );

  // 5. Block all other NEW inbound from internet into containers
  applyRule(
    'DOCKER-USER',
    `-i ${HOST_IFACE} -o docker+ -m conntrack --ctstate NEW -m comment --comment modelfitai-isolation -j DROP`,
    'Block unsolicited inbound to containers (except gateway)'
  );

  // 6. Lock control UI ports from public internet (INPUT chain fallback)
  cmdLockPorts();

  // 7. Persist rules so they survive reboot
  persistRules();

  console.log('\nAll isolation rules applied and persisted.');
  log('Full isolation ruleset applied and persisted successfully');
}

function cmdVerify() {
  console.log('Verifying network isolation...\n');

  const rules = run('iptables -L DOCKER-USER -n --line-numbers 2>/dev/null || echo ""', { silent: true });
  const hasIsolation = rules && rules.includes(RULE_COMMENT);

  if (!hasIsolation) {
    console.log('[FAIL] DOCKER-USER isolation rules are MISSING');
    log('CRITICAL: Isolation rules missing from DOCKER-USER chain');
    console.log('\nAuto-applying rules now...');
    cmdApply();
    console.log('\nRe-verification after auto-apply:');
    return cmdVerify();
  }

  // Check port lock
  const inputRules = run('iptables -L INPUT -n 2>/dev/null || echo ""', { silent: true });
  const portsLocked = inputRules && inputRules.includes(`${CONTROL_UI_PORT_START}:${CONTROL_UI_PORT_END}`);

  const dockerBridge = run('iptables -L DOCKER-USER -n 2>/dev/null | grep DROP | grep "docker+" || echo ""', { silent: true }).trim();
  const bridgeBlocked = dockerBridge.length > 0;

  console.log(`  Container isolation (bridge-to-bridge): ${bridgeBlocked ? '[PASS]' : '[FAIL]'}`);
  console.log(`  Control UI ports locked (18800-19000):  ${portsLocked ? '[PASS]' : '[WARN] not locked'}`);
  console.log(`  Rule comment present:                   ${hasIsolation ? '[PASS]' : '[FAIL]'}`);

  if (!bridgeBlocked) {
    log('HIGH: Bridge-to-bridge DROP rule is missing');
    console.log('\nApplying missing rules...');
    cmdApply();
  }

  if (!portsLocked) {
    log('MEDIUM: Control UI ports are not locked');
    cmdLockPorts();
  }

  console.log('\nVerification complete.');
}

function cmdStatus() {
  console.log('=== DOCKER-USER chain ===');
  run('iptables -L DOCKER-USER -n -v --line-numbers 2>/dev/null || echo "(chain not found)"');
  console.log('\n=== INPUT chain (port lock rules) ===');
  run(`iptables -L INPUT -n -v --line-numbers 2>/dev/null | grep -E "18[89][0-9][0-9]|19000|modelfitai" || echo "(no rules found)"`);
}

function cmdLockPorts() {
  console.log('Locking control UI ports from public internet...');

  // Block 18800-19000 from any source except localhost
  applyRule(
    'INPUT',
    `-p tcp --dport ${CONTROL_UI_PORT_START}:${CONTROL_UI_PORT_END} ! -s 127.0.0.1 -m comment --comment modelfitai-isolation -j DROP`,
    `Block public access to ports ${CONTROL_UI_PORT_START}-${CONTROL_UI_PORT_END}`
  );

  console.log('Control UI ports locked to localhost only.');
  log('Control UI port lock applied');
}

function cmdReset() {
  console.log('WARNING: Removing all modelfitai isolation rules...');
  // Flush only our tagged rules
  run(`iptables -L DOCKER-USER --line-numbers -n | grep modelfitai-isolation | awk '{print $1}' | sort -rn | xargs -I {} iptables -D DOCKER-USER {}`, { allowFail: true });
  run(`iptables -L INPUT --line-numbers -n | grep modelfitai-isolation | awk '{print $1}' | sort -rn | xargs -I {} iptables -D INPUT {}`, { allowFail: true });
  console.log('All modelfitai isolation rules removed.');
  log('WARNING: Isolation rules removed by admin request');
}

// ─── Inbound allowlist file ───────────────────────────────────────────────────
//
// Allows specific source IPs/hostnames to initiate NEW inbound connections into
// ALL openclaw containers on port 18789 (the OpenClaw gateway).
// Use case: webhooks from Zapier, Stripe, GitHub Actions, etc.
//
// File: /etc/modelfitai/allowed-inbound.txt  (one hostname or CIDR per line)

const INBOUND_ALLOWLIST_FILE = '/etc/modelfitai/allowed-inbound.txt';

function loadInboundAllowlist() {
  try {
    if (!fs.existsSync(INBOUND_ALLOWLIST_FILE)) return [];
    return fs.readFileSync(INBOUND_ALLOWLIST_FILE, 'utf8')
      .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } catch (_) { return []; }
}

function resolveToIPs(hostname) {
  // If already an IP or CIDR, return as-is
  if (/^[\d./]+$/.test(hostname)) return [hostname];
  try {
    const result = execSync(`getent ahosts ${hostname} 2>/dev/null`, { encoding: 'utf8', stdio: 'pipe' });
    return result.trim().split('\n')
      .map(l => l.split(/\s+/)[0]).filter(Boolean);
  } catch (_) { return []; }
}

function cmdAllowInbound() {
  const source = process.argv[3];
  if (!source || source.startsWith('-')) {
    console.log('Usage: network-enforcer.js allow-inbound <hostname|ip|cidr>');
    console.log('Example: network-enforcer.js allow-inbound hooks.zapier.com');
    console.log('Example: network-enforcer.js allow-inbound 34.120.50.0/24');
    process.exit(1);
  }
  // Validate: only safe hostname/CIDR characters
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/.test(source)) {
    console.log(`Error: "${source}" contains invalid characters.`);
    process.exit(1);
  }
  const existing = loadInboundAllowlist();
  if (existing.includes(source)) {
    console.log(`"${source}" is already in the inbound allowlist.`);
    return;
  }
  // Persist to file
  try {
    fs.mkdirSync('/etc/modelfitai', { recursive: true });
    if (!fs.existsSync(INBOUND_ALLOWLIST_FILE)) {
      fs.writeFileSync(INBOUND_ALLOWLIST_FILE, '# Admin-added inbound sources (hostname, IP, or CIDR — one per line)\n# Added via: node network-enforcer.js allow-inbound <source>\n');
    }
    fs.appendFileSync(INBOUND_ALLOWLIST_FILE, `${source}\n`);
  } catch (err) {
    console.log(`Error writing ${INBOUND_ALLOWLIST_FILE}: ${err.message}`);
    process.exit(1);
  }
  // Resolve to IPs and apply iptables rules immediately
  const ips = resolveToIPs(source);
  if (ips.length === 0) {
    console.log(`⚠ Could not resolve "${source}" to IPs right now.`);
    console.log(`  Saved to file — rules will NOT be active until next apply or VPS reboot.`);
    console.log(`  To apply manually: node network-enforcer.js apply-inbound`);
  } else {
    let applied = 0;
    for (const ip of ips) {
      const ruleArgs = `-i ${HOST_IFACE} -o docker+ -s ${ip} -p tcp --dport 18789 -m conntrack --ctstate NEW -m comment --comment modelfitai-inbound -j ACCEPT`;
      if (!iptablesRuleExists('DOCKER-USER', ruleArgs)) {
        // Insert BEFORE the DROP rule (position 1 inserts at top of chain)
        run(`iptables -I DOCKER-USER 1 ${ruleArgs}`, { silent: true });
        applied++;
      }
    }
    persistRules();
    console.log(`✓ Allowed inbound from "${source}" (${ips.join(', ')}) — ${applied} rule(s) added, persisted.`);
  }
  log(`Admin allowed inbound from "${source}"`);
}

function cmdApplyInbound() {
  // Re-apply all saved inbound rules (e.g. after reboot if iptables-persistent isn't installed)
  const list = loadInboundAllowlist();
  if (list.length === 0) {
    console.log('No inbound allowlist entries to apply.');
    return;
  }
  let total = 0;
  for (const source of list) {
    const ips = resolveToIPs(source);
    for (const ip of ips) {
      const ruleArgs = `-i ${HOST_IFACE} -o docker+ -s ${ip} -p tcp --dport 18789 -m conntrack --ctstate NEW -m comment --comment modelfitai-inbound -j ACCEPT`;
      if (!iptablesRuleExists('DOCKER-USER', ruleArgs)) {
        run(`iptables -I DOCKER-USER 1 ${ruleArgs}`, { silent: true });
        total++;
      }
    }
  }
  persistRules();
  console.log(`Applied ${total} inbound rule(s) from ${list.length} saved entries.`);
  log(`Re-applied inbound allowlist: ${list.length} entries, ${total} rules`);
}

function cmdListInbound() {
  const list = loadInboundAllowlist();
  console.log(`=== Inbound allowlist (${list.length} entries) — ${INBOUND_ALLOWLIST_FILE} ===`);
  if (list.length === 0) {
    console.log('  (none — all unsolicited inbound is blocked except port 18789 established return traffic)');
    console.log('  To allow a webhook source: node network-enforcer.js allow-inbound hooks.zapier.com');
    console.log('  Or message Guardian: "allow inbound hooks.zapier.com"');
  } else {
    for (const entry of list) console.log(`  ${entry}`);
  }
  console.log('\n=== Active iptables inbound rules ===');
  run('iptables -L DOCKER-USER -n --line-numbers 2>/dev/null | grep modelfitai-inbound || echo "  (no active inbound rules — run apply-inbound to restore)"');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const cmd = process.argv[2];
switch (cmd) {
  case 'apply':          cmdApply();         break;
  case 'verify':         cmdVerify();        break;
  case 'status':         cmdStatus();        break;
  case 'lock-ports':     cmdLockPorts();     break;
  case 'reset':          cmdReset();         break;
  case 'allow-inbound':  cmdAllowInbound();  break;
  case 'apply-inbound':  cmdApplyInbound();  break;
  case 'list-inbound':   cmdListInbound();   break;
  default:
    console.log('Usage: network-enforcer.js <apply|verify|status|lock-ports|reset|allow-inbound|apply-inbound|list-inbound>');
    process.exit(1);
}
