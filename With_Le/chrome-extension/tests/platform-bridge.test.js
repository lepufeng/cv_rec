const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const bridgePath = path.resolve(__dirname, '../content/platform-bridge.js');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');

function loadBridge({ origin = 'http://localhost:5173', storage = {} } = {}) {
  const listeners = [];
  const posted = [];
  const win = {
    top: null,
    location: new URL(origin),
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
    },
  };
  win.top = win;

  const context = {
    URL,
    console,
    window: win,
    chrome: {
      storage: {
        local: {
          get(keys, callback) {
            const result = {};
            for (const key of keys) result[key] = storage[key];
            callback(result);
          },
          set(values, callback) {
            Object.assign(storage, values);
            if (callback) callback();
          },
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(bridgeSource, context, { filename: bridgePath });
  assert.equal(listeners.length, 1);
  return { window: win, listener: listeners[0], posted, storage, context };
}

async function sendBridgeMessage(bridge, message, origin = 'http://localhost:5173') {
  await bridge.listener({
    source: bridge.window,
    origin,
    data: {
      source: 'cv-rec-platform',
      requestId: 'req-1',
      ...message,
    },
  });
}

test('platform bridge saves login connection from local platform pages', async () => {
  const bridge = loadBridge();

  await sendBridgeMessage(bridge, {
    type: 'CV_REC_CONNECT_PLUGIN',
    payload: {
      platformHome: 'http://localhost:5173/',
      backendBase: 'http://127.0.0.1:8000/api/v1/',
      authToken: 'token-123',
      resumeId: 'resume-abc',
      username: 'alice',
    },
  });

  assert.equal(bridge.storage.platformHome, 'http://localhost:5173');
  assert.equal(bridge.storage.backendBase, 'http://127.0.0.1:8000/api/v1');
  assert.equal(bridge.storage.authToken, 'token-123');
  assert.equal(bridge.storage.resumeId, 'resume-abc');
  assert.equal(bridge.storage.linkedUsername, 'alice');
  assert.match(bridge.storage.linkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(bridge.posted[0].message.type, 'CV_REC_CONNECT_PLUGIN_RESULT');
  assert.equal(bridge.posted[0].message.ok, true);
  assert.equal(bridge.posted[0].message.status.connected, true);
  assert.equal(bridge.posted[0].message.status.hasResume, true);
});

test('platform bridge reports current plugin status', async () => {
  const bridge = loadBridge({
    storage: {
      platformHome: 'http://localhost:5173',
      backendBase: 'http://127.0.0.1:8000/api/v1',
      authToken: 'token-123',
      resumeId: '',
    },
  });

  await sendBridgeMessage(bridge, { type: 'CV_REC_PLUGIN_STATUS' });

  assert.equal(bridge.posted[0].message.type, 'CV_REC_PLUGIN_STATUS_RESULT');
  assert.equal(bridge.posted[0].message.ok, true);
  assert.equal(bridge.posted[0].message.status.connected, true);
  assert.equal(bridge.posted[0].message.status.hasResume, false);
});

test('platform bridge rejects non-local web origins', async () => {
  const bridge = loadBridge();

  await sendBridgeMessage(bridge, {
    type: 'CV_REC_CONNECT_PLUGIN',
    payload: { authToken: 'evil-token', resumeId: 'resume-1' },
  }, 'https://example.com');

  assert.equal(bridge.storage.authToken, undefined);
  assert.equal(bridge.posted[0].message.ok, false);
  assert.match(bridge.posted[0].message.error, /不允许连接插件/);
});
