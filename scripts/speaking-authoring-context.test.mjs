import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
let identity,adminClients=0,manage=[],viewOnly=[],writes=[];
const klass={id:'class-one',name:'가상 반',teacher_id:'owner'};
function database(privileged){return {from(table){let selectedId;return {select(){return this;},eq(key,value){assert.equal(table,'classes');assert.equal(key,'id');selectedId=value;return this;},async maybeSingle(){const visible=privileged||identity.effectiveId===klass.teacher_id||manage.includes(selectedId)||viewOnly.includes(selectedId);return {data:visible&&selectedId===klass.id?klass:null,error:null};}};}};}
const rls=database(false),admin=database(true);
function reset(role='teacher',effectiveId='owner'){identity={role,effectiveId,db:rls};adminClients=0;manage=[];viewOnly=[];writes=[];}
reset();
const original=Module._load;
Module._load=function(id,parent,isMain){
 if(id==='server-only')return {};
 if(id==='next/cache')return {revalidatePath:()=>{}};
 if(id==='@/lib/teacher-context')return {getTeacherContext:async()=>{if(!identity)throw Error('login required');return identity;}};
 if(id==='@/lib/supabase/admin')return {createAdminClient:()=>{adminClients++;return admin;}};
 if(id==='./transfers')return {coTaughtClassIds:async()=>manage};
 if(id==='./coupon-helpers')return {couponHelperClassIds:async()=>viewOnly};
 if(id==='@/lib/create-speaking-assignment')return {createSpeakingAssignment:async(db,form)=>{writes.push({db,classId:form.get('classId')});return {id:'created-fixture'};}};
 if(id.startsWith('@/'))return original.call(this,path.join(root,'src',id.slice(2)),parent,isMain);
 return original.call(this,id,parent,isMain);
};
const {getSpeakingAuthoringContext}=require(path.join(root,'src/lib/speaking-authoring-context.ts'));
const {createPopupAssignment}=require(path.join(root,'src/app/teacher/classes/[classId]/create/actions.ts'));
Module._load=original;
const form=()=>{const f=new FormData();f.set('classId',klass.id);return f;};

test('administrator can open and create in another teacher class without impersonation',async()=>{
 reset('admin','administrator');
 assert.equal((await rls.from('classes').select().eq('id',klass.id).maybeSingle()).data,null);
 const context=await getSpeakingAuthoringContext(klass.id);
 assert.equal(context.klass.name,'가상 반');assert.equal(context.db,admin);
 const result=await createPopupAssignment(form());assert.equal(result.id,'created-fixture');assert.equal(writes[0].db,admin);assert.equal(writes[0].classId,klass.id);
 assert.equal(await getSpeakingAuthoringContext('missing'),null);
});

test('owner and co-teacher keep the scoped client, while other teachers and read-only helpers cannot author',async()=>{
 reset();assert.equal((await getSpeakingAuthoringContext(klass.id)).db,rls);
 reset('teacher','co-teacher');manage=[klass.id];assert.equal((await getSpeakingAuthoringContext(klass.id)).db,rls);assert.equal(adminClients,0);
 reset('teacher','other');assert.equal(await getSpeakingAuthoringContext(klass.id),null);assert.ok((await createPopupAssignment(form())).error);assert.equal(writes.length,0);assert.equal(adminClients,0);
 viewOnly=[klass.id];assert.equal(await getSpeakingAuthoringContext(klass.id),null);assert.ok((await createPopupAssignment(form())).error);assert.equal(writes.length,0);assert.equal(adminClients,0);
});

test('save rechecks the current teacher and unauthenticated requests never create a privileged client',async()=>{
 reset();await getSpeakingAuthoringContext(klass.id);identity.effectiveId='other';assert.ok((await createPopupAssignment(form())).error);assert.equal(writes.length,0);
 identity=null;await assert.rejects(getSpeakingAuthoringContext(klass.id),/login required/);assert.equal(adminClients,0);
});
