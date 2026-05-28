# Resume Auto-fill Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. It will decide whether each batch should run in parallel or serial subagent mode and will pass only task-local context to each subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that auto-fills corporate recruitment website forms using structured resume JSON, with LLM-driven field matching via backend, per-page streaming fill, multi-step navigation, and smart section expansion.

**Architecture:** Manifest V3 Chrome extension with a popup trigger, content script for DOM operations, and service worker for backend communication. The content script is modularized: field scanner, section manager, fill engine (with per-type handlers), navigation detector, and result annotator — wired together by a thin orchestrator.

**Tech Stack:** Vanilla JavaScript (no framework), Chrome Extension Manifest V3, chrome.runtime messaging API.

**Spec:** `docs/superpowers/specs/2026-05-22-chrome-extension-resume-autofill-design.md`
**AC:** `docs/superpowers/acceptance/2026-05-22-resume-autofill.md`

---

## File Structure

```
chrome-extension/
├── manifest.json
├── icons/                          (placeholder icons — not in scope)
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── content/
│   ├── content.js                  (orchestrator)
│   ├── field-scanner.js
│   ├── section-manager.js
│   ├── fill-engine.js
│   ├── handlers/
│   │   ├── text-handler.js
│   │   ├── select-handler.js
│   │   ├── date-handler.js
│   │   ├── choice-handler.js
│   │   └── upload-handler.js
│   ├── navigation-detector.js
│   └── result-annotator.js
├── service-worker/
│   └── service-worker.js
└── shared/
    └── message-types.js
```

| File | Responsibility |
|------|---------------|
| `manifest.json` | Extension manifest V3: permissions, content scripts, service worker, popup |
| `popup/popup.html` + `popup.js` + `popup.css` | Trigger button and status display |
| `content/content.js` | Orchestrator: wires all modules, manages the per-page fill loop |
| `content/field-scanner.js` | Scans all form elements in visible DOM, extracts metadata |
| `content/section-manager.js` | Detects repeatable sections, executes LLM-directed add actions |
| `content/fill-engine.js` | Manages fill queue with 50ms interval, dispatches to handlers |
| `content/handlers/text-handler.js` | Fills input, textarea, contenteditable |
| `content/handlers/select-handler.js` | Fills native select and searchable custom dropdowns |
| `content/handlers/date-handler.js` | Fills native date inputs and custom date pickers |
| `content/handlers/choice-handler.js` | Selects radio and checkbox groups |
| `content/handlers/upload-handler.js` | Skips file inputs, marks for manual upload |
| `content/navigation-detector.js` | Detects "next" / "submit" buttons, handles page transitions |
| `content/result-annotator.js` | Injects semi-transparent result overlay |
| `service-worker/service-worker.js` | Backend API calls (resume fetch, field matching), resume caching |
| `shared/message-types.js` | Message type string constants |

---

### Task 1: Project Scaffold & Manifest

**Files:**
- Create: `chrome-extension/manifest.json`
- Create: `chrome-extension/shared/message-types.js`

- [ ] **Step 1: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Resume Auto-fill",
  "version": "0.1.0",
  "description": "Auto-fill corporate recruitment forms using resume data",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "Resume Auto-fill"
  },
  "background": {
    "service_worker": "service-worker/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "shared/message-types.js",
        "content/handlers/text-handler.js",
        "content/handlers/select-handler.js",
        "content/handlers/date-handler.js",
        "content/handlers/choice-handler.js",
        "content/handlers/upload-handler.js",
        "content/field-scanner.js",
        "content/section-manager.js",
        "content/fill-engine.js",
        "content/navigation-detector.js",
        "content/result-annotator.js",
        "content/content.js"
      ],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: Create shared/message-types.js**

