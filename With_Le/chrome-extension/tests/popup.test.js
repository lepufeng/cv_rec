const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');
const popupHtml = fs.readFileSync(path.join(extensionRoot, 'popup/popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(extensionRoot, 'popup/popup.js'), 'utf8');

test('popup exposes the product-preview connection controls', () => {
  for (const id of [
    'open-platform-btn',
    'save-settings-btn',
    'platform-home',
    'backend-base',
    'auth-token',
    'resume-id',
    'fill-btn',
    'scan-btn',
  ]) {
    assert.match(popupHtml, new RegExp(`id="${id}"`));
  }

  assert.match(popupHtml, /打开主页/);
  assert.match(popupHtml, /保存配置/);
  assert.match(popupHtml, /生成填表方案/);
  assert.match(popupHtml, /仅扫描并校验字段/);
});

test('popup preview flow calls match and scan APIs without starting real fill', () => {
  assert.match(popupJs, /chrome\.tabs\.create\(\{ url: settings\.platformHome \}\)/);
  assert.match(popupJs, /type: MSG\.REQUEST_MATCH/);
  assert.match(popupJs, /type: MSG\.UPLOAD_SCAN/);
  assert.match(popupJs, /renderPlanPreview/);
  assert.match(popupJs, /请先在插件中粘贴网页登录 token/);

  assert.doesNotMatch(popupJs, /START_FILL/);
  assert.doesNotMatch(popupJs, /__resumeAutofillStart/);
  assert.doesNotMatch(popupJs, /triggerFillInAllFrames/);
});
