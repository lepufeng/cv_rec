var NavigationDetector = {
  MAX_PAGES: 10,
  NAV_TIMEOUT: 5000,

  previousFieldSignature: '',

  reset() {
    this.previousFieldSignature = '';
  },

  findNextButton() {
    const buttons = document.querySelectorAll('button, a, [role="button"], span[class*="btn"], div[class*="btn"]');

    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = btn.textContent.trim();
      if (/^下一步$|^继续$|^保存并继续$|^Next$/i.test(text)) {
        return btn;
      }
    }

    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = btn.textContent.trim();
      if (text.includes('下一步') || text.includes('继续') || /next/i.test(text)) {
        return btn;
      }
    }

    return null;
  },

  isSubmitOnly() {
    const buttons = document.querySelectorAll('button, a, [role="button"]');
    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = btn.textContent.trim();
      if (/^提交$|^确认$|^保存$|^Submit$|^Confirm$/i.test(text)) {
        return true;
      }
    }
    return false;
  },

  isDuplicatePage(fields) {
    const signature = fields.map(f => `${f.type}:${f.label}`).sort().join('|');
    if (signature && signature === this.previousFieldSignature) {
      return true;
    }
    this.previousFieldSignature = signature;
    return false;
  },

  async clickNext() {
    const btn = this.findNextButton();
    if (!btn) return false;

    btn.click();

    await new Promise(r => setTimeout(r, 1000));

    const changed = await this._waitForDomStable(this.NAV_TIMEOUT);
    return changed;
  },

  _waitForDomStable(timeout) {
    return new Promise(resolve => {
      const start = Date.now();
      let lastChange = start;
      const observer = new MutationObserver(() => { lastChange = Date.now(); });
      observer.observe(document.body, { childList: true, subtree: true });

      const check = setInterval(() => {
        if (Date.now() - lastChange > 1000) {
          clearInterval(check);
          observer.disconnect();
          resolve(true);
        } else if (Date.now() - start > timeout) {
          clearInterval(check);
          observer.disconnect();
          resolve(false);
        }
      }, 200);
    });
  },

  _isVisible(el) {
    return DOMUtils.isVisibleStrict(el);
  },
};
