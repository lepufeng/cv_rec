const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_PATH,
    'playwright',
    path.join(
      os.homedir(),
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {}
  }
  return null;
}

async function injectExtensionScripts(page) {
  await injectScriptFiles(page, [
    'shared/dom-utils.js',
    'content/field-scanner.js',
    'content/handlers/text-handler.js',
    'content/handlers/select-handler.js',
    'content/handlers/date-handler.js',
    'content/handlers/choice-handler.js',
    'content/handlers/upload-handler.js',
    'content/fill-engine.js',
    'content/section-manager.js',
    'content/navigation-detector.js',
  ]);
}

async function injectContentRuntimeScripts(page) {
  await injectScriptFiles(page, [
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
  ]);
}

async function injectScriptFiles(page, files) {
  for (const file of files) {
    await page.addScriptTag({ path: path.join(extensionRoot, file) });
  }
}

async function installMockChromeRuntime(page) {
  await page.evaluate(() => {
    window.__mockChromeMessages = [];
    window.__mockMatchRequests = [];
    window.__autofillComplete = null;
    window.__autofillError = null;
    window.__mockStored = {};

    const projects = [
      {
        name: '项目一',
        role: '负责人',
        start: '2024-01',
        end: '2024-03',
        stack: 'FastAPI',
        result: '完成自动填写主链路',
      },
      {
        name: '项目二',
        role: '开发',
        start: '2024-04',
        end: '2024-06',
        stack: 'Playwright',
        result: '覆盖飞书招聘页面',
      },
      {
        name: '项目三',
        role: '测试',
        start: '2024-07',
        end: '2024-09',
        stack: 'Chrome Extension',
        result: '验证安全停止',
      },
    ];

    function mapFirstByLabel(fields, mappings, label, value) {
      const field = fields.find(item => item.label === label);
      if (field) mappings[field.fieldId] = value;
    }

    function actionTypeForField(field) {
      if (field.type === 'file' || field.widget === 'file-upload') return 'upload_file';
      if (field.type === 'date' || field.widget === 'date-picker' || field.widget === 'date-range') return 'set_date';
      if (field.type === 'checkbox') return 'check';
      if (field.type === 'select' || field.type === 'radio' || field.widget === 'pseudo-radio') return 'select_option';
      return 'set_text';
    }

    function buildActions(fields, mappings) {
      return fields
        .filter(field => Object.prototype.hasOwnProperty.call(mappings, field.fieldId))
        .map(field => ({
          fieldId: field.fieldId,
          actionType: actionTypeForField(field),
          value: field.type === 'file' || field.widget === 'file-upload'
            ? { resumeId: 'resume-1' }
            : mappings[field.fieldId],
        }));
    }

    function buildMatchResponse(message) {
      const fields = message.fields || [];
      const sections = message.sections || [];
      const labels = new Set(fields.map(field => field.label));
      const mappings = {};
      const sectionActions = {};

      window.__mockMatchRequests.push({
        labels: [...labels],
        sections,
        fieldCount: fields.length,
        forceRefresh: !!message.forceRefresh,
        payload: message.payload,
      });

      if (labels.has('推荐方式')) {
        mapFirstByLabel(fields, mappings, '推荐方式', '内推');
        mapFirstByLabel(fields, mappings, '姓名', '张三');
        mapFirstByLabel(fields, mappings, '邮箱', 'zhangsan@example.com');
        mapFirstByLabel(fields, mappings, '手机号', '13800138000');
        mapFirstByLabel(fields, mappings, '出生日期', '1998-05-01');
      } else if (labels.has('学校')) {
        mapFirstByLabel(fields, mappings, '学校', '上海交通大学');
        mapFirstByLabel(fields, mappings, '学历', '硕士');
        mapFirstByLabel(fields, mappings, '专业', '计算机科学');
      } else if (labels.has('项目名称')) {
        const projectSection = sections.find(section => section.name === '项目经历');
        const hasRepeatIndexes = fields.some(field => Number.isInteger(field.repeatIndex));
        if (projectSection && projectSection.currentCount < projects.length && !hasRepeatIndexes) {
          sectionActions['项目经历'] = `add_${projects.length - projectSection.currentCount}`;
        } else {
          for (const field of fields) {
            if (!Number.isInteger(field.repeatIndex)) continue;
            const project = projects[field.repeatIndex];
            if (field.label === '项目名称') mappings[field.fieldId] = project.name;
            else if (field.label === '项目角色') mappings[field.fieldId] = project.role;
            else if (field.label === '项目时间' && field.groupIndex === 0) mappings[field.fieldId] = project.start;
            else if (field.label === '项目时间' && field.groupIndex === 1) mappings[field.fieldId] = project.end;
            else if (field.label === '技术栈') mappings[field.fieldId] = project.stack;
            else if (field.label === '项目成果') mappings[field.fieldId] = project.result;
          }
        }
      } else if (labels.has('自我评价')) {
        for (const field of fields) {
          if (field.label === 'Python' || field.label === 'JavaScript') mappings[field.fieldId] = field.label;
          if (field.label === '自我评价') mappings[field.fieldId] = '具备完整产品化落地经验';
          if (field.label === '附件简历') mappings[field.fieldId] = '/tmp/resume.pdf';
        }
      }

      const actions = buildActions(fields, mappings);

      return {
        type: 'MATCH_RESULT',
        data: {
          plan_id: `mock-plan-${window.__mockMatchRequests.length}`,
          filled: {},
          mappings,
          actions,
          skipped: [],
          warnings: [],
          sectionActions,
        },
      };
    }

    window.chrome = {
      runtime: {
        lastError: null,
        onMessage: {
          addListener(listener) {
            window.__mockChromeListener = listener;
          },
        },
        sendMessage(message, callback) {
          window.__mockChromeMessages.push(message);
          if (message.type === 'REQUEST_RESUME') {
            setTimeout(() => callback({
              type: 'RESUME_DATA',
              data: { resume_id: 'resume-1', id: 'resume-1' },
            }), 0);
            return true;
          }
          if (message.type === 'REQUEST_RESUME_FILE') {
            setTimeout(() => callback({
              type: 'RESUME_FILE_DATA',
              data: {
                name: 'zhangsan_resume.pdf',
                mimeType: 'application/pdf',
                dataBase64: 'cmVzdW1l',
              },
            }), 0);
            return true;
          }
          if (message.type === 'REQUEST_MATCH') {
            setTimeout(() => callback(buildMatchResponse(message)), 0);
            return true;
          }
          if (message.type === 'FILL_COMPLETE') {
            window.__autofillComplete = message;
            return true;
          }
          if (message.type === 'FILL_ERROR') {
            window.__autofillError = message;
            return true;
          }
          return true;
        },
      },
      storage: {
        local: {
          set(value) {
            Object.assign(window.__mockStored, value);
          },
        },
      },
    };
  });
}

test('scanner annotates Formily-style repeated list items without card classes', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <main>
        <section style="display:none"><h2>教育经历</h2></section>
        <section data-form-field-i18n-name="项目经历">
          <h2>项目经历</h2>
          <div data-field-list>
            <div data-field-list-item>
              <label>项目名称<input type="text" placeholder="项目名称"></label>
              <label>项目角色<input type="text" placeholder="项目角色"></label>
              <label>项目成果<textarea placeholder="项目成果"></textarea></label>
            </div>
            <div data-field-list-item>
              <label>项目名称<input type="text" placeholder="项目名称"></label>
              <label>项目角色<input type="text" placeholder="项目角色"></label>
              <label>项目成果<textarea placeholder="项目成果"></textarea></label>
            </div>
            <div data-field-list-item>
              <label>项目名称<input type="text" placeholder="项目名称"></label>
              <label>项目角色<input type="text" placeholder="项目角色"></label>
              <label>项目成果<textarea placeholder="项目成果"></textarea></label>
            </div>
          </div>
        </section>
      </main>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(() => {
      const fields = FieldScanner.scan();
      return {
        fields: fields.map(field => ({
          label: field.label,
          section: field.section,
          repeatIndex: field.repeatIndex,
          repeatSize: field.repeatSize,
          repeatSection: field.repeatSection,
        })),
        repeatIndexes: [...new Set(fields.map(field => field.repeatIndex).filter(Number.isInteger))]
          .sort((a, b) => a - b),
      };
    });

    assert.equal(result.fields.length, 9);
    assert.deepEqual(result.repeatIndexes, [0, 1, 2]);
    assert.equal(result.fields.every(field => field.section === '项目经历'), true);
    assert.equal(result.fields.every(field => field.repeatSection === '项目经历'), true);
    assert.equal(result.fields.every(field => field.repeatSize === 3), true);
    assert.equal(result.fields.some(field => field.section === '教育经历'), false);
  } finally {
    await browser.close();
  }
});

test('scanner includes hidden file inputs with upload labels', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <main>
        <section class="feishu-form-section" data-form-field-i18n-name="简历附件">
          <h2>简历附件</h2>
          <div class="ud__upload">
            <p>将简历拖拽至此处</p>
            <button type="button">上传文件</button>
            <input id="resume-upload" type="file" style="display:none">
          </div>
        </section>
        <section class="feishu-form-section" data-form-field-i18n-name="个人照片">
          <h2>个人照片</h2>
          <div class="ud__upload">
            <button type="button">点击上传</button>
            <input id="photo-upload" type="file" style="display:none">
          </div>
        </section>
        <section class="atsx-form-section">
          <h2>作品集附件</h2>
          <div class="atsx-upload">
            <button type="button">上传作品集</button>
            <input id="portfolio-upload" type="file" style="display:none">
          </div>
        </section>
      </main>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(() => {
      const fields = FieldScanner.scan();
      return fields
        .filter(field => field.type === 'file')
        .map(field => ({
          id: field.fieldId,
          label: field.label,
          section: field.section,
          type: field.type,
          widget: field.widget,
          visible: field.visible,
        }));
    });

    assert.deepEqual(result, [
      {
        id: 'resume-upload',
        label: '简历附件',
        section: '简历附件',
        type: 'file',
        widget: 'file-upload',
        visible: false,
      },
      {
        id: 'photo-upload',
        label: '个人照片',
        section: '个人照片',
        type: 'file',
        widget: 'file-upload',
        visible: false,
      },
      {
        id: 'portfolio-upload',
        label: '作品集附件',
        section: '作品集附件',
        type: 'file',
        widget: 'file-upload',
        visible: false,
      },
    ]);
  } finally {
    await browser.close();
  }
});

