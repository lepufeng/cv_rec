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

      // 2. First match to get section actions
      sendProgress(`正在匹配字段... (${initialFields.length} 个字段)`);
      const firstMatch = await requestMatch(initialFields, resume, sectionInfo);

      // 3. Execute section expansions
      if (firstMatch.sectionActions) {
        sendProgress(`正在展开板块... (第 ${page + 1} 页)`);
        await SectionManager.executeActions(firstMatch.sectionActions);
      }

      // 4. Re-scan after expansion
      const expandedFields = FieldScanner.scan();
      let mappings = firstMatch.mappings;

      // 5. If new fields appeared, re-match only new ones
      if (expandedFields.length > initialFields.length) {
        const newFields = expandedFields.filter(
          f => !initialFields.some(orig => orig.fieldId === f.fieldId)
        );
        if (newFields.length > 0) {
          const secondMatch = await requestMatch(newFields, resume, []);
          mappings = { ...firstMatch.mappings, ...secondMatch.mappings };
        }
      }

      // 6. Fill all merged mappings
      sendProgress(`正在填写... (第 ${page + 1} 页)`);
      const { filled, skipped } = await FillEngine.fillAll(mappings);

      totalFilled += filled;
      totalSkipped = totalSkipped.concat(skipped);

      if (NavigationDetector.isSubmitOnly()) break;

      sendProgress(`正在翻到下一页...`);
      const navigated = await NavigationDetector.clickNext();
      if (!navigated) break;
    }

    // Only show overlay in the frame that actually filled something.
    if (totalFilled > 0 || totalSkipped.length > 0) {
      ResultAnnotator.show(totalFilled, totalSkipped);
    }

    chrome.runtime.sendMessage({
      type: MSG.FILL_COMPLETE,
      summary: `已填: ${totalFilled} 个字段, 跳过: ${totalSkipped.length} 个字段`,
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: MSG.FILL_ERROR,
      error: err.message || '填充过程出错',
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

function requestMatch(fields, resume, sections) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: MSG.REQUEST_MATCH, fields, resume, sections },
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
