const MSG = {
  START_FILL: 'START_FILL',
  FILL_PROGRESS: 'FILL_PROGRESS',
  FILL_COMPLETE: 'FILL_COMPLETE',
  FILL_ERROR: 'FILL_ERROR',
  REQUEST_RESUME: 'REQUEST_RESUME',
  REQUEST_MATCH: 'REQUEST_MATCH',
  RESUME_DATA: 'RESUME_DATA',
  MATCH_RESULT: 'MATCH_RESULT',
  UPLOAD_SCAN: 'UPLOAD_SCAN',
  UPLOAD_SCAN_RESULT: 'UPLOAD_SCAN_RESULT',
};

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000/api/v1';
const REQUEST_TIMEOUT_MS = 120000;

const resumeCache = new Map();

function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchWithRetry(url, options, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWithTimeout(url, options);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function normalizeBackendBase(value) {
  const raw = (value || '').trim() || DEFAULT_BACKEND_BASE;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

async function getConfig() {
  const data = await storageGet(['backendBase', 'authToken']);
  return {
    backendBase: normalizeBackendBase(data.backendBase),
    authToken: (data.authToken || '').trim(),
  };
}

function headersFor(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.authToken) headers.Authorization = `Bearer ${config.authToken}`;
  return headers;
}

async function parseBackendError(res) {
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // ignore non-json errors
  }
  if (payload && payload.message) return payload.message;
  if (payload && payload.detail) {
    if (typeof payload.detail === 'string') return payload.detail;
    return JSON.stringify(payload.detail);
  }
  return `HTTP ${res.status}`;
}

function ensureAuth(config) {
  if (!config.authToken) {
    throw new Error('请先在插件中粘贴网页「连接插件」页提供的登录 token');
  }
}

async function requestJson(path, body, options = {}) {
  const config = await getConfig();
  ensureAuth(config);
  const url = `${config.backendBase}${path}`;
  let res;
  try {
    res = await fetchWithRetry(url, {
      method: options.method || 'POST',
      headers: headersFor(config),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    const reason = err && err.message ? err.message : err;
    throw new Error(`无法连接后端 ${config.backendBase} (${reason})。请确认平台 API 地址正确且后端已启动。`);
  }
  if (!res.ok) {
    throw new Error(await parseBackendError(res));
  }
  if (res.status === 204) return null;
  return res.json();
}

async function fetchResume(resumeId) {
  if (!resumeId) throw new Error('缺少简历 ID');
  const config = await getConfig();
  ensureAuth(config);
  const cacheKey = `${config.backendBase}:${resumeId}`;
  if (resumeCache.has(cacheKey)) return resumeCache.get(cacheKey);

  const url = `${config.backendBase}/resumes/${encodeURIComponent(resumeId)}`;
  let res;
  try {
    res = await fetchWithRetry(url, {
      method: 'GET',
      headers: headersFor(config),
    });
  } catch (err) {
    const reason = err && err.message ? err.message : err;
    throw new Error(`无法连接后端 ${config.backendBase} (${reason})。请确认平台 API 地址正确且后端已启动。`);
  }
  if (!res.ok) {
    throw new Error(await parseBackendError(res));
  }
  const data = await res.json();
  resumeCache.set(cacheKey, data);
  return data;
}

async function matchFields(fields, resume, sections, payload, sender, forceRefresh) {
  const resumeId = resume && (resume.resume_id || resume.resumeId || resume.id);
  if (!resumeId) throw new Error('缺少简历 ID');
  const requestBody = {
    resumeId,
    url: payload && payload.url ? payload.url : (sender && sender.tab && sender.tab.url) || 'unknown',
    title: payload && payload.title ? payload.title : (sender && sender.tab && sender.tab.title) || '',
    fieldCount: payload && payload.fieldCount != null ? payload.fieldCount : fields.length,
    frames: payload && payload.frames ? payload.frames : [],
    fields,
    sections: sections || [],
    forceRefresh: !!forceRefresh || !!(payload && payload.forceRefresh),
  };
  return requestJson('/fill-plans/plugin-match', requestBody);
}

async function uploadScan(payload) {
  if (!payload) throw new Error('缺少扫描数据');
  return requestJson('/fill-plans/plugin-scan', payload);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.REQUEST_RESUME) {
    fetchResume(message.resumeId)
      .then(data => sendResponse({ type: MSG.RESUME_DATA, data }))
      .catch(err => sendResponse({ type: MSG.FILL_ERROR, error: err.message }));
    return true;
  }

  if (message.type === MSG.REQUEST_MATCH) {
    matchFields(
      message.fields || [],
      message.resume || {},
      message.sections || [],
      message.payload || null,
      sender,
      message.forceRefresh
    )
      .then(data => sendResponse({ type: MSG.MATCH_RESULT, data }))
      .catch(err => sendResponse({ type: MSG.FILL_ERROR, error: err.message }));
    return true;
  }

  if (message.type === MSG.UPLOAD_SCAN) {
    uploadScan(message.payload)
      .then(data => sendResponse({ type: MSG.UPLOAD_SCAN_RESULT, data }))
      .catch(err => sendResponse({ type: MSG.FILL_ERROR, error: err.message }));
    return true;
  }
});
