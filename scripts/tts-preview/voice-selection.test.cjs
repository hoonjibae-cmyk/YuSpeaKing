const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require('typescript');
const repo=path.resolve(__dirname,'../..');
for(const ext of ['.ts','.tsx']) require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
const originalLoad=Module._load;
let fixture;
const SAMPLE='The little bird opens its wings and flies over the green garden.';
const fakeAudio=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(256)]);
const env={NODE_ENV:'test',WAVENET_TEST_ENABLED:'true',GOOGLE_CLOUD_PROJECT:'yuspeaking-tts-test',YUSPEAKING_TEST_DATA_ONLY:'true',CLOUDSDK_CONFIG:'mock-isolated-adc'};
function query(admin=false){
 let data,op='select';
 const q={insert(value){data=value;op='insert';return q;},update(value){data=value;op='update';return q;},select(){return q;},eq(){return q;},
 async single(){
  if(op==='insert'){fixture.row={id:'fixture-assignment',...data};return {data:fixture.row,error:null};}
  if(op==='update'){
   if(admin&&fixture.failCommit)return {data:null,error:{message:'mock commit failure'}};
   Object.assign(fixture.row,data);fixture.commits.push({...data});return {data:{id:fixture.row.id},error:null};
  }
  return {data:fixture.row,error:null};
 },then(resolve,reject){return q.single().then(resolve,reject);}};return q;
}
const db={from:()=>query()};
const admin={from:()=>query(true),storage:{from:()=>({
 upload:async(objectPath,audio,options)=>{fixture.uploads.push({objectPath,audio,options});return {error:fixture.uploads.length===fixture.failUpload?{message:'mock upload failure'}:null};},
 getPublicUrl:objectPath=>({data:{publicUrl:`https://fixture.invalid/${objectPath}`}}),
})}};
Module._load=function(request,parent,isMain){
 if(request==='server-only')return {};
 if(request==='../usage'&&parent?.filename===path.join(repo,'src/lib/ai/wavenet.ts'))return {logUsage:async(kind,input)=>fixture.usage.push({kind,...input})};
 if(fixture?.wif&&parent?.filename===path.join(repo,'src/lib/ai/google-tts-auth.ts')){
  if(request==='google-auth-library')return {ExternalAccountClient:{fromJSON(config){fixture.wifConfig=config;return {async getAccessToken(){fixture.subject=await config.subject_token_supplier.getSubjectToken();return {token:'mock-production-access-token'};}};}}};
  if(request==='@vercel/oidc')return {getVercelOidcToken:async()=> 'mock-vercel-oidc-token'};
 }
 if(parent?.filename===path.join(repo,'src/app/teacher/actions.ts')){
  if(request==='next/cache')return {revalidatePath(){}};
  if(request==='next/navigation')return {redirect(url){throw Object.assign(new Error('redirect'),{url});}};
  if(request==='@/lib/teacher-context')return {getTeacherContext:async()=>({db})};
  if(request==='@/lib/supabase/admin')return {createAdminClient:()=>admin};
  if(request==='@/lib/ai/wavenet')return {synthesizeWaveNetPair:async(text,voice)=>{
   fixture.syntheses.push({text,voice});if(fixture.failSynthesis)throw Error('mock synthesis failure');return {normal:fakeAudio,slow:fakeAudio};
  }};
  if(request==='@/lib/ai/tts')return {synthesizeSpeech:async(text,mode,voice)=>{fixture.openai.push({text,mode,voice});return fakeAudio;}};
  if(request.startsWith('@/')&&!['@/lib/sample-voices','@/lib/ai/sample-pair'].includes(request))return {};
 }
 if(request.startsWith('@/'))request=path.join(repo,'src',request.slice(2));
 return originalLoad.call(this,request,parent,isMain);
};
const voices=require('../../src/lib/sample-voices.ts');
const {publishSamplePair}=require('../../src/lib/ai/sample-pair.ts');
const {createAssignment,regenerateSample,updateAssignment}=require('../../src/app/teacher/actions.ts');
function reset(changes={}){
 fixture={row:{id:'fixture-assignment',passage_text:SAMPLE,sample_voice:'en-US-Wavenet-F',sample_audio_url:'old-normal',sample_audio_slow_url:'old-slow'},uploads:[],commits:[],syntheses:[],openai:[],usage:[],...changes};
 for(const key of Object.keys(env))process.env[key]=env[key];for(const key of ['VERCEL','VERCEL_ENV','WAVENET_ENABLED','GOOGLE_WORKLOAD_IDENTITY_AUDIENCE','GOOGLE_TTS_SERVICE_ACCOUNT','GOOGLE_APPLICATION_CREDENTIALS'])delete process.env[key];
}
function form(voice){const data=new FormData();for(const [k,v] of Object.entries({classId:'fixture-class',assignmentId:'fixture-assignment',title:'Synthetic example',passage_text:SAMPLE,...(voice===undefined?{}:{voice})}))data.set(k,v);return data;}

