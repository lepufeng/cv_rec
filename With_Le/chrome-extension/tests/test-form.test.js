const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(extensionRoot, 'test-form.html'), 'utf8');

test('local test form covers Feishu recruiting markers', () => {
  assert.match(html, /Feishu Recruiting Form Test/);
  assert.match(html, /feishu-form-section/);
  assert.match(html, /data-form-field-i18n-name/);
  assert.match(html, /applyFormModuleWrapper/);
  assert.match(html, /ud__select/);
});

test('local test form covers Feishu dynamic project flow', () => {
  assert.match(html, /项目经历/);
  assert.match(html, /id="project-list"/);
  assert.match(html, /class="[^"]*project-card/);
  assert.match(html, /id="add-project"/);
  assert.match(html, /项目名称/);
  assert.match(html, /项目角色/);
  assert.match(html, /技术栈/);
  assert.match(html, /项目成果/);
});

test('local test form covers custom controls and final submit safety', () => {
  assert.match(html, /id="referral-method"/);
  assert.match(html, /class="radio-item"/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /id="resume-file"/);
  assert.match(html, /id="final-submit"/);
  assert.match(html, /ERROR: final submit was clicked/);
});
