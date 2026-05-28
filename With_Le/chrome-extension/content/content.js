var running = false;

if (!window.__resumeAutofillLoaded) {
  window.__resumeAutofillLoaded = true;

  // Expose a global trigger so the popup can call us in every frame via
  // chrome.scripting.executeScript (works even when chrome.tabs.sendMessage
  // can't reach the right frame).
  window.__resumeAutofillStart = function (resumeId) {
    if (running) return;
    startFill(resumeId);
  };

  window.__resumeAutofillPing = function () {
    return true;
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'PING') {
      sendResponse({ pong: true, frame: location.href });
      return true;
    }
    if (message && message.type === MSG.START_FILL && !running) {
      startFill(message.resumeId);
      sendResponse({ received: true });
      return true;
    }
    return false;
  });
}

async function sendProgress(status) {
  try {
    chrome.runtime.sendMessage({ type: MSG.FILL_PROGRESS, status });
  } catch (_) {}
}

async function startFill(resumeId) {
  running = true;
  FillEngine.reset();
  SectionManager.reset();
  NavigationDetector.reset();
  FieldScanner._resetMap();

  const report = {
    url: location.href,
    title: document.title,
    host: location.host,
    startedAt: new Date().toISOString(),
    pages: [],
    safety: {
      noFinalSubmit: true,
      noFileUpload: true,
    },
  };

  try {
    if (!resumeId) {
      sendProgress('未配置简历 ID');
      running = false;
      return;
    }

    // Quick exit for frames without any form fields (avoids noisy notifications
    // from chrome / ad / analytics iframes).
    const probeFields = FieldScanner.scan();
    if (probeFields.length === 0) {
      running = false;
      return;
    }

    sendProgress(`正在获取简历数据... (${location.host})`);
    const resume = await requestResume(resumeId);

    let totalFilled = 0;
    let totalSkipped = [];

    for (let page = 0; page < NavigationDetector.MAX_PAGES; page++) {
      // 1. Initial scan
      const sectionInfo = SectionManager.collectSectionInfo();
      const initialFields = FieldScanner.scan();

      if (initialFields.length === 0) break;
      if (NavigationDetector.isDuplicatePage(initialFields)) break;
      const pageReport = {
        page: page + 1,
        initialFieldCount: initialFields.length,
        sectionCount: sectionInfo.length,
        sectionActions: {},
        expandedFieldCount: null,
        mappingCount: 0,
        backendSkippedCount: 0,
        filledCount: 0,
        runtimeSkippedCount: 0,
        navigated: false,
        stopReason: '',
      };
      report.pages.push(pageReport);

      // 2. First match to get safe mappings and dynamic section actions.
      sendProgress(`正在匹配字段... (${initialFields.length} 个字段)`);
      const firstMatch = await requestMatch(initialFields, resume, sectionInfo, true);

      let mappings = firstMatch.mappings || {};
      let activeFields = initialFields;
      let matchSkipped = firstMatch.skipped || [];
      pageReport.mappingCount = Object.keys(mappings).length;
      pageReport.backendSkippedCount = matchSkipped.length;

      // 3. Execute section expansions. ATS pages such as Moka, Feishu and
      // Beisen often render only one project/education card first. If the
      // backend asks us to add cards, expand the DOM, then re-scan and
      // re-match the full page so repeated groups can be mapped in order.
      if (firstMatch.sectionActions && Object.keys(firstMatch.sectionActions).length > 0) {
        pageReport.sectionActions = firstMatch.sectionActions;
        sendProgress(`正在展开板块... (第 ${page + 1} 页)`);
        await SectionManager.executeActions(firstMatch.sectionActions);
        await new Promise(r => setTimeout(r, 600));

        const expandedFields = FieldScanner.scan();
        pageReport.expandedFieldCount = expandedFields.length;
        if (expandedFields.length > 0) {
          const expandedSectionInfo = SectionManager.collectSectionInfo();
          sendProgress(`板块已展开，正在重新匹配 ${expandedFields.length} 个字段...`);
          const secondMatch = await requestMatch(expandedFields, resume, expandedSectionInfo, true);
          mappings = secondMatch.mappings || {};
          activeFields = expandedFields;
          matchSkipped = secondMatch.skipped || [];
          pageReport.mappingCount = Object.keys(mappings).length;
          pageReport.backendSkippedCount = matchSkipped.length;
        }
      }

      // 4. Fill all mappings for the current visible page. We never click the
      // final submit button or upload files; unsupported/sensitive fields stay
      // in skipped/needs_user_input from the backend.
      sendProgress(`正在填写... (第 ${page + 1} 页)`);
      const { filled, skipped } = await FillEngine.fillAll(mappings, activeFields);
      const backendSkipped = describeSkippedFields(matchSkipped, activeFields, mappings);

      totalFilled += filled;
      totalSkipped = totalSkipped.concat(backendSkipped, skipped);
      pageReport.filledCount = filled;
      pageReport.runtimeSkippedCount = skipped.length;

      if (NavigationDetector.isSubmitOnly()) {
        pageReport.stopReason = 'submit_only';
        break;
      }

      sendProgress(`正在翻到下一页...`);
      const navigated = await NavigationDetector.clickNext();
      pageReport.navigated = navigated;
      if (!navigated) {
        pageReport.stopReason = 'no_next_page';
        break;
      }
    }

    report.completedAt = new Date().toISOString();
    report.totalFilled = totalFilled;
    report.totalSkipped = totalSkipped.length;
    report.skipped = totalSkipped.slice(0, 50);
    persistLastReport(report);

    // Only show overlay in the frame that actually filled something.
    if (totalFilled > 0 || totalSkipped.length > 0) {
      ResultAnnotator.show(totalFilled, totalSkipped, report);
    }

    chrome.runtime.sendMessage({
      type: MSG.FILL_COMPLETE,
      summary: `已填: ${totalFilled} 个字段, 跳过: ${totalSkipped.length} 个字段`,
      report,
    });
  } catch (err) {
    report.completedAt = new Date().toISOString();
    report.error = err.message || '填充过程出错';
    persistLastReport(report);
    chrome.runtime.sendMessage({
      type: MSG.FILL_ERROR,
      error: err.message || '填充过程出错',
      report,
    });
  } finally {
    running = false;
  }
}

