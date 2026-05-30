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

  async fillGroup(items) {
    const ordered = (items || [])
      .filter(item => item && item.el && item.field)
      .map((item, index) => ({
        ...item,
        index,
        groupIndex: this._groupIndex(item.field),
        target: this._editableTarget(item.el),
      }))
      .sort((a, b) => a.groupIndex - b.groupIndex || a.index - b.index);
    if (ordered.length < 2) return false;

    const rangeValues = ordered
      .map(item => this._dateValueText(item.value))
      .filter(Boolean)
      .slice(0, 2);
    if (rangeValues.length < 2) return false;

    const pickerItem = ordered.find(item => this._preferPicker(item.target, item.field));
    if (pickerItem && await this._fillRangeViaPicker(pickerItem.el, pickerItem.target, rangeValues)) {
      ordered.forEach(item => DOMUtils.fireInputEvents(item.target));
      if (await this._waitForGroupValues(ordered, rangeValues)) {
        await this._commitRangeValidation(ordered, rangeValues);
        return await this._waitForGroupValues(ordered, rangeValues);
      }
    }

    let filledAll = true;
    for (const item of ordered.slice(0, 2)) {
      const values = this._candidateValues(item.value, item.target, item.field);
      let filled = false;
      for (const str of values) {
        if (this._fillDirect(item.target, str)) {
          filled = true;
          break;
        }
      }
      if (!filled) filledAll = false;
    }
    if (!filledAll || !(await this._waitForGroupValues(ordered, rangeValues))) return false;
    await this._commitRangeValidation(ordered, rangeValues);
    return await this._waitForGroupValues(ordered, rangeValues);
  },

  async validateFilledGroup(items) {
    const ordered = (items || [])
      .filter(item => item && item.el && item.field)
      .map((item, index) => ({
        ...item,
        index,
        groupIndex: this._groupIndex(item.field),
        target: this._editableTarget(item.el),
      }))
      .sort((a, b) => a.groupIndex - b.groupIndex || a.index - b.index);
    if (ordered.length < 2) return { ok: false, reason: '日期范围字段不足' };

    const rangeValues = ordered
      .map(item => this._dateValueText(item.value))
      .filter(Boolean)
      .slice(0, 2);
    if (rangeValues.length < 2) return { ok: false, reason: '日期范围目标值不足' };
    if (!(await this._waitForGroupValues(ordered, rangeValues))) {
      return { ok: false, reason: '日期范围值未完整写入' };
    }

    const beforeValues = ordered.slice(0, 2).map(item => this._targetValue(item.target));
    const beforeErrors = this._groupValidationErrors(ordered);
    const clickResult = await this._clickRangeForPostFillValidation(ordered);

    const afterValues = ordered.slice(0, 2).map(item => this._targetValue(item.target));
    const afterErrors = this._groupValidationErrors(ordered);
    const changed = beforeValues.some((value, index) => String(value || '') !== String(afterValues[index] || ''));
    const hasValidationError = afterErrors.length > 0;
    return {
      ok: !changed && !hasValidationError && this._groupValuesFilled(ordered, rangeValues),
      clickedFieldId: clickResult.clickedFieldIds.join(','),
      clickedFieldIds: clickResult.clickedFieldIds,
      blankClickCount: clickResult.blankClickCount,
      dropdownOpenAfter: this._visibleDateDropdowns().length > 0,
      validationErrorsBefore: beforeErrors,
      validationErrorsAfter: afterErrors,
      reason: changed
        ? '日期校验点击后字段值发生变化'
        : (hasValidationError ? `日期组件仍显示校验错误：${afterErrors.join('；')}` : ''),
    };
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

  _groupIndex(field) {
    if (!field) return 0;
    if (Number.isInteger(field.groupIndex)) return field.groupIndex;
    const parsed = Number.parseInt(field.groupIndex, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  },

  async _waitForGroupValues(items, rangeValues) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this._groupValuesFilled(items, rangeValues)) return true;
      await new Promise(r => setTimeout(r, 80));
    }
    return false;
  },

  _groupValuesFilled(items, rangeValues) {
    return items.slice(0, 2).every((item, index) => {
      const current = this._targetValue(item.target);
      if (!current) return false;
      const candidates = this._optionCandidates(rangeValues[index]).map(value => this._normalizeOption(value));
      const normalized = this._normalizeOption(current);
      return candidates.some(candidate => candidate && normalized.includes(candidate));
    });
  },

  _targetValue(target) {
    if (!target) return '';
    if (typeof target.value !== 'undefined') return String(target.value || '').trim();
    if (target.textContent != null) return String(target.textContent || '').trim();
    return '';
  },

  async _commitRangeValidation(items, rangeValues) {
    const targets = (items || [])
      .slice(0, 2)
      .map(item => item && item.target)
      .filter(Boolean);
    if (targets.length === 0) return;

    for (const target of targets) {
      this._commitTarget(target);
      DOMUtils.fireInputEvents(target);
      try {
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
      await new Promise(r => setTimeout(r, 40));
    }

    this._closeVisiblePickers(targets[targets.length - 1]);
    await new Promise(r => setTimeout(r, 80));

    if (!this._groupValuesFilled(items, rangeValues)) return;
    targets.forEach(target => DOMUtils.fireInputEvents(target));
  },

  _commitTarget(target) {
    if (!target) return;
    try { target.focus(); } catch (_) {}
    try { target.blur(); } catch (_) {}
  },

  async _clickRangeForPostFillValidation(items) {
    const clickedFieldIds = [];
    let blankClickCount = 0;
    for (const item of (items || []).slice(0, 2)) {
      const target = item && item.target;
      if (!target) continue;
      this._clickForPostFillValidation(target);
      clickedFieldIds.push(item.fieldId || '');
      await new Promise(r => setTimeout(r, 140));
      this._commitTarget(target);
      DOMUtils.fireInputEvents(target);
      try {
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
      await new Promise(r => setTimeout(r, 60));
      if (this._clickBlankArea(target)) blankClickCount++;
      await new Promise(r => setTimeout(r, 140));
    }
    return { clickedFieldIds: clickedFieldIds.filter(Boolean), blankClickCount };
  },

  _clickForPostFillValidation(target) {
    if (!target) return;
    try {
      if (target.scrollIntoView) target.scrollIntoView({ block: 'center', inline: 'center' });
    } catch (_) {}
    try { target.click(); return; } catch (_) {}
    const eventInit = { bubbles: true, cancelable: true, view: window };
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try { target.dispatchEvent(new MouseEvent(type, eventInit)); } catch (_) {}
    }
  },

  _clickBlankArea(target) {
    try {
      if (target && target.blur) target.blur();
    } catch (_) {}

    const receiver = this._blankClickTarget();
    if (!receiver) return false;
    const eventInit = { bubbles: true, cancelable: true, view: window };
    for (const type of ['pointerdown', 'mousedown', 'mouseup']) {
      try { receiver.dispatchEvent(new MouseEvent(type, eventInit)); } catch (_) {}
    }
    try { receiver.click(); return true; } catch (_) {}
    try { receiver.dispatchEvent(new MouseEvent('click', eventInit)); } catch (_) {}
    return true;
  },

  _blankClickTarget() {
    const candidates = [
      document.body,
      document.documentElement,
    ].filter(Boolean);
    for (const item of candidates) {
      if (DOMUtils.isVisible(item)) return item;
    }
    return document.body || document.documentElement || null;
  },

  _groupValidationErrors(items) {
    const roots = new Set();
    for (const item of (items || []).slice(0, 2)) {
      const target = item && item.target;
      if (!target) continue;
      const wrapper = this._rangeWrapper(target);
      if (wrapper) roots.add(wrapper);
      const formItem = target.closest && target.closest(
        '[class*="formily-item"], [class*="FormilyItem"], [class*="form-item"], [class*="FormItem"], [class*="field-item"], [class*="FieldItem"]'
      );
      if (formItem) roots.add(formItem);
    }

    const errors = [];
    for (const root of roots) {
      const cls = root.className && typeof root.className === 'string' ? root.className : '';
      if (/(^|\s|_|-)(error|invalid|has-error|is-error)(\s|_|-|$)/i.test(cls)) {
        errors.push('组件处于错误状态');
      }
      const nodes = Array.from(root.querySelectorAll('[class*="error"], [class*="Error"], [class*="invalid"], [role="alert"]'))
        .filter(node => DOMUtils.isVisible(node));
      for (const node of nodes) {
        const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) errors.push(text);
      }
    }
    return Array.from(new Set(errors));
  },

  _closeVisiblePickers(target) {
    const receiver = target || document.activeElement || document.body;
    const receivers = [receiver, document, document.body].filter(Boolean);
    for (const item of receivers) {
      for (const type of ['keydown', 'keyup']) {
        try {
          item.dispatchEvent(new KeyboardEvent(type, {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true,
          }));
        } catch (_) {}
      }
    }
    try {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    } catch (_) {}
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try {
        document.body.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
      } catch (_) {}
    }
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

    if (await this._fillMonthRangeViaPicker(target, rangeValues)) {
      DOMUtils.fireInputEvents(target);
      return true;
    }

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

  async _fillMonthRangeViaPicker(target, rangeValues) {
    const parts = rangeValues
      .slice(0, 2)
      .map(value => this._dateParts(value));
    if (parts.length < 2 || parts.some(item => !item)) return false;

    let clicked = 0;
    for (const [year, month] of parts) {
      const panel = await this._moveMonthPickerToYear(parseInt(year, 10));
      if (!panel) return false;

      const option = this._monthOption(panel, parseInt(month, 10));
      if (!option) return false;

      this._clickOption(option);
      clicked++;
      await new Promise(r => setTimeout(r, 220));

      if (clicked >= 2 && this._rangeTargetsMatchValues(target, rangeValues)) return true;
      if (clicked === 1 && !this._visibleMonthPickerPanel()) {
        const targets = this._rangeEndpointTargets(target);
        const endTarget = targets[1];
        if (endTarget) {
          try { endTarget.click(); } catch (_) {}
          try { endTarget.focus(); } catch (_) {}
          await new Promise(r => setTimeout(r, 180));
        }
      }
    }

    return clicked >= 2 && this._rangeTargetsMatchValues(target, rangeValues);
  },

  async _moveMonthPickerToYear(targetYear) {
    if (!Number.isFinite(targetYear)) return null;

    for (let attempt = 0; attempt < 24; attempt++) {
      const panel = this._visibleMonthPickerPanel();
      if (!panel) return null;

      const currentYear = this._pickerDisplayedYear(panel);
      if (!Number.isFinite(currentYear)) return null;
      if (currentYear === targetYear) return panel;

      const nav = this._pickerYearNavButtons(panel);
      const button = currentYear > targetYear ? nav.prev : nav.next;
      if (!button) return null;

      this._clickOption(button);
      await new Promise(r => setTimeout(r, 160));
    }

    return null;
  },

  _visibleMonthPickerPanel() {
    return this._visibleDateDropdowns()
      .filter(dropdown => this._looksLikeMonthPicker(dropdown))
      .sort((a, b) => this._monthPickerRank(a) - this._monthPickerRank(b))[0] || null;
  },

  _looksLikeMonthPicker(dropdown) {
    if (!dropdown) return false;
    if (!Number.isFinite(this._pickerDisplayedYear(dropdown))) return false;
    return this._monthOptions(dropdown).length >= 6;
  },

  _monthPickerRank(dropdown) {
    const cls = dropdown.className && typeof dropdown.className === 'string' ? dropdown.className : '';
    if (/date-range-picker-panel|picker-dropdown|picker-panel/i.test(cls)) return 0;
    if (/dropdown/i.test(cls)) return 1;
    return 2;
  },

  _pickerDisplayedYear(panel) {
    const yearNode = Array.from(panel.querySelectorAll('[class*="header-btn"], [class*="header"], [aria-label], [title], span, button'))
      .filter(item => DOMUtils.isVisible(item))
      .find(item => /\b\d{4}\s*年\b/.test(this._optionText(item)));
    const text = this._optionText(yearNode || panel);
    const matched = text.match(/(\d{4})\s*年/);
    return matched ? parseInt(matched[1], 10) : NaN;
  },

  _pickerYearNavButtons(panel) {
    const raw = Array.from(panel.querySelectorAll('button, [role="button"], [class*="header-icon"], [class*="prev"], [class*="next"]'))
      .filter(item => DOMUtils.isVisible(item))
      .filter(item => !this._isDisabledOption(item))
      .filter(item => {
        const cls = item.className && typeof item.className === 'string' ? item.className : '';
        return !/collapse|clear|close/i.test(cls);
      });

    const byClass = (pattern) => raw.find(item => {
      const cls = item.className && typeof item.className === 'string' ? item.className : '';
      const text = this._optionText(item);
      return pattern.test(`${cls} ${text}`);
    });
    const sorted = raw
      .filter(item => {
        const rect = item.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

    return {
      prev: byClass(/prev|previous|left|back|上一|前/i) || sorted[0] || null,
      next: byClass(/next|right|forward|下一|后/i) || sorted[sorted.length - 1] || null,
    };
  },

  _monthOptions(panel) {
    const preferred = Array.from(panel.querySelectorAll(
      '[class*="month-panel-cell"], [data-value], [title], [aria-label], [role="gridcell"]'
    ))
      .filter(item => DOMUtils.isVisible(item))
      .filter(item => !this._isDisabledOption(item))
      .filter(item => this._optionText(item));

    const options = preferred.length ? preferred : this._dateOptions(panel);
    return options.filter(item => this._monthFromOption(item) != null);
  },

  _monthOption(panel, month) {
    const wanted = Math.min(Math.max(parseInt(month, 10), 1), 12);
    const options = this._monthOptions(panel)
      .map((item, index) => ({
        item,
        index,
        month: this._monthFromOption(item),
        textLength: this._optionText(item).length,
      }))
      .filter(entry => entry.month === wanted);
    if (!options.length) return null;

    options.sort((a, b) => {
      const aRoot = this._isMonthCellRoot(a.item) ? 0 : 1;
      const bRoot = this._isMonthCellRoot(b.item) ? 0 : 1;
      return aRoot - bRoot || a.textLength - b.textLength || a.index - b.index;
    });
    return options[0].item;
  },

  _monthFromOption(item) {
    const text = this._optionText(item);
    const dataValue = item.getAttribute && item.getAttribute('data-value');
    const raw = [dataValue, text].filter(Boolean).join(' ');
    const full = raw.match(/\d{4}[-/.年]\s*(\d{1,2})(?:\s*月)?/);
    const month = full || raw.match(/(^|[^\d])0?(\d{1,2})\s*月($|[^\d])/);
    if (!month) return null;
    const value = parseInt(month[1] && full ? month[1] : month[2], 10);
    return value >= 1 && value <= 12 ? value : null;
  },

  _isMonthCellRoot(item) {
    const cls = item.className && typeof item.className === 'string' ? item.className : '';
    return /month-panel-cell/i.test(cls);
  },

  _clickOption(item) {
    try { item.click(); return; } catch (_) {}
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try {
        item.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch (_) {}
    }
  },

  _rangeEndpointTargets(target) {
    const wrapper = this._rangeWrapper(target);
    if (!wrapper) return [target].filter(Boolean);
    return Array.from(wrapper.querySelectorAll(
      'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"]'
    ));
  },

  _rangeWrapper(target) {
    if (!target || !target.closest) return null;
    return target.closest(
      '[class*="date-range-picker-wrapper"], [class*="picker-range"], [class*="range-picker"], [class*="ant-picker-range"], [class*="date-range-picker"]'
    );
  },

  _rangeTargetsMatchValues(target, rangeValues) {
    const targets = this._rangeEndpointTargets(target);
    if (targets.length >= 2) {
      return targets.slice(0, 2).every((item, index) => {
        const current = this._targetValue(item);
        if (!current) return false;
        const normalized = this._normalizeOption(current);
        const candidates = this._optionCandidates(rangeValues[index]).map(value => this._normalizeOption(value));
        return candidates.some(candidate => candidate && normalized.includes(candidate));
      });
    }
    return this._matchesRangeValue(target, rangeValues);
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
