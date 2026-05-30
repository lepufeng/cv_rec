var FillEngine = {
  INTERVAL_MS: 50,
  MAX_RETRIES: 1,

  handlers: [TextHandler, SelectHandler, DateHandler, ChoiceHandler, UploadHandler],

  skipped: [],
  fillRecords: [],
  dateGroupsForValidation: [],

  reset() {
    this.skipped = [];
    this.fillRecords = [];
    this.dateGroupsForValidation = [];
  },

  async fillAll(mappings, fields) {
    this.skipped = [];
    this.fillRecords = [];
    this.dateGroupsForValidation = [];
    const entries = this._orderedEntries(mappings, fields);
    const fieldsById = new Map((fields || []).map(field => [field.fieldId, field]));
    const valueById = new Map(entries);
    const handledFieldIds = new Set();
    let filled = 0;

    for (let i = 0; i < entries.length; i++) {
      const [fieldId, value] = entries[i];
      const knownField = fieldsById.get(fieldId);
      if (handledFieldIds.has(fieldId)) continue;

      if (i > 0) {
        await new Promise(r => setTimeout(r, this.INTERVAL_MS));
      }

      const dateGroupResult = await this._tryFillDateGroup(
        fieldId,
        knownField,
        fields || [],
        valueById,
        handledFieldIds
      );
      if (dateGroupResult) {
        filled += dateGroupResult.filled;
        continue;
      }

      const el = this._findElement(fieldId);
      if (!el) {
        this.skipped.push(this._skipRecord(fieldId, knownField, null, value, `未找到元素 ${fieldId}`));
        continue;
      }

      const field = knownField || { fieldId, type: this._detectType(el) };
      const beforeValue = this._readElementValue(el, field);
      const safety = this._safeToFill(el, field, value);
      if (!safety.ok) {
        if (safety.alreadyFilled) {
          this.fillRecords.push(this._fillRecord(
            fieldId,
            field,
            el,
            value,
            beforeValue,
            beforeValue,
            'already_filled',
            { reason: safety.reason }
          ));
          filled++;
          continue;
        }
        this.skipped.push(this._skipRecord(fieldId, field, el, value, safety.reason));
        continue;
      }

      const handler = this.handlers.find(h => h.canHandle(field));
      if (!handler) {
        this.skipped.push(this._skipRecord(
          fieldId,
          field,
          el,
          value,
          `不支持的控件类型: ${field.type || el.type || el.tagName}`
        ));
        continue;
      }

      let success = await handler.fill(el, value, field);

      if (!success && !this._isFileControl(el, field)) {
        // Fallback: write through the native setter so frameworks like
        // React / Vue don't reset our value on the next render.
        try {
          el.focus();
          const str = value == null ? '' : String(value);
          if (el.hasAttribute && el.hasAttribute('contenteditable')) {
            el.textContent = str;
          } else if (typeof el.value !== 'undefined') {
            DOMUtils.setNativeValue(el, str);
          }
          DOMUtils.fireInputEvents(el);
          try { el.blur(); } catch (_) {}
          success = (el.value === str) || (el.textContent === str);
        } catch (_) {
          success = false;
        }
      }

      if (!success) {
        this.skipped.push(this._skipRecord(fieldId, field, el, value, '设置值失败'));
        continue;
      }

      this.fillRecords.push(this._fillRecord(
        fieldId,
        field,
        el,
        value,
        beforeValue,
        this._readElementValue(el, field),
        'filled'
      ));
      filled++;
    }

    await this._validateFilledDateGroups();

    return { filled, skipped: this.skipped, fillRecords: this.fillRecords, filledRecords: this.fillRecords };
  },

  async _tryFillDateGroup(fieldId, knownField, fields, valueById, handledFieldIds) {
    const groupFields = this._dateGroupFields(fieldId, knownField, fields, valueById, handledFieldIds);
    if (!groupFields || typeof DateHandler === 'undefined' || typeof DateHandler.fillGroup !== 'function') {
      return null;
    }

    const items = [];
    for (const field of groupFields) {
      const value = valueById.get(field.fieldId);
      const el = this._findElement(field.fieldId);
      if (!el) return null;
      const safety = this._safeToFill(el, field, value);
      if (!safety.ok && !safety.alreadyFilled) return null;
      items.push({ fieldId: field.fieldId, field, el, value, alreadyFilled: !!safety.alreadyFilled });
    }

    const beforeValues = items.map(item => this._readElementValue(item.el, item.field));
    const success = await DateHandler.fillGroup(items);
    const afterValues = items.map(item => this._readElementValue(item.el, item.field));
    groupFields.forEach(field => handledFieldIds.add(field.fieldId));
    const reason = this._dateGroupFailureReason(items);
    this.fillRecords.push(this._dateGroupFillRecord(items, beforeValues, afterValues, success, reason));
    if (success) {
      this.dateGroupsForValidation.push({ items });
      return { filled: groupFields.length };
    }

    for (const item of items) {
      this.skipped.push(this._skipRecord(item.fieldId, item.field, item.el, item.value, reason || '设置值失败'));
    }
    return { filled: 0 };
  },

  async _validateFilledDateGroups() {
    if (!this.dateGroupsForValidation.length) return;
    if (!this._shouldPostValidateDateGroups()) return;
    if (typeof DateHandler === 'undefined' || typeof DateHandler.validateFilledGroup !== 'function') return;

    for (const group of this.dateGroupsForValidation) {
      const items = group.items || [];
      const beforeValues = items.map(item => this._readElementValue(item.el, item.field));
      const result = await DateHandler.validateFilledGroup(items);
      const afterValues = items.map(item => this._readElementValue(item.el, item.field));
      this.fillRecords.push(this._dateGroupValidationRecord(items, beforeValues, afterValues, result));
    }
  },

  _shouldPostValidateDateGroups() {
    const host = String((typeof location !== 'undefined' && location.hostname) || '').toLowerCase();
    return /(^|\.)xiaopeng\./.test(host) || /(^|\.)xpeng\./.test(host);
  },

  _dateGroupFailureReason(items) {
    if (!Array.isArray(items) || items.length === 0) return '';
    const missing = [];
    for (const item of items) {
      const target = typeof DateHandler !== 'undefined' && DateHandler._editableTarget
        ? DateHandler._editableTarget(item.el)
        : item.el;
      const current = this._currentFillValue(target, item.field);
      if (current && !this._isPlaceholderLikeValue(current)) continue;
      const index = this._intFieldProp(item.field, 'groupIndex');
      if (index === 0) missing.push('开始');
      else if (index === 1) missing.push('结束');
      else missing.push(`第 ${index + 1} 项`);
    }
    return missing.length ? `日期范围未完整填入：${missing.join('、')}为空` : '';
  },

  _dateGroupFields(fieldId, field, fields, valueById, handledFieldIds) {
    if (!field || !Array.isArray(fields) || !this._isDateGroupField(field)) return null;
    const groupIndex = this._intFieldProp(field, 'groupIndex');
    const groupSize = this._intFieldProp(field, 'groupSize');
    if (groupIndex !== 0 || groupSize !== 2) return null;

    const groupCandidates = field.groupId
      ? fields.filter(item => item && item.groupId === field.groupId)
      : [];
    const container = this._dateGroupContainer(field);
    const containerCandidates = container
      ? fields.filter(item => {
        const el = item && this._findElement(item.fieldId);
        return el && container.contains(el);
      })
      : [];

    let candidates = groupCandidates;
    let usingContainerCandidates = false;
    if (containerCandidates.length >= 2) {
      candidates = containerCandidates;
      usingContainerCandidates = true;
    }

    if (candidates.length < 2) {
      if (field.widget === 'date-range') return null;
      const start = fields.findIndex(item => item && item.fieldId === fieldId);
      if (start < 0) return null;
      candidates = this._adjacentDateFallbackFields(fields, start, field, groupSize);
      if (!candidates) return null;
    }

    const label = this._normalizeGroupLabel(field.label || field.placeholder || field.subLabel);
    const grouped = candidates
      .filter(item => item && item.fieldId)
      .filter(item => valueById.has(item.fieldId))
      .filter(item => !handledFieldIds.has(item.fieldId))
      .filter(item => this._isDateGroupField(item))
      .filter(item => {
        if (!usingContainerCandidates && item.groupId && field.groupId) return item.groupId === field.groupId;
        if (this._intFieldProp(item, 'groupSize') !== groupSize) return false;
        const itemLabel = this._normalizeGroupLabel(item.label || item.placeholder || item.subLabel);
        return !label || !itemLabel || itemLabel === label;
      })
      .map((item, domIndex) => ({
        item,
        domIndex,
        groupIndex: this._intFieldProp(item, 'groupIndex'),
      }))
      .filter(entry => entry.groupIndex >= 0)
      .sort((a, b) => a.groupIndex - b.groupIndex || a.domIndex - b.domIndex);

    if (grouped.length < 2) return null;
    if (!grouped.some(entry => entry.item.fieldId === fieldId)) return null;
    if (!grouped.some(entry => entry.groupIndex === 1)) return null;

    return grouped.slice(0, groupSize).map(entry => entry.item);
  },

  _adjacentDateFallbackFields(fields, start, field, groupSize) {
    const candidates = fields.slice(start, start + groupSize);
    if (candidates.length < groupSize) return null;
    if (!candidates.every(item => item && item.fieldId && this._isDateGroupField(item))) return null;
    const indexes = candidates.map(item => this._intFieldProp(item, 'groupIndex'));
    if (indexes[0] !== 0 || indexes[1] !== 1) return null;
    if (!candidates.every(item => this._intFieldProp(item, 'groupSize') === groupSize)) return null;

    const baseLabel = this._normalizeGroupLabel(field.label || field.placeholder || field.subLabel);
    const sameLabel = candidates.every(item => {
      const itemLabel = this._normalizeGroupLabel(item.label || item.placeholder || item.subLabel);
      return !baseLabel || !itemLabel || itemLabel === baseLabel;
    });
    if (!sameLabel) return null;

    const repeatKeys = ['repeatSection', 'repeatIndex', 'repeatGroupId'];
    const sameRepeatScope = candidates.every(item => repeatKeys.every(key => {
      const base = field && field[key];
      const other = item && item[key];
      return base === undefined || base === null || other === undefined || other === null || base === other;
    }));
    return sameRepeatScope ? candidates : null;
  },

  _dateGroupContainer(field) {
    if (!field || !field.fieldId) return null;
    const el = this._findElement(field.fieldId);
    if (!el) return null;
    if (typeof FieldScanner !== 'undefined' && FieldScanner._findDateRangeContainer) {
      const container = FieldScanner._findDateRangeContainer(el);
      if (container) return container;
    }
    if (typeof DateHandler !== 'undefined' && DateHandler._rangeWrapper) {
      const wrapper = DateHandler._rangeWrapper(el);
      if (wrapper) return wrapper;
    }
    return el.closest && el.closest(
      '[class*="date-range-picker-wrapper"], [class*="picker-range"], [class*="range-picker"], [class*="ant-picker-range"], [class*="date-range-picker"]'
    );
  },

  _isDateGroupField(field) {
    if (!field) return false;
    return field.type === 'date' || field.widget === 'date-picker' || field.widget === 'date-range';
  },

  _intFieldProp(field, key) {
    const value = field && field[key];
    if (Number.isInteger(value)) return value;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : -1;
  },

  _normalizeGroupLabel(value) {
    return String(value || '')
      .replace(/[：:*＊\s]/g, '')
      .trim()
      .toLowerCase();
  },

  _orderedEntries(mappings, fields) {
    const rawEntries = Object.entries(mappings || {});
    if (!Array.isArray(fields) || fields.length === 0) return rawEntries;

    const byId = new Map(rawEntries);
    const ordered = [];
    const used = new Set();

    for (const field of fields) {
      const fieldId = field && field.fieldId;
      if (!fieldId || !byId.has(fieldId) || used.has(fieldId)) continue;
      ordered.push([fieldId, byId.get(fieldId)]);
      used.add(fieldId);
    }

    for (const entry of rawEntries) {
      if (!used.has(entry[0])) ordered.push(entry);
    }
    return ordered;
  },

  _findElement(fieldId) {
    // Try the scanner's element map first (for auto-generated IDs)
    if (FieldScanner._elementMap && FieldScanner._elementMap.has(fieldId)) {
      return FieldScanner._elementMap.get(fieldId);
    }
    const byId = document.getElementById(fieldId);
    if (byId) return byId;
    const byDeepId = DOMUtils.querySelectorDeep(`#${CSS.escape(fieldId)}`);
    if (byDeepId) return byDeepId;
    const byName = DOMUtils.querySelectorDeep(`[name="${CSS.escape(fieldId)}"]`);
    if (byName) return byName;
    const byData = DOMUtils.querySelectorDeep(`[data-field="${CSS.escape(fieldId)}"]`);
    return byData;
  },

  _detectType(el) {
    return DOMUtils.detectType(el);
  },

  _getLabel(el) {
    if (el.labels && el.labels.length > 0) return el.labels[0].textContent.trim();
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    let prev = el.previousElementSibling;
    if (prev) return prev.textContent.trim();
    return el.name || el.id || '';
  },

  _safeToFill(el, field, value) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return { ok: false, reason: '字段已禁用' };
    }
    if (this._isFileControl(el, field)) {
      if (!this._hasUploadPayload(value)) {
        return { ok: false, reason: '文件上传缺少后端授权文件' };
      }
      if (el.files && el.files.length > 0) {
        return { ok: false, reason: '文件上传字段已有文件，跳过自动覆盖', alreadyFilled: true };
      }
      return { ok: true };
    }
    if (!DOMUtils.isVisible(el)) {
      return { ok: false, reason: '字段当前不可见' };
    }
    if (this._isPlainReadonlyField(el, field)) {
      return { ok: false, reason: '字段为只读，跳过自动覆盖' };
    }
    const existing = this._currentFillValue(el, field);
    if (existing && !this._isPlaceholderLikeValue(existing)) {
      if (this._valuesEquivalent(existing, value, field)) {
        return { ok: false, reason: '字段已有相同值', alreadyFilled: true };
      }
      return { ok: false, reason: '字段已有值，跳过自动覆盖' };
    }
    return { ok: true };
  },

  _currentFillValue(el, field) {
    if (field && field.currentValue) return String(field.currentValue).trim();

    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'select') {
      return Array.from(el.selectedOptions || [])
        .map(opt => (opt.textContent || opt.value || '').trim())
        .filter(Boolean)
        .join('、');
    }

    const type = (el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      return el.checked ? (this._getLabel(el) || el.value || 'on').trim() : '';
    }
    if (el.hasAttribute && el.hasAttribute('contenteditable')) {
      return (el.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return typeof el.value === 'string' ? el.value.trim() : '';
  },

  _readElementValue(el, field) {
    const target = typeof DateHandler !== 'undefined' && DateHandler._editableTarget
      ? DateHandler._editableTarget(el)
      : el;
    const liveField = field ? { ...field } : field;
    if (liveField && Object.prototype.hasOwnProperty.call(liveField, 'currentValue')) {
      delete liveField.currentValue;
    }
    return this._currentFillValue(target, liveField);
  },

  _isPlaceholderLikeValue(value) {
    const normalized = this._normalizeComparableValue(value);
    if (!normalized) return true;
    return [
      '请选择', '请选择一项', '请选择一个选项', '选择', '未选择', '暂无',
      '请输入', '请填写', 'select', 'please select', 'choose', 'please choose',
      '-', '--',
    ].includes(normalized);
  },

  _valuesEquivalent(existing, target, field) {
    const existingNorm = this._normalizeComparableValue(existing);
    const targetNorm = this._normalizeComparableValue(target);
    if (!existingNorm || !targetNorm) return false;
    if (existingNorm === targetNorm) return true;
    return this._optionValueMatchesExistingLabel(existingNorm, targetNorm, field);
  },

  _normalizeComparableValue(value) {
    if (value === undefined || value === null) return '';
    const raw = Array.isArray(value) ? value.join('、') : String(value);
    return raw
      .replace(/\s+/g, ' ')
      .replace(/[，,；;|/]+/g, '、')
      .trim()
      .toLowerCase();
  },

  _optionValueMatchesExistingLabel(existingNorm, targetNorm, field) {
    const options = [];
    if (field && Array.isArray(field.optionObjects)) options.push(...field.optionObjects);
    if (field && Array.isArray(field.options)) options.push(...field.options);

    return options.some(option => {
      const label = typeof option === 'object' && option !== null
        ? option.label
        : option;
      const optionValue = typeof option === 'object' && option !== null
        ? (option.value || option.label)
        : option;
      const labelNorm = this._normalizeComparableValue(label);
      const valueNorm = this._normalizeComparableValue(optionValue);
      return existingNorm === labelNorm && targetNorm === valueNorm;
    });
  },

  _isPlainReadonlyField(el, field) {
    if (!this._isReadonly(el, field)) return false;
    if (!this._isTextLikeControl(el, field)) return false;
    return !this._hasReadonlyWidgetAffordance(el, field);
  },

  _isReadonly(el, field) {
    if (field && field.readonly === true) return true;
    if (el.readOnly === true) return true;
    if (el.getAttribute && el.getAttribute('readonly') !== null) return true;
    return el.getAttribute && el.getAttribute('aria-readonly') === 'true';
  },

  _isTextLikeControl(el, field) {
    const tag = (el.tagName || '').toLowerCase();
    const htmlType = (el.type || '').toLowerCase();
    const fieldType = field && field.type;
    const widget = field && field.widget;

    if (widget === 'textarea' || widget === 'contenteditable' || widget === 'text-input') return true;
    if (tag === 'textarea') return true;
    if (el.hasAttribute && el.hasAttribute('contenteditable')) return true;
    if (tag !== 'input') return false;
    if (fieldType === 'textarea' || fieldType === 'text') return true;
    return !htmlType || ['text', 'email', 'tel', 'number', 'url', 'search', 'password'].includes(htmlType);
  },

  _hasReadonlyWidgetAffordance(el, field) {
    const fieldType = field && field.type;
    const widget = field && field.widget;
    const widgetAllowsReadonly = [
      'native-select',
      'aria-combobox',
      'search-select',
      'cascader',
      'pseudo-radio',
      'date-picker',
      'date-range',
    ];

    if (widgetAllowsReadonly.includes(widget)) return true;
    if (fieldType === 'date' || fieldType === 'radio' || fieldType === 'checkbox') return true;
    if (widget !== 'custom-dropdown' && fieldType !== 'select') return false;
    if (this._hasPopupRole(el)) return true;
    if (this._hasWidgetClassHint(el)) return true;
    if (typeof FieldScanner !== 'undefined') {
      if (FieldScanner._hasSelectWrapper && FieldScanner._hasSelectWrapper(el)) return true;
      if (FieldScanner._hasNearbyIcon && FieldScanner._DROPDOWN_ARROW_SELECTOR &&
          FieldScanner._hasNearbyIcon(el, FieldScanner._DROPDOWN_ARROW_SELECTOR)) {
        return true;
      }
    }
    return false;
  },

  _hasPopupRole(el) {
    const role = (el.getAttribute && el.getAttribute('role') || '').toLowerCase();
    const popup = (el.getAttribute && el.getAttribute('aria-haspopup') || '').toLowerCase();
    return ['combobox', 'listbox'].includes(role) || ['listbox', 'list', 'tree'].includes(popup);
  },

  _hasWidgetClassHint(el) {
    let node = el;
    for (let depth = 0; node && depth < 6; depth++) {
      const className = typeof node.className === 'string' ? node.className : '';
      const tokens = className.split(/\s+/).filter(Boolean);
      if (tokens.some(token => /(^|[-_])(select|dropdown|picker|cascader|combobox|autocomplete)([-_]|$)/i.test(token))) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  },

  _isFileControl(el, field) {
    const htmlType = (el && el.type || '').toLowerCase();
    return (field && field.type === 'file') || (field && field.widget === 'file-upload') || htmlType === 'file';
  },

  _hasUploadPayload(value) {
    if (!value || typeof value !== 'object') return false;
    return !!(value.dataBase64 || value.resumeId || value.resume_id || value.id);
  },

  _skipRecord(fieldId, field, el, value, reason) {
    const record = { fieldId, reason };
    const label = field && (field.label || field.placeholder || field.subLabel)
      || (el ? this._getLabel(el) : '');
    const type = field && field.type || (el ? this._detectType(el) : '');

    if (label) record.label = label;
    if (type) record.type = type;
    this._copyFieldProp(record, field, 'widget');
    this._copyFieldProp(record, field, 'section');
    this._copyFieldProp(record, field, 'repeatSection');
    this._copyFieldProp(record, field, 'repeatIndex');
    this._copyFieldProp(record, field, 'repeatSize');
    this._copyFieldProp(record, field, 'groupIndex');
    this._copyFieldProp(record, field, 'groupSize');
    this._copyFieldProp(record, field, 'subLabel');
    this._copyFieldProp(record, field, 'placeholder');
    if (field && field.required != null) record.required = !!field.required;
    record.attemptedValuePreview = this._valuePreview(value, field || { type });
    return record;
  },

  _fillRecord(fieldId, field, el, value, beforeValue, afterValue, status, extra) {
    const record = this._skipRecord(fieldId, field, el, value, '');
    delete record.reason;
    record.status = status || 'filled';
    record.beforeValue = this._valuePreview(beforeValue, field);
    record.afterValue = this._valuePreview(afterValue, field);
    record.element = this._elementSignature(el);
    if (extra && typeof extra === 'object') {
      Object.assign(record, extra);
    }
    return record;
  },

  _dateGroupFillRecord(items, beforeValues, afterValues, success, reason) {
    const first = items[0] || {};
    const firstField = first.field || {};
    const record = {
      kind: 'date_group',
      status: success ? 'filled' : 'failed',
      label: firstField.label || firstField.placeholder || firstField.subLabel || '日期范围',
      fieldIds: items.map(item => item.fieldId),
      groupValues: items.map(item => this._valuePreview(item.value, item.field)),
      beforeValues: beforeValues.map((value, index) => this._valuePreview(value, items[index] && items[index].field)),
      afterValues: afterValues.map((value, index) => this._valuePreview(value, items[index] && items[index].field)),
      items: items.map((item, index) => this._dateGroupItemRecord(item, beforeValues[index], afterValues[index])),
    };
    if (reason) record.reason = reason;
    this._copyFieldProp(record, firstField, 'section');
    this._copyFieldProp(record, firstField, 'repeatSection');
    this._copyFieldProp(record, firstField, 'repeatIndex');
    this._copyFieldProp(record, firstField, 'repeatSize');
    this._copyFieldProp(record, firstField, 'groupSize');
    const wrapper = first.el && this._dateGroupContainer(firstField);
    if (wrapper) record.container = this._elementSignature(wrapper);
    return record;
  },

  _dateGroupValidationRecord(items, beforeValues, afterValues, result) {
    const first = items[0] || {};
    const firstField = first.field || {};
    const changed = beforeValues.some((value, index) => String(value || '') !== String(afterValues[index] || ''));
    const record = {
      kind: 'date_group_validation',
      status: result && result.ok && !changed ? 'validated' : 'failed',
      label: firstField.label || firstField.placeholder || firstField.subLabel || '日期范围',
      fieldIds: items.map(item => item.fieldId),
      beforeValues: beforeValues.map((value, index) => this._valuePreview(value, items[index] && items[index].field)),
      afterValues: afterValues.map((value, index) => this._valuePreview(value, items[index] && items[index].field)),
      clickedFieldId: result && result.clickedFieldId || '',
      clickedFieldIds: result && Array.isArray(result.clickedFieldIds) ? result.clickedFieldIds : [],
      blankClickCount: result && Number.isFinite(result.blankClickCount) ? result.blankClickCount : 0,
      dropdownOpenAfter: !!(result && result.dropdownOpenAfter),
    };
    if (changed) record.reason = '日期校验点击后字段值发生变化';
    else if (result && result.reason) record.reason = result.reason;
    this._copyFieldProp(record, firstField, 'section');
    this._copyFieldProp(record, firstField, 'repeatSection');
    this._copyFieldProp(record, firstField, 'repeatIndex');
    this._copyFieldProp(record, firstField, 'repeatSize');
    this._copyFieldProp(record, firstField, 'groupSize');
    return record;
  },

  _dateGroupItemRecord(item, beforeValue, afterValue) {
    const field = item.field || {};
    const record = {
      fieldId: item.fieldId,
      attemptedValuePreview: this._valuePreview(item.value, field),
      beforeValue: this._valuePreview(beforeValue, field),
      afterValue: this._valuePreview(afterValue, field),
      element: this._elementSignature(item.el),
    };
    this._copyFieldProp(record, field, 'label');
    this._copyFieldProp(record, field, 'type');
    this._copyFieldProp(record, field, 'widget');
    this._copyFieldProp(record, field, 'section');
    this._copyFieldProp(record, field, 'repeatSection');
    this._copyFieldProp(record, field, 'repeatIndex');
    this._copyFieldProp(record, field, 'repeatSize');
    this._copyFieldProp(record, field, 'groupIndex');
    this._copyFieldProp(record, field, 'groupSize');
    this._copyFieldProp(record, field, 'subLabel');
    this._copyFieldProp(record, field, 'placeholder');
    if (field.required != null) record.required = !!field.required;
    return record;
  },

  _elementSignature(el) {
    if (!el) return '';
    const parts = [(el.tagName || '').toLowerCase()];
    if (el.id) parts.push(`#${el.id}`);
    const className = typeof el.className === 'string' ? el.className.trim() : '';
    if (className) parts.push(`.${className.split(/\s+/).slice(0, 5).join('.')}`);
    const name = el.getAttribute && el.getAttribute('name');
    if (name) parts.push(`[name="${name}"]`);
    return parts.join('').slice(0, 160);
  },

  _copyFieldProp(record, field, key) {
    if (!field) return;
    const value = field[key];
    if (value === undefined || value === null || value === '') return;
    record[key] = value;
  },

  _valuePreview(value, field) {
    if (field && field.type === 'file') return '[文件路径已隐藏]';
    if (value === undefined) return '';
    if (value === null) return 'null';
    const raw = Array.isArray(value) ? value.join(', ') : String(value);
    return raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
  },
};
