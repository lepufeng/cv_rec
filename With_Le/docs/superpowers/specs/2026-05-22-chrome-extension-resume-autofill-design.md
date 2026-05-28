# Chrome Extension: Resume Auto-fill for Corporate Recruitment Sites

## Overview

A Chrome extension that auto-fills corporate recruitment website forms (e.g., Tencent Careers, JD Careers) using structured resume data. The extension communicates with a backend service that handles LLM-based field matching. Filling is per-page, streaming (one field at a time with 50ms interval), with automatic multi-step navigation and smart section expansion.

## Architecture

```
Popup UI ──────▶ Content Script ◀───── Backend (LLM + API)
                      │
                 Service Worker
              (message relay + cache)
```

| Component | Responsibility |
|-----------|---------------|
| **Popup** | Trigger button, display fill results (skipped fields) |
| **Content Script** | DOM operations: scan fields, expand sections, fill controls, navigate pages, annotate results |
| **Service Worker** | Backend communication: fetch resume JSON, send field-matching requests, cache resume data |

### Data Flow

1. User opens recruitment page → clicks extension icon → clicks "Fill"
2. Popup sends "start fill" message to Content Script
3. Content Script scans current page form fields → sends field metadata to Service Worker
4. Service Worker requests LLM field matching from backend (fields + resume JSON)
5. Backend returns mapping `{ fieldId: value }` and section actions
6. Content Script fills fields one by one (50ms interval, streaming)
7. Find "Next" button → navigate → repeat steps 3-6
8. After all pages done, annotate skipped fields on the final page

## Content Script Modules

```
Content Script
├── Section Manager     → Controlled section expansion (LLM-driven)
├── Field Scanner       → Collect field metadata from current page
├── Fill Engine         → Streaming field fill
│   ├── TextHandler     → input / textarea / contenteditable
│   ├── SelectHandler   → native select / searchable custom dropdown
│   ├── DateHandler     → native date input / custom date picker
│   ├── ChoiceHandler   → radio / checkbox
│   └── UploadHandler   → file upload (annotate, skip)
├── Navigation Detector → Detect Next/Submit buttons, handle pagination
└── Result Annotator    → Annotate skipped fields on page after fill completes
```

### Fill Flow

```
Section Manager (LLM-driven: expand/add only as needed)
    ↓
Field Scanner (label, type, placeholder, options, container)
    ↓
[field metadata] → Service Worker → Backend LLM → [mapping + section actions]
    ↓
Fill Engine fills one by one (50ms fixed interval)
    ↓
Navigation Detector → has next page? → click "Next" → repeat
    ↓
No next page? → Result Annotator marks skipped fields
```

## Field Scanner

Scans all form elements in visible DOM. Extracts per field:

```json
{
  "fieldId": "auto-generated unique id",
  "type": "text | textarea | select | date | radio | checkbox | file | unknown",
  "label": "label text or nearest visible text node",
  "placeholder": "placeholder value if any",
  "options": ["opt1", "opt2"],
  "required": true,
  "containerText": "Full text of parent container (for context)",
  "section": "Section name (e.g., 'Basic Info', 'Education')"
}
```

### Label Resolution Priority

1. Explicit `<label for="fieldId">`
2. Input wrapped in `<label>`
3. Nearest visible text node before the field
4. `aria-label` / `aria-labelledby`
5. Ancestor fieldset legend or container heading

### Section Boundary Detection

- Detect section headers: `h2`/`h3`/`fieldset legend` / prominent separator text
- Each field is assigned to the nearest preceding section header

## Section Manager

Sections with "+" / "Add" buttons are NOT expanded blindly. Expansion is driven by resume data via LLM decisions.

### Process

1. Field Scanner collects not only existing field metadata, but also **repeatable section structure info**:
   - Section name (e.g., "Education")
   - Current instance count (e.g., 1 education card already visible)
   - Whether an "Add" button exists for this section

2. Structure info + field metadata sent to LLM together

3. LLM returns:
   - Field mappings: `{ fieldId: value }`
   - Section actions: `{ "Education": "add_1", "Internship": "add_0" }`
     - `add_0` = no addition needed (resume has 0 entries, or matches existing count)
     - `add_1` = click "Add" once (resume has 2, page already has 1 → need +1)
     - `add_n` = click "Add" n times

4. Content Script executes section actions first, then field filling

### Safety

- Max 20 total section expansions
- Max 3 levels of recursion
- Skip element if not visible or already expanded
- Wait up to 3s for DOM change after clicking, skip on timeout

## Fill Engine

All fills use a fixed 50ms interval between operations to simulate human-like interaction.

### TextHandler

- Focus → set `value` → dispatch `input` event → dispatch `change` event
- For contenteditable: set `innerHTML` → dispatch `input`

### SelectHandler

- **Native `<select>`:** Match option text/value → set `selectedIndex` → dispatch `change`
- **Searchable custom dropdown:** Focus input → type search text → wait for dropdown → click matching item

### DateHandler

- **Native `<input type="date">`:** Set value formatted as YYYY-MM-DD
- **Custom date picker:** Try setting input value directly → if ineffective, simulate click → click date in popup calendar

### ChoiceHandler

- **Radio:** Match label text → click corresponding radio or label
- **Checkbox:** Same as radio, supports multiple values

### UploadHandler

- File inputs cannot be bypassed (browser security restriction)
- Strategy: annotate field with "Please manually upload: [filename]", mark as skipped

### Retry

- If field value doesn't take effect after setting, retry once with alternative method
- If still fails, skip the field

## Multi-page Navigation

### "Next" Button Detection

Priority-ordered matching:
1. Exact text match: "下一步" / "继续" / "保存并继续" / "Next"
2. Fuzzy text match: button/a/span containing "下一步" or "继续"
3. Common visual patterns for next-step buttons

### Flow

1. After filling all fields on current page, search for "Next" button
2. If found: click → wait for DOM change → wait for network idle (1s no new requests) → scan new page
3. If not found: search for "提交"/"确认"/"保存"/"Submit" → treat as final page, stop
4. If two consecutive pages have identical field structure → treat as confirmation/preview page, stop

### Safety

- Max 10 page navigations
- 5s timeout waiting for page transition
- Save current page state before navigating (which fields filled/skipped)

## Backend API

```
POST /api/resume/{id}
  → Returns resume JSON

POST /api/match-fields
  Request: { fields: [...], resume: {...}, sections: [...] }
  Response: {
    mappings: { fieldId: value, ... },
    sectionActions: { "Education": "add_1", ... },
    skipped: ["field_label_1", ...]
  }
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| Backend/LLM timeout | Retry once, then abort with user notification |
| Field value not applied | Retry once with alt method, then skip |
| Section expansion timeout (3s) | Skip section |
| Post-navigation no new fields | Treat as final confirmation page, stop |
| Unknown control type | Record as unknown, skip |

## Result Annotation

After all pages filled, inject a semi-transparent overlay at page top:

```
┌─────────────────────────────────────┐
│  Auto-fill complete                 │
│  Filled: 15 fields                  │
│  Skipped: 2 fields                  │
│  · Resume attachment → manual upload│
│  · Expected salary → no data found  │
│                                     │
│  [Close]                            │
└─────────────────────────────────────┘
```

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no framework dependency)
- Communication: `chrome.runtime.sendMessage` between popup, content script, and service worker
