const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'),
);

function assertFile(relativePath) {
  assert.ok(
    fs.statSync(path.join(extensionRoot, relativePath)).isFile(),
    `${relativePath} should exist`,
  );
}

test('Chrome extension manifest points to existing runtime files', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions.includes('storage'), true);
  assert.equal(manifest.permissions.includes('scripting'), true);
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);

  assertFile(manifest.action.default_popup);
  assertFile(manifest.background.service_worker);

  for (const entry of manifest.content_scripts) {
    assert.ok(entry.matches.includes('*://*/*'));
    assert.equal(entry.all_frames, true);
    for (const script of entry.js) assertFile(script);
  }
});

test('popup HTML loads the shared message contract before popup logic', () => {
  const popupHtml = fs.readFileSync(
    path.join(extensionRoot, manifest.action.default_popup),
    'utf8',
  );
  const sharedIndex = popupHtml.indexOf('../shared/message-types.js');
  const popupIndex = popupHtml.indexOf('popup.js');

  assert.notEqual(sharedIndex, -1);
  assert.notEqual(popupIndex, -1);
  assert.ok(sharedIndex < popupIndex);
});
