import CSL from 'citeproc';
import locales from '@citation-js/plugin-csl/lib-mjs/locales.json';
import style from '../../assets/modern-language-association.csl?raw';

export function citation(doc, pageLabel = null) {
  const missing = ['author','title','year'].filter(key => !doc[key]);
  if (['article-journal','paper-conference','chapter'].includes(doc.citationType) && !doc.publication) missing.push('publication');
  if (['book','chapter','report'].includes(doc.citationType) && !doc.publisher) missing.push('publisher');
  if (doc.citationType === 'webpage' && !doc.url) missing.push('url');
  const author = (doc.author || '').split(';').map(s=>s.trim()).filter(Boolean).map(s=>s.includes(',') ?
    {family:s.split(',')[0].trim(),given:s.split(',').slice(1).join(',').trim()} : {literal:s});
  const item = {id:doc.id,type:doc.citationType||'article-journal',title:doc.title,author,'container-title':doc.publication,
    publisher:doc.publisher,volume:doc.volume,issue:doc.issue,page:doc.pages,DOI:doc.doi,URL:doc.url};
  if (/^\d{4}$/.test(doc.year)) item.issued = {'date-parts':[[Number(doc.year)]]};
  if (/^\d{4}-\d{2}-\d{2}$/.test(doc.accessed || '')) item.accessed = {'date-parts':[doc.accessed.split('-').map(Number)]};
  const engine = new CSL.Engine({retrieveLocale:()=>locales['en-US'],retrieveItem:()=>item},style,'en-US');
  engine.setOutputFormat('text');
  engine.updateItems([doc.id]);
  const worksCited = engine.makeBibliography()[1].join('').trim();
  const inText = engine.makeCitationCluster([{id:doc.id,...(pageLabel?{locator:String(pageLabel),label:'page'}:{})}]);
  return {worksCited,inText,missing,reviewed:doc.reviewed};
}
