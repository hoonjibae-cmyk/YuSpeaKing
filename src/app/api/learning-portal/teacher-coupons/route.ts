import {NextResponse} from 'next/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {canGrantCoupons,couponHelperClassIds} from '@/lib/coupon-helpers';
import {coTaughtClassIds} from '@/lib/transfers';
const headers={'Cache-Control':'private, no-store'};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export async function POST(request:Request){try{
 const raw=await request.text();if(raw.length>6000)throw Error('INVALID');const input=JSON.parse(raw);
 if(typeof input.proof!=='string'||input.proof.length>4096)throw Error('AUTH');
 const check=await fetch('https://portal.yussam.com/api/learning-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proof:input.proof}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!check.ok)throw Error('AUTH');const identity=await check.json();if(identity.allowed!==true||typeof identity.email!=='string')throw Error('AUTH');
 const db=createAdminClient(),rows=await db.from('teachers').select('id,email,slack_email,status,role,coupon_goal,coupon_reward_text',{count:'exact'}).limit(2000);
 if(rows.error||rows.count!==null&&rows.count>rows.data.length)throw Error('READ');
 const matches=rows.data.filter(t=>(t.status==='approved'||t.role==='admin')&&[t.email,t.slack_email].some(v=>v?.trim().toLowerCase()===identity.email.toLowerCase()));if(matches.length!==1)throw Error('AUTH');
 const teacher=matches[0],admin=identity.department==='경영지원'&&teacher.role==='admin';
 const shared=Array.from(new Set([...await coTaughtClassIds(teacher.id),...await couponHelperClassIds(teacher.id)]));
 let q=db.from('classes').select('id,name,teacher_id').is('archived_at',null).order('name').limit(1001);if(!admin)q=shared.length?q.or(`teacher_id.eq.${teacher.id},id.in.(${shared.join(',')})`):q.eq('teacher_id',teacher.id);
 const result=await q;if(result.error||result.data.length>1000)throw Error('READ');
 if(!input.classId)return NextResponse.json({classes:result.data.map(c=>({id:c.id,name:c.name}))},{headers});
 const klass=result.data.find(c=>c.id===input.classId);if(!klass)throw Error('SCOPE');
 if(input.intent==='grant'){
  if(!uuid(input.studentId)||!uuid(input.requestId)||input.amount!==1||typeof input.reason!=='string'||!input.reason.trim()||input.reason.trim().length>100)throw Error('INVALID');
  if(!admin&&!await canGrantCoupons(teacher.id,klass.id))throw Error('SCOPE');
  const grant=await db.rpc('grant_special_coupon',{p_teacher:teacher.id,p_class:klass.id,p_student:input.studentId,p_amount:1,p_reason:input.reason.trim(),p_request:input.requestId});if(grant.error)throw Error('GRANT');return NextResponse.json({ok:true,message:'특별 쿠폰과 지급 사유를 저장했습니다.'},{headers});
 }
 const students=await db.from('students').select('id,name,number,bonus_coupons,carried_coupons,coupons_reset_at',{count:'exact'}).eq('class_id',klass.id).eq('status','approved').order('number').limit(1001);if(students.error||students.data.length>1000||students.count!==null&&students.count>students.data.length)throw Error('READ');
 const members=await Promise.all(students.data.map(async s=>{let q=db.from('submissions').select('id',{count:'exact',head:true}).eq('student_id',s.id).eq('status','evaluated').gte('completeness',90);if(s.coupons_reset_at)q=q.gt('created_at',s.coupons_reset_at);const [auto,history]=await Promise.all([q,db.from('special_coupon_events').select('id,amount,reason,created_at').eq('student_id',s.id).order('created_at',{ascending:false}).limit(20)]);if(auto.error||auto.count===null||history.error)throw Error('READ');return {...s,auto:auto.count,total:auto.count+Math.max(0,s.bonus_coupons||0)+Math.max(0,s.carried_coupons||0),history:history.data};}));
 const setting=rows.data.find(t=>t.id===klass.teacher_id);return NextResponse.json({class:klass,goal:Math.max(1,setting?.coupon_goal??25),reward:setting?.coupon_reward_text?.trim()||'',students:members},{headers});
}catch(error){const reason=error instanceof Error?error.message:'';return NextResponse.json({error:reason==='AUTH'?'교사용 로그인을 확인해 주세요.':reason==='SCOPE'?'담당 반만 조회·지급할 수 있습니다.':reason==='INVALID'?'특별 쿠폰은 1개씩 지급합니다. 짧은 사유(100자 이내)를 입력해 주세요.':'쿠폰 결과를 확인하지 못했습니다. 지급을 반복하지 말고 현황을 새로 확인해 주세요.'},{status:reason==='AUTH'?401:reason==='SCOPE'?403:400,headers});}}
