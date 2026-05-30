# Documentation Index

> Start here when deciding which Markdown file to read or update.

## Current Documents

| File | Status | Owner / Audience | Purpose | Update When |
|---|---|---|---|---|
| `README.md` | Current entry point | Everyone | Quickstart, routes, MVP scope, doc links | Setup commands, routes, main feature status, test counts change |
| `SCHEMA.md` | Authoritative contract doc | Backend, frontend, plugin | Current `ResumeData v1.6`, plugin field scan, fill plan contracts | Any schema or API contract changes |
| `ARCHITECTURE.md` | Current architecture | Backend developers, plugin teammate | System layers, workflows, storage, API overview, v2 limits | Services/modules/data flow/API behavior changes |
| `FEISHU_SCOPE_REDUCTION_REVIEW.md` | Current scope review | Product + engineering | Xiaopeng/Feishu Recruiting scope, kept/removed boundaries, cleanup plan | Supported site scope or plugin adapter boundary changes |
| `PLUGIN_MVP_FIELD_REQUIREMENTS.md` | Current plugin-facing MVP spec | Plugin teammate | Minimal Xiaopeng/Feishu Recruiting field scan payload required for parsing and filling | Plugin scan MVP requirements change |
| `web/README.md` | Frontend local doc | Frontend developers | React app routes, local dev, build notes | Frontend routes, stack, dev commands, design conventions change |

## Documentation Rules

1. Code contracts and documentation must move together.
2. `SCHEMA.md` is the human-readable source for current data contracts; code remains the executable source of truth.
3. If `ResumeData` changes, update `SCHEMA.md`, `app/prompts/parse_resume.py`, tests, frontend display/types, and affected product/architecture docs in the same change.
4. If `FillPlanRequest`, `FormField`, or `FillPlanResponse` changes, update `SCHEMA.md`, `PLUGIN_MVP_FIELD_REQUIREMENTS.md`, prompt rules, and `examples/form_fields.json`.
5. Keep `README.md` short. Put detailed schema in `SCHEMA.md`, detailed architecture in `ARCHITECTURE.md`, and scope changes in `FEISHU_SCOPE_REDUCTION_REVIEW.md`.
6. When a document becomes historical and no longer serves the Xiaopeng/Feishu MVP, delete it or move it outside the product tree instead of leaving stale instructions.

## Recommended Reading Order

For a new developer:

1. `README.md`
2. `DOCS.md`
3. `SCHEMA.md`
4. `ARCHITECTURE.md`
5. `FEISHU_SCOPE_REDUCTION_REVIEW.md`
6. `PLUGIN_MVP_FIELD_REQUIREMENTS.md`

For plugin integration:

1. `SCHEMA.md`
2. `FEISHU_SCOPE_REDUCTION_REVIEW.md`
3. `PLUGIN_MVP_FIELD_REQUIREMENTS.md`

For schema changes:

1. `SCHEMA.md`
2. `app/schemas/resume.py` / `app/schemas/fill_plan.py`
3. `app/prompts/parse_resume.py` / `app/prompts/fill_form.py`
4. `tests/unit/test_schemas.py`
5. `README.md`, `ARCHITECTURE.md`, `FEISHU_SCOPE_REDUCTION_REVIEW.md`
