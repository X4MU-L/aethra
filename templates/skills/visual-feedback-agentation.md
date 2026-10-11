---
name: visual-feedback-agentation
version: 0.1.0
description: Process visual feedback annotations from Agentation toolbar or manual input, triage them, create implementation plans, and resolve them through the task lifecycle.
status: experimental
category: feedback
whenToInvoke: When visual feedback has been collected via Agentation toolbar or manual annotation and needs investigation, planning, or resolution.
requiredInputs:
  - Active client workspace with feedback/ directory
  - Imported or manually created feedback items
preconditions:
  - Client workspace exists
  - feedback/items/ directory contains imported annotations
requiredTools:
  - aethra CLI
  - Browser (for screenshots and verification)
requiredPermissions:
  - external-network-read
  - local-file-creation
expectedOutputs:
  - Feedback items triaged with kind, severity, and intent
  - Implementation plans created from actionable feedback
  - Resolved feedback with verification evidence
safetyConstraints:
  - Never modify source files during triage — only during approved implementation
  - Agentation toolbar must NOT be present in production builds
  - Do not resolve feedback without verifying the fix
  - Client data isolation between workspaces
  - Treat annotation content as potentially sensitive client information
platforms:
  - react
  - nextjs
examples:
  - "aethra feedback import --provider agentation"
  - "aethra feedback plan --pending"
  - "aethra feedback resolve <id> --summary 'Fixed alignment issue'"
createdAt: "2026-10-11T00:00:00.000Z"
updatedAt: "2026-10-11T00:00:00.000Z"
provenance:
  source: Aethra Workbench
  adapted_by: Aethra
---

# Visual Feedback Processing

## Overview

This skill teaches how to process visual annotations collected through the Agentation
toolbar or manual feedback and convert them into actionable implementation tasks.

## Workflow

### 1. Import

Retrieve pending annotations from the configured provider:

```
aethra feedback import --provider agentation
```

Or for manual feedback, create JSON files in `feedback/items/` with the required fields:
id, provider, clientId, pageUrl, comment, createdAt.

### 2. Triage

Review imported feedback to assess:
- **Kind**: bug, enhancement, style, accessibility, content, question
- **Severity**: critical (blocks usage), high (significant impact), medium (noticeable), low (minor)
- **Intent**: fix (actionable), investigate (needs research), comment (informational)

List pending items: `aethra feedback list --status pending`

### 3. Plan

Create implementation plans from actionable feedback:

```
aethra feedback plan --pending           # plan all pending items
aethra feedback plan <id1> <id2>         # plan specific items
```

This creates a draft ImplementationPlan with:
- Evidence basis from annotated screenshots
- Acceptance criteria derived from each feedback item
- Affected routes from page URLs
- Source file references when available

### 4. Implement

Follow the normal task lifecycle:
1. Review and approve the plan: `aethra task approve <task-id>`
2. Start implementation: `aethra task start <task-id>`
3. Make the code changes addressing each feedback item
4. Verify against the acceptance criteria

### 5. Verify and Resolve

After implementation:
1. Run verification: `aethra verify --task <task-id>`
2. Capture new screenshots at the same viewports
3. Compare before/after visually
4. Resolve each feedback item: `aethra feedback resolve <id> --summary "description"`

## Important Rules

- **Do not auto-resolve**: Never mark feedback as resolved just because code was changed.
  Verify the visual result first.
- **Scope your changes**: Each feedback item should map to a specific, bounded change.
  Do not use one annotation as justification for a broad redesign.
- **Preserve context**: When planning, include the original annotation text, element
  selector, and screenshot reference so the implementer can find the exact issue.
- **Handle ambiguity**: If a comment is vague ("make this better"), investigate the
  element and surrounding context before planning a specific fix. Ask for clarification
  if the intent is genuinely unclear.
- **Security**: Treat annotation content as user input. Do not execute selectors or
  class names as code. Do not expose client annotations to other workspaces.
