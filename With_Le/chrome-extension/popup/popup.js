const statusEl = document.getElementById('status');
const fillBtn = document.getElementById('fill-btn');
const scanBtn = document.getElementById('scan-btn');
const resumeIdInput = document.getElementById('resume-id');
const platformHomeInput = document.getElementById('platform-home');
const backendBaseInput = document.getElementById('backend-base');
const authTokenInput = document.getElementById('auth-token');
const openPlatformBtn = document.getElementById('open-platform-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const expandToggle = document.getElementById('expand-toggle');
const debugInfoEl = document.getElementById('debug-info');

const DEFAULT_PLATFORM_HOME = 'http://localhost:5173';
const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:8000/api/v1';

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

function readSettings() {
  return {
    platformHome: normalizeUrl(platformHomeInput.value, DEFAULT_PLATFORM_HOME),
    backendBase: normalizeUrl(backendBaseInput.value, DEFAULT_BACKEND_BASE),
    authToken: authTokenInput.value.trim(),
    resumeId: resumeIdInput.value.trim(),
    expandOnScan: expandToggle.checked,
  };
}

async function saveSettings(quiet) {
  const settings = readSettings();
  platformHomeInput.value = settings.platformHome;
  backendBaseInput.value = settings.backendBase;
  await storageSet(settings);
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
    'expandOnScan',
  ]);
  platformHomeInput.value = data.platformHome || DEFAULT_PLATFORM_HOME;
  backendBaseInput.value = data.backendBase || DEFAULT_BACKEND_BASE;
  authTokenInput.value = data.authToken || '';
  resumeIdInput.value = data.resumeId || '';
  expandToggle.checked = !!data.expandOnScan;
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

async function expandDynamicSections(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const ADD_TEXT = /^(\+|添加|新增|add)$/i;
      const ADD_TEXT_LOOSE = /添加|新增|\badd\b/i;
      const isVisible = window.DOMUtils && window.DOMUtils.isVisibleStrict
        ? window.DOMUtils.isVisibleStrict
        : (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const clicked = [];
      const candidates = document.querySelectorAll(
        'button, [role="button"], a[href="#"], [class*="add-btn"], [class*="addBtn"]'
      );

      for (const btn of candidates) {
        if (!isVisible(btn)) continue;
        const text = (btn.textContent || '').trim();
        if (!ADD_TEXT.test(text) && !ADD_TEXT_LOOSE.test(text)) continue;
        const module = btn.closest(
          '[class*="module"], [class*="Module"], [class*="section"], [class*="card"], [class*="array"]'
        );
        if (module) {
          const existingInputs = module.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea'
          );
          const visibleInputs = [...existingInputs].filter(el => isVisible(el));
          if (visibleInputs.length > 0) continue;
        }
        btn.click();
        clicked.push(text || '添加');
      }
      return { clicked };
    },
  });
}

async function scanFieldsInAllFrames(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      try {
        if (typeof FieldScanner === 'undefined') {
          return { ok: false, href: location.href, reason: 'scanner-missing' };
        }
        FieldScanner._resetMap();
        const fields = FieldScanner.scan();
        const slim = fields.map(f => {
          const out = {
            fieldId: f.fieldId,
            label: f.label,
            type: f.type,
            widget: f.widget,
            placeholder: f.placeholder,
            required: !!f.required,
            options: f.options || [],
            enumerable: !!f.enumerable,
            section: f.section || '',
          };
          if (f.subLabel) out.subLabel = f.subLabel;
          if (f.groupId) {
            out.groupId = f.groupId;
            out.groupSize = f.groupSize;
            out.groupIndex = f.groupIndex;
          }
          if (f.maxLength != null) out.maxLength = f.maxLength;
          if (f.min != null) out.min = f.min;
          if (f.max != null) out.max = f.max;
          if (f.pattern != null) out.pattern = f.pattern;
          return out;
        });
        return {
          ok: true,
          href: location.href,
          title: document.title,
          fields: slim,
        };
      } catch (e) {
        return { ok: false, href: location.href, reason: String(e && e.stack || e) };
      }
    },
  });
  return results || [];
}

