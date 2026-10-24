import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'quiet-margin-provider-test-'));
const {normalizeEndpoint}=await import('../server/provider-config.mjs');
const {providerError,listModels,testConnection,resolveConnection}=await import('../server/provider.mjs');
const {db,updateConfig,publicConfig}=await import('../server/store.mjs');

test('distinguish billing quota, rate limits, and model/key errors without exposing provider messages',()=>{
  for(const code of ['credit_balance_exhausted','project_spend_limit_exceeded','organization_spend_limit_exceeded','organization_usage_limit_exceeded','insufficient_quota']){
    const e=providerError(429,{error:{code,type:'insufficient_quota',message:'API key sk-secret-and-private'}},null);assert.equal(e.action,'billing');assert.match(e.message,/quota|limit|credits/);assert.doesNotMatch(e.message,/sk-secret/);
  }
  const rate=providerError(429,{error:{code:'rate_limit_exceeded'}},'30');assert.equal(rate.action,'wait');assert.equal(rate.retryAfter,30);assert.match(rate.message,/30 seconds/);
  assert.equal(providerError(401,{error:{message:'sk-secret'}},null).action,'key');
  assert.equal(providerError(404,{error:{}},null).action,'model');
});
test('accept base URLs and full completion URLs; reject embedded credential URLs',()=>{
  assert.equal(normalizeEndpoint('https://api.openai.com'),'https://api.openai.com/v1');
  assert.equal(normalizeEndpoint('https://api.openai.com/v1/chat/completions/'),'https://api.openai.com/v1');
  assert.equal(normalizeEndpoint('http://localhost:1234/v1/'),'http://localhost:1234/v1');
  assert.throws(()=>normalizeEndpoint('https://user:password@example.com/v1'));
  assert.throws(()=>normalizeEndpoint('https://example.com/v1?api_key=secret'));
});
test('discover models and test selected model through the configured endpoint, keeping saved keys server-side',async t=>{
  const requests=[];
  const provider=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();requests.push({url:req.url,method:req.method,key:req.headers.authorization,body});res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'provider/custom-model'},{id:'provider/custom-model'},null,{id:'provider/other-model'}]}));
    res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));
  });
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>provider.close(r)));
  const endpoint=`http://127.0.0.1:${provider.address().port}/v1`;
  updateConfig({endpoint,apiKey:'private-test-key',chatModel:'provider/custom-model'});
  const models=await listModels({endpoint:endpoint+'/chat/completions'});assert.deepEqual(models.models,['provider/custom-model','provider/other-model']);
  const result=await testConnection({chatModel:'provider/other-model'});assert.equal(result.ok,true);assert.equal(result.model,'provider/other-model');
  assert.equal(requests[0].method,'GET');assert.equal(requests[1].key,'Bearer private-test-key');
  const payload=JSON.parse(requests[1].body);assert.equal(payload.model,'provider/other-model');assert.equal(payload.messages.length,1);assert.match(payload.messages[0].content,/Connection test/);assert.equal(publicConfig().apiKey,undefined);
  assert.equal(publicConfig().chatModel,'provider/custom-model','Testing does not change saved selection');
  assert.throws(()=>resolveConnection({endpoint:'https://another-provider.example/v1'}),/Enter an API key/);
  assert.throws(()=>updateConfig({endpoint:'https://another-provider.example/v1'}),/Enter a key/);
  db.close();
});
