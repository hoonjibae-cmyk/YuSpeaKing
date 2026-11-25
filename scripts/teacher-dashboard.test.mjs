import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),speaking=require(path.join(repo,'package.json')).name==='yuspeaking';
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
let allowed=true,duplicate=false,dbCalls=0;const filters=[];
function database(){dbCalls++;return {from(table){let selection='',conditions=[];const q={select(s){selection=s;return q;},eq(k,v){conditions.push([k,v]);filters.push([table,k,v]);return q;},in(){return q;},is(){return q;},not(){return q;},order(){return q;},limit(){return q;},then(resolve){let data=[];
if(table==='teachers')data=[{id:'teacher-own',email:'teacher@example.test',slack_email:null,status:'approved',role:'teacher'}];
if(table==='profiles')data=[{id:'teacher-own',work_email:'teacher@example.test',hr_emp_no:'fake-emp',role:'teacher',is_active:true}];
if(duplicate&&['teachers','profiles'].includes(table))data.push({...data[0],id:'other-teacher'});
if(table==='classes'){assert.ok(conditions.some(([k,v])=>k==='teacher_id'&&v==='teacher-own'));data=[{id:'00000000-0000-4000-8000-000000000001',name:'가상 반',teacher_id:'teacher-own'}];}
if(table==='students')data=[{id:'student-own',name:'가상 학생',hr_student_id:'123'}];
if(table==='class_links')data=[{class_id:'00000000-0000-4000-8000-000000000001',hr_class_id:'aca:123'}];
if(table==='class_memberships')data=[{user_id:'student-own'}];
if(table==='assignments')data=[{id:'own-assignment',title:'가상 과제',due_date:null,due_at:null}];
if(table==='submissions')data=[{student_id:'student-own',status:'submitted'},{student_id:'foreign-student',status:'submitted'}];
if(table==='study_sessions')data=[{student_id:'student-own'},{student_id:'foreign-student'}];
return Promise.resolve(resolve({data,error:null}));}};return q;}};}
const original=Module._load;Module._load=function(id,parent,isMain){if(id==='@/lib/supabase/admin')return {createAdminClient:database};if(id==='@/lib/transfers')return {coTaughtClassIds:async()=>[]};return original.call(this,id,parent,isMain);};
const {POST}=require(path.join(repo,'src/app/api/learning-portal/teacher-dashboard/route.ts'));Module._load=original;
const saved=global.fetch;global.fetch=async(url,options)=>{assert.equal(url,'https://portal.yussam.com/api/learning-access');assert.equal(JSON.parse(options.body).proof,'fixture');return allowed?Response.json({allowed:true,empNo:'fake-emp',email:'teacher@example.test'}):new Response('{}',{status:403});};
function request(input={proof:'fixture',teacherId:'foreign-teacher'}){return new Request('https://example.test/api/learning-portal/teacher-dashboard',{method:'POST',body:JSON.stringify(input)});}
test('unauthenticated and denied portal identities cannot access the source DB',async()=>{dbCalls=0;assert.equal((await POST(request({}))).status,401);allowed=false;assert.equal((await POST(request())).status,403);assert.equal(dbCalls,0);allowed=true;});
test('ambiguous source teacher mapping is denied',async()=>{duplicate=true;assert.equal((await POST(request())).status,403);duplicate=false;});
test('source scopes by verified staff, excludes foreign students, and returns counts without student fields',async()=>{const response=await POST(request());assert.equal(response.status,200);const body=await response.json();assert.equal(body.classes.length,1);assert.equal(body.classes[0].studentCount,1);assert.equal(speaking?body.classes[0].assignments[0].completedCount:body.classes[0].todayCompletedCount,1);assert.ok(filters.some(([table,key,value])=>table==='classes'&&key==='teacher_id'&&value==='teacher-own'));assert.equal(JSON.stringify(body).includes('student-own'),false);});

test('class detail rechecks source authorization and returns only its current approved members',async()=>{const valid='00000000-0000-4000-8000-000000000001';const r=await POST(request({proof:'fixture',class_id:valid}));assert.equal(r.status,200);const data=await r.json();assert.equal(data.classes[0].members[0].name,'가상 학생');assert.deepEqual(data.classes[0].assignments[0].completedStudentIds,['student-own']);assert.equal(data.classes[0].cardClassId,'aca:123');assert.equal((await POST(request({proof:'fixture',class_id:'00000000-0000-4000-8000-000000000099'}))).status,404);global.fetch=saved;});
