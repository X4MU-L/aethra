/**
 * Test suite execution engine.
 *
 * Runs vitest against a directory or file pattern and returns structured
 * pass/fail results. Captures the human-readable stdout summary and parses
 * pass/fail counts from it. Exit code is the authoritative pass/fail signal.
 *
 * Safe: uses run() with arg arrays — no shell string concatenation.
 */

import path from 'path';
import { run } from './subprocess.js';
import { pathExists } from './fs.js';
import { logger } from '../core/logger.js';

// ─── Output types ────────────────────────────────────────────────────────────

export interface TestCaseResult {
  title: string;
  fullName: string;
  status: 'passed' | 'failed' | 'skipped' | 'todo';
  duration?: number;
  failureMessages: string[];
}

export interface TestFileResult {
  file: string;
  status: 'passed' | 'failed' | 'skipped';
  cases: TestCaseResult[];
}

export interface TestRunResult {
  command: string;
  workingDir: string;
  exitCode: number;
  passed: boolean;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  duration: number;
  files: TestFileResult[];
  rawOutput: string;
  parseError?: string;
}

// ─── Binary resolution ────────────────────────────────────────────────────────

/**
 * Walk up from `startDir` looking for the first `node_modules/.bin/vitest`.
 * Returns the absolute path or null if not found.
 */
async function resolveVitestBin(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'vitest');
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── Summary line parsing ────────────────────────────────────────────────────

/**
 * Parse vitest's human-readable summary output.
 *
 * Vitest summary format (v2):
 *   " Test Files  1 failed (1)"
 *   "      Tests  3 failed | 4 passed (7)"
 *   "   Duration  1.23s"
 *
 * Note: summary goes to stderr in vitest v2 when stdin is not a TTY.
 */
function parseSummary(output: string): { passedCount: number; failedCount: number; skippedCount: number; duration: number } {
  let passedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let duration = 0;

  // "Tests  3 failed | 4 passed (7)"  or  "Tests  7 passed (7)"
  const testsLine = output.match(/Tests\s+(?:(\d+)\s+failed\s*\|?\s*)?(?:(\d+)\s+skipped\s*\|?\s*)?(\d+)\s+passed/);
  if (testsLine) {
    if (testsLine[1]) failedCount = parseInt(testsLine[1], 10);
    if (testsLine[2]) skippedCount = parseInt(testsLine[2], 10);
    if (testsLine[3]) passedCount = parseInt(testsLine[3], 10);
  } else {
    // All tests failed — only the "failed" count appears
    const failedOnly = output.match(/Tests\s+(\d+)\s+failed/);
    if (failedOnly) failedCount = parseInt(failedOnly[1], 10);
  }

  // "Duration  1.23s" or "Duration  345ms"
  const durationLine = output.match(/Duration\s+([\d.]+)(ms|s)/);
  if (durationLine) {
    duration = durationLine[2] === 's'
      ? Math.round(parseFloat(durationLine[1]) * 1000)
      : parseInt(durationLine[1], 10);
  }

  return { passedCount, failedCount, skippedCount, duration };
}

// ─── Core runner ─────────────────────────────────────────────────────────────

export interface RunTestsOptions {
  /**
   * Override working directory. Defaults to the `cwd` argument of runTestSuite.
   */
  cwd?: string;
  /**
   * Specific test file pattern(s) to run. Passed as positional args to vitest.
   * When provided, `--config /dev/null` is used to bypass the project's
   * exclude rules, so the patterns are evaluated unfiltered.
   */
  include?: string[];
  /**
   * Timeout for the entire test run in milliseconds. Defaults to 60 000.
   */
  timeoutMs?: number;
}

/**
 * Run a test suite and return structured results.
 *
 * Uses vitest's default (human-readable) reporter so output is always
 * available in stdout/stderr regardless of the execution context.
 * Pass/fail counts are parsed from the summary line; exit code is authoritative.
 */
export async function runTestSuite(
  cwd: string,
  opts: RunTestsOptions = {},
): Promise<TestRunResult> {
  const { include, timeoutMs = 60_000 } = opts;
  const workDir = opts.cwd ?? cwd;

  const vitestBin = await resolveVitestBin(workDir);
  if (!vitestBin) {
    return {
      command: 'vitest (not found)',
      workingDir: workDir,
      exitCode: 127,
      passed: false,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      duration: 0,
      files: [],
      rawOutput: '',
      parseError: 'vitest binary not found — no node_modules/.bin/vitest up the directory tree',
    };
  }

  const args: string[] = ['run'];

  if (include && include.length > 0) {
    // Bypass the project's vitest config (which may have exclude rules) so
    // the caller-supplied patterns are evaluated without filtering.
    args.push('--config', '/dev/null');
    // Patterns are positional arguments in vitest v2 (no --include flag)
    args.push(...include);
  }

  logger.debug(`testrunner: ${vitestBin} ${args.join(' ')}`, { cwd: workDir });

  const result = await run(vitestBin, args, {
    cwd: workDir,
    allowFailure: true,
    timeoutMs,
    // Disable colour so regexes work reliably on the summary text
    env: { FORCE_COLOR: '0', NO_COLOR: '1' },
  });

  // Vitest sends the reporter summary to stdout; some messages go to stderr.
  // Combine both for robust parsing.
  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');

  const { passedCount, failedCount, skippedCount, duration } = parseSummary(rawOutput);

  return {
    command: result.command,
    workingDir: workDir,
    exitCode: result.exitCode,
    passed: result.exitCode === 0,
    passedCount,
    failedCount,
    skippedCount,
    duration,
    files: [],   // detailed per-file breakdown requires JSON reporter — add in future
    rawOutput,
  };
}
