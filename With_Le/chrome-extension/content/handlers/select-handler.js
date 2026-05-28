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
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise(r => setTimeout(r, 300));

    const dropdown = document.querySelector('[class*="dropdown"]:not([style*="display: none"]), [class*="select"]:not([style*="display: none"]), [role="listbox"]');
    if (dropdown) {
      const items = dropdown.querySelectorAll('[role="option"], li, div');
      for (const item of items) {
        if (item.textContent.trim() === value) {
          item.click();
          return true;
        }
      }
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value === value;
  },
};
