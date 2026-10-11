# pstack Capability Inventory

**Source:** https://github.com/cursor/plugins/tree/main/pstack  
**Version:** 0.15.15 (Lauren Tan / poteto) — MIT License  
**Inventoried:** 2026-10-10

This document records every pstack capability, its classification for Aethra adoption, and the rationale.

---

## Classification summary

| Category  | Count | Purpose                                                         |
| --------- | ----- | --------------------------------------------------------------- |
| Adopt     | 28    | Model-agnostic, directly improve Aethra delivery quality        |
| Adapt     | 6     | Valuable concept, Cursor-specific wiring replaced by Aethra CLI |
| Reference | 5     | Useful inspiration, no direct implementation planned            |
| Reject    | 10    | Cursor-specific, incompatible dependencies, or out of scope     |

---

## Adopted capabilities

### Engineering principles (20)

All 20 `principle-*` skills are adopted. They contain no Cursor dependencies.
Consolidated into `templates/skills/engineering-principles.md` for context efficiency.

| Principle                                            | Role in Aethra workflow                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `principle-attack-the-premise`                       | Investigation: challenge whether we're solving the right problem   |
| `principle-blast-radius`                             | Plan: assess scope of impact before implementing                   |
| `principle-boundary-discipline`                      | Implementation: enforce interface contracts                        |
| `principle-build-the-lever`                          | Planning: prefer reusable fixes over one-offs                      |
| `principle-encode-lessons-in-structure`              | Implementation: put knowledge in code, not comments                |
| `principle-exhaust-the-design-space`                 | Planning: explore alternatives before committing                   |
| `principle-experience-first`                         | Planning: user impact > implementation elegance                    |
| `principle-explain-the-number`                       | Verification: every metric must be explained and traced            |
| `principle-fix-root-causes`                          | Implementation: never mask symptoms [PRIMARY]                      |
| `principle-foundational-thinking`                    | Investigation: reason from first principles                        |
| `principle-guard-the-context-window`                 | Skills: keep context compact and relevant                          |
| `principle-laziness-protocol`                        | Implementation: prefer existing paths, don't rebuild               |
| `principle-make-operations-idempotent`               | Implementation: re-runnable operations                             |
| `principle-migrate-callers-then-delete-legacy-apis`  | Refactoring: migrate before deleting                               |
| `principle-minimize-reader-load`                     | Documentation: write for the reader                                |
| `principle-model-the-domain`                         | Design: accurate domain model before building                      |
| `principle-never-block-on-the-human`                 | Workflow: agents make progress, don't stall                        |
| `principle-outcome-oriented-execution`               | Workflow: focus on verified outcomes                               |
| `principle-prove-it-works`                           | Verification: require running evidence [PRIMARY]                   |
| `principle-redesign-from-first-principles`           | Planning: when a design is wrong, redesign it                      |
| `principle-separate-before-serializing-shared-state` | Implementation: separate concerns first                            |
| `principle-sequence-verifiable-units`                | Planning: break work into independently verifiable steps [PRIMARY] |
| `principle-subtract-before-you-add`                  | Implementation: remove before adding complexity                    |
| `principle-test-behavior-not-implementation`         | Testing: test observable outcomes, not internals [PRIMARY]         |
| `principle-type-system-discipline`                   | Implementation: use the type system as first enforcement           |

### Engineering skills

| Skill                 | Classification | Aethra mapping                                           |
| --------------------- | -------------- | -------------------------------------------------------- |
| `tdd`                 | Adopt          | Add to `fix-planning.md` skill: write failing test first |
| `blast-radius`        | Adopt          | Incorporated into investigation brief template           |
| `benchmark-checklist` | Adopt          | Reference in performance investigations                  |

---

## Adapted capabilities

| pstack capability       | Adaptation for Aethra                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `poteto-mode` playbooks | The 23 playbook concepts are the conceptual basis for Aethra's CLI workflow (investigate → plan → approve → implement → verify). The slash-command invocation is replaced by CLI commands. |
| `how` skill             | Concept adopted as `aethra investigate` — reads evidence and knowledge base to brief an agent                                                                                              |
| `why` skill             | Concept useful for knowledge base generation. Partially expressed in CLAUDE.md and knowledge/decisions.md                                                                                  |
| `architect` skill       | Concept: settle types and boundaries before cross-boundary code. Relevant for plan-fix                                                                                                     |
| `reflect` skill         | Phase 6 skill builder: capture reusable practice from completed tasks. Not yet implemented                                                                                                 |
| `correct` skill         | Phase 6: find recurring agent mistakes and encode fixes. Not yet implemented                                                                                                               |

---

## Reference capabilities

| Capability                      | Why reference only                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `automate-me`                   | Interesting for generating custom skills from workflow patterns — Phase 6           |
| `recall`                        | Context rebuilding from chat history — agent-session-specific, not persistent state |
| `create-verification-skill`     | Concept: generate a project-local verify skill. Relevant for Phase 6                |
| `maintain-verification-skill`   | Same as above                                                                       |
| `docs/guide/` (11 walkthroughs) | Good reference for Aethra skill authors; not imported as content                    |

---

## Rejected capabilities

| Capability                | Reason                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `setup-pstack`            | Writes `.cursor/settings.json` — Cursor-specific                                    |
| `make-bot-ui`             | Cursor webhook + Grok Bot + Tailscale — incompatible                                |
| `automations/benny`       | Cursor Automations + Slack + Tailscale pipeline                                     |
| `plugin.json`             | Cursor plugin manifest — not applicable                                             |
| `agents/poteto-agent.md`  | Cursor `subagent_type` dispatch — not applicable                                    |
| `agents/comment-sicko.md` | Cursor `subagent_type` dispatch — not applicable                                    |
| `unslop`                  | Comment/prose cleanup — not aligned with Aethra's engineering delivery focus        |
| `no-comments`             | Conflicts with some client style guides; blanket comment deletion is too aggressive |
| `arena`                   | Multi-model parallel runs — Phase 7 concern, not needed now                         |
| `swarm`                   | Parallel agent slicing — Phase 7 concern, not needed now                            |

---

## Upgrade procedure

When pstack releases a new version:

1. Check the CHANGELOG for new skills or principle changes
2. Compare against this inventory
3. For each changed capability: re-classify (adopt/adapt/reference/reject)
4. If an adopted principle changes: update `engineering-principles.md` with the new guidance and attribution
5. Record the upgrade in `source.yaml` → `upgrade_history`
6. Run `aethra init --force` to reinstall updated skills
7. Run `npm test` to confirm no regressions

The normal Aethra workflow does NOT require pstack to be available or installed.
