var DateHandler = {
  canHandle(field) {
    return field.type === 'date';
  },

  fill(el, value) {
    if (value == null) return false;
    const str = String(value);

    try { el.focus(); } catch (_) {}
    DOMUtils.setNativeValue(el, str);
    DOMUtils.fireInputEvents(el);
    try { el.blur(); } catch (_) {}

    return el.value === str;
  },
};
