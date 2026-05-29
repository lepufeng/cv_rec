var FieldScanner = {
  _elementMap: new Map(),

  _CONTROL_SELECTOR:
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select, [contenteditable="true"]',

  // ARIA wrappers worth treating as controls. Includes:
  //   - explicit selectable widgets: combobox / listbox / textbox / searchbox / spinbutton
  //   - popup-trigger elements that open a list-style picker. Standard
  //     `aria-haspopup="listbox"` covers most modern libs; `="list"` is the
  //     legacy Element UI flavour (Tencent join.qq.com's 个人证件 type
  //     selector and 国家/地区 picker both use it). `="tree"` covers
  //     tree-select and cascader. We deliberately don't include
  //     `aria-haspopup="true|menu|dialog"` because those cover page-level
  //     account/menu buttons that aren't form controls.
  _ARIA_SELECTOR:
    '[role="combobox"], [role="listbox"], [role="textbox"]:not([contenteditable]), [role="spinbutton"], [role="searchbox"], [aria-haspopup="listbox"], [aria-haspopup="list"], [aria-haspopup="tree"]',

  // Selectors for "pseudo radio / pick item" — clickable items grouped under
  // a parent that together act as a select control even though they aren't
  // real <input>s. Common on Element-UI-like or fully custom SPA forms (e.g.
  // Tencent Recruit's gender / yes-no buttons).
  _PSEUDO_ITEM_SELECTOR: [
    '[role="radio"]',
    '[class*="radio-item"]', '[class*="radioItem"]',
    '[class*="select-label"]:not(label)', '[class*="selectLabel"]:not(label)',
    '[class*="radio-label"]:not(label)', '[class*="radioLabel"]:not(label)',
    '[class*="picker-item"]', '[class*="pickerItem"]',
    '[class*="option-item"]', '[class*="optionItem"]',
    '[class*="select-item"]', '[class*="selectItem"]',
    '[class*="choice-item"]', '[class*="choiceItem"]',
    // Design systems wrap each radio/checkbox option in a <label>. The
    // wrapper class pattern differs across design systems — Ant Design uses
    // hyphens ("ant-radio-wrapper"), Feishu UD uses BEM double-underscores
    // ("ud__radio__wrapper"), Element UI uses single hyphens, etc. Match
    // any flavour that has the substring "radio" or "checkbox" plus "wrap".
    'label[class*="radio-wrapper"]', 'label[class*="radioWrapper"]',
    'label[class*="radio__wrapper"]', 'label[class*="radio_wrapper"]',
    'label[class*="checkbox-wrapper"]', 'label[class*="checkboxWrapper"]',
    'label[class*="checkbox__wrapper"]', 'label[class*="checkbox_wrapper"]',
    '[class*="radio-wrapper"]:not(label)', '[class*="radioWrapper"]:not(label)',
    '[class*="radio__wrapper"]:not(label)', '[class*="radio_wrapper"]:not(label)',
    '[class*="checkbox-wrapper"]:not(label)', '[class*="checkboxWrapper"]:not(label)',
    '[class*="checkbox__wrapper"]:not(label)', '[class*="checkbox_wrapper"]:not(label)',
  ].join(','),

  // Any text inside one of these subtrees is *never* considered a label.
  _LABEL_BLACKLIST_ANCESTOR: [
    'button', 'a', 'script', 'style', 'noscript', 'svg',
    '[role="button"]', '[role="option"]', '[role="radio"]', '[role="checkbox"]',
    '[role="tab"]', '[role="menuitem"]', '[role="link"]',
    // Already-selected / currently-active value displays:
    '[class*="selected"]', '[class*="Selected"]',
    '[class*="active"]', '[class*="Active"]',
    '[class*="value"]:not([class*="valid"])', '[class*="Value"]',
    // Buttons / chips / tags / dropdowns:
    '[class*="option"]', '[class*="Option"]',
    '[class*="tag"]', '[class*="Tag"]',
    '[class*="chip"]', '[class*="Chip"]',
    '[class*="radio"]', '[class*="Radio"]',
    '[class*="check"]:not([class*="checked-icon"])',
    '[class*="Check"]:not([class*="CheckedIcon"])',
    '[class*="btn"]', '[class*="Btn"]', '[class*="Button"]',
    '[class*="dropdown"]', '[class*="Dropdown"]',
    '[class*="select__"]', '[class*="Select__"]',
    '[class*="popover"]', '[class*="popper"]', '[class*="menu"]',
    '[class*="picker"]', '[class*="Picker"]',
    '[class*="delete"]', '[class*="Delete"]',
    '[class*="remove"]', '[class*="Remove"]',
    '[class*="upload"]', '[class*="Upload"]',
    '[class*="drag"]', '[class*="Drag"]',
    // Helper / hint / error / placeholder text. We narrow placeholder to
    // its BEM "element" form (double-underscore / hyphen) so we don't
    // accidentally match modifier classes like
    // "applyFormModuleWrapper-placeholder" — Feishu uses "placeholder" as
    // an empty-state state name on the whole module wrapper, and matching
    // that would silence every label in the work-experience card.
    '[class*="__placeholder"]', '[class*="-placeholder-"]',
    '[class*="input__placeholder"]', '[class*="inputPlaceholder"]',
    '[class*="hint"]', '[class*="Hint"]',
    '[class*="tip"]', '[class*="Tip"]',
    '[class*="help"]', '[class*="Help"]',
    '[class*="extra"]', '[class*="Extra"]',
    '[class*="explain"]', '[class*="Explain"]',
    '[class*="notice"]', '[class*="Notice"]',
    '[class*="warn"]', '[class*="Warn"]',
    '[class*="error"]', '[class*="Error"]',
    '[class*="message"]', '[class*="Message"]',
    '[class*="remark"]', '[class*="Remark"]',
    '[class*="desc"]', '[class*="Desc"]',
    '[class*="note"]:not([class*="notebook"])',
    '[class*="aside"]', '[class*="Aside"]',
    '[class*="suffix"]', '[class*="prefix"]',
    '[class*="addon"]',
    'header', 'nav', 'footer',
    '[class*="header"]', '[class*="nav"]', '[class*="footer"]',
    '[class*="topbar"]', '[class*="sidebar"]',
  ].join(','),

  _TITLE_SELECTOR: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'legend',
    '[class*="section-title"]', '[class*="sectionTitle"]',
    '[class*="step-title"]', '[class*="stepTitle"]',
    '[class*="card-title"]', '[class*="cardTitle"]',
    '[class*="block-title"]', '[class*="blockTitle"]',
    '[class*="part-title"]', '[class*="partTitle"]',
    '[class*="group-title"]', '[class*="groupTitle"]',
    '[class*="module-title"]', '[class*="moduleTitle"]',
    '[class*="panel-title"]', '[class*="panelTitle"]',
    '[class*="form-title"]', '[class*="formTitle"]',
    '[class*="page-title"]', '[class*="pageTitle"]',
    '[class*="sub-title"]', '[class*="subTitle"]',
    '[class*="header-title"]', '[class*="headerTitle"]',
    '[class*="atsx-title"]', '[class*="atsxTitle"]',
    '[class*="moka-title"]', '[class*="mokaTitle"]',
    '[class*="beisen-title"]', '[class*="beisenTitle"]',
    '[data-section-title]',
  ].join(','),

  // Icons / decorations that hint a control opens a popup. We look for these
  // in the per-field neighborhood to decide whether a plain <input> is
  // actually a custom dropdown / date picker / cascader.
  _DROPDOWN_ARROW_SELECTOR: [
    'svg[class*="arrow"]', 'svg[class*="Arrow"]',
    'svg[class*="caret"]', 'svg[class*="Caret"]',
    'svg[class*="chevron"]', 'svg[class*="Chevron"]',
    'i[class*="arrow"]', 'i[class*="Arrow"]',
    'i[class*="caret"]', 'i[class*="Caret"]',
    'i[class*="chevron"]', 'i[class*="Chevron"]',
    'i[class*="down"]:not([class*="download"])', 'i[class*="Down"]:not([class*="Download"])',
    '[class*="suffix-icon"]', '[class*="suffixIcon"]',
    '[class*="select-icon"]', '[class*="selectIcon"]',
    '[class*="dropdown-icon"]', '[class*="dropdownIcon"]',
  ].join(','),

  _DATE_ICON_SELECTOR: [
    'svg[class*="calendar"]', 'svg[class*="Calendar"]',
    'svg[class*="date"]:not([class*="updated"])', 'svg[class*="Date"]:not([class*="Updated"])',
    'svg[class*="rili"]', 'svg[class*="Rili"]',
    'svg[data-icon-id*="calendar" i]', 'svg[data-icon-id*="date" i]', 'svg[data-icon-id*="rili" i]',
    'svg[data-icon-name*="calendar" i]', 'svg[data-icon-name*="date" i]', 'svg[data-icon-name*="rili" i]',
    'svg[aria-label*="calendar" i]', 'svg[aria-label*="日期"]', 'svg[aria-label*="日历"]',
    'i[class*="calendar"]', 'i[class*="Calendar"]',
    'i[class*="date"]:not([class*="updated"])', 'i[class*="Date"]:not([class*="Updated"])',
    'i[class*="rili"]',
    'i[class*="iconfont"][class*="rili"]', 'i[class*="iconfont"][class*="calendar"]',
    'i[class*="iconfont"][class*="date"]:not([class*="updated"])',
    '[class*="calendar-icon"]', '[class*="calendarIcon"]',
    '[class*="date-icon"]', '[class*="dateIcon"]',
    '[aria-label*="选择日期"]', '[aria-label*="日历"]', '[aria-label*="calendar" i]',
  ].join(','),

  _DATE_HINT_CLASS: /(date-?picker|date-?range|calendar|time-?picker|year-?picker|month-?picker)/i,

  // Last-resort date detection: when no structural signal (HTML5 type / icon
  // / class hint) fires, check the resolved label for date keywords. Labels
  // are semantic and far more reliable than placeholders. Sites like
  // Feishu / Xiaopeng render their date pickers as plain <input type="text">
  // with no icon and no telltale class, so this fallback is the only way
  // to tag them correctly.
  _DATE_LABEL_REGEX: /时间|日期|年月|出生|入学|毕业|入职|离职|任职|\bdate\b|\bdatetime\b|\bcalendar\b|\bdeadline\b/i,
  // Words that contain "时" or "日" but are NOT dates (durations, counts).
  _DATE_LABEL_NEGATIVE: /时长|天数|月数|周数|年限|期限|duration|days?\b|weeks?\b/i,

  // Framework-level attributes that carry the field's display label directly
  // on the control. Feishu UD's Formily (used by jobs.bytedance.com, Feishu
  // 招聘 / xiaopeng.jobs.feishu.cn, and other sites on the Feishu hiring
  // platform) writes the i18n-resolved display name onto the input as
  // `data-form-field-i18n-name="姓名"`. Many forms wrap the input in an
  // unnamed <label> that swallows `el.labels[0]`, leaving no segment text
  // either when the placeholder isn't rendered into DOM — so segment-based
  // resolution can't see anything. Reading the attribute is both more
  // reliable AND framework-generic (it's a Formily convention, not a site
  // hack). Order: most specific first.
  _LABEL_DATA_ATTRS: [
    'data-form-field-i18n-name',
    'data-i18n-name',
    'data-display-name',
    'data-label-text',
    'data-field-label',
    'data-moka-label',
    'data-moka-field',
    'data-beisen-label',
    'data-beisen-field',
  ],

  _CASCADER_HINT_CLASS: /(cascader|cascade|tree-?select)/i,
  _SEARCH_HINT_CLASS: /(search|filter|auto-?complete|combo)/i,

  MAX_LABEL_LEN: 40,
  MAX_OPTION_LEN: 30,
  ICON_SEARCH_RADIUS: 3, // levels of ancestors to search for nearby icons

  _resetMap() {
    this._elementMap.clear();
  },

  scan() {
    this._resetMap();

    // 1. Collect every "control" we want to surface, in document order.
    const controls = this._collectAllControls();
    const controlSet = new Set(controls);

    // 2. One DOM walk: build a flat sequence of (control | text) items in
    //    document order. Text nodes inside any control are dropped (they'd
    //    duplicate / pollute the segments).
    const items = this._buildItemSequence(controlSet);

    // 3. Segment-based label assignment + describe each control.
    const fields = [];
    let prevCtrlIndex = -1;
    let lastLabel = '';

    for (let i = 0; i < items.length; i++) {
      if (items[i].type !== 'ctrl') continue;
      const ctrl = items[i].node;

      let fieldId = this._generateId(ctrl);
      if (this._elementMap.has(fieldId)) {
        fieldId = `${fieldId}_${Math.random().toString(36).slice(2, 5)}`;
      }
      this._elementMap.set(fieldId, ctrl);

      const segLabel = this._labelFromSegment(items, prevCtrlIndex, i);
      const label = this._resolveLabel(ctrl, segLabel, lastLabel);
      const widget = this._detectWidget(ctrl, label);
      const options = this._extractOptions(ctrl);

      const field = {
        fieldId,
        type: this._typeFromWidget(widget),
        widget,
        label,
        placeholder: ctrl.placeholder || ctrl.getAttribute('placeholder') || '',
        options,
        enumerable: this._isEnumerable(widget, options),
        required: this._isRequired(ctrl),
        section: this._detectSection(ctrl),
      };

      // Optional input constraints — only emit when present so that simple
      // text fields stay slim.
      const constraints = this._extractConstraints(ctrl);
      Object.assign(field, constraints);

      fields.push(field);

      if (label) lastLabel = label;
      prevCtrlIndex = i;
    }

    // 4. Post-process: detect form-item groups (multiple controls inside the
    //    same per-field container) and propagate label / add group metadata
    //    so the backend can recognize composite fields like "手机号码 = 区号
    //    + 号码".
    this._propagateGroupLabels(fields);
    this._annotateRepeatInstances(fields);

    return fields;
  },

  // ---------------------------------------------------------------- collect
  _collectAllControls() {
    const real = Array.from(document.querySelectorAll(this._CONTROL_SELECTOR))
      .filter(el => this._isVisible(el));

    // ARIA wrappers are kept even when they contain a real <input>/<select>
    // inside. Modern SPA select widgets (Ant Design, Feishu UD's atsx-select,
    // etc.) use this pattern: an outer <div role="combobox"> with all the
    // semantic ARIA props, plus an internal hidden search <input> that only
    // shows up while the user types. We want the outer wrapper as the
    // canonical control; the dedup step below drops the nested input.
    const aria = Array.from(document.querySelectorAll(this._ARIA_SELECTOR))
      .filter(el => this._isVisible(el));

    const pseudo = this._collectPseudoGroups([...real, ...aria]);

    const all = [...real, ...aria, ...pseudo];
    // Sort by document order.
    all.sort((a, b) => {
      const cmp = a.compareDocumentPosition(b);
      if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (cmp & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    // Drop nested controls: if `b` is contained by `a`, remove `b` (we keep
    // the outer one — typically the ARIA wrapper or the pseudo group).
    // Also drops duplicates because Node.contains(self) === true.
    const filtered = [];
    for (const c of all) {
      const enclosing = filtered.find(x => x.contains(c) && x !== c);
      const isDuplicate = filtered.includes(c);
      if (!enclosing && !isDuplicate) filtered.push(c);
    }
    return filtered;
  },

  _collectPseudoGroups(realAndAriaCtrls) {
    const itemNodes = Array.from(document.querySelectorAll(this._PSEUDO_ITEM_SELECTOR))
      .filter(el => this._isVisible(el));
    if (itemNodes.length === 0) return [];

    // For each item node, walk up to the smallest ancestor that holds 2+ such
    // items. That ancestor is the candidate group container.
    const candidateGroups = new Set();
    for (const it of itemNodes) {
      let p = it.parentElement;
      while (p && p !== document.body) {
        const siblings = p.querySelectorAll(this._PSEUDO_ITEM_SELECTOR);
        let visibleCount = 0;
        for (const s of siblings) {
          if (this._isVisible(s)) visibleCount++;
          if (visibleCount >= 2) break;
        }
        if (visibleCount >= 2) {
          candidateGroups.add(p);
          break;
        }
        p = p.parentElement;
      }
    }

    // Reject groups that already contain a real / ARIA control (avoid
    // double-counting native widgets that happen to use the same class
    // names internally). Exception: radio/checkbox inputs are exactly the
    // "driver inputs" design systems wrap inside stylised label buttons
    // (e.g. Feishu UD's <label class="ud-radio-wrapper"><input type="radio">).
    // Such inputs are usually visually hidden via clip/transform/zero-size,
    // not display:none, so _isVisible lets them through. Treating them as
    // disqualifying real controls would wrongly drop the entire group.
    const groups = [];
    for (const g of candidateGroups) {
      let hasRealCtrl = false;
      for (const c of realAndAriaCtrls) {
        if (!g.contains(c)) continue;
        const t = (c.type || '').toLowerCase();
        if (t === 'radio' || t === 'checkbox') continue;
        hasRealCtrl = true;
        break;
      }
      if (!hasRealCtrl) groups.push(g);
    }

    // De-nest: if group A contains group B, drop B (keep the outer scope).
    return groups.filter(g => !groups.some(o => o !== g && o.contains(g)));
  },

  // -------------------------------------------------------------- sequence
  _buildItemSequence(controlSet) {
    const items = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
    );
    // Track the deepest control whose subtree we are currently inside, so we
    // can skip text nodes that live inside a control (they'd otherwise leak
    // out and pollute the next segment).
    const ctrlStack = [];

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.ELEMENT_NODE) {
        // Pop ctrlStack entries that no longer contain this node.
        while (ctrlStack.length && !ctrlStack[ctrlStack.length - 1].contains(node)) {
          ctrlStack.pop();
        }
        if (controlSet.has(node)) {
          items.push({ type: 'ctrl', node });
          ctrlStack.push(node);
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        if (ctrlStack.length) continue; // inside a control's subtree
        const txt = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (!txt) continue;
        items.push({ type: 'text', node, text: txt });
      }
    }
    return items;
  },

  // Look at items[prevCtrlIdx+1 .. curCtrlIdx-1] from the back, return the
  // first eligible text segment.
  _labelFromSegment(items, prevCtrlIdx, curCtrlIdx) {
    for (let j = curCtrlIdx - 1; j > prevCtrlIdx; j--) {
      const it = items[j];
      if (it.type !== 'text') continue;
      if (it.text.length > this.MAX_LABEL_LEN) continue;
      if (/^[\s*＊：:。.\-—|()（）\[\]\/\\~～]+$/.test(it.text)) continue;
      if (this._isBlacklistedText(it.node)) continue;
      return it.text;
    }
    return '';
  },

  _isBlacklistedText(textNode) {
    let cur = textNode.parentElement;
    while (cur && cur !== document.body) {
      if (cur.matches && cur.matches(this._LABEL_BLACKLIST_ANCESTOR)) return true;
      cur = cur.parentElement;
    }
    return false;
  },

  // ---------------------------------------------------------------- describe
  _generateId(el) {
    return (
      el.id ||
      el.name ||
      el.getAttribute('data-field') ||
      el.getAttribute('data-name') ||
      `auto_${Math.random().toString(36).slice(2, 8)}`
    );
  },

  _detectControlType(el) {
    // Pseudo group: one of our manufactured "controls".
    if (this._isPseudoGroup(el)) return 'select';

    const role = el.getAttribute && el.getAttribute('role');
    if (role === 'combobox' || role === 'listbox') return 'select';
    if (role === 'spinbutton') return 'text';

    return DOMUtils.detectType(el);
  },

  // Map a widget label to a coarse `type` for backwards-compatible consumers.
  _typeFromWidget(widget) {
    switch (widget) {
      case 'native-select':
      case 'aria-combobox':
      case 'custom-dropdown':
      case 'search-select':
      case 'cascader':
      case 'pseudo-radio':
        return 'select';
      case 'date-picker':
      case 'date-range':
        return 'date';
      case 'radio-group': return 'radio';
      case 'checkbox-group': return 'checkbox';
      case 'file-upload': return 'file';
      case 'textarea': return 'textarea';
      case 'contenteditable': return 'text';
      case 'text-input':
      default:
        return 'text';
    }
  },

  // Widget detection. Order matters — most specific first.
  // `label` is optional but when provided enables a final semantic fallback
  // (e.g. a plain <input> labelled "起止时间" with no other clue is still a
  // date picker).
  _detectWidget(el, label) {
    if (this._isPseudoGroup(el)) return 'pseudo-radio';

    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'select') return 'native-select';
    if (tag === 'textarea') return 'textarea';

    if (el.hasAttribute && el.hasAttribute('contenteditable')) {
      return 'contenteditable';
    }

    const role = (el.getAttribute && el.getAttribute('role') || '').toLowerCase();
    const ariaHasPopup = (el.getAttribute && el.getAttribute('aria-haspopup') || '').toLowerCase();
    const ariaAutocomplete = (el.getAttribute && el.getAttribute('aria-autocomplete') || '').toLowerCase();

    if (role === 'combobox' || role === 'listbox' ||
        ariaHasPopup === 'listbox' || ariaHasPopup === 'list' || ariaHasPopup === 'tree') {
      // aria-autocomplete="list" or "both" means the dropdown filters as the
      // user types — that's a search-select, not a plain combobox. Common in
      // city / school pickers (e.g. Feishu atsx-select with allow-clear).
      if (ariaAutocomplete === 'list' || ariaAutocomplete === 'both') {
        return 'search-select';
      }
      return 'aria-combobox';
    }

    const inputType = (el.type || '').toLowerCase();
    if (inputType === 'file') return 'file-upload';
    if (inputType === 'radio') return 'radio-group';
    if (inputType === 'checkbox') return 'checkbox-group';
    if (['date', 'month', 'week', 'datetime-local', 'time'].includes(inputType)) {
      return 'date-picker';
    }

    // From here on it's a plain <input type="text|...">. Classify by nearby
    // visual / structural hints.
    const neighborhood = this._collectNeighborhoodClasses(el);

    if (this._matchesAny(neighborhood, this._CASCADER_HINT_CLASS)) {
      return 'cascader';
    }

    const hasDateIcon = this._hasNearbyIcon(el, this._DATE_ICON_SELECTOR);
    if (hasDateIcon) return 'date-picker';
    if (this._matchesAny(neighborhood, this._DATE_HINT_CLASS)) return 'date-picker';

    const hasArrow = this._hasNearbyIcon(el, this._DROPDOWN_ARROW_SELECTOR);
    const isReadonly = el.readOnly || (el.getAttribute && el.getAttribute('readonly') !== null);
    const isSearchHinted = this._matchesAny(neighborhood, this._SEARCH_HINT_CLASS);

    if (hasArrow && (isReadonly || !isSearchHinted)) return 'custom-dropdown';
    if (hasArrow && isSearchHinted) return 'search-select';
    if (isReadonly && isSearchHinted) return 'search-select';
    if (isReadonly && !hasArrow) {
      // Read-only without an arrow is uncommon for text inputs; treat as a
      // dropdown-like widget unless other signals say otherwise.
      return 'custom-dropdown';
    }

    // Select-wrapper detection (deeper than ICON_SEARCH_RADIUS): some design
    // systems (Feishu UD's <div class="ud__select">, Ant Design's
    // <div class="ant-select">, Element UI's <div class="el-select">) wrap
    // the actual <input> several layers deep with no ARIA/role hints, no
    // readonly, no visible arrow icon. The wrapper class is the only signal
    // that this is a dropdown, not a plain text field. We walk up to 8
    // levels and match BEM block names ending in "select".
    if (this._hasSelectWrapper(el)) {
      // Editable input with a select wrapper = user types to filter options
      // (search-select). A readonly one would already have been caught above.
      return 'search-select';
    }

    // Last resort: semantic fallback from the resolved label. Only triggers
    // when no structural signal at all has fired (no HTML5 type, no icon,
    // no class hint, no readonly, no arrow). Sites like Feishu / Xiaopeng
    // render their date pickers as plain <input type="text"> with nothing
    // distinguishing them, so the label is the only available cue.
    if (label && this._DATE_LABEL_REGEX.test(label) && !this._DATE_LABEL_NEGATIVE.test(label)) {
      return 'date-picker';
    }

    return 'text-input';
  },

  // Walk up to 8 ancestor levels searching for a class token that looks
  // like a select-widget BEM block name. Matches `ud__select`, `ant-select`,
  // `el-select`, `multi-select`, etc. Rejects `selected`, `select-icon`,
  // `select__arrow`, `select--open` because those are state/element/modifier
  // classes, not the block itself.
  _SELECT_WRAPPER_DEPTH: 8,
  _SELECT_BLOCK_REGEX: /^(?:[a-z0-9]+(?:[-_]+))*select$/i,

  _hasSelectWrapper(el) {
    let cur = el.parentElement;
    let depth = 0;
    while (cur && cur !== document.body && depth < this._SELECT_WRAPPER_DEPTH) {
      const cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
      if (cls) {
        const tokens = cls.split(/\s+/);
        for (const tok of tokens) {
          if (this._SELECT_BLOCK_REGEX.test(tok)) return true;
        }
      }
      cur = cur.parentElement;
      depth++;
    }
    return false;
  },

  // Collect class strings from up to ICON_SEARCH_RADIUS ancestors of `el`,
  // joined with spaces. Used for cheap regex-based hint matching.
  _collectNeighborhoodClasses(el) {
    let s = (el.className && typeof el.className === 'string') ? el.className : '';
    let cur = el.parentElement;
    let depth = 0;
    while (cur && cur !== document.body && depth < this.ICON_SEARCH_RADIUS) {
      const cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
      if (cls) s += ' ' + cls;
      cur = cur.parentElement;
      depth++;
    }
    return s;
  },

  _matchesAny(text, regex) {
    return regex.test(text);
  },

  // Look for an icon within the nearest few ancestor levels (i.e. inside the
  // visual "chip" of the input but not so far that we'd hit unrelated icons
  // elsewhere on the page).
  _hasNearbyIcon(el, selector) {
    let cur = el.parentElement;
    let depth = 0;
    while (cur && cur !== document.body && depth < this.ICON_SEARCH_RADIUS) {
      // Only look forward / sideways from `el` so we don't pick up icons of
      // a sibling field that happens to live in the same parent.
      const found = cur.querySelector(selector);
      if (found && !found.contains(el) && el.compareDocumentPosition(found) & Node.DOCUMENT_POSITION_FOLLOWING) {
        return true;
      }
      cur = cur.parentElement;
      depth++;
    }
    return false;
  },

  _isEnumerable(widget, options) {
    // Enumerable means: the `options` array we emit fully describes the
    // possible values. The backend doesn't need to crack open a dropdown.
    if (widget === 'native-select' || widget === 'radio-group' ||
        widget === 'checkbox-group' || widget === 'pseudo-radio') {
      return options.length > 0;
    }
    return false;
  },

  // Optional input constraints. Returns an object with whichever attributes
  // are present so callers can spread it into the field record.
  _extractConstraints(el) {
    const out = {};
    if (!el || !el.getAttribute) return out;
    const ml = el.getAttribute('maxlength');
    if (ml && +ml > 0) out.maxLength = +ml;
    const min = el.getAttribute('min');
    if (min !== null && min !== '') out.min = min;
    const max = el.getAttribute('max');
    if (max !== null && max !== '') out.max = max;
    const pat = el.getAttribute('pattern');
    if (pat) out.pattern = pat;
    return out;
  },

  _isPseudoGroup(el) {
    if (!el || !el.querySelectorAll) return false;
    if (el.matches && el.matches(this._CONTROL_SELECTOR)) return false;
    if (el.matches && el.matches(this._ARIA_SELECTOR)) return false;
    return el.querySelectorAll(this._PSEUDO_ITEM_SELECTOR).length >= 2;
  },

  _resolveLabel(el, segLabel, _lastLabel) {
    // Native labels / aria-label always win.
    if (el.labels && el.labels.length > 0) {
      const txt = (el.labels[0].textContent || '').trim();
      if (txt) return this._cleanLabel(txt);
    }

    // Fallback for radio/checkbox wrapped in a <label> with no `for`/`id`
    // pairing: the browser sometimes leaves `el.labels` empty even though
    // the input is a descendant of a <label>. Take that ancestor's text.
    if (el.type === 'radio' || el.type === 'checkbox') {
      const wrap = el.closest && el.closest('label');
      if (wrap) {
        const t = (wrap.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) return this._cleanLabel(t);
      }
    }

    const labelledby = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledby) {
      const parts = labelledby.split(/\s+/)
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .map(node => (node.textContent || '').trim())
        .filter(Boolean);
      if (parts.length) return this._cleanLabel(parts.join(' '));
    }

    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return this._cleanLabel(aria);

    // Framework-supplied display label written onto the control itself.
    // Most common: Feishu UD Formily's `data-form-field-i18n-name` (used by
    // jobs.bytedance.com / Feishu 招聘 / xiaopeng.jobs.feishu.cn). Trusted
    // because the framework owns the attribute and sets it to the resolved
    // i18n string. We only fall through to segment-based resolution when
    // none of these are present.
    if (el.getAttribute) {
      for (const attr of this._LABEL_DATA_ATTRS) {
        const v = el.getAttribute(attr);
        if (v && v.trim()) return this._cleanLabel(v);
      }
      // Same idea, but on the closest ancestor that scopes a single field.
      // Formily renders <div data-form-field-id="name" data-form-field-i18n-name="姓名">
      // around the entire form-item; reading it from the wrapper covers
      // ARIA-wrapper controls (where `el` itself has no data-* attrs).
      let cur = el.parentElement;
      let depth = 0;
      while (cur && cur !== document.body && depth < 8) {
        for (const attr of this._LABEL_DATA_ATTRS) {
          const v = cur.getAttribute && cur.getAttribute(attr);
          if (v && v.trim()) return this._cleanLabel(v);
        }
        cur = cur.parentElement;
        depth++;
      }
    }

    if (segLabel) return this._cleanLabel(segLabel);

    // Fallback: derive from placeholder (strip "请输入/请选择/请填写" prefix).
    const ph = el.placeholder || (el.getAttribute && el.getAttribute('placeholder')) || '';
    if (ph) {
      const derived = this._deriveSubLabel({ placeholder: ph });
      if (derived && derived.length <= this.MAX_LABEL_LEN) return derived;
    }

    // Last resort: a fieldset legend as a *very* loose hint.
    const fieldset = el.closest && el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) {
        const t = (legend.textContent || '').trim();
        if (t) return this._cleanLabel(t);
      }
    }
    return '';
  },

  _cleanLabel(text) {
    return (text || '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s*＊：:。.\-—|]+/, '')
      .replace(/[\s*＊：:。.\-—|]+$/, '')
      .trim();
  },

  _isRequired(el) {
    if (el.required) return true;
    if (el.getAttribute && el.getAttribute('aria-required') === 'true') return true;
    const item = el.closest && el.closest(
      '[class*="form-item"], [class*="formItem"], [class*="info-row"], [class*="infoItem"], [class*="field"], .form-group, dl, tr, li'
    );
    if (!item) return false;
    if (item.querySelector('[class*="required"], .required, .is-required, [class*="asterisk"]')) return true;
    return /(\*|＊)/.test((item.textContent || '').slice(0, 80));
  },

  _extractOptions(el) {
    if (this._isPseudoGroup(el)) {
      const items = el.querySelectorAll(this._PSEUDO_ITEM_SELECTOR);
      const opts = [];
      const seen = new Set();
      for (const it of items) {
        const t = (it.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > this.MAX_OPTION_LEN) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        opts.push(t);
      }
      return opts;
    }

    if (el.tagName && el.tagName.toLowerCase() === 'select') {
      return Array.from(el.options).map(o => (o.textContent || '').trim()).filter(Boolean);
    }
    if (el.type === 'radio' || el.type === 'checkbox') {
      const name = el.name;
      if (name) {
        return Array.from(document.querySelectorAll(`input[name="${CSS.escape(name)}"]`))
          .map(r => {
            const lbl = r.closest('label');
            return lbl ? (lbl.textContent || '').trim() : r.value;
          })
          .filter(Boolean);
      }
      // No `name` attribute: a standalone radio/checkbox. Fall back to the
      // wrapping <label>'s text as the single option (e.g. Feishu's
      // "没有工作经历" checkbox without a name attribute).
      const lbl = el.closest('label');
      if (lbl) {
        const t = (lbl.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) return [t];
      }
      return [];
    }
    const role = el.getAttribute && el.getAttribute('role');
    if (role === 'listbox' || role === 'combobox') {
      const opts = el.querySelectorAll('[role="option"]');
      if (opts.length > 0) {
        return Array.from(opts).map(o => (o.textContent || '').trim()).filter(Boolean);
      }
    }
    return [];
  },

  _detectSection(el) {
    const allTitles = document.querySelectorAll(this._TITLE_SELECTOR);
    let best = null;
    let bestText = '';

    for (const t of allTitles) {
      if (!this._isVisible(t)) continue;
      if (t === el || t.contains(el) || el.contains(t)) continue;
      const cmp = el.compareDocumentPosition(t);
      if (!(cmp & Node.DOCUMENT_POSITION_PRECEDING)) continue;

      const txt = (t.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 60) continue;
      if (t.closest('header, nav, [class*="header"], [class*="nav"], [class*="topbar"], [class*="sidebar"]')) continue;

      if (!best) { best = t; bestText = txt; }
      else if (best.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) {
        best = t; bestText = txt;
      }
    }
    if (bestText) return this._cleanLabel(bestText);

    const fieldset = el.closest && el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) return this._cleanLabel((legend.textContent || '').trim());
    }
    return '';
  },

  _isVisible(el) {
    return DOMUtils.isVisible(el);
  },

  // ----------------------------------------------------- form-item grouping
  //
  // Many SPAs put 2+ controls inside a single form-item (e.g. ATS pages wrap
  // "手机号码" as a country-code input + phone-number input; identity fields
  // often wrap a type picker + a number input). Segment-based label
  // resolution gives only the first control a meaningful label and leaves
  // the rest blank, which loses semantic information for the backend.
  //
  // This pass groups controls by the closest form-item container, then:
  //   - propagates the primary label to siblings whose label is empty
  //   - assigns groupId / groupSize / groupIndex
  //   - derives a subLabel from each control's placeholder so multiple
  //     siblings can be told apart
  _ITEM_GROUP_SELECTORS: [
    '.el-form-item', '.ant-form-item',
    '[class*="form-item"]', '[class*="formItem"]',
    '[class*="formily-item"]', '[class*="formilyItem"]',
    '[class*="form-row"]', '[class*="formRow"]',
    '[class*="form-line"]', '[class*="formLine"]',
    '[class*="atsx-form-item"]', '[class*="atsxFormItem"]',
    '[class*="moka-form-item"]', '[class*="mokaFormItem"]',
    '[class*="moka-field"]', '[class*="mokaField"]',
    '[class*="beisen-form-item"]', '[class*="beisenFormItem"]',
    '[class*="beisen-field"]', '[class*="beisenField"]',
    '[class*="b-form-item"]',
    '[class*="info-row"]', '[class*="infoRow"]',
    '[class*="info-item"]', '[class*="infoItem"]',
    '[class*="info-line"]', '[class*="infoLine"]',
    '.field', '.form-group',
    'tr', 'dl',
  ],

  MAX_GROUP_PROPAGATE: 5,
  MAX_REPEAT_ITEM_CONTROLS: 30,

  _REPEAT_SECTION_REGEX:
    /项目|教育|学历|院校|求学|实习|工作经历|工作经验|工作履历|任职经历|职业经历|就业经历|校园|社团|学生干部|社会实践|实践经历|project|education|school|intern|internship|work experience|work history|employment history|professional experience|campus|experience/i,

  _REPEAT_ITEM_HINT_REGEX:
    /card|entry|record|block|module|panel|resume|experience|history|employment|career|project|education|intern|campus|work|moka|beisen|atsx|feishu|经历|履历|项目|教育|实习|校园/i,
  _REPEAT_FIELD_LABEL_HINT_REGEX:
    /项目|学校|院校|学历|学位|专业|院系|公司|职位|岗位|角色|起止|开始|结束|描述|成果|职责|实习|工作经历|工作经验|工作履历|任职经历|职业经历|就业经历|校园|社团|社会实践|project|school|university|degree|major|company|position|role|start|end|description|achievement|intern|internship|work experience|work history|employment history|campus/i,

  _findItemContainer(el) {
    for (const sel of this._ITEM_GROUP_SELECTORS) {
      const c = el.closest && el.closest(sel);
      if (c) return c;
    }
    // Fallback: walk up until we find an ancestor that contains exactly 2-5
    // controls (a likely per-field composite container).
    let cur = el.parentElement;
    let depth = 0;
    while (cur && cur !== document.body && depth < 10) {
      const count = this._countControlsIn(cur);
      if (count >= 2 && count <= this.MAX_GROUP_PROPAGATE) return cur;
      if (count > this.MAX_GROUP_PROPAGATE) break;
      cur = cur.parentElement;
      depth++;
    }
    return null;
  },

  _countControlsIn(container) {
    if (!container || !container.querySelectorAll) return 0;
    let count = 0;
    for (const el of this._elementMap.values()) {
      if (container.contains(el)) {
        count++;
        if (count > this.MAX_GROUP_PROPAGATE) return count;
      }
    }
    return count;
  },

  _propagateGroupLabels(fields) {
    if (fields.length === 0) return;

    // Bucket fields by their item container DOM node.
    const buckets = new Map(); // container element -> array of field index
    fields.forEach((f, idx) => {
      const el = this._elementMap.get(f.fieldId);
      if (!el) return;
      const container = this._findItemContainer(el);
      if (!container) return;
      let arr = buckets.get(container);
      if (!arr) { arr = []; buckets.set(container, arr); }
      arr.push(idx);
    });

    let groupCounter = 0;
    for (const [, indices] of buckets) {
      if (indices.length < 2) continue;
      // Defensive: don't merge huge containers (likely a whole card, not a
      // single composite field).
      if (indices.length > this.MAX_GROUP_PROPAGATE) continue;

      // Find the first non-empty label inside this group as the primary.
      const primaryIdx = indices.find(i => fields[i].label);
      const primaryLabel = primaryIdx != null ? fields[primaryIdx].label : '';
      if (!primaryLabel) continue;

      const groupId = `g_${groupCounter++}`;
      indices.forEach((fi, posInGroup) => {
        const f = fields[fi];
        // Treat label as missing if it's literally identical to the
        // placeholder — that's the "placeholder leaked into the segment"
        // pattern (e.g. Tencent's second 起止时间 input grabs "选择日期"
        // from the placeholder render, but the real label is the group
        // primary). Real per-field labels never equal their placeholder.
        const placeholderLeak =
          !!f.label && !!f.placeholder &&
          this._cleanLabel(f.label) === this._cleanLabel(f.placeholder);
        const labelChanged = !f.label || placeholderLeak;
        if (!f.label || placeholderLeak) f.label = primaryLabel;
        f.groupId = groupId;
        f.groupSize = indices.length;
        f.groupIndex = posInGroup;
        const sub = this._deriveSubLabel(f);
        if (sub) f.subLabel = sub;

        // If this sibling just inherited a label and it's still classified
        // as a generic text-input, re-run the semantic fallback. This fixes
        // cases like Xiaopeng's 起止时间 second input: at scan time it had
        // no segment label so the date fallback couldn't fire; only after
        // group propagation do we know it should be a date-picker too.
        if (labelChanged && f.widget === 'text-input' && f.label) {
          if (this._DATE_LABEL_REGEX.test(f.label) &&
              !this._DATE_LABEL_NEGATIVE.test(f.label)) {
            f.widget = 'date-picker';
            f.type = this._typeFromWidget('date-picker');
          }
        }
      });
    }
  },

  // Strip common Chinese/English prompt prefixes from placeholder so we have
  // a short noun phrase to disambiguate sibling controls in a group. Returns
  // '' if nothing useful remains.
  _deriveSubLabel(field) {
    const ph = (field.placeholder || '').trim();
    if (!ph) return '';
    const stripped = ph
      .replace(/^请(?:输入|填写|选择)(?:您的|你的)?/, '')
      .replace(/^(?:enter|input|select|please\s+(?:enter|input|select))\s*/i, '')
      .replace(/[，。.,!！?？]+$/, '')
      .trim();
    if (!stripped) return '';
    if (stripped.length > this.MAX_LABEL_LEN) return '';
    return stripped;
  },

  _annotateRepeatInstances(fields) {
    if (fields.length === 0) return;

    this._repeatFieldLookup = new Map();
    fields.forEach(field => {
      const el = this._elementMap.get(field.fieldId);
      if (el) this._repeatFieldLookup.set(el, field);
    });

    const parentBuckets = new Map();
    fields.forEach((field, idx) => {
      const el = this._elementMap.get(field.fieldId);
      if (!el) return;
      const item = this._findRepeatItemContainer(el, field);
      if (!item || !item.parentElement) return;

      let bySection = parentBuckets.get(item.parentElement);
      if (!bySection) {
        bySection = new Map();
        parentBuckets.set(item.parentElement, bySection);
      }

      const section =
        field.section ||
        this._detectSection(item) ||
        this._inferRepeatSectionFromItem(item) ||
        '';
      const sectionKey = this._cleanLabel(section || 'repeat');
      let entries = bySection.get(sectionKey);
      if (!entries) {
        entries = [];
        bySection.set(sectionKey, entries);
      }
      entries.push({ field, idx, item, section: sectionKey });
    });

    let repeatCounter = 0;
    for (const [, bySection] of parentBuckets) {
      for (const [, entries] of bySection) {
        const uniqueItems = [];
        for (const entry of entries) {
          if (!uniqueItems.includes(entry.item)) uniqueItems.push(entry.item);
        }
        uniqueItems.sort((a, b) => {
          const cmp = a.compareDocumentPosition(b);
          if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (cmp & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
        if (uniqueItems.length < 2) continue;

        const repeatGroupId = `r_${repeatCounter++}`;
        for (const entry of entries) {
          const repeatIndex = uniqueItems.indexOf(entry.item);
          if (repeatIndex < 0) continue;
          entry.field.repeatGroupId = repeatGroupId;
          entry.field.repeatIndex = repeatIndex;
          entry.field.repeatSize = uniqueItems.length;
          entry.field.repeatSection = entry.section || entry.field.section || '';
        }
      }
    }
  },

  _findRepeatItemContainer(el, field) {
    const section = field.section || '';
    let cur = el.parentElement;
    let depth = 0;

    while (cur && cur !== document.body && depth < 12) {
      const controlCount = this._countControlsIn(cur);
      if (controlCount >= 2 && controlCount <= this.MAX_REPEAT_ITEM_CONTROLS) {
        const repeatishSection =
          this._isRepeatSection(section) ||
          this._looksLikeRepeatItem(cur) ||
          this._hasRepeatFieldSignature(cur);
        if (repeatishSection && this._hasRepeatSiblings(cur)) return cur;
      }
      cur = cur.parentElement;
      depth++;
    }
    return null;
  },

  _isRepeatSection(section) {
    return !!section && this._REPEAT_SECTION_REGEX.test(section);
  },

  _hasRepeatSiblings(container) {
    const parent = container.parentElement;
    if (!parent) return false;
    const siblings = Array.from(parent.children).filter(child => {
      if (child === container) return true;
      if (!this._repeatContainersLookAlike(container, child)) return false;
      const count = this._countControlsIn(child);
      return count >= 2 && count <= this.MAX_REPEAT_ITEM_CONTROLS;
    });
    return siblings.length >= 2;
  },

  _repeatContainersLookAlike(a, b) {
    if (!a || !b || a.tagName !== b.tagName) return false;
    const hinted = this._looksLikeRepeatItem(a) || this._looksLikeRepeatItem(b);

    const aTokens = this._classTokens(a);
    const bTokens = this._classTokens(b);
    if (aTokens.length === 0 || bTokens.length === 0) {
      if (this._looksLikeRepeatItem(a) && this._looksLikeRepeatItem(b)) return true;
      return this._repeatFieldSignaturesMatch(a, b);
    }
    if (hinted && aTokens.some(token => bTokens.includes(token))) return true;
    return this._repeatFieldSignaturesMatch(a, b);
  },

  _looksLikeRepeatItem(el) {
    if (this._hasAnyAttr(el, [
      'data-field-list-item',
      'data-form-list-item',
      'data-list-item',
      'data-repeat-item',
    ])) {
      return true;
    }

    const text = [
      this._attrText(el, 'class'),
      this._attrText(el, 'data-testid'),
      this._attrText(el, 'data-test-id'),
      this._attrText(el, 'data-name'),
      this._attrText(el, 'data-field'),
      this._attrText(el, 'data-form-field-id'),
      this._attrText(el, 'data-form-field-name'),
      this._attrText(el, 'data-form-field-i18n-name'),
      this._attrText(el, 'data-section'),
      this._attrText(el, 'data-module'),
      this._attrText(el, 'role'),
    ].join(' ');
    return this._REPEAT_ITEM_HINT_REGEX.test(text);
  },

  _classTokens(el) {
    return this._attrText(el, 'class')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 3)
      .filter(token => !/^(active|selected|checked|disabled|required|error)$/i.test(token));
  },

  _attrText(el, name) {
    const value = el && el.getAttribute ? el.getAttribute(name) : '';
    return value == null ? '' : String(value);
  },

  _hasAnyAttr(el, names) {
    return !!(el && el.hasAttribute && names.some(name => el.hasAttribute(name)));
  },

  _hasRepeatFieldSignature(container) {
    const signature = this._containerFieldSignature(container);
    return this._signatureSuggestsRepeat(signature);
  },

  _repeatFieldSignaturesMatch(a, b) {
    const sigA = this._containerFieldSignature(a);
    const sigB = this._containerFieldSignature(b);
    if (!this._signatureSuggestsRepeat(sigA) || !this._signatureSuggestsRepeat(sigB)) {
      return false;
    }
    if (sigA.length !== sigB.length) return false;
    return sigA.every((part, index) => part === sigB[index]);
  },

  _containerFieldSignature(container) {
    if (!container || !this._repeatFieldLookup) return [];

    const entries = [];
    for (const [el, field] of this._repeatFieldLookup.entries()) {
      if (!container.contains(el)) continue;
      const label = this._cleanLabel(field.label || field.placeholder || field.type || '');
      if (!label) continue;
      const subLabel = this._cleanLabel(field.subLabel || '');
      const groupIndex = Number.isInteger(field.groupIndex) ? `#${field.groupIndex}` : '';
      entries.push({
        el,
        key: `${label}${subLabel ? ':' + subLabel : ''}${groupIndex}`,
      });
    }
    entries.sort((a, b) => {
      const cmp = a.el.compareDocumentPosition(b.el);
      if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (cmp & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return entries.map(entry => entry.key);
  },

  _signatureSuggestsRepeat(signature) {
    if (!Array.isArray(signature) || signature.length < 2) return false;
    return signature.some(part => this._REPEAT_FIELD_LABEL_HINT_REGEX.test(part));
  },

  _inferRepeatSectionFromItem(item) {
    const text = [
      this._containerFieldSignature(item).join(' '),
      this._attrText(item, 'class'),
      this._attrText(item, 'data-testid'),
      this._attrText(item, 'data-test-id'),
      this._attrText(item, 'data-name'),
      this._attrText(item, 'data-field'),
      this._attrText(item, 'data-form-field-i18n-name'),
      this._attrText(item, 'data-section'),
      this._attrText(item, 'data-module'),
    ].join(' ');
    return this._inferRepeatSectionFromText(text);
  },

  _inferRepeatSectionFromText(text) {
    const normalized = String(text || '').toLowerCase();
    if (/项目|project/.test(normalized)) return '项目经历';
    if (/实习|intern/.test(normalized)) return '实习经历';
    if (/教育|学历|学位|学校|院校|专业|院系|education|school|university|degree|major/.test(normalized)) {
      return '教育经历';
    }
    if (/校园|社团|学生干部|campus/.test(normalized)) return '校园经历';
    if (/工作经历|工作经验|工作履历|任职经历|职业经历|就业经历|公司|职位|岗位|work experience|work history|employment history|professional experience|company|position/.test(normalized)) {
      return '工作经历';
    }
    return '';
  },
};
