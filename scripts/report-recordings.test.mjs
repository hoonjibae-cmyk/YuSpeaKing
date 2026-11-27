import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const mod={exports:{}};cache.set(file,mod.exports);const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(n=>n==='server-only'?{}:n.startsWith('@/')?load('src/'+n.slice(2)+'.ts'):require(n),mod,mod.exports);return mod.exports;}
process.env.SUPABASE_SERVICE_ROLE_KEY='report-recording-test-only';process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';
const {weeklyRecordings,recordingGrant,verifyRecordingGrant,reportRecordingResponse}=load('src/lib/report-recordings.ts');
const {recordingRetainsUntil}=load('src/lib/recording-retention.ts');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now=Date.parse('2026-11-27T12:00:00Z'),uploadedAt='2026-11-24T02:00:00Z';
const submission=(n=1,assignment=20)=>({id:id(n),student_id:id(n+100),assignment_id:id(assignment),created_at:'2026-11-01T02:00:00Z',updated_at:'2026-11-25T02:00:00Z',status:'evaluated',audio_path:id(assignment)+'/'+id(n+100)+'.wav',audio_expired:false});
const sub=submission(),grant={v:1,id:sub.id,student:sub.student_id,assignment:sub.assignment_id,uploadedAt,expiresAt:Date.parse(recordingRetainsUntil(sub.created_at))};
function database(row=sub,fileAt=uploadedAt){const reads=[],db={reads,from(table){reads.push(['table',table]);const q={};q.select=()=>q;q.eq=(...a)=>{reads.push(a);return q;};q.maybeSingle=async()=>({data:row,error:null});return q;},storage:{from(bucket){assert.equal(bucket,'submissions');return {list:async(folder)=>{reads.push(['folder',folder]);return {data:[{name:sub.student_id+'.wav',updated_at:fileAt}],error:null};},createSignedUrl:async(p,expiry)=>{reads.push(['sign',p,expiry]);return {data:{signedUrl:'https://fixture.supabase.co/storage/v1/object/sign/submissions/'+p+'?token=fixture'},error:null};}};}}};return db;}
test('weekly recordings use real upload time, deduplicate assignments, ignore foreign data and retain original 60-day deadline',async()=>{
 const rows=[{...sub,teacher_feedback:'Reviewed feedback',teacher_reviewed:true},{...sub,id:id(9),updated_at:'2026-11-24T02:00:00Z',teacher_feedback:'Old duplicate feedback',teacher_reviewed:true},submission(2),submission(3),{...submission(4),created_at:'2026-09-01T02:00:00Z',teacher_feedback:'Unreviewed private draft',teacher_reviewed:false},submission(5,99)];
 let lists=0;const fileDates={[id(101)]:uploadedAt,[id(102)]:'2026-11-22T14:59:59Z',[id(103)]:'2026-11-30T00:00:00Z',[id(104)]:uploadedAt};
 const db={storage:{from(){return {list:async folder=>{lists++;assert.equal(folder,id(20));return {data:Object.entries(fileDates).map(([name,updated_at])=>({name:name+'.wav',updated_at})),error:null};}};}}};
 const result=await weeklyRecordings(db,[{id:id(20),title:'Fixture'}],rows,'2026-11-23','2026-11-30',now);
 assert.equal(lists,1);assert.equal(result.get(id(101)).recordings.length,1);assert.equal(result.get(id(101)).recordings[0].id,sub.id);
 assert.equal(result.get(id(101)).recordings[0].retainsUntil,'2026-12-31T02:00:00.000Z');
 assert.equal(result.get(id(101)).recordings[0].teacherFeedback,'Reviewed feedback');assert.equal(result.get(id(104)).recordings[0].teacherFeedback,null);
 assert.equal(result.get(id(102)).recordings.length,0);assert.equal(result.get(id(103)).recordings.length,0);assert.equal(result.get(id(104)).recordings[0].audioUrl,null);assert.equal(result.has(id(105)),false);
 assert.equal(verifyRecordingGrant(new URL(result.get(id(101)).recordings[0].audioUrl).searchParams.get('token'),now).uploadedAt,uploadedAt);
});
test('recording capabilities reject altered/expired tokens before DB, wrong subjects and overwritten files',async()=>{
 const token=recordingGrant(grant),url='https://fixture.test?token=';
 assert.equal(verifyRecordingGrant(token,now).student,sub.student_id);assert.throws(()=>verifyRecordingGrant(token,grant.expiresAt));
 const db=database();for(const value of ['wrong',token.slice(0,-1)+(token.endsWith('a')?'b':'a'),recordingGrant({...grant,expiresAt:now})])assert.equal((await reportRecordingResponse(new Request(url+value),db,now)).status,404);
 assert.equal(db.reads.length,0);
 for(const restricted of [database({...sub,student_id:id(999)}),database({...sub,audio_expired:true}),database(sub,'2026-11-25T02:00:00Z')]){
  assert.equal((await reportRecordingResponse(new Request(url+token),restricted,now)).status,404);assert.ok(!restricted.reads.some(r=>r[0]==='sign'));
 }
});
test('private audio is streamed with byte ranges without a public bucket or storage redirect',async()=>{
 const previousFetch=global.fetch,db=database();global.fetch=async(url,options)=>{assert.equal(new URL(url).host,'fixture.supabase.co');assert.equal(options.headers.Range,'bytes=2-4');assert.equal(options.redirect,'error');return new Response(new Uint8Array([2,3,4]),{status:206,headers:{'content-range':'bytes 2-4/10','content-length':'3'}});};
 try{const response=await reportRecordingResponse(new Request('https://fixture.test?token='+recordingGrant(grant),{headers:{Range:'bytes=2-4'}}),db,now);assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 2-4/10');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('location'),null);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[2,3,4]);assert.ok(db.reads.some(r=>r[0]==='student_id'&&r[1]===sub.student_id));assert.ok(db.reads.some(r=>r[0]==='sign'&&r[2]===60));}finally{global.fetch=previousFetch;}
});
