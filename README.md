# Aethra

A client engineering workbench that coordinates AI-assisted delivery — from audit and investigation through design, implementation, and verification.

## What Aethra does

Aethra sits between you, your AI agent, and the client project. It handles what agents are bad at on their own: structured evidence collection, task lifecycle management, visual feedback processing, design exploration, and verified outcomes.

```
You / Client
    │
    ├── aethra CLI ──────── Direct commands, workspace management
    │
    ├── aethra MCP ──────── Agent reads workspace context, processes annotations
    │   │
    │   └── Agentation ──── Visual feedback from browser toolbar (bundled)
    │
    └── Verification ────── Screenshots, Lighthouse, tests, design critique
```

## Quick start

```bash
# Install
npm install -g aethra

# Initialize
aethra init

# Onboard a client
aethra setup-client ./facts-about-client/

# Run a baseline audit
aethra audit --client my-client

# Investigate a problem
aethra investigate "fix mobile responsiveness" --client my-client

# Create and track a plan
aethra plan-fix "fix mobile responsiveness" --client my-client
aethra task approve <task-id>
aethra apply-fix <task-id>
aethra verify --task <task-id> --run-tests
```

## How agents use Aethra

### MCP integration (recommended)

Register Aethra's MCP server with your AI agent. This gives the agent access to workspace intelligence and live visual feedback — through a single connection.

```bash
# Claude Code
claude mcp add aethra -- npx aethra-mcp --workspace ~/Aethra/clients/my-client

# Or in Claude Code settings
```

The agent gets these tools:

#### Workspace tools
| Tool | Purpose |
|------|---------|
| `aethra_get_client_config` | Client platform, URLs, audit settings |
| `aethra_get_client_facts` | Business context, objectives, constraints |
| `aethra_get_workspace_status` | Onboarding progress, last activity |
| `aethra_get_latest_audit` | Findings, Lighthouse scores, screenshots |
| `aethra_list_plans` | Implementation plans with status |
| `aethra_get_plan` | Full plan details with acceptance criteria |
| `aethra_list_evidence` | Evidence artifacts (screenshots, reports) |
| `aethra_get_knowledge` | Knowledge base documents |
| `aethra_list_tasks` | Task lifecycle status |
| `aethra_get_task` | Full task details |
| `aethra_list_feedback` | Visual feedback items |
| `aethra_get_feedback` | Feedback detail with element context |

#### Visual feedback tools (Agentation, auto-started)
| Tool | Purpose |
|------|---------|
| `aethra_get_pending_annotations` | Get unacknowledged annotations from the toolbar |
| `aethra_watch_annotations` | Block until new annotations arrive (for feedback loops) |
| `aethra_resolve_annotation` | Mark an annotation as fixed |
| `aethra_dismiss_annotation` | Dismiss with reason |
| `aethra_reply_annotation` | Reply to ask for clarification |

When the agent calls any annotation tool, Aethra automatically starts the Agentation HTTP server on port 4747. No separate MCP registration needed.

### Hands-free feedback loop

The most powerful workflow: the agent watches for annotations and processes them automatically.

```
1. Agent calls aethra_watch_annotations (blocks until annotation arrives)
2. User clicks an element in the browser toolbar, adds comment: "This button is cut off on mobile"
3. Agent receives the annotation with CSS selector, component tree, source file
4. Agent reads the source file, understands the issue
5. Agent fixes the CSS
6. Agent calls aethra_resolve_annotation with summary
7. User sees the annotation resolved in their toolbar
8. Loop back to step 1
```

### Skills

Aethra loads relevant skills into the agent's context based on the task. Skills are markdown files with instructions — not code. The agent receives only the skills relevant to the current work.

Built-in skills:
- `engineering-principles` — Core engineering practices
- `website-audit` — Audit methodology
- `fix-planning` — Evidence-backed planning
- `git-safe-implementation` — Safe Git workflows
- `visual-feedback-agentation` — Processing visual annotations
- `ui-design-discovery` — Understanding design problems
- `ui-design-critique` — Visual quality evaluation
- `technical-illustration-anatomy` — Technical diagrams
- Platform skills: `wordpress-local-development`, `shopify-development`

