import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isHighlighted,mergeHighlightRects} from '../shared/annotations.mjs';
import {createHighlightDraft,readingPreferences} from '../shared/reading-preferences.mjs';
import {normalizeReadingPosition,offsetForReadingPosition,pageReference} from '../shared/reading-position.mjs';

const passage={quote:'A source passage',rects:[{x:.1,y:.2,w:.4,h:.03}],comment:'',transcript:''};

test('legacy written and audio thoughts do not paint the PDF',()=>{
  assert.equal(isHighlighted({...passage,comment:'My interpretation'}),false);
  assert.equal(isHighlighted({...passage,transcript:'My spoken interpretation'}),false);
  assert.equal(isHighlighted({...passage,audioFile:'saved.webm'}),false);
  assert.equal(isHighlighted({rects:[],quote:''}),false);
});

test('legacy standalone highlights remain visible',()=>{
  assert.equal(isHighlighted(passage),true);
});

test('explicit highlight choice is independent of thought content',()=>{
  assert.equal(isHighlighted({...passage,highlight:false}),false);
  assert.equal(isHighlighted({...passage,highlight:true,comment:'A thought',audioFile:'saved.webm'}),true);
});

test('duplicate PDF word boxes join into one continuous highlight strip',()=>{
  const fragments=[{x:.1,y:.2,w:.08,h:.02},{x:.1,y:.2,w:.08,h:.02},{x:.184,y:.201,w:.09,h:.019},{x:.273,y:.2,w:.06,h:.02}];
  const strips=mergeHighlightRects(fragments);
  assert.equal(strips.length,1);
  assert.equal(strips[0].x,.1);
  assert.equal(strips[0].y,.2);
  assert.ok(Math.abs(strips[0].w-.233)<1e-10);
  assert.ok(Math.abs(strips[0].h-.02)<1e-10);
});

test('highlight strips preserve line breaks and gaps between columns',()=>{
  const strips=mergeHighlightRects([
    {x:.1,y:.2,w:.15,h:.02},{x:.6,y:.2,w:.15,h:.02},
    {x:.1,y:.23,w:.1,h:.02},{x:.205,y:.231,w:.1,h:.019}
  ]);
  assert.equal(strips.length,3);
  assert.equal(strips[0].x,.1);
  assert.equal(strips[1].x,.6);
  assert.equal(strips[2].y,.23);
});

test('display merging leaves original saved anchors untouched',()=>{
  const fragments=[{x:.1,y:.2,w:.08,h:.02},{x:.185,y:.2,w:.09,h:.02}];
  const original=structuredClone(fragments);
  const strips=mergeHighlightRects(fragments);
  assert.deepEqual(fragments,original);
  assert.notEqual(strips[0],fragments[0]);
});

test('reading preferences default to a closed sidebar and retain explicit choices',()=>{
  assert.deepEqual(readingPreferences(),{readerSidebar:false,readerExpanded:false,highlightColor:'amber'});
  assert.deepEqual(readingPreferences({readerSidebar:true,readerExpanded:true,highlightColor:'blue'}),{readerSidebar:true,readerExpanded:true,highlightColor:'blue'});
  assert.deepEqual(readingPreferences({readerSidebar:'true',readerExpanded:1,highlightColor:'invalid'}),{readerSidebar:false,readerExpanded:false,highlightColor:'amber'});
});

test('quick highlighting saves the passage and color without creating a thought draft',()=>{
  const selection={page:2,quote:'A selected passage',rects:passage.rects,anchor:{start:1,end:19},toolbar:{left:20,top:30},comment:'Unrelated draft',audioMode:true};
  const highlight=createHighlightDraft('document-id',selection,'sage');
  assert.equal(highlight.docId,'document-id');
  assert.equal(highlight.page,2);
  assert.equal(highlight.highlight,true);
  assert.equal(highlight.color,'sage');
  assert.deepEqual(highlight.rects,selection.rects);
  assert.deepEqual(highlight.anchor,selection.anchor);
  assert.equal(highlight.quote,selection.quote);
  assert.equal(highlight.comment,'');
  assert.equal(highlight.transcript,'');
  assert.equal('toolbar' in highlight,false);
  assert.equal('audioMode' in highlight,false);
});

test('continuous reading positions preserve the within-page location when the paper resizes',()=>{
  const saved=normalizeReadingPosition({page:4,zoom:1.2,scroll:500,scrollRatio:.5},14);
  assert.equal(saved.page,4);
  assert.equal(offsetForReadingPosition(saved,1000),500);
  assert.equal(offsetForReadingPosition(saved,1600),800);
  assert.equal(offsetForReadingPosition({scroll:120},1000),120);
  assert.deepEqual(normalizeReadingPosition({page:Infinity,zoom:NaN,scroll:Infinity},14),{page:1,zoom:1,scroll:0});
  assert.deepEqual(normalizeReadingPosition({page:99,zoom:8,scroll:-5,scrollRatio:4},4),{page:4,zoom:2.5,scroll:-5,scrollRatio:1});
  const boundary=normalizeReadingPosition({page:2,scroll:-100,scrollRatio:-.1},4);
  assert.equal(offsetForReadingPosition(boundary,1000),-100);
  assert.equal(offsetForReadingPosition(boundary,1500),-150);
});

test('citation page references distinguish the printed page label from PDF position',()=>{
  assert.equal(pageReference({page:2,pageLabel:'235'}),'Page 235 · PDF page 2');
  assert.equal(pageReference({page:2,pageLabel:null}),'PDF page 2');
  assert.equal(pageReference({page:null}),'Document thought');
});