function aggregateFrameResults(tab, frameResults) {
  const frames = [];
  const allFields = [];
  const idCount = new Map();

  frameResults.forEach((r, i) => {
    const v = r && r.result;
    if (!v || !v.ok) {
      frames.push({
        frameIndex: i,
        url: v && v.href,
        error: v ? v.reason : 'no-result',
        fieldCount: 0,
      });
      return;
    }
    frames.push({ frameIndex: i, url: v.href, title: v.title, fieldCount: v.fields.length });
    v.fields.forEach(f => {
      const count = (idCount.get(f.fieldId) || 0) + 1;
      idCount.set(f.fieldId, count);
      const uniqueId = count === 1 ? f.fieldId : `f${i}_${f.fieldId}`;
      allFields.push({ ...f, fieldId: uniqueId, frameUrl: v.href, frameIndex: i });
    });
  });

  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    url: tab.url,
    title: tab.title,
    scannedAt: new Date().toISOString(),
    fieldCount: allFields.length,
    frames,
    fields: allFields,
  };
}

async function collectPagePayload(tab, setMessage) {
  setMessage('正在注入扫描脚本...');
  try {
    await injectIntoAllFrames(tab.id);
  } catch (e) {
    console.warn('inject failed (continuing):', e);
  }

  await sleep(150);

  if (expandToggle.checked) {
    setMessage('正在展开可添加字段组...');
    try {
      await expandDynamicSections(tab.id);
      await sleep(600);
    } catch (e) {
      console.warn('pre-scan expand failed (continuing):', e);
    }
  }

  setMessage('正在扫描页面字段...');
  const frameResults = await scanFieldsInAllFrames(tab.id);
  const payload = aggregateFrameResults(tab, frameResults);
  if (payload.fields.length === 0) {
    throw new Error('未扫描到可识别字段');
  }
  return payload;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || '后台未响应'));
        return;
      }
      if (!response) {
        reject(new Error('后台未响应'));
        return;
      }
      if (response.type === MSG.FILL_ERROR) {
        reject(new Error(response.error || '请求失败'));
        return;
      }
      resolve(response.data);
    });
  });
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function renderPlanPreview(plan, payload) {
  const fieldsById = new Map(payload.fields.map(field => [field.fieldId, field]));
  const mappings = plan && plan.mappings ? plan.mappings : {};
  const entries = Object.entries(mappings);
  const lines = [];

  lines.push(`方案已生成：${plan && plan.plan_id ? plan.plan_id : '无 plan_id'}`);
  lines.push(`页面字段：${payload.fields.length} 个`);
  lines.push(`可自动填写：${entries.length} 个`);
  if (plan && plan.cache_hit) lines.push('命中缓存：是');
  if (plan && plan.model_used) lines.push(`模型：${plan.model_used}`);

  if (plan && plan.warnings && plan.warnings.length) {
    lines.push('');
    lines.push('提示：');
    plan.warnings.slice(0, 6).forEach(w => lines.push(`  - ${w}`));
  }

  if (plan && plan.skipped && plan.skipped.length) {
    lines.push('');
    lines.push(`需要人工确认：${plan.skipped.length} 个`);
    plan.skipped.slice(0, 10).forEach(fieldId => {
      const field = fieldsById.get(fieldId);
      lines.push(`  - ${field ? field.label || fieldId : fieldId}`);
    });
  }

  lines.push('');
  lines.push('字段预览：');
  entries.slice(0, 12).forEach(([fieldId, value]) => {
    const field = fieldsById.get(fieldId);
    const label = field && field.label ? field.label : fieldId;
    lines.push(`  ${label}: ${formatValue(value)}`);
  });
  if (entries.length > 12) lines.push(`  ... 还有 ${entries.length - 12} 个`);

  debugInfoEl.textContent = lines.join('\n');
}

