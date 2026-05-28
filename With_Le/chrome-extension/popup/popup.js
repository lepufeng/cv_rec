const statusEl = document.getElementById('status');
const fillBtn = document.getElementById('fill-btn');
const resumeIdInput = document.getElementById('resume-id');

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

// Restore saved resume ID
chrome.storage.local.get('resumeId', data => {
  if (data.resumeId) resumeIdInput.value = data.resumeId;
});

// Restore expand-on-scan toggle
const expandToggle = document.getElementById('expand-toggle');
chrome.storage.local.get('expandOnScan', data => {
  expandToggle.checked = !!data.expandOnScan;
});
expandToggle.addEventListener('change', () => {
  chrome.storage.local.set({ expandOnScan: expandToggle.checked });
});

function isInjectableUrl(url) {
  if (!url) return false;
  return /^https?:|^file:/i.test(url);
}

async function injectIntoAllFrames(tabId) {
  // Inject into every frame of the tab. This is the only reliable way to
  // reach forms that live inside <iframe>s (very common on enterprise
  // recruitment portals such as join.qq.com).
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_SCRIPTS,
  });
}

async function triggerFillInAllFrames(tabId, resumeId) {
  // Call the global trigger inside every frame. Each frame's content script
  // will short-circuit if it has no form fields, so only the right frame
  // actually performs the fill.
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (id) => {
      try {
        if (typeof window.__resumeAutofillStart === 'function') {
          window.__resumeAutofillStart(id);
          return { ok: true, href: location.href };
        }
        return { ok: false, href: location.href, reason: 'no-trigger' };
      } catch (e) {
        return { ok: false, href: location.href, reason: String(e) };
      }
    },
    args: [resumeId],
  });
  return results || [];
}

fillBtn.addEventListener('click', async () => {
  const resumeId = resumeIdInput.value.trim();
  if (!resumeId) {
    statusEl.textContent = '请输入简历 ID';
    return;
  }

  fillBtn.disabled = true;

  // Save resume ID for next time
  chrome.storage.local.set({ resumeId });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    statusEl.textContent = '未找到当前标签页';
    fillBtn.disabled = false;
    return;
  }

  if (!isInjectableUrl(tab.url)) {
    statusEl.textContent = '当前页面不允许注入脚本';
    fillBtn.disabled = false;
    return;
  }

  try {
    statusEl.textContent = '正在注入脚本到所有 frame...';
    await injectIntoAllFrames(tab.id);
  } catch (e) {
    // Manifest content_scripts may already have run; ignore "already injected"
    // style errors and continue. Real failures will surface in the trigger
    // step below.
    console.warn('inject failed (continuing):', e);
  }

  // Give SPAs a brief moment to settle (most have rendered the form by now).
  await new Promise(r => setTimeout(r, 150));

  try {
    statusEl.textContent = '正在触发填写...';
    const results = await triggerFillInAllFrames(tab.id, resumeId);
    const triggered = results.filter(r => r && r.result && r.result.ok).length;
    if (triggered === 0) {
      statusEl.textContent = '未在任何 frame 中触发，请刷新页面后重试';
      fillBtn.disabled = false;
    } else {
      statusEl.textContent = `已在 ${triggered} 个 frame 中启动填写...`;
    }
  } catch (e) {
    statusEl.textContent = '触发失败: ' + (e && e.message ? e.message : e);
    fillBtn.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === MSG.FILL_PROGRESS) {
    statusEl.textContent = message.status;
  }
  if (message.type === MSG.FILL_COMPLETE) {
    statusEl.textContent = message.summary;
    fillBtn.disabled = false;
  }
  if (message.type === MSG.FILL_ERROR) {
    statusEl.textContent = '错误: ' + message.error;
    fillBtn.disabled = false;
  }
});


// ----------------------------- Debug fill ---------------------------------
const debugBtn = document.getElementById('debug-btn');
const debugInfoEl = document.getElementById('debug-info');

