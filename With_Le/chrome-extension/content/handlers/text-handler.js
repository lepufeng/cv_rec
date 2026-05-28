var TextHandler = {
  canHandle(field) {
    return ['text', 'textarea'].includes(field.type);
  },

  fill(el, value) {
    if (value == null) return false;
    const str = String(value);

    try {
      el.focus();
    } catch (_) {}

    if (el.hasAttribute && el.hasAttribute('contenteditable')) {
      el.textContent = str;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      try { el.blur(); } catch (_) {}
      return el.textContent === str;
    }

    // React / Vue safe write.
    DOMUtils.setNativeValue(el, str);
    DOMUtils.fireInputEvents(el);

    // Some frameworks only commit on blur or keyup.
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    } catch (_) {}
    try { el.blur(); } catch (_) {}

    return el.value === str;
  },
};
