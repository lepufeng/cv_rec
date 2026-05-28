var SelectHandler = {
  canHandle(field) {
    return field.type === 'select';
  },

  async fill(el, value) {
    if (el.tagName.toLowerCase() === 'select') {
      return this._fillNative(el, value);
    }
    return this._fillCustom(el, value);
  },

  _fillNative(el, value) {
    for (const opt of el.options) {
      if (opt.textContent.trim() === value || opt.value === value) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }

    const partial = Array.from(el.options).find(o => o.textContent.includes(value) || value.includes(o.textContent));
    if (partial) {
      el.value = partial.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  },

  async _fillCustom(el, value) {
    const str = value == null ? '' : String(value);
    const target = this._editableTarget(el);

    try { el.click(); } catch (_) {}
    try { target.focus(); } catch (_) {}
    if (typeof target.value !== 'undefined') {
      DOMUtils.setNativeValue(target, str);
      DOMUtils.fireInputEvents(target);
    } else if (target.hasAttribute && target.hasAttribute('contenteditable')) {
      target.textContent = str;
      DOMUtils.fireInputEvents(target);
    }

    await new Promise(r => setTimeout(r, 300));

    const dropdown = document.querySelector('[class*="dropdown"]:not([style*="display: none"]), [class*="select"]:not([style*="display: none"]), [role="listbox"]');
    if (dropdown) {
      const items = dropdown.querySelectorAll('[role="option"], li, div');
      for (const item of items) {
        const itemText = item.textContent.trim();
        if (itemText === str || itemText.includes(str) || str.includes(itemText)) {
          item.click();
          return true;
        }
      }
    }

    DOMUtils.fireInputEvents(target);
    return target.value === str || target.textContent === str;
  },

  _editableTarget(el) {
    if (typeof el.value !== 'undefined' || (el.hasAttribute && el.hasAttribute('contenteditable'))) {
      return el;
    }
    return el.querySelector(
      'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"]'
    ) || el;
  },
};
