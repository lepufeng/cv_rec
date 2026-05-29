var DateHandler = {
  canHandle(field) {
    return field.type === 'date';
  },

  async fill(el, value, field) {
    if (value == null) return false;
    const target = this._editableTarget(el);
    const values = this._candidateValues(value, target, field);
    const rangeValues = this._rangeValues(value);
    const preferPicker = this._preferPicker(target, field);

    if (preferPicker && rangeValues.length >= 2 && await this._fillRangeViaPicker(el, target, rangeValues)) {
      return true;
    }
    if (preferPicker && await this._fillViaPicker(el, target, values)) return true;

    for (const str of values) {
      if (this._fillDirect(target, str)) return true;
    }

    return !preferPicker && await this._fillViaPicker(el, target, values);
  },

  _editableTarget(el) {
    if (typeof el.value !== 'undefined' || (el.hasAttribute && el.hasAttribute('contenteditable'))) {
      return el;
    }
    return el.querySelector(
      'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"]'
    ) || el;
  },

  _preferPicker(target, field) {
    const inputType = (target.type || '').toLowerCase();
    if (['date', 'month', 'week', 'datetime-local', 'time'].includes(inputType)) return false;
    if (field && ['date-picker', 'date-range'].includes(field.widget)) return true;
    return target.readOnly === true || (target.getAttribute && target.getAttribute('readonly') !== null);
  },

  _fillDirect(target, str) {
    try { target.focus(); } catch (_) {}
    DOMUtils.setNativeValue(target, str);
    DOMUtils.fireInputEvents(target);
    try {
      for (const key of ['Enter', 'Tab']) {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
      }
    } catch (_) {}
    try { target.blur(); } catch (_) {}

    return this._matchesValue(target, str);
  },

  async _fillViaPicker(el, target, values) {
    if (!values.length) return false;
    try { el.click(); } catch (_) {}
    if (target !== el) {
      try { target.click(); } catch (_) {}
    }
    try { target.focus(); } catch (_) {}
    await new Promise(r => setTimeout(r, 250));

    const dropdowns = this._visibleDateDropdowns();
    for (const value of values) {
      const candidates = this._optionCandidates(value);
      for (const dropdown of dropdowns) {
        const option = this._bestDateOption(dropdown, candidates);
        if (!option) continue;
        try { option.click(); } catch (_) {}
        await new Promise(r => setTimeout(r, 180));
        DOMUtils.fireInputEvents(target);
        if (this._matchesAnyValue(target, values) || this._optionSelected(option)) return true;
      }
    }

    return false;
  },

  async _fillRangeViaPicker(el, target, rangeValues) {
    try { el.click(); } catch (_) {}
    if (target !== el) {
      try { target.click(); } catch (_) {}
    }
    try { target.focus(); } catch (_) {}
    await new Promise(r => setTimeout(r, 250));

    let clicked = 0;
    const clickedOptions = new Set();
    for (const value of rangeValues.slice(0, 2)) {
      const candidates = this._optionCandidates(value);
      const dropdowns = this._visibleDateDropdowns();
      let option = null;
      for (const dropdown of dropdowns) {
        option = this._bestDateOption(dropdown, candidates, clickedOptions);
        if (option) break;
      }
      if (!option) return false;
      clickedOptions.add(option);
      try { option.click(); } catch (_) {}
      clicked++;
      await new Promise(r => setTimeout(r, 180));
    }
    DOMUtils.fireInputEvents(target);
    return clicked >= 2 && (this._matchesRangeValue(target, rangeValues) || clickedOptions.size >= 2);
  },

  _visibleDateDropdowns() {
    const selector = [
      '[class*="picker-panel"]',
      '[class*="PickerPanel"]',
      '[class*="picker-dropdown"]',
      '[class*="PickerDropdown"]',
      '[class*="date-picker"]',
      '[class*="datepicker"]',
      '[class*="calendar"]',
      '[class*="Calendar"]',
      '[class*="ant-picker-dropdown"]',
      '[class*="el-picker-panel"]',
      '[role="dialog"]',
      '[role="grid"]',
    ].join(',');
    return Array.from(document.querySelectorAll(selector))
      .filter(item => DOMUtils.isVisibleStrict(item))
      .filter(item => !/display:\s*none|visibility:\s*hidden/i.test(item.getAttribute('style') || ''));
  },

  _bestDateOption(dropdown, candidates, excluded) {
    const options = this._dateOptions(dropdown)
      .filter(item => !excluded || !excluded.has(item))
      .map(item => ({ item, text: this._optionText(item) }))
      .filter(entry => entry.text)
      .map(entry => ({
        ...entry,
        score: this._optionScore(entry.text, candidates),
      }))
      .filter(entry => entry.score >= 0);
    if (!options.length) return null;
    options.sort((a, b) => a.score - b.score || a.text.length - b.text.length);
    return options[0].item;
  },

  _dateOptions(dropdown) {
    const selector = [
      '[data-value]',
      '[data-label]',
      '[title]',
      '[aria-label]',
      '[role="gridcell"]',
      '[class*="cell"]',
      '[class*="Cell"]',
      '[class*="date"]',
      '[class*="Date"]',
      '[class*="month"]',
      '[class*="Month"]',
      '[class*="year"]',
      '[class*="Year"]',
      'button',
      'td',
      'li',
      'div',
    ].join(',');
    const raw = Array.from(dropdown.querySelectorAll(selector))
      .filter(item => DOMUtils.isVisible(item))
      .filter(item => !this._isDisabledOption(item))
      .filter(item => this._optionText(item));

    return raw.filter(item => !raw.some(other => other !== item && item.contains(other)));
  },

  _optionText(item) {
    return [
      item.getAttribute && item.getAttribute('data-value'),
      item.getAttribute && item.getAttribute('data-label'),
      item.getAttribute && item.getAttribute('title'),
      item.getAttribute && item.getAttribute('aria-label'),
      item.textContent,
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  },

  _optionScore(text, candidates) {
    const option = this._normalizeOption(text);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = this._normalizeOption(candidates[i]);
      if (!candidate) continue;
      if (option === candidate) return i;
      if (option.includes(candidate)) return i + 20;
      if (candidate.includes(option) && option.length >= 4) return i + 40;
    }
    return -1;
  },

  _optionCandidates(value) {
    const raw = String(value || '').trim();
    const parts = this._dateParts(raw);
    if (!parts) return this._uniq([raw]);

    const [year, month, day] = parts;
    const m = String(parseInt(month, 10));
    const d = String(parseInt(day, 10));
    return this._uniq([
      raw,
      `${year}-${month}-${day}`,
      `${year}-${month}`,
      `${year}`,
      `${year}/${month}/${day}`,
      `${year}/${month}`,
      `${year}年${m}月${d}日`,
      `${year}年${m}月`,
      `${year}.${month}.${day}`,
      `${year}.${month}`,
    ]);
  },

  _normalizeOption(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[年月/.]/g, '-')
      .replace(/日/g, '')
      .replace(/-0(\d)/g, '-$1')
      .replace(/-+$/g, '');
  },

  _isDisabledOption(item) {
    if (item.getAttribute && item.getAttribute('aria-disabled') === 'true') return true;
    const cls = item.className && typeof item.className === 'string' ? item.className : '';
    return /disabled|unavailable/i.test(cls);
  },

  _optionSelected(item) {
    if (item.getAttribute && item.getAttribute('aria-selected') === 'true') return true;
    if (item.getAttribute && item.getAttribute('data-selected') === 'true') return true;
    const cls = item.className && typeof item.className === 'string' ? item.className : '';
    return /selected|active|current/i.test(cls);
  },

  _candidateValues(value, el, field) {
    const raw = this._dateValueText(value);
    if (!raw) return [];

    const parts = this._dateParts(raw);
    if (!parts) return [raw];

    const [year, month, day] = parts;
    const inputType = (el.type || '').toLowerCase();
    const wantsYear = this._wantsYearOnly(el, field);
    const yearOnly = year;
    const monthOnly = `${year}-${month}`;
    const dayOnly = `${year}-${month}-${day}`;

    if (wantsYear) return this._uniq([yearOnly, raw]);
    if (inputType === 'month') return this._uniq([monthOnly, raw, yearOnly]);
    if (inputType === 'date') return this._uniq([dayOnly, raw, monthOnly]);
    return this._uniq([raw, dayOnly, monthOnly, yearOnly]);
  },

  _dateValueText(value) {
    if (Array.isArray(value)) {
      return value.map(item => this._dateValueText(item)).filter(Boolean).join(' - ');
    }
    if (value && typeof value === 'object') {
      const start = this._dateValueText(value.start_date || value.startDate || value.start);
      const end = this._dateValueText(value.end_date || value.endDate || value.end);
      if (start || end) return [start, end].filter(Boolean).join(' - ');
      return Object.values(value).map(item => this._dateValueText(item)).filter(Boolean).join(' - ');
    }
    return String(value == null ? '' : value).trim();
  },

  _rangeValues(value) {
    if (Array.isArray(value)) {
      return value.map(item => this._dateValueText(item)).filter(Boolean).slice(0, 2);
    }
    if (value && typeof value === 'object') {
      return [
        this._dateValueText(value.start_date || value.startDate || value.start),
        this._dateValueText(value.end_date || value.endDate || value.end),
      ].filter(Boolean).slice(0, 2);
    }

    const text = this._dateValueText(value);
    const matches = text.match(/\d{4}(?:[-/.年]\d{1,2})?(?:[-/.月]\d{1,2})?/g) || [];
    return matches.slice(0, 2);
  },

  _dateParts(value) {
    const text = String(value || '').trim();
    const matched = text.match(/(\d{4})(?:[-/.年](\d{1,2}))?(?:[-/.月](\d{1,2}))?/);
    if (!matched) return null;
    const year = matched[1];
    const month = String(Math.min(Math.max(parseInt(matched[2] || '1', 10), 1), 12)).padStart(2, '0');
    const day = String(Math.min(Math.max(parseInt(matched[3] || '1', 10), 1), 31)).padStart(2, '0');
    return [year, month, day];
  },

  _wantsYearOnly(el, field) {
    const text = [
      el.getAttribute && el.getAttribute('placeholder'),
      el.getAttribute && el.getAttribute('aria-label'),
      field && field.placeholder,
      field && field.subLabel,
      field && field.label,
    ].filter(Boolean).join(' ');
    if (/\bYYYY\b|年份|年度/i.test(text)) return true;
    const maxLength = (field && field.maxLength) || (el.getAttribute && el.getAttribute('maxlength'));
    return String(maxLength || '') === '4';
  },

  _matchesValue(el, expected) {
    if (typeof el.value !== 'undefined') return el.value === expected;
    if (el.textContent != null) return el.textContent === expected;
    return false;
  },

  _matchesAnyValue(el, values) {
    return values.some(value => this._matchesValue(el, value));
  },

  _matchesRangeValue(el, rangeValues) {
    const text = this._normalizeOption(typeof el.value !== 'undefined' ? el.value : el.textContent);
    return rangeValues.slice(0, 2).every(value => {
      const candidates = this._optionCandidates(value).map(item => this._normalizeOption(item));
      return candidates.some(candidate => candidate && text.includes(candidate));
    });
  },

  _uniq(values) {
    return values.filter((value, index) => value && values.indexOf(value) === index);
  },
};
