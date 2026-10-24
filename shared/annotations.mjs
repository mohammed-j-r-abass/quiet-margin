export function isHighlighted(note) {
  if (typeof note?.highlight === 'boolean') return note.highlight;
  // Keep standalone highlights visible in older libraries.
  return !!(note?.quote && note.rects?.length &&
    !note.comment?.trim() && !note.transcript?.trim() && !note.audioFile);
}

// Join nearby text boxes for display without changing saved coordinates.
export function mergeHighlightRects(rects = []) {
  const fragments = rects.filter(r => r && ['x','y','w','h'].every(k => Number.isFinite(r[k])) && r.w > 0 && r.h > 0)
    .map(r => {
      const x = Math.max(0, r.x), y = Math.max(0, r.y);
      return {x, y, w:Math.min(1, r.x + r.w) - x, h:Math.min(1, r.y + r.h) - y};
    }).filter(r => r.w > 0 && r.h > 0).sort((a,b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const rect of fragments) {
    const line = lines.find(l => Math.abs((l.reference.y + l.reference.h / 2) - (rect.y + rect.h / 2)) <= Math.min(l.reference.h, rect.h) * .35);
    if (line) line.rects.push(rect);
    else lines.push({reference:rect, rects:[rect]});
  }
  return lines.flatMap(line => {
    const merged = [];
    for (const rect of line.rects.sort((a,b) => a.x - b.x)) {
      const previous = merged.at(-1);
      if (previous && rect.x <= previous.x + previous.w + Math.min(previous.h, rect.h) * .5) {
        const right = Math.max(previous.x + previous.w, rect.x + rect.w);
        const bottom = Math.max(previous.y + previous.h, rect.y + rect.h);
        previous.y = Math.min(previous.y, rect.y);
        previous.w = right - previous.x;
        previous.h = bottom - previous.y;
      } else merged.push({...rect});
    }
    return merged;
  });
}
