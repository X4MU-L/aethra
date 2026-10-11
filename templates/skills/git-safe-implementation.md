---
name: git-safe-implementation
version: 0.1.0
description: Safely implement code changes in a git repository. Use when about to modify source files, apply a plan, or commit changes. Ensures Git state is inspected first and a feature branch is used.
status: approved
category: implementation
whenToInvoke: Before making any code changes in a client repository. Use to inspect Git state, create a feature branch, and verify changes before committing.
requiredInputs:
  - approved implementation plan (from `aethra plan-fix`)
  - repository path (configured in client.yaml)
preconditions:
  - Plan status must be "approved" (not "draft")
  - Repository access confirmed
  - Git is available
  - No conflicting uncommitted changes in target files
requiredTools:
  - git
  - aethra CLI
requiredPermissions:
  - local-source-modification
  - git-branch-creation
expectedOutputs:
  - Feature branch created
  - Changes implemented per plan
  - Tests run and passing
safetyConstraints:
  - NEVER commit or push without explicit approval
  - NEVER modify files outside the agreed scope
  - NEVER discard uncommitted changes without saving them
  - NEVER apply a draft plan — only "approved" plans
  - NEVER force-push or reset --hard without explicit instruction
examples:
  - aethra apply-fix plans/mobile-booking-journey.json
  - aethra apply-fix plans/mobile-booking-journey.md --dry-run
createdAt: "2024-01-01T00:00:00.000Z"
updatedAt: "2024-01-01T00:00:00.000Z"
---

# Git-Safe Implementation

## Overview

A safety protocol for implementing code changes in client repositories.
Ensures Git state is clean, changes are scoped to a feature branch, and
no unintended modifications are made.

## Pre-implementation checklist

Before writing any code:

1. **Confirm plan is approved**
   ```bash
   # Check plan status in the JSON file
   cat plans/<plan-id>.json | grep '"status"'
   # Must show "approved"
   ```

2. **Check Git status**
   ```bash
   git status
   git branch
   ```
   - Note any uncommitted changes (DO NOT discard them)
   - Note the current branch

3. **Confirm plan is not stale**
   - Was the plan created before recent relevant commits?
   - Do the proposed changes still apply to current code?
   - Have any acceptance criteria changed?

## Implementation steps

### 1. Create feature branch

```bash
git checkout -b aethra/<plan-id-prefix>-<task-slug>
```

Example:
```bash
git checkout -b aethra/a1b2c3d4-mobile-booking-journey
```

### 2. Implement the minimum change

Follow the plan's `proposedChanges` section precisely.
- Implement only what is specified
- Do not refactor unrelated code
- Do not add features not in the plan

### 3. Run existing tests

```bash
npm test   # or the project-specific test command
```

Document which tests pass, fail, or are skipped.

### 4. Visual verification

```bash
# Take fresh screenshots for comparison
aethra audit --refresh --no-lighthouse
```

### 5. Review the diff

```bash
git diff
```

Verify:
- Only intended files are changed
- No credentials, API keys, or secrets in the diff
- No debug code or console.log left in

### 6. Do NOT commit without approval

Implementation is complete when the diff is reviewed and approved by the engineer.

```bash
# ONLY commit when explicitly instructed to do so
git add <specific-files>
git commit -m "feat: <description>

Implements plan <plan-id>
Addresses: <task description>"
```

## After implementation

```bash
aethra verify plans/<plan-id>.json
```

## Rollback

If something goes wrong:
```bash
git checkout main  # or the original branch
# The feature branch is preserved for review
```

## Important notes

- NEVER use `git reset --hard` unless explicitly instructed
- NEVER `git stash pop` over existing stashed work without checking
- NEVER commit node_modules, .env files, or auth state
- If uncertain about scope, stop and ask before proceeding