async function debugFillAllFrames(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      try {
        if (typeof FieldScanner === 'undefined') {
          return { ok: false, href: location.href, reason: 'scanner-missing' };
        }
        FieldScanner._resetMap();
        const fields = FieldScanner.scan();
        const samples = fields.slice(0, 30).map(f => ({
          fieldId: f.fieldId,
          type: f.type,
          label: f.label,
          placeholder: f.placeholder,
          section: f.section,
        }));

        let filled = 0;
        const skipped = [];
        for (const f of fields) {
          if (f.type !== 'text' && f.type !== 'textarea') continue;
          const el = FieldScanner._elementMap.get(f.fieldId);
          if (!el) { skipped.push({ id: f.fieldId, reason: 'no-el' }); continue; }
          const value = `测试_${f.fieldId}`.slice(0, 20);
          const ok = TextHandler.fill(el, value);
          if (ok) filled++;
          else skipped.push({ id: f.fieldId, label: f.label, reason: 'fill-failed' });
        }
        return {
          ok: true,
          href: location.href,
          fieldsCount: fields.length,
          filled,
          skipped: skipped.slice(0, 20),
          samples,
        };
      } catch (e) {
        return { ok: false, href: location.href, reason: String(e && e.stack || e) };
      }
    },
  });
  return results || [];
}

debugBtn.addEventListener('click', async () => {
  debugBtn.disabled = true;
  debugInfoEl.textContent = '运行中...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    debugInfoEl.textContent = '未找到当前标签页';
    debugBtn.disabled = false;
    return;
  }
  if (!isInjectableUrl(tab.url)) {
    debugInfoEl.textContent = '当前页面不允许注入';
    debugBtn.disabled = false;
    return;
  }

  try {
    await injectIntoAllFrames(tab.id);
  } catch (e) {
    console.warn('inject failed (continuing):', e);
  }

  await new Promise(r => setTimeout(r, 150));

  try {
    const results = await debugFillAllFrames(tab.id);
    const lines = [];
    let totalFilled = 0;
    let totalFields = 0;
    results.forEach((r, i) => {
      const v = r && r.result;
      if (!v) { lines.push(`#${i} 无返回`); return; }
      if (!v.ok) {
        lines.push(`#${i} ${v.href}\n  失败: ${v.reason}`);
        return;
      }
      totalFields += v.fieldsCount;
      totalFilled += v.filled;
      lines.push(
        `#${i} ${v.href}\n  字段: ${v.fieldsCount} 已填: ${v.filled} 跳过: ${v.skipped.length}`
      );
      if (v.samples && v.samples.length) {
        v.samples.slice(0, 8).forEach(s => {
          lines.push(`    [${s.type}] id=${s.fieldId} label="${s.label || ''}" ph="${s.placeholder || ''}"`);
        });
      }
    });
    debugInfoEl.textContent = `合计 ${totalFields} 字段, 强制填入 ${totalFilled} 个\n\n` + lines.join('\n');
  } catch (e) {
    debugInfoEl.textContent = '失败: ' + (e && e.message ? e.message : e);
  } finally {
    debugBtn.disabled = false;
  }
});


// ----------------------------- Page-field scan + upload -----------------------
const scanBtn = document.getElementById('scan-btn');

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
        // Slim down: drop containerText (large, mostly noise) for export.
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

