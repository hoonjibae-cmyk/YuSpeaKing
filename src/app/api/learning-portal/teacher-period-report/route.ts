import {NextResponse} from 'next/server';
import {POST as dashboard} from '../teacher-dashboard/route';
import {createAdminClient} from '@/lib/supabase/admin';
import {speakingPeriodEvidence} from '@/lib/period-report-evidence';
import {weeklyRecordings} from '@/lib/report-recordings';
import {reportServiceClasses} from '@/lib/report-service-access';
const headers={'Cache-Control':'private, no-store'};
async function pages<T>(fetchPage:(from:number,to:number)=>PromiseLike<{data:T[]|null;count:number|null;error:unknown}>,max:number){
 const data:T[]=[];let expected:number|null=null;
 while(true){const r=await fetchPage(data.length,data.length+499);if(r.error||!r.data)throw Error('READ');if(expected===null)expected=r.count;if(expected!==null&&expected>max)throw Error('LIMIT');
  if(!r.data.length){if(expected!==null&&data.length<expected)throw Error('INCOMPLETE');return data;}data.push(...r.data);if(data.length>max)throw Error('LIMIT');if(expected!==null&&data.length>=expected)return data;
 }
}
export async function POST(request:Request){try{
 const raw=await request.text();if(raw.length>6000)throw Error('INPUT');const input=JSON.parse(raw),from=String(input.from||''),until=String(input.until||'');
 const includeRecordings=input.includeRecordings===true&&Date.parse(until)-Date.parse(from)<=7*86400000;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(until)||!(Date.parse(until)>Date.parse(from))||Date.parse(until)-Date.parse(from)>31*86400000)throw Error('INPUT');
 let groups:{id:string}[];
 if(input.serviceTicket!==undefined){try{groups=await reportServiceClasses({...input,from,until});}catch{return NextResponse.json({error:'서버 조회 권한을 확인해 주세요.'},{status:403,headers});}}
 else {const result=await dashboard(new Request(request.url,{method:'POST',body:JSON.stringify({proof:input.proof,mode:'links'})}));if(!result.ok)return NextResponse.json({error:'권한을 확인해 주세요.'},{status:result.status,headers});const data=await result.json();groups=data.classes.filter((c:{cardClassId:string})=>c.cardClassId&&c.cardClassId===input.cardClassId);}
 if(groups.length!==1)return NextResponse.json({connected:false,students:[]},{headers});
 const db=createAdminClient(),students=await db.from('students').select('id,hr_student_id,approved_at',{count:'exact'}).eq('class_id',groups[0].id).eq('status','approved').limit(1001);if(students.error||students.data.length>1000||students.count!==null&&students.count>students.data.length)throw Error('READ');
 if(!students.data.length)return NextResponse.json({version:2,connected:true,students:[]},{headers});
 const assignments=await pages((lo,hi)=>db.from('assignments').select('id,title,created_at,due_date',{count:'exact'}).eq('class_id',groups[0].id).order('id').range(lo,hi),2000);
 const due=assignments.filter(a=>{const target=a.due_date?.slice(0,10)||new Date(Date.parse(a.created_at)+9*3600000).toISOString().slice(0,10);return target>=from&&target<until;}).map(a=>a.id);
 const submitted=assignments.length?await pages((lo,hi)=>db.from('submissions').select('id,assignment_id,student_id,status,overall_score,azure_scores,created_at,updated_at,attempt_count,teacher_feedback,teacher_reviewed,audio_path,audio_expired',{count:'exact'}).in('student_id',students.data.map(s=>s.id)).in('assignment_id',assignments.map(a=>a.id)).or('created_at.gte.'+from+'T00:00:00+09:00'+(includeRecordings?',updated_at.gte.'+from+'T00:00:00+09:00':'')+(due.length?',assignment_id.in.('+due.join(',')+')':'')).lt('created_at',until+'T00:00:00+09:00').order('id').range(lo,hi),10000):[];
 const recordings=includeRecordings?await weeklyRecordings(db,assignments,submitted,from,until):null;
 return NextResponse.json({version:2,connected:true,students:students.data.map(s=>({cardId:s.hr_student_id,...speakingPeriodEvidence(s,assignments,submitted,from,until),...(recordings?recordings.get(s.id)||{recordings:[],recordingsUnavailable:false}:{})}))},{headers});
}catch{return NextResponse.json({error:'기간별 유스피킹 기록을 확인하지 못했습니다.'},{status:503,headers});}}
