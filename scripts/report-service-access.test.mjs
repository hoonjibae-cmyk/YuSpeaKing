import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
let reads=0;const db={from(table){reads++;const q={};for(const method of ['select','eq','limit','is'])q[method]=()=>q;q.maybeSingle=()=>Promise.resolve({data:{id:'speaking-class'},error:null});q.then=yes=>Promise.resolve({data:[{class_id:'speaking-class'}],error:null}).then(yes);return q;}};
const original=Module._load;Module._load=function(name,parent,main){if(name==='server-only')return {};if(name==='@/lib/supabase/admin')return {createAdminClient:()=>db};return original.call(this,name,parent,main);};const {reportServiceClasses}=require(path.join(repo,'src/lib/report-service-access.ts'));Module._load=original;
test('a report capability authorizes only the exact class/date scope and has no fallback to unrestricted access',async()=>{
 const old=global.fetch,scope={cardClassId:'card-class',from:'2026-11-01',until:'2026-12-01',serviceTicket:'fixture'};
 try{global.fetch=async()=>Response.json({allowed:true,...scope});assert.deepEqual(await reportServiceClasses(scope),[{id:'speaking-class'}]);const count=reads;
 await assert.rejects(reportServiceClasses({...scope,cardClassId:'foreign'}),/AUTH/);await assert.rejects(reportServiceClasses({...scope,until:'2026-12-02'}),/AUTH/);assert.equal(reads,count);
 global.fetch=async()=>Response.json({allowed:false},{status:403});await assert.rejects(reportServiceClasses(scope),/AUTH/);assert.equal(reads,count);
 }finally{global.fetch=old;}
});
