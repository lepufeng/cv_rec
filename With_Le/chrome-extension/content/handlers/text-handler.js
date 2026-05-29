var TextHandler = {
  canHandle(field) {
    return ['text', 'textarea'].includes(field.type);
  },

  fill(el, value) {
    if (value == null) return false;
    const str = String(value);

    try {
      el.focus();
    } catch (_) {}

    if (el.hasAttribute && el.hasAttribute('contenteditable')) {
      this._fillContentEditable(el, str);
      try { el.blur(); } catch (_) {}
      return this._normalizeText(this._contentEditableText(el)) === this._normalizeText(str);
    }

    // React / Vue safe write.
    DOMUtils.setNativeValue(el, str);

    // Some frameworks only commit on blur or keyup.
    DOMUtils.fireTextCommitEvents(el, str);
    try { el.blur(); } catch (_) {}

    return el.value === str;
  },

  _fillContentEditable(el, str) {
    try {
      el.focus();
      const selection = window.getSelection && window.getSelection();
      const range = document.createRange && document.createRange();
      if (selection && range) {
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (document.execCommand && document.execCommand('insertText', false, str)) {
        DOMUtils.fireInputEvents(el);
        return true;
      }
    } catch (_) {}

    if (this._looksLikeParagraphEditor(el)) {
      el.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = str;
      el.appendChild(p);
    } else {
      el.textContent = str;
    }
    DOMUtils.fireTextCommitEvents(el, str);
    return true;
  },

  _contentEditableText(el) {
    return el.textContent || '';
  },

  _normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  },

  _looksLikeParagraphEditor(el) {
    const cls = typeof el.className === 'string' ? el.className : '';
    return /ProseMirror|ql-editor|rich|editor/i.test(cls) || el.querySelector('p, div, br');
  },
};
