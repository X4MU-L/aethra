---
name: ui-design-critique
version: 0.1.0
description: Independently evaluate a rendered design against its brief. Score visual quality dimensions, identify strengths, and suggest high-impact improvements.
status: experimental
category: design
whenToInvoke: When evaluating a design implementation against its brief, or when visual acceptance criteria need verification during the verify stage.
requiredInputs:
  - Screenshots of the rendered implementation
  - Design brief (if one exists)
  - Original task description
preconditions:
  - Implementation is rendered and screenshots are captured
  - Design brief exists in the task directory (recommended)
requiredTools:
  - aethra CLI
  - Browser (for screenshot capture)
requiredPermissions:
  - local-file-creation
expectedOutputs:
  - Structured critique with per-dimension scores
  - Top 3 actionable improvements
  - Strongest elements identified
  - Accessibility observations
safetyConstraints:
  - Evaluate the visual result, not the implementation code
  - Use fresh context without the implementer's justification
  - Be specific — generic feedback is not actionable
  - A low distinctiveness score is not automatically a problem
  - Respect intentional constraints from the design brief
platforms: []
examples:
  - "aethra design critique <task-id>"
  - "Evaluate the landing page redesign against the approved brief"
createdAt: "2026-10-11T00:00:00.000Z"
updatedAt: "2026-10-11T00:00:00.000Z"
provenance:
  source: Aethra Workbench
  adapted_by: Aethra
---

# UI Design Critique

## Overview

An independent visual evaluation of a rendered interface. The critique must
be performed without access to the implementation code — only the visible
result, the design brief, and the task context.

## Evaluation dimensions

Score each dimension 0–10:

1. **Visual hierarchy** — Is the most important content immediately apparent?
2. **Typographic clarity** — Are type choices, sizes, and spacing supporting readability?
3. **Color consistency** — Do colors work together and serve a clear purpose?
4. **Layout balance** — Is the composition balanced and intentional?
5. **Responsive adaptation** — Does the design work across tested viewports?
6. **Content readability** — Can the user easily read and understand the content?
7. **Interaction clarity** — Are interactive elements obvious and well-placed?
8. **Distinctiveness** — Does the design feel considered rather than generic?
9. **Accessibility (visual)** — Are there visible contrast, sizing, or spacing issues?
10. **Brand alignment** — Does the design match the intended brand and audience?

## For each dimension, provide:

- A **score** (0–10)
- A **specific observation** about what you see in the screenshot
- A **concrete suggestion** for improvement

## Rules

- **Be specific.** "Improve the layout" is not actionable. "Move the secondary CTA
  below the fold to reduce visual competition with the primary action" is.
- **Evaluate what you see.** Do not guess about code quality, performance, or
  implementation approach from a screenshot.
- **Respect constraints.** A minimal design that follows its brief should not be
  penalized for being minimal.
- **Don't conflate scores.** A high score in one dimension doesn't compensate for
  a critical issue in another.
- **Top 3 improvements.** After scoring, identify the three changes that would
  have the highest impact on overall quality.

## Integration

The critique result is saved to `evidence/design-critiques/` and can be used
during verification. When visual acceptance criteria exist and a design brief
is present, the verify command factors critique scores into pass/fail determination.

A bounded critique loop (implement → capture → critique → revise → re-critique)
should stop after 1–2 meaningful passes or when gains become marginal.
