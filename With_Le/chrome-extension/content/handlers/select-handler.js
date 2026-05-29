var SelectHandler = {
  canHandle(field) {
    return field.type === 'select';
  },

  async fill(el, value, field) {
    if (field && field.widget === 'pseudo-radio') {
      return this._fillPseudoGroup(el, value);
    }
    if (el.tagName.toLowerCase() === 'select') {
      return this._fillNative(el, value, field);
    }
    return this._fillCustom(el, value, field);
  },

  _fillNative(el, value, field) {
    const values = this._values(value, field);
    if (values.length === 0) return false;

    if (el.multiple) {
      let matched = 0;
      for (const opt of el.options) {
        const shouldSelect = values.some(v => this._matchesOptionText(opt.textContent.trim() || opt.value, v));
        opt.selected = shouldSelect;
        if (shouldSelect) matched++;
      }
      if (matched === values.length) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }

    const str = values[0];
    for (const opt of el.options) {
      if (this._matchesOptionText(opt.textContent.trim(), str) || this._matchesOptionText(opt.value, str)) {
        el.value = opt.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }

    const partial = Array.from(el.options).find(o => this._matchesOptionText(o.textContent, str));
    if (partial) {
      el.value = partial.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  },

  async _fillCustom(el, value, field) {
    const values = this._values(value, field);
    if (values.length === 0) return false;
    let filled = 0;

    for (const str of values) {
      const ok = await this._fillOneCustomValue(el, str);
      if (ok) filled++;
      await new Promise(r => setTimeout(r, 100));
    }

    return filled === values.length;
  },

  async _fillOneCustomValue(el, str) {
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
      const match = this._bestDropdownOption(dropdown, str);
      if (match) {
        match.click();
        return true;
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
      '[role="tree"]',
      '[class*="dropdown"]',
      '[class*="Dropdown"]',
      '[class*="popper"]',
      '[class*="Popper"]',
      '[class*="cascader"]',
      '[class*="Cascader"]',
      '[class*="option-list"]',
      '[class*="OptionList"]',
      '[class*="tree"]',
      '[class*="Tree"]',
      '[class*="menu"]',
      '[class*="Menu"]',
    ].join(',');
    return Array.from(document.querySelectorAll(selector))
      .filter(el => DOMUtils.isVisibleStrict(el))
      .filter(el => !/display:\s*none|visibility:\s*hidden/i.test(el.getAttribute('style') || ''));
  },

  _bestDropdownOption(dropdown, value) {
    const candidates = this._dropdownOptions(dropdown)
      .map(item => ({ item, text: this._optionText(item) }))
      .filter(entry => entry.text)
      .filter(entry => this._matchesOptionText(entry.text, value));
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const aExact = this._normalize(a.text) === this._normalize(value) ? 0 : 1;
      const bExact = this._normalize(b.text) === this._normalize(value) ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.text.length - b.text.length;
    });
    return candidates[0].item;
  },

  _dropdownOptions(dropdown) {
    const selector = [
      '[role="option"]',
      '[role="treeitem"]',
      '[data-value]',
      '[data-label]',
      '[class*="option"]', '[class*="Option"]',
      '[class*="select-item"]', '[class*="SelectItem"]',
      '[class*="select-option"]', '[class*="SelectOption"]',
      '[class*="cascader-node"]', '[class*="CascaderNode"]',
      '[class*="tree-node"]', '[class*="TreeNode"]',
      '[class*="menu-item"]', '[class*="MenuItem"]',
      'li',
      'div',
    ].join(',');
    const raw = Array.from(dropdown.querySelectorAll(selector))
      .filter(item => DOMUtils.isVisible(item))
      .filter(item => this._optionText(item));

    return raw.filter(item => !raw.some(other => other !== item && item.contains(other)));
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
    return (
      item.textContent ||
      item.getAttribute('aria-label') ||
      item.getAttribute('title') ||
      item.getAttribute('data-label') ||
      item.getAttribute('data-value') ||
      item.getAttribute('value') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  },

  _matchesOptionText(optionText, value) {
    const option = this._normalize(optionText);
    const wanted = this._normalize(value);
    if (!option || !wanted) return false;
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

  _values(value, field) {
    if (value == null) return [];
    if (Array.isArray(value)) {
      return value.map(v => String(v == null ? '' : v).trim()).filter(Boolean);
    }

    const str = String(value).trim();
    if (!str) return [];
    if (!this._looksLikeMultiValueField(field)) return [str];

    const parts = str
      .split(/[、,，;；|]/)
      .map(v => v.trim())
      .filter(Boolean);
    return parts.length > 1 ? parts : [str];
  },

  _looksLikeMultiValueField(field) {
    if (!field) return false;
    const text = [
      field.label,
      field.placeholder,
      field.subLabel,
      field.widget,
    ].filter(Boolean).join(' ');
    return /多选|多个|至多|最多|期望工作城市|意向城市|工作地点|开发语言|技能|语言|multi|multiple/i.test(text);
  },
};
