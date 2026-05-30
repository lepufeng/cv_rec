(function () {
  if (window.top !== window) return;

  const PLATFORM_SOURCE = 'cv-rec-platform';
  const EXTENSION_SOURCE = 'cv-rec-extension';
  const STATUS_REQUEST = 'CV_REC_PLUGIN_STATUS';
  const STATUS_RESULT = 'CV_REC_PLUGIN_STATUS_RESULT';
  const CONNECT_REQUEST = 'CV_REC_CONNECT_PLUGIN';
  const CONNECT_RESULT = 'CV_REC_CONNECT_PLUGIN_RESULT';
  const DEFAULT_PLATFORM_HOME = 'http://localhost:5173';
  const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000/api/v1';
  const ALLOWED_PLATFORM_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

  function normalizeUrl(value, fallback) {
    const raw = String(value || '').trim() || fallback;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withScheme.replace(/\/+$/, '');
  }

  function isAllowedPlatformOrigin(origin) {
    try {
      const url = new URL(origin);
      return (url.protocol === 'http:' || url.protocol === 'https:')
        && ALLOWED_PLATFORM_HOSTS.has(url.hostname);
    } catch (_) {
      return false;
    }
  }

  function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(values) {
    return new Promise(resolve => chrome.storage.local.set(values, resolve));
  }

  function safeTargetOrigin(origin) {
    return origin && origin !== 'null' ? origin : '*';
  }

  function postBridgeResult(origin, type, requestId, payload) {
    window.postMessage({
      source: EXTENSION_SOURCE,
      type,
      requestId,
      ...payload,
    }, safeTargetOrigin(origin));
  }

  function summarizeSettings(data) {
    const authToken = String(data.authToken || '').trim();
    const resumeId = String(data.resumeId || '').trim();
    return {
      connected: !!authToken,
      hasResume: !!resumeId,
      platformHome: data.platformHome || DEFAULT_PLATFORM_HOME,
      backendBase: data.backendBase || DEFAULT_BACKEND_BASE,
      resumeId,
      linkedAt: data.linkedAt || '',
      linkedUsername: data.linkedUsername || '',
    };
  }

  async function handleStatus(origin, requestId) {
    const data = await storageGet([
      'platformHome',
      'backendBase',
      'authToken',
      'resumeId',
      'linkedAt',
      'linkedUsername',
    ]);
    postBridgeResult(origin, STATUS_RESULT, requestId, {
      ok: true,
      status: summarizeSettings(data),
    });
  }

  async function handleConnect(origin, requestId, payload) {
    const authToken = String(payload && payload.authToken || '').trim();
    if (!authToken) {
      throw new Error('缺少登录 token');
    }

    const settings = {
      platformHome: normalizeUrl(payload.platformHome, DEFAULT_PLATFORM_HOME),
      backendBase: normalizeUrl(payload.backendBase, DEFAULT_BACKEND_BASE),
      authToken,
      resumeId: String(payload.resumeId || '').trim(),
      linkedUsername: String(payload.username || '').trim(),
      linkedAt: new Date().toISOString(),
    };
    await storageSet(settings);
    postBridgeResult(origin, CONNECT_RESULT, requestId, {
      ok: true,
      status: summarizeSettings(settings),
    });
  }

  async function handleBridgeMessage(event) {
    if (event.source !== window) return;
    const message = event.data || {};
    if (message.source !== PLATFORM_SOURCE) return;

    const requestId = message.requestId || '';
    if (!isAllowedPlatformOrigin(event.origin)) {
      postBridgeResult(event.origin, message.type === STATUS_REQUEST ? STATUS_RESULT : CONNECT_RESULT, requestId, {
        ok: false,
        error: '当前网页来源不允许连接插件',
      });
      return;
    }

    try {
      if (message.type === STATUS_REQUEST) {
        await handleStatus(event.origin, requestId);
      } else if (message.type === CONNECT_REQUEST) {
        await handleConnect(event.origin, requestId, message.payload || {});
      }
    } catch (err) {
      postBridgeResult(event.origin, message.type === STATUS_REQUEST ? STATUS_RESULT : CONNECT_RESULT, requestId, {
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  window.addEventListener('message', handleBridgeMessage);

  window.PlatformBridge = {
    isAllowedPlatformOrigin,
    normalizeUrl,
  };
}());
