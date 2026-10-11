---
name: engineering-principles
version: 0.1.0
description: Core engineering principles for investigation, planning, implementation, and verification. Load this skill when doing any substantive engineering task. Principles marked [PRIMARY] are non-negotiable.
status: approved
category: engineering
whenToInvoke: For any investigation, planning, implementation, or verification task. These principles apply across all platforms and client engagements.
requiredInputs:
  - active client workspace
preconditions: []
requiredTools: []
requiredPermissions: []
expectedOutputs:
  - work that follows these principles
  - explicit acknowledgment when a principle cannot be applied and why
safetyConstraints:
  - Never claim a test passed without running it
  - Never fix a symptom when the root cause is known
  - Never modify files outside the approved plan scope
platforms: []
examples:
  - "Use when investigating a bug: apply attack-the-premise before diving in"
  - "Use when planning: sequence verifiable units, estimate blast radius"
  - "Use when implementing: fix root causes, test behavior not implementation"
  - "Use when verifying: prove it works with real evidence"
createdAt: "2026-10-10T00:00:00.000Z"
updatedAt: "2026-10-10T00:00:00.000Z"
provenance:
  source: pstack by Lauren Tan (poteto)
  upstream_url: https://github.com/cursor/plugins/tree/main/pstack
  license: MIT
  adapted_by: Aethra Workbench
  adaptation_date: 2026-10-10
  note: Principles are model-agnostic and apply regardless of agent or IDE.
---

# Engineering Principles

These principles govern how Aethra delivers engineering work. They are adapted from
[pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan, MIT License.

Principles marked **[PRIMARY]** are non-negotiable on every task. The others apply as context demands.

---

## Investigation principles

### Attack the premise [PRIMARY]
Before investigating a problem, ask: is this the right problem?
- Is the reported symptom the actual root cause, or a downstream effect?
- Is the proposed fix solving the right thing at the right level?
- Challenge the task description before diving into code.

### Foundational thinking
Reason from first principles, not analogies.
- Don't assume a pattern that worked in a different context applies here.
- Trace the actual execution path rather than guessing.
- Build a mental model of the system before proposing changes.

### Explain the number
Any metric, score, or measurement reported must be traced to its source.
- A Lighthouse score of 62 needs to be explained: which audits failed, why, what caused them.
- A "40% improvement" needs the baseline, the method, and the confidence interval.
- Do not report numbers you cannot explain.

### Exhaust the design space
Before committing to an approach, surface the alternatives.
- Identify at least two alternative solutions for any non-trivial task.
- Explain why each alternative was considered and why the preferred approach is better.
- A solution is only good relative to what was considered.

---

## Planning principles

### Sequence verifiable units [PRIMARY]
Break every plan into independently verifiable steps.
- Each step should have a clear completion condition.
- Do not write a 12-step plan where step 4 cannot be verified until step 11 is done.
- If a step cannot be verified, it is too large — split it.

### Blast radius [PRIMARY]
Before implementing any change, assess its scope of impact.
- Which other components depend on the thing being changed?
- Which tests could break?
- Which user flows could be affected?
- A change with a large blast radius requires stronger evidence before proceeding.

### Experience first
Prioritize user impact over implementation elegance.
- The best implementation is the one that improves the user's experience.
- A clever pattern that confuses users is not a good solution.
- When choosing between two technically equivalent approaches, prefer the one that's simpler for the user to understand and recover from if something goes wrong.

### Fix root causes [PRIMARY]
Never mask a symptom when the root cause is knowable.
- A try/catch that swallows an error is not a fix.
- A default value that hides a missing configuration is not a fix.
- Identify the root cause. Fix that. Document why.

### Subtract before you add
When something is broken or complex, consider removing before adding.
- Can the broken thing be removed rather than patched?
- Can the complexity be eliminated rather than abstracted?
- Adding code to manage other code's failure is often the wrong direction.

---

## Implementation principles

### Boundary discipline
Enforce interface boundaries strictly.
- Each module should have a single, well-defined responsibility.
- Cross-boundary calls must go through the interface, not through internal details.
- When a boundary becomes leaky, stop and re-establish it before continuing.

### Encode lessons in structure [PRIMARY]
Put hard-won knowledge in code, not in comments.
- A comment saying "don't do X" is weaker than a type or assertion that prevents X.
- A runtime check is weaker than a compile-time constraint.
- Prefer making the wrong thing impossible over documenting that it is wrong.

### Make operations idempotent
Design operations to be safely re-run.
- A re-run of a completed operation should produce the same result, not create duplicates.
- Prefer upserts over inserts for state that might already exist.
- Document explicitly when an operation is NOT idempotent and why.

### Laziness protocol
Default to using what already exists before building new things.
- Does an existing function, module, or tool already solve this?
- Can an existing abstraction be extended rather than replaced?
- New code means new surface area for bugs. Use it sparingly.

### Type system discipline
Use the type system as the first enforcement layer.
- A type that prevents a class of errors is better than a runtime check.
- Avoid `any`, `unknown`, and unnecessary type casting.
- When a type cannot express the constraint, document why and add a runtime assertion.

### Migrate callers, then delete
When changing an API or interface, migrate all callers first.
- Never delete something until all its callers have been updated.
- Verify the migration by running tests against the new interface before removing the old one.
- Keep the migration atomic where possible: one PR that migrates all callers and removes the old API.

---

## Verification principles

### Prove it works [PRIMARY]
A claim that something works must be supported by evidence from actually running it.
- Saying "this should fix the issue" is not proof.
- Running the code and showing the output is proof.
- A passing test suite is stronger evidence than a code review.
- A screen recording of the user journey is stronger evidence than a passing test suite.

### Test behavior, not implementation [PRIMARY]
Tests should verify observable outcomes, not internal implementation details.
- Test what the code does, not how it does it.
- A test that breaks when you rename a private variable is testing the wrong thing.
- A test that breaks when user-visible behavior changes is testing the right thing.

### Outcome-oriented execution
Focus on verified outcomes, not process compliance.
- "I ran the tests" is not the same as "the tests passed."
- "I followed the plan" is not the same as "the plan worked."
- Report what actually happened, not what should have happened.

### Guard the context window
Keep agent context compact and relevant.
- Do not load skills, knowledge files, or evidence that are not relevant to the current task.
- An overloaded context produces lower-quality outputs.
- When a task is done, stop. Do not keep elaborating.

---

## Meta-principles

### Never block on the human
Make progress on what can be determined independently.
- When information is missing, make a reasonable assumption, record it, and continue.
- Flag the assumption explicitly so it can be corrected.
- Only block when the missing information is truly critical and non-assumable.

### Redesign from first principles
When a design is demonstrably wrong, redesign it — do not patch it.
- A patched bad design is still a bad design.
- If you find yourself adding the fifth workaround to the same system, stop and redesign the system.
- Get approval for the redesign before implementing it.

### Model the domain accurately
Build a mental model of the domain before writing code.
- Understand what the system is supposed to do before changing how it does it.
- Terms and concepts in the domain should be reflected in the code's names and structures.
- A mismatch between the domain model and the code is a source of bugs.

### Separate before serializing shared state
Before adding persistence or serialization, separate the concerns.
- Shared mutable state is the source of most concurrency bugs.
- Make state ownership explicit before making it persistent.
- Separate the data model from the serialization format.

---

*Adapted from pstack by Lauren Tan (poteto), MIT License.*  
*Source: https://github.com/cursor/plugins/tree/main/pstack*  
*Aethra adaptation: 2026-10-10*
