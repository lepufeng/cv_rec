var SectionManager = {
  MAX_EXPANSIONS: 20,
  MAX_DEPTH: 3,
  EXPAND_TIMEOUT: 3000,

  expansionCount: 0,
  depth: 0,

  HEADING_SELECTOR:
    'h2, h3, h4, fieldset legend, [class*="section-title"], [class*="sectionTitle"], [class*="step-title"], [class*="stepTitle"], [class*="module-title"], [class*="moduleTitle"], [class*="block-title"], [class*="blockTitle"]',
  BUTTON_SELECTOR:
    'button, [role="button"], a[href="#"], a:not([href]), span[class*="btn"], div[class*="btn"], span[class*="button"], div[class*="button"]',
  ADD_TEXT_REGEX: /^\+$|添加|新增|继续添加|增加|\badd\b|\bnew\b/i,
  REPEAT_SECTION_REGEX:
    /项目|教育|学历|院校|实习|工作经历|工作经验|校园|社团|学生干部|project|education|intern|work experience|campus|experience/i,
  REPEAT_ITEM_SELECTOR:
    '[class*="card"], [class*="Card"], [class*="entry"], [class*="Entry"], [class*="record"], [class*="Record"], [class*="block"], [class*="Block"], [class*="module"], [class*="Module"], [class*="panel"], [class*="Panel"], [class*="experience"], [class*="Experience"], [class*="project"], [class*="Project"], [class*="education"], [class*="Education"], [class*="intern"], [class*="Intern"], [class*="campus"], [class*="Campus"]',

  reset() {
    this.expansionCount = 0;
    this.depth = 0;
  },

  async executeActions(sectionActions) {
    for (const [sectionName, action] of Object.entries(sectionActions)) {
      if (!action.startsWith('add_')) continue;
      const count = parseInt(action.split('_')[1], 10);
      if (count <= 0) continue;

      for (let i = 0; i < count; i++) {
        if (this.expansionCount >= this.MAX_EXPANSIONS) return;
        if (this.depth >= this.MAX_DEPTH) return;

        const btn = this._findAddButton(sectionName);
        if (!btn || !this._isVisible(btn)) break;

        this.depth++;
        const waitForChange = this._waitForDomChange(this.EXPAND_TIMEOUT);
        btn.click();
        this.expansionCount++;

        const changed = await waitForChange;
        this.depth--;
        if (!changed) break;
      }
    }
  },

  collectSectionInfo() {
    const sections = [];
    const seen = new Set();

    const headings = document.querySelectorAll(this.HEADING_SELECTOR);
    headings.forEach(h => {
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
    return sections;
  },

  _findAddButton(sectionName) {
    const direct = Array.from(document.querySelectorAll(this.BUTTON_SELECTOR)).find(btn => {
      const text = this._buttonText(btn);
      return this._looksLikeAddButtonText(text) &&
        this._textMatchesSection(text, sectionName) &&
        this._isVisible(btn);
    });
    if (direct) return direct;

    const headings = document.querySelectorAll(this.HEADING_SELECTOR);
    for (const h of headings) {
      if (!h.textContent.includes(sectionName)) continue;
      const container = this._sectionContainerForHeading(h);
      if (!container) continue;
      const btn = this._findAddButtonNear(sectionName, container);
      if (btn) return btn;
    }
    return null;
  },

  _collectSectionsFromAddButtons(sections, seen) {
    const buttons = document.querySelectorAll(this.BUTTON_SELECTOR);
    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = this._buttonText(btn);
      if (!this._looksLikeAddButtonText(text)) continue;

      const sectionName = this._deriveSectionNameFromAddText(text);
      if (!sectionName || seen.has(sectionName) || !this.REPEAT_SECTION_REGEX.test(sectionName)) continue;

      const container = btn.closest('[class*="section"], [class*="module"], [class*="block"], fieldset') ||
        btn.parentElement;
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

  _sectionContainerForHeading(heading) {
    const parent = heading.parentElement;
    return heading.closest('fieldset') ||
      (parent && parent.closest('[class*="section"]')) ||
      (parent && parent.closest('[class*="module"]')) ||
      (parent && parent.closest('[class*="block"]')) ||
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
    return (btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '')
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
    return text.includes(sectionName) || (!!derived && sectionName.includes(derived));
  },

  _deriveSectionNameFromAddText(text) {
    const cleaned = (text || '')
      .replace(/^\+/, '')
      .replace(/^(继续)?(添加|新增|增加)(一段|一条|一个|新的)?/, '')
      .replace(/^(一段|一条|一个|新的)/, '')
      .replace(/\b(add|new)\b/ig, '')
      .replace(/\s+/g, ' ')
      .trim();
    const matched = cleaned.match(
      /项目经历|项目经验|项目|教育经历|教育|学历|院校|实习经历|实习|工作经历|工作经验|校园经历|校园|社团经历|社团|project experience|project|education|internship|intern|work experience|campus experience|campus/i
    );
    return matched ? matched[0] : cleaned;
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

  _isVisible(el) {
    return DOMUtils.isVisibleStrict(el);
  },
};
