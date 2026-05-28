const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(extensionRoot, 'test-form.html'), 'utf8');
const testingDoc = fs.readFileSync(path.join(extensionRoot, 'TESTING.md'), 'utf8');

test('local test form covers Moka, Feishu and Beisen ATS markers', () => {
  assert.match(html, /Moka \/ Feishu \/ Beisen/);
  assert.match(html, /moka-form-section/);
  assert.match(html, /data-moka-field/);
  assert.match(html, /feishu-form-section/);
  assert.match(html, /data-form-field-i18n-name/);
  assert.match(html, /beisen-section/);
  assert.match(html, /beisen-resume-item/);
});

test('local test form covers multi-ATS dynamic project flow', () => {
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

test('local ATS test instructions cover expected safety checks', () => {
  assert.match(testingDoc, /Moka, Feishu and Beisen/);
  assert.match(testingDoc, /python3 -m http\.server 8090/);
  assert.match(testingDoc, /must not click `提交投递`/);
  assert.match(testingDoc, /复制诊断报告/);
  assert.match(testingDoc, /stopReason: submit_only/);
});