function requestResume(resumeId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: MSG.REQUEST_RESUME, resumeId },
      response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || '后台未响应'));
          return;
        }
        if (!response) {
          reject(new Error('服务未响应，请检查后端是否启动'));
          return;
        }
        if (response.type === MSG.RESUME_DATA) resolve(response.data);
        else reject(new Error(response.error || '获取简历失败'));
      }
    );
  });
}

function requestMatch(fields, resume, sections, forceRefresh) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: MSG.REQUEST_MATCH, fields, resume, sections, forceRefresh: !!forceRefresh },
      response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || '后台未响应'));
          return;
        }
        if (!response) {
          reject(new Error('服务未响应，请检查后端是否启动'));
          return;
        }
        if (response.type === MSG.MATCH_RESULT) resolve(response.data);
        else reject(new Error(response.error || '字段匹配失败'));
      }
    );
  });
}

function describeSkippedFields(fieldIds, fields, mappings) {
  if (!Array.isArray(fieldIds) || fieldIds.length === 0) return [];
  const mappedIds = new Set(Object.keys(mappings || {}));
  const fieldsById = new Map((fields || []).map(field => [field.fieldId, field]));

  return fieldIds
    .filter(fieldId => !mappedIds.has(fieldId))
    .map(fieldId => {
      const field = fieldsById.get(fieldId) || {};
      return {
        fieldId,
        label: field.label || field.placeholder || fieldId,
        reason: '后端未找到足够可靠的简历来源，需人工确认',
      };
    });
}

function persistLastReport(report) {
  try {
    window.__resumeAutofillLastReport = report;
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ resumeAutofillLastReport: report });
    }
  } catch (_) {}
}
