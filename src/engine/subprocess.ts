/**
 * Safe subprocess execution engine.
 * NEVER construct commands by concatenating untrusted strings.
 * Always use argument arrays and explicit working directories.
 */

import { execa, type ExecaError } from 'execa';
import { logger } from '../core/logger.js';
import { SubprocessError } from '../core/errors.js';

export interface RunOptions {
  /** Working directory for the subprocess. Defaults to process.cwd(). */
  cwd?: string;
  /** Environment variables to inject. Merged with a minimal safe env. */
  env?: Record<string, string>;
  /** Timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** If true, do not throw on non-zero exit. */
  allowFailure?: boolean;
  /** If true, pipe stderr to logger.debug instead of capturing. */
  streamStderr?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

/**
 * Run a command safely with an argument array.
 * Throws SubprocessError if the process exits non-zero (unless allowFailure).
 */
export async function run(
  command: string,
  args: string[] = [],
  opts: RunOptions = {},
): Promise<RunResult> {
  const { cwd = process.cwd(), env = {}, timeoutMs = 30000, allowFailure = false } = opts;

  // Validate command (must not be empty or contain shell metacharacters in the program name)
  if (!command || /[;&|`$<>]/.test(command)) {
    throw new SubprocessError(`Unsafe command name: ${command}`);
  }

  const label = `${command} ${args.join(' ')}`.trim();
  logger.debug(`run: ${label}`, { cwd });

  try {
    const result = await execa(command, args, {
      cwd,
      env: { ...process.env, ...env },
      timeout: timeoutMs,
      reject: false, // we handle exit codes ourselves
      all: false,
    });

    const runResult: RunResult = {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
      command: label,
    };

    if (runResult.exitCode !== 0 && !allowFailure) {
      throw new SubprocessError(
        `Command failed (exit ${runResult.exitCode}): ${label}\n${runResult.stderr}`,
        runResult.stderr,
        runResult.exitCode,
      );
    }

    return runResult;
  } catch (err) {
    if (err instanceof SubprocessError) throw err;
    const execaErr = err as ExecaError;
    if (execaErr.timedOut) {
      throw new SubprocessError(`Command timed out after ${timeoutMs}ms: ${label}`, '', 124);
    }
    if (execaErr.code === 'ENOENT') {
      throw new SubprocessError(`Command not found: ${command}`, '', 127);
    }
    throw new SubprocessError(
      `Command error: ${label}: ${(err as Error).message}`,
      typeof execaErr.stderr === 'string' ? execaErr.stderr : '',
      execaErr.exitCode ?? 1,
    );
  }
}

/**
 * Run a command and return its trimmed stdout, or null on failure.
 * Useful for version checks and simple queries.
 */
export async function queryOutput(
  command: string,
  args: string[] = [],
  opts: RunOptions = {},
): Promise<string | null> {
  try {
    const result = await run(command, args, { ...opts, allowFailure: true });
    if (result.exitCode === 0) return result.stdout.trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a command is available on PATH.
 */
export async function commandExists(command: string): Promise<boolean> {
  const result = await queryOutput('which', [command]);
  return result !== null && result.length > 0;
}

/**
 * Get a version string from a command.
 * Tries --version and -v flags.
 */
export async function getVersion(
  command: string,
  versionFlag = '--version',
): Promise<string | null> {
  const out = await queryOutput(command, [versionFlag], { timeoutMs: 5000 });
  if (!out) return null;
  // Extract the first version-like string (e.g., "2.1.3" or "v2.1.3")
  const match = out.match(/v?(\d+\.\d+[\.\d]*)/);
  return match ? match[0] : out.split('\n')[0].trim();
}
