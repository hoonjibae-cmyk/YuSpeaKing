import {NextResponse} from 'next/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {sharedClassIds} from '@/lib/class-access';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 try{
  const input=await request.text();if(input.length>5000)return NextResponse.json({error:'입력이 너무 큽니다.'},{status:413,headers});
  const payload=JSON.parse(input),proof=payload.proof,requested=payload.class_id;
  if(requested!==undefined&&(typeof requested!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requested)))return NextResponse.json({error:'반 주소를 확인해 주세요.'},{status:400,headers});
  if(typeof proof!=='string'||proof.length>4096)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401,headers});
  const response=await fetch('https://portal.yussam.com/api/learning-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proof}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return NextResponse.json({error:'권한을 확인해 주세요.'},{status:response.status===503?503:403,headers});
  const identity=await response.json();
  if(identity.allowed!==true||typeof identity.email!=='string')return NextResponse.json({error:'권한이 없습니다.'},{status:403,headers});
  const db=createAdminClient();
  const teachers=await db.from('teachers').select('id,email,slack_email,status,role',{count:'exact'}).limit(2000);
  if(teachers.error||teachers.count!==null&&teachers.count>teachers.data.length)throw Error('Teacher lookup unavailable');
  const email=identity.email.toLowerCase(),matches=teachers.data.filter(t=>(t.status==='approved'||t.role==='admin')&&[t.email,t.slack_email].some(v=>v?.trim().toLowerCase()===email));
  if(identity.viewOnly&&matches.length===0)return NextResponse.json({classes:[]},{headers});
  if(matches.length!==1&&!(identity.supervisor===true&&matches.length===0&&!teachers.data.some(t=>[t.email,t.slack_email].some(v=>v?.trim().toLowerCase()===email))))return NextResponse.json({error:'선생님 계정 연결을 확인해 주세요.'},{status:403,headers});
  const teacher=matches[0]||{id:'',role:'teacher'},sharedAccess=teacher.id?await sharedClassIds(teacher.id):{all:[],manage:[],viewOnly:[]},shared=sharedAccess.all;
  let query=db.from('classes').select('id,name,teacher_id').is('archived_at',null).order('name').limit(201);
  if(!(identity.supervisor===true||identity.department==='경영지원'&&teacher.role==='admin'&&!identity.viewOnly))query=shared.length?query.or(`teacher_id.eq.${teacher.id},id.in.(${shared.join(',')})`):query.eq('teacher_id',teacher.id);
  if(requested)query=query.eq('id',requested);
  const result=await query;if(result.error||result.data.length>200)throw Error('Class lookup unavailable');
  if(requested&&!result.data.some(c=>c.id===requested))return NextResponse.json({error:'이 반을 조회할 권한이 없습니다.'},{status:404,headers});
  if(payload.mode==='access')return NextResponse.json({classes:result.data.map(c=>({id:c.id,name:c.name}))},{headers});
  if(payload.mode==='directory'){
   if(identity.supervisor!==true&&!(identity.department==='경영지원'&&teacher.role==='admin'&&!identity.viewOnly))return NextResponse.json({error:'권한이 없습니다.'},{status:403,headers});
   const day=typeof payload.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(payload.day)?payload.day:new Date(Date.now()+9*3600000).toISOString().slice(0,10),week=new Date(day+'T00:00:00Z');week.setUTCDate(week.getUTCDate()-((week.getUTCDay()+6)%7));const from=week.toISOString();week.setUTCDate(week.getUTCDate()+7);const until=week.toISOString();
   const dayKey=new Date(Date.now()+9*3600000).toISOString().slice(0,10),coTeachers=await db.from('class_coteachers').select('class_id,teacher_id').lte('starts_on',dayKey).gte('ends_on',dayKey);if(coTeachers.error)throw Error('Shared teacher summary unavailable');
   const directoryLinks=result.data.length?await db.from('class_links').select('class_id,hr_class_id').in('class_id',result.data.map(c=>c.id)):{data:[],error:null};if(directoryLinks.error)throw Error('Class links unavailable');
   const classes=await Promise.all(result.data.map(async c=>{
    const [students,tasks]=await Promise.all([db.from('students').select('id',{count:'exact',head:true}).eq('class_id',c.id).eq('status','approved'),db.from('assignments').select('id').eq('class_id',c.id).gte('created_at',from).lt('created_at',until).limit(1001)]);
    if(students.error||tasks.error||tasks.data.length>1000)throw Error('Summary unavailable');
    const submissions=tasks.data.length?await db.from('submissions').select('id,overall_score,status',{count:'exact'}).in('assignment_id',tasks.data.map(a=>a.id)).in('status',['submitted','evaluating','evaluated']).limit(10001):{data:[],error:null,count:0};
    if(submissions.error||submissions.count!==null&&submissions.count>submissions.data.length)throw Error('Summary incomplete');const scores=submissions.data.filter(v=>v.status==='evaluated'&&v.overall_score!==null).map(v=>Number(v.overall_score)),owner=teachers.data.find(t=>t.id===c.teacher_id);
    return {...c,cardClassId:directoryLinks.data.find(l=>l.class_id===c.id)?.hr_class_id||null,teacherEmails:[owner?.email,owner?.slack_email,...teachers.data.filter(t=>coTeachers.data.some(x=>x.class_id===c.id&&x.teacher_id===t.id)).flatMap(t=>[t.email,t.slack_email])].filter(Boolean),teacherEmail:owner?.slack_email||owner?.email,studentCount:students.count||0,taskCount:tasks.data.length,completedCount:submissions.data.length,averageScore:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null};
   }));return NextResponse.json({classes},{headers});
  }
  const links=result.data.length?await db.from('class_links').select('class_id,hr_class_id').in('class_id',result.data.map(c=>c.id)): {data:[],error:null};
  if(links.error)throw Error('Class identity unavailable');
  if(payload.mode==='links')return NextResponse.json({classes:result.data.map(c=>({...c,cardClassId:links.data.filter(l=>l.class_id===c.id).length===1?links.data.find(l=>l.class_id===c.id)!.hr_class_id:null}))},{headers});
  const classes=await Promise.all(result.data.map(async c=>{
   const [students,assignments]=await Promise.all([
    db.from('students').select('id,name,hr_student_id',{count:'exact'}).eq('class_id',c.id).eq('status','approved').limit(1001),
    db.from('assignments').select('id,title,due_date,created_at').eq('class_id',c.id).order('created_at',{ascending:false}).limit(51),
   ]);
   if(students.error||assignments.error||students.data.length>1000||students.count!==null&&students.count>students.data.length)throw Error('Class data unavailable');
   const memberIds=new Set(students.data.map(s=>s.id)),recent=assignments.data.slice(0,50);
   const allSubmissions=recent.length?await db.from('submissions').select('assignment_id,student_id,status,overall_score',{count:'exact'}).in('assignment_id',recent.map(a=>a.id)).limit(10001):{data:[],error:null,count:0};
   if(allSubmissions.error||allSubmissions.count!==null&&allSubmissions.count>allSubmissions.data.length)throw Error('Submissions incomplete');
   const items=await Promise.all(recent.map(async a=>{
    const submissions={data:allSubmissions.data.filter(s=>s.assignment_id===a.id),error:null,count:null};
    if(submissions.error||submissions.data.length>1000||submissions.count!==null&&submissions.count>submissions.data.length)throw Error('Submission data unavailable');
    const completed=Array.from(new Set(submissions.data.filter(s=>memberIds.has(s.student_id)&&['submitted','evaluating','evaluated'].includes(s.status)).map(s=>s.student_id)));
    return {id:a.id,title:a.title,dueAt:a.due_date,createdAt:a.created_at,status:'published',completedCount:completed.length,targetStudentCount:memberIds.size,averageScore:(()=>{const scores=submissions.data.filter(s=>memberIds.has(s.student_id)&&s.status==='evaluated'&&s.overall_score!==null).map(s=>Number(s.overall_score));return scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;})(),...(requested?{completedStudentIds:completed,errorStudentIds:submissions.data.filter(s=>memberIds.has(s.student_id)&&s.status==='error').map(s=>s.student_id),resultsStatus:'ready',studentResults:students.data.map(student=>{const result=submissions.data.find(s=>s.student_id===student.id);return {studentId:student.id,status:result?.status||'not_submitted',score:result?.status==='evaluated'&&result.overall_score!==null&&result.overall_score!==undefined?Number(result.overall_score):null};})}:{}),url:'https://yuspeaking.yussam.com/teacher/assignments/'+a.id};
   }));
   const mapped=links.data.filter(l=>l.class_id===c.id);
   return {id:c.id,name:c.name,cardClassId:mapped.length===1?mapped[0].hr_class_id:null,studentCount:memberIds.size,canManage:c.teacher_id===teacher.id||sharedAccess.manage.includes(c.id)||identity.supervisor===true,assignments:items,...(requested?{members:students.data.map(s=>({id:s.id,name:s.name,cardId:s.hr_student_id}))}:{}),hasMoreAssignments:assignments.data.length>50,url:'https://yuspeaking.yussam.com/teacher/classes/'+c.id};
  }));
  return NextResponse.json({classes},{headers});
 }catch{return NextResponse.json({error:'과제 현황을 확인하지 못했습니다.'},{status:503,headers});}
}
