import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url),{test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {NextRequest,NextResponse}=require('next/server');
let identity,row,dbError,lookups,sessions;
function reset(){identity={card_id:'123',is_test:false};row={id:'synthetic-speaking-id',name:'가상 학생',number:7,class_id:'synthetic-class',status:'approved',classes:{archived_at:null}};dbError=null;lookups=[];sessions=[];}
const original=Module._load;Module._load=function(id,parent,isMain){
 if(id==='@/lib/learning-portal')return {exchangePortalCode:async()=>identity,clearPortalTransaction:r=>r,setPortalUiCookie:r=>r,setPreviewCookie:(r,t)=>{r.cookies.set('preview-test-cookie',t);return r;}};
 if(id==='@/lib/student-session')return {setStudentSession:async s=>sessions.push(s)};
 if(id==='@/lib/supabase/admin')return {createAdminClient:()=>({from:table=>({select:()=>({eq:(field,value)=>{lookups.push({table,field,value});return {maybeSingle:async()=>({data:row,error:dbError})};}})})})};
 return original.call(this,id,parent,isMain);
};
const {GET}=require(path.join(repo,'src/app/api/learning-portal/callback/route.ts'));
Module._load=original;
test('only explicitly bound synthetic identity gets its own approved cardless student session',async()=>{
 process.env.PORTAL_TEST_VOCA_SUBJECT='fixture-auth';process.env.PORTAL_TEST_SPEAKING_STUDENT='fixture-student';
 try{for(const invalid of ['none','subject','card','status','archive']){reset();identity={is_test:true,card_id:null,subject:'test:voca:fixture-auth',test_auth_subject:'fixture-auth'};row.id='fixture-student';row.hr_student_id=null;if(invalid==='subject')identity.test_auth_subject='other';if(invalid==='card')row.hr_student_id='123';if(invalid==='status')row.status='pending';if(invalid==='archive')row.classes.archived_at='2026-01-01';const r=await GET(new NextRequest('https://yuspeaking.yussam.com/api/learning-portal/callback?studentId=other'));assert.equal(r.status,invalid==='none'?307:403);assert.equal(sessions.length,invalid==='none'?1:0);assert.deepEqual(lookups,invalid==='subject'?[]:[{table:'students',field:'id',value:'fixture-student'}]);}}finally{delete process.env.PORTAL_TEST_VOCA_SUBJECT;delete process.env.PORTAL_TEST_SPEAKING_STUDENT;}
});
