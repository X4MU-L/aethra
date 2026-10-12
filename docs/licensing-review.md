# Licensing and Distribution Review

This document records the licensing posture, third-party dependency analysis, and distribution implications for Aethra Solutions Client Engineering Workbench.

## 1. Upstream Dependency Analysis: `agentation-mcp`

### Package Details
- **Dependency:** `agentation-mcp@1.3.2`
- **Declared License:** `PolyForm-Shield-1.0.0`
- **Copyright Holder:** Copyright (c) 2026 Benji Taylor

### License Terms: PolyForm Shield 1.0.0
`PolyForm-Shield-1.0.0` is a **source-available license**, *not* an OSI-approved open source license (such as MIT or Apache-2.0). 

Key provisions:
1. **Permitted Use:** Anyone is permitted to run, modify, and distribute the software for internal developer workflows and client tooling that do not compete with the original project.
2. **Non-Compete Restriction ("Shield"):** You may not use the software to provide a competing product or service whose primary purpose competes with software or services offered by the licensor.
3. **Patent & Sublicensing:** No broad patent grant or unrestricted sublicensing rights are granted.

### Commercial Distribution Implications for Aethra
1. **Internal Client Delivery vs. Public SaaS/Distribution:**
   - Using Aethra internally within client engagements to audit, plan, and verify work is compliant with PolyForm Shield terms so long as Aethra is not packaged and sold as a direct commercial competitor to the Agentation annotation platform.
   - If Aethra is distributed publicly as a commercial product or multi-tenant SaaS offering featuring visual feedback toolbars, the licensor's non-compete perimeter applies.
2. **Mitigation & Clean Boundaries:**
   - Visual feedback is abstracted through `VisualFeedbackProvider`.
   - The `manual` feedback provider has zero external dependencies and is licensed under Aethra's native license.
   - Future alternative visual feedback providers (e.g. Chrome DevTools MCP, open-source DOM annotation toolbars under MIT) can be registered without architectural redesign.

---

## 2. Integration Provenance & Attributions

### Anatomy Integration
- **Upstream Repository:** `https://github.com/wheresryan22/anatomy`
- **Author:** Ryan (wheresryan22)
- **License:** MIT
- **Pinned Commit:** `834db9e31d4e0cf5c2a0bf20dc8e75db347f7d98`
- **Attribution Status:** Attribution notice maintained in `integrations/anatomy/source.yaml` and `templates/skills/technical-illustration-anatomy.md`.
- **Usage Scope:** Restricted to mechanism-based technical explainers. Standard diagrams (ER, sequence, architecture graphs) use Mermaid or D2.

### pstack Principles
- **Source:** Lauren Tan (poteto) / `pstack`
- **License:** MIT
- **Attribution Status:** Preserved in core engineering principle documentation.

---

## 3. Package Distribution Status

### `package.json` Configuration
- `package.json` targets scoped GitHub Packages publication:
  ```json
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
  ```
- Public npmjs.org global installation (`npm install -g aethra`) is not currently published; development instructions use local linking or GitHub Packages authentication:
  ```bash
  # Local linking for development:
  npm link
  # Or run via local binary:
  ./dist/cli/index.js <command>
  ```
- Because `agentation-mcp` is currently listed under `dependencies`, package distribution carries the PolyForm Shield 1.0.0 perimeter. Prior to public un-scoped commercial release, `agentation-mcp` should be moved to `optionalDependencies` or extracted into an independent plugin adapter.
