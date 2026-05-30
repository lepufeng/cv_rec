# Chrome Extension Feishu Recruiting Test

This local page is a repeatable pre-flight check for Xiaopeng / Feishu Recruiting style forms.

## Run the page

From this directory:

```bash
python3 -m http.server 8090
```

Open:

```text
http://127.0.0.1:8090/test-form.html
```

## Automated Smoke Test

From the repository root:

```bash
node --test With_Le/chrome-extension/tests/autofill-smoke.test.js
```

The smoke test launches Chromium, injects the extension content scripts into this page, expands repeated project cards, fills the fields, and verifies that final submit is not clicked. In restricted shells where Chromium cannot launch, the test is skipped; run it from a normal local terminal for the full browser check.

The smoke suite includes two layers:

- `local Feishu smoke fills dynamic projects and stops before final submit`: verifies scanner, section expansion, fill handlers, and final-submit safety.
- `content trigger runs direct autofill across pages with dynamic expansion`: calls the same `window.__resumeAutofillStart()` entrypoint used by the popup and verifies the full content-script loop.

## Real Chrome Validation Note

If Codex cannot claim the user's Chrome tabs and reports `native pipe is closed`, first separate that from product behavior. The local smoke tests above validate our extension scripts without the Codex Chrome Extension bridge. Real-site validation can continue after the Codex Chrome Extension/native messaging bridge is restored.

## What It Covers

- Feishu/Formily labels such as `data-form-field-i18n-name`.
- Feishu-style module wrappers such as `applyFormModuleWrapper`.
- UD-style custom select controls such as `ud__select`.
- Dynamic `项目经历` cards with one initial item and an add button.
- Custom radio/combobox controls.
- A final `提交投递` button that writes an error marker if clicked.

## Expected Plugin Behavior

- Click `开始自动填写`.
- The plugin may click `下一步`, but must not click `提交投递`.
- If the resume has multiple project experiences, project cards should be added before filling.
- `复制诊断报告` should include `sectionActions`, `expandedFieldCount`, `repeatIndex`-backed mappings, and `stopReason: submit_only` on the final page.
- A local smoke run should fill normal text/date fields, the custom degree dropdown, multiple project cards, multiple checked skills, and the stored resume file, while still leaving the final submit button untouched.
