const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');
const popupHtml = fs.readFileSync(path.join(extensionRoot, 'popup/popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(extensionRoot, 'popup/popup.js'), 'utf8');

test('popup exposes clean user-facing controls', () => {
  // User-facing elements that MUST exist
  for (const id of [
    'connection-state',
    'connection-detail',
    'connection-meta',
    'open-platform-btn',
    'save-settings-btn',
    'platform-home',
    'fill-btn',
  ]) {
    assert.match(popupHtml, new RegExp(`id="${id}"`));
  }

  assert.match(popupHtml, /打开平台/);
  assert.match(popupHtml, /保存配置/);
  assert.match(popupHtml, /高级设置/);
  assert.match(popupHtml, /开始自动填写/);

  // Developer-facing elements that must NOT exist
  for (const id of [
    'backend-base',
    'auth-token',
    'resume-id',
    'scan-btn',
    'copy-report-btn',
    'clear-report-btn',
    'debug-info',
  ]) {
    assert.doesNotMatch(popupHtml, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(popupHtml, /仅扫描并校验字段/);
  assert.doesNotMatch(popupHtml, /复制诊断报告/);
  assert.doesNotMatch(popupHtml, /清除诊断/);
});

test('popup primary flow starts fill without developer diagnostics', () => {
  // Core fill flow still exists
  assert.match(popupJs, /platformConnectUrl/);
  assert.match(popupJs, /\/plugin/);
  assert.match(popupJs, /autolink=1/);
  assert.match(popupJs, /triggerFillInAllFrames/);
  assert.match(popupJs, /__resumeAutofillStart/);
  assert.match(popupJs, /renderConnectionSummary/);
  assert.match(popupJs, /连接平台账号/);
  assert.match(popupJs, /选择或上传简历/);

  // Report is silently persisted for DevTools access
  assert.match(popupJs, /resumeAutofillLastReport/);

  // Developer diagnostics must NOT exist
  assert.doesNotMatch(popupJs, /renderFillReport/);
  assert.doesNotMatch(popupJs, /renderScanResult/);
  assert.doesNotMatch(popupJs, /renderPlanPreview/);
  assert.doesNotMatch(popupJs, /fillReportText/);
  assert.doesNotMatch(popupJs, /copyReportBtn/);
  assert.doesNotMatch(popupJs, /clearReportBtn/);
  assert.doesNotMatch(popupJs, /debugInfoEl/);
  assert.doesNotMatch(popupJs, /scanBtn/);
  assert.doesNotMatch(popupJs, /不会点击最终提交按钮/);
});
