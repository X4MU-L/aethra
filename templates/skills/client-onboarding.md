---
name: client-onboarding
version: 0.1.0
description: Onboard a new client from a facts directory. Use when starting work on a new client project or when asked to set up a client workspace.
status: approved
category: onboarding
whenToInvoke: When the user asks to onboard a new client, set up a workspace, or start work on a client project from a facts directory.
requiredInputs:
  - facts directory path (containing brief.md, requirements.md, known-urls.txt)
  - client name or slug (can be derived from facts)
preconditions:
  - Aethra CLI is installed and initialised (run `aethra init` if not)
  - Facts directory exists with at minimum a brief.md
requiredTools:
  - aethra CLI
  - node (>=20)
  - git
requiredPermissions:
  - local-file-creation
  - external-network-read
expectedOutputs:
  - client workspace directory at ~/Aethra/clients/<slug>/
  - client.yaml configuration
  - README.md, CLAUDE.md, AGENTS.md
  - knowledge base files
  - baseline audit evidence (if URL is reachable)
safetyConstraints:
  - Never download production databases without explicit authorisation
  - Never commit or push any changes
  - Never store credentials in workspace files
  - Auth state must only be stored in .local/ (gitignored)
examples:
  - aethra setup-client ~/facts-about-ekeboss --client ekeboss
  - aethra setup-client ~/facts --workspace ~/Aethra/clients/custom-path
createdAt: "2024-01-01T00:00:00.000Z"
updatedAt: "2024-01-01T00:00:00.000Z"
---

# Client Onboarding

## Overview

Use this skill to set up a complete, evidence-backed client workspace from a directory of facts files.

## Steps

### 1. Verify prerequisites

```bash
aethra doctor
```

Confirm all required tools are available. Address any missing required tools before continuing.

### 2. Review the facts directory

The facts directory should contain:
- `brief.md` — client description, objectives, URLs
- `requirements.md` — scope, acceptance criteria (optional)
- `known-urls.txt` — list of URLs to inspect (optional)
- `notes/` — any additional reference material (optional)

Review the supplied facts to understand what is missing and what is already known.

### 3. Run the onboarding pipeline

```bash
aethra setup-client ~/path/to/facts-directory \
  --client <slug>
```

Replace `<slug>` with a lowercase slug for the client (e.g. `ekeboss`).

### 4. Review the generated workspace

After onboarding:
1. Check `knowledge/client-facts.md` for accuracy
2. Review `knowledge/open-questions.md` — answer what you can
3. Check `evidence/` for audit screenshots and results
4. Review `platform/setup-notes.md` for local dev setup

### 5. Address open questions

Work through `knowledge/open-questions.md`. Document answers in the appropriate knowledge files.

### 6. Confirm workspace is valid

```bash
cd ~/Aethra/clients/<slug>
aethra workspace status
```

## Failure handling

If a stage fails:
- Check the error message — it will indicate which stage failed
- Use `--resume` to retry from the last successful stage
- Use `--skip-audit` if the website is not publicly accessible
- Use `--skip-research` if network access is restricted

## Important notes

- The onboarding process does NOT modify source code
- Platform detection is heuristic — verify manually for low-confidence detections
- Audit evidence is for internal use only — review before sharing
- Open questions must be answered before implementation begins
