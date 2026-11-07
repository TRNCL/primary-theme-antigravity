#!/usr/bin/env node
/**
 * Build script for Primary Theme for Antigravity 2.0
 * Concatenates modular CSS files in src/ into:
 *   - dist/primary-antigravity.css (Full CSS bundle)
 *   - dist/devtools-inject.js      (One-paste DevTools console snippet)
 *   - dist/theme-seeds.json        (Native Antigravity 2.0 Theme Seeds & Syntax tokens)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');

const MODULES = [
  '01-palettes.css',
  '02-typography-markdown.css',
  '03-tactile-components.css',
  '04-code-syntax.css',
  '05-callouts-tables.css',
  '06-sidebar-animations.css',
];

export function buildTheme({ silent = false } = {}) {
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const banner = [
    '/*!',
    ' * ═══════════════════════════════════════════════════════════════════════════',
    ' * PRIMARY THEME FOR ANTIGRAVITY 2.0 (Plan C — Full CSS + Tactile UI Port)',
    ' * Original Obsidian Theme by Cecilia May (https://github.com/primary-theme/obsidian)',
    ' * Preset: Bauhaus Red (Light #BF3F36) / Bauhaus Yellow (Dark #F4B943)',
    ' * Rainbow Sidebar: Enabled (6-Color Bauhaus Cycle)',
    ` * Built: ${new Date().toISOString()}`,
    ' * ═══════════════════════════════════════════════════════════════════════════',
    ' */',
    '',
  ].join('\n');

  const chunks = [banner];

  for (const file of MODULES) {
    const filePath = path.join(SRC_DIR, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing source CSS module: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    chunks.push(content.trim(), '');
  }

  const fullCss = chunks.join('\n');
  const outCssPath = path.join(DIST_DIR, 'primary-antigravity.css');
  fs.writeFileSync(outCssPath, fullCss, 'utf8');

  // Also emit a self-contained DevTools snippet for manual paste fallback
  const devtoolsSnippet = `(() => {
  const STYLE_ID = 'primary-obsidian-theme';
  const css = ${JSON.stringify(fullCss)};
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
  if (document.body) {
    document.body.setAttribute('data-agy-font', 'inter');
  }
  console.log('%c[Primary Theme] Applied successfully (' + css.length + ' bytes)', 'color:#BF3F36;font-weight:bold;');
})();\n`;

  const outJsPath = path.join(DIST_DIR, 'devtools-inject.js');
  fs.writeFileSync(outJsPath, devtoolsSnippet, 'utf8');

  // Also emit native theme seeds JSON for reference / custom theme configuration
  const themeSeeds = {
    themes: [
      {
        id: 'primary-bauhaus-light',
        label: 'Primary Bauhaus (Light)',
        mode: 'light',
        seeds: {
          background: '#F8F5F1',
          foreground: '#593E22',
          primary: '#BF3F36',
          primaryForeground: '#FAF8F5',
          codeForeground: '#402B15',
        },
        syntax: {
          comment: '#BEB1A1',
          punctuation: '#775939',
          property: '#4B82BC',
          deleted: '#BF3F36',
          inserted: '#309359',
          tag: '#BF3F36',
          constant: '#E15826',
          number: '#E15826',
          string: '#DE981D',
          attrName: '#E15826',
          builtin: '#309359',
          operator: '#BF3F36',
          variable: '#593E22',
          attrValue: '#DE981D',
          keyword: '#BF3F36',
          function: '#9163CC',
          className: '#309359',
          regex: '#3D848F',
        },
      },
      {
        id: 'primary-bauhaus-dark',
        label: 'Primary Bauhaus (Dark)',
        mode: 'dark',
        seeds: {
          background: '#2E261F',
          foreground: '#D7C0A3',
          primary: '#F4B943',
          primaryForeground: '#191410',
          codeForeground: '#E4CEB2',
        },
        syntax: {
          comment: '#584B3E',
          punctuation: '#B79C7A',
          property: '#6BA7DD',
          deleted: '#EA655D',
          inserted: '#4EB779',
          tag: '#EA655D',
          constant: '#EF8453',
          number: '#EF8453',
          string: '#F4B943',
          attrName: '#EF8453',
          builtin: '#4EB779',
          operator: '#EA655D',
          variable: '#D7C0A3',
          attrValue: '#F4B943',
          keyword: '#EA655D',
          function: '#AD86DF',
          className: '#4EB779',
          regex: '#60AFB7',
        },
      },
    ],
  };

  const outSeedsPath = path.join(DIST_DIR, 'theme-seeds.json');
  fs.writeFileSync(outSeedsPath, JSON.stringify(themeSeeds, null, 2) + '\n', 'utf8');

  if (!silent) {
    const lines = fullCss.split('\n').length;
    const kb = (Buffer.byteLength(fullCss, 'utf8') / 1024).toFixed(1);
    console.log(`✔ Built ${outCssPath} (${lines} lines, ${kb} KB)`);
    console.log(`✔ Built ${outJsPath}`);
    console.log(`✔ Built ${outSeedsPath}`);
  }

  return { fullCss, outCssPath, outJsPath, outSeedsPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildTheme();
}