test('US WaveNet catalogue has ten distinct voices, F first; exact same text at 1 and 0.7 for every voice',()=>{
 assert.equal(voices.WAVENET_VOICES.length,10);assert.equal(new Set(voices.WAVENET_VOICES.map(x=>x.id)).size,10);
 assert.equal(voices.WAVENET_VOICES[0].id,'en-US-Wavenet-F');
 for(const voice of voices.WAVENET_VOICES){const [a,b]=voices.buildWaveNetRequests(SAMPLE,voice.id);assert.deepEqual(a.input,{text:SAMPLE});assert.deepEqual(a.input,b.input);assert.deepEqual(a.voice,b.voice);assert.equal(a.voice.name,voice.id);assert.equal(a.audioConfig.speakingRate,1);assert.equal(b.audioConfig.speakingRate,0.7);}
});
test('default remains coral; forged, disabled, production and wrong-project choices are rejected',()=>{
 assert.equal(voices.selectSampleVoice('',false),'coral');assert.equal(voices.waveNetTestEnabled({}),false);
 for(const change of [{NODE_ENV:'production'},{VERCEL:'1'},{GOOGLE_CLOUD_PROJECT:'yussam-voca'},{WAVENET_TEST_ENABLED:'false'},{YUSPEAKING_TEST_DATA_ONLY:'false'}])assert.equal(voices.waveNetTestEnabled({...env,...change}),false);
 assert.throws(()=>voices.selectSampleVoice('en-US-Wavenet-F',false));assert.throws(()=>voices.selectSampleVoice('en-US-Wavenet-K',true));assert.throws(()=>voices.selectSampleVoice('forged',true));
});
test('UTF-8 boundary accepted exactly; oversized or empty input rejected before synthesis',()=>{
 assert.doesNotThrow(()=>voices.buildWaveNetRequests('a'.repeat(5000),'en-US-Wavenet-F'));
 for(const text of ['a'.repeat(5001),'가'.repeat(1667),' '])assert.throws(()=>voices.buildWaveNetRequests(text,'en-US-Wavenet-F'));
});
test('creation persists selected voice and links both URLs in a single metadata update',async()=>{
 reset();await createAssignment(form('en-US-Wavenet-D'));
 assert.equal(fixture.row.sample_voice,'en-US-Wavenet-D');assert.equal(fixture.syntheses[0].voice,'en-US-Wavenet-D');assert.equal(fixture.openai.length,0);
 assert.equal(fixture.uploads.length,2);assert.ok(fixture.uploads.every(x=>x.options.upsert===false));
 assert.equal(fixture.commits.length,1);assert.ok(fixture.row.sample_audio_url.endsWith('_normal.mp3'));assert.ok(fixture.row.sample_audio_slow_url.endsWith('_slow.mp3'));
});
test('creation with disabled WaveNet or oversized text is rejected before DB insert or synthesis',async()=>{
 reset();process.env.WAVENET_TEST_ENABLED='false';await assert.rejects(createAssignment(form('en-US-Wavenet-D')),e=>!!e.url);
 assert.equal(fixture.syntheses.length,0);assert.equal(fixture.uploads.length,0);
 reset();const data=form('en-US-Wavenet-F');data.set('passage_text','x'.repeat(5001));await assert.rejects(createAssignment(data),e=>!!e.url);assert.equal(fixture.syntheses.length,0);
});
test('regeneration keeps stored voice when no selection is sent',async()=>{
 reset();fixture.row.sample_voice='en-US-Wavenet-J';await regenerateSample(form());assert.equal(fixture.syntheses[0].voice,'en-US-Wavenet-J');
});
test('WaveNet passage edit commits matching text, selected voice and both URLs together',async()=>{
 reset();const data=form();data.set('passage_text','The garden is green.');await updateAssignment(data);
 assert.equal(fixture.row.passage_text,'The garden is green.');assert.equal(fixture.commits.length,1);
 assert.ok(fixture.commits[0].sample_audio_url);assert.ok(fixture.commits[0].sample_audio_slow_url);assert.equal(fixture.commits[0].sample_voice,'en-US-Wavenet-F');
});
test('failed WaveNet passage edit preserves the previous text, voice and pair',async()=>{
 reset({failUpload:2});const before={...fixture.row};const data=form();data.set('passage_text','The garden is green.');
 await assert.rejects(updateAssignment(data),e=>!!e.url);assert.deepEqual(fixture.row,before);
});
for(const failure of ['failSynthesis','failUpload','failCommit'])test(`regeneration ${failure} leaves previous pair and voice unchanged`,async()=>{
 reset({[failure]:failure==='failUpload'?2:true});const before={...fixture.row};const oldError=console.error;console.error=()=>{};
 try{await assert.rejects(regenerateSample(form('en-US-Wavenet-A')),e=>!!e.url);}finally{console.error=oldError;}
 assert.deepEqual(fixture.row,before);assert.equal(fixture.commits.length,0);
});
test('default creation calls only existing OpenAI path',async()=>{
 reset();delete process.env.WAVENET_TEST_ENABLED;await createAssignment(form());assert.equal(fixture.syntheses.length,0);assert.equal(fixture.openai.length,2);assert.equal(fixture.row.sample_voice,'coral');
});
test('pair publication commits only after normal and slow uploads both finish',async()=>{
 const steps=[];await publishSamplePair({normal:fakeAudio,slow:fakeAudio,voice:'en-US-Wavenet-F',upload:async(mode)=>{steps.push(mode);return mode;},commit:async(a,b,v)=>{assert.deepEqual(steps,['normal','slow']);assert.equal(v,'en-US-Wavenet-F');steps.push('commit');}});assert.deepEqual(steps,['normal','slow','commit']);
});
test('voice selector renders ten WaveNet options only when enabled and retains legacy stored value',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const Select=require('../../src/components/SampleVoiceSelect.tsx').default;
 const html=renderToStaticMarkup(React.createElement(Select,{enabled:true,value:'en-US-Wavenet-D'}));assert.equal((html.match(/value="en-US-Wavenet-/g)||[]).length,10);assert.match(html,/selected="" value="en-US-Wavenet-D"|value="en-US-Wavenet-D" selected=""/);
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(Select,{})),/en-US-Wavenet-/);
 assert.match(renderToStaticMarkup(React.createElement(Select,{value:'en-US-Wavenet-F'})),/테스트 환경에서 재생성 가능/);
});
test('actual WaveNet adapter sends only plain text, one selected voice and rates 1/0.7 to the test project',async()=>{
 reset();const cp=require('node:child_process'),savedExec=cp.execFile,savedFetch=global.fetch;
 cp.execFile=(...args)=>args.at(-1)(null,{stdout:'mock-access-token',stderr:''});
 const adapter=require('../../src/lib/ai/wavenet.ts');cp.execFile=savedExec;
 const requests=[];
 global.fetch=async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return {ok:true,json:async()=>({audioContent:fakeAudio.toString('base64')})};};
 try{
  const result=await adapter.synthesizeWaveNetPair(SAMPLE,'en-US-Wavenet-I');
  assert.ok(result.normal.equals(fakeAudio));assert.ok(result.slow.equals(fakeAudio));assert.equal(requests.length,2);
  for(const item of requests){assert.equal(item.url,'https://texttospeech.googleapis.com/v1/text:synthesize');assert.equal(item.options.headers['x-goog-user-project'],'yuspeaking-tts-test');assert.equal(item.body.voice.name,'en-US-Wavenet-I');assert.deepEqual(item.body.input,{text:SAMPLE});}
  assert.deepEqual(requests.map(x=>x.body.audioConfig.speakingRate),[1,0.7]);
  requests.length=0;await assert.rejects(adapter.synthesizeWaveNetPair('x'.repeat(5001),'en-US-Wavenet-I'));assert.equal(requests.length,0);
  process.env.GOOGLE_APPLICATION_CREDENTIALS='forbidden.json';await assert.rejects(adapter.synthesizeWaveNetPair(SAMPLE,'en-US-Wavenet-I'));assert.equal(requests.length,0);
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;process.env.GOOGLE_CLOUD_PROJECT='yussam-voca';await assert.rejects(adapter.synthesizeWaveNetPair(SAMPLE,'en-US-Wavenet-I'));assert.equal(requests.length,0);
 }finally{global.fetch=savedFetch;}
});
test('actual adapter rejects malformed/failed second response without retry or publishing a pair',async()=>{
 reset();const adapter=require('../../src/lib/ai/wavenet.ts'),savedFetch=global.fetch;
 try{
  for(const second of [{ok:false,status:503},{ok:true,json:async()=>({audioContent:'invalid'})}]){
   let calls=0;global.fetch=async()=>++calls===1?{ok:true,json:async()=>({audioContent:fakeAudio.toString('base64')})}:second;
   await assert.rejects(adapter.synthesizeWaveNetPair(SAMPLE,'en-US-Wavenet-F'));assert.equal(calls,2);
  }
 }finally{global.fetch=savedFetch;}
});
test('production WaveNet requires the release flag and exact dedicated-project federation config',()=>{
 const prod={NODE_ENV:'production',VERCEL:'1',VERCEL_ENV:'production',WAVENET_ENABLED:'true',GOOGLE_CLOUD_PROJECT:'yuspeaking-tts-test',GOOGLE_WORKLOAD_IDENTITY_AUDIENCE:'//iam.googleapis.com/projects/419110315377/locations/global/workloadIdentityPools/yuspeaking-vercel/providers/production',GOOGLE_TTS_SERVICE_ACCOUNT:'yuspeaking-tts@yuspeaking-tts-test.iam.gserviceaccount.com'};
 assert.equal(voices.waveNetEnabled(prod),true);
 for(const change of [{WAVENET_ENABLED:'false'},{VERCEL_ENV:'preview'},{GOOGLE_CLOUD_PROJECT:'yussam-voca'},{GOOGLE_WORKLOAD_IDENTITY_AUDIENCE:'wrong'},{GOOGLE_TTS_SERVICE_ACCOUNT:'wrong'}])assert.equal(voices.waveNetEnabled({...prod,...change}),false);
});
test('production adapter uses OIDC federation without gcloud or key files and records each synthesis',async()=>{
 reset({wif:true});Object.assign(process.env,{NODE_ENV:'production',VERCEL:'1',VERCEL_ENV:'production',WAVENET_ENABLED:'true',GOOGLE_WORKLOAD_IDENTITY_AUDIENCE:'//iam.googleapis.com/projects/419110315377/locations/global/workloadIdentityPools/yuspeaking-vercel/providers/production',GOOGLE_TTS_SERVICE_ACCOUNT:'yuspeaking-tts@yuspeaking-tts-test.iam.gserviceaccount.com'});
 delete process.env.CLOUDSDK_CONFIG;
 const savedFetch=global.fetch;let calls=0;
 global.fetch=async(_url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer mock-production-access-token');return {ok:true,json:async()=>({audioContent:fakeAudio.toString('base64')})};};
 try{await require('../../src/lib/ai/wavenet.ts').synthesizeWaveNetPair(SAMPLE,'en-US-Wavenet-F');assert.equal(calls,2);assert.equal(fixture.subject,'mock-vercel-oidc-token');assert.equal(fixture.wifConfig.token_url,'https://sts.googleapis.com/v1/token');assert.equal(fixture.usage.length,2);assert.ok(fixture.usage.every(x=>x.model==='en-US-Wavenet-F'&&x.chars===64));}finally{global.fetch=savedFetch;reset();}
});
