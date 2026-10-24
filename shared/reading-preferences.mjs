export const highlightColors = [
  {id:'amber', label:'Yellow', fill:'#f2d36f'},
  {id:'sage', label:'Green', fill:'#a7c49a'},
  {id:'rose', label:'Pink', fill:'#e7acb3'},
  {id:'blue', label:'Blue', fill:'#9ec3e4'},
];

export function readingPreferences(workspace = {}) {
  return {
    readerSidebar:workspace.readerSidebar === true,
    readerExpanded:workspace.readerExpanded === true,
    highlightColor:highlightColors.some(c => c.id === workspace.highlightColor) ? workspace.highlightColor : 'amber',
  };
}

// Keep the source page and text anchors in a new highlight.
export function createHighlightDraft(docId, selection, color = 'amber') {
  return {
    docId, page:selection.page, quote:selection.quote,
    rects:selection.rects, anchor:selection.anchor,
    comment:'', transcript:'', tags:[], highlight:true,
    color:readingPreferences({highlightColor:color}).highlightColor,
  };
}
