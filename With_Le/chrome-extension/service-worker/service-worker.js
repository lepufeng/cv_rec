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

function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
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

const BACKEND_BASE = 'http://localhost:3000/api';

let cachedResume = null;

async function fetchResume(resumeId) {
  if (cachedResume) return cachedResume;
  let res;
  try {
    res = await fetchWithRetry(`${BACKEND_BASE}/resume/${resumeId}`);
  } catch (err) {
    throw new Error(`无法连接后端 ${BACKEND_BASE} (${err && err.message ? err.message : err})。请确认 mock-server 已启动。`);
  }
  if (!res.ok) throw new Error(`Failed to fetch resume: ${res.status}`);
  cachedResume = await res.json();
  return cachedResume;
}

async function matchFields(fields, resume, sections) {
  let res;
  try {
    res = await fetchWithRetry(`${BACKEND_BASE}/match-fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, resume, sections }),
    });
  } catch (err) {
    throw new Error(`无法连接后端 ${BACKEND_BASE} (${err && err.message ? err.message : err})。请确认 mock-server 已启动。`);
  }
  if (!res.ok) throw new Error(`Match request failed: ${res.status}`);
  return res.json();
}

async function uploadScan(payload) {
  let res;
  try {
    res = await fetchWithRetry(`${BACKEND_BASE}/page-fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`无法连接后端 ${BACKEND_BASE} (${err && err.message ? err.message : err})。请确认 mock-server 已启动。`);
  }
  if (!res.ok) throw new Error(`Upload scan failed: ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.REQUEST_RESUME) {
    fetchResume(message.resumeId)
      .then(data => sendResponse({ type: MSG.RESUME_DATA, data }))
      .catch(err => sendResponse({ type: MSG.FILL_ERROR, error: err.message }));
    return true;
  }

  if (message.type === MSG.REQUEST_MATCH) {
    matchFields(message.fields, message.resume, message.sections)
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
