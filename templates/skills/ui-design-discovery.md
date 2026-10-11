---
name: ui-design-discovery
version: 0.1.0
description: Understand and frame the design problem before proposing solutions. Gather visual evidence, user context, brand constraints, and existing patterns.
status: approved
category: design
whenToInvoke: When a task is classified as design-exploration and the design problem needs to be understood before generating directions or making changes.
requiredInputs:
  - Task description or client request
  - Client workspace with facts and audit evidence
preconditions:
  - Client workspace exists
  - Baseline audit available (recommended)
requiredTools:
  - aethra CLI
  - Browser (for page inspection and screenshots)
requiredPermissions:
  - external-network-read
expectedOutputs:
  - Design problem statement with user context
  - Inventory of existing patterns and components
  - Captured visual evidence of current state
  - Constraints and requirements for the design
safetyConstraints:
  - Do not modify source files during discovery
  - Capture evidence before proposing changes
  - Record assumptions explicitly
platforms: []
examples:
  - "Understand the current checkout flow before redesigning it"
  - "Audit the existing design system before proposing a new direction"
createdAt: "2026-10-11T00:00:00.000Z"
updatedAt: "2026-10-11T00:00:00.000Z"
provenance:
  source: Aethra Workbench
  adapted_by: Aethra
---

# UI Design Discovery

## Overview

Before proposing a redesign, understand what exists and why. This skill guides the
investigation phase of design work.

## What to discover

### 1. User and business context

- Who is the intended user?
- What are they trying to accomplish?
- What business objectives does the page/feature serve?
- What are the measurable success criteria?

### 2. Current state

- Capture screenshots of the existing interface at key viewports
- Document the current information hierarchy
- Identify the primary and secondary actions
- Note the existing design patterns and components
- Record any interactive states (hover, active, error, empty)

### 3. Design system inventory

- Existing typography (fonts, sizes, weights, line heights)
- Color palette in use
- Spacing system
- Component patterns
- Icon style
- Image treatment

### 4. Constraints

- Brand guidelines or restrictions
- Technical constraints (framework, browser support)
- Content constraints (what content exists, what can change)
- Accessibility requirements
- Performance budgets

### 5. What works and what doesn't

- Which elements serve their purpose well?
- Which elements cause confusion or friction?
- What does the client specifically want to change?
- What must be preserved?

## Output

Document findings as a structured discovery brief in the task directory.
Include screenshot references, not just descriptions.

Use `aethra design classify <task>` to confirm whether design exploration
is appropriate before proceeding to direction generation.
