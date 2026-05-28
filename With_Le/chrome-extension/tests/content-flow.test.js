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

test('scanner emits repeat metadata for expanded experience cards', () => {
  const scanner = read('content/field-scanner.js');

  assert.match(scanner, /_annotateRepeatInstances\(fields\)/);
  assert.match(scanner, /repeatGroupId/);
  assert.match(scanner, /repeatIndex/);
  assert.match(scanner, /repeatSize/);
  assert.match(scanner, /repeatSection/);
});

test('fill engine uses scanner metadata and keeps unsafe controls skipped', () => {
  const engine = read('content/fill-engine.js');

  assert.match(engine, /fillAll\(mappings, fields\)/);
  assert.match(engine, /fieldsById/);
  assert.match(engine, /this\._safeToFill\(el, field\)/);
  assert.match(engine, /文件上传需人工处理/);
});

test('section manager counts repeat cards instead of ordinary form items', () => {
  const manager = read('content/section-manager.js');

  assert.match(manager, /REPEAT_ITEM_SELECTOR/);
  assert.match(manager, /_countRepeatItems\(container\)/);
  assert.match(manager, /_collectSectionsFromAddButtons/);
  assert.match(manager, /_deriveSectionNameFromAddText/);
});

test('navigation detector skips final submit style buttons', () => {
  const detector = read('content/navigation-detector.js');

  assert.match(detector, /FINAL_SUBMIT_REGEX/);
  assert.match(detector, /if \(this\._looksLikeFinalSubmit\(text\)\) continue/);
  assert.match(detector, /if \(this\.findNextButton\(\)\) return false/);
});
