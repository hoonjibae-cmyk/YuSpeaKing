import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const original=Module._load;Module._load=function(id,parent,isMain){if(id==='server-only')return {};return original.call(this,id,parent,isMain);};
const {NextRequest}=require('next/server');const {startPortalLogin,exchangePortalCode}=require(path.join(repo,'src/lib/learning-portal.ts'));
test('disabled bridge leaves existing login untouched and does not call the network',()=>{delete process.env.LEARNING_PORTAL_ENABLED;assert.equal(startPortalLogin('speaking').status,503);});
function transaction(client='speaking'){process.env.LEARNING_PORTAL_ENABLED='true';const response=startPortalLogin(client),cookie=response.cookies.get('learning_portal_transaction');const url=new URL(response.headers.get('location'));return {cookie,url,request:new NextRequest('https://'+(client==='speaking'?'yuspeaking':'voca')+'.yussam.com/api/learning-portal/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-code'}),{headers:{Cookie:cookie.name+'='+cookie.value}})};}
test('bridge uses host-only HttpOnly transaction cookie, S256 and fixed redirect URI',()=>{const {cookie,url}=transaction();assert.equal(url.origin,'https://yussam-learning-portal.vercel.app');assert.equal(url.searchParams.get('redirect_uri'),'https://yuspeaking.yussam.com/api/learning-portal/callback');assert.match(url.searchParams.get('code_challenge'),/^[\w-]{43}$/);assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert.equal(cookie.domain,undefined);});
test('wrong state is rejected before exchange',async()=>{const {cookie}=transaction();const request=new NextRequest('https://yuspeaking.yussam.com/api/learning-portal/callback?state=wrong&code=synthetic',{headers:{Cookie:cookie.name+'='+cookie.value}});await assert.rejects(exchangePortalCode(request,'speaking'),/로그인 요청/);});
test('successful server exchange is audience-bound and rejects test or malformed identities',async()=>{const saved=global.fetch;try{const {request}=transaction();let value={subject:'card:123',card_id:'123',audience:'speaking',is_test:false};global.fetch=async(url,options)=>{assert.equal(url,'https://yussam-learning-portal.vercel.app/oauth/token');assert.equal(JSON.parse(options.body).client_id,'speaking');return {ok:true,json:async()=>value};};assert.equal((await exchangePortalCode(request,'speaking')).card_id,'123');for(const change of [{is_test:true},{audience:'voca'},{card_id:'other'},{subject:'card:999'}]){const tx=transaction();value={subject:'card:123',card_id:'123',audience:'speaking',is_test:false,...change};await assert.rejects(exchangePortalCode(tx.request,'speaking'),/학생카드/);}}finally{global.fetch=saved;delete process.env.LEARNING_PORTAL_ENABLED;}});

test('synthetic app callback accepts only isolated preview identities and never real sessions',async()=>{
 const saved=global.fetch;try{
  let value={is_test:true,card_id:null,audience:'speaking-preview',preview_token:'a'.repeat(43)};
  global.fetch=async()=>({ok:true,json:async()=>value});
  const tx=transaction('speaking-preview');assert.equal(tx.url.searchParams.get('redirect_uri'),'https://yuspeaking.yussam.com/api/learning-portal/callback?preview=1');
  assert.equal((await exchangePortalCode(tx.request,'speaking-preview')).preview_token,value.preview_token);
  for(const change of [{is_test:false},{card_id:'123'},{audience:'voca-preview'},{preview_token:'invalid'}]){value={is_test:true,card_id:null,audience:'speaking-preview',preview_token:'a'.repeat(43),...change};await assert.rejects(exchangePortalCode(transaction('speaking-preview').request,'speaking-preview'),/가상 학생/);}
 }finally{global.fetch=saved;delete process.env.LEARNING_PORTAL_ENABLED;}
});
