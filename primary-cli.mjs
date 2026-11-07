#!/usr/bin/env node
/**
 * Primary Theme CLI for Antigravity 2.0 (Plan C)
 * Zero-dependency live CSS injector, hot-reload watcher, and LaunchAgent manager.
 *
 * Commands:
 *   node primary-cli.mjs apply        Build & inject Primary theme into running Antigravity 2.0
 *   node primary-cli.mjs watch        Watch src/*.css and hot-reload changes in real time
 *   node primary-cli.mjs remove       Remove Primary theme from running Antigravity 2.0 windows
 *   node primary-cli.mjs copy         Copy DevTools console injection snippet to macOS clipboard
 *   node primary-cli.mjs autostart    Install macOS LaunchAgent for automatic injection on app launch
 *   node primary-cli.mjs unautostart  Remove macOS LaunchAgent
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTheme } from './build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, 'src');
const DIST_CSS = path.join(__dirname, 'dist', 'primary-antigravity.css');
const DIST_JS = path.join(__dirname, 'dist', 'devtools-inject.js');

const ACTIVE_PORT_FILES = [
  path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity - Insiders', 'DevToolsActivePort'),
];

const LAUNCH_AGENT_LABEL = 'com.primary-theme.antigravity';
const LAUNCH_AGENT_PLIST = path.join(
  os.homedir(),
  'Library',
  'LaunchAgents',
  `${LAUNCH_AGENT_LABEL}.plist`
);

// ─────────────────────────────────────────────────────────────────────────────
// Minimal RFC 6455 WebSocket Client (Zero external dependencies, works on all Node versions)
// ─────────────────────────────────────────────────────────────────────────────
class MiniWebSocket {
  constructor(urlString) {
    this.url = new URL(urlString);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  emit(event, ...args) {
    for (const fn of this.listeners.get(event) || []) {
      fn(...args);
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        hostname: this.url.hostname || '127.0.0.1',
        port: Number(this.url.port),
        path: this.url.pathname + this.url.search,
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13',
        },
      });

      req.on('error', reject);
      req.on('upgrade', (res, socket, head) => {
        this.socket = socket;
        if (head && head.length > 0) {
          this.buffer = Buffer.concat([this.buffer, head]);
        }
        socket.on('data', (chunk) => {
          this.buffer = Buffer.concat([this.buffer, chunk]);
          this._drainFrames();
        });
        socket.on('error', (err) => this.emit('error', err));
        socket.on('close', () => this.emit('close'));
        resolve(this);
      });
      req.end();
    });
  }

  _drainFrames() {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = isMasked ? 4 : 0;
      if (this.buffer.length < offset + maskLen + payloadLen) return;

      let payload = this.buffer.subarray(offset + maskLen, offset + maskLen + payloadLen);
      if (isMasked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i & 3];
        }
      }

      this.buffer = this.buffer.subarray(offset + maskLen + payloadLen);

      if (opcode === 0x1) {
        this.emit('message', payload.toString('utf8'));
      } else if (opcode === 0x8) {
        this.close();
      } else if (opcode === 0x9) {
        this._sendFrame(0x0a, payload); // Pong
      }
    }
  }

  send(text) {
    const payload = Buffer.from(text, 'utf8');
    this._sendFrame(0x01, payload);
  }

  _sendFrame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return;
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;

    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      masked[i] = payload[i] ^ mask[i & 3];
    }

    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  close() {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CDP Discovery & Evaluation
// ─────────────────────────────────────────────────────────────────────────────

function readDevToolsActivePort() {
  for (const filePath of ACTIVE_PORT_FILES) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      const [portStr, wsPath] = raw.split(/\r?\n/);
      const port = Number(portStr);
      if (port > 0) {
        return { port, wsPath: wsPath || '/devtools/browser', filePath };
      }
    }
  }
  return null;
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 2500 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTP timeout'));
    });
  });
}

async function createCdpSession(wsUrl) {
  const ws = await new MiniWebSocket(wsUrl).connect();
  let nextId = 1;
  const pending = new Map();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    } catch {
      // Ignore malformed events
    }
  });

  function call(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout calling ${method}`));
      }, 4000);

      pending.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    });
  }

  return { ws, call, close: () => ws.close() };
}

function buildInjectionExpression(css) {
  return `(() => {
    const STYLE_ID = 'primary-obsidian-theme';
    const cssText = ${JSON.stringify(css)};
    const inject = () => {
      if (!document.head) return false;
      let styleEl = document.getElementById(STYLE_ID);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.setAttribute('data-theme', 'primary-bauhaus');
        document.head.appendChild(styleEl);
      }
      if (styleEl.textContent !== cssText) {
        styleEl.textContent = cssText;
      }
      if (document.body && document.body.getAttribute('data-agy-font') !== 'inter') {
        document.body.setAttribute('data-agy-font', 'inter');
      }
      return true;
    };
    if (!inject()) {
      window.addEventListener('DOMContentLoaded', inject, { once: true });
    }
    return { status: 'injected', title: document.title, themeClass: document.body ? document.body.className : '' };
  })()`;
}

function buildRemoveExpression() {
  return `(() => {
    const el = document.getElementById('primary-obsidian-theme');
    if (el) el.remove();
    return { status: el ? 'removed' : 'not_found', title: document.title };
  })()`;
}

async function executeAcrossAntigravityPages(expression, persistOnReload = true) {
  const active = readDevToolsActivePort();
  if (!active) {
    throw new Error(
      'Could not find Antigravity DevToolsActivePort. Please make sure Antigravity 2.0 is running.'
    );
  }

  const { port, wsPath } = active;
  const results = [];

  // Strategy 1: Query /json/list for page targets directly
  let targets = [];
  try {
    const list = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
    targets = list.filter(
      (t) =>
        (t.type === 'page' || t.type === 'app') &&
        t.webSocketDebuggerUrl &&
        !String(t.url || '').startsWith('devtools://')
    );
  } catch {
    // Fallback to Strategy 2 below
  }

  if (targets.length > 0) {
    for (const target of targets) {
      const session = await createCdpSession(target.webSocketDebuggerUrl);
      try {
        if (persistOnReload) {
          await session.call('Page.enable').catch(() => {});
          await session
            .call('Page.addScriptToEvaluateOnNewDocument', { source: expression })
            .catch(() => {});
        }
        const evalRes = await session.call('Runtime.evaluate', {
          expression,
          returnByValue: true,
        });
        results.push({
          title: target.title || 'Antigravity Window',
          url: target.url,
          value: evalRes?.result?.value,
        });
      } finally {
        session.close();
      }
    }
    return results;
  }

  // Strategy 2: Connect to Browser-level WebSocket and attach to page targets
  const browserWsUrl = `ws://127.0.0.1:${port}${wsPath}`;
  const browserSession = await createCdpSession(browserWsUrl);
  try {
    const { targetInfos = [] } = await browserSession.call('Target.getTargets');
    const pageTargets = targetInfos.filter(
      (t) =>
        (t.type === 'page' || t.type === 'app') &&
        !String(t.url || '').startsWith('devtools://')
    );

    for (const target of pageTargets) {
      const { sessionId } = await browserSession.call('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true,
      });
      if (persistOnReload) {
        await browserSession.call('Page.enable', {}, sessionId).catch(() => {});
        await browserSession
          .call('Page.addScriptToEvaluateOnNewDocument', { source: expression }, sessionId)
          .catch(() => {});
      }
      const evalRes = await browserSession.call(
        'Runtime.evaluate',
        { expression, returnByValue: true },
        sessionId
      );
      results.push({
        title: target.title || 'Antigravity Window',
        url: target.url,
        value: evalRes?.result?.value,
      });
    }
  } finally {
    browserSession.close();
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Commands
// ─────────────────────────────────────────────────────────────────────────────

async function cmdApply({ silent = false } = {}) {
  const { fullCss } = buildTheme({ silent });
  const expr = buildInjectionExpression(fullCss);
  const results = await executeAcrossAntigravityPages(expr, true);

  if (!silent) {
    console.log(`\n🎨 Primary Theme (Bauhaus Red / Yellow + Rainbow Sidebar) injected into ${results.length} window(s):`);
    for (const r of results) {
      console.log(`   • ${r.title} (${r.value?.status || 'ok'})`);
    }
  }
  return results;
}

async function cmdRemove() {
  const expr = buildRemoveExpression();
  const results = await executeAcrossAntigravityPages(expr, false);
  console.log(`\n🧹 Removed Primary Theme from ${results.length} window(s):`);
  for (const r of results) {
    console.log(`   • ${r.title} (${r.value?.status || 'ok'})`);
  }
}

async function cmdWatch() {
  console.log('👀 Starting Primary Theme Hot-Reload Watcher...');
  await cmdApply().catch((err) => {
    console.warn(`⚠️  Initial apply warning: ${err.message}`);
  });

  let debounceTimer = null;
  fs.watch(SRC_DIR, { persistent: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.css')) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const start = Date.now();
      try {
        const { fullCss } = buildTheme({ silent: true });
        const expr = buildInjectionExpression(fullCss);
        const res = await executeAcrossAntigravityPages(expr, true);
        const elapsed = Date.now() - start;
        console.log(
          `⚡ [${new Date().toLocaleTimeString()}] Hot-reloaded ${filename} across ${res.length} window(s) in ${elapsed}ms`
        );
      } catch (err) {
        console.error(`❌ Hot-reload error: ${err.message}`);
      }
    }, 60);
  });

  // Also periodically ensure newly opened Antigravity windows receive the theme
  setInterval(async () => {
    try {
      if (!fs.existsSync(DIST_CSS)) return;
      const css = fs.readFileSync(DIST_CSS, 'utf8');
      await executeAcrossAntigravityPages(buildInjectionExpression(css), true);
    } catch {
      // App might be closed or restarting; ignore quietly
    }
  }, 4000);

  console.log(`✨ Watching ${SRC_DIR} for CSS changes (Ctrl+C to stop)...`);
}

function cmdCopy() {
  buildTheme({ silent: true });
  const snippet = fs.readFileSync(DIST_JS, 'utf8');
  execSync('pbcopy', { input: snippet });
  console.log('📋 Copied self-contained DevTools console snippet to macOS clipboard!');
  console.log('   Open Antigravity 2.0 -> Press Cmd+Option+I -> Console -> Cmd+V -> Enter.');
}

function cmdAutostart() {
  buildTheme({ silent: true });
  const nodePath = process.execPath;
  const cliPath = path.join(__dirname, 'primary-cli.mjs');
  const logPath = path.join(__dirname, 'dist', 'autostart.log');

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${cliPath}</string>
    <string>watch</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${__dirname}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;

  fs.mkdirSync(path.dirname(LAUNCH_AGENT_PLIST), { recursive: true });
  fs.writeFileSync(LAUNCH_AGENT_PLIST, plistContent, 'utf8');

  try {
    execSync(`launchctl unload "${LAUNCH_AGENT_PLIST}" 2>/dev/null || true`);
    execSync(`launchctl load -w "${LAUNCH_AGENT_PLIST}"`);
    console.log(`✅ Installed & started macOS LaunchAgent: ${LAUNCH_AGENT_PLIST}`);
    console.log('   Primary Theme will now automatically apply whenever Antigravity 2.0 is open.');
  } catch (err) {
    console.error(`⚠️ Wrote plist to ${LAUNCH_AGENT_PLIST}, but launchctl returned: ${err.message}`);
  }
}

function cmdUnautostart() {
  if (fs.existsSync(LAUNCH_AGENT_PLIST)) {
    try {
      execSync(`launchctl unload -w "${LAUNCH_AGENT_PLIST}" 2>/dev/null || true`);
    } catch {
      // ignore
    }
    fs.unlinkSync(LAUNCH_AGENT_PLIST);
    console.log(`🗑️  Removed LaunchAgent: ${LAUNCH_AGENT_PLIST}`);
  } else {
    console.log('ℹ️  No LaunchAgent installed.');
  }
}

function printHelp() {
  console.log(`
Primary Theme CLI for Antigravity 2.0 (Plan C)
Usage:
  node primary-cli.mjs <command>

Commands:
  apply        Build CSS and live-inject Primary Theme into all open Antigravity 2.0 windows
  watch        Live-watch src/*.css and hot-reload changes in <50ms (+ auto-inject new windows)
  remove       Remove Primary Theme from open Antigravity 2.0 windows immediately
  copy         Copy one-paste DevTools console snippet to macOS clipboard (pbcopy)
  autostart    Install macOS LaunchAgent to auto-inject Primary Theme in the background
  unautostart  Uninstall macOS LaunchAgent
`);
}

const cmd = process.argv[2] || 'help';

switch (cmd) {
  case 'apply':
    cmdApply().catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
    break;
  case 'watch':
    cmdWatch().catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
    break;
  case 'remove':
    cmdRemove().catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
    break;
  case 'copy':
    cmdCopy();
    break;
  case 'autostart':
    cmdAutostart();
    break;
  case 'unautostart':
    cmdUnautostart();
    break;
  default:
    printHelp();
    break;
}
