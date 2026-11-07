---
name: primary-theme
description: Manage, apply, hot-reload, customize, or remove the Primary Theme (Obsidian Port by Cecilia May) in Google Antigravity 2.0. Activate when the user asks to apply/enable/disable Primary Theme, toggle automatic startup injection, copy the DevTools snippet, or tweak Primary Theme CSS modules.
---

# Primary Theme for Antigravity 2.0

This skill manages the **Primary Theme** port for **Google Antigravity 2.0** (adapted from Cecilia May's [`primary-theme/obsidian`](https://github.com/primary-theme/obsidian) under GPL-3.0).

## Directory Layout

Relative to this skill's plugin root (`../..`):
- `src/01-palettes.css` — Light & Dark warm nostalgia palettes (`--color-l-*`, `--color-d-*`) and Antigravity 2.0 Onyx variable overrides
- `src/02-typography-markdown.css` — Bauhaus semantic emphasis (`strong` red, `em` blue, `a` yellow, `h1-h6` hierarchy, blockquotes, lists, checklists)
- `src/03-tactile-components.css` — 3D toy keycap buttons, composer frame, round action buttons, toggle switches, and borderless 3D `:focus-visible` lift
- `src/04-code-syntax.css` — Fenced code blocks, inline code pills, `<kbd>` keycaps, and 19 Prism `--syntax-*` tokens
- `src/05-callouts-tables.css` — GitHub alerts / callout cards and striped markdown tables
- `src/06-sidebar-animations.css` — 6-color Bauhaus rainbow sidebar cycle, seamless hover action masking, and spring popup animations
- `build.mjs` — Compiles `src/*.css` into `dist/primary-antigravity.css`, `dist/devtools-inject.js`, and `dist/theme-seeds.json`
- `primary-cli.mjs` — Zero-dependency live injector, hot-reload watcher, clipboard exporter, and macOS LaunchAgent manager

## Common Operations

Resolve `<PLUGIN_ROOT>` as the parent directory two levels up from `skills/primary-theme/SKILL.md`:

| User Intent | Command |
| :--- | :--- |
| **Apply / refresh theme immediately** | `node "<PLUGIN_ROOT>/primary-cli.mjs" apply` |
| **Remove theme from running windows** | `node "<PLUGIN_ROOT>/primary-cli.mjs" remove` |
| **Copy DevTools one-paste snippet to clipboard** | `node "<PLUGIN_ROOT>/primary-cli.mjs" copy` |
| **Enable macOS background auto-injection on launch** | `node "<PLUGIN_ROOT>/primary-cli.mjs" autostart` |
| **Disable macOS background auto-injection** | `node "<PLUGIN_ROOT>/primary-cli.mjs" unautostart` |
| **Rebuild CSS after editing `src/*.css`** | `node "<PLUGIN_ROOT>/build.mjs" && node "<PLUGIN_ROOT>/primary-cli.mjs" apply` |
