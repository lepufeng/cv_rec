var SectionManager = {
  MAX_EXPANSIONS: 20,
  MAX_DEPTH: 3,
  EXPAND_TIMEOUT: 3000,

  expansionCount: 0,
  depth: 0,

  HEADING_SELECTOR:
    'h2, h3, h4, fieldset legend, [class*="section-title"], [class*="sectionTitle"], [class*="step-title"], [class*="stepTitle"], [class*="module-title"], [class*="moduleTitle"], [class*="block-title"], [class*="blockTitle"], [class*="atsx-title"], [class*="atsxTitle"], [class*="moka-title"], [class*="mokaTitle"], [class*="beisen-title"], [class*="beisenTitle"], [data-section-title]',
  BUTTON_SELECTOR:
    'button, [role="button"], a[href="#"], a:not([href]), span[class*="btn"], div[class*="btn"], span[class*="button"], div[class*="button"]',
  ADD_TEXT_REGEX: /^\+$|添加|新增|继续添加|增加|\badd\b|\bnew\b/i,
  REPEAT_SECTION_REGEX:
    /项目|教育|学历|院校|求学|实习|工作经历|工作经验|工作履历|任职经历|职业经历|就业经历|校园|社团|学生干部|社会实践|实践经历|project|education|school|intern|internship|work experience|work history|employment history|professional experience|campus|experience/i,
  REPEAT_ITEM_SELECTOR:
    '[class*="card"], [class*="Card"], [class*="entry"], [class*="Entry"], [class*="record"], [class*="Record"], [class*="block"], [class*="Block"], [class*="module"], [class*="Module"], [class*="panel"], [class*="Panel"], [class*="experience"], [class*="Experience"], [class*="history"], [class*="History"], [class*="employment"], [class*="Employment"], [class*="career"], [class*="Career"], [class*="project"], [class*="Project"], [class*="education"], [class*="Education"], [class*="intern"], [class*="Intern"], [class*="campus"], [class*="Campus"], [class*="moka"], [class*="Moka"], [class*="beisen"], [class*="Beisen"], [class*="atsx"], [class*="Atsx"], [data-field-list-item], [data-form-list-item], [data-list-item], [data-repeat-item]',
  SECTION_ATTRS: [
    'data-section-title',
    'data-form-field-i18n-name',
    'data-section',
    'data-module',
    'data-name',
    'aria-label',
    'title',
  ],
  SECTION_ATTR_SELECTOR:
    '[data-section-title], [data-form-field-i18n-name], [data-section], [data-module], [data-name], [aria-label], [title]',

  reset() {
    this.expansionCount = 0;
    this.depth = 0;
  },

  async executeActions(sectionActions) {
    const results = [];

    for (const [sectionName, action] of Object.entries(sectionActions)) {
      const result = {
        sectionName,
        action,
        requested: 0,
        attempted: 0,
        added: 0,
        beforeCount: null,
        afterCount: null,
        status: 'skipped',
      };
      results.push(result);

      if (!action.startsWith('add_')) {
        result.status = 'unsupported_action';
        continue;
      }
      const count = parseInt(action.split('_')[1], 10);
      result.requested = Number.isFinite(count) ? count : 0;
      if (count <= 0) {
        result.status = 'invalid_count';
        continue;
      }

      for (let i = 0; i < count; i++) {
        if (this.expansionCount >= this.MAX_EXPANSIONS) {
          result.status = 'expansion_limit';
          break;
        }
        if (this.depth >= this.MAX_DEPTH) {
          result.status = 'depth_limit';
          break;
        }

        const target = this._findAddTarget(sectionName);
        const btn = target && target.button;
        if (!btn || !this._isVisible(btn)) {
          result.status = result.added > 0 ? 'partial_button_not_found' : 'button_not_found';
          break;
        }

        this.depth++;
        const container = target.container || this._buttonSectionContainer(btn);
        const beforeCount = container ? this._countRepeatItems(container) : null;
        if (result.beforeCount == null && beforeCount != null) result.beforeCount = beforeCount;
        const waitForIncrease = container
          ? this._waitForCountIncrease(container, beforeCount, this.EXPAND_TIMEOUT)
          : this._waitForDomChange(this.EXPAND_TIMEOUT);
        btn.click();
        result.attempted++;
        this.expansionCount++;

        const changed = await waitForIncrease;
        this.depth--;
        const afterCount = container ? this._countRepeatItems(container) : null;
        result.afterCount = afterCount;

        const countIncreased = beforeCount == null || afterCount == null
          ? !!changed
          : afterCount > beforeCount;
        if (!countIncreased) {
          result.status = changed ? 'count_unchanged' : 'timeout';
          break;
        }
        result.added++;
      }

      if (result.added === count) {
        result.status = 'completed';
      } else if (result.status === 'skipped') {
        result.status = result.added > 0 ? 'partial' : 'not_completed';
      }
    }

    return results;
  },

  collectSectionInfo() {
    const sections = [];
    const seen = new Set();

    const headings = document.querySelectorAll(this.HEADING_SELECTOR);
    headings.forEach(h => {
      if (!this._isVisible(h)) return;
      const text = h.textContent.trim();
      if (!text || text.length > 50 || seen.has(text)) return;
      seen.add(text);

      const container = this._sectionContainerForHeading(h);
      const addButton = !!this._findAddButtonNear(text, container);
      let currentCount = 1;

      if (container) {
        currentCount = this._countRepeatItems(container);
      }

      sections.push({ name: text, currentCount, addButton });
    });

    this._collectSectionsFromAddButtons(sections, seen);
    this._collectSectionsFromDataContainers(sections, seen);
    return sections;
  },

  _findAddButton(sectionName) {
    const target = this._findAddTarget(sectionName);
    return target ? target.button : null;
  },

  _findAddTarget(sectionName) {
    const direct = Array.from(document.querySelectorAll(this.BUTTON_SELECTOR)).find(btn => {
      const text = this._buttonText(btn);
      return this._looksLikeAddButtonText(text) &&
        this._textMatchesSection(text, sectionName) &&
        this._isVisible(btn);
    });
    if (direct) return { button: direct, container: this._buttonSectionContainer(direct) };

    const headings = document.querySelectorAll(this.HEADING_SELECTOR);
    for (const h of headings) {
      if (!this._isVisible(h)) continue;
      if (!h.textContent.includes(sectionName)) continue;
      const container = this._sectionContainerForHeading(h);
      if (!container) continue;
      const btn = this._findAddButtonNear(sectionName, container);
      if (btn) return { button: btn, container };
    }

    for (const container of this._sectionContainersByName(sectionName)) {
      const btn = this._findAddButtonNear(sectionName, container);
      if (btn) return { button: btn, container };
    }
    return null;
  },

  _collectSectionsFromAddButtons(sections, seen) {
    const buttons = document.querySelectorAll(this.BUTTON_SELECTOR);
    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = this._buttonText(btn);
      if (!this._looksLikeAddButtonText(text)) continue;

      const container = this._buttonSectionContainer(btn);
      const sectionName =
        this._deriveSectionNameFromAddText(text) ||
        this._sectionNameFromContainer(container);
      if (!sectionName || seen.has(sectionName) || !this.REPEAT_SECTION_REGEX.test(sectionName)) continue;

      sections.push({
        name: sectionName,
        currentCount: container ? this._countRepeatItems(container) : 1,
        addButton: true,
      });
      seen.add(sectionName);
    }
  },

  _findAddButtonNear(sectionName, container) {
    if (!container) return null;
    return Array.from(container.querySelectorAll(this.BUTTON_SELECTOR)).find(btn => {
      const text = this._buttonText(btn);
      return this._looksLikeAddButtonText(text) &&
        (this._textMatchesSection(text, sectionName) || this._isGenericAddText(text)) &&
        this._isVisible(btn);
    }) || null;
  },

  _collectSectionsFromDataContainers(sections, seen) {
    const containers = document.querySelectorAll(this.SECTION_ATTR_SELECTOR);
    for (const container of containers) {
      if (!this._isVisible(container)) continue;
      const sectionName = this._sectionNameFromContainer(container);
      if (!sectionName || seen.has(sectionName) || !this.REPEAT_SECTION_REGEX.test(sectionName)) continue;

      const addButton = !!this._findAddButtonNear(sectionName, container);
      const currentCount = this._countRepeatItems(container);
      if (!addButton && currentCount <= 1) continue;

      sections.push({ name: sectionName, currentCount, addButton });
      seen.add(sectionName);
    }
  },

  _sectionContainerForHeading(heading) {
    const parent = heading.parentElement;
    return heading.closest('fieldset') ||
      (parent && parent.closest('[class*="section"]')) ||
      (parent && parent.closest('[class*="module"]')) ||
      (parent && parent.closest('[class*="block"]')) ||
      (parent && parent.closest('[class*="moka"]')) ||
      (parent && parent.closest('[class*="beisen"]')) ||
      (parent && parent.closest('[class*="atsx"]')) ||
      (parent && parent.closest('[data-form-field-i18n-name]')) ||
      parent;
  },

  _countRepeatItems(container) {
    const candidates = Array.from(container.querySelectorAll(this.REPEAT_ITEM_SELECTOR))
      .filter(el => this._isVisible(el))
      .filter(el => this._controlCount(el) >= 2)
      .filter(el => !this._containsVisibleAddButtonOnly(el));

    const leafCandidates = candidates.filter(el => {
      return !candidates.some(other => other !== el && el.contains(other));
    });
    return Math.max(1, leafCandidates.length || 1);
  },

  _controlCount(container) {
    if (!container || !container.querySelectorAll) return 0;
    return container.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="textbox"], [aria-haspopup="listbox"], [aria-haspopup="list"], [aria-haspopup="tree"]'
    ).length;
  },

  _containsVisibleAddButtonOnly(el) {
    const buttons = Array.from(el.querySelectorAll(this.BUTTON_SELECTOR)).filter(btn => this._isVisible(btn));
    return buttons.length > 0 && this._controlCount(el) === 0;
  },

  _buttonText(btn) {
    const visible = (btn.textContent || '').replace(/\s+/g, ' ').trim();
    const hints = [
      btn.getAttribute('aria-label'),
      btn.getAttribute('title'),
      btn.getAttribute('data-name'),
      btn.getAttribute('data-testid'),
      btn.getAttribute('data-test-id'),
    ].filter(Boolean).join(' ');
    const text = visible && !this._isGenericAddText(visible) ? visible : `${visible} ${hints}`;
    return text
      .replace(/\s+/g, ' ')
      .trim();
  },

  _looksLikeAddButtonText(text) {
    return !!text && this.ADD_TEXT_REGEX.test(text);
  },

  _isGenericAddText(text) {
    return /^\+$|^添加$|^新增$|^add$|^new$/i.test(text.trim());
  },

  _textMatchesSection(text, sectionName) {
    if (!text || !sectionName) return false;
    const derived = this._deriveSectionNameFromAddText(text);
    const normalizedText = this._normalizeText(text);
    const normalizedSection = this._normalizeText(sectionName);
    const normalizedDerived = this._normalizeText(derived);
    return normalizedText.includes(normalizedSection) ||
      (!!normalizedDerived && normalizedSection.includes(normalizedDerived));
  },

  _deriveSectionNameFromAddText(text) {
    const cleaned = (text || '')
      .replace(/^\+/, '')
      .replace(/^(继续)?(添加|新增|增加)(一段|一条|一个|新的)?/, '')
      .replace(/^(一段|一条|一个|新的)/, '')
      .replace(/\b(add|new)\b/ig, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const matched = cleaned.match(
      /项目经历|项目经验|项目|教育经历|教育背景|求学经历|教育|学历|院校|实习经历|实习经验|实习|工作经历|工作经验|工作履历|任职经历|职业经历|就业经历|校园经历|校园|社团经历|社团|社会实践|实践经历|project experience|project|education|school experience|school|internship experience|internship|intern|work experience|work history|employment history|professional experience|career history|campus experience|campus/i
    );
    return matched ? matched[0] : cleaned;
  },

  _normalizeText(text) {
    return String(text || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  },

  _buttonSectionContainer(btn) {
    const parent = btn && btn.parentElement;
    return parent && parent.closest('[class*="section"], [class*="module"], [class*="block"], [class*="moka"], [class*="beisen"], [class*="atsx"], [data-form-field-i18n-name], [data-section-title], [data-section], [data-module], [data-name], fieldset') ||
      btn.parentElement;
  },

  _sectionContainersByName(sectionName) {
    return Array.from(document.querySelectorAll(this.SECTION_ATTR_SELECTOR))
      .filter(container => this._isVisible(container))
      .filter(container => this._textMatchesSection(this._sectionNameFromContainer(container), sectionName));
  },

  _sectionNameFromContainer(container) {
    if (!container || !container.getAttribute) return '';
    for (const attr of this.SECTION_ATTRS) {
      const value = container.getAttribute(attr);
      if (!value) continue;
      const text = value.replace(/\s+/g, ' ').trim();
      if (!text || text.length > 50) continue;
      const matched = this._deriveSectionNameFromAddText(text);
      return matched || text;
    }
    return '';
  },

  _waitForDomChange(timeout) {
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve(true);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeout);
    });
  },

  _waitForCountIncrease(container, beforeCount, timeout) {
    if (!container || beforeCount == null) return this._waitForDomChange(timeout);

    return new Promise(resolve => {
      let done = false;
      let interval = null;
      const finish = changed => {
        if (done) return;
        done = true;
        observer.disconnect();
        if (interval) clearInterval(interval);
        resolve(changed);
      };
      const check = () => {
        if (this._countRepeatItems(container) > beforeCount) finish(true);
      };
      const observer = new MutationObserver(check);
      observer.observe(container, { childList: true, subtree: true });
      interval = setInterval(check, 100);
      setTimeout(() => finish(false), timeout);
      check();
    });
  },

  _isVisible(el) {
    return DOMUtils.isVisibleStrict(el);
  },
};