## How humans use Aethra

### Workflow

```
audit → investigate → plan → approve → implement → verify → report
```

Not every task needs every stage. A typo fix skips investigation and design. A redesign needs design exploration. Aethra's task classifier determines the appropriate workflow.

### CLI commands

```bash
# Setup
aethra init                              # Initialize Aethra
aethra setup-client <facts-dir>          # Onboard a client
aethra doctor                            # Check tool availability

# Audit
aethra audit                             # Run baseline audit
aethra audit --refresh                   # Re-audit for comparison
aethra audit --local http://localhost:3000  # Audit local dev

# Planning
aethra investigate "description"         # Assemble evidence brief
aethra plan-fix "task description"       # Generate implementation plan
aethra task approve <id>                 # Approve for implementation
aethra apply-fix <id>                    # Prepare environment + agent instructions

# Verification
aethra verify --task <id>                # Verify against acceptance criteria
aethra verify --task <id> --run-tests    # Also run test suite

# Visual feedback
aethra feedback status                   # Provider availability
aethra feedback watch --provider agentation  # Start server + watch for annotations
aethra feedback import                   # Import pending annotations
aethra feedback list                     # List feedback items
aethra feedback plan --pending           # Create plan from pending feedback
aethra feedback resolve <id> --summary "Fixed"  # Resolve

# Design intelligence
aethra design classify "task"            # Is this a fix, redesign, or illustration?
aethra design directions "redesign hero" # Generate diverse design directions
aethra design brief <task-id> --direction <id>  # Create design brief
aethra design critique <task-id>         # Run visual critic

# Management
aethra task list                         # List all tasks
aethra skills list                       # List available skills
aethra tools                             # Check installed tools
aethra platform detect --url <url>       # Detect platform
aethra workspace list                    # List clients
```

## Visual feedback with Agentation

