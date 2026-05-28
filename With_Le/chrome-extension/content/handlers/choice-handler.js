var ChoiceHandler = {
  canHandle(field) {
    return ['radio', 'checkbox'].includes(field.type);
  },

  fill(el, value) {
    const name = el.name || el.getAttribute('data-group');
    if (!name) return false;

    const values = Array.isArray(value) ? value : [value];
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
};
