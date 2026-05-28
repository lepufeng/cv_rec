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
  assert.match(content, /SectionManager\.executeActions\(firstMatch\.sectionActions\)/);
  assert.match(content, /requestMatch\(expandedFields, resume, expandedSectionInfo, true\)/);
  assert.match(content, /FillEngine\.fillAll\(mappings, activeFields\)/);
  assert.match(content, /describeSkippedFields\(matchSkipped, activeFields, mappings\)/);
});

test('content records a fill report for real-page diagnostics', () => {
  const content = read('content/content.js');

  assert.match(content, /const report = \{/);
  assert.match(content, /initialFieldCount/);
  assert.match(content, /expandedFieldCount/);
  assert.match(content, /backendSkippedCount/);
  assert.match(content, /runtimeSkippedCount/);
  assert.match(content, /resumeAutofillLastReport/);
  assert.match(content, /report,/);
});

test('scanner emits repeat metadata for expanded experience cards', () => {
  const scanner = read('content/field-scanner.js');

  assert.match(scanner, /_annotateRepeatInstances\(fields\)/);
  assert.match(scanner, /repeatGroupId/);
  assert.match(scanner, /repeatIndex/);
  assert.match(scanner, /repeatSize/);
  assert.match(scanner, /repeatSection/);
  assert.match(scanner, /data-moka-field/);
  assert.match(scanner, /data-beisen-field/);
  assert.match(scanner, /atsx-form-item/);
});

test('fill engine uses scanner metadata and keeps unsafe controls skipped', () => {
  const engine = read('content/fill-engine.js');

  assert.match(engine, /fillAll\(mappings, fields\)/);
  assert.match(engine, /fieldsById/);
  assert.match(engine, /this\._safeToFill\(el, field\)/);
  assert.match(engine, /handler\.fill\(el, value, field\)/);
  assert.match(engine, /文件上传需人工处理/);
});

test('select handler supports custom pseudo-radio and dropdown controls', () => {
  const handler = read('content/handlers/select-handler.js');

  assert.match(handler, /field && field\.widget === 'pseudo-radio'/);
  assert.match(handler, /_fillPseudoGroup\(el, value\)/);
  assert.match(handler, /_pseudoOptions\(el\)/);
  assert.match(handler, /_visibleDropdowns\(\)/);
  assert.match(handler, /aria-checked/);
  assert.match(handler, /aria-selected/);
});

test('choice handler can fill standalone wrapped checkboxes', () => {
  const handler = read('content/handlers/choice-handler.js');

  assert.match(handler, /_fillStandalone\(el, values\)/);
  assert.match(handler, /el\.closest\('label'\)/);
  assert.match(handler, /el\.dispatchEvent\(new Event\('change'/);
});

test('section manager counts repeat cards instead of ordinary form items', () => {
  const manager = read('content/section-manager.js');

  assert.match(manager, /REPEAT_ITEM_SELECTOR/);
  assert.match(manager, /_countRepeatItems\(container\)/);
  assert.match(manager, /_collectSectionsFromAddButtons/);
  assert.match(manager, /_deriveSectionNameFromAddText/);
  assert.match(manager, /if \(!this\._isVisible\(h\)\) return/);
  assert.match(manager, /moka/);
  assert.match(manager, /beisen/);
  assert.match(manager, /atsx/);
});

test('navigation detector skips final submit style buttons', () => {
  const detector = read('content/navigation-detector.js');

  assert.match(detector, /FINAL_SUBMIT_REGEX/);
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
