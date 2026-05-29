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
        result: '覆盖多 ATS 页面',
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

      return {
        type: 'MATCH_RESULT',
        data: {
          plan_id: `mock-plan-${window.__mockMatchRequests.length}`,
          filled: {},
          mappings,
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

test('local ATS smoke fills dynamic projects and stops before final submit', async t => {
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
    await page.goto(pathToFileURL(path.join(extensionRoot, 'test-form.html')).href);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      const byLabel = (fields, label) => fields.find(field => field.label === label);
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
          result: '覆盖多 ATS 页面',
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

      FillEngine.reset();
      window.showPage1();
      let fields = FieldScanner.scan();
      let mappings = {
        [byLabel(fields, '推荐方式').fieldId]: '内推',
        [byLabel(fields, '姓名').fieldId]: '张三',
        [byLabel(fields, '邮箱').fieldId]: 'zhangsan@example.com',
        [byLabel(fields, '手机号').fieldId]: '13800138000',
        [byLabel(fields, '出生日期').fieldId]: '1998-05-01',
      };
      const page1 = await FillEngine.fillAll(mappings, fields);

      FillEngine.reset();
      window.showPage2();
      fields = FieldScanner.scan();
      mappings = {
        [byLabel(fields, '学校').fieldId]: '上海交通大学',
        [byLabel(fields, '学历').fieldId]: '硕士',
        [byLabel(fields, '专业').fieldId]: '计算机科学',
      };
      const page2 = await FillEngine.fillAll(mappings, fields);

      FillEngine.reset();
      window.showPage3();
      SectionManager.reset();
      const projectActionResults = await SectionManager.executeActions({ '项目经历': 'add_2' });
      await new Promise(resolve => setTimeout(resolve, 100));
      const projectSections = SectionManager.collectSectionInfo();
      fields = FieldScanner.scan();
      mappings = {};
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
      const page3 = await FillEngine.fillAll(mappings, fields);
      const repeatIndexes = [...new Set(fields.map(field => field.repeatIndex).filter(Number.isInteger))]
        .sort((a, b) => a - b);

      FillEngine.reset();
      window.showPage4();
      fields = FieldScanner.scan();
      mappings = {};
      for (const field of fields) {
        if (field.label === 'Python' || field.label === 'JavaScript') mappings[field.fieldId] = field.label;
        if (field.label === '自我评价') mappings[field.fieldId] = '具备完整产品化落地经验';
        if (field.label === '附件简历') mappings[field.fieldId] = '/tmp/resume.pdf';
      }
      const page4 = await FillEngine.fillAll(mappings, fields);

      return {
        page1,
        page2,
        page3,
        page4,
        referralChecked: [...document.querySelectorAll('#referral-method .radio-item')]
          .find(item => item.textContent.trim() === '内推')
          ?.getAttribute('aria-checked'),
        name: document.getElementById('name').value,
        degree: document.querySelector('#degree input').value,
        projectActionResults,
        projectSections,
        projectCards: [...document.querySelectorAll('#project-list .project-card')].map(card => {
          const inputs = [...card.querySelectorAll('input')];
          return {
            name: inputs[0].value,
            role: inputs[1].value,
            start: inputs[2].value,
            end: inputs[3].value,
            stack: inputs[4].value,
            result: card.querySelector('textarea').value,
          };
        }),
        repeatIndexes,
        checkedSkills: [...document.querySelectorAll('input[name=skill]:checked')].map(input => input.value),
        isSubmitOnly: NavigationDetector.isSubmitOnly(),
        hasNextButton: !!NavigationDetector.findNextButton(),
        submitState: document.getElementById('submit-state').textContent,
      };
    });

    assert.equal(result.page1.filled, 5);
    assert.equal(result.referralChecked, 'true');
    assert.equal(result.name, '张三');
    assert.equal(result.page2.filled, 3);
    assert.equal(result.degree, '硕士');
    assert.deepEqual(result.projectActionResults, [{
      sectionName: '项目经历',
      action: 'add_2',
      requested: 2,
      attempted: 2,
      added: 2,
      beforeCount: 1,
      afterCount: 3,
      clearedEmptyToggle: false,
      status: 'completed',
    }]);
    assert.deepEqual(result.projectSections, [{ name: '项目经历', currentCount: 3, addButton: true }]);
    assert.equal(result.page3.filled, 18);
    assert.deepEqual(result.repeatIndexes, [0, 1, 2]);
    assert.deepEqual(result.projectCards.map(project => project.name), ['项目一', '项目二', '项目三']);
    assert.deepEqual(result.checkedSkills, ['Python', 'JavaScript']);
    assert.equal(result.page4.filled, 3);
    assert.equal(result.page4.skipped.length, 1);
    assert.equal(result.page4.skipped[0].reason, '文件上传需人工处理');
    assert.equal(result.page4.skipped[0].label, '附件简历');
    assert.equal(result.page4.skipped[0].type, 'file');
    assert.equal(result.page4.skipped[0].attemptedValuePreview, '[文件路径已隐藏]');
    assert.equal(result.isSubmitOnly, true);
    assert.equal(result.hasNextButton, false);
    assert.equal(result.submitState, '');
  } finally {
    await browser.close();
  }
});

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