Aethra bundles [Agentation](https://agentation.com) for visual feedback. No separate installation needed.

### Setup for React / Next.js projects

1. Install the toolbar component in the client project:

```bash
cd /path/to/client-project
npm install agentation -D
```

2. Generate the toolbar configuration for your client workspace:

```bash
aethra feedback setup-toolbar --client <client-slug>
```

3. Add the toolbar component to the app root (development only) with the explicit `sessionId`:

```jsx
import { Agentation } from "agentation";

function App() {
  return (
    <>
      <YourApp />
      {process.env.NODE_ENV === "development" && (
        <Agentation 
          endpoint="http://localhost:4747"
          sessionId="<mapped-session-id>"
          // Or if letting Agentation create sessions dynamically, register it:
          // onSessionCreated={(session) => {
          //   // Register in Aethra: aethra feedback register-session <session.id>
          // }}
        />
      )}
    </>
  );
}
```

> **Session Identity Handshake**: Explicitly passing `sessionId` guarantees that browser annotations and Aethra watcher/MCP ingestion are bound to the identical session, preventing unmapped annotations or cross-workspace leakage.

4. The Agentation HTTP server starts automatically when:
   - The agent calls any `aethra_*_annotation*` MCP tool, OR
   - You run `aethra feedback watch --provider agentation`

5. Click elements in the browser, add comments. The agent receives them through MCP or live SSE.

### How it works under the hood

```
Browser (React app with <Agentation sessionId="..." /> toolbar)
    │
    │ User clicks element, adds comment
    │
    ▼
Agentation HTTP server (port 4747, started by Aethra)
    │
    │ Stores in ~/.agentation/store.db
    │
    ▼
Aethra MCP server / SSE Bridge (Strict session & workspace authorization)
    │
    │ Agent calls aethra_get_pending_annotations
    │ or aethra_watch_annotations
    │
    ▼
AI Agent (Claude Code, etc.)
    │
    │ Reads annotation: selector, component, source file, comment
    │ Makes code changes
    │
    │ Calls aethra_resolve_annotation
    │
    ▼
Agentation HTTP server
    │
    │ Marks annotation resolved
    │
    ▼
Browser toolbar shows ✓ resolved
```

### Non-React projects & Manual Feedback

For WordPress, Shopify, or other platforms, or for manual entry without a toolbar:

```bash
# Add manual feedback directly via CLI:
aethra feedback add "Header navigation overflows on 375px screens" --selector ".site-header nav" --url "http://localhost:3000"

# Or watch workspace feedback/items/*.json files:
aethra feedback watch --provider manual
```

Feedback can be added via CLI or by placing JSON files matching `VisualFeedback` format in `feedback/items/*.json`.

## Design intelligence

Aethra helps agents make better design decisions, not just functional ones.

### Task classification

```bash
$ aethra design classify "redesign the homepage hero section"
  Class:       design-exploration
  Confidence:  0.92
  Design workflow: Yes

$ aethra design classify "fix the broken checkout button"
  Class:       direct-fix
  Confidence:  0.85
  Design workflow: No
```

### Design directions

For creative tasks, Aethra generates structurally different design directions using orthogonal variation across 6 axes:

- Layout density (spacious ↔ compact)
- Typography character (geometric ↔ humanist ↔ serif ↔ monospace)
- Color temperature (cool ↔ warm ↔ neutral ↔ vibrant)
- Hierarchy strategy (hero-dominant ↔ grid ↔ progressive ↔ sidebar)
- Interaction weight (static ↔ subtle ↔ rich ↔ scroll-driven)
- Imagery role (photography ↔ illustration ↔ icon ↔ typography-only)

Each direction differs on at least 2 axes from every other direction — preventing the common problem where AI generates "the same layout with different colors."

### Design critique

An independent visual evaluation that scores the rendered result against the design brief on 10 dimensions:

1. Visual hierarchy
2. Typographic clarity
3. Color consistency
4. Layout balance
5. Responsive adaptation
6. Content readability
7. Interaction clarity
8. Distinctiveness
9. Accessibility (visual)
10. Brand alignment

The critic evaluates screenshots without seeing the implementation code — forcing assessment of the visible result, not the approach.

## Storage

Aethra uses a hybrid storage model:

| Data | Storage | Why |
|------|---------|-----|
| Tasks, feedback, sessions | SQLite (`workspace/.local/aethra.db`) | Fast indexed queries, atomic transitions |
| Client config, workspace state | YAML/JSON files | Human-readable, git-friendly |
| Skills, knowledge base | Markdown files | Agent-consumable, editable |
| Plans | JSON + Markdown files (indexed in SQLite) | Diffable, human-reviewed |
| Screenshots, Lighthouse reports | Files on disk | Binary/large artifacts |

The database uses WAL mode for concurrent access (MCP server + CLI can run simultaneously).

## Workspace structure

```
~/Aethra/clients/<client-slug>/
├── client.yaml                    # Client configuration
├── CLAUDE.md                      # Agent context
├── knowledge/                     # Knowledge base (markdown)
│   ├── client-facts.md
│   ├── technical-findings.md
│   └── architecture.md
├── evidence/                      # Audit artifacts
│   ├── screenshots/
│   ├── performance/
│   └── logs/
├── plans/                         # Implementation plans (JSON + MD)
├── reports/                       # Generated reports
├── skills/                        # Project-specific skills
├── feedback/                      # Visual feedback (legacy files)
└── .local/                        # Protected (gitignored)
    ├── aethra.db                  # SQLite database
    └── workspace-state.json
```

## Task lifecycle

```
planned → approved → in-progress → verifying → completed
    │         │           │            │
    └→ abandoned  └→ planned   └→ blocked   └→ in-progress (re-do)
```

- **planned**: Plan created, awaiting review
- **approved**: Reviewed and approved for implementation
- **in-progress**: Implementation underway
- **verifying**: Verification running
- **completed**: Verified and done
- **blocked**: Blocked, reason in notes
- **abandoned**: No longer relevant

Transitions are enforced — a task can't skip from planned to completed.

## Requirements

- Node.js >= 20.0.0
- Git
- Playwright (for browser automation)

Optional:
- Lighthouse CLI (for performance audits)
- Agentation toolbar (for visual feedback in React/Next.js)

## License

UNLICENSED (private)
