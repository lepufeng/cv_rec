var SelectHandler = {
  canHandle(field) {
    return field.type === 'select';
  },

  async fill(el, value, field) {
    if (field && field.widget === 'pseudo-radio') {
      return this._fillPseudoGroup(el, value);
    }
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

    const dropdowns = this._visibleDropdowns();
    for (const dropdown of dropdowns) {
      const items = dropdown.querySelectorAll('[role="option"], li, div');
      for (const item of items) {
        const itemText = item.textContent.trim();
        if (!itemText) continue;
        if (itemText === str || itemText.includes(str) || str.includes(itemText)) {
          item.click();
          return true;
        }
      }
    }

    DOMUtils.fireInputEvents(target);
    return target.value === str || target.textContent === str;
  },

  _fillPseudoGroup(el, value) {
    const values = (Array.isArray(value) ? value : [value])
      .map(v => v == null ? '' : String(v).trim())
      .filter(Boolean);
    if (values.length === 0) return false;

    const items = this._pseudoOptions(el);
    for (const item of items) {
      const text = this._optionText(item);
      if (!text) continue;
      if (!values.some(v => this._matchesOptionText(text, v))) continue;

      try {
        item.click();
        item.dispatchEvent(new Event('change', { bubbles: true }));
        item.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (_) {}
      // Custom button groups often update hidden framework state without
      // exposing a selected class immediately; a matched click is success.
      return true;
    }

    return false;
  },

  _editableTarget(el) {
    if (typeof el.value !== 'undefined' || (el.hasAttribute && el.hasAttribute('contenteditable'))) {
      return el;
    }
    return el.querySelector(
      'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"]'
    ) || el;
  },

  _visibleDropdowns() {
    const selector = [
      '[role="listbox"]',
      '[class*="dropdown"]',
      '[class*="Dropdown"]',
      '[class*="popper"]',
      '[class*="Popper"]',
      '[class*="option-list"]',
      '[class*="OptionList"]',
      '[class*="menu"]',
      '[class*="Menu"]',
    ].join(',');
    return Array.from(document.querySelectorAll(selector))
      .filter(el => DOMUtils.isVisibleStrict(el))
      .filter(el => !/display:\s*none|visibility:\s*hidden/i.test(el.getAttribute('style') || ''));
  },

  _pseudoOptions(el) {
    const selector = [
      '[role="radio"]',
      '[role="option"]',
      '[class*="radio-item"]', '[class*="radioItem"]',
      '[class*="select-label"]:not(label)', '[class*="selectLabel"]:not(label)',
      '[class*="radio-label"]:not(label)', '[class*="radioLabel"]:not(label)',
      '[class*="picker-item"]', '[class*="pickerItem"]',
      '[class*="option-item"]', '[class*="optionItem"]',
      '[class*="select-item"]', '[class*="selectItem"]',
      '[class*="choice-item"]', '[class*="choiceItem"]',
      'label[class*="radio-wrapper"]', 'label[class*="radioWrapper"]',
      'label[class*="radio__wrapper"]', 'label[class*="radio_wrapper"]',
      'label[class*="checkbox-wrapper"]', 'label[class*="checkboxWrapper"]',
      'label[class*="checkbox__wrapper"]', 'label[class*="checkbox_wrapper"]',
      'button',
    ].join(',');
    return Array.from(el.querySelectorAll(selector))
      .filter(item => DOMUtils.isVisible(item))
      .filter(item => this._optionText(item));
  },

  _optionText(item) {
    return (item.textContent || item.getAttribute('aria-label') || item.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  _matchesOptionText(optionText, value) {
    const option = this._normalize(optionText);
    const wanted = this._normalize(value);
    return option === wanted || option.includes(wanted) || wanted.includes(option);
  },

  _normalize(value) {
    return String(value || '').trim().toLowerCase();
  },

  _isSelected(item) {
    if (item.getAttribute && item.getAttribute('aria-checked') === 'true') return true;
    if (item.getAttribute && item.getAttribute('aria-selected') === 'true') return true;
    const input = item.matches && item.matches('input') ? item : item.querySelector && item.querySelector('input');
    if (input && input.checked) return true;
    const cls = item.className && typeof item.className === 'string' ? item.className : '';
    return /checked|selected|active/i.test(cls);
  },
};
