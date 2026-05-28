# Acceptance Criteria: Chrome Extension Resume Auto-fill

**Spec:** `docs/superpowers/specs/2026-05-22-chrome-extension-resume-autofill-design.md`
**Date:** 2026-05-22
**Status:** Approved

---

## Criteria

### Popup & Trigger

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-001 | User clicks "Fill" button in popup to start auto-fill | UI interaction | Extension installed, user on a recruitment form page, resume data available from backend | Popup sends "start fill" message to content script; content script begins field scanning |

### Field Scanner

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-002 | Scanner detects all form fields on the current page | Logic | Page contains a mix of input, textarea, select, radio, checkbox, date, and file inputs | All form elements are collected; each entry has fieldId, type, label, and section fields populated |
| AC-003 | Scanner resolves label via explicit `<label for="id">` | Logic | Page has `<label for="email">邮箱</label><input id="email">` | Field label = "邮箱" |
| AC-004 | Scanner resolves label via wrapping `<label>` | Logic | Page has `<label>姓名<input></label>` | Field label = "姓名" |
| AC-005 | Scanner resolves label via nearest visible text node | Logic | Page has `<span>手机号</span><input>` | Field label = "手机号" |
| AC-006 | Scanner resolves label via aria-label | Logic | Page has `<input aria-label="出生日期">` | Field label = "出生日期" |
| AC-007 | Scanner resolves label via fieldset legend | Logic | Page has `<fieldset><legend>教育经历</legend>...<input></fieldset>` | Field label falls back to "教育经历" if no closer label found |
| AC-008 | Scanner assigns fields to sections based on preceding headings | Logic | Page has `<h3>基本信息</h3>...inputs...<h3>教育经历</h3>...inputs` | Fields after "基本信息" before "教育经历" have section = "基本信息"; fields after "教育经历" have section = "教育经历" |
| AC-009 | Scanner extracts options from select/radio/checkbox fields | Logic | Page has `<select><option>A</option><option>B</option></select>` | Field options = ["A", "B"] |

### Section Manager

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-010 | Section Manager sends repeatable section info to LLM for decision | Logic | Page has "教育经历" section with 1 visible card and an "添加" button; resume has 2 education entries | LLM receives section info with currentCount=1 and addButton=true |
| AC-011 | Section Manager executes LLM-returned add action (add_1) | UI interaction | LLM returns `{ "教育经历": "add_1" }` | Content script clicks "添加" button exactly 1 time for the "教育经历" section |
| AC-012 | Section Manager executes add_0 (no addition) | UI interaction | LLM returns `{ "教育经历": "add_0" }` | "添加" button is NOT clicked; section remains as-is |
| AC-013 | Section Manager does not expand more than 20 total sections | UI interaction | LLM returns instructions to add more than 20 times across sections | Expansion stops at 20; remaining actions are skipped; fill continues |
| AC-014 | Section Manager does not recurse deeper than 3 levels | UI interaction | Nested expandable sections deeper than 3 levels | Expansion stops at level 3; deeper sections skipped |
| AC-015 | Section Manager skips non-visible "Add" buttons | UI interaction | "添加" button exists in DOM but is `display: none` | Button is skipped, no expansion attempted |
| AC-016 | Section Manager times out after 3s waiting for DOM change | UI interaction | Click "添加" but DOM never updates | Section marked as failed after 3s; fill continues with remaining fields |

### Fill Engine — General

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-017 | Fill Engine respects 50ms fixed interval between field operations | Logic | Queue of 3 fields to fill | Timestamps between fills are exactly 50ms apart (±5ms tolerance) |
| AC-018 | Fill Engine retries once with alternative method on failure | Logic | First fill attempt for a field fails (value not applied) | Second attempt uses alternative method; if still fails, field is skipped |
| AC-019 | Fill Engine skips field after retry exhaustion | Logic | Both fill attempts fail for a field | Field added to skipped list; fill continues to next field |

### Fill Engine — TextHandler

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-020 | TextHandler fills `<input type="text">` | UI interaction | Text input with label "姓名" | Input receives focus → value set → 'input' event dispatched → 'change' event dispatched |
| AC-021 | TextHandler fills `<textarea>` | UI interaction | Textarea for "自我评价" | Textarea value set → 'input' event dispatched → 'change' event dispatched |
| AC-022 | TextHandler fills contenteditable div | UI interaction | `<div contenteditable="true">` used as rich text editor | innerHTML set → 'input' event dispatched |

