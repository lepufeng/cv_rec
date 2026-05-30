# Release Checklist

This checklist is for preparing the current Xiaopeng / Feishu Recruiting MVP for user testing or submission review.

## Scope

- Supported pages: Xiaopeng Recruiting and Feishu Recruiting style pages.
- Primary user path: register or login on the web app, upload a resume, auto-link the Chrome extension, open a supported recruiting page, run autofill.
- Safety boundary: the extension never clicks final submit buttons and only uploads the stored original resume file.

## Required Checks

Run from the repository root:

```bash
.venv/bin/python -m pytest -q
cd web && npm run build
cd ..
node --test With_Le/chrome-extension/tests/*.test.js
.venv/bin/python scripts/package_extension.py --dry-run
```

Build the review zip:

```bash
.venv/bin/python scripts/package_extension.py
```

The zip is written to:

```text
dist/cv-rec-autofill-extension.zip
```

`dist/` is intentionally ignored by Git because the package is a generated artifact.

## Manual QA

1. Start the backend and web frontend.
2. Load `With_Le/chrome-extension` in Chrome extension developer mode.
3. Click the extension's `打开平台` button.
4. Register or log in, upload a resume, and confirm `/plugin?autolink=1` shows the extension as connected.
5. Open a Xiaopeng or Feishu Recruiting page and run `开始自动填写`.
6. Confirm date ranges, repeat sections, textareas, searchable selects, and resume upload behave correctly.
7. Confirm final submit is not clicked automatically.
8. Copy the diagnostic report if anything looks wrong.

## Before Sharing

- Keep `.env`, `data/`, `web/node_modules/`, `web/dist/`, and `dist/` out of Git.
- Reload the Chrome extension whenever `manifest.json` or content scripts change.
- Use a fresh user account for end-to-end QA so cached fill plans do not hide regressions.
