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
      await SectionManager.executeActions({ '项目经历': 'add_2' });
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
    assert.deepEqual(result.projectSections, [{ name: '项目经历', currentCount: 3, addButton: true }]);
    assert.equal(result.page3.filled, 18);
    assert.deepEqual(result.repeatIndexes, [0, 1, 2]);
    assert.deepEqual(result.projectCards.map(project => project.name), ['项目一', '项目二', '项目三']);
    assert.deepEqual(result.checkedSkills, ['Python', 'JavaScript']);
    assert.equal(result.page4.filled, 3);
    assert.equal(result.page4.skipped.length, 1);
    assert.equal(result.page4.skipped[0].reason, '文件上传需人工处理');
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
      <script>
        document.getElementById('add-project').addEventListener('click', () => {
          const item = document.querySelector('[data-field-list-item]').cloneNode(true);
          item.querySelectorAll('input, textarea').forEach(el => { el.value = ''; });
          document.getElementById('items').appendChild(item);
        });
      </script>
    `);
    await injectExtensionScripts(page);

    const result = await page.evaluate(async () => {
      SectionManager.reset();
      const before = SectionManager.collectSectionInfo();
      await SectionManager.executeActions({ '项目经历': 'add_2' });
      await new Promise(resolve => setTimeout(resolve, 100));
      const after = SectionManager.collectSectionInfo();
      return {
        before,
        after,
        itemCount: document.querySelectorAll('[data-field-list-item]').length,
      };
    });

    assert.deepEqual(result.before, [{ name: '项目经历', currentCount: 1, addButton: true }]);
    assert.deepEqual(result.after, [{ name: '项目经历', currentCount: 3, addButton: true }]);
    assert.equal(result.itemCount, 3);
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
    assert.equal(result.report.pages.length, 4);
    assert.equal(result.report.pages[2].sectionActions['项目经历'], 'add_2');
    assert.equal(result.report.pages[2].expandedFieldCount, 18);
    assert.equal(result.report.pages[3].stopReason, 'submit_only');
    assert.deepEqual(result.storedReport, result.report);
    assert.equal(result.matchRequests.length, 5);
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
