import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const cls='00000000-0000-4000-8000-000000000001',task='00000000-0000-4000-8000-000000000002',student='00000000-0000-4000-8000-000000000003',foreign='00000000-0000-4000-8000-000000000099';
let identity,dbCalls=0,writes=[],samples=0,evaluations=0,failTts=false,duplicateCreate=false;
const reset=()=>{identity={allowed:true,email:'teacher@example.test'};dbCalls=0;writes=[];samples=0;evaluations=0;failTts=false;duplicateCreate=false;};reset();
const fixtures={teachers:[{id:'t1',email:'teacher@example.test',status:'approved',role:'teacher'}],classes:[{id:cls,name:'가상 반',teacher_id:'t1'}],assignments:[{id:task,class_id:cls,title:'Test',passage_text:'Hello world.',max_attempts:1,sample_voice:'coral',sample_audio_url:'https://example.test/old.mp3'}],students:[{id:student,name:'가상',class_id:cls,status:'approved'}],submissions:[{id:'sub',assignment_id:task,student_id:student,status:'evaluated',overall_score:0,azure_scores:{pronunciation:0,words:[]},audio_path:'private.wav',attempt_count:1}]};
function database(){dbCalls++;return {storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://example.test/signed'},error:null})})},from(table){let filters=[],write=null;const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},limit(){return q;},maybeSingle(){return finish(true);},single(){return finish(true);},insert(value){write={insert:value};return q;},update(value){write={update:value};return q;},delete(){write={delete:true};return q;},then(resolve){return finish(false).then(resolve);}};
 async function finish(single){let data=(fixtures[table]||[]).filter(row=>filters.every(([k,v])=>row[k]===v));if(write){writes.push({table,filters,...write});if(write.insert){if(duplicateCreate)return {data:null,error:{code:'23505'}};data=[{id:write.insert.id||task}];}}return {data:single?data[0]||null:data,error:null,count:data.length};}return q;}};}
const original=Module._load;
Module._load=function(id,parent,isMain){
 if(id==='server-only')return {};
 if(id==='next/cache')return {revalidatePath:()=>{}};
 if(id==='@/lib/supabase/admin')return {createAdminClient:database};
 if(id==='@/lib/class-access')return {sharedClassIds:async()=>({manage:[],viewOnly:[],all:[]}),accessFor:(_id,owner)=>({canView:owner,canManage:owner})};
 if(id==='@/lib/ai/assignment-samples')return {generateAndStoreSamples:async()=>{samples++;if(failTts)throw Error('fixture');}};
 if(id==='@/lib/ai/evaluate')return {BROKEN_FEEDBACK:[],evaluateSubmission:async()=>{evaluations++;},regenerateFeedback:async()=>{evaluations++;}};
 if(id.startsWith('@/'))return original.call(this,path.join(root,'src',id.slice(2)),parent,isMain);
 return original.call(this,id,parent,isMain);
};
const {POST}=require(path.join(root,'src/app/api/learning-portal/teacher-assignment/route.ts'));
const {createSpeakingAssignment}=require(path.join(root,'src/lib/create-speaking-assignment.ts'));
Module._load=original;
const savedFetch=global.fetch;global.fetch=async()=>Response.json(identity);
const request=(intent,extra={})=>new Request('https://example.test/api/learning-portal/teacher-assignment',{method:'POST',body:JSON.stringify({proof:'fixture',intent,classId:cls,assignmentId:task,studentId:student,...extra})});
test('unauthenticated and foreign teacher/class/assignment/student requests cannot disclose data',async()=>{
 reset();assert.equal((await POST(request('report',{proof:null}))).status,401);assert.equal(dbCalls,0);
 identity={allowed:false,email:'teacher@example.test'};assert.equal((await POST(request('report'))).status,403);assert.equal(dbCalls,0);
 reset();assert.equal((await POST(request('report',{classId:foreign}))).status,404);assert.equal((await POST(request('report',{assignmentId:foreign}))).status,404);assert.equal((await POST(request('report',{studentId:foreign}))).status,404);
 fixtures.classes[0].teacher_id='other';assert.equal((await POST(request('assignment'))).status,403);fixtures.classes[0].teacher_id='t1';assert.equal(writes.length,0);
});
test('report loads one student, preserves a zero score, and never sends private audio paths',async()=>{
 reset();const response=await POST(request('report')),data=await response.json();assert.equal(response.status,200);assert.equal(data.submission.overall_score,0);assert.equal(data.audioUrl,'https://example.test/signed');assert.equal(data.submission.audio_path,undefined);assert.equal(data.canManage,true);assert.equal(samples+evaluations,0);
});
test('delegated teacher and supervisor can read but cannot mutate; owner saves only scoped submission',async()=>{
 reset();identity.viewOnly=true;assert.equal((await POST(request('report'))).status,200);assert.equal((await POST(request('saveReview',{feedback:'Test',reviewed:true}))).status,403);assert.equal(writes.length,0);
 identity={allowed:true,email:'head@example.test',supervisor:true};assert.equal((await POST(request('assignment'))).status,200);assert.equal((await POST(request('delete'))).status,403);
 reset();assert.equal((await POST(request('saveReview',{feedback:'Test',reviewed:true}))).status,200);assert.deepEqual(writes[0].update,{teacher_feedback:'Test',teacher_reviewed:true});assert.ok(writes[0].filters.some(([k,v])=>k==='assignment_id'&&v===task));
});
test('editing the text uses atomic Google samples; voice options never offer OpenAI',async()=>{
 reset();const env={WAVENET_TEST_ENABLED:'true',GOOGLE_CLOUD_PROJECT:'yuspeaking-tts-test',YUSPEAKING_TEST_DATA_ONLY:'true',NODE_ENV:'test'};Object.assign(process.env,env);delete process.env.VERCEL;
 const detail=await(await POST(request('assignment'))).json();assert.ok(detail.voices.length);assert.ok(detail.voices.every(v=>v.id.startsWith('en-US-Wavenet-')));
 assert.equal((await POST(request('regenerate',{voice:'coral'}))).status,400);assert.equal(samples,0);
 assert.equal((await POST(request('update',{title:'Test',passage:'A new passage.',dueDate:''}))).status,200);assert.equal(samples,1);assert.equal(writes.length,0);
 failTts=true;assert.equal((await POST(request('update',{title:'Test',passage:'Another passage.',dueDate:''}))).status,503);assert.equal(writes.length,0);
});
test('popup retries do not duplicate a task/TTS; TTS failure returns its created ID for recovery',async()=>{
 reset();const form=new FormData();Object.entries({classId:cls,title:'Test',passage_text:'Hello.',voice:'en-US-Wavenet-F',requestId:task}).forEach(([k,v])=>form.set(k,v));
 let result=await createSpeakingAssignment(database(),form);assert.equal(result.id,task);assert.equal(samples,1);
 duplicateCreate=true;result=await createSpeakingAssignment(database(),form);assert.equal(result.id,task);assert.equal(samples,1);
 duplicateCreate=false;failTts=true;result=await createSpeakingAssignment(database(),form);assert.equal(result.id,task);assert.ok(result.warning);
 global.fetch=savedFetch;
});
