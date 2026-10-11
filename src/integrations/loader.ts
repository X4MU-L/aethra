/**
 * Integration metadata loader.
 * Reads and validates integration source.yaml files from the integrations/ directory.
 * Failures warn but never crash — integration metadata is supplementary.
 */

import path from "path";
import yaml from "js-yaml";
import { readFile } from "fs/promises";
import { pathExists } from "../engine/fs.js";
import { IntegrationMetadataSchema } from "../core/schemas.js";
import type {
  IntegrationMetadata,
  IntegrationStatus,
} from "../core/schemas.js";
import { logger } from "../core/logger.js";

export interface LoadedIntegration {
  name: string;
  dirPath: string;
  metadata: IntegrationMetadata;
  raw: Record<string, unknown>;
  status: IntegrationStatus;
}

export interface IntegrationLoadResult {
  integrations: LoadedIntegration[];
  errors: Array<{ name: string; error: string }>;
}

/** Load a single integration from its directory. Returns null on failure. */
export async function loadIntegration(
  dirPath: string,
): Promise<LoadedIntegration | null> {
  const sourceFile = path.join(dirPath, "source.yaml");
  if (!(await pathExists(sourceFile))) return null;

  try {
    const content = await readFile(sourceFile, "utf-8");
    const raw = yaml.load(content) as Record<string, unknown>;

    const parseResult = IntegrationMetadataSchema.safeParse(raw);
    if (!parseResult.success) {
      logger.warn(
        `Integration validation failed for ${dirPath}: ${parseResult.error.message}`,
      );
      return null;
    }

    const metadata = parseResult.data;
    const status = deriveStatus(metadata, raw);

    return {
      name: metadata.source.name,
      dirPath,
      metadata,
      raw,
      status,
    };
  } catch (err) {
    logger.warn(
      `Failed to load integration from ${dirPath}: ${(err as Error).message}`,
    );
    return null;
  }
}

/** Load all integrations from the integrations directory. */
export async function loadAllIntegrations(
  integrationsDir?: string,
): Promise<IntegrationLoadResult> {
  const dir =
    integrationsDir ?? path.resolve(import.meta.dirname, "../../integrations");

  if (!(await pathExists(dir))) {
    return { integrations: [], errors: [] };
  }

  const { readdir } = await import("fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const integrations: LoadedIntegration[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = path.join(dir, entry.name);
    try {
      const loaded = await loadIntegration(dirPath);
      if (loaded) {
        integrations.push(loaded);
      } else {
        // Check if source.yaml exists but failed validation
        if (await pathExists(path.join(dirPath, "source.yaml"))) {
          errors.push({
            name: entry.name,
            error: `Failed to validate source.yaml in ${dirPath}`,
          });
        }
      }
    } catch (err) {
      errors.push({ name: entry.name, error: (err as Error).message });
    }
  }

  return { integrations, errors };
}

/** Get the status of a named integration from load results. */
export function getIntegrationStatus(
  name: string,
  result: IntegrationLoadResult,
): IntegrationStatus | undefined {
  return result.integrations.find((i) => i.name === name)?.status;
}

/** Derive integration status from metadata and raw YAML. */
function deriveStatus(
  metadata: IntegrationMetadata,
  raw: Record<string, unknown>,
): IntegrationStatus {
  // Prefer explicit classification.status if present
  if (metadata.classification?.status) {
    return metadata.classification.status;
  }

  // Pstack-style: infer from classifications.adopted array
  const classifications = raw.classifications as
    | Record<string, unknown>
    | undefined;
  if (classifications && Array.isArray(classifications.adopted)) {
    return "implemented";
  }

  return "planned";
}
