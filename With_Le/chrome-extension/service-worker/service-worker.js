const MSG = {
  START_FILL: 'START_FILL',
  FILL_PROGRESS: 'FILL_PROGRESS',
  FILL_COMPLETE: 'FILL_COMPLETE',
  FILL_ERROR: 'FILL_ERROR',
  REQUEST_RESUME: 'REQUEST_RESUME',
  REQUEST_RESUME_FILE: 'REQUEST_RESUME_FILE',
  REQUEST_MATCH: 'REQUEST_MATCH',
  RESUME_DATA: 'RESUME_DATA',
  RESUME_FILE_DATA: 'RESUME_FILE_DATA',
  MATCH_RESULT: 'MATCH_RESULT',
  UPLOAD_SCAN: 'UPLOAD_SCAN',
  UPLOAD_SCAN_RESULT: 'UPLOAD_SCAN_RESULT',
  CLEAR_CACHE: 'CLEAR_CACHE',
};

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000/api/v1';
const REQUEST_TIMEOUT_MS = 120000;

const resumeCache = new Map();
const resumeFileCache = new Map();

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

function authHeadersFor(config) {
  const headers = {};
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
    throw new Error('请先在网页完成自动连接，或在插件中手动保存登录 token');
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

async function fetchResumeFile(resumeId) {
  if (!resumeId) throw new Error('缺少简历 ID');
  const config = await getConfig();
  ensureAuth(config);
  const cacheKey = `${config.backendBase}:${resumeId}:file`;
  if (resumeFileCache.has(cacheKey)) return resumeFileCache.get(cacheKey);

  const url = `${config.backendBase}/resumes/${encodeURIComponent(resumeId)}/file`;
  let res;
  try {
    res = await fetchWithRetry(url, {
      method: 'GET',
      headers: authHeadersFor(config),
    });
  } catch (err) {
    const reason = err && err.message ? err.message : err;
    throw new Error(`无法连接后端 ${config.backendBase} (${reason})。请确认平台 API 地址正确且后端已启动。`);
  }
  if (!res.ok) {
    throw new Error(await parseBackendError(res));
  }

  const encodedName = res.headers.get('X-Resume-Filename') || '';
  const payload = {
    name: decodeHeaderFilename(encodedName) || filenameFromDisposition(res.headers.get('Content-Disposition')) || 'resume',
    mimeType: (res.headers.get('Content-Type') || 'application/octet-stream').split(';')[0],
    dataBase64: bytesToBase64(new Uint8Array(await res.arrayBuffer())),
  };
  resumeFileCache.set(cacheKey, payload);
  return payload;
}

function decodeHeaderFilename(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function filenameFromDisposition(value) {
  if (!value) return '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (match) return decodeHeaderFilename(match[1].trim());
  const fallback = /filename="?([^";]+)"?/i.exec(value);
  return fallback ? fallback[1].trim() : '';
}

function bytesToBase64(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  if (i < bytes.length) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const n = (a << 16) | (b << 8);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(n >> 6) & 63] + '=' : '==';
  }
  return out;
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

  if (message.type === MSG.REQUEST_RESUME_FILE) {
    fetchResumeFile(message.resumeId)
      .then(data => sendResponse({ type: MSG.RESUME_FILE_DATA, data }))
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

  if (message.type === MSG.CLEAR_CACHE) {
    const targetId = message.resumeId;
    if (targetId) {
      for (const key of resumeCache.keys()) {
        if (key.includes(targetId)) resumeCache.delete(key);
      }
      for (const key of resumeFileCache.keys()) {
        if (key.includes(targetId)) resumeFileCache.delete(key);
      }
    } else {
      resumeCache.clear();
      resumeFileCache.clear();
    }
    sendResponse({ cleared: true });
    return false;
  }
});
