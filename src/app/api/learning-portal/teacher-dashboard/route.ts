import {NextResponse} from 'next/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {coTaughtClassIds} from '@/lib/transfers';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 try{
  const input=await request.text();if(input.length>5000)return NextResponse.json({error:'입력이 너무 큽니다.'},{status:413,headers});
  const proof=JSON.parse(input).proof;
  if(typeof proof!=='string'||proof.length>4096)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401,headers});
  const response=await fetch('https://portal.yussam.com/api/learning-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proof}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return NextResponse.json({error:'권한을 확인해 주세요.'},{status:response.status===503?503:403,headers});
  const identity=await response.json();
  if(identity.allowed!==true||typeof identity.email!=='string')return NextResponse.json({error:'권한이 없습니다.'},{status:403,headers});
  const db=createAdminClient();
  const teachers=await db.from('teachers').select('id,email,slack_email,status,role',{count:'exact'}).limit(2000);
  if(teachers.error||teachers.count!==null&&teachers.count>teachers.data.length)throw Error('Teacher lookup unavailable');
  const email=identity.email.toLowerCase(),matches=teachers.data.filter(t=>(t.status==='approved'||t.role==='admin')&&[t.email,t.slack_email].some(v=>v?.trim().toLowerCase()===email));
  if(matches.length!==1)return NextResponse.json({error:'선생님 계정 연결을 확인해 주세요.'},{status:403,headers});
  const teacher=matches[0],shared=await coTaughtClassIds(teacher.id);
  let query=db.from('classes').select('id,name,teacher_id').is('archived_at',null).order('name').limit(201);
  query=shared.length?query.or(`teacher_id.eq.${teacher.id},id.in.(${shared.join(',')})`):query.eq('teacher_id',teacher.id);
  const result=await query;if(result.error||result.data.length>200)throw Error('Class lookup unavailable');
  const classes=await Promise.all(result.data.map(async c=>{
   const [students,assignments]=await Promise.all([
    db.from('students').select('id',{count:'exact'}).eq('class_id',c.id).eq('status','approved').limit(1001),
    db.from('assignments').select('id,title,due_date').eq('class_id',c.id).order('created_at',{ascending:false}).limit(51),
   ]);
   if(students.error||assignments.error||students.data.length>1000||students.count!==null&&students.count>students.data.length)throw Error('Class data unavailable');
   const memberIds=new Set(students.data.map(s=>s.id)),recent=assignments.data.slice(0,50);
   const items=await Promise.all(recent.map(async a=>{
    const submissions=await db.from('submissions').select('student_id,status',{count:'exact'}).eq('assignment_id',a.id).limit(1001);
    if(submissions.error||submissions.data.length>1000||submissions.count!==null&&submissions.count>submissions.data.length)throw Error('Submission data unavailable');
    return {id:a.id,title:a.title,dueAt:a.due_date,completedCount:new Set(submissions.data.filter(s=>memberIds.has(s.student_id)&&['submitted','evaluating','evaluated'].includes(s.status)).map(s=>s.student_id)).size,url:'https://yuspeaking.yussam.com/teacher/assignments/'+a.id};
   }));
   return {id:c.id,name:c.name,studentCount:memberIds.size,canManage:true,assignments:items,hasMoreAssignments:assignments.data.length>50,url:'https://yuspeaking.yussam.com/teacher/classes/'+c.id};
  }));
  return NextResponse.json({classes},{headers});
 }catch{return NextResponse.json({error:'과제 현황을 확인하지 못했습니다.'},{status:503,headers});}
}
