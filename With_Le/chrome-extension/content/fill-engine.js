var FillEngine = {
  INTERVAL_MS: 50,
  MAX_RETRIES: 1,

  handlers: [TextHandler, SelectHandler, DateHandler, ChoiceHandler, UploadHandler],

  skipped: [],

  reset() {
    this.skipped = [];
  },

  async fillAll(mappings, fields) {
    const entries = this._orderedEntries(mappings, fields);
    const fieldsById = new Map((fields || []).map(field => [field.fieldId, field]));
    let filled = 0;

    for (let i = 0; i < entries.length; i++) {
      const [fieldId, value] = entries[i];
      const knownField = fieldsById.get(fieldId);

      if (i > 0) {
        await new Promise(r => setTimeout(r, this.INTERVAL_MS));
      }

      const el = this._findElement(fieldId);
      if (!el) {
        this.skipped.push(this._skipRecord(fieldId, knownField, null, value, `未找到元素 ${fieldId}`));
        continue;
      }

      const field = knownField || { fieldId, type: this._detectType(el) };
      const safety = this._safeToFill(el, field);
      if (!safety.ok) {
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

      if (!success) {
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

      filled++;
    }

    return { filled, skipped: this.skipped };
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
    const byName = document.querySelector(`[name="${CSS.escape(fieldId)}"]`);
    if (byName) return byName;
    const byData = document.querySelector(`[data-field="${CSS.escape(fieldId)}"]`);
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

  _safeToFill(el, field) {
    const htmlType = (el.type || '').toLowerCase();
    if (field.type === 'file' || htmlType === 'file') {
      return { ok: false, reason: '文件上传需人工处理' };
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return { ok: false, reason: '字段已禁用' };
    }
    if (!DOMUtils.isVisible(el)) {
      return { ok: false, reason: '字段当前不可见' };
    }
    return { ok: true };
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
