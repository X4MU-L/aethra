---
name: technical-documentation
version: 0.1.0
description: Generate or update technical documentation for a client project. Use when asked to document findings, decisions, architecture, or procedures.
status: approved
category: documentation
whenToInvoke: When asked to document technical findings, write up architecture, record decisions, or create client-facing reports.
requiredInputs:
  - active client workspace
  - audit evidence or investigation notes
preconditions:
  - Client workspace exists
  - Relevant evidence is available
requiredTools:
  - aethra CLI (for report generation)
requiredPermissions:
  - local-file-creation
expectedOutputs:
  - Updated knowledge/ files
  - Reports in reports/
safetyConstraints:
  - NEVER include credentials, API keys, or secrets in documentation
  - NEVER include unverified claims as facts
  - NEVER include private notes in client-facing reports
  - Clearly distinguish verified findings from inferences
examples:
  - aethra report --type internal
  - aethra report --type client-facing
createdAt: "2024-01-01T00:00:00.000Z"
updatedAt: "2024-01-01T00:00:00.000Z"
---

# Technical Documentation

## Principles

1. **Evidence before claims** — Every technical claim must reference a source
2. **Distinguish certainty levels** — Verified / Observed / Inferred / Unknown
3. **Internal vs client-facing** — Internal notes stay internal
4. **Living documents** — Update files rather than creating duplicates

## Knowledge base structure

| File | Purpose |
|------|---------|
| `knowledge/client-facts.md` | Verified client facts |
| `knowledge/technical-findings.md` | Technical discoveries from audit |
| `knowledge/architecture.md` | System architecture diagram |
| `knowledge/decisions.md` | Approved technical decisions |
| `knowledge/open-questions.md` | Unresolved questions |
| `knowledge/glossary.md` | Project-specific terms |

## Writing technical findings

Use this format for findings:

```markdown
### Finding: [Title]

**Observed:** [What was actually seen]
**Confidence:** High / Medium / Low
**Evidence:** [Link to evidence file or screenshot]
**Impact:** [Business or technical impact]
**Recommendation:** [Suggested action]
**Status:** Observed / Verified / Resolved
```

## Recording decisions

Update `knowledge/decisions.md`:

```markdown
| 2024-01-15 | Use DDEV for local WordPress | Reproducibility and team sharing | Confirmed by client |
```

## Generating reports

### Internal engineering report
```bash
aethra report --type internal
```

Includes: all findings, internal notes, Lighthouse raw scores, limitations

### Client-facing report
```bash
aethra report --type client-facing
```

Excludes: internal notes, private reasoning, unapproved conclusions, raw technical data

## Confidentiality rules

The following must NEVER appear in client-facing documents:
- Internal reasoning about client capabilities
- Negative assessments of specific individuals
- Unverified speculative findings
- Pricing, cost estimates, or business terms
- Information from other clients
- Credentials, tokens, API keys of any kind

## Quality checklist

Before sharing any documentation:
- [ ] All claims are either verified or clearly marked as inferred
- [ ] No credentials or sensitive data included
- [ ] Internal notes section excluded from client version
- [ ] Recommendations are actionable and specific
- [ ] Links to evidence files are valid