test('scanner infers repeat metadata from repeated field signatures', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <main>
        <div id="education-list">
          <div class="plain-item">
            <label>学校名称<input type="text"></label>
            <label>学历<input type="text"></label>
            <label>专业<input type="text"></label>
            <label>起止时间<input type="text"></label>
            <label>起止时间<input type="text"></label>
          </div>
          <div class="plain-item">
            <label>学校名称<input type="text"></label>
            <label>学历<input type="text"></label>
            <label>专业<input type="text"></label>
            <label>起止时间<input type="text"></label>
            <label>起止时间<input type="text"></label>
          </div>
        </div>
        <div id="project-list">
          <div class="plain-item">
            <label>项目名称<input type="text"></label>
            <label>项目角色<input type="text"></label>
            <label>起止时间<input type="text"></label>
            <label>起止时间<input type="text"></label>
            <label>描述<textarea></textarea></label>
          </div>
          <div class="plain-item">
            <label>项目名称<input type="text"></label>
            <label>项目角色<input type="text"></label>
            <label>起止时间<input type="text"></label>
            <label>起止时间<input type="text"></label>
            <label>描述<textarea></textarea></label>
          </div>
        </div>
        <div id="mixed-list">
          <div class="plain-item">
            <label>候选学校<input type="text"></label>
            <label>候选专业<input type="text"></label>
          </div>
          <div class="plain-item">
            <label>候选公司<input type="text"></label>
            <label>候选职位<input type="text"></label>
          </div>
        </div>
      </main>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(() => {
      const fields = FieldScanner.scan();
      const compact = fields.map(field => ({
        label: field.label,
        repeatIndex: field.repeatIndex,
        repeatSize: field.repeatSize,
        repeatSection: field.repeatSection,
      }));
      return {
        fields: compact,
        education: compact.filter(field => field.repeatSection === '教育经历'),
        projects: compact.filter(field => field.repeatSection === '项目经历'),
        mixedTagged: compact.filter(field => field.label && field.label.startsWith('候选') && Number.isInteger(field.repeatIndex)),
        untaggedRepeats: compact.filter(field => Number.isInteger(field.repeatIndex) && !field.repeatSection),
      };
    });

    assert.equal(result.education.length, 10);
    assert.equal(result.projects.length, 10);
    assert.equal(result.untaggedRepeats.length, 0);
    assert.deepEqual(
      [...new Set(result.education.map(field => field.repeatIndex))].sort((a, b) => a - b),
      [0, 1],
    );
    assert.deepEqual(
      [...new Set(result.projects.map(field => field.repeatIndex))].sort((a, b) => a - b),
      [0, 1],
    );
    assert.equal(result.education.every(field => field.repeatSize === 2), true);
    assert.equal(result.projects.every(field => field.repeatSize === 2), true);
    assert.deepEqual(result.mixedTagged, []);
  } finally {
    await browser.close();
  }
});

