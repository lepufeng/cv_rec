# Documentation Index

> Start here when deciding which Markdown file to read or update.

## Current Documents

| File | Status | Owner / Audience | Purpose | Update When |
|---|---|---|---|---|
| `README.md` | Current entry point | Everyone | Quickstart, routes, MVP scope, doc links | Setup commands, routes, main feature status, test counts change |
| `SCHEMA.md` | Authoritative contract doc | Backend, frontend, plugin | Current `ResumeData v1.6`, plugin field scan, fill plan contracts | Any schema or API contract changes |
| `ARCHITECTURE.md` | Current architecture | Backend developers, plugin teammate | System layers, workflows, storage, API overview, v2 limits | Services/modules/data flow/API behavior changes |
| `PRODUCT_FLOW_PRD.md` | Current product/flow doc | Product + engineering | Product intent, data flow diagrams, PRD mockups, learning roadmap | Product scope, user journey, data flow, plugin protocol changes |
| `PLUGIN_INTEGRATION_REVIEW.md` | Current plugin compatibility review | Platform + plugin teammate | Review of teammate scan JSON and platform integration gaps | Plugin scan schema or fill execution assumptions change |
| `PLUGIN_MVP_FIELD_REQUIREMENTS.md` | Current plugin-facing MVP spec | Plugin teammate | Minimal field scan payload required for parsing and filling before self-learning | Plugin scan MVP requirements change |
| `E2E_SELF_CHECKLIST.md` | Current validation checklist | Developer/operator | End-to-end readiness checklist and local verification commands | New checks, scripts, pass/fail status, known gaps change |
| `ATS_FIELD_REVIEW.md` | Reference research | Product + schema planning | Mainstream ATS/job site fields and schema gap analysis | Schema promotion decisions or ATS research changes |
| `web/README.md` | Frontend local doc | Frontend developers | React app routes, local dev, build notes | Frontend routes, stack, dev commands, design conventions change |

## Historical / Reference Documents

| File | Status | How To Use |
|---|---|---|
| `HANDOFF.md` | Historical handoff record | Useful for old decisions and context. Do not treat schema/API details here as current unless confirmed against `SCHEMA.md` and code. |
| `.kiro/specs/resume-parsing-platform/*.md` | Historical Kiro specs | Useful for original requirements/design/tasks. Current implementation may differ. Prefer `README.md`, `SCHEMA.md`, and code for present behavior. |

## Documentation Rules

1. Code contracts and documentation must move together.
2. `SCHEMA.md` is the human-readable source for current data contracts; code remains the executable source of truth.
3. If `ResumeData` changes, update `SCHEMA.md`, `app/prompts/parse_resume.py`, tests, frontend display/types, and affected product/architecture docs in the same change.
4. If `FillPlanRequest`, `FormField`, or `FillPlanResponse` changes, update `SCHEMA.md`, `PLUGIN_INTEGRATION_REVIEW.md`, `PRODUCT_FLOW_PRD.md`, prompt rules, and plugin-facing examples.
5. Keep `README.md` short. Put detailed schema in `SCHEMA.md`, detailed architecture in `ARCHITECTURE.md`, and product diagrams in `PRODUCT_FLOW_PRD.md`.
6. When a document becomes historical, add a visible note instead of silently leaving stale instructions.

## Recommended Reading Order

For a new developer:

1. `README.md`
2. `DOCS.md`
3. `SCHEMA.md`
4. `ARCHITECTURE.md`
5. `PRODUCT_FLOW_PRD.md`
6. `E2E_SELF_CHECKLIST.md`

For plugin integration:

1. `SCHEMA.md`
2. `PLUGIN_INTEGRATION_REVIEW.md`
3. `PRODUCT_FLOW_PRD.md`
4. `E2E_SELF_CHECKLIST.md`

For schema changes:

1. `SCHEMA.md`
2. `app/schemas/resume.py` / `app/schemas/fill_plan.py`
3. `app/prompts/parse_resume.py` / `app/prompts/fill_form.py`
4. `tests/unit/test_schemas.py`
5. `README.md`, `ARCHITECTURE.md`, `PRODUCT_FLOW_PRD.md`, `E2E_SELF_CHECKLIST.md`
