import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {NextRequest}=require('next/server');let status='evaluating',fail=false,reads=[];const id='00000000-0000-4000-8000-000000000001';const original=Module._load;
Module._load=function(name,parent,main){
 if(name==='@/lib/learning-portal-report')return {verifyPortalIdentity:async token=>{assert.equal(token,'Bearer fixture');return {cardId:'123',userId:'own-auth',isTest:false};}};
 if(name==='@/lib/date')return {todayKST:()=> '2026-11-25'};
 if(name==='@/lib/supabase/admin')return {createAdminClient:()=>({from(table){const filters=[];reads.push({table,filters});const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},limit(){return q;},maybeSingle(){return q;},then(fn){return Promise.resolve({error:fail?{}:null,data:table==='students'?{id:'own-student',class_id:'own-class',status:'approved',classes:{archived_at:null}}:table==='assignments'?[{id,title:'가상 과제',due_date:'2026-11-24'}]:[{assignment_id:id,status}]}).then(fn);}};return q;}})};
 return original.call(this,name,parent,main);
};const {GET}=require(path.join(repo,'src/app/api/learning-portal/student-tasks/route.ts'));Module._load=original;
test('task source scopes Card/student/class server-side and re-reads submissions without writes',async()=>{
 const req=()=>new NextRequest('https://yuspeaking.yussam.com/api/learning-portal/student-tasks?student_id=foreign&class_id=foreign',{headers:{Authorization:'Bearer fixture'}});
 let data=await(await GET(req())).json();assert.equal(data.tasks[0].completed,true);assert.equal(data.tasks[0].overdue,true);assert.deepEqual(reads.slice(0,3),[{table:'students',filters:[['hr_student_id','123']]},{table:'assignments',filters:[['class_id','own-class']]},{table:'submissions',filters:[['student_id','own-student']]}]);
 status='error';data=await(await GET(req())).json();assert.equal(data.tasks[0].completed,false);fail=true;assert.notEqual((await GET(req())).status,200);
});
