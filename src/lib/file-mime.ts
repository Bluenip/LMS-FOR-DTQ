const formats: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export function uploadMime(name: string, mime: string) {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return !mime || mime === 'application/octet-stream' ? formats[extension] || mime : mime;
}

export function expectedMime(name: string) {
  return formats[name.split('.').pop()?.toLowerCase() || ''];
}
