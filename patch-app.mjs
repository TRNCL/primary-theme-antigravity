#!/usr/bin/env node
/**
 * Optional Static App Bundle Patcher for Antigravity 2.0 (macOS)
 *
 * NOTE: For most users, `node primary-cli.mjs apply` or `node primary-cli.mjs autostart`
 * is recommended because it requires ZERO modification to /Applications/Antigravity.app
 * and preserves official Apple code signatures across auto-updates.
 *
 * If you prefer baking the CSS loader directly into app.asar's preload script:
 *   node patch-app.mjs --install
 *   node patch-app.mjs --restore
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTheme } from './build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PATH = '/Applications/Antigravity.app';
const CONTENTS_PATH = path.join(APP_PATH, 'Contents');
const INFO_PLIST = path.join(CONTENTS_PATH, 'Info.plist');
const ASAR_PATH = path.join(CONTENTS_PATH, 'Resources', 'app.asar');
const BACKUP_ASAR = path.join(__dirname, 'dist', 'app.asar.backup');
const BACKUP_PLIST = path.join(__dirname, 'dist', 'Info.plist.backup');
const DIST_CSS = path.join(__dirname, 'dist', 'primary-antigravity.css');

const PATCH_MARKER = '/* __PRIMARY_OBSIDIAN_THEME_LOADER__ */';

function computeAsarHeaderHash(asarFilePath) {
  const fd = fs.openSync(asarFilePath, 'r');
  try {
    const sizeBuf = Buffer.alloc(16);
    fs.readSync(fd, sizeBuf, 0, 16, 0);
    // Electron Pickle header: uint32 payload_size (4), uint32 header_size, uint32 header_string_size, uint32 string_length
    const headerStringLen = sizeBuf.readUInt32LE(12);
    const headerBuf = Buffer.alloc(headerStringLen);
    fs.readSync(fd, headerBuf, 0, headerStringLen, 16);
    return crypto.createHash('sha256').update(headerBuf).digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function installPatch() {
  buildTheme({ silent: true });

  if (!fs.existsSync(ASAR_PATH)) {
    throw new Error(`Cannot find ${ASAR_PATH}`);
  }

  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  if (!fs.existsSync(BACKUP_ASAR)) {
    fs.copyFileSync(ASAR_PATH, BACKUP_ASAR);
    console.log(`✔ Backed up original app.asar -> ${BACKUP_ASAR}`);
  }
  if (!fs.existsSync(BACKUP_PLIST)) {
    fs.copyFileSync(INFO_PLIST, BACKUP_PLIST);
    console.log(`✔ Backed up original Info.plist -> ${BACKUP_PLIST}`);
  }

  const tmpDir = path.join(__dirname, 'dist', '.asar-extract-tmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('⏳ Extracting app.asar...');
  execSync(`npx --yes @electron/asar extract "${ASAR_PATH}" "${tmpDir}"`, { stdio: 'inherit' });

  const preloadPath = path.join(tmpDir, 'dist', 'preload.js');
  let preloadCode = fs.readFileSync(preloadPath, 'utf8');

  const loaderSnippet = `
${PATCH_MARKER}
;(() => {
  try {
    const fs = require('fs');
    const cssPath = ${JSON.stringify(DIST_CSS)};
    const applyCss = () => {
      if (!document.head) return;
      let style = document.getElementById('primary-obsidian-theme');
      if (!style) {
        style = document.createElement('style');
        style.id = 'primary-obsidian-theme';
        document.head.appendChild(style);
      }
      if (fs.existsSync(cssPath)) {
        style.textContent = fs.readFileSync(cssPath, 'utf8');
      }
      if (document.body) {
        document.body.setAttribute('data-agy-font', 'inter');
      }
    };
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', applyCss);
    } else {
      applyCss();
    }
    if (fs.existsSync(cssPath)) {
      fs.watchFile(cssPath, { interval: 500 }, applyCss);
    }
  } catch (err) {
    console.error('[Primary Theme Preload Error]', err);
  }
})();
`;

  if (!preloadCode.includes(PATCH_MARKER)) {
    preloadCode += loaderSnippet;
    fs.writeFileSync(preloadPath, preloadCode, 'utf8');
  }

  console.log('⏳ Repacking app.asar...');
  execSync(`npx --yes @electron/asar pack "${tmpDir}" "${ASAR_PATH}"`, { stdio: 'inherit' });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const newHash = computeAsarHeaderHash(ASAR_PATH);
  const plistText = fs.readFileSync(INFO_PLIST, 'utf8');
  const updatedPlist = plistText.replace(
    /(<key>Resources\/app\.asar<\/key>\s*<dict>[\s\S]*?<key>hash<\/key>\s*<string>)[a-f0-9]+(<\/string>)/i,
    `$1${newHash}$2`
  );
  fs.writeFileSync(INFO_PLIST, updatedPlist, 'utf8');
  console.log(`✔ Updated ElectronAsarIntegrity hash in Info.plist: ${newHash}`);

  console.log('⏳ Re-signing Antigravity.app (ad-hoc)...');
  execSync(`codesign --force --deep --sign - "${APP_PATH}"`, { stdio: 'inherit' });
  console.log('✅ Static app.asar patch installed! Restart Antigravity 2.0 to take effect.');
}

function restorePatch() {
  if (!fs.existsSync(BACKUP_ASAR) || !fs.existsSync(BACKUP_PLIST)) {
    throw new Error('No backup files found in dist/ to restore from.');
  }
  fs.copyFileSync(BACKUP_ASAR, ASAR_PATH);
  fs.copyFileSync(BACKUP_PLIST, INFO_PLIST);
  console.log('✅ Restored original app.asar and Info.plist from backup.');
}

const arg = process.argv[2];
if (arg === '--install') {
  installPatch();
} else if (arg === '--restore') {
  restorePatch();
} else {
  console.log('Usage:\n  node patch-app.mjs --install\n  node patch-app.mjs --restore');
}
