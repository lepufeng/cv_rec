var SectionManager = {
  MAX_EXPANSIONS: 20,
  MAX_DEPTH: 3,
  EXPAND_TIMEOUT: 3000,

  expansionCount: 0,
  depth: 0,

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
        btn.click();
        this.expansionCount++;

        const changed = await this._waitForDomChange(this.EXPAND_TIMEOUT);
        this.depth--;
        if (!changed) break;
      }
    }
  },

  collectSectionInfo() {
    const sections = [];
    const seen = new Set();

    const headings = document.querySelectorAll('h2, h3, h4, fieldset legend, [class*="section-title"], [class*="step-title"]');
    headings.forEach(h => {
      const text = h.textContent.trim();
      if (!text || text.length > 50 || seen.has(text)) return;
      seen.add(text);

      const container = h.closest('fieldset') || h.closest('[class*="section"]') || h.parentElement;
      let addButton = false;
      let currentCount = 1;

      if (container) {
        const addBtn = Array.from(container.querySelectorAll('button, [role="button"], a[href="#"]')).find(btn => {
          const t = btn.textContent.trim();
          return /^\+$|添加|新增|展开|add/i.test(t) && this._isVisible(btn);
        });
        addButton = !!addBtn;

        const cards = container.querySelectorAll('[class*="card"], [class*="item"], [class*="entry"], [class*="record"], [class*="block"]');
        if (cards.length > 0) currentCount = cards.length;
      }

      sections.push({ name: text, currentCount, addButton });
    });

    return sections;
  },

  _findAddButton(sectionName) {
    const headings = document.querySelectorAll('h2, h3, h4, legend');
    for (const h of headings) {
      if (!h.textContent.includes(sectionName)) continue;
      const container = h.closest('fieldset') || h.closest('[class*="section"]') || h.parentElement;
      if (!container) continue;
      const btn = Array.from(container.querySelectorAll('button, [role="button"], a[href="#"]')).find(b => {
        return /^\+$|添加|新增|展开|add/i.test(b.textContent.trim());
      });
      if (btn) return btn;
    }
    return null;
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
