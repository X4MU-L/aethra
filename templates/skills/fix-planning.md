---
name: fix-planning
version: 0.1.0
description: Create an evidence-backed implementation plan for a task. Use when asked to plan a fix, improvement, or new feature. Investigates the issue, identifies root cause, and produces a reviewable plan.
status: approved
category: planning
whenToInvoke: When asked to plan a fix, improvement, or feature. Must be used BEFORE any source code modifications.
requiredInputs:
  - task description (clear statement of what needs to change)
  - active client workspace with baseline audit evidence
preconditions:
  - Baseline audit exists (run `aethra audit` first)
  - Client workspace is configured
  - Evidence directory has screenshots and inspection data
requiredTools:
  - aethra CLI
requiredPermissions:
  - local-file-creation
  - external-network-read (for fresh evidence if needed)
expectedOutputs:
  - plans/<task-slug>-<plan-id>.md
  - plans/<task-slug>-<plan-id>.json
safetyConstraints:
  - Planning MUST NOT modify any source files
  - Plans must reference actual evidence, not assumptions
  - Root cause confidence must be stated honestly
  - Plans must await human approval before apply-fix
examples:
  - aethra plan-fix "Improve the mobile booking journey"
  - aethra plan-fix "Fix broken contact form on mobile" --refresh-audit
createdAt: "2024-01-01T00:00:00.000Z"
updatedAt: "2024-01-01T00:00:00.000Z"
---

# Fix Planning

## Overview

Create a structured, evidence-backed implementation plan before any code changes.
Plans must be reviewed and approved before `apply-fix` will execute them.

## Steps

### 1. Understand the task

Clarify the task. A good task statement:
- Describes the desired outcome, not just the symptom
- Specifies the affected user journey or page
- References any existing evidence (screenshots, audit findings)

### 2. Gather fresh evidence if needed

```bash
aethra audit --refresh --no-lighthouse
```

Review:
- `evidence/screenshots/` — mobile and desktop views
- Latest audit findings for relevant issues

### 3. Investigate the affected code

Based on the task:
- Identify the relevant templates, components, or pages
- Understand the current implementation
- Identify the root cause (be explicit about confidence)

### 4. Generate the plan

```bash
aethra plan-fix "Task description"
```

Then open the generated plan and complete it:
- Fill in `affectedFiles`
- Fill in `affectedRoutes`
- Explain the `rootCause` with supporting evidence
- Set `rootCauseConfidence` honestly (0–1)
- Define specific `proposedChanges`
- Review and refine `acceptanceCriteria`
- List `risks` and `openQuestions`

### 5. Estimate scope

Set `estimatedScope`:
- `trivial` — 1–2 file changes, < 1 hour
- `small` — 2–5 files, 1–4 hours
- `medium` — multiple components, 4–8 hours
- `large` — architectural changes, > 1 day

### 6. Set plan for review

Update plan status from `draft` to `approved` only after:
- Root cause is confirmed
- Proposed changes are specific and complete
- Acceptance criteria are testable
- Risks are identified
- Open questions are resolved or documented

## Evidence referencing

Every claim in the plan should reference evidence:
```
See: evidence/screenshots/mobile-services-page.png — booking CTA not visible above fold
```

## Acceptance criteria format

Good acceptance criteria are:
- Specific and testable (not "works better")
- Linked to a verification method
- Conservative (don't over-promise)

Example:
```
The book now CTA is visible without scrolling at 375px viewport width.
Verify: screenshot comparison at mobile viewport.
```

## After the plan is approved

```bash
aethra apply-fix plans/<task-slug>-<plan-id>.md
```
