var NavigationDetector = {
  MAX_PAGES: 10,
  NAV_TIMEOUT: 5000,

  previousFieldSignature: '',
  NEXT_TEXT_REGEX: /^(下一步|下一页|进入下一页|继续|继续填写|保存并继续|保存并继续填写|保存并下一步|保存并进入下一页|确认并继续|确认并继续填写|确认并下一步|确认并进入下一页|next|next step|continue|save and continue|save & continue|confirm and continue)$/i,
  NEXT_CUE_REGEX: /下一步|下一页|进入下一页|继续|\bnext\b|\bcontinue\b/i,
  HARD_FINAL_REGEX: /提交|投递|完成|submit|apply|finish/i,
  FINAL_SUBMIT_REGEX: /提交|投递|申请|完成|确认|submit|apply|finish|confirm/i,

  reset() {
    this.previousFieldSignature = '';
  },

  findNextButton() {
    const buttons = document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], span[class*="btn"], div[class*="btn"]');

    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = this._buttonText(btn);
      if (this._looksLikeFinalSubmit(text)) continue;
      if (this._looksLikeExactNext(text)) {
        return btn;
      }
    }

    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = this._buttonText(btn);
      if (this._looksLikeFinalSubmit(text)) continue;
      if (this._looksLikeNext(text)) {
        return btn;
      }
    }

    return null;
  },

  isSubmitOnly() {
    if (this.findNextButton()) return false;
    const buttons = document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]');
    for (const btn of buttons) {
      if (!this._isVisible(btn)) continue;
      const text = this._buttonText(btn);
      if (this._looksLikeFinalSubmit(text)) {
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

  _buttonText(el) {
    const values = [
      el.textContent,
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.getAttribute && el.getAttribute('value'),
      el.getAttribute && el.getAttribute('data-name'),
      el.getAttribute && el.getAttribute('data-testid'),
      el.getAttribute && el.getAttribute('data-test-id'),
      el.getAttribute && el.getAttribute('data-action'),
    ];
    return values.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  },

  _normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  },

  _looksLikeExactNext(text) {
    return this.NEXT_TEXT_REGEX.test(this._normalizeText(text));
  },

  _looksLikeNext(text) {
    const normalized = this._normalizeText(text);
    if (!normalized) return false;
    if (this._looksLikeExactNext(normalized)) return true;
    if (this.HARD_FINAL_REGEX.test(normalized)) return false;
    return this.NEXT_CUE_REGEX.test(normalized);
  },

  _looksLikeFinalSubmit(text) {
    const normalized = this._normalizeText(text);
    if (!normalized) return false;
    if (this._looksLikeNext(normalized)) return false;
    return this.FINAL_SUBMIT_REGEX.test(normalized);
  },
};
