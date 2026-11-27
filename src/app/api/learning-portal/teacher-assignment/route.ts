import {NextResponse} from 'next/server';
import {revalidatePath} from 'next/cache';
import {learningTeacherClass,validId,accessError} from '@/lib/learning-teacher-access';
import {DEFAULT_WAVENET_VOICE,WAVENET_VOICES,isWaveNetVoice,waveNetEnabled,buildWaveNetRequests} from '@/lib/sample-voices';
import {generateAndStoreSamples} from '@/lib/ai/assignment-samples';
import {evaluateSubmission,regenerateFeedback,BROKEN_FEEDBACK} from '@/lib/ai/evaluate';
import {displayStudentFeedback} from '@/lib/feedback-name';
export const maxDuration=300;
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const reads=new Set(['assignment','report']);
const intents=new Set(['assignment','report','update','delete','regenerate','saveReview','resetAttempts','reevaluate','feedback']);
export async function POST(request:Request){try{
 const raw=await request.text();if(raw.length>50000)throw accessError('입력이 너무 큽니다.',413);
 const input=JSON.parse(raw);if(!intents.has(input.intent)||!validId(input.assignmentId))throw accessError('과제 요청을 확인해 주세요.');
 const {db,klass,canManage}=await learningTeacherClass(input.proof,input.classId);
 if(!reads.has(input.intent)&&!canManage)throw accessError('이 화면에서는 조회만 할 수 있습니다.',403);
 const found=await db.from('assignments').select('id,class_id,title,passage_text,due_date,max_attempts,sample_audio_url,sample_audio_slow_url,sample_voice').eq('id',input.assignmentId).eq('class_id',klass.id).maybeSingle();
 if(found.error)throw accessError('과제를 불러오지 못했습니다.',503);if(!found.data)throw accessError('이 반의 과제가 아닙니다.',404);
 const a=found.data;
 if(input.intent==='assignment')return NextResponse.json({assignment:a,canManage,voices:waveNetEnabled()?WAVENET_VOICES:[],defaultVoice:DEFAULT_WAVENET_VOICE},{headers});
 if(['report','saveReview','resetAttempts','reevaluate','feedback'].includes(input.intent)){
  if(!validId(input.studentId))throw accessError('학생을 확인해 주세요.');
  const [student,result]=await Promise.all([
   db.from('students').select('id,name').eq('id',input.studentId).eq('class_id',klass.id).eq('status','approved').maybeSingle(),
   db.from('submissions').select('id,student_id,status,overall_score,azure_scores,teacher_feedback,student_feedback,teacher_reviewed,audio_path,audio_expired,error_message,attempt_count').eq('assignment_id',a.id).eq('student_id',input.studentId).maybeSingle(),
  ]);
  if(student.error||result.error)throw accessError('제출 기록을 불러오지 못했습니다.',503);
  if(!student.data)throw accessError('이 반의 학생이 아닙니다.',404);
  const sub=result.data;
  if(!sub){if(input.intent==='report')return NextResponse.json({student:student.data,submission:null,canManage},{headers});throw accessError('아직 제출한 기록이 없습니다.',404);}
  if(input.intent==='report'){
   let audioUrl=null,audioUnavailable=false;
   if(sub.audio_path&&!sub.audio_expired){const signed=await db.storage.from('submissions').createSignedUrl(sub.audio_path,3600);audioUrl=signed.data?.signedUrl||null;audioUnavailable=!!signed.error;}
   const {audio_path,...safe}=sub;
   return NextResponse.json({student:student.data,submission:{...safe,student_feedback:displayStudentFeedback(sub.student_feedback||'',student.data.name)},audioUrl,audioUnavailable,canManage,maxAttempts:a.max_attempts,feedbackBroken:BROKEN_FEEDBACK.includes(sub.student_feedback||'')},{headers});
  }
  if(input.intent==='saveReview'){
   if(typeof input.feedback!=='string'||input.feedback.length>20000||typeof input.reviewed!=='boolean')throw accessError('리포트 내용을 확인해 주세요.');
   const r=await db.from('submissions').update({teacher_feedback:input.feedback,teacher_reviewed:input.reviewed}).eq('id',sub.id).eq('assignment_id',a.id).select('id').single();if(r.error)throw accessError('리포트를 저장하지 못했습니다.',503);
  }else if(input.intent==='resetAttempts'){
   const r=await db.from('submissions').update({attempt_count:0}).eq('id',sub.id).select('id').single();if(r.error)throw accessError('재제출 기회를 저장하지 못했습니다.',503);
  }else if(input.intent==='reevaluate'){
   if(sub.status==='evaluating'||sub.audio_expired||!sub.audio_path)throw accessError('평가 중이거나 녹음이 없어 재평가할 수 없습니다.');
   const r=await db.from('submissions').update({evaluate_attempts:0}).eq('id',sub.id).select('id').single();if(r.error)throw accessError('재평가를 준비하지 못했습니다.',503);
   await evaluateSubmission(sub.id);
  }else await regenerateFeedback(sub.id);
 }else if(input.intent==='delete'){
  const r=await db.from('assignments').delete().eq('id',a.id).eq('class_id',klass.id).select('id').single();if(r.error)throw accessError('과제를 삭제하지 못했습니다.',503);
 }else{
  const voice=isWaveNetVoice(input.voice||'')?input.voice:isWaveNetVoice(a.sample_voice||'')?a.sample_voice:DEFAULT_WAVENET_VOICE;
  if(input.voice&&!isWaveNetVoice(input.voice))throw accessError('Google 음성을 선택해 주세요.');
  if(input.intent==='regenerate'){
   if(!waveNetEnabled())throw accessError('Google 음성 연결을 확인해 주세요.',503);
   buildWaveNetRequests(a.passage_text,voice);await generateAndStoreSamples(a.id,a.passage_text,voice);
  }else{
   const title=typeof input.title==='string'?input.title.trim():'',passage=typeof input.passage==='string'?input.passage.trim():'';
   if(!title||title.length>200||!passage||passage.includes('[?]')||input.dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate))throw accessError('제목·지문·마감일을 확인해 주세요.');
   const patch={title,passage_text:passage,due_date:input.dueDate||null,max_attempts:1};
   if(passage!==a.passage_text){if(!waveNetEnabled())throw accessError('Google 음성 연결을 확인해 주세요.',503);buildWaveNetRequests(passage,voice);await generateAndStoreSamples(a.id,passage,voice,patch);}
   else{const r=await db.from('assignments').update(patch).eq('id',a.id).eq('class_id',klass.id).select('id').single();if(r.error)throw accessError('과제를 저장하지 못했습니다.',503);}
  }
 }
 revalidatePath('/teacher/classes/'+klass.id);revalidatePath('/teacher/assignments/'+a.id);
 return NextResponse.json({ok:true},{headers});
}catch(error){const e=error as Error&{status?:number};return NextResponse.json({error:e.status?e.message:'처리하지 못했습니다. 현황을 확인한 후 다시 시도해 주세요.'},{status:e.status||503,headers});}}
