import {createAdminClient} from '@/lib/supabase/admin';
import {generateAndStoreSamples} from '@/lib/ai/assignment-samples';
import {buildWaveNetRequests,DEFAULT_WAVENET_VOICE,isWaveNetVoice,waveNetEnabled} from '@/lib/sample-voices';

// Shared by the existing class page and the portal popup. Pass a client whose
// class scope has already been checked; the native client also enforces RLS.
export async function createSpeakingAssignment(db:ReturnType<typeof createAdminClient>,form:FormData){
 const classId=String(form.get('classId')||''),title=String(form.get('title')||'').trim(),passage=String(form.get('passage_text')||'').trim(),due=String(form.get('due_date')||'')||null;
 const voice=String(form.get('voice')||DEFAULT_WAVENET_VOICE),requestId=String(form.get('requestId')||'');
 if(!classId||!title||title.length>200||!passage)throw Error('제목과 지문을 입력해 주세요.');
 if(passage.includes('[?]'))throw Error('지문에 읽지 못한 단어([?])가 남아 있어요. 고친 뒤 등록해 주세요.');
 if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))throw Error('마감일을 확인해 주세요.');
 if(!waveNetEnabled()||!isWaveNetVoice(voice))throw Error('Google 음성 연결과 선택을 확인해 주세요.');
 buildWaveNetRequests(passage,voice);
 if(requestId&&!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requestId))throw Error('등록 요청을 확인해 주세요.');
 const inserted=await db.from('assignments').insert({...(requestId?{id:requestId}:{}),class_id:classId,title,passage_text:passage,due_date:due,max_attempts:1,sample_voice:voice}).select('id').single();
 if(inserted.error||!inserted.data){
  // A retry after a lost response must not create another task or charge TTS twice.
  if(requestId&&inserted.error?.code==='23505'){
   const prior=await db.from('assignments').select('id,sample_audio_url').eq('id',requestId).eq('class_id',classId).maybeSingle();
   if(!prior.error&&prior.data)return {id:prior.data.id,warning:prior.data.sample_audio_url?null:'이미 등록된 과제입니다. 샘플음성 준비 상태를 과제 상세에서 확인해 주세요.'};
  }
  throw Error('과제를 등록하지 못했습니다. 다시 확인해 주세요.');
 }
 let warning:string|null=null;
 try{await generateAndStoreSamples(inserted.data.id,passage,voice);}catch{warning='과제는 등록됐지만 샘플음성을 만들지 못했습니다. 과제 상세에서 음성을 다시 생성해 주세요.';}
 return {id:inserted.data.id,warning};
}
