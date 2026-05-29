const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const workerPath = path.resolve(__dirname, '../service-worker/service-worker.js');
const workerSource = fs.readFileSync(workerPath, 'utf8');

function loadWorker({ storage = {}, fetchImpl }) {
  let listener = null;
  const context = {
    AbortController,
    Response,
    clearTimeout,
    console,
    fetch: fetchImpl,
    setTimeout,
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) {
            listener = fn;
          },
        },
      },
      storage: {
        local: {
          get(keys, callback) {
            const result = {};
            for (const key of keys) result[key] = storage[key];
            callback(result);
          },
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(workerSource, context, { filename: workerPath });
  assert.equal(typeof listener, 'function');
  return listener;
}

function sendMessage(listener, message, sender = {}) {
  return new Promise((resolve) => {
    const keepAlive = listener(message, sender, resolve);
    assert.equal(keepAlive, true);
  });
}

test('REQUEST_MATCH posts plugin scan payload to FastAPI plugin-match endpoint', async () => {
  const calls = [];
  const listener = loadWorker({
    storage: {
      backendBase: 'http://127.0.0.1:8000/api/v1/',
      authToken: 'token-123',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        plan_id: 'plan-1',
        filled: {},
        mappings: { name: '张三' },
        skipped: [],
        warnings: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const response = await sendMessage(listener, {
    type: 'REQUEST_MATCH',
    resume: { resume_id: 'resume-1' },
    fields: [{ fieldId: 'name', label: '姓名', type: 'text' }],
    sections: [{ name: '项目经历', currentCount: 1, addButton: true }],
    forceRefresh: true,
    payload: {
      url: 'https://jobs.example/apply',
      title: 'Apply',
      fieldCount: 1,
      frames: [{ frameIndex: 0, fieldCount: 1 }],
    },
  }, { tab: { url: 'https://fallback.example', title: 'Fallback' } });

  assert.equal(response.type, 'MATCH_RESULT');
  assert.deepEqual(response.data.mappings, { name: '张三' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8000/api/v1/fill-plans/plugin-match');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-123');
  assert.equal(calls[0].body.resumeId, 'resume-1');
  assert.equal(calls[0].body.url, 'https://jobs.example/apply');
  assert.equal(calls[0].body.title, 'Apply');
  assert.equal(calls[0].body.fieldCount, 1);
  assert.equal(calls[0].body.forceRefresh, true);
  assert.deepEqual(calls[0].body.fields, [{ fieldId: 'name', label: '姓名', type: 'text' }]);
  assert.deepEqual(calls[0].body.sections, [{ name: '项目经历', currentCount: 1, addButton: true }]);
});

test('UPLOAD_SCAN posts raw scan payload to plugin-scan endpoint', async () => {
  const calls = [];
  const scanPayload = {
    url: 'https://jobs.example/apply',
    title: 'Apply',
    fieldCount: 1,
    fields: [{ fieldId: 'email', label: '邮箱', type: 'email' }],
  };
  const listener = loadWorker({
    storage: {
      backendBase: 'http://api.local/api/v1',
      authToken: 'token-456',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        id: 'scan-1',
        fieldCount: 1,
        warnings: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const response = await sendMessage(listener, { type: 'UPLOAD_SCAN', payload: scanPayload });

  assert.equal(response.type, 'UPLOAD_SCAN_RESULT');
  assert.equal(response.data.id, 'scan-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://api.local/api/v1/fill-plans/plugin-scan');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-456');
  assert.deepEqual(calls[0].body, scanPayload);
});

test('worker reports a clear error when token is missing', async () => {
  const listener = loadWorker({
    storage: { backendBase: 'http://api.local/api/v1' },
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    },
  });

  const response = await sendMessage(listener, {
    type: 'REQUEST_MATCH',
    resume: { resume_id: 'resume-1' },
    fields: [],
    payload: { url: 'https://jobs.example/apply', fields: [] },
  });

  assert.equal(response.type, 'FILL_ERROR');
  assert.match(response.error, /登录 token/);
});
