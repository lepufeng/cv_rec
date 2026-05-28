var ChoiceHandler = {
  canHandle(field) {
    return ['radio', 'checkbox'].includes(field.type);
  },

  fill(el, value) {
    const name = el.name || el.getAttribute('data-group');
    const values = Array.isArray(value) ? value : [value];
    if ((el.type || '').toLowerCase() === 'checkbox') {
      return this._fillStandalone(el, values);
    }
    if (!name) {
      return this._fillStandalone(el, values);
    }

    const group = document.querySelectorAll(`input[name="${CSS.escape(name)}"]`);
    let matched = false;

    group.forEach(input => {
      const label = input.closest('label');
      const labelText = label ? label.textContent.trim() : input.value;

      if (values.some(v => labelText === v || labelText.includes(v) || v.includes(labelText))) {
        if (!input.checked) {
          input.click();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        matched = true;
      } else if (input.type === 'checkbox') {
        if (input.checked) {
          input.click();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });

    return matched;
  },

  _fillStandalone(el, values) {
    const label = el.closest('label');
    const labelText = label ? label.textContent.trim() : (el.value || '');
    const matched = values.some(v => {
      const text = v == null ? '' : String(v);
      return labelText === text || labelText.includes(text) || text.includes(labelText);
    });
    if (!matched) return false;

    if (!el.checked) {
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  },
};
