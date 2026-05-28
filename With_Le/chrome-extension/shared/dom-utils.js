var DOMUtils = {
  isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const curStyle = window.getComputedStyle(cur);
      if (curStyle.display === 'none') return false;
      if (cur !== el && (curStyle.visibility === 'hidden' || curStyle.visibility === 'collapse')) {
        return false;
      }
      cur = cur.parentElement;
    }

    const style = window.getComputedStyle(el);
    // Radio / checkbox driver inputs are routinely hidden via visibility,
    // opacity, clip-path, or zero size while remaining interactive (the
    // wrapping <label> is what the user actually sees and clicks). Keep
    // them as long as no ancestor is display:none — they're real controls
    // and we need them in the field list.
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'input' && (type === 'radio' || type === 'checkbox')) {
      return true;
    }
    if (style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return false;
    return true;
  },

  isVisibleStrict(el) {
    if (!this.isVisible(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  },

  detectType(el) {
    if (!el) return 'unknown';
    if (el.hasAttribute && el.hasAttribute('contenteditable')) return 'text';
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    const type = (el.type || 'text').toLowerCase();
    if (type === 'radio') return 'radio';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'file') return 'file';
    if (['date', 'month', 'week', 'datetime-local', 'time'].includes(type)) return 'date';
    if (tag === 'input') return 'text';
    return 'unknown';
  },

  // React / Vue keep their own copy of an input's value. Setting `el.value`
  // directly is bypassed by their tracker, which then resets the value on
  // the next render. The trick is to invoke the *native* setter so that the
  // framework's input event handler sees the change.
  setNativeValue(el, value) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    let proto;
    if (tag === 'textarea') proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    else if (tag === 'select') proto = window.HTMLSelectElement && window.HTMLSelectElement.prototype;
    else proto = window.HTMLInputElement && window.HTMLInputElement.prototype;

    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    const ownDesc = Object.getOwnPropertyDescriptor(el, 'value');

    try {
      if (ownDesc && ownDesc.set) {
        // Some libraries (or test stubs) install their own setter on the
        // instance. Use the prototype setter when available to bypass it.
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
      } else if (desc && desc.set) {
        desc.set.call(el, value);
      } else {
        el.value = value;
      }
      return true;
    } catch (_) {
      try {
        el.value = value;
        return true;
      } catch (__) {
        return false;
      }
    }
  },

  fireInputEvents(el) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
  },
};
