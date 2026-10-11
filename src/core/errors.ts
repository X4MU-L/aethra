/**
 * Typed error classes for structured error handling throughout the CLI.
 */

export class AethraError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode: number = 1,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AethraError';
  }
}

export class ConfigError extends AethraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', 1, details);
    this.name = 'ConfigError';
  }
}

export class WorkspaceError extends AethraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'WORKSPACE_ERROR', 1, details);
    this.name = 'WorkspaceError';
  }
}

export class AuditError extends AethraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'AUDIT_ERROR', 1, details);
    this.name = 'AuditError';
  }
}

export class PlatformError extends AethraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PLATFORM_ERROR', 1, details);
    this.name = 'PlatformError';
  }
}

export class SubprocessError extends AethraError {
  constructor(
    message: string,
    public readonly stderr: string = '',
    public readonly exitCode: number = 1,
  ) {
    super(message, 'SUBPROCESS_ERROR', 1, { stderr });
    this.name = 'SubprocessError';
  }
}

export class ValidationError extends AethraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 1, details);
    this.name = 'ValidationError';
  }
}

export class PermissionError extends AethraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PERMISSION_ERROR', 1, details);
    this.name = 'PermissionError';
  }
}

export function isAethraError(err: unknown): err is AethraError {
  return err instanceof AethraError;
}

export function toAethraError(err: unknown): AethraError {
  if (isAethraError(err)) return err;
  if (err instanceof Error) {
    return new AethraError(err.message, 'UNKNOWN_ERROR', 1);
  }
  return new AethraError(String(err), 'UNKNOWN_ERROR', 1);
}
