const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const original=Module._load;
Module._load=function(id,parent,isMain){
 if(id==='server-only')return {};
 if(parent?.filename.endsWith(path.join('ai','feedback.ts'))&&id==='../usage')return {logUsage:async()=>{}};
 if(parent?.filename.endsWith(path.join('ai','feedback.ts'))&&id==='../settings')return {getAiModel:async()=> 'mock-model'};
 return original.call(this,id,parent,isMain);
};
const {feedbackGivenName,feedbackAddress,displayStudentFeedback}=require('../src/lib/feedback-name.ts');
const {buildFeedbackPrompt,generateFeedback}=require('../src/lib/ai/feedback.ts');
test('registered full name uses given name with the correct vocative',()=>{
 assert.equal(feedbackGivenName('김지훈'),'지훈');assert.equal(feedbackAddress('김지훈'),'지훈아');
 assert.equal(feedbackAddress('이민지'),'민지야');assert.equal(feedbackAddress('남궁지훈'),'지훈아');
 assert.equal(feedbackGivenName('민지'),'민지');assert.equal(feedbackGivenName(' Alex '),'Alex');
 assert.equal(feedbackAddress('Alex'),'');assert.equal(feedbackAddress(null),'');
});
test('existing feedback replaces full-name address while preserving all feedback content',()=>{
 const text='김지훈아~, 이번엔 끝까지 읽었어요! 다음에도 또박또박 읽어봐요.';
 assert.equal(displayStudentFeedback(text,'김지훈'),'지훈아~, 이번엔 끝까지 읽었어요! 다음에도 또박또박 읽어봐요.');
 assert.equal(displayStudentFeedback('이민지아, 잘했어요.','이민지'),'민지야, 잘했어요.');
 assert.equal(displayStudentFeedback('지훈아, 잘했어요.','김지훈'),'지훈아, 잘했어요.');
 assert.equal(displayStudentFeedback('김지훈의 점수는 90점. 다른 이름: 박지훈아.','김지훈'),'김지훈의 점수는 90점. 다른 이름: 박지훈아.');
 assert.equal(displayStudentFeedback(text,null),text);
});
const scores={pronunciation:90,accuracy:90,fluency:90,completeness:100,words:[]};
test('prompt supplies only given name and precomputed address, no invented name when absent',()=>{
 const prompt=buildFeedbackPrompt(scores,'The bird flies.',{name:'김지훈'});
 assert.match(prompt,/\[학생 이름\] 지훈\n\[학생 호칭\] 지훈아/);assert.doesNotMatch(prompt,/김지훈/);
 assert.match(buildFeedbackPrompt(scores,'The bird flies.'),/이름이나 호칭을 쓰지 말고/);
});
test('new feedback normalizes the vocative after the model response without changing teacher feedback',async()=>{
 const savedFetch=global.fetch,savedKey=process.env.ANTHROPIC_API_KEY;
 process.env.ANTHROPIC_API_KEY='mock-only';
 global.fetch=async(_url,options)=>{const body=JSON.parse(options.body);assert.match(body.system,/성을 다시 붙이거나/);return {ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({studentFeedback:'김지훈아, 끝까지 잘 읽었어요!',teacherFeedback:'정확도 90점.'})}]})};};
 try{const result=await generateFeedback(scores,'The bird flies.',{name:'김지훈'});assert.equal(result.studentFeedback,'지훈아, 끝까지 잘 읽었어요!');assert.equal(result.teacherFeedback,'정확도 90점.');}
 finally{global.fetch=savedFetch;if(savedKey===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=savedKey;}
});