scanBtn.addEventListener('click', async () => {
  scanBtn.disabled = true;
  debugInfoEl.textContent = '扫描中...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    debugInfoEl.textContent = '未找到当前标签页';
    scanBtn.disabled = false;
    return;
  }
  if (!isInjectableUrl(tab.url)) {
    debugInfoEl.textContent = '当前页面不允许注入';
    scanBtn.disabled = false;
    return;
  }

  try {
    await injectIntoAllFrames(tab.id);
  } catch (e) {
    console.warn('inject failed (continuing):', e);
  }

  await new Promise(r => setTimeout(r, 150));

  // Optional pre-scan expansion: when the user opts in via the toggle, click
  // every visible "add" button whose surrounding module is currently empty.
  // This surfaces dynamically-rendered field groups (e.g. Feishu's 项目经历
  // / 实习经历) so they appear in the scan output. Off by default because
  // the clicks visibly mutate the page.
  if (expandToggle.checked) {
    debugInfoEl.textContent = '正在展开"添加"按钮...';
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const ADD_TEXT = /^(\+|添加|新增|add)$/i;
          const ADD_TEXT_LOOSE = /添加|新增|\badd\b/i;
          const clicked = [];

          const candidates = document.querySelectorAll(
            'button, [role="button"], a[href="#"], [class*="add-btn"], [class*="addBtn"]'
          );
          for (const btn of candidates) {
            if (!DOMUtils.isVisibleStrict(btn)) continue;
            const text = (btn.textContent || '').trim();
            if (!ADD_TEXT.test(text) && !ADD_TEXT_LOOSE.test(text)) continue;
            // Skip "添加" buttons whose surrounding module already has a
            // visible input — that means the section already has content
            // and clicking would create a *second* entry.
            const module = btn.closest(
              '[class*="module"], [class*="Module"], [class*="section"], [class*="card"], [class*="array"]'
            );
            if (module) {
              const existingInputs = module.querySelectorAll(
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea'
              );
              const visibleInputs = [...existingInputs].filter(el => DOMUtils.isVisibleStrict(el));
              if (visibleInputs.length > 0) continue;
            }
            btn.click();
            clicked.push(btn.textContent.trim());
          }
          return { clicked };
        },
      });
      // Wait for DOM to settle after clicks.
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      console.warn('pre-scan expand failed (continuing):', e);
    }
  }

  let frameResults;
  try {
    frameResults = await scanFieldsInAllFrames(tab.id);
  } catch (e) {
    debugInfoEl.textContent = '扫描失败: ' + (e && e.message ? e.message : e);
    scanBtn.disabled = false;
    return;
  }

  // Aggregate fields from every frame and prefix conflicting fieldIds with
  // a short frame index to keep them unique.
  const frames = [];
  const allFields = [];
  const idCount = new Map();

  frameResults.forEach((r, i) => {
    const v = r && r.result;
    if (!v || !v.ok) {
      frames.push({ frameIndex: i, url: v && v.href, error: v ? v.reason : 'no-result', fieldCount: 0 });
      return;
    }
    frames.push({ frameIndex: i, url: v.href, title: v.title, fieldCount: v.fields.length });
    v.fields.forEach(f => {
      const c = (idCount.get(f.fieldId) || 0) + 1;
      idCount.set(f.fieldId, c);
      const uniqueId = c === 1 ? f.fieldId : `f${i}_${f.fieldId}`;
      allFields.push({ ...f, fieldId: uniqueId, frameUrl: v.href });
    });
  });

  const payload = {
    url: tab.url,
    title: tab.title,
    scannedAt: new Date().toISOString(),
    fieldCount: allFields.length,
    frames,
    fields: allFields,
  };

  debugInfoEl.textContent = `扫描完成: ${allFields.length} 个字段，${frames.length} 个 frame，正在上传...`;

  try {
    const resp = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: MSG.UPLOAD_SCAN, payload }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || '后台未响应'));
          return;
        }
        if (!response) { reject(new Error('后台未响应')); return; }
        if (response.type === MSG.UPLOAD_SCAN_RESULT) resolve(response.data);
        else reject(new Error(response.error || '上传失败'));
      });
    });

    const lines = [];
    lines.push(`✅ 上传成功`);
    if (resp && resp.id) lines.push(`记录 ID: ${resp.id}`);
    if (resp && resp.path) lines.push(`服务端文件: ${resp.path}`);
    lines.push(`字段总数: ${allFields.length}`);
    lines.push('');
    lines.push('Frame 概览:');
    frames.forEach(f => {
      lines.push(`  #${f.frameIndex} ${f.fieldCount} 字段 - ${f.url || ''}${f.error ? ' [' + f.error + ']' : ''}`);
    });
    lines.push('');
    lines.push('字段示例 (前 10):');
    allFields.slice(0, 10).forEach(f => {
      lines.push(`  [${f.type}] ${f.label || '(无标签)'} (id=${f.fieldId}${f.required ? ', required' : ''})`);
    });
    debugInfoEl.textContent = lines.join('\n');
  } catch (e) {
    debugInfoEl.textContent = '上传失败: ' + (e && e.message ? e.message : e);
  } finally {
    scanBtn.disabled = false;
  }
});
