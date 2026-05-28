var UploadHandler = {
  canHandle(field) {
    return field.type === 'file';
  },

  fill(el, value) {
    return false;
  },
};
