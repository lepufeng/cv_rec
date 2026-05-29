const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(extensionRoot, relativePath), 'utf8');
}

test('content direct fill force-refreshes before and after dynamic expansion', () => {
  const content = read('content/content.js');

  assert.match(content, /requestMatch\(initialFields, resume, sectionInfo, true\)/);
  assert.match(content, /pageReport\.sectionActionResults = await SectionManager\.executeActions\(firstMatch\.sectionActions\)/);
  assert.match(content, /requestMatch\(expandedFields, resume, expandedSectionInfo, true\)/);
  assert.match(content, /payload: pagePayload\(fields, forceRefresh\)/);
  assert.match(content, /url: location\.href/);
  assert.match(content, /frames: \[\{/);
  assert.match(content, /FillEngine\.fillAll\(mappings, activeFields\)/);
  assert.match(content, /describeSkippedFields\(matchSkipped, activeFields, mappings\)/);
});

test('content records a fill report for real-page diagnostics', () => {
  const content = read('content/content.js');

  assert.match(content, /const report = \{/);
  assert.match(content, /initialFieldCount/);
  assert.match(content, /expandedFieldCount/);
  assert.match(content, /sectionActionResults/);
  assert.match(content, /backendSkippedCount/);
  assert.match(content, /runtimeSkippedCount/);
  assert.match(content, /resumeAutofillLastReport/);
  assert.match(content, /report,/);
});

test('scanner emits repeat metadata for expanded experience cards', () => {
  const scanner = read('content/field-scanner.js');

  assert.match(scanner, /\[contenteditable\]:not\(\[contenteditable="false"\]\)/);
  assert.match(scanner, /_annotateRepeatInstances\(fields\)/);
  assert.match(scanner, /repeatGroupId/);
  assert.match(scanner, /repeatIndex/);
  assert.match(scanner, /repeatSize/);
  assert.match(scanner, /repeatSection/);
  assert.match(scanner, /data-moka-field/);
  assert.match(scanner, /data-beisen-field/);
  assert.match(scanner, /atsx-form-item/);
  assert.match(scanner, /\.send_title/);
  assert.match(scanner, /\.info_box/);
  assert.match(scanner, /data-field-list-item/);
  assert.match(scanner, /_REPEAT_FIELD_LABEL_HINT_REGEX/);
  assert.match(scanner, /_repeatFieldSignaturesMatch\(a, b\)/);
  assert.match(scanner, /_inferRepeatSectionFromItem\(item\)/);
  assert.match(scanner, /data-form-field-id/);
  assert.match(scanner, /_extractFieldMetadata\(ctrl, widget\)/);
  assert.match(scanner, /out\.frameUrl = location\.href/);
  assert.match(scanner, /isSearchableSelect/);
  assert.match(scanner, /_DATE_RANGE_HINT_CLASS/);
  assert.match(scanner, /_looksLikeReadonlySelectLabel\(label\)/);
  assert.match(scanner, /if \(!this\._isVisible\(t\)\) continue/);
});

test('fill engine uses scanner metadata and keeps unsafe controls skipped', () => {
  const engine = read('content/fill-engine.js');

  assert.match(engine, /fillAll\(mappings, fields\)/);
  assert.match(engine, /this\._orderedEntries\(mappings, fields\)/);
  assert.match(engine, /fieldsById/);
  assert.match(engine, /this\._safeToFill\(el, field\)/);
  assert.match(engine, /handler\.fill\(el, value, field\)/);
  assert.match(engine, /文件上传需人工处理/);
  assert.match(engine, /字段为只读，跳过自动覆盖/);
  assert.match(engine, /_isPlainReadonlyField\(el, field\)/);
  assert.match(engine, /_hasReadonlyWidgetAffordance\(el, field\)/);
  assert.match(engine, /_skipRecord\(fieldId, field, el, value, reason\)/);
  assert.match(engine, /attemptedValuePreview/);
  assert.match(engine, /repeatSection/);
  assert.match(engine, /\[文件路径已隐藏\]/);
});

test('diagnostic report preserves field context for skipped fields', () => {
  const content = read('content/content.js');
  const popup = read('popup/popup.js');
  const annotator = read('content/result-annotator.js');

  assert.match(content, /fieldReportRecord\(fieldId, field, reason\)/);
  assert.match(content, /copyFieldProp\(record, field, 'repeatIndex'\)/);
  assert.match(content, /copyFieldProp\(record, field, 'widget'\)/);
  assert.match(popup, /skipContextText\(item\)/);
  assert.match(popup, /attemptedValuePreview/);
  assert.match(annotator, /_contextText\(item\)/);
});

test('text handler supports framework-backed rich text editors', () => {
  const handler = read('content/handlers/text-handler.js');
  const dom = read('shared/dom-utils.js');

  assert.match(handler, /_fillContentEditable\(el, str\)/);
  assert.match(handler, /document\.execCommand\('insertText', false, str\)/);
  assert.match(handler, /_looksLikeParagraphEditor\(el\)/);
  assert.match(handler, /ProseMirror\|ql-editor\|rich\|editor/);
  assert.match(dom, /fireTextCommitEvents\(el, value\)/);
  assert.match(dom, /new InputEvent\('beforeinput'/);
});

test('select handler supports custom pseudo-radio and dropdown controls', () => {
  const handler = read('content/handlers/select-handler.js');

  assert.match(handler, /field && field\.widget === 'pseudo-radio'/);
  assert.match(handler, /_fillPseudoGroup\(el, value\)/);
  assert.match(handler, /_pseudoOptions\(el\)/);
  assert.match(handler, /_visibleDropdowns\(\)/);
  assert.match(handler, /_waitForDropdownMatch\(str\)/);
  assert.match(handler, /DROPDOWN_WAIT_MS/);
  assert.match(handler, /_bestDropdownOption\(dropdown, value\)/);
  assert.match(handler, /_dropdownOptions\(dropdown\)/);
  assert.match(handler, /_fillCascaderValue\(el, str\)/);
  assert.match(handler, /_commitByKeyboard\(target, el, str, field\)/);
  assert.match(handler, /_requiresCommittedOption\(field\)/);
  assert.match(handler, /_valueAccepted\(el, target, str, match, false\)/);
  assert.match(handler, /_values\(value, field\)/);
  assert.match(handler, /_looksLikeMultiValueField\(field\)/);
  assert.match(handler, /\[role="treeitem"\]/);
  assert.match(handler, /data-value/);
  assert.match(handler, /aria-checked/);
  assert.match(handler, /aria-selected/);
});

test('date handler normalizes resume dates for native date widgets', () => {
  const handler = read('content/handlers/date-handler.js');

  assert.match(handler, /_candidateValues\(value, el, field\)/);
  assert.match(handler, /_fillViaPicker\(el, target, values\)/);
  assert.match(handler, /_fillRangeViaPicker\(el, target, rangeValues\)/);
  assert.match(handler, /_rangeValues\(value\)/);
  assert.match(handler, /_matchesRangeValue\(target, rangeValues\)/);
  assert.match(handler, /_visibleDateDropdowns\(\)/);
  assert.match(handler, /_optionCandidates\(value\)/);
  assert.match(handler, /inputType === 'month'/);
  assert.match(handler, /inputType === 'date'/);
  assert.match(handler, /_wantsYearOnly\(el, field\)/);
  assert.match(handler, /YYYY/);
  assert.match(handler, /for \(const key of \['Enter', 'Tab'\]\)/);
});

test('choice handler can fill standalone wrapped checkboxes', () => {
  const handler = read('content/handlers/choice-handler.js');

  assert.match(handler, /\(el\.type \|\| ''\)\.toLowerCase\(\) === 'checkbox'/);
  assert.match(handler, /_fillStandalone\(el, values\)/);
  assert.match(handler, /el\.closest\('label'\)/);
  assert.match(handler, /el\.dispatchEvent\(new Event\('change'/);
});

test('section manager counts repeat cards instead of ordinary form items', () => {
  const manager = read('content/section-manager.js');

  assert.match(manager, /REPEAT_ITEM_SELECTOR/);
  assert.match(manager, /_countRepeatItems\(container\)/);
  assert.match(manager, /_collectSectionsFromAddButtons/);
  assert.match(manager, /_collectSectionsFromDataContainers/);
  assert.match(manager, /SECTION_ATTRS/);
  assert.match(manager, /_findAddTarget\(sectionName\)/);
  assert.match(manager, /_containerForDirectAddButton\(direct, sectionName\)/);
  assert.match(manager, /_matchingHeadingText\(cur, sectionName\)/);
  assert.match(manager, /_waitForCountIncrease\(container, beforeCount, this\.EXPAND_TIMEOUT\)/);
  assert.match(manager, /_repeatItemCandidates\(container, \{ visibleOnly: true \}\)/);
  assert.match(manager, /_leafRepeatCandidates\(hiddenCandidates\)/);
  assert.match(manager, /_clearEmptySectionToggle\(sectionName\)/);
  assert.match(manager, /_hasClearableEmptyToggle\(sectionName\)/);
  assert.match(manager, /clearedEmptyToggle/);
  assert.match(manager, /status: 'skipped'/);
  assert.match(manager, /_deriveSectionNameFromAddText/);
  assert.match(manager, /if \(!this\._isVisible\(h\)\) return/);
  assert.match(manager, /data-field-list-item/);
  assert.match(manager, /moka/);
  assert.match(manager, /beisen/);
  assert.match(manager, /atsx/);
  assert.match(manager, /\.send_title/);
  assert.match(manager, /\.info_list/);
  assert.match(manager, /\.experience_box/);
  assert.match(manager, /employment/);
  assert.match(manager, /_normalizeText\(text\)/);
});

test('navigation detector skips final submit style buttons', () => {
  const detector = read('content/navigation-detector.js');

  assert.match(detector, /FINAL_SUBMIT_REGEX/);
  assert.match(detector, /NEXT_TEXT_REGEX/);
  assert.match(detector, /HARD_FINAL_REGEX/);
  assert.match(detector, /_buttonText\(btn\)/);
  assert.match(detector, /_looksLikeExactNext\(text\)/);
  assert.match(detector, /if \(this\._looksLikeFinalSubmit\(text\)\) continue/);
  assert.match(detector, /if \(this\.findNextButton\(\)\) return false/);
});

test('dom utils ignores controls hidden by ancestor pages', () => {
  const domUtils = read('shared/dom-utils.js');

  assert.match(domUtils, /cur\.parentElement/);
  assert.match(domUtils, /curStyle\.display === 'none'/);
  assert.match(domUtils, /cur !== el && \(curStyle\.visibility === 'hidden'/);
  assert.match(domUtils, /rect\.width <= 0 && rect\.height <= 0/);
  assert.match(domUtils, /type === 'radio' \|\| type === 'checkbox'/);
});
