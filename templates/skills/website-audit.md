---
name: website-audit
version: 0.1.0
description: Audit a client website for performance, accessibility, technical issues, and conversion opportunities. Use when asked to inspect a website, collect baseline evidence, or investigate technical issues.
status: approved
category: audit
whenToInvoke: When asked to audit a website, run a baseline inspection, collect screenshots, check performance, or investigate technical issues on a client site.
requiredInputs:
  - active client workspace (run `aethra setup-client` first)
  - primary URL configured in client.yaml
preconditions:
  - Playwright browser available (run `npx playwright install chromium` if not)
  - Client workspace exists and is configured
  - Target URL is publicly accessible (or appropriate auth state exists in .local/)
requiredTools:
  - aethra CLI
  - playwright (chromium)
  - lighthouse (via npx)
requiredPermissions:
  - external-network-read
  - local-file-creation
expectedOutputs:
  - evidence/baseline.json or evidence/refresh.json
  - evidence/screenshots/ — desktop and mobile screenshots
  - evidence/performance/ — Lighthouse reports
  - evidence/logs/ — HTTP checks, console errors
safetyConstraints:
  - Maximum 50 pages per audit
  - 500ms minimum delay between page requests
  - Never submit real forms or make purchases during testing
  - Never bypass authentication or CAPTCHAs
  - Auth state stored only in .local/ (never committed)
examples:
  - aethra audit
  - aethra audit --refresh --max-pages 20
  - aethra audit --no-lighthouse --client ekeboss
createdAt: "2024-01-01T00:00:00.000Z"
updatedAt: "2024-01-01T00:00:00.000Z"
---

# Website Audit

## Overview

Collect structured, timestamped evidence about a client website's technical state.
Evidence is used to inform planning, identify issues, and track improvements over time.

## What is audited

1. **HTTP reachability** — Status codes, redirects, response times
2. **Platform detection** — WordPress, Shopify, Next.js, etc.
3. **Page inspection** — Title, headings, meta, links, forms
4. **Screenshots** — Desktop (1440px) and mobile (375px) viewports
5. **Console errors** — JavaScript errors in browser
6. **Lighthouse audit** — Performance, accessibility, SEO, best practices
7. **Network errors** — Failed requests

## What is NOT audited

- Authenticated user journeys (requires manual auth flow)
- Backend API performance
- Database query performance
- Field-level performance data (lab only)
- Payment flows

## Steps

### 1. Run the baseline audit

```bash
aethra audit
```

### 2. For subsequent audits (preserves baseline)

```bash
aethra audit --refresh
```

### 3. Review findings

After the audit:
1. Check `evidence/screenshots/` for visual issues
2. Review `evidence/performance/` for Lighthouse scores
3. Read the audit output for high-priority findings

### 4. Interpret Lighthouse scores

Scores are **lab results only** — not real-user field data.
- Performance: < 50 = critical, 50–74 = needs work, 75–89 = good, 90+ = excellent
- Accessibility: < 80 = significant issues, 90+ = baseline acceptable
- SEO: < 70 = actionable issues

Always note: *"These are lab results. Field data may differ based on real user conditions."*

## Limitations

- Automated accessibility tests find ~40-50% of accessibility issues; manual testing is required for full coverage
- Lighthouse performance scores vary based on test environment; document conditions
- Screenshots are visual-only; functional testing requires separate flows
- Console errors from third-party scripts may not be actionable

## After the audit

```bash
aethra plan-fix "Task description based on findings"
```