### Fill Engine — SelectHandler

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-023 | SelectHandler fills native `<select>` by matching option text | UI interaction | `<select><option>本科</option><option>硕士</option></select>`, resume value = "本科" | Select value set to "本科" → 'change' event dispatched |
| AC-024 | SelectHandler fills searchable custom dropdown | UI interaction | Custom searchable dropdown for "学校", resume value = "清华大学" | Input focused → "清华大学" typed → dropdown appears → matching item clicked |

### Fill Engine — DateHandler

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-025 | DateHandler fills native `<input type="date">` | UI interaction | `<input type="date">`, resume value = "2020-06-15" | Input value set to "2020-06-15" → 'change' event dispatched |
| AC-026 | DateHandler attempts custom date picker fallback | UI interaction | Custom date picker component, no native date input | Input value set directly → if ineffective, simulate click to open calendar and select date |

### Fill Engine — ChoiceHandler

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-027 | ChoiceHandler selects radio by matching label | UI interaction | Radio group "性别": `<input type="radio" value="male">男</input>`, resume value = "男" | Radio next to "男" label is clicked |
| AC-028 | ChoiceHandler selects multiple checkboxes | UI interaction | Checkbox group "技能": Python/Java/Go, resume skills = ["Python", "Go"] | Checkboxes for "Python" and "Go" are checked; "Java" remains unchecked |

### Fill Engine — UploadHandler

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-029 | UploadHandler skips file input and marks for manual upload | UI interaction | `<input type="file">` for "附件简历" | Field is NOT programmatically filled; added to skipped list with message "请手动上传文件：[filename]" |

### Multi-page Navigation

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-030 | Navigation Detector finds and clicks "下一步" button | UI interaction | All fields on current page filled; "下一步" button present | Button clicked → wait for DOM change → new page loaded → scanning resumes |
| AC-031 | Navigation Detector finds and clicks "保存并继续" button | UI interaction | Button text = "保存并继续" | Button clicked → navigation proceeds |
| AC-032 | Navigation Detector identifies "提交" as final page | UI interaction | All fields filled; only "提交" button found (no "下一步") | Button NOT clicked; fill stops; result annotation displayed |
| AC-033 | Navigation Detector detects duplicate field structure as final page | UI interaction | Two consecutive pages have identical field signatures | Fill stops at second identical page; result annotation displayed |
| AC-034 | Navigation stops after maximum 10 pages | UI interaction | Form has more than 10 steps | Fill stops after page 10; result annotation displayed |
| AC-035 | Navigation times out after 5s of no DOM change | UI interaction | "下一步" clicked but page never changes | Fill stops; skipped fields annotated; user notified of timeout |

### Error Handling

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-036 | Backend request retried once on timeout | Logic | First POST to `/api/match-fields` times out | Second request sent; if succeeds, fill proceeds; if also fails, fill aborts with user notification |
| AC-037 | Unknown control type marked as skipped | Logic | Page has a novel input type not in the handler registry | Field recorded as type "unknown" and skipped |
| AC-038 | Field fill continues after individual field failure | UI interaction | One field fails to fill (e.g., broken custom component) | That field is skipped; next field in queue is processed |

### Result Annotation

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-039 | Result overlay shows filled and skipped counts | UI interaction | Fill complete: 12 filled, 3 skipped | Overlay displays "已填: 12 个字段" and "跳过: 3 个字段" |
| AC-040 | Result overlay lists each skipped field with reason | UI interaction | Fields skipped: "附件简历" (file upload), "期望薪资" (no data) | Overlay lists both fields with respective reasons |
| AC-041 | Result overlay can be dismissed | UI interaction | Overlay displayed, user clicks "关闭" | Overlay removed from DOM |

### Backend API

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-042 | GET resume returns JSON by resume ID | API | Valid resume ID | Response status 200; body is structured resume JSON |
| AC-043 | POST match-fields accepts field metadata + resume + sections | API | Valid request body | Response includes `mappings`, `sectionActions`, and `skipped` arrays |
| AC-044 | POST match-fields returns section actions in correct format | API | Resume has 2 education entries; page has 1 visible card with "添加" button | `sectionActions` contains `{ "教育经历": "add_1" }` |

### Content Script — Streaming & Coordination

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-045 | Content script fills all pages of a multi-page form | UI interaction | 3-page form, resume has data for all fields | After filling page 1 → auto-navigate → fill page 2 → auto-navigate → fill page 3 → display result overlay |
| AC-046 | Service Worker caches resume data during fill session | Logic | Resume fetched from backend for page 1 | Page 2 does not re-fetch resume; uses cached data |