test('navigation detector treats confirm and save continue buttons as safe next steps', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <main>
        <button id="submit-application" type="button">提交投递</button>
        <button id="confirm-submit" type="button">确认提交</button>
        <button id="confirm-continue" type="button">确认并继续</button>
        <button id="save-next" type="button">保存并下一步</button>
        <button id="save-page" type="button">保存并进入下一页</button>
        <input id="aria-next" type="button" aria-label="Save and continue">
      </main>
    `);
    await injectScriptFiles(page, [
      'shared/dom-utils.js',
      'content/navigation-detector.js',
    ]);

    const result = await page.evaluate(() => {
      const ids = [
        'submit-application',
        'confirm-submit',
        'confirm-continue',
        'save-next',
        'save-page',
        'aria-next',
      ];
      const classification = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        const text = NavigationDetector._buttonText(el);
        classification[id] = {
          text,
          next: NavigationDetector._looksLikeNext(text),
          final: NavigationDetector._looksLikeFinalSubmit(text),
        };
      }

      const firstNext = NavigationDetector.findNextButton();
      const beforeSubmitOnly = NavigationDetector.isSubmitOnly();
      for (const id of ['confirm-continue', 'save-next', 'save-page', 'aria-next']) {
        document.getElementById(id).remove();
      }

      return {
        firstNextId: firstNext && firstNext.id,
        beforeSubmitOnly,
        afterHasNext: !!NavigationDetector.findNextButton(),
        afterSubmitOnly: NavigationDetector.isSubmitOnly(),
        classification,
      };
    });

    assert.equal(result.firstNextId, 'confirm-continue');
    assert.equal(result.beforeSubmitOnly, false);
    assert.equal(result.afterHasNext, false);
    assert.equal(result.afterSubmitOnly, true);
    assert.equal(result.classification['confirm-continue'].next, true);
    assert.equal(result.classification['save-next'].next, true);
    assert.equal(result.classification['save-page'].next, true);
    assert.equal(result.classification['aria-next'].next, true);
    assert.equal(result.classification['submit-application'].final, true);
    assert.equal(result.classification['confirm-submit'].final, true);
  } finally {
    await browser.close();
  }
});

test('section manager expands generic plus buttons from data-named containers', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <section data-form-field-i18n-name="项目经历">
        <div id="items" data-field-list>
          <div data-field-list-item>
            <label>项目名称<input type="text"></label>
            <label>项目成果<textarea></textarea></label>
          </div>
        </div>
        <button id="add-project" type="button">+</button>
      </section>
      <section data-name="employment-history">
        <div id="work-items">
          <div class="employment-history-item">
            <label>公司<input type="text"></label>
            <label>职位<input type="text"></label>
          </div>
        </div>
        <button id="add-work" type="button" aria-label="add-work-experience">+</button>
      </section>
      <script>
        document.getElementById('add-project').addEventListener('click', () => {
          const item = document.querySelector('[data-field-list-item]').cloneNode(true);
          item.querySelectorAll('input, textarea').forEach(el => { el.value = ''; });
          document.getElementById('items').appendChild(item);
        });
        document.getElementById('add-work').addEventListener('click', () => {
          const item = document.querySelector('.employment-history-item').cloneNode(true);
          item.querySelectorAll('input').forEach(el => { el.value = ''; });
          document.getElementById('work-items').appendChild(item);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      SectionManager.reset();
      const before = SectionManager.collectSectionInfo();
      const actionResults = await SectionManager.executeActions({ '项目经历': 'add_2', 'work experience': 'add_1' });
      await new Promise(resolve => setTimeout(resolve, 100));
      const after = SectionManager.collectSectionInfo();
      return {
        before,
        after,
        actionResults,
        itemCount: document.querySelectorAll('[data-field-list-item]').length,
        workItemCount: document.querySelectorAll('.employment-history-item').length,
      };
    });

    assert.deepEqual(result.before.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.before.find(section => section.name === 'work experience'), {
      name: 'work experience',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.after.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 3,
      addButton: true,
    });
    assert.deepEqual(result.after.find(section => section.name === 'work experience'), {
      name: 'work experience',
      currentCount: 2,
      addButton: true,
    });
    assert.deepEqual(result.actionResults.map(item => ({
      sectionName: item.sectionName,
      requested: item.requested,
      attempted: item.attempted,
      added: item.added,
      status: item.status,
    })), [
      { sectionName: '项目经历', requested: 2, attempted: 2, added: 2, status: 'completed' },
      { sectionName: 'work experience', requested: 1, attempted: 1, added: 1, status: 'completed' },
    ]);
    assert.equal(result.itemCount, 3);
    assert.equal(result.workItemCount, 2);
  } finally {
    await browser.close();
  }
});

test('section manager detects Feishu apply form empty module wrappers', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <form>
        <div class="applyFormModuleWrapper__d8a302">
          <div class="applyFormModuleWrapper-left">
            <div class="applyFormModuleWrapper-title">
              <span class="applyFormModuleWrapper-text sofiaBold">教育经历</span>
            </div>
          </div>
          <div class="applyFormModuleWrapper-right">
            <div class="apply-form-array-card__1d6856">
              <label>学校名称<input data-form-field-i18n-name="学校名称" type="text"></label>
              <label>学历<input data-form-field-i18n-name="学历" type="text"></label>
              <label>专业<input data-form-field-i18n-name="专业" type="text"></label>
            </div>
            <button type="button" class="ud__button ud__button--text">添加</button>
          </div>
        </div>

        <div class="applyFormModuleWrapper-empty applyFormModuleWrapper__d8a302" data-module-key="internship">
          <div class="applyFormModuleWrapper-left">
            <div class="applyFormModuleWrapper-title"><span class="applyFormModuleWrapper-text sofiaBold">实习经历</span></div>
          </div>
          <div class="applyFormModuleWrapper-right">
            <button type="button" class="ud__button ud__button--text apply-form-array-card-add-float-right__1d6856">添加</button>
          </div>
        </div>

        <div class="applyFormModuleWrapper-empty applyFormModuleWrapper__d8a302" data-module-key="project">
          <div class="applyFormModuleWrapper-left">
            <div class="applyFormModuleWrapper-title"><span class="applyFormModuleWrapper-text sofiaBold">项目经历</span></div>
          </div>
          <div class="applyFormModuleWrapper-right">
            <button type="button" class="ud__button ud__button--text apply-form-array-card-add-float-right__1d6856">添加</button>
          </div>
        </div>

        <div class="applyFormModuleWrapper-empty applyFormModuleWrapper__d8a302" data-module-key="language">
          <div class="applyFormModuleWrapper-left">
            <div class="applyFormModuleWrapper-title"><span class="applyFormModuleWrapper-text sofiaBold">语言能力</span></div>
          </div>
          <div class="applyFormModuleWrapper-right">
            <button type="button" class="ud__button ud__button--text apply-form-array-card-add-float-right__1d6856">添加</button>
          </div>
        </div>
      </form>
      <script>
        document.querySelectorAll('[data-module-key]').forEach(module => {
          module.querySelector('button').addEventListener('click', () => {
            const key = module.getAttribute('data-module-key');
            const card = document.createElement('div');
            card.className = 'apply-form-array-card__1d6856';
            if (key === 'internship') {
              card.innerHTML = '<label>实习公司<input type="text"></label><label>实习岗位<input type="text"></label>';
            } else if (key === 'project') {
              card.innerHTML = '<label>项目名称<input type="text"></label><label>项目描述<textarea></textarea></label>';
            } else {
              card.innerHTML = '<label>语言<input type="text"></label><label>熟练程度<input type="text"></label>';
            }
            module.classList.remove('applyFormModuleWrapper-empty');
            module.querySelector('.applyFormModuleWrapper-right').insertBefore(card, module.querySelector('button'));
          });
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      SectionManager.reset();
      const before = SectionManager.collectSectionInfo();
      const internshipTarget = SectionManager._findAddTarget('实习经历');
      const projectTarget = SectionManager._findAddTarget('项目经历');
      const languageTarget = SectionManager._findAddTarget('语言能力');
      const actionResults = await SectionManager.executeActions({
        '实习经历': 'add_1',
        '项目经历': 'add_1',
        '语言能力': 'add_1',
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      const after = SectionManager.collectSectionInfo();
      const fields = FieldScanner.scan();
      return {
        before,
        after,
        actionResults,
        targetTexts: {
          internship: internshipTarget && internshipTarget.container && internshipTarget.container.textContent.replace(/\s+/g, ' ').trim(),
          project: projectTarget && projectTarget.container && projectTarget.container.textContent.replace(/\s+/g, ' ').trim(),
          language: languageTarget && languageTarget.container && languageTarget.container.textContent.replace(/\s+/g, ' ').trim(),
        },
        fieldSections: fields.map(field => ({ label: field.label, section: field.section })),
      };
    });

    assert.deepEqual(result.before.find(section => section.name === '教育经历'), {
      name: '教育经历',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.before.find(section => section.name === '实习经历'), {
      name: '实习经历',
      currentCount: 0,
      addButton: true,
    });
    assert.deepEqual(result.before.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 0,
      addButton: true,
    });
    assert.deepEqual(result.before.find(section => section.name === '语言能力'), {
      name: '语言能力',
      currentCount: 0,
      addButton: true,
    });
    assert.match(result.targetTexts.internship, /^实习经历/);
    assert.match(result.targetTexts.project, /^项目经历/);
    assert.match(result.targetTexts.language, /^语言能力/);
    assert.deepEqual(result.after.find(section => section.name === '实习经历'), {
      name: '实习经历',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.after.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.after.find(section => section.name === '语言能力'), {
      name: '语言能力',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.actionResults.map(item => ({
      sectionName: item.sectionName,
      requested: item.requested,
      attempted: item.attempted,
      added: item.added,
      beforeCount: item.beforeCount,
      afterCount: item.afterCount,
      status: item.status,
    })), [
      { sectionName: '实习经历', requested: 1, attempted: 1, added: 1, beforeCount: 0, afterCount: 1, status: 'completed' },
      { sectionName: '项目经历', requested: 1, attempted: 1, added: 1, beforeCount: 0, afterCount: 1, status: 'completed' },
      { sectionName: '语言能力', requested: 1, attempted: 1, added: 1, beforeCount: 0, afterCount: 1, status: 'completed' },
    ]);
    assert.equal(result.fieldSections.some(field => field.label === '实习公司' && field.section === '实习经历'), true);
    assert.equal(result.fieldSections.some(field => field.label === '项目名称' && field.section === '项目经历'), true);
    assert.equal(result.fieldSections.some(field => field.label === '语言' && field.section === '语言能力'), true);
  } finally {
    await browser.close();
  }
});

test('scanner emits backend matching metadata without losing widget semantics', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label for="legal-name">姓名</label>
      <input id="legal-name" name="profile.name" type="text" autocomplete="name" aria-label="真实姓名" value="张三" maxlength="20" readonly>

      <label for="locked-phone">手机号</label>
      <input id="locked-phone" name="mobile" type="tel" value="13800138000" disabled>

      <label for="preferred-city">期望城市</label>
      <select id="preferred-city" name="cities" multiple>
        <option value="sh" selected>上海</option>
        <option value="sz" selected>深圳</option>
        <option value="bj">北京</option>
      </select>

      <label for="degree">学历</label>
      <input id="degree" type="text" readonly>

      <div id="school" class="atsx-select ud__select" role="combobox" aria-haspopup="listbox" aria-autocomplete="list" aria-label="学校名称" data-form-field-i18n-name="学校名称">
        <input type="text">
      </div>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(() => {
      const fields = FieldScanner.scan();
      const byLabel = label => fields.find(field => field.label === label);
      return {
        name: byLabel('姓名'),
        phone: byLabel('手机号'),
        city: byLabel('期望城市'),
        degree: byLabel('学历'),
        school: byLabel('学校名称'),
      };
    });

    assert.equal(result.name.type, 'text');
    assert.equal(result.name.widget, 'text-input');
    assert.equal(result.name.name, 'profile.name');
    assert.equal(result.name.htmlType, 'text');
    assert.equal(result.name.autocomplete, 'name');
    assert.equal(result.name.ariaLabel, '真实姓名');
    assert.equal(result.name.currentValue, '张三');
    assert.equal(result.name.readonly, true);
    assert.equal(result.name.maxLength, 20);
    assert.equal(typeof result.name.frameUrl, 'string');

    assert.equal(result.phone.htmlType, 'tel');
    assert.equal(result.phone.disabled, true);
    assert.equal(result.phone.currentValue, '13800138000');

    assert.equal(result.city.widget, 'native-select');
    assert.equal(result.city.isMultiselect, true);
    assert.equal(result.city.currentValue, '上海、深圳');
    assert.deepEqual(result.city.options, ['上海', '深圳', '北京']);
    assert.deepEqual(result.city.optionObjects, [
      { label: '上海', value: 'sh' },
      { label: '深圳', value: 'sz' },
      { label: '北京', value: 'bj' },
    ]);

    assert.equal(result.degree.widget, 'custom-dropdown');
    assert.equal(result.degree.type, 'select');
    assert.equal(result.degree.readonly, true);

    assert.equal(result.school.widget, 'search-select');
    assert.equal(result.school.type, 'select');
    assert.equal(result.school.ariaLabel, '学校名称');
    assert.equal(result.school.autocomplete, 'list');
    assert.equal(result.school.isSearchableSelect, true);
  } finally {
    await browser.close();
  }
});

test('scanner and fill engine handle open shadow DOM controls', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label>姓名</label>
      <shadow-text-field id="name-host"></shadow-text-field>
      <script>
        customElements.define('shadow-text-field', class extends HTMLElement {
          connectedCallback() {
            const root = this.attachShadow({ mode: 'open' });
            root.innerHTML = '<input id="shadow-name" data-field="shadow-name" type="text">';
          }
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const field = fields.find(item => item.fieldId === 'shadow-name');
      FieldScanner._elementMap.clear();
      FillEngine.reset();
      const fill = await FillEngine.fillAll({ [field.fieldId]: '张三' }, fields);
      return {
        field,
        fill,
        value: document.getElementById('name-host').shadowRoot.querySelector('input').value,
      };
    });

    assert.equal(result.field.label, '姓名');
    assert.equal(result.field.type, 'text');
    assert.equal(result.field.widget, 'text-input');
    assert.equal(result.fill.filled, 1);
    assert.equal(result.fill.skipped.length, 0);
    assert.equal(result.value, '张三');
  } finally {
    await browser.close();
  }
});

test('section manager observes sibling repeat lists when add button sits in an action bar', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <section id="project-module">
        <h2>项目经历</h2>
        <div id="project-list">
          <div class="project-card">
            <label>项目名称<input type="text"></label>
            <label>项目成果<textarea></textarea></label>
          </div>
        </div>
        <div class="actions">
          <button id="add-project" type="button">添加项目经历</button>
        </div>
      </section>
      <script>
        document.getElementById('add-project').addEventListener('click', () => {
          const item = document.querySelector('.project-card').cloneNode(true);
          item.querySelectorAll('input, textarea').forEach(el => { el.value = ''; });
          document.getElementById('project-list').appendChild(item);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      SectionManager.reset();
      const directTarget = SectionManager._findAddTarget('项目经历');
      const before = SectionManager.collectSectionInfo();
      const actionResults = await SectionManager.executeActions({ '项目经历': 'add_2' });
      await new Promise(resolve => setTimeout(resolve, 100));
      const after = SectionManager.collectSectionInfo();
      return {
        before,
        after,
        actionResults,
        itemCount: document.querySelectorAll('.project-card').length,
        targetId: directTarget && directTarget.container && directTarget.container.id,
        actionBarCount: SectionManager._countRepeatItems(document.querySelector('.actions')),
        moduleCount: SectionManager._countRepeatItems(document.getElementById('project-module')),
      };
    });

    assert.equal(result.targetId, 'project-module');
    assert.equal(result.actionBarCount, 0);
    assert.deepEqual(result.before.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.after.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 3,
      addButton: true,
    });
    assert.equal(result.itemCount, 3);
    assert.equal(result.moduleCount, 3);
    assert.deepEqual(result.actionResults.map(item => ({
      sectionName: item.sectionName,
      requested: item.requested,
      attempted: item.attempted,
      added: item.added,
      beforeCount: item.beforeCount,
      afterCount: item.afterCount,
      status: item.status,
    })), [
      {
        sectionName: '项目经历',
        requested: 2,
        attempted: 2,
        added: 2,
        beforeCount: 1,
        afterCount: 3,
        status: 'completed',
      },
    ]);
  } finally {
    await browser.close();
  }
});

test('section manager clears checked empty-section toggles before adding experiences', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <section class="feishu-form-section" data-form-field-i18n-name="项目经历">
        <h2>项目经历</h2>
        <label id="no-project-wrap" class="ud__checkbox is-checked">
          <input id="no-project" type="checkbox" checked>
          无项目经历
        </label>
        <div id="project-list" style="display:none">
          <div class="apply-form-array-card project-card" data-field-list-item>
            <label>项目名称<input type="text"></label>
            <label>项目成果<textarea></textarea></label>
          </div>
        </div>
        <button id="add-project" class="ud__button" type="button" style="display:none">添加项目经历</button>
      </section>
      <script>
        const noProject = document.getElementById('no-project');
        noProject.addEventListener('change', () => {
          document.getElementById('no-project-wrap').classList.toggle('is-checked', noProject.checked);
          document.getElementById('project-list').style.display = noProject.checked ? 'none' : 'block';
          document.getElementById('add-project').style.display = noProject.checked ? 'none' : 'inline-block';
        });
        document.getElementById('add-project').addEventListener('click', () => {
          const item = document.querySelector('.project-card').cloneNode(true);
          item.querySelectorAll('input, textarea').forEach(el => { el.value = ''; });
          document.getElementById('project-list').appendChild(item);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      SectionManager.reset();
      const before = SectionManager.collectSectionInfo();
      const actionResults = await SectionManager.executeActions({ '项目经历': 'add_2' });
      await new Promise(resolve => setTimeout(resolve, 100));
      const after = SectionManager.collectSectionInfo();
      return {
        before,
        after,
        actionResults,
        checked: document.getElementById('no-project').checked,
        addVisible: getComputedStyle(document.getElementById('add-project')).display !== 'none',
        itemCount: document.querySelectorAll('.project-card').length,
      };
    });

    assert.deepEqual(result.before.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.after.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 3,
      addButton: true,
    });
    assert.equal(result.checked, false);
    assert.equal(result.addVisible, true);
    assert.equal(result.itemCount, 3);
    assert.deepEqual(result.actionResults.map(item => ({
      sectionName: item.sectionName,
      requested: item.requested,
      attempted: item.attempted,
      added: item.added,
      beforeCount: item.beforeCount,
      afterCount: item.afterCount,
      clearedEmptyToggle: item.clearedEmptyToggle,
      status: item.status,
    })), [
      {
        sectionName: '项目经历',
        requested: 2,
        attempted: 2,
        added: 2,
        beforeCount: 1,
        afterCount: 3,
        clearedEmptyToggle: true,
        status: 'completed',
      },
    ]);
  } finally {
    await browser.close();
  }
});

test('section manager reports zero count when empty toggle hides an unmounted list', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <section class="feishu-form-section" data-form-field-i18n-name="项目经历">
        <h2>项目经历</h2>
        <label id="no-project-wrap" class="ud__checkbox checked">
          <input id="no-project" type="checkbox" checked>
          无项目经历
        </label>
        <div id="project-list"></div>
        <button id="add-project" class="ud__button" type="button" style="display:none">添加项目经历</button>
      </section>
      <script>
        const noProject = document.getElementById('no-project');
        noProject.addEventListener('change', () => {
          document.getElementById('no-project-wrap').classList.toggle('checked', noProject.checked);
          document.getElementById('add-project').style.display = noProject.checked ? 'none' : 'inline-block';
        });
        document.getElementById('add-project').addEventListener('click', () => {
          const item = document.createElement('div');
          item.className = 'apply-form-array-card project-card';
          item.setAttribute('data-field-list-item', '');
          item.innerHTML = '<label>项目名称<input type="text"></label><label>项目成果<textarea></textarea></label>';
          document.getElementById('project-list').appendChild(item);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      SectionManager.reset();
      const before = SectionManager.collectSectionInfo();
      const actionResults = await SectionManager.executeActions({ '项目经历': 'add_3' });
      await new Promise(resolve => setTimeout(resolve, 100));
      const after = SectionManager.collectSectionInfo();
      return {
        before,
        after,
        actionResults,
        checked: document.getElementById('no-project').checked,
        itemCount: document.querySelectorAll('.project-card').length,
      };
    });

    assert.deepEqual(result.before.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 0,
      addButton: true,
    });
    assert.deepEqual(result.after.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 3,
      addButton: true,
    });
    assert.equal(result.checked, false);
    assert.equal(result.itemCount, 3);
    assert.deepEqual(result.actionResults.map(item => ({
      sectionName: item.sectionName,
      requested: item.requested,
      attempted: item.attempted,
      added: item.added,
      beforeCount: item.beforeCount,
      afterCount: item.afterCount,
      clearedEmptyToggle: item.clearedEmptyToggle,
      status: item.status,
    })), [
      {
        sectionName: '项目经历',
        requested: 3,
        attempted: 3,
        added: 3,
        beforeCount: 0,
        afterCount: 3,
        clearedEmptyToggle: true,
        status: 'completed',
      },
    ]);
  } finally {
    await browser.close();
  }
});

test('section manager reports add actions that do not increase repeat count', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <section>
        <h2>项目经历</h2>
        <div class="project-card">
          <label>项目名称<input type="text"></label>
          <label>项目成果<textarea></textarea></label>
        </div>
        <button id="add-project" type="button">添加项目经历</button>
      </section>
      <script>
        document.getElementById('add-project').addEventListener('click', () => {
          const marker = document.createElement('span');
          marker.textContent = 'clicked';
          document.querySelector('section').appendChild(marker);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      SectionManager.reset();
      SectionManager.EXPAND_TIMEOUT = 80;
      const before = SectionManager.collectSectionInfo();
      const actionResults = await SectionManager.executeActions({ '项目经历': 'add_1' });
      const after = SectionManager.collectSectionInfo();
      return { before, after, actionResults };
    });

    assert.deepEqual(result.before.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.after.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.actionResults.map(item => ({
      sectionName: item.sectionName,
      requested: item.requested,
      attempted: item.attempted,
      added: item.added,
      beforeCount: item.beforeCount,
      afterCount: item.afterCount,
      status: item.status,
    })), [
      {
        sectionName: '项目经历',
        requested: 1,
        attempted: 1,
        added: 0,
        beforeCount: 1,
        afterCount: 1,
        status: 'timeout',
      },
    ]);
  } finally {
    await browser.close();
  }
});

test('custom select chooses portal option leaves instead of dropdown containers', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label>学历</label>
      <div id="degree" class="atsx-select ud__select" role="combobox" aria-haspopup="listbox" data-form-field-i18n-name="学历">
        <input id="degree-input" type="text" readonly>
      </div>
      <script>
        document.getElementById('degree').addEventListener('click', () => {
          if (document.querySelector('.ant-select-dropdown')) return;
          const dropdown = document.createElement('div');
          dropdown.className = 'ant-select-dropdown';
          dropdown.innerHTML = '<div class="ant-select-item-list"><div class="ant-select-item-option" data-value="本科"><span>本科</span></div><div class="ant-select-item-option" data-value="硕士"><span>硕士</span></div><div class="ant-select-item-option" data-value="博士"><span>博士</span></div></div>';
          dropdown.querySelectorAll('[data-value]').forEach(option => {
            option.addEventListener('click', event => {
              document.querySelectorAll('[data-value]').forEach(item => item.removeAttribute('data-selected'));
              option.setAttribute('data-selected', 'true');
              document.getElementById('degree-input').value = option.getAttribute('data-value');
              event.stopPropagation();
            });
          });
          document.body.appendChild(dropdown);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const degree = fields.find(field => field.label === '学历');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({ [degree.fieldId]: '硕士' }, fields);
      return {
        fill,
        value: document.getElementById('degree-input').value,
        selected: document.querySelector('[data-selected="true"]')?.getAttribute('data-value'),
        dropdownText: document.querySelector('.ant-select-dropdown')?.textContent.replace(/\s+/g, ''),
      };
    });

    assert.equal(result.fill.filled, 1);
    assert.equal(result.value, '硕士');
    assert.equal(result.selected, '硕士');
    assert.equal(result.dropdownText, '本科硕士博士');
  } finally {
    await browser.close();
  }
});

test('fill engine skips readonly plain text while filling readonly custom selects', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label for="locked-email">邮箱</label>
      <input id="locked-email" type="email" readonly value="locked@example.com">

      <label>学历</label>
      <div id="degree" class="atsx-select ud__select" role="combobox" aria-haspopup="listbox" data-form-field-i18n-name="学历">
        <input id="degree-input" type="text" readonly>
      </div>

      <script>
        document.getElementById('degree').addEventListener('click', () => {
          if (document.querySelector('.ant-select-dropdown')) return;
          const dropdown = document.createElement('div');
          dropdown.className = 'ant-select-dropdown';
          dropdown.innerHTML = '<div class="ant-select-item-list"><div class="ant-select-item-option" data-value="本科">本科</div><div class="ant-select-item-option" data-value="硕士">硕士</div></div>';
          dropdown.querySelectorAll('[data-value]').forEach(option => {
            option.addEventListener('click', event => {
              option.setAttribute('data-selected', 'true');
              document.getElementById('degree-input').value = option.getAttribute('data-value');
              event.stopPropagation();
            });
          });
          document.body.appendChild(dropdown);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const email = fields.find(field => field.label === '邮箱');
      const degree = fields.find(field => field.label === '学历');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({
        [email.fieldId]: 'resume@example.com',
        [degree.fieldId]: '硕士',
      }, fields);

      return {
        fill,
        emailValue: document.getElementById('locked-email').value,
        degreeValue: document.getElementById('degree-input').value,
        emailField: {
          type: email.type,
          widget: email.widget,
        },
        degreeField: {
          type: degree.type,
          widget: degree.widget,
        },
      };
    });

    assert.equal(result.fill.filled, 1);
    assert.equal(result.emailValue, 'locked@example.com');
    assert.equal(result.degreeValue, '硕士');
    assert.equal(result.fill.skipped.length, 1);
    assert.equal(result.fill.skipped[0].label, '邮箱');
    assert.match(result.fill.skipped[0].reason, /只读/);
    assert.deepEqual(result.emailField, {
      type: 'text',
      widget: 'text-input',
    });
    assert.deepEqual(result.degreeField, {
      type: 'select',
      widget: 'aria-combobox',
    });
  } finally {
    await browser.close();
  }
});

test('fill engine preserves existing user values but fills placeholder fields', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label>姓名<input id="name" type="text" value="用户手动姓名"></label>
      <label>手机号<input id="phone" type="tel" value="13800138000"></label>
      <label>学历
        <select id="degree">
          <option selected>请选择</option>
          <option>本科</option>
          <option>硕士</option>
        </select>
      </label>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      FillEngine.reset();
      const fields = FieldScanner.scan();
      const byLabel = label => fields.find(field => field.label === label || (field.label || '').includes(label));
      const name = byLabel('姓名');
      const phone = byLabel('手机号');
      const degree = byLabel('学历') || fields.find(field => field.fieldId === 'degree');
      const fill = await FillEngine.fillAll({
        [name.fieldId]: '张三',
        [phone.fieldId]: '13800138000',
        [degree.fieldId]: '硕士',
      }, fields);
      return {
        fill,
        nameValue: document.getElementById('name').value,
        phoneValue: document.getElementById('phone').value,
        degreeValue: document.getElementById('degree').value,
        currentValues: {
          name: name.currentValue,
          phone: phone.currentValue,
          degree: degree.currentValue,
        },
      };
    });

    assert.equal(result.nameValue, '用户手动姓名');
    assert.equal(result.phoneValue, '13800138000');
    assert.equal(result.degreeValue, '硕士');
    assert.equal(result.fill.filled, 2);
    assert.equal(result.fill.skipped.length, 1);
    assert.equal(result.fill.skipped[0].label, '姓名');
    assert.match(result.fill.skipped[0].reason, /已有值/);
    assert.deepEqual(result.currentValues, {
      name: '用户手动姓名',
      phone: '13800138000',
      degree: '请选择',
    });
  } finally {
    await browser.close();
  }
});

test('select handler fills multi-value custom and native selects', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label>期望工作城市（至多三个）</label>
      <div id="cities" class="atsx-select ud__select" role="combobox" aria-haspopup="listbox" data-form-field-i18n-name="期望工作城市">
        <input id="cities-input" type="text">
      </div>
      <div id="city-tags"></div>

      <label>开发语言</label>
      <select id="languages" multiple>
        <option>Python</option>
        <option>JavaScript</option>
        <option>Go</option>
      </select>

      <script>
        window.selectedCities = [];
        document.getElementById('cities').addEventListener('click', () => {
          if (document.querySelector('.multi-city-dropdown')) return;
          const dropdown = document.createElement('div');
          dropdown.className = 'multi-city-dropdown ant-select-dropdown';
          dropdown.innerHTML = '<div role="listbox"><div role="option" data-value="北京">北京</div><div role="option" data-value="上海">上海</div><div role="option" data-value="深圳">深圳</div></div>';
          dropdown.querySelectorAll('[data-value]').forEach(option => {
            option.addEventListener('click', event => {
              const value = option.getAttribute('data-value');
              if (!window.selectedCities.includes(value)) window.selectedCities.push(value);
              option.setAttribute('aria-selected', 'true');
              document.getElementById('city-tags').textContent = window.selectedCities.join('|');
              document.getElementById('cities-input').value = '';
              event.stopPropagation();
            });
          });
          document.body.appendChild(dropdown);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const city = fields.find(field => field.label === '期望工作城市');
      const languages = fields.find(field => field.label === '开发语言');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({
        [city.fieldId]: '上海、深圳',
        [languages.fieldId]: ['Python', 'JavaScript'],
      }, fields);
      return {
        fill,
        cityTags: document.getElementById('city-tags').textContent,
        selectedCities: window.selectedCities,
        selectedLanguages: [...document.getElementById('languages').selectedOptions].map(option => option.textContent),
      };
    });

    assert.equal(result.fill.filled, 2);
    assert.deepEqual(result.selectedCities, ['上海', '深圳']);
    assert.equal(result.cityTags, '上海|深圳');
    assert.deepEqual(result.selectedLanguages, ['Python', 'JavaScript']);
  } finally {
    await browser.close();
  }
});

test('select handler commits searchable dropdowns with keyboard fallback', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label>学校名称</label>
      <div id="school" class="atsx-select ud__select" role="combobox" aria-haspopup="listbox" aria-autocomplete="list" data-form-field-i18n-name="学校名称">
        <span id="school-selected"></span>
        <input id="school-input" type="text">
      </div>
      <script>
        const input = document.getElementById('school-input');
        document.getElementById('school').addEventListener('click', () => {
          if (document.querySelector('.school-dropdown')) return;
          const dropdown = document.createElement('div');
          dropdown.className = 'school-dropdown ant-select-dropdown';
          dropdown.innerHTML = '<div role="listbox"><div role="option" data-value="上海交通大学">上海交通大学</div></div>';
          dropdown.querySelector('[role="option"]').addEventListener('click', event => {
            // Some real search selects ignore direct option clicks unless the
            // keyboard-active option is committed.
            event.stopPropagation();
          });
          document.body.appendChild(dropdown);
        });
        input.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          const option = document.querySelector('[role="option"]');
          if (!option || !input.value.includes(option.getAttribute('data-value'))) return;
          option.setAttribute('aria-selected', 'true');
          document.getElementById('school-selected').textContent = option.getAttribute('data-value');
          input.value = '';
          document.querySelector('.school-dropdown')?.remove();
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const school = fields.find(field => field.label === '学校名称');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({ [school.fieldId]: '上海交通大学' }, fields);
      return {
        fill,
        widget: school.widget,
        selected: document.getElementById('school-selected').textContent,
        inputValue: document.getElementById('school-input').value,
      };
    });

    assert.equal(result.widget, 'search-select');
    assert.equal(result.fill.filled, 1);
    assert.equal(result.selected, '上海交通大学');
    assert.equal(result.inputValue, '');
  } finally {
    await browser.close();
  }
});

test('select handler waits for async searchable dropdown results', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label>学校名称</label>
      <div id="school" class="atsx-select ud__select" role="combobox" aria-haspopup="listbox" aria-autocomplete="list" data-form-field-i18n-name="学校名称">
        <span id="school-selected"></span>
        <input id="school-input" type="text">
      </div>
      <script>
        const input = document.getElementById('school-input');
        document.getElementById('school').addEventListener('click', () => {
          if (window.asyncDropdownStarted) return;
          window.asyncDropdownStarted = true;
          setTimeout(() => {
            const dropdown = document.createElement('div');
            dropdown.className = 'school-dropdown ant-select-dropdown';
            dropdown.innerHTML = '<div role="listbox"><div role="option" data-value="上海交通大学">上海交通大学</div></div>';
            dropdown.querySelector('[role="option"]').addEventListener('click', event => {
              const option = event.currentTarget;
              option.setAttribute('aria-selected', 'true');
              document.getElementById('school-selected').textContent = option.getAttribute('data-value');
              input.value = '';
              event.stopPropagation();
            });
            document.body.appendChild(dropdown);
          }, 650);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const school = fields.find(field => field.label === '学校名称');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({ [school.fieldId]: '上海交通大学' }, fields);
      return {
        fill,
        widget: school.widget,
        selected: document.getElementById('school-selected').textContent,
        inputValue: document.getElementById('school-input').value,
      };
    });

    assert.equal(result.widget, 'search-select');
    assert.equal(result.fill.filled, 1);
    assert.equal(result.selected, '上海交通大学');
    assert.equal(result.inputValue, '');
  } finally {
    await browser.close();
  }
});

test('select handler does not accept bare typed text for searchable dropdowns', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label>学校名称</label>
      <div id="school" class="atsx-select ud__select" role="combobox" aria-haspopup="listbox" aria-autocomplete="list" data-form-field-i18n-name="学校名称">
        <span id="school-selected"></span>
        <input id="school-input" type="text">
      </div>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      SelectHandler.DROPDOWN_WAIT_MS = 160;
      const fields = FieldScanner.scan();
      const school = fields.find(field => field.label === '学校名称');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({ [school.fieldId]: '不存在大学' }, fields);
      return {
        fill,
        selected: document.getElementById('school-selected').textContent,
        inputValue: document.getElementById('school-input').value,
      };
    });

    assert.equal(result.fill.filled, 0);
    assert.equal(result.fill.skipped.length, 1);
    assert.equal(result.selected, '');
    assert.equal(result.inputValue, '不存在大学');
  } finally {
    await browser.close();
  }
});

test('select handler fills cascader controls by path', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label>当前所处地</label>
      <div id="region" class="atsx-cascader ant-cascader" data-form-field-i18n-name="当前所处地">
        <input id="region-input" class="ant-cascader-input" type="text" readonly>
      </div>
      <script>
        document.getElementById('region').addEventListener('click', () => {
          if (document.querySelector('.ant-cascader-dropdown')) return;
          const dropdown = document.createElement('div');
          dropdown.className = 'ant-cascader-dropdown';
          dropdown.innerHTML = '<div class="ant-cascader-menu"><div class="ant-cascader-menu-item" data-value="广东省">广东省</div><div class="ant-cascader-menu-item" data-value="上海市">上海市</div></div>';
          dropdown.querySelector('[data-value="广东省"]').addEventListener('click', event => {
            event.stopPropagation();
            const second = document.createElement('div');
            second.className = 'ant-cascader-menu';
            second.innerHTML = '<div class="ant-cascader-menu-item" data-value="广州市">广州市</div><div class="ant-cascader-menu-item" data-value="深圳市">深圳市</div>';
            second.querySelector('[data-value="深圳市"]').addEventListener('click', leafEvent => {
              leafEvent.stopPropagation();
              leafEvent.currentTarget.setAttribute('data-selected', 'true');
              document.getElementById('region-input').value = '广东省 / 深圳市';
            });
            dropdown.appendChild(second);
          });
          document.body.appendChild(dropdown);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const region = fields.find(field => field.label === '当前所处地');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({ [region.fieldId]: '广东省 / 深圳市' }, fields);
      return {
        fill,
        widget: region.widget,
        value: document.getElementById('region-input').value,
        leafSelected: document.querySelector('[data-value="深圳市"]')?.getAttribute('data-selected'),
      };
    });

    assert.equal(result.widget, 'cascader');
    assert.equal(result.fill.filled, 1);
    assert.equal(result.value, '广东省 / 深圳市');
    assert.equal(result.leafSelected, 'true');
  } finally {
    await browser.close();
  }
});

test('fill engine applies unordered mappings in scanned page order', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label for="country">国家/地区</label>
      <input id="country" type="text">
      <label for="phone">手机号码</label>
      <input id="phone" type="text" disabled>
      <script>
        window.fillOrder = [];
        const country = document.getElementById('country');
        const phone = document.getElementById('phone');
        country.addEventListener('input', () => {
          window.fillOrder.push('country');
          phone.disabled = false;
        });
        phone.addEventListener('input', () => {
          window.fillOrder.push('phone');
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const country = fields.find(field => field.label === '国家/地区');
      const phone = fields.find(field => field.label === '手机号码');
      const unorderedMappings = {
        [phone.fieldId]: '13800138000',
        [country.fieldId]: '中国',
      };
      FillEngine.reset();
      const fill = await FillEngine.fillAll(unorderedMappings, fields);
      return {
        fill,
        countryValue: document.getElementById('country').value,
        phoneValue: document.getElementById('phone').value,
        phoneDisabled: document.getElementById('phone').disabled,
        fillOrder: window.fillOrder,
        orderedIds: FillEngine._orderedEntries(unorderedMappings, fields).map(entry => entry[0]),
        countryId: country.fieldId,
        phoneId: phone.fieldId,
      };
    });

    assert.equal(result.fill.filled, 2);
    assert.equal(result.countryValue, '中国');
    assert.equal(result.phoneValue, '13800138000');
    assert.equal(result.phoneDisabled, false);
    assert.deepEqual(result.fillOrder, ['country', 'phone']);
    assert.deepEqual(result.orderedIds, [result.countryId, result.phoneId]);
  } finally {
    await browser.close();
  }
});

test('fill engine checks current experience checkbox from mapped present value', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <section>
        <h2>工作经历</h2>
        <div class="work-experience-card">
          <label>公司<input type="text"></label>
          <label>职位<input type="text"></label>
          <label>至今<input id="current-work" type="checkbox"></label>
        </div>
      </section>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const current = fields.find(field => field.label === '至今');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({ [current.fieldId]: '至今' }, fields);
      return {
        fill,
        checked: document.getElementById('current-work').checked,
        field: {
          label: current.label,
          type: current.type,
          options: current.options,
        },
      };
    });

    assert.equal(result.fill.filled, 1);
    assert.equal(result.checked, true);
    assert.deepEqual(result.field, {
      label: '至今',
      type: 'checkbox',
      options: ['至今'],
    });
  } finally {
    await browser.close();
  }
});

test('date handler normalizes month and year resume dates for native inputs', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label for="start-date">项目开始日期</label>
      <input id="start-date" type="date">

      <label for="end-month">项目结束时间</label>
      <input id="end-month" type="month">

      <label for="award-year">获奖时间</label>
      <input id="award-year" type="text" placeholder="YYYY" maxlength="4">
      <script>
        window.dateCommitted = [];
        document.getElementById('award-year').addEventListener('keydown', event => {
          if (event.key === 'Enter') window.dateCommitted.push(event.target.value);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const byLabel = label => fields.find(field => field.label === label);
      FillEngine.reset();
      const fill = await FillEngine.fillAll({
        [byLabel('项目开始日期').fieldId]: '2024-01',
        [byLabel('项目结束时间').fieldId]: '2024-06-15',
        [byLabel('获奖时间').fieldId]: '2023-09',
      }, fields);
      return {
        fill,
        start: document.getElementById('start-date').value,
        end: document.getElementById('end-month').value,
        award: document.getElementById('award-year').value,
        dateCommitted: window.dateCommitted,
      };
    });

    assert.equal(result.fill.filled, 3);
    assert.equal(result.start, '2024-01-01');
    assert.equal(result.end, '2024-06');
    assert.equal(result.award, '2023');
    assert.deepEqual(result.dateCommitted, ['2023']);
  } finally {
    await browser.close();
  }
});

test('date handler selects custom picker options for readonly date widgets', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label for="grad-month">毕业时间</label>
      <div class="ant-picker ant-picker-month">
        <input id="grad-month" class="ant-picker-input date-picker" type="text" readonly placeholder="请选择月份">
      </div>
      <script>
        window.clickedDateOption = '';
        const input = document.getElementById('grad-month');
        input.addEventListener('click', () => {
          if (document.querySelector('.ant-picker-dropdown')) return;
          const dropdown = document.createElement('div');
          dropdown.className = 'ant-picker-dropdown';
          dropdown.innerHTML = '<div class="ant-picker-panel"><div class="ant-picker-cell" title="2025-05" data-value="2025-05">2025年5月</div><div class="ant-picker-cell" title="2025-06" data-value="2025-06">2025年6月</div></div>';
          dropdown.querySelectorAll('[data-value]').forEach(option => {
            option.addEventListener('click', event => {
              window.clickedDateOption = option.getAttribute('data-value');
              option.setAttribute('aria-selected', 'true');
              input.value = option.getAttribute('data-value');
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              event.stopPropagation();
            });
          });
          document.body.appendChild(dropdown);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const grad = fields.find(field => field.label === '毕业时间');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({ [grad.fieldId]: '2025-06' }, fields);
      return {
        fill,
        value: document.getElementById('grad-month').value,
        clickedDateOption: window.clickedDateOption,
        field: {
          type: grad.type,
          widget: grad.widget,
          readonly: grad.readonly,
        },
      };
    });

    assert.equal(result.fill.filled, 1);
    assert.equal(result.value, '2025-06');
    assert.equal(result.clickedDateOption, '2025-06');
    assert.deepEqual(result.field, {
      type: 'date',
      widget: 'date-picker',
      readonly: true,
    });
  } finally {
    await browser.close();
  }
});

test('date handler fills single custom date-range widgets by selecting both ends', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <label for="project-range">项目时间</label>
      <div class="ant-picker ant-picker-range date-range-picker">
        <input id="project-range" class="ant-picker-input" type="text" readonly placeholder="请选择起止时间">
      </div>
      <script>
        window.clickedRangeOptions = [];
        const input = document.getElementById('project-range');
        input.addEventListener('click', () => {
          if (document.querySelector('.ant-picker-dropdown')) return;
          const dropdown = document.createElement('div');
          dropdown.className = 'ant-picker-dropdown';
          dropdown.innerHTML = '<div class="ant-picker-panel"><div class="ant-picker-cell" data-value="2024-01" title="2024-01">2024年1月</div><div class="ant-picker-cell" data-value="2024-06" title="2024-06">2024年6月</div></div>';
          dropdown.querySelectorAll('[data-value]').forEach(option => {
            option.addEventListener('click', event => {
              const value = option.getAttribute('data-value');
              window.clickedRangeOptions.push(value);
              option.setAttribute('aria-selected', 'true');
              if (window.clickedRangeOptions.length >= 2) {
                input.value = window.clickedRangeOptions.slice(0, 2).join(' - ');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
              event.stopPropagation();
            });
          });
          document.body.appendChild(dropdown);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const range = fields.find(field => field.label === '项目时间');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({ [range.fieldId]: '2024-01 - 2024-06' }, fields);
      return {
        fill,
        value: document.getElementById('project-range').value,
        clickedRangeOptions: window.clickedRangeOptions,
        field: {
          type: range.type,
          widget: range.widget,
          readonly: range.readonly,
        },
      };
    });

    assert.equal(result.fill.filled, 1);
    assert.equal(result.value, '2024-01 - 2024-06');
    assert.deepEqual(result.clickedRangeOptions, ['2024-01', '2024-06']);
    assert.deepEqual(result.field, {
      type: 'date',
      widget: 'date-range',
      readonly: true,
    });
  } finally {
    await browser.close();
  }
});

test('fill engine fills grouped date range inputs in one picker interaction', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <div class="ud-formily-item">
        <div class="ud-formily-item-label"><label>起止时间*</label></div>
        <div class="ud-formily-item-control-content-component">
          <div class="ant-picker ant-picker-range date-range-picker">
            <input id="range-start" class="ant-picker-input" type="text" readonly placeholder="开始时间">
            <span class="ant-picker-separator">~</span>
            <input id="range-end" class="ant-picker-input" type="text" readonly placeholder="结束时间">
          </div>
        </div>
      </div>
      <script>
        window.clickedRangeOptions = [];
        function openPicker() {
          if (document.querySelector('.ant-picker-dropdown')) return;
          const dropdown = document.createElement('div');
          dropdown.className = 'ant-picker-dropdown';
          dropdown.innerHTML = '<div class="ant-picker-panel"><div class="ant-picker-cell" data-value="2025-09" title="2025-09">2025年9月</div><div class="ant-picker-cell" data-value="2027-06" title="2027-06">2027年6月</div></div>';
          dropdown.querySelectorAll('[data-value]').forEach(option => {
            option.addEventListener('click', event => {
              const value = option.getAttribute('data-value');
              window.clickedRangeOptions.push(value);
              option.setAttribute('aria-selected', 'true');
              if (window.clickedRangeOptions.length >= 2) {
                const values = window.clickedRangeOptions.slice(0, 2);
                const start = document.getElementById('range-start');
                const end = document.getElementById('range-end');
                start.value = values[0];
                end.value = values[1];
                [start, end].forEach(input => {
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                });
              }
              event.stopPropagation();
            });
          });
          document.body.appendChild(dropdown);
        }
        document.getElementById('range-start').addEventListener('click', openPicker);
        document.getElementById('range-end').addEventListener('click', openPicker);
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const rangeFields = fields
        .filter(field => field.label === '起止时间' && field.type === 'date')
        .sort((a, b) => a.groupIndex - b.groupIndex);
      const mappings = {
        [rangeFields[0].fieldId]: '2025-09',
        [rangeFields[1].fieldId]: '2027-06',
      };
      FillEngine.reset();
      const fill = await FillEngine.fillAll(mappings, fields);
      return {
        fill,
        startValue: document.getElementById('range-start').value,
        endValue: document.getElementById('range-end').value,
        clickedRangeOptions: window.clickedRangeOptions,
        fields: rangeFields.map(field => ({
          type: field.type,
          widget: field.widget,
          groupIndex: field.groupIndex,
          groupSize: field.groupSize,
          readonly: field.readonly,
        })),
      };
    });

    assert.equal(result.fields.length, 2);
    assert.equal(result.fill.filled, 2);
    assert.equal(result.fill.skipped.length, 0);
    assert.equal(result.startValue, '2025-09');
    assert.equal(result.endValue, '2027-06');
    assert.deepEqual(result.clickedRangeOptions, ['2025-09', '2027-06']);
    assert.deepEqual(result.fields, [
      { type: 'date', widget: 'date-range', groupIndex: 0, groupSize: 2, readonly: true },
      { type: 'date', widget: 'date-range', groupIndex: 1, groupSize: 2, readonly: true },
    ]);
  } finally {
    await browser.close();
  }
});

test('fill engine pairs date ranges by wrapper when field order or group ids are unreliable', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <div class="card">
        <div class="ud-formily-item"><label>起止时间</label>
          <div class="throne-biz-date-range-picker-wrapper">
            <input id="range-a-start" readonly><span>~</span><input id="range-a-end" readonly>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="ud-formily-item"><label>起止时间</label>
          <div class="throne-biz-date-range-picker-wrapper">
            <input id="range-b-start" readonly><span>~</span><input id="range-b-end" readonly>
          </div>
        </div>
      </div>
      <script>
        window.clickedRangeOptions = [];
        let activeWrapper = null;
        let activeClicks = [];
        function openPicker(event) {
          activeWrapper = event.target.closest('.throne-biz-date-range-picker-wrapper');
          activeClicks = [];
          document.querySelector('.ant-picker-dropdown')?.remove();
          const dropdown = document.createElement('div');
          dropdown.className = 'ant-picker-dropdown';
          dropdown.innerHTML = [
            '<div class="ant-picker-panel">',
              '<div class="ant-picker-cell" data-value="2025-01" title="2025-01">2025年1月</div>',
              '<div class="ant-picker-cell" data-value="2025-02" title="2025-02">2025年2月</div>',
              '<div class="ant-picker-cell" data-value="2024-01" title="2024-01">2024年1月</div>',
              '<div class="ant-picker-cell" data-value="2024-02" title="2024-02">2024年2月</div>',
            '</div>',
          ].join('');
          dropdown.querySelectorAll('[data-value]').forEach(option => {
            option.addEventListener('click', event => {
              const value = option.getAttribute('data-value');
              activeClicks.push(value);
              window.clickedRangeOptions.push(value);
              if (activeClicks.length >= 2 && activeWrapper) {
                const inputs = activeWrapper.querySelectorAll('input');
                inputs[0].value = activeClicks[0];
                inputs[1].value = activeClicks[1];
                inputs.forEach(input => {
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                });
                dropdown.remove();
              }
              event.stopPropagation();
            });
          });
          document.body.appendChild(dropdown);
        }
        document.querySelectorAll('.throne-biz-date-range-picker-wrapper input')
          .forEach(input => input.addEventListener('click', openPicker));
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const scanned = FieldScanner.scan()
        .filter(field => field.label === '起止时间')
        .sort((a, b) => a.groupId === b.groupId
          ? a.groupIndex - b.groupIndex
          : String(a.groupId).localeCompare(String(b.groupId)));
      const fields = [scanned[0], scanned[2], scanned[1], scanned[3]]
        .map(field => {
          const copy = { ...field };
          copy.widget = 'date-picker';
          return copy;
        });
      fields[0].groupId = 'bad-cross-wrapper-group';
      fields[3].groupId = 'bad-cross-wrapper-group';
      const mappings = {
        [scanned[0].fieldId]: '2025-01',
        [scanned[1].fieldId]: '2025-02',
        [scanned[2].fieldId]: '2024-01',
        [scanned[3].fieldId]: '2024-02',
      };
      FillEngine.reset();
      const fill = await FillEngine.fillAll(mappings, fields);
      return {
        fill,
        a: [
          document.getElementById('range-a-start').value,
          document.getElementById('range-a-end').value,
        ],
        b: [
          document.getElementById('range-b-start').value,
          document.getElementById('range-b-end').value,
        ],
        clickedRangeOptions: window.clickedRangeOptions,
      };
    });

    assert.equal(result.fill.filled, 4);
    assert.equal(result.fill.skipped.length, 0);
    assert.deepEqual(result.a, ['2025-01', '2025-02']);
    assert.deepEqual(result.b, ['2024-01', '2024-02']);
    assert.deepEqual(result.clickedRangeOptions, ['2025-01', '2025-02', '2024-01', '2024-02']);
  } finally {
    await browser.close();
  }
});

test('fill engine does not pair adjacent date starts as a range fallback', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <input id="range-a-start">
      <input id="range-b-start">
      <input id="range-a-end">
      <input id="range-b-end">
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(() => {
      const fields = [
        { fieldId: 'range-a-start', label: '起止时间', type: 'date', widget: 'date-picker', groupIndex: 0, groupSize: 2, repeatSection: '项目经历', repeatIndex: 0 },
        { fieldId: 'range-b-start', label: '起止时间', type: 'date', widget: 'date-picker', groupIndex: 0, groupSize: 2, repeatSection: '项目经历', repeatIndex: 1 },
        { fieldId: 'range-a-end', label: '起止时间', type: 'date', widget: 'date-picker', groupIndex: 1, groupSize: 2, repeatSection: '项目经历', repeatIndex: 0 },
        { fieldId: 'range-b-end', label: '起止时间', type: 'date', widget: 'date-picker', groupIndex: 1, groupSize: 2, repeatSection: '项目经历', repeatIndex: 1 },
      ];
      const mappings = new Map(fields.map((field, index) => [field.fieldId, `2025-0${index + 1}`]));
      const group = FillEngine._dateGroupFields('range-a-start', fields[0], fields, mappings, new Set());
      return group && group.map(field => field.fieldId);
    });

    assert.equal(result, null);
  } finally {
    await browser.close();
  }
});

test('date handler fills Feishu month range picker with year navigation', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <div id="formily-item" class="ud-formily-item ud-formily-item-layout-vertical ud-formily-item-error">
        <div class="ud-formily-item-label"><label>起止时间*</label></div>
        <div class="ud-formily-item-control">
          <div class="ud-formily-item-control-content-component">
            <div class="throne-biz-date-range-picker-wrapper throne-biz-date-range-picker-error">
              <div class="throne-biz-date-range-picker-input">
                <div class="ud__input"><label class="ud__input-input-wrap"><input id="range-start" class="ud__native-input"></label></div>
              </div>
              <div class="throne-biz-date-range-picker-seperator">~</div>
              <div class="throne-biz-date-range-picker-input throne-biz-date-range-picker-hasValue">
                <div class="ud__input"><label class="ud__input-input-wrap"><input id="range-end" class="ud__native-input" value="2027-06"></label></div>
              </div>
            </div>
          </div>
          <div id="range-extra" class="ud-formily-item-extra">请填写完整时间</div>
        </div>
      </div>
      <script>
        window.clickedRangeOptions = [];
        window.clickedYearNav = [];
        window.validationCommitCount = 0;
        let currentYear = 2026;
        let phase = 0;

        function renderPicker() {
          let dropdown = document.querySelector('.ud__dropdown');
          if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.className = 'ud__dropdown ud__dropdown-placement-bottomLeft';
            document.body.appendChild(dropdown);
          }
          const months = Array.from({ length: 12 }, (_, index) => {
            const value = String(index + 1).padStart(2, '0');
            return '<div class="ud__picker__cell ud__picker-month-panel-cell"><div class="ud__picker__cell__inner">' + value + '月</div></div>';
          }).join('');
          dropdown.innerHTML = [
            '<div class="throne-biz-date-range-picker-panel">',
              '<div class="ud__picker-panel-header">',
                '<span class="ud__picker-panel-header-btn">' + currentYear + '年</span>',
                '<button type="button" class="ud__button ud__picker-panel-header-icon ud__picker-panel-header-collapse"></button>',
                '<button type="button" class="ud__button ud__picker-panel-header-icon" data-nav="prev"></button>',
                '<button type="button" class="ud__button ud__picker-panel-header-icon" data-nav="next"></button>',
              '</div>',
              '<div class="ud__picker-panel-body-content notranslate">' + months + '</div>',
            '</div>',
          ].join('');
          dropdown.querySelector('[data-nav="prev"]').addEventListener('click', event => {
            currentYear -= 1;
            window.clickedYearNav.push(currentYear);
            renderPicker();
            event.stopPropagation();
          });
          dropdown.querySelector('[data-nav="next"]').addEventListener('click', event => {
            currentYear += 1;
            window.clickedYearNav.push(currentYear);
            renderPicker();
            event.stopPropagation();
          });
          dropdown.querySelectorAll('.ud__picker-month-panel-cell').forEach((cell, index) => {
            cell.addEventListener('click', event => {
              const value = currentYear + '-' + String(index + 1).padStart(2, '0');
              window.clickedRangeOptions.push(value);
              const start = document.getElementById('range-start');
              const end = document.getElementById('range-end');
              const target = phase === 0 ? start : end;
              target.value = value;
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              phase = phase === 0 ? 1 : 0;
              if (start.value && end.value) {
                window.validationCommitCount += 1;
                document.getElementById('formily-item').classList.remove('ud-formily-item-error');
                document.querySelector('.throne-biz-date-range-picker-wrapper').classList.remove('throne-biz-date-range-picker-error');
                document.getElementById('range-extra').textContent = '';
              }
              event.stopPropagation();
            });
          });
        }

        function openPicker() {
          renderPicker();
          const start = document.getElementById('range-start');
          const end = document.getElementById('range-end');
          if (start.value && end.value) {
            window.validationCommitCount += 1;
            document.getElementById('formily-item').classList.remove('ud-formily-item-error');
            document.querySelector('.throne-biz-date-range-picker-wrapper').classList.remove('throne-biz-date-range-picker-error');
            document.getElementById('range-extra').textContent = '';
          }
        }
        document.getElementById('range-start').addEventListener('click', openPicker);
        document.getElementById('range-end').addEventListener('click', openPicker);
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan()
        .filter(field => field.label === '起止时间')
        .sort((a, b) => a.groupIndex - b.groupIndex);
      FillEngine.reset();
      const fill = await FillEngine.fillAll({
        [fields[0].fieldId]: '2025-09',
        [fields[1].fieldId]: '2027-06',
      }, fields);
      return {
        fill,
        startValue: document.getElementById('range-start').value,
        endValue: document.getElementById('range-end').value,
        clickedRangeOptions: window.clickedRangeOptions,
        clickedYearNav: window.clickedYearNav,
        validationCommitCount: window.validationCommitCount,
        validationText: document.getElementById('range-extra').textContent,
        hasRangeError: document.querySelector('.throne-biz-date-range-picker-wrapper')
          .classList.contains('throne-biz-date-range-picker-error'),
      };
    });

    assert.equal(result.fill.filled, 2);
    assert.equal(result.fill.skipped.length, 0);
    assert.equal(result.startValue, '2025-09');
    assert.equal(result.endValue, '2027-06');
    assert.deepEqual(result.clickedRangeOptions, ['2025-09', '2027-06']);
    assert.deepEqual(result.clickedYearNav, [2025, 2026, 2027]);
    assert.equal(result.validationCommitCount > 0, true);
    assert.equal(result.validationText, '');
    assert.equal(result.hasRangeError, false);
  } finally {
    await browser.close();
  }
});

test('date handler does not leave a previous range picker active between groups', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <div class="card" data-index="0">
        <label>起止时间</label>
        <div class="throne-biz-date-range-picker-wrapper">
          <input id="a-start" readonly><span>~</span><input id="a-end" readonly>
        </div>
      </div>
      <div class="card" data-index="1">
        <label>起止时间</label>
        <div class="throne-biz-date-range-picker-wrapper">
          <input id="b-start" readonly><span>~</span><input id="b-end" readonly>
        </div>
      </div>
      <script>
        let pickerOpen = false;
        let activeWrapper = null;
        let activePhase = 0;
        function inputIndex(input) {
          return [...input.closest('.throne-biz-date-range-picker-wrapper').querySelectorAll('input')].indexOf(input);
        }
        function renderPicker() {
          let dropdown = document.querySelector('.ud__dropdown');
          if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.className = 'ud__dropdown';
            document.body.appendChild(dropdown);
          }
          dropdown.innerHTML = ['2024-01', '2024-02', '2025-01', '2025-02'].map(value =>
            '<button type="button" data-value="' + value + '">' + value + '</button>'
          ).join('');
          dropdown.querySelectorAll('[data-value]').forEach(button => {
            button.addEventListener('click', event => {
              const inputs = activeWrapper.querySelectorAll('input');
              inputs[activePhase].value = button.getAttribute('data-value');
              inputs[activePhase].dispatchEvent(new Event('input', { bubbles: true }));
              inputs[activePhase].dispatchEvent(new Event('change', { bubbles: true }));
              if (activePhase === 0) {
                activePhase = 1;
              } else {
                pickerOpen = false;
                dropdown.remove();
              }
              event.stopPropagation();
            });
          });
        }
        function openPicker(event) {
          if (pickerOpen && activeWrapper && activePhase === 1) {
            renderPicker();
            event.stopPropagation();
            return;
          }
          activeWrapper = event.target.closest('.throne-biz-date-range-picker-wrapper');
          activePhase = inputIndex(event.target) === 1 ? 1 : 0;
          pickerOpen = true;
          renderPicker();
          event.stopPropagation();
        }
        document.querySelectorAll('.throne-biz-date-range-picker-wrapper input')
          .forEach(input => input.addEventListener('click', openPicker));
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan()
        .filter(field => field.label === '起止时间')
        .sort((a, b) => a.groupId === b.groupId
          ? a.groupIndex - b.groupIndex
          : String(a.groupId).localeCompare(String(b.groupId)));
      FillEngine.reset();
      const fill = await FillEngine.fillAll({
        [fields[0].fieldId]: '2024-01',
        [fields[1].fieldId]: '2024-02',
        [fields[2].fieldId]: '2025-01',
        [fields[3].fieldId]: '2025-02',
      }, fields);
      return {
        fill,
        a: [document.getElementById('a-start').value, document.getElementById('a-end').value],
        b: [document.getElementById('b-start').value, document.getElementById('b-end').value],
      };
    });

    assert.equal(result.fill.filled, 4);
    assert.equal(result.fill.skipped.length, 0);
    assert.deepEqual(result.a, ['2024-01', '2024-02']);
    assert.deepEqual(result.b, ['2025-01', '2025-02']);
  } finally {
    await browser.close();
  }
});

test('fill engine clicks both range fields and blank area on Xiaopeng pages to clear validation', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const url = 'https://xiaopeng.jobs.feishu.cn/campus/apply';
    await page.route(url, route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `
      <div id="range-a" class="throne-biz-date-range-picker-wrapper throne-biz-date-range-picker-error">
        <input id="a-start"><span>~</span><input id="a-end">
      </div>
      <div id="range-b" class="throne-biz-date-range-picker-wrapper throne-biz-date-range-picker-error">
        <input id="b-start"><span>~</span><input id="b-end">
      </div>
      <script>
        window.validationClicks = [];
        window.blankClicks = 0;
        window.touchedRanges = new Set();
        window.validationPhase = false;
        for (const id of ['a-start', 'a-end', 'b-start', 'b-end']) {
          document.getElementById(id).addEventListener('click', event => {
            const wrapper = event.target.closest('.throne-biz-date-range-picker-wrapper');
            window.validationPhase = true;
            window.validationClicks.push(id);
            window.touchedRanges.add(wrapper.id);
          });
        }
        document.body.addEventListener('click', event => {
          if (event.target.closest && event.target.closest('.throne-biz-date-range-picker-wrapper')) return;
          if (!window.validationPhase) return;
          window.blankClicks += 1;
          for (const id of window.touchedRanges) {
            const wrapper = document.getElementById(id);
            const inputs = wrapper.querySelectorAll('input');
            if (inputs[0].value && inputs[1].value) {
              wrapper.classList.remove('throne-biz-date-range-picker-error');
            }
          }
        });
      </script>
      `,
    }));
    await page.goto(url);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = [
        { fieldId: 'a-start', label: '起止时间', type: 'date', groupIndex: 0, groupSize: 2, repeatSection: '项目经历', repeatIndex: 0 },
        { fieldId: 'a-end', label: '起止时间', type: 'date', groupIndex: 1, groupSize: 2, repeatSection: '项目经历', repeatIndex: 0 },
        { fieldId: 'b-start', label: '起止时间', type: 'date', groupIndex: 0, groupSize: 2, repeatSection: '项目经历', repeatIndex: 1 },
        { fieldId: 'b-end', label: '起止时间', type: 'date', groupIndex: 1, groupSize: 2, repeatSection: '项目经历', repeatIndex: 1 },
      ];
      FillEngine.reset();
      const fill = await FillEngine.fillAll({
        'a-start': '2024-10',
        'a-end': '2025-05',
        'b-start': '2025-09',
        'b-end': '2025-12',
      }, fields);
      return {
        fill,
        validationClicks: window.validationClicks,
        a: [document.getElementById('a-start').value, document.getElementById('a-end').value],
        b: [document.getElementById('b-start').value, document.getElementById('b-end').value],
        aError: document.getElementById('range-a').classList.contains('throne-biz-date-range-picker-error'),
        bError: document.getElementById('range-b').classList.contains('throne-biz-date-range-picker-error'),
        blankClicks: window.blankClicks,
        validationRecords: fill.fillRecords
          .filter(record => record.kind === 'date_group_validation')
          .map(record => ({
            status: record.status,
            clickedFieldId: record.clickedFieldId,
            clickedFieldIds: record.clickedFieldIds,
            blankClickCount: record.blankClickCount,
            afterValues: record.afterValues,
          })),
      };
    });

    assert.equal(result.fill.filled, 4);
    assert.equal(result.fill.skipped.length, 0);
    assert.deepEqual(result.validationClicks, ['a-start', 'a-end', 'b-start', 'b-end']);
    assert.equal(result.blankClicks, 4);
    assert.deepEqual(result.a, ['2024-10', '2025-05']);
    assert.deepEqual(result.b, ['2025-09', '2025-12']);
    assert.equal(result.aError, false);
    assert.equal(result.bError, false);
    assert.deepEqual(result.validationRecords, [
      {
        status: 'validated',
        clickedFieldId: 'a-start,a-end',
        clickedFieldIds: ['a-start', 'a-end'],
        blankClickCount: 2,
        afterValues: ['2024-10', '2025-05'],
      },
      {
        status: 'validated',
        clickedFieldId: 'b-start,b-end',
        clickedFieldIds: ['b-start', 'b-end'],
        blankClickCount: 2,
        afterValues: ['2025-09', '2025-12'],
      },
    ]);
  } finally {
    await browser.close();
  }
});

test('fill engine does not run Xiaopeng-only date validation clicks on other hosts', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const url = 'https://example.com/apply';
    await page.route(url, route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `
      <div id="range-a" class="throne-biz-date-range-picker-wrapper throne-biz-date-range-picker-error">
        <input id="a-start"><span>~</span><input id="a-end">
      </div>
      <script>
        window.validationClicks = [];
        window.blankClicks = 0;
        window.validationPhase = false;
        for (const id of ['a-start', 'a-end']) {
          document.getElementById(id).addEventListener('click', event => {
            window.validationPhase = true;
            window.validationClicks.push(id);
          });
        }
        document.body.addEventListener('click', event => {
          if (event.target.closest && event.target.closest('.throne-biz-date-range-picker-wrapper')) return;
          if (!window.validationPhase) return;
          window.blankClicks += 1;
        });
      </script>
      `,
    }));
    await page.goto(url);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = [
        { fieldId: 'a-start', label: '起止时间', type: 'date', groupIndex: 0, groupSize: 2 },
        { fieldId: 'a-end', label: '起止时间', type: 'date', groupIndex: 1, groupSize: 2 },
      ];
      FillEngine.reset();
      const fill = await FillEngine.fillAll({
        'a-start': '2024-10',
        'a-end': '2025-05',
      }, fields);
      return {
        fill,
        validationClicks: window.validationClicks,
        blankClicks: window.blankClicks,
        values: [document.getElementById('a-start').value, document.getElementById('a-end').value],
        validationRecords: fill.fillRecords.filter(record => record.kind === 'date_group_validation'),
      };
    });

    assert.equal(result.fill.filled, 2);
    assert.equal(result.fill.skipped.length, 0);
    assert.deepEqual(result.values, ['2024-10', '2025-05']);
    assert.deepEqual(result.validationClicks, []);
    assert.equal(result.blankClicks, 0);
    assert.deepEqual(result.validationRecords, []);
  } finally {
    await browser.close();
  }
});

test('scanner recognizes nested Feishu date-range inputs as one labeled group', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <section>
        <h2>项目经历</h2>
        <div class="apply-form-array-card__1d6856">
          <div class="ud-formily-item ud-formily-item-layout-vertical ud-formily-item-error ud-formily-item-size-large">
            <div class="ud-formily-item-label"><label>起止时间*</label></div>
            <div class="ud-formily-item-control">
              <div class="ud-formily-item-control-content">
                <div class="ud-formily-item-control-content-component">
                  <div class="throne-biz-date-range-picker-wrapper throne-biz-date-range-picker-error">
                    <div class="throne-biz-date-range-picker-input ud__dropdown-open">
                      <div class="ud__input ud__input--focused ud__input--size-lg">
                        <label class="ud__input-input-wrap">
                          <div class="ud__input-input__placeholder__wrapper">
                            <input class="ud__native-input">
                          </div>
                        </label>
                      </div>
                    </div>
                    <div class="throne-biz-date-range-picker-rangeInput-seperator">~</div>
                    <div class="throne-biz-date-range-picker-input throne-biz-date-range-picker-hasValue">
                      <div class="ud__input ud__input--size-lg">
                        <label class="ud__input-input-wrap">
                          <div class="ud__input-input__placeholder__wrapper">
                            <input class="ud__native-input" value="2023-08">
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="ud-formily-item-extra">请填写完整时间</div>
            </div>
          </div>
        </div>
      </section>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(() => {
      const fields = FieldScanner.scan();
      return fields
        .filter(field => field.label === '起止时间')
        .map(field => ({
          label: field.label,
          type: field.type,
          widget: field.widget,
          groupIndex: field.groupIndex,
          groupSize: field.groupSize,
          currentValue: field.currentValue || '',
          section: field.section,
        }));
    });

    assert.deepEqual(result, [
      {
        label: '起止时间',
        type: 'date',
        widget: 'date-range',
        groupIndex: 0,
        groupSize: 2,
        currentValue: '',
        section: '项目经历',
      },
      {
        label: '起止时间',
        type: 'date',
        widget: 'date-range',
        groupIndex: 1,
        groupSize: 2,
        currentValue: '2023-08',
        section: '项目经历',
      },
    ]);
  } finally {
    await browser.close();
  }
});

test('fill engine retries grouped date range when one endpoint already matches', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <div class="ud-formily-item ud-formily-item-layout-vertical">
        <div class="ud-formily-item-label"><label>起止时间*</label></div>
        <div class="ud-formily-item-control-content-component">
          <div class="throne-biz-date-range-picker-wrapper">
            <div class="throne-biz-date-range-picker-input">
              <div class="ud__input"><label class="ud__input-input-wrap"><input id="range-start" class="ud__native-input" readonly></label></div>
            </div>
            <div class="throne-biz-date-range-picker-seperator">~</div>
            <div class="throne-biz-date-range-picker-input throne-biz-date-range-picker-hasValue">
              <div class="ud__input"><label class="ud__input-input-wrap"><input id="range-end" class="ud__native-input" readonly value="2023-08"></label></div>
            </div>
          </div>
        </div>
      </div>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan()
        .filter(field => field.label === '起止时间')
        .sort((a, b) => a.groupIndex - b.groupIndex);
      FillEngine.reset();
      const fill = await FillEngine.fillAll({
        [fields[0].fieldId]: '2023-01',
        [fields[1].fieldId]: '2023-08',
      }, fields);
      return {
        fill,
        startValue: document.getElementById('range-start').value,
        endValue: document.getElementById('range-end').value,
      };
    });

    assert.equal(result.fill.filled, 2);
    assert.equal(result.fill.skipped.length, 0);
    assert.equal(result.startValue, '2023-01');
    assert.equal(result.endValue, '2023-08');
  } finally {
    await browser.close();
  }
});

test('text handler fills plaintext-only rich text editors with commit events', async t => {
  const playwright = loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed in this environment');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const message = err && err.message ? err.message.split('\n')[0] : String(err);
    t.skip(`Chromium could not launch: ${message}`);
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`
      <section>
        <h2>项目经历</h2>
        <div class="atsx-form-item">
          <label>项目描述</label>
          <div id="project-editor" class="ProseMirror ql-editor" role="textbox" contenteditable="plaintext-only"><p><br></p></div>
        </div>
      </section>
      <script>
        window.editorEvents = [];
        const editor = document.getElementById('project-editor');
        ['beforeinput', 'input', 'change', 'keyup'].forEach(type => {
          editor.addEventListener(type, () => window.editorEvents.push(type));
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const fields = FieldScanner.scan();
      const description = fields.find(field => field.label === '项目描述');
      FillEngine.reset();
      const fill = await FillEngine.fillAll({ [description.fieldId]: '负责自动填写核心链路开发' }, fields);
      const editor = document.getElementById('project-editor');
      return {
        fill,
        field: {
          type: description.type,
          widget: description.widget,
          section: description.section,
        },
        editorText: editor.textContent.replace(/\\s+/g, ' ').trim(),
        editorHtml: editor.innerHTML,
        events: window.editorEvents,
      };
    });

    assert.equal(result.fill.filled, 1);
    assert.deepEqual(result.field, {
      type: 'text',
      widget: 'contenteditable',
      section: '项目经历',
    });
    assert.equal(result.editorText, '负责自动填写核心链路开发');
    assert.match(result.editorHtml, /负责自动填写核心链路开发/);
    assert.equal(result.events.includes('input'), true);
    assert.equal(result.events.includes('change'), true);
  } finally {
    await browser.close();
  }
});