test('scanner handles Tencent-style Element UI resume form labels and add buttons', async t => {
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
        <section class="resume-module basic-module">
          <h2>基础信息</h2>
          <div class="el-form-item is-required">
            <label class="el-form-item__label">姓名*</label>
            <div class="el-form-item__content"><div class="el-input"><input class="el-input__inner" placeholder="请输入姓名"></div></div>
          </div>
          <div class="el-form-item is-required">
            <label class="el-form-item__label">性别*</label>
            <div class="el-form-item__content">
              <label class="el-radio" role="radio"><span class="el-radio__label">男</span><input class="el-radio__original" type="radio" name="gender" value="男"></label>
              <label class="el-radio" role="radio"><span class="el-radio__label">女</span><input class="el-radio__original" type="radio" name="gender" value="女"></label>
            </div>
          </div>
          <div class="el-form-item is-required">
            <label class="el-form-item__label">证件信息</label>
            <div class="el-form-item__content">
              <span class="el-dropdown-link" role="button" aria-haspopup="list">请选择</span>
              <div class="el-input"><input class="el-input__inner" placeholder="请填写您的证件号码"></div>
            </div>
          </div>
          <div class="el-form-item is-required">
            <label class="el-form-item__label">期望工作城市*</label>
            <div class="el-select"><input class="el-input__inner" placeholder="请选择期望工作城市（至多三个）"></div>
          </div>
        </section>

        <section class="resume-module project-module">
          <h2>项目经历</h2>
          <div id="project-list">
            <div class="project-experience-card">
              <div class="el-form-item">
                <label class="el-form-item__label">项目名称</label>
                <div class="el-form-item__content"><input class="el-input__inner" placeholder="请输入项目名称（含校园实践）"></div>
              </div>
              <div class="el-form-item">
                <label class="el-form-item__label">项目角色</label>
                <div class="el-form-item__content"><input class="el-input__inner" placeholder="请输入在项目中担任的角色"></div>
              </div>
              <div class="el-form-item">
                <label class="el-form-item__label">项目时间</label>
                <div class="el-form-item__content">
                  <input class="el-input__inner" placeholder="选择日期">
                  <input class="el-input__inner" placeholder="选择日期">
                </div>
              </div>
              <div class="el-form-item">
                <label class="el-form-item__label">项目描述</label>
                <textarea class="el-textarea__inner" placeholder="请输入描述内容"></textarea>
              </div>
            </div>
          </div>
          <button id="add_btn" class="el-button el-button--text" type="button">添加项目经历</button>
        </section>

        <section class="resume-module internship-module">
          <h2>实习经历</h2>
          <div class="internship-experience-card">
            <div class="el-form-item"><label class="el-form-item__label">实习公司</label><input class="el-input__inner" placeholder="请输入实习公司"></div>
            <div class="el-form-item"><label class="el-form-item__label">职位</label><input class="el-input__inner" placeholder="请输入职位"></div>
          </div>
          <button id="add_btn" class="el-button el-button--text" type="button">添加实习经历</button>
        </section>
      </main>
      <script>
        document.querySelectorAll('button').forEach(button => {
          button.addEventListener('click', () => {
            if (!button.textContent.includes('项目')) return;
            const item = document.querySelector('.project-experience-card').cloneNode(true);
            item.querySelectorAll('input, textarea').forEach(el => { el.value = ''; });
            document.getElementById('project-list').appendChild(item);
          });
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      FieldScanner._resetMap();
      const fields = FieldScanner.scan();
      SectionManager.reset();
      const before = SectionManager.collectSectionInfo();
      const actionResults = await SectionManager.executeActions({ '项目经历': 'add_1' });
      await new Promise(resolve => setTimeout(resolve, 100));
      const afterFields = FieldScanner.scan();
      const after = SectionManager.collectSectionInfo();

      const byLabel = label => fields.find(field => field.label === label);
      return {
        labels: fields.map(field => field.label).filter(Boolean),
        name: byLabel('姓名'),
        gender: byLabel('性别'),
        idFields: fields.filter(field => field.label === '证件信息').map(field => ({
          label: field.label,
          subLabel: field.subLabel,
          groupIndex: field.groupIndex,
          widget: field.widget,
          type: field.type,
        })),
        city: byLabel('期望工作城市'),
        projectFields: afterFields.filter(field => field.repeatSection === '项目经历').map(field => ({
          label: field.label,
          widget: field.widget,
          repeatIndex: field.repeatIndex,
          repeatSize: field.repeatSize,
          groupIndex: field.groupIndex,
        })),
        before,
        after,
        actionResults,
        projectCardCount: document.querySelectorAll('.project-experience-card').length,
      };
    });

    assert.equal(result.name.type, 'text');
    assert.equal(result.name.required, true);
    assert.equal(result.gender.widget, 'pseudo-radio');
    assert.deepEqual(result.gender.options, ['男', '女']);
    assert.equal(result.idFields.length, 2);
    assert.deepEqual(result.idFields.map(field => field.groupIndex), [0, 1]);
    assert.equal(result.idFields[0].widget, 'aria-combobox');
    assert.equal(result.idFields[1].subLabel, '证件号码');
    assert.equal(result.city.label, '期望工作城市');
    assert.equal(result.city.widget, 'search-select');
    assert.deepEqual(result.before.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 1,
      addButton: true,
    });
    assert.deepEqual(result.after.find(section => section.name === '项目经历'), {
      name: '项目经历',
      currentCount: 2,
      addButton: true,
    });
    assert.equal(result.projectCardCount, 2);
    assert.deepEqual(result.actionResults.map(item => ({
      sectionName: item.sectionName,
      requested: item.requested,
      attempted: item.attempted,
      added: item.added,
      status: item.status,
    })), [
      { sectionName: '项目经历', requested: 1, attempted: 1, added: 1, status: 'completed' },
    ]);
    assert.deepEqual(
      [...new Set(result.projectFields.map(field => field.repeatIndex))].sort((a, b) => a - b),
      [0, 1],
    );
    assert.equal(result.projectFields.every(field => field.repeatSize === 2), true);
    assert.equal(result.projectFields.some(field => field.label === '项目时间' && field.groupIndex === 1), true);
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
        <option selected>上海</option>
        <option selected>深圳</option>
        <option>北京</option>
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

test('section manager handles live Tencent-style send_title resume modules', async t => {
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
      <ul class="send_list">
        <li class="send_box">
          <div class="send_title">项目经历</div>
          <div class="send_content">
            <div id="project-experience" class="experience_box">
              <div class="info_list">
                <div class="experience_title project_scorll_0">项目经历-1 <button type="button" class="el-button el-button--text">删除经历</button></div>
                <div class="info_box"><div class="subtitle must">项目名称*</div><div class="input_box"><div class="el-input"><input class="el-input__inner" placeholder="请输入项目名称（含校园实践）"></div></div></div>
                <div class="info_box"><div class="subtitle must">在项目中担任的角色*</div><div class="input_box"><div class="el-input"><input class="el-input__inner" placeholder="请输入在项目中担任的角色"></div></div></div>
                <div class="info_box">
                  <div class="subtitle must">起止时间*</div>
                  <div class="input_box"><input class="el-input__inner" placeholder="选择日期"><input class="el-input__inner" placeholder="选择日期"></div>
                </div>
                <div class="info_box"><div class="subtitle">描述*</div><textarea class="el-textarea__inner" placeholder="请输入描述内容"></textarea></div>
              </div>
              <div class="info_box"><button id="add-project" class="el-button el-button--text" type="button">添加项目经历</button></div>
            </div>
          </div>
        </li>
      </ul>
      <button id="final-submit" class="el-button el-button--primary" type="button">提交简历</button>
      <script>
        document.getElementById('add-project').addEventListener('click', () => {
          const list = document.querySelector('#project-experience');
          const item = list.querySelector('.info_list').cloneNode(true);
          const next = list.querySelectorAll('.info_list').length + 1;
          item.querySelector('.experience_title').textContent = '项目经历-' + next + ' 删除经历';
          item.querySelectorAll('input, textarea').forEach(el => { el.value = ''; });
          list.insertBefore(item, document.getElementById('add-project').closest('.info_box'));
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      FieldScanner._resetMap();
      SectionManager.reset();
      const before = SectionManager.collectSectionInfo();
      const actionResults = await SectionManager.executeActions({ '项目经历': 'add_2' });
      await new Promise(resolve => setTimeout(resolve, 100));
      const after = SectionManager.collectSectionInfo();
      const fields = FieldScanner.scan();
      const projectFields = fields.filter(field => field.repeatSection === '项目经历');
      const projectName = fields.find(field => field.label === '项目名称');
      const projectDates = fields.filter(field => field.label === '起止时间');
      return {
        before,
        after,
        actionResults,
        projectCardCount: document.querySelectorAll('#project-experience .info_list').length,
        projectName,
        projectDates: projectDates.map(field => ({
          label: field.label,
          type: field.type,
          widget: field.widget,
          required: field.required,
          groupIndex: field.groupIndex,
          repeatIndex: field.repeatIndex,
          repeatSize: field.repeatSize,
          repeatSection: field.repeatSection,
          section: field.section,
        })),
        repeatIndexes: [...new Set(projectFields.map(field => field.repeatIndex).filter(Number.isInteger))]
          .sort((a, b) => a - b),
        submitOnly: NavigationDetector.isSubmitOnly(),
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
    assert.equal(result.projectCardCount, 3);
    assert.equal(result.projectName.section, '项目经历');
    assert.equal(result.projectName.required, true);
    assert.deepEqual(result.repeatIndexes, [0, 1, 2]);
    assert.equal(result.projectDates.length, 6);
    assert.equal(result.projectDates.every(field => field.widget === 'date-picker'), true);
    assert.equal(result.projectDates.every(field => field.repeatSize === 3), true);
    assert.equal(result.projectDates.some(field => field.groupIndex === 1), true);
    assert.equal(result.submitOnly, true);
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
      <section class="beisen-section">
        <h2>项目经历</h2>
        <label id="no-project-wrap" class="beisen-checkbox is-checked">
          <input id="no-project" type="checkbox" checked>
          无项目经历
        </label>
        <div id="project-list" style="display:none">
          <div class="beisen-resume-item project-card">
            <label>项目名称<input type="text"></label>
            <label>项目成果<textarea></textarea></label>
          </div>
        </div>
        <button id="add-project" class="beisen-add" type="button" style="display:none">添加项目经历</button>
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
      <section class="moka-form-section">
        <h2>项目经历</h2>
        <label id="no-project-wrap" class="moka-checkbox checked">
          <input id="no-project" type="checkbox" checked>
          无项目经历
        </label>
        <div id="project-list"></div>
        <button id="add-project" class="moka-add-btn" type="button" style="display:none">添加项目经历</button>
      </section>
      <script>
        const noProject = document.getElementById('no-project');
        noProject.addEventListener('change', () => {
          document.getElementById('no-project-wrap').classList.toggle('checked', noProject.checked);
          document.getElementById('add-project').style.display = noProject.checked ? 'none' : 'inline-block';
        });
        document.getElementById('add-project').addEventListener('click', () => {
          const item = document.createElement('div');
          item.className = 'moka-experience-card project-card';
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

test('content trigger runs direct autofill across pages with dynamic expansion', async t => {
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
    await page.goto(pathToFileURL(path.join(extensionRoot, 'test-form.html')).href);
    await installMockChromeRuntime(page);
    await injectContentRuntimeScripts(page);

    await page.evaluate(() => window.__resumeAutofillStart('resume-1'));
    await page.waitForFunction(
      () => window.__autofillComplete || window.__autofillError,
      { timeout: 20000 },
    );

    const result = await page.evaluate(() => {
      const complete = window.__autofillComplete;
      const error = window.__autofillError;
      const report = complete && complete.report;
      return {
        error,
        summary: complete && complete.summary,
        report,
        storedReport: window.__mockStored.resumeAutofillLastReport,
        matchRequests: window.__mockMatchRequests,
        projectCards: [...document.querySelectorAll('#project-list .project-card')].map(card => {
          const inputs = [...card.querySelectorAll('input')];
          return {
            name: inputs[0].value,
            role: inputs[1].value,
            start: inputs[2].value,
            end: inputs[3].value,
            stack: inputs[4].value,
            result: card.querySelector('textarea').value,
          };
        }),
        referralChecked: [...document.querySelectorAll('#referral-method .radio-item')]
          .find(item => item.textContent.trim() === '内推')
          ?.getAttribute('aria-checked'),
        name: document.getElementById('name').value,
        degree: document.querySelector('#degree input').value,
        checkedSkills: [...document.querySelectorAll('input[name=skill]:checked')].map(input => input.value),
        selfIntro: document.getElementById('self-intro').value,
        submitState: document.getElementById('submit-state').textContent,
        overlayText: document.getElementById('resume-autofill-result')?.textContent || '',
      };
    });

    assert.equal(result.error, null);
    assert.equal(result.name, '张三');
    assert.equal(result.referralChecked, 'true');
    assert.equal(result.degree, '硕士');
    assert.deepEqual(result.projectCards.map(project => project.name), ['项目一', '项目二', '项目三']);
    assert.deepEqual(result.checkedSkills, ['Python', 'JavaScript']);
    assert.equal(result.selfIntro, '具备完整产品化落地经验');
    assert.equal(result.submitState, '');
    assert.match(result.summary, /已填: 29 个字段, 跳过: 1 个字段/);
    assert.match(result.overlayText, /自动填写完成/);
    assert.equal(result.report.totalFilled, 29);
    assert.equal(result.report.totalSkipped, 1);
    assert.equal(result.report.skipped[0].label, '附件简历');
    assert.equal(result.report.skipped[0].type, 'file');
    assert.equal(result.report.skipped[0].attemptedValuePreview, '[文件路径已隐藏]');
    assert.equal(result.report.pages.length, 4);
    assert.equal(result.report.pages[2].sectionActions['项目经历'], 'add_2');
    assert.deepEqual(result.report.pages[2].sectionActionResults.map(item => ({
      sectionName: item.sectionName,
      requested: item.requested,
      attempted: item.attempted,
      added: item.added,
      status: item.status,
    })), [
      { sectionName: '项目经历', requested: 2, attempted: 2, added: 2, status: 'completed' },
    ]);
    assert.equal(result.report.pages[2].expandedFieldCount, 18);
    assert.equal(result.report.pages[3].stopReason, 'submit_only');
    assert.deepEqual(result.storedReport, result.report);
    assert.equal(result.matchRequests.length, 5);
    assert.equal(result.matchRequests.every(req => req.payload && req.payload.url.endsWith('/test-form.html')), true);
    assert.equal(result.matchRequests.every(req => req.payload.fieldCount === req.fieldCount), true);
    assert.equal(result.matchRequests.every(req => req.payload.frames[0].url === req.payload.url), true);
    assert.equal(result.matchRequests.every(req => req.payload.frames[0].fieldCount === req.fieldCount), true);
    assert.deepEqual(result.matchRequests[2].sections, [
      { name: '项目经历', currentCount: 1, addButton: true },
    ]);
    assert.deepEqual(result.matchRequests[3].sections, [
      { name: '项目经历', currentCount: 3, addButton: true },
    ]);
  } finally {
    await browser.close();
  }
});
