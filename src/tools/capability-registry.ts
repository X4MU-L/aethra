/**
 * Capability registry.
 * Describes what tools and capabilities are available to Aethra,
 * their prerequisites, and availability status.
 */

import type {
  CapabilityEntry,
  CapabilityStatus,
  TaskClassification,
  PlatformType,
  WorkflowStage,
} from "../core/schemas.js";

export interface CapabilityRegistryEntry extends CapabilityEntry {
  availabilityCheck: () => Promise<CapabilityStatus>;
}

const CAPABILITY_REGISTRY: CapabilityRegistryEntry[] = [
  {
    id: "browser-screenshot",
    name: "Browser Screenshot Capture",
    category: "screenshot-capture",
    description:
      "Capture full-page screenshots at multiple viewports using Playwright",
    applicableTasks: [
      "direct-fix",
      "design-exploration",
      "conventional-engineering",
    ],
    workflowStages: ["investigate", "verify"],
    prerequisites: ["playwright"],
    costClass: "local-compute",
    status: "available",
    async availabilityCheck() {
      try {
        await import("playwright");
        return "available";
      } catch {
        return "requires-setup";
      }
    },
  },
  {
    id: "lighthouse-audit",
    name: "Lighthouse Performance Audit",
    category: "performance-testing",
    description:
      "Run Lighthouse performance, accessibility, SEO, and best practices audits",
    applicableTasks: [
      "direct-fix",
      "design-exploration",
      "conventional-engineering",
    ],
    workflowStages: ["investigate", "verify"],
    prerequisites: ["lighthouse CLI"],
    costClass: "local-compute",
    status: "available",
    async availabilityCheck() {
      const { commandExists } = await import("../engine/subprocess.js");
      return (await commandExists("lighthouse"))
        ? "available"
        : "requires-setup";
    },
  },
  {
    id: "visual-annotation",
    name: "Visual Annotation (Agentation)",
    category: "visual-annotation",
    description:
      "Collect visual feedback annotations through the Agentation toolbar",
    applicableTasks: ["direct-fix", "design-exploration"],
    supportedPlatforms: ["react", "nextjs"],
    workflowStages: ["investigate", "verify"],
    prerequisites: ["agentation server"],
    costClass: "free",
    status: "available",
    async availabilityCheck() {
      const { getProvider } =
        await import("../visual-feedback/providers/registry.js");
      const provider = getProvider("agentation");
      if (!provider) return "unavailable";
      const status = await provider.checkAvailability();
      return status.available && status.connected
        ? "available"
        : "requires-setup";
    },
  },
  {
    id: "visual-critique",
    name: "Design Visual Critique",
    category: "design-evaluation",
    description:
      "Independent visual evaluation of rendered UI against design brief",
    applicableTasks: ["design-exploration"],
    workflowStages: ["verify"],
    prerequisites: [],
    costClass: "model-call",
    status: "degraded",
    async availabilityCheck() {
      return "degraded"; // Stub: generates prompts but returns pending results
    },
  },
  {
    id: "code-analysis",
    name: "Code Analysis",
    category: "code-analysis",
    description: "Read and analyze source code files",
    applicableTasks: [
      "direct-fix",
      "design-exploration",
      "technical-illustration",
      "conventional-engineering",
    ],
    workflowStages: ["investigate", "plan", "implement", "verify"],
    prerequisites: [],
    costClass: "free",
    status: "available",
    async availabilityCheck() {
      return "available";
    },
  },
  {
    id: "test-runner",
    name: "Test Suite Runner",
    category: "testing",
    description: "Run vitest test suites and parse results",
    applicableTasks: ["direct-fix", "conventional-engineering"],
    workflowStages: ["verify"],
    prerequisites: ["vitest"],
    costClass: "local-compute",
    status: "available",
    async availabilityCheck() {
      const { commandExists } = await import("../engine/subprocess.js");
      return (await commandExists("npx")) ? "available" : "requires-setup";
    },
  },
  {
    id: "git-operations",
    name: "Git Operations",
    category: "code-analysis",
    description: "Git status checks, branch creation, and safe operations",
    applicableTasks: [
      "direct-fix",
      "design-exploration",
      "conventional-engineering",
    ],
    workflowStages: ["plan", "implement", "verify"],
    prerequisites: ["git"],
    costClass: "free",
    status: "available",
    async availabilityCheck() {
      const { commandExists } = await import("../engine/subprocess.js");
      return (await commandExists("git")) ? "available" : "unavailable";
    },
  },
  {
    id: "design-direction-planning",
    name: "Design Direction Planning",
    category: "design-evaluation",
    description:
      "Generate diverse design directions using SSoT-inspired axis variation",
    applicableTasks: ["design-exploration"],
    workflowStages: ["plan"],
    prerequisites: [],
    costClass: "free",
    status: "available",
    async availabilityCheck() {
      return "available";
    },
  },
];

export function getCapability(id: string): CapabilityRegistryEntry | undefined {
  return CAPABILITY_REGISTRY.find((c) => c.id === id);
}

export function getCapabilitiesForTask(
  classification: TaskClassification,
  platform?: PlatformType,
): CapabilityRegistryEntry[] {
  return CAPABILITY_REGISTRY.filter((c) => {
    if (!c.applicableTasks.includes(classification)) return false;
    if (
      platform &&
      c.supportedPlatforms &&
      !c.supportedPlatforms.includes(platform)
    )
      return false;
    return true;
  });
}

export function getCapabilitiesForStage(
  stage: WorkflowStage,
): CapabilityRegistryEntry[] {
  return CAPABILITY_REGISTRY.filter((c) => c.workflowStages.includes(stage));
}

export async function checkCapabilityAvailability(
  id: string,
): Promise<{ id: string; status: CapabilityStatus; message?: string }> {
  const entry = getCapability(id);
  if (!entry)
    return { id, status: "unavailable", message: `Unknown capability: ${id}` };

  if (entry.id === "visual-annotation") {
    const { getProvider } =
      await import("../visual-feedback/providers/registry.js");
    const provider = getProvider("agentation");
    if (!provider) {
      return {
        id,
        status: "unavailable",
        message: "Agentation provider not registered",
      };
    }
    const provStatus = await provider.checkAvailability();
    if (!provStatus.available) {
      return {
        id,
        status: "requires-setup",
        message:
          provStatus.error ??
          "agentation-mcp package is not installed. Run: npm install agentation-mcp",
      };
    }
    if (!provStatus.connected) {
      return {
        id,
        status: "requires-setup",
        message:
          provStatus.error ??
          "Agentation server not running. Start with: aethra feedback watch --provider agentation",
      };
    }
    return { id, status: "available" };
  }

  const status = await entry.availabilityCheck();
  return { id, status };
}

export async function checkAllCapabilities(): Promise<
  Array<{ id: string; name: string; status: CapabilityStatus }>
> {
  const results = await Promise.all(
    CAPABILITY_REGISTRY.map(async (entry) => ({
      id: entry.id,
      name: entry.name,
      status: await entry.availabilityCheck(),
    })),
  );
  return results;
}

export function listCapabilities(): CapabilityRegistryEntry[] {
  return [...CAPABILITY_REGISTRY];
}
