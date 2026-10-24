export function normalizeReadingPosition(position = {}, pageCount = 1) {
  const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const result = {
    page:Math.max(1, Math.min(pageCount, Math.round(finite(position.page,1)) || 1)),
    zoom:Math.max(.5, Math.min(2.5, finite(position.zoom,1) || 1)),
    scroll:finite(position.scroll,0),
  };
  // Keep a negative offset when the page starts below the top of the reader.
  if (Number.isFinite(position.scrollRatio)) result.scrollRatio = Math.min(1, position.scrollRatio);
  return result;
}

export function offsetForReadingPosition(position, pageHeight) {
  return Number.isFinite(position.scrollRatio)
    ? Math.min(1, position.scrollRatio) * pageHeight
    : Math.min(pageHeight, position.scroll || 0);
}

export function pageReference(note) {
  if (!note.page) return 'Document thought';
  return note.pageLabel ? `Page ${note.pageLabel} · PDF page ${note.page}` : `PDF page ${note.page}`;
}
