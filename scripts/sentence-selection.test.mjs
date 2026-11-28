import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),ts=require('typescript'),Module=require('node:module');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const helpers=require('../src/lib/ai/sentence-selection.ts');
const {sourceSentences,prepareSelection,parseSelection,selectionOptions}=helpers;
const source='Dr. Kim built a garden. It has 3.5 meters of soil. The children planted seeds. They water the plants every day. The garden gives them fresh food.';
const sentences=sourceSentences(source);
const longSource=source+' '+Array.from({length:15},(_,i)=>`The students read book number ${i+1}.`).join(' ');
const longSentences=sourceSentences(longSource);
test('sentence boundaries retain titles, decimals, punctuation and internal whitespace',()=>{
 assert.deepEqual(sentences,['Dr. Kim built a garden.','It has 3.5 meters of soil.','The children planted seeds.','They water the plants every day.','The garden gives them fresh food.']);
 assert.deepEqual(sourceSentences('The bird\n  sang a song. Then it flew away!'),['The bird\n  sang a song.','Then it flew away!']);
 assert.equal(sourceSentences('He works in the U.S. He teaches English.').length,2);
});
test('extract maps IDs to exact source and preserves passage order',()=>{
 const out=parseSelection(JSON.stringify({selected:[5,1,3],excluded:[{id:1,reason:'selected'},{id:2,reason:'less central'},{id:2,reason:'duplicate'},{id:200,reason:'invalid'}]}),sentences,'extract',3);
 assert.deepEqual(out.selected,[sentences[0],sentences[2],sentences[4]]);
 assert.deepEqual(out.excluded,[{sentence:sentences[1],reason:'less central'}]);
 for(const sentence of out.selected)assert.ok(source.includes(sentence));
});
test('extract refuses rewritten text, duplicate IDs, unknown IDs and count mismatch',()=>{
 for(const selected of [[1,1],[1,99],['A rewritten sentence.',2],[1],[1,2,3],[1.5,2]])assert.throws(()=>parseSelection(JSON.stringify({selected}),sentences,'extract',2),helpers.SelectionOutputError);
});
test('request limits, invalid mode, short source, OCR gaps and insufficient sentences fail before AI',()=>{
 assert.deepEqual(selectionOptions(undefined,undefined),{mode:'extract',limit:10});
 for(const limit of [0,1,9,16,10.1,'10',null])assert.throws(()=>prepareSelection(source,'extract',limit),helpers.SelectionInputError);
 assert.throws(()=>prepareSelection(source,'invent',2),helpers.SelectionInputError);
 assert.throws(()=>prepareSelection('short','extract',1),helpers.SelectionInputError);
 assert.throws(()=>prepareSelection(source+' [?]','extract',1),helpers.SelectionInputError);
 assert.throws(()=>prepareSelection('a'.repeat(30001),'summarize',1),helpers.SelectionInputError);
 assert.throws(()=>prepareSelection(source,'extract',10),/확인된 문장은 5개/);
 assert.throws(()=>prepareSelection(source,'extract',10),/최소 10문장/);
 for (const limit of [10,11,12,13,14,15]) assert.equal(prepareSelection(longSource,'extract',limit).limit,limit);
 assert.equal(prepareSelection(source,'summarize',10).limit,10);
 assert.throws(()=>prepareSelection('The bird sang. The bird sang.','extract',10),/확인된 문장은 1개/);
});
test('summary accepts complete grounded sentences and rejects duplicates/invalid references/counts',()=>{
 const selected=[{text:'The children grow food in a garden.',source_ids:[1,3,5]},{text:'They care for the plants daily.',source_ids:[4]}];
 assert.deepEqual(parseSelection(JSON.stringify({selected}),sentences,'summarize',2),{selected:selected.map(s=>s.text),excluded:[]});
 for(const bad of [[],[selected[0],selected[0]],[{...selected[0],source_ids:[]},selected[1]],[{...selected[0],source_ids:[88]},selected[1]],[{text:'One sentence. Another sentence.',source_ids:[1]},selected[1]],[{text:'Same sentence. Same sentence.',source_ids:[1]},selected[1]],[{text:'An incomplete phrase',source_ids:[1]},selected[1]]])assert.throws(()=>parseSelection(JSON.stringify({selected:bad}),sentences,'summarize',2),helpers.SelectionOutputError);
 for(const json of ['null','[]','oops','{"selected":null}'])assert.throws(()=>parseSelection(json,sentences,'summarize',2),helpers.SelectionOutputError);
});
let usage=[];
function loadAI(){const original=Module._load;Module._load=function(id,parent,main){if(id==='server-only')return {};if(id==='../usage')return {logUsage:async(...args)=>usage.push(args)};if(id==='../settings')return {getAiModel:async()=> 'configured-model'};return original.call(this,id,parent,main);};try{const file=path.resolve('src/lib/ai/select-sentences.ts');delete require.cache[file];return require(file);}finally{Module._load=original;}}
test('AI retries invalid output once, retains configured model and never silently truncates',async()=>{
 const original=global.fetch,key=process.env.ANTHROPIC_API_KEY;process.env.ANTHROPIC_API_KEY='test-only';usage=[];const calls=[];
 try{global.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));return new Response(JSON.stringify({content:[{text:JSON.stringify({selected:calls.length===1?[1]:[10,9,8,7,6,5,4,3,2,1]})}],usage:{input_tokens:1,output_tokens:1}}),{status:200});};
 const result=await loadAI().selectSentences(longSource,10,'extract');assert.deepEqual(result.selected,longSentences.slice(0,10));assert.equal(calls.length,2);assert.equal(usage.length,2);assert.equal(calls[0].model,'configured-model');assert.match(calls[1].system,/직전 출력의 검증 오류/);
 let failedCalls=0;global.fetch=async()=>{failedCalls++;return new Response(JSON.stringify({content:[{text:'{"selected":[]}'}]}));};
 await assert.rejects(()=>loadAI().selectSentences(longSource,10,'extract'),helpers.SelectionOutputError);assert.equal(failedCalls,2);
 }finally{global.fetch=original;if(key===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=key;}
});
function loadRoute(user,teacher){const original=Module._load;let called=0;Module._load=function(id,parent,main){if(id==='next/server')return {NextResponse:{json:(obj,init)=>new Response(JSON.stringify(obj),init)}};if(id==='@/lib/supabase/server')return {createClient:()=>({auth:{getUser:async()=>({data:{user}})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:teacher})})})};if(id==='@/lib/ai/sentence-selection')return helpers;if(id==='@/lib/ai/select-sentences')return {selectSentences:async(text,limit,mode)=>{called++;return {text,limit,mode}}};return original.call(this,id,parent,main)};try{const file=path.resolve('src/app/api/teacher/select-sentences/route.ts');delete require.cache[file];return {route:require(file),calls:()=>called};}finally{Module._load=original;}}
test('API restricts AI calls to approved teachers/admins and validates input',async()=>{
 const req=(payload)=>new Request('http://local/api',{method:'POST',body:JSON.stringify(payload)});
 for(const [user,teacher,status] of [[null,null,401],[{id:'student'},null,403],[{id:'pending'},{role:'teacher',status:'pending'},403]]){const {route,calls}=loadRoute(user,teacher);assert.equal((await route.POST(req({text:source,limit:2}))).status,status);assert.equal(calls(),0);}
 for(const teacher of [{role:'teacher',status:'approved'},{role:'admin',status:'approved'}]){const {route,calls}=loadRoute({id:'staff'},teacher);const res=await route.POST(req({text:longSource,limit:10,mode:'summarize'}));assert.equal(res.status,200);assert.equal((await res.json()).mode,'summarize');assert.equal(calls(),1);assert.equal((await route.POST(req({text:source,limit:16}))).status,400);assert.equal(calls(),1);}
});
