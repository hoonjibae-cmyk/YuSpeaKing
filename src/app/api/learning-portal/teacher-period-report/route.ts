import {NextResponse} from 'next/server';
import {POST as dashboard} from '../teacher-dashboard/route';
import {createAdminClient} from '@/lib/supabase/admin';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){try{
 const raw=await request.text();if(raw.length>6000)throw Error('INPUT');const input=JSON.parse(raw),from=String(input.from||''),until=String(input.until||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(until)||!(Date.parse(until)>Date.parse(from))||Date.parse(until)-Date.parse(from)>31*86400000)throw Error('INPUT');
 const result=await dashboard(new Request(request.url,{method:'POST',body:JSON.stringify({proof:input.proof,mode:'links'})}));if(!result.ok)return NextResponse.json({error:'권한을 확인해 주세요.'},{status:result.status,headers});
 const data=await result.json(),groups=data.classes.filter((c:{cardClassId:string})=>c.cardClassId&&c.cardClassId===input.cardClassId);if(groups.length!==1)return NextResponse.json({connected:false,students:[]},{headers});
 const db=createAdminClient(),students=await db.from('students').select('id,hr_student_id',{count:'exact'}).eq('class_id',groups[0].id).eq('status','approved').limit(1001);if(students.error||students.data.length>1000||students.count!==null&&students.count>students.data.length)throw Error('READ');
 if(!students.data.length)return NextResponse.json({connected:true,students:[]},{headers});
 const submitted=await db.from('submissions').select('student_id,status,overall_score',{count:'exact'}).in('student_id',students.data.map(s=>s.id)).gte('created_at',from+'T00:00:00+09:00').lt('created_at',until+'T00:00:00+09:00').limit(10001);if(submitted.error||submitted.data.length>10000||submitted.count!==null&&submitted.count>submitted.data.length)throw Error('LIMIT');
 return NextResponse.json({connected:true,students:students.data.map(s=>{const records=submitted.data.filter(r=>r.student_id===s.id&&['submitted','evaluating','evaluated'].includes(r.status)),scores=records.filter(r=>r.status==='evaluated'&&r.overall_score!==null).map(r=>Number(r.overall_score));return {cardId:s.hr_student_id,submissions:records.length,score:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null};})},{headers});
}catch{return NextResponse.json({error:'기간별 유스피킹 기록을 확인하지 못했습니다.'},{status:503,headers});}}
