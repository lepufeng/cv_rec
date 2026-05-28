var ResultAnnotator = {
  show(filledCount, skippedList) {
    this.remove();

    const overlay = document.createElement('div');
    overlay.id = 'resume-autofill-result';
    overlay.innerHTML = this._buildHTML(filledCount, skippedList);

    Object.assign(overlay.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '999999',
      maxWidth: '360px',
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: '10px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      padding: '16px',
      fontFamily: '-apple-system, sans-serif',
      fontSize: '14px',
      lineHeight: '1.5',
      color: '#1f2937',
    });

    document.body.appendChild(overlay);

    overlay.querySelector('#resume-autofill-close').addEventListener('click', () => this.remove());
  },

  remove() {
    const el = document.getElementById('resume-autofill-result');
    if (el) el.remove();
  },

  _buildHTML(filled, skipped) {
    let skippedRows = '';
    if (skipped.length > 0) {
      skippedRows = skipped.map(s => {
        const label = s.label || s.fieldId || '';
        const reason = s.reason || '未知原因';
        return `<li style="margin-bottom:4px"><strong>${this._escape(label)}</strong> — ${this._escape(reason)}</li>`;
      }).join('');
    } else {
      skippedRows = '<li>无</li>';
    }

    return `
      <div style="font-weight:600;font-size:16px;margin-bottom:8px">自动填写完成</div>
      <div style="margin-bottom:6px">已填: <strong>${filled}</strong> 个字段</div>
      <div style="margin-bottom:10px">跳过: <strong>${skipped.length}</strong> 个字段</div>
      <ul style="margin:0 0 12px 0;padding-left:18px;max-height:200px;overflow-y:auto">
        ${skippedRows}
      </ul>
      <button id="resume-autofill-close" style="
        display:block;width:100%;padding:8px;border:none;border-radius:6px;
        background:#2563eb;color:#fff;font-size:14px;cursor:pointer
      ">关闭</button>
    `;
  },

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
