#!/usr/bin/env node
/**
 * Antigravity 2.0 SessionStart Hook for Primary Theme Plugin
 * Reads the hook payload from stdin, triggers silent CSS injection into open
 * Antigravity 2.0 windows, and returns `{}` on stdout per the Hook Contract.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, '..', 'primary-cli.mjs');

async function main() {
  // Drain stdin so the parent hook runner never gets EPIPE
  try {
    for await (const _chunk of process.stdin) {
      // consume input
    }
  } catch {
    // ignore stdin errors
  }

  // Spawn `primary-cli.mjs apply` detached & silent so stdout stays strictly JSON `{}`
  try {
    const child = spawn(process.execPath, [cliPath, 'apply'], {
      cwd: path.resolve(__dirname, '..'),
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // ignore spawn errors so session start never fails
  }

  process.stdout.write('{}\n');
}

main();
