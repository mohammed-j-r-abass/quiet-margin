import {config} from './store.mjs';
import {normalizeEndpoint,sameProvider} from './provider-config.mjs';

export class ProviderError extends Error {
  constructor(message,providerStatus,code,action,retryAfter=null){super(message);this.providerStatus=providerStatus;this.code=code;this.action=action;this.retryAfter=retryAfter;}
}
const billingCodes=new Set(['insufficient_quota','credit_balance_exhausted','billing_hard_limit_reached','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','quota_exceeded']);
export function providerError(status,payload,retryHeader){
  const err=payload?.error||{},code=String(err.code||''),type=String(err.type||''),message=String(err.message||'').toLowerCase();
  const seconds=Number(retryHeader),retryAfter=Number.isFinite(seconds)&&seconds>0?Math.min(Math.ceil(seconds),3600):null;
  if(status===429){
    if(billingCodes.has(code)||billingCodes.has(type)||/billing|credits? (?:balance|exhaust|deplet)|current quota|insufficient.?quota|spend limit/.test(message)){
      const reason=code==='project_spend_limit_exceeded'?'The API project has reached its spending limit.':code==='organization_spend_limit_exceeded'?'The API organization has reached its spending limit.':code==='organization_usage_limit_exceeded'?'The API organization has reached its approved usage limit.':'The provider reports exhausted API credits or quota.';
      return new ProviderError(`${reason} Check API billing/credits and project limits in your provider dashboard. A key alone does not supply API credit. Changing the model will not fix exhausted billing quota.`,status,code&&billingCodes.has(code)?code:'insufficient_quota','billing');
    }
    return new ProviderError(`The provider rate limit was reached (HTTP 429). ${retryAfter?'Wait at least '+retryAfter+' seconds':'Wait briefly'} before retrying. Reduce the search scope or check your model’s request/token limits. If this persists, check API credits and project limits.`,status,'rate_limit_exceeded','wait',retryAfter);
  }
  if(status===401)return new ProviderError('The provider rejected this API key (HTTP 401). Check the key and that it belongs to this endpoint.',401,'invalid_api_key','key');
  if(status===403)return new ProviderError('This key does not have permission for the requested model or API operation (HTTP 403). Check project/model permissions and provider access.',status,'permission_denied','permissions');
  if(status===404)return new ProviderError('The requested model or API route was not found (HTTP 404). Check the exact model ID and the OpenAI-compatible endpoint. Use Load models or Test model to check access.',status,'model_or_endpoint_not_found','model');
  if(status===400||status===422)return new ProviderError('The provider rejected the request. Check that this model supports Chat Completions and that the model name and endpoint match. Embeddings require an embedding model, not a chat model.',status,'invalid_provider_request','model');
  if(status>=500)return new ProviderError(`The provider is temporarily unavailable (HTTP ${status}). Try again later. Your saved material is safe.`,status,'provider_unavailable','wait',retryAfter);
  return new ProviderError(`The provider returned HTTP ${status}. Check the endpoint and provider settings. Your saved material is safe.`,status,'provider_error','settings');
}
export async function request(base,key,route,body,{method='POST',timeout=90000}={}){
  let response;
  try{response=await fetch(normalizeEndpoint(base)+route,{method,headers:{...(key?{Authorization:'Bearer '+key}:{}),...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(timeout),redirect:'error'});}
  catch{throw new ProviderError('The provider could not be reached. Check the endpoint and connection. Your saved material is safe.',null,'connection_failed','endpoint');}
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw providerError(response.status,data,response.headers.get('retry-after'));
  if(!data||typeof data!=='object')throw new ProviderError('The endpoint returned no valid JSON. Use an OpenAI-compatible API endpoint, rather than the provider’s website.',response.status,'invalid_response','endpoint');
  return data;
}
export function resolveConnection(input={}){
  const saved=config(),endpoint=normalizeEndpoint(input.endpoint===undefined?saved.endpoint:input.endpoint);
  const supplied=typeof input.apiKey==='string'?input.apiKey.trim():'';
  if(!supplied&&saved.apiKey&&!sameProvider(endpoint,saved.endpoint))throw new Error('Enter an API key for the new endpoint. The saved key is not sent to another provider automatically.');
  const c={...saved,endpoint,apiKey:supplied||saved.apiKey,chatModel:typeof input.chatModel==='string'?input.chatModel.trim():saved.chatModel};
  if(!c.apiKey)throw new Error('Enter an API key, or a placeholder key if your local provider does not require authentication.');
  return c;
}
export async function listModels(input){
  const c=resolveConnection(input),result=await request(c.endpoint,c.apiKey,'/models',undefined,{method:'GET',timeout:30000});
  if(!Array.isArray(result.data))throw new Error('This provider does not expose a standard model list. Enter the model name manually and use Test model.');
  const models=[...new Set(result.data.map(m=>m?.id).filter(id=>typeof id==='string'&&id.length<=250))].sort();
  return {models,endpoint:c.endpoint,message:'These IDs are advertised by your provider. Test model checks chat access and available quota.'};
}
export async function testConnection(input){
  const c=resolveConnection(input);if(!c.chatModel)throw new Error('Enter a chat model name to test.');
  const r=await request(c.endpoint,c.apiKey,'/chat/completions',{model:c.chatModel,messages:[{role:'user',content:'Connection test only. Reply with the word OK.'}]},{timeout:60000});
  if(typeof r.choices?.[0]?.message?.content!=='string'||!r.choices[0].message.content.trim())throw new Error('The model did not return chat text. Choose a model that supports Chat Completions.');
  return {ok:true,endpoint:c.endpoint,model:c.chatModel,message:'Chat model responded successfully. No documents or notes were sent.'};
}
