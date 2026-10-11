---
name: technical-illustration-anatomy
version: 0.1.0
description: Generate technical illustrations, architecture diagrams, and visual explainers using the Anatomy toolkit. Only invoke when a task explicitly requires visual/illustration output.
status: experimental
category: illustration
whenToInvoke: When asked to create architecture diagrams, technical illustrations, visual explainers, flowcharts, or system diagrams for documentation, blog posts, or client communication.
requiredInputs:
  - Description of the concept to illustrate
  - Technical facts, thresholds, or mechanisms to depict
  - Target output format (HTML, SVG, React component)
preconditions:
  - Anatomy toolkit installed and available
  - Task explicitly requires illustration output
requiredTools:
  - anatomy CLI
requiredPermissions:
  - local-file-creation
expectedOutputs:
  - SVG, HTML, or React component illustration
  - Illustration metadata (dimensions, colors, assets)
safetyConstraints:
  - Never include confidential client data in illustrations
  - Always verify Anatomy availability before attempting
  - Fall back to text description if Anatomy is unavailable
  - Do not use Anatomy for conventional UI work (dashboards, forms, navigation)
  - Validate generated assets before integrating into client project
platforms: []
examples:
  - "Create an architecture diagram for the client's API gateway"
  - "Illustrate the data flow through the checkout pipeline"
  - "Build an interactive explainer for the caching mechanism"
createdAt: "2026-10-11T00:00:00.000Z"
updatedAt: "2026-10-11T00:00:00.000Z"
provenance:
  source: Anatomy by wheresryan22
  upstream_url: https://github.com/wheresryan22/anatomy
  adapted_by: Aethra Workbench
---

# Technical Illustration with Anatomy

## Overview

Anatomy is a specialized toolkit for creating technical illustrations that explain
mechanisms, architectures, and data flows through visual metaphors.

## When to use

Use Anatomy when the task involves crafted, metaphor-based explanatory visuals:

- Explaining a database connection pool or caching mechanism
- Visualizing a processing pipeline as a crafted machine
- Building an interactive technical explainer for a blog or documentation
- Creating a distinctive explanatory figure for a landing page
- Making a technical concept easier to understand through parts, movement, and readouts

## When NOT to use

Do not use Anatomy for:

- Standard architecture diagrams, ER diagrams, or class hierarchies (use Mermaid or D2 instead)
- System flowcharts or sequence diagrams (use Mermaid instead)
- Ordinary dashboards or admin interfaces
- Conventional checkout or form UI
- Navigation redesigns
- General data visualizations (use chart libraries like Recharts, Chart.js, or Vega)
- Pages whose main purpose is transactional interaction

## Workflow

1. **Identify the concept** that needs explaining
2. **Gather the true numbers**, thresholds, behavior, or mechanism
3. **Choose a visual metaphor** — do not copy a reference image
4. **Decide the output format**: standalone HTML/SVG or a React/Next.js component
5. **Produce the illustration** using Anatomy's kit and conventions
6. **Run relevant checks** (geometry audit, render validation)
7. **Capture and inspect screenshots** at intended viewports
8. **Verify light/dark treatment**, motion, reduced motion, and fallbacks
9. **Integrate** the resulting artifact into the client project
10. **Record** the generated files, validation results, and any limitations

## Important rules

- Use accurate technical information — do not invent numbers or behavior
- Choose a metaphor that genuinely clarifies the concept
- Verify the illustration renders correctly in the target environment
- Check both light and dark themes if the project supports them
- Respect reduced motion preferences for animated illustrations
- Record the upstream Anatomy version used for reproducibility
