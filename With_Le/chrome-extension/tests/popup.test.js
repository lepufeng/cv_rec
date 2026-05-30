const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');
const popupHtml = fs.readFileSync(path.join(extensionRoot, 'popup/popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(extensionRoot, 'popup/popup.js'), 'utf8');

test('popup exposes direct-fill connection controls', () => {
  for (const id of [
    'connection-state',
    'connection-detail',
    'connection-meta',
    'open-platform-btn',
    'save-settings-btn',
    'platform-home',
    'backend-base',
    'auth-token',
    'resume-id',
    'fill-btn',
    'scan-btn',
    'copy-report-btn',
    'clear-report-btn',
    'debug-info',
  ]) {
    assert.match(popupHtml, new RegExp(`id="${id}"`));
  }

  assert.match(popupHtml, /打开平台/);
  assert.match(popupHtml, /保存配置/);
  assert.match(popupHtml, /手动配置/);
  assert.match(popupHtml, /开始自动填写/);
  assert.match(popupHtml, /仅扫描并校验字段/);
  assert.match(popupHtml, /复制诊断报告/);
  assert.match(popupHtml, /清除诊断/);
});

test('popup primary flow starts real fill while scan remains preview-only', () => {
  assert.match(popupJs, /platformConnectUrl/);
  assert.match(popupJs, /\/plugin/);
  assert.match(popupJs, /autolink=1/);
  assert.match(popupJs, /triggerFillInAllFrames/);
  assert.match(popupJs, /__resumeAutofillStart/);
  assert.match(popupJs, /type: MSG\.UPLOAD_SCAN/);
  assert.match(popupJs, /不会点击最终提交按钮/);
  assert.match(popupJs, /renderFillReport/);
  assert.match(popupJs, /resumeAutofillLastReport/);
  assert.match(popupJs, /fillReportText/);
  assert.match(popupJs, /copyReportBtn\.addEventListener/);
  assert.match(popupJs, /clearReportBtn\.addEventListener/);
  assert.match(popupJs, /请先在网页完成自动连接或手动粘贴登录 token/);
  assert.match(popupJs, /renderConnectionSummary/);
  assert.match(popupJs, /连接平台账号/);
  assert.match(popupJs, /选择或上传简历/);
  assert.match(popupJs, /out\.htmlType = f\.htmlType/);
  assert.match(popupJs, /out\.frameUrl = f\.frameUrl/);
  assert.match(popupJs, /out\.visible = !!f\.visible/);
  assert.match(popupJs, /out\.isSearchableSelect = !!f\.isSearchableSelect/);
  assert.match(popupJs, /out\.optionObjects = f\.optionObjects/);
  assert.match(popupJs, /SectionManager\.collectSectionInfo/);
  assert.match(popupJs, /动态板块/);

  const fillHandler = popupJs.slice(
    popupJs.indexOf("fillBtn.addEventListener('click'"),
    popupJs.indexOf("scanBtn.addEventListener('click'")
  );
  assert.doesNotMatch(fillHandler, /type: MSG\.REQUEST_MATCH/);
  assert.doesNotMatch(fillHandler, /renderPlanPreview/);
});
