import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsToken,webDocument} from '../build-web.mjs';

const html='<!doctype html><html><head><title>Quiet Margin</title></head><body><div id="root"></div></body></html>';
const token='0123456789abcdef0123456789abcdef';

test('desktop builds never enable analytics even with a configured token',()=>{
  assert.equal(analyticsToken(false,token),'');
  assert.equal(analyticsToken(false,'private-account-key'),'');
});

test('a missing website token keeps external analytics scripts blocked',()=>{
  const document=webDocument(html);
  assert.equal(document.includes('cloudflare'),false);
  assert.ok(document.includes("script-src 'self' 'wasm-unsafe-eval';"));
  assert.ok(document.includes('name="referrer" content="no-referrer"'));
});

test('the public build includes only the official beacon with reader navigation tracking disabled',()=>{
  const document=webDocument(html,token);
  const scripts=[...document.matchAll(/<script[^>]+>/g)];
  assert.equal(scripts.length,1);
  assert.ok(scripts[0][0].includes('src="https://static.cloudflareinsights.com/beacon.min.js"'));
  const data=JSON.parse(scripts[0][0].match(/data-cf-beacon='([^']+)'/)[1]);
  assert.deepEqual(data,{token,spa:false});
  assert.ok(document.includes("script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com/beacon.min.js;"));
  assert.ok(document.includes('name="referrer" content="strict-origin"'));
  for(const directive of ["object-src 'none'","base-uri 'none'","form-action 'none'"]){
    assert.ok(document.includes(directive));
  }
});

test('account credentials and script injection cannot be inserted as site tokens',()=>{
  for(const invalid of ['account-api-key','Bearer secret',"'><script>alert(1)</script>",token+' extra']){
    assert.throws(()=>webDocument(html,invalid),/public Cloudflare Web Analytics site token/);
  }
  assert.equal(analyticsToken(true,' '+token+' '),token);
});
