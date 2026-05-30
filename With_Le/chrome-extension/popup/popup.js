const statusEl = document.getElementById('status');
const fillBtn = document.getElementById('fill-btn');
const platformHomeInput = document.getElementById('platform-home');
const openPlatformBtn = document.getElementById('open-platform-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const connectionStateEl = document.getElementById('connection-state');
const connectionDetailEl = document.getElementById('connection-detail');
const connectionMetaEl = document.getElementById('connection-meta');

const DEFAULT_PLATFORM_HOME = 'http://localhost:5173';

const CONTENT_SCRIPTS = [
  'shared/message-types.js',
  'shared/dom-utils.js',
  'content/handlers/text-handler.js',
  'content/handlers/select-handler.js',
  'content/handlers/date-handler.js',
  'content/handlers/choice-handler.js',
  'content/handlers/upload-handler.js',
  'content/field-scanner.js',
  'content/section-manager.js',
  'content/fill-engine.js',
  'content/navigation-detector.js',
  'content/result-annotator.js',
  'content/content.js',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

function normalizeUrl(value, fallback) {
  const raw = (value || '').trim() || fallback;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

function platformPathUrl(platformHome, path, params) {
  try {
    const url = new URL(normalizeUrl(platformHome, DEFAULT_PLATFORM_HOME));
    url.pathname = path;
    url.search = params || '';
    url.hash = '';
    return url.toString();
  } catch (_) {
    return `${DEFAULT_PLATFORM_HOME}${path}${params || ''}`;
  }
}

function platformConnectUrl(platformHome) {
  return platformPathUrl(platformHome, '/plugin', 'autolink=1');
}

function shortValue(value, start = 8, end = 6) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= start + end + 3) return text;
  return `${text.slice(0, start)}...${text.slice(-end)}`;
}

function renderPrimaryAction(settings) {
  const hasToken = !!settings.authToken;
  const hasResume = !!settings.resumeId;
  if (!hasToken) {
    fillBtn.textContent = '连接平台账号';
    return;
  }
  if (!hasResume) {
    fillBtn.textContent = '选择或上传简历';
    return;
  }
  fillBtn.textContent = '开始自动填写';
}

function readSettings() {
  return {
    platformHome: normalizeUrl(platformHomeInput.value, DEFAULT_PLATFORM_HOME),
    authToken: '',      // read from storage only, never from DOM
    resumeId: '',       // read from storage only, never from DOM
    backendBase: '',    // read from storage only, never from DOM
  };
}

function renderConnectionSummary(data) {
  const hasToken = !!data.authToken;
  const hasResume = !!data.resumeId;
  connectionStateEl.className = 'state-pill';
  renderPrimaryAction(data);

  if (hasToken && hasResume) {
    connectionStateEl.textContent = '已连接';
    connectionStateEl.classList.add('connected');
    connectionDetailEl.textContent = '账号已连接，可以在小鹏或飞书招聘页面开始自动填写。';
  } else if (hasToken) {
    connectionStateEl.textContent = '待选简历';
    connectionStateEl.classList.add('partial');
    connectionDetailEl.textContent = '请在网页上传或选择简历后再次连接。';
  } else {
    connectionStateEl.textContent = '未连接';
    connectionDetailEl.textContent = '登录网页后会自动连接插件，也可以点击"打开平台"。';
  }

  const meta = [];
  if (hasResume) meta.push(`简历 ${shortValue(data.resumeId)}`);
  if (data.linkedUsername) meta.push(`账号 ${data.linkedUsername}`);
  connectionMetaEl.textContent = meta.join(' · ');
}

async function saveSettings(quiet) {
  const platformHome = normalizeUrl(platformHomeInput.value, DEFAULT_PLATFORM_HOME);
  platformHomeInput.value = platformHome;
  // Read sensitive values from storage, not DOM (they were removed from HTML)
  const existing = await storageGet(['backendBase', 'authToken', 'resumeId']);
  const settings = {
    platformHome,
    backendBase: existing.backendBase || '',
    authToken: (existing.authToken || '').trim(),
    resumeId: (existing.resumeId || '').trim(),
  };
  await storageSet({ ...settings, linkedAt: new Date().toISOString() });
  renderConnectionSummary({ ...settings, linkedUsername: (await storageGet(['linkedUsername'])).linkedUsername });
  if (!quiet) {
    statusEl.textContent = '配置已保存';
  }
  return settings;
}

async function restoreSettings() {
  const data = await storageGet([
    'platformHome',
    'backendBase',
    'authToken',
    'resumeId',
    'linkedAt',
    'linkedUsername',
  ]);
  platformHomeInput.value = data.platformHome || DEFAULT_PLATFORM_HOME;
  renderConnectionSummary({
    platformHome: platformHomeInput.value,
    backendBase: data.backendBase || '',
    authToken: data.authToken || '',
    resumeId: data.resumeId || '',
    linkedUsername: data.linkedUsername || '',
  });
}

function isInjectableUrl(url) {
  if (!url) return false;
  return /^https?:|^file:/i.test(url);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('未找到当前标签页');
  if (!isInjectableUrl(tab.url)) throw new Error('当前页面不允许注入脚本');
  return tab;
}

async function injectIntoAllFrames(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_SCRIPTS,
  });
}

