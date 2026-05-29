var DateHandler = {
  canHandle(field) {
    return field.type === 'date';
  },

  fill(el, value, field) {
    if (value == null) return false;
    const values = this._candidateValues(value, el, field);

    for (const str of values) {
      try { el.focus(); } catch (_) {}
      DOMUtils.setNativeValue(el, str);
      DOMUtils.fireInputEvents(el);
      try {
        for (const key of ['Enter', 'Tab']) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
        }
      } catch (_) {}
      try { el.blur(); } catch (_) {}

      if (this._matchesValue(el, str)) return true;
    }

    return false;
  },

  _candidateValues(value, el, field) {
    const raw = String(value == null ? '' : value).trim();
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

  _uniq(values) {
    return values.filter((value, index) => value && values.indexOf(value) === index);
  },
};