```javascript
const MSG = {
  START_FILL: 'START_FILL',
  FILL_PROGRESS: 'FILL_PROGRESS',
  FILL_COMPLETE: 'FILL_COMPLETE',
  FILL_ERROR: 'FILL_ERROR',
  SCAN_FIELDS: 'SCAN_FIELDS',
  REQUEST_RESUME: 'REQUEST_RESUME',
  REQUEST_MATCH: 'REQUEST_MATCH',
  RESUME_DATA: 'RESUME_DATA',
  MATCH_RESULT: 'MATCH_RESULT',
};
```

- [ ] **Step 3: Verify scaffold**

Run: `ls -R chrome-extension/`
Expected: manifest.json and shared/message-types.js exist at correct paths.

---

### Task 2: Service Worker — Backend Communication

**Files:**
- Create: `chrome-extension/service-worker/service-worker.js`

- [ ] **Step 1: Write service-worker.js**

```javascript
const BACKEND_BASE = 'http://localhost:3000/api';

let cachedResume = null;

async function fetchResume(resumeId) {
  if (cachedResume) return cachedResume;
  const res = await fetch(`${BACKEND_BASE}/resume/${resumeId}`);
  if (!res.ok) throw new Error(`Failed to fetch resume: ${res.status}`);
  cachedResume = await res.json();
  return cachedResume;
}

async function matchFields(fields, resume, sections) {
  const res = await fetch(`${BACKEND_BASE}/match-fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, resume, sections }),
  });
  if (!res.ok) throw new Error(`Match request failed: ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.REQUEST_RESUME) {
    fetchResume(message.resumeId)
      .then(data => sendResponse({ type: MSG.RESUME_DATA, data }))
      .catch(err => sendResponse({ type: MSG.FILL_ERROR, error: err.message }));
    return true;
  }

  if (message.type === MSG.REQUEST_MATCH) {
    matchFields(message.fields, message.resume, message.sections)
      .then(data => sendResponse({ type: MSG.MATCH_RESULT, data }))
      .catch(err => sendResponse({ type: MSG.FILL_ERROR, error: err.message }));
    return true;
  }
});
```

- [ ] **Step 2: Verify worker loads**

Run: check that no syntax errors exist by reviewing the file.
Expected: File is syntactically valid JavaScript.

---

### Task 3: Popup UI

**Files:**
- Create: `chrome-extension/popup/popup.html`
- Create: `chrome-extension/popup/popup.js`
- Create: `chrome-extension/popup/popup.css`

- [ ] **Step 1: Create popup.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div id="popup-container">
    <h2>Resume Auto-fill</h2>
    <div id="status"></div>
    <button id="fill-btn">一键填充</button>
  </div>
  <script src="../shared/message-types.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create popup.css**

```css
body { width: 280px; margin: 0; font-family: -apple-system, sans-serif; }
#popup-container { padding: 16px; }
h2 { margin: 0 0 12px 0; font-size: 16px; }
#status { margin-bottom: 12px; font-size: 13px; color: #666; min-height: 18px; }
#fill-btn {
  width: 100%; padding: 10px; border: none; border-radius: 6px;
  background: #2563eb; color: #fff; font-size: 15px; cursor: pointer;
}
#fill-btn:hover { background: #1d4ed8; }
#fill-btn:disabled { background: #94a3b8; cursor: not-allowed; }
```

- [ ] **Step 3: Create popup.js**

```javascript
const statusEl = document.getElementById('status');
const fillBtn = document.getElementById('fill-btn');

fillBtn.addEventListener('click', async () => {
  fillBtn.disabled = true;
  statusEl.textContent = '正在获取简历数据...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    statusEl.textContent = '未找到当前标签页';
    fillBtn.disabled = false;
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: MSG.START_FILL }, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = '请在招聘网站上使用此功能';
      fillBtn.disabled = false;
    }
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.FILL_PROGRESS) {
    statusEl.textContent = message.status;
  }
  if (message.type === MSG.FILL_COMPLETE) {
    statusEl.textContent = message.summary;
    fillBtn.disabled = false;
  }
  if (message.type === MSG.FILL_ERROR) {
    statusEl.textContent = '错误: ' + message.error;
    fillBtn.disabled = false;
  }
  return true;
});
```

- [ ] **Step 4: Verify popup loads**

Run: Load extension in Chrome, click icon, confirm popup renders with title and button.
Expected: Popup shows "Resume Auto-fill" heading, status area, and blue "一键填充" button.

---

### Task 4: Field Scanner

**Files:**
- Create: `chrome-extension/content/field-scanner.js`

- [ ] **Step 1: Write field-scanner.js**

```javascript
const FieldScanner = {
  scan() {
    const fields = [];
    const seen = new Set();

    const formElements = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select, [contenteditable="true"]'
    );

    formElements.forEach(el => {
      if (!this._isVisible(el)) return;
      const fieldId = this._generateId(el);
      if (seen.has(fieldId)) return;
      seen.add(fieldId);

      fields.push({
        fieldId,
        type: this._detectType(el),
        label: this._resolveLabel(el),
        placeholder: el.placeholder || '',
        options: this._extractOptions(el),
        required: el.required || el.getAttribute('aria-required') === 'true' || false,
        containerText: this._getContainerText(el),
        section: this._detectSection(el),
      });
    });

    return fields;
  },

  scanSections() {
    const sections = [];
    const headings = document.querySelectorAll('h2, h3, fieldset legend, .section-title, [class*="section"]');
    headings.forEach(h => {
      const text = h.textContent.trim();
      if (text && text.length < 50) {
        const sectionEl = h.closest('fieldset') || h.parentElement;
        const addBtn = sectionEl.querySelector(
          'button:not([type="submit"]), [role="button"], a[href="#"]'
        );
        let addButton = false;
        if (addBtn) {
          const btnText = addBtn.textContent.trim();
          if (/^\+$|添加|新增|展开|add/i.test(btnText)) {
            addButton = true;
          }
        }
        const cards = sectionEl.querySelectorAll('[class*="card"], [class*="item"], [class*="entry"], [class*="record"]');
        sections.push({
          name: text,
          currentCount: cards.length || 1,
          addButton,
        });
      }
    });
    return sections;
  },

  _generateId(el) {
    return el.id || el.name || el.getAttribute('data-field') || `auto_${Math.random().toString(36).slice(2, 8)}`;
  },

  _detectType(el) {
    if (el.hasAttribute('contenteditable')) return 'text';
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    const type = (el.type || 'text').toLowerCase();
    if (['radio'].includes(type)) return 'radio';
    if (['checkbox'].includes(type)) return 'checkbox';
    if (['file'].includes(type)) return 'file';
    if (['date', 'month', 'week'].includes(type)) return 'date';
    return 'text';
  },

  _resolveLabel(el) {
    if (el.labels && el.labels.length > 0) return el.labels[0].textContent.trim();

    const ariaLabelledby = el.getAttribute('aria-labelledby');
    if (ariaLabelledby) {
      const labelEl = document.getElementById(ariaLabelledby);
      if (labelEl) return labelEl.textContent.trim();
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    let node = el.previousElementSibling;
    while (node) {
      const text = node.textContent.trim();
      if (text && text.length < 200) return text;
      node = node.previousElementSibling;
    }

    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) return legend.textContent.trim();
    }

    return '';
  },

  _extractOptions(el) {
    if (el.tagName.toLowerCase() === 'select') {
      return Array.from(el.options).map(o => o.textContent.trim()).filter(Boolean);
    }
    if (['radio', 'checkbox'].includes(el.type)) {
      const name = el.name;
      if (!name) return [];
      return Array.from(document.querySelectorAll(`input[name="${CSS.escape(name)}"]`))
        .map(r => {
          const label = r.closest('label');
          return label ? label.textContent.trim() : r.value;
        })
        .filter(Boolean);
    }
    return [];
  },

  _getContainerText(el) {
    const parent = el.closest('fieldset, .form-group, .form-item, .field, [class*="field"], [class*="form"]');
    return parent ? parent.textContent.trim().substring(0, 500) : '';
  },

  _detectSection(el) {
    let current = el;
    while (current) {
      const heading = current.querySelector('h2, h3, legend');
      if (heading) return heading.textContent.trim();
      current = current.previousElementSibling;
    }
    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) return legend.textContent.trim();
    }
    return '';
  },

  _isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  },
};
```

- [ ] **Step 2: Test scanner in browser console**

Run: Load a test page with a form. Call `FieldScanner.scan()` in console.
Expected: Returns array of field objects with fieldId, type, label, section populated.

---

### Task 5: Section Manager

**Files:**
- Create: `chrome-extension/content/section-manager.js`

- [ ] **Step 1: Write section-manager.js**

```javascript
const SectionManager = {
  MAX_EXPANSIONS: 20,
  MAX_DEPTH: 3,
  EXPAND_TIMEOUT: 3000,

  expansionCount: 0,
  depth: 0,

  reset() {
    this.expansionCount = 0;
    this.depth = 0;
  },

  async executeActions(sectionActions) {
    for (const [sectionName, action] of Object.entries(sectionActions)) {
      if (!action.startsWith('add_')) continue;
      const count = parseInt(action.split('_')[1], 10);
      if (count <= 0) continue;

      for (let i = 0; i < count; i++) {
        if (this.expansionCount >= this.MAX_EXPANSIONS) return;
        if (this.depth >= this.MAX_DEPTH) return;

        const btn = this._findAddButton(sectionName);
        if (!btn || !this._isVisible(btn)) break;

        btn.click();
        this.expansionCount++;

        const changed = await this._waitForDomChange(this.EXPAND_TIMEOUT);
        if (!changed) break;
      }
    }
  },

  collectSectionInfo() {
    const sections = [];
    const seen = new Set();

    const headings = document.querySelectorAll('h2, h3, h4, fieldset legend, [class*="section-title"], [class*="step-title"]');
    headings.forEach(h => {
      const text = h.textContent.trim();
      if (!text || text.length > 50 || seen.has(text)) return;
      seen.add(text);

      const container = h.closest('fieldset') || h.closest('[class*="section"]') || h.parentElement;
      let addButton = false;
      let currentCount = 1;

      if (container) {
        const addBtn = Array.from(container.querySelectorAll('button, [role="button"], a[href="#"]')).find(btn => {
          const t = btn.textContent.trim();
          return /^\+$|添加|新增|展开|add/i.test(t) && this._isVisible(btn);
        });
        addButton = !!addBtn;

        const cards = container.querySelectorAll('[class*="card"], [class*="item"], [class*="entry"], [class*="record"], [class*="block"]');
        if (cards.length > 0) currentCount = cards.length;
      }

      sections.push({ name: text, currentCount, addButton });
    });

    return sections;
  },

  _findAddButton(sectionName) {
    const headings = document.querySelectorAll('h2, h3, h4, legend');
    for (const h of headings) {
      if (!h.textContent.includes(sectionName)) continue;
      const container = h.closest('fieldset') || h.closest('[class*="section"]') || h.parentElement;
      if (!container) continue;
      const btn = Array.from(container.querySelectorAll('button, [role="button"], a[href="#"]')).find(b => {
        return /^\+$|添加|新增|展开|add/i.test(b.textContent.trim());
      });
      if (btn) return btn;
    }
    return null;
  },

  _waitForDomChange(timeout) {
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve(true);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeout);
    });
  },

  _isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  },
};
```

- [ ] **Step 2: Verify exports**

Run: Review file for syntax errors.
Expected: `SectionManager` global available with `executeActions`, `collectSectionInfo`, `reset` methods.

---

### Task 6: Fill Engine & Handlers

**Files:**
- Create: `chrome-extension/content/handlers/text-handler.js`
- Create: `chrome-extension/content/handlers/select-handler.js`
- Create: `chrome-extension/content/handlers/date-handler.js`
- Create: `chrome-extension/content/handlers/choice-handler.js`
- Create: `chrome-extension/content/handlers/upload-handler.js`
- Create: `chrome-extension/content/fill-engine.js`

- [ ] **Step 1: Write text-handler.js**

```javascript
const TextHandler = {
  canHandle(field) {
    return ['text', 'textarea'].includes(field.type);
  },

  fill(el, value) {
    el.focus();
    el.value = '';

    if (el.hasAttribute('contenteditable')) {
      el.innerHTML = value;
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return el.value === value || el.innerHTML === value;
  },
};
```

- [ ] **Step 2: Write select-handler.js**

```javascript
const SelectHandler = {
  canHandle(field) {
    return field.type === 'select';
  },

  async fill(el, value) {
    if (el.tagName.toLowerCase() === 'select') {
      return this._fillNative(el, value);
    }
    return this._fillCustom(el, value);
  },

  _fillNative(el, value) {
    for (const opt of el.options) {
      if (opt.textContent.trim() === value || opt.value === value) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }

    const partial = Array.from(el.options).find(o => o.textContent.includes(value) || value.includes(o.textContent));
    if (partial) {
      el.value = partial.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  },

  async _fillCustom(el, value) {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise(r => setTimeout(r, 300));

    const dropdown = document.querySelector('[class*="dropdown"]:not([style*="display: none"]), [class*="select"]:not([style*="display: none"]), [role="listbox"]');
    if (dropdown) {
      const items = dropdown.querySelectorAll('[role="option"], li, div');
      for (const item of items) {
        if (item.textContent.trim() === value) {
          item.click();
          return true;
        }
      }
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value === value;
  },
};
```

- [ ] **Step 3: Write date-handler.js**

```javascript
const DateHandler = {
  canHandle(field) {
    return field.type === 'date';
  },

  fill(el, value) {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();

    if (el.value === value) return true;

    el.click();
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();

    return el.value === value;
  },
};
```

- [ ] **Step 4: Write choice-handler.js**

```javascript
const ChoiceHandler = {
  canHandle(field) {
    return ['radio', 'checkbox'].includes(field.type);
  },

  fill(el, value) {
    const name = el.name || el.getAttribute('data-group');
    if (!name) return false;

    const values = Array.isArray(value) ? value : [value];
    const group = document.querySelectorAll(`input[name="${CSS.escape(name)}"]`);
    let matched = false;

    group.forEach(input => {
      const label = input.closest('label');
      const labelText = label ? label.textContent.trim() : input.value;

      if (values.some(v => labelText === v || labelText.includes(v) || v.includes(labelText))) {
        if (!input.checked) {
          input.click();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        matched = true;
      } else if (input.type === 'checkbox') {
        if (input.checked) {
          input.click();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });

    return matched;
  },
};
```

- [ ] **Step 5: Write upload-handler.js**

```javascript
const UploadHandler = {
  canHandle(field) {
    return field.type === 'file';
  },

  fill(el, value) {
    return false;
  },
};
```

- [ ] **Step 6: Write fill-engine.js**

```javascript
const FillEngine = {
  INTERVAL_MS: 50,
  MAX_RETRIES: 1,

  handlers: [TextHandler, SelectHandler, DateHandler, ChoiceHandler, UploadHandler],

  skipped: [],

  reset() {
    this.skipped = [];
  },

  async fillAll(mappings) {
    const entries = Object.entries(mappings);
    let filled = 0;

    for (let i = 0; i < entries.length; i++) {
      const [fieldId, value] = entries[i];

      if (i > 0) {
        await new Promise(r => setTimeout(r, this.INTERVAL_MS));
      }

      const el = this._findElement(fieldId);
      if (!el) {
        this.skipped.push({ fieldId, reason: `未找到元素 ${fieldId}` });
        continue;
      }

      const handler = this.handlers.find(h => h.canHandle({ type: this._detectType(el) }));
      if (!handler) {
        this.skipped.push({ fieldId, reason: `不支持的控件类型: ${el.type || el.tagName}` });
        continue;
      }

      let success = await handler.fill(el, value);

      if (!success) {
        success = await handler.fill(el, value);
      }

      if (!success) {
        const label = this._getLabel(el);
        this.skipped.push({ fieldId, label, reason: `设置值 "${value}" 失败` });
        continue;
      }

      filled++;
    }

    return { filled, skipped: this.skipped };
  },

  _findElement(fieldId) {
    const byId = document.getElementById(fieldId);
    if (byId) return byId;
    const byName = document.querySelector(`[name="${CSS.escape(fieldId)}"]`);
    if (byName) return byName;
    const byData = document.querySelector(`[data-field="${CSS.escape(fieldId)}"]`);
    return byData;
  },

  _detectType(el) {
    if (el.hasAttribute('contenteditable')) return 'text';
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    const type = (el.type || 'text').toLowerCase();
    if (['radio'].includes(type)) return 'radio';
    if (['checkbox'].includes(type)) return 'checkbox';
    if (['file'].includes(type)) return 'file';
    if (['date', 'month', 'week'].includes(type)) return 'date';
    return 'text';
  },

  _getLabel(el) {
    if (el.labels && el.labels.length > 0) return el.labels[0].textContent.trim();
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    let prev = el.previousElementSibling;
    if (prev) return prev.textContent.trim();
    return el.name || el.id || '';
  },
};
```

- [ ] **Step 7: Verify all handler files exist**

Run: `ls chrome-extension/content/handlers/`
Expected: text-handler.js, select-handler.js, date-handler.js, choice-handler.js, upload-handler.js all present.

---

### Task 7: Navigation Detector

**Files:**
- Create: `chrome-extension/content/navigation-detector.js`

- [ ] **Step 1: Write navigation-detector.js**

```javascript
const NavigationDetector = {
  MAX_PAGES: 10,
  NAV_TIMEOUT: 5000,

  previousFieldSignature: '',

  reset() {
    this.previousFieldSignature = '';
  },

  findNextButton() {
    const buttons = document.querySelectorAll('button, a, [role="button"], span[class*="btn"], div[class*="btn"]');

    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = btn.textContent.trim();
      if (/^下一步$|^继续$|^保存并继续$|^Next$/i.test(text)) {
        return btn;
      }
    }

    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = btn.textContent.trim();
      if (text.includes('下一步') || text.includes('继续') || /next/i.test(text)) {
        return btn;
      }
    }

    return null;
  },

  isSubmitOnly() {
    const buttons = document.querySelectorAll('button, a, [role="button"]');
    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = btn.textContent.trim();
      if (/^提交$|^确认$|^保存$|^Submit$|^Confirm$/i.test(text)) {
        return true;
      }
    }
    return false;
  },

  isDuplicatePage(fields) {
    const signature = fields.map(f => `${f.type}:${f.label}`).sort().join('|');
    if (signature && signature === this.previousFieldSignature) {
      return true;
    }
    this.previousFieldSignature = signature;
    return false;
  },

  async clickNext() {
    const btn = this.findNextButton();
    if (!btn) return false;

    btn.click();

    await new Promise(r => setTimeout(r, 1000));

    const changed = await this._waitForDomStable(this.NAV_TIMEOUT);
    return changed;
  },

  _waitForDomStable(timeout) {
    return new Promise(resolve => {
      const start = Date.now();
      let lastChange = start;
      const observer = new MutationObserver(() => { lastChange = Date.now(); });
      observer.observe(document.body, { childList: true, subtree: true });

      const check = setInterval(() => {
        if (Date.now() - lastChange > 1000) {
          clearInterval(check);
          observer.disconnect();
          resolve(true);
        } else if (Date.now() - start > timeout) {
          clearInterval(check);
          observer.disconnect();
          resolve(false);
        }
      }, 200);
    });
  },

  _isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  },
};
```

- [ ] **Step 2: Verify file exists and is syntactically valid**

Run: Open file in editor, check for syntax errors.
Expected: No syntax errors.

---

### Task 8: Result Annotator

**Files:**
- Create: `chrome-extension/content/result-annotator.js`

- [ ] **Step 1: Write result-annotator.js**

```javascript
const ResultAnnotator = {
  show(filledCount, skippedList) {
    this.remove();

    const overlay = document.createElement('div');
    overlay.id = 'resume-autofill-result';
    overlay.innerHTML = this._buildHTML(filledCount, skippedList);

    Object.assign(overlay.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '999999',
      maxWidth: '360px',
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: '10px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      padding: '16px',
      fontFamily: '-apple-system, sans-serif',
      fontSize: '14px',
      lineHeight: '1.5',
      color: '#1f2937',
    });

    document.body.appendChild(overlay);

    overlay.querySelector('#resume-autofill-close').addEventListener('click', () => this.remove());
  },

  remove() {
    const el = document.getElementById('resume-autofill-result');
    if (el) el.remove();
  },

  _buildHTML(filled, skipped) {
    let skippedRows = '';
    if (skipped.length > 0) {
      skippedRows = skipped.map(s => {
        const label = s.label || s.fieldId || '';
        const reason = s.reason || '未知原因';
        return `<li style="margin-bottom:4px"><strong>${this._escape(label)}</strong> — ${this._escape(reason)}</li>`;
      }).join('');
    } else {
      skippedRows = '<li>无</li>';
    }

    return `
      <div style="font-weight:600;font-size:16px;margin-bottom:8px">自动填写完成</div>
      <div style="margin-bottom:6px">已填: <strong>${filled}</strong> 个字段</div>
      <div style="margin-bottom:10px">跳过: <strong>${skipped.length}</strong> 个字段</div>
      <ul style="margin:0 0 12px 0;padding-left:18px;max-height:200px;overflow-y:auto">
        ${skippedRows}
      </ul>
      <button id="resume-autofill-close" style="
        display:block;width:100%;padding:8px;border:none;border-radius:6px;
        background:#2563eb;color:#fff;font-size:14px;cursor:pointer
      ">关闭</button>
    `;
  },

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
```

- [ ] **Step 2: Verify file is syntactically valid**

Run: Review file for syntax errors.
Expected: No syntax errors.

---

### Task 9: Content Script Orchestrator

**Files:**
- Create: `chrome-extension/content/content.js`

- [ ] **Step 1: Write content.js**

```javascript
let running = false;

async function sendProgress(status) {
  try {
    chrome.runtime.sendMessage({ type: MSG.FILL_PROGRESS, status });
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.START_FILL && !running) {
    startFill();
    sendResponse({ received: true });
  }
  return true;
});

async function startFill() {
  running = true;
  FillEngine.reset();
  SectionManager.reset();
  NavigationDetector.reset();

  try {
    let totalFilled = 0;
    let totalSkipped = [];

    const resumeId = await getResumeId();
    if (!resumeId) {
      sendProgress('未配置简历 ID');
      running = false;
      return;
    }

    sendProgress('正在获取简历数据...');
    const resume = await requestResume(resumeId);

    for (let page = 0; page < NavigationDetector.MAX_PAGES; page++) {
      sendProgress(`正在展开板块... (第 ${page + 1} 页)`);

      const sectionInfo = SectionManager.collectSectionInfo();

      sendProgress(`正在扫描字段... (第 ${page + 1} 页)`);
      const fields = FieldScanner.scan();

      if (NavigationDetector.isDuplicatePage(fields)) break;

      sendProgress(`正在匹配字段... (${fields.length} 个字段)`);
      const matchResult = await requestMatch(fields, resume, sectionInfo);

      if (matchResult.sectionActions) {
        await SectionManager.executeActions(matchResult.sectionActions);
      }

      sendProgress(`正在填写... (第 ${page + 1} 页)`);
      const { filled, skipped } = await FillEngine.fillAll(matchResult.mappings);

      totalFilled += filled;
      totalSkipped = totalSkipped.concat(skipped);

      if (NavigationDetector.isSubmitOnly()) break;

      sendProgress(`正在翻到下一页...`);
      const navigated = await NavigationDetector.clickNext();
      if (!navigated) break;
    }

    ResultAnnotator.show(totalFilled, totalSkipped);

    chrome.runtime.sendMessage({
      type: MSG.FILL_COMPLETE,
      summary: `已填: ${totalFilled} 个字段, 跳过: ${totalSkipped.length} 个字段`,
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: MSG.FILL_ERROR,
      error: err.message || '填充过程出错',
    });
  } finally {
    running = false;
  }
}

function getResumeId() {
  return new Promise(resolve => {
    chrome.storage.local.get('resumeId', data => {
      resolve(data.resumeId || null);
    });
  });
}

function requestResume(resumeId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: MSG.REQUEST_RESUME, resumeId },
      response => {
        if (response.type === MSG.RESUME_DATA) resolve(response.data);
        else reject(new Error(response.error || '获取简历失败'));
      }
    );
  });
}

function requestMatch(fields, resume, sections) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: MSG.REQUEST_MATCH, fields, resume, sections },
      response => {
        if (response.type === MSG.MATCH_RESULT) resolve(response.data);
        else reject(new Error(response.error || '字段匹配失败'));
      }
    );
  });
}
```

- [ ] **Step 2: Verify all injections load**

Run: Load extension, navigate to a test form page, open DevTools console.
Expected: No errors from content scripts; all globals (`FieldScanner`, `SectionManager`, `FillEngine`, `NavigationDetector`, `ResultAnnotator`) available.

---

### Task 10: Integration Verification

- [ ] **Step 1: End-to-end test with a mock form**

Create a test HTML file with a multi-step form:

```html
<!DOCTYPE html>
<html>
<head><title>Test Recruitment Form</title></head>
<body>
  <h2>基本信息</h2>
  <label for="name">姓名</label><input id="name" type="text"><br>
  <label for="email">邮箱</label><input id="email" type="text"><br>
  <label for="phone">手机号</label><input id="phone" type="text"><br>
  <button onclick="nextPage()">下一步</button>
  <script>
    function nextPage() {
      document.body.innerHTML = `
        <h2>教育经历</h2>
        <label for="school">学校</label><input id="school" type="text"><br>
        <label for="degree">学历</label><select id="degree">
          <option>本科</option><option>硕士</option><option>博士</option>
        </select><br>
        <button id="add-more">+ 添加更多教育经历</button>
        <button>提交</button>
      `;
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Mock backend with JSON responses**

Create `test-backend.json`:

```json
{
  "name": "张三",
  "email": "zhangsan@example.com",
  "phone": "13800138000",
  "education": [
    { "school": "清华大学", "degree": "硕士" },
    { "school": "北京大学", "degree": "本科" }
  ]
}
```

- [ ] **Step 3: Verify fill flow**

Run: Load extension, open test form, click popup "Fill" button.
Expected:
- Page 1: name, email, phone filled with 50ms intervals
- Auto-click "下一步"
- Page 2: school and degree filled, "添加" clicked once for second education entry
- Result overlay shown with filled/skipped counts

---

### Dependency Order

```
Task 1 (Scaffold)
    ↓
Task 2 (Service Worker) ← depends on Task 1 (message-types)
    ↓
Task 3 (Popup) ← depends on Task 1 (message-types)
    ↓
Task 4 (Field Scanner) ← no code deps, can run in parallel with Task 5
Task 5 (Section Manager) ← no code deps, can run in parallel with Task 4
    ↓
Task 6 (Fill Engine) ← no code deps on 4/5
Task 7 (Navigation Detector) ← no code deps
Task 8 (Result Annotator) ← no code deps
    ↓
Task 9 (Orchestrator) ← depends on Tasks 4-8 (all content modules)
    ↓
Task 10 (Integration) ← depends on all tasks
```

Tasks 4, 5, 6, 7, 8 can be built in parallel.