async function triggerFillInAllFrames(tabId, resumeId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (id) => {
      if (typeof window.__resumeAutofillStart !== 'function') {
        return { started: false, href: location.href, reason: 'starter-missing' };
      }
      window.__resumeAutofillStart(id);
      return { started: true, href: location.href };
    },
    args: [resumeId],
  });
  return (results || []).map(r => r.result).filter(Boolean);
}

async function runWithButtonsDisabled(fn) {
  fillBtn.disabled = true;
  saveSettingsBtn.disabled = true;
  try {
    await fn();
  } finally {
    fillBtn.disabled = false;
    saveSettingsBtn.disabled = false;
  }
}

// ---------- Event listeners ----------

saveSettingsBtn.addEventListener('click', () => {
  saveSettings(false).catch(err => {
    statusEl.textContent = '保存失败';
  });
});

openPlatformBtn.addEventListener('click', async () => {
  const settings = await saveSettings(true);
  chrome.tabs.create({ url: platformConnectUrl(settings.platformHome) });
});

fillBtn.addEventListener('click', async () => {
  await runWithButtonsDisabled(async () => {
    const settings = await saveSettings(true);
    if (!settings.authToken) {
      statusEl.textContent = '正在打开平台连接页...';
      chrome.tabs.create({ url: platformConnectUrl(settings.platformHome) });
      return;
    }
    if (!settings.resumeId) {
      statusEl.textContent = '正在打开简历连接页...';
      chrome.tabs.create({ url: platformConnectUrl(settings.platformHome) });
      return;
    }

    statusEl.textContent = '准备自动填写...';
    const tab = await getActiveTab();
    statusEl.textContent = '正在填写，请勿关闭当前页面...';
    await injectIntoAllFrames(tab.id);
    await sleep(150);

    const frameResults = await triggerFillInAllFrames(tab.id, settings.resumeId);
    const startedFrames = frameResults.filter(r => r.started);
    if (startedFrames.length === 0) {
      throw new Error('当前页面没有可启动的填写脚本');
    }
    statusEl.textContent = '自动填写已启动，请查看页面上的结果提示';
  }).catch(err => {
    statusEl.textContent = '填写启动失败: ' + (err && err.message ? err.message : err);
  }).finally(() => {
    // Re-read from storage to preserve correct state
    storageGet(['authToken', 'resumeId']).then(data => {
      renderPrimaryAction({
        authToken: data.authToken || '',
        resumeId: data.resumeId || '',
      });
    });
  });
});

// Listen for fill progress/completion from content scripts
chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === MSG.FILL_PROGRESS) {
    statusEl.textContent = message.status;
  }
  if (message.type === MSG.FILL_COMPLETE) {
    const report = message.report;
    const filled = report ? report.totalFilled || 0 : 0;
    const skipped = report ? report.totalSkipped || 0 : 0;
    statusEl.textContent = `填写完成：已填 ${filled} 个字段` + (skipped > 0 ? `，跳过 ${skipped} 个` : '');
    // Silently persist report for debugging via DevTools
    if (report) {
      storageSet({ resumeAutofillLastReport: report }).catch(() => {});
    }
  }
  if (message.type === MSG.FILL_ERROR) {
    statusEl.textContent = '填写出错，请重试';
    const report = message.report;
    if (report) {
      storageSet({ resumeAutofillLastReport: report }).catch(() => {});
    }
  }
});

restoreSettings().catch(err => {
  statusEl.textContent = '读取配置失败';
});
