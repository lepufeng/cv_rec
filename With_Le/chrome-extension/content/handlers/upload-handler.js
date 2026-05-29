var UploadHandler = {
  canHandle(field) {
    return field && (field.type === 'file' || field.widget === 'file-upload');
  },

  async fill(el, value) {
    if (!el || (el.type || '').toLowerCase() !== 'file') return false;
    if (el.files && el.files.length > 0) return true;

    const payload = await this._resolveFilePayload(value);
    if (!payload || !payload.dataBase64) return false;

    try {
      const file = this._fileFromPayload(payload);
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      DOMUtils.fireInputEvents(el);
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
      return !!(el.files && el.files.length > 0);
    } catch (_) {
      return false;
    }
  },

  async _resolveFilePayload(value) {
    if (value && typeof value === 'object' && value.dataBase64) return value;

    const resumeId = value && typeof value === 'object'
      ? (value.resumeId || value.resume_id || value.id)
      : '';
    if (!resumeId || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      return null;
    }

    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        { type: MSG.REQUEST_RESUME_FILE, resumeId },
        response => {
          if (!response || response.type !== MSG.RESUME_FILE_DATA) {
            resolve(null);
            return;
          }
          resolve(response.data || null);
        }
      );
    });
  },

  _fileFromPayload(payload) {
    const bytes = this._base64ToBytes(payload.dataBase64);
    return new File(
      [bytes],
      payload.name || 'resume',
      { type: payload.mimeType || 'application/octet-stream' },
    );
  },

  _base64ToBytes(base64) {
    const binary = atob(String(base64));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  },
};