function renderScanResult(resp, payload) {
  const lines = [];
  lines.push('扫描校验完成');
  if (resp && resp.id) lines.push(`记录 ID: ${resp.id}`);
  lines.push(`字段总数: ${payload.fields.length}`);
  if (resp && resp.warnings && resp.warnings.length) {
    lines.push('');
    lines.push('提示：');
    resp.warnings.forEach(w => lines.push(`  - ${w}`));
  }
  lines.push('');
  lines.push('Frame 概览:');
  payload.frames.forEach(f => {
    lines.push(`  #${f.frameIndex} ${f.fieldCount} 字段 - ${f.url || ''}${f.error ? ' [' + f.error + ']' : ''}`);
  });
  lines.push('');
  lines.push('字段示例：');
  payload.fields.slice(0, 10).forEach(f => {
    lines.push(`  [${f.type}] ${f.label || '(无标签)'} (id=${f.fieldId}${f.required ? ', required' : ''})`);
  });
  debugInfoEl.textContent = lines.join('\n');
}

async function runWithButtonsDisabled(fn) {
  fillBtn.disabled = true;
  scanBtn.disabled = true;
  saveSettingsBtn.disabled = true;
  try {
    await fn();
  } finally {
    fillBtn.disabled = false;
    scanBtn.disabled = false;
    saveSettingsBtn.disabled = false;
  }
}

saveSettingsBtn.addEventListener('click', () => {
  saveSettings(false).catch(err => {
    statusEl.textContent = '保存失败: ' + (err && err.message ? err.message : err);
  });
});

openPlatformBtn.addEventListener('click', async () => {
  const settings = await saveSettings(true);
  chrome.tabs.create({ url: settings.platformHome });
});

expandToggle.addEventListener('change', () => {
  chrome.storage.local.set({ expandOnScan: expandToggle.checked });
});

fillBtn.addEventListener('click', async () => {
  await runWithButtonsDisabled(async () => {
    const settings = await saveSettings(true);
    if (!settings.resumeId) throw new Error('请输入简历 ID');
    if (!settings.authToken) throw new Error('请先在插件中粘贴网页登录 token');

    statusEl.textContent = '准备生成填表方案...';
    debugInfoEl.textContent = '';
    const tab = await getActiveTab();
    const payload = await collectPagePayload(tab, message => {
      statusEl.textContent = message;
    });

    statusEl.textContent = `扫描到 ${payload.fields.length} 个字段，正在请求后端匹配...`;
    const plan = await sendRuntimeMessage({
      type: MSG.REQUEST_MATCH,
      payload,
      fields: payload.fields,
      resume: { resume_id: settings.resumeId },
      sections: [],
    });
    renderPlanPreview(plan, payload);
    const count = plan && plan.mappings ? Object.keys(plan.mappings).length : 0;
    statusEl.textContent = `方案已生成，可填 ${count} 个字段`;
  }).catch(err => {
    statusEl.textContent = '生成失败: ' + (err && err.message ? err.message : err);
  });
});

scanBtn.addEventListener('click', async () => {
  await runWithButtonsDisabled(async () => {
    const settings = await saveSettings(true);
    if (!settings.authToken) throw new Error('请先在插件中粘贴网页登录 token');

    statusEl.textContent = '准备扫描页面...';
    debugInfoEl.textContent = '';
    const tab = await getActiveTab();
    const payload = await collectPagePayload(tab, message => {
      statusEl.textContent = message;
    });

    statusEl.textContent = `扫描到 ${payload.fields.length} 个字段，正在校验...`;
    const resp = await sendRuntimeMessage({ type: MSG.UPLOAD_SCAN, payload });
    renderScanResult(resp, payload);
    statusEl.textContent = '扫描校验完成';
  }).catch(err => {
    statusEl.textContent = '扫描失败: ' + (err && err.message ? err.message : err);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === MSG.FILL_PROGRESS) {
    statusEl.textContent = message.status;
  }
  if (message.type === MSG.FILL_COMPLETE) {
    statusEl.textContent = message.summary;
  }
  if (message.type === MSG.FILL_ERROR) {
    statusEl.textContent = '错误: ' + message.error;
  }
});

restoreSettings().catch(err => {
  statusEl.textContent = '读取配置失败: ' + (err && err.message ? err.message : err);
});
