import {todayKST} from '@/lib/date';
import {fetchScoreRows,dailyAverage,visibleClasses,trendFrom} from '@/lib/trend';
import {generateClassCode} from '@/lib/class-code';
import {getSyncMode} from '@/lib/hr/sync';
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
 const db=createAdminClient(),rows=await db.from('teachers').select('id,email,slack_email,status,role,name,coupon_goal,coupon_reward_text',{count:'exact'}).limit(2000);
 if(rows.error||rows.count!==null&&rows.count>rows.data.length)throw Error('READ');
 const matches=rows.data.filter(t=>(t.status==='approved'||t.role==='admin')&&[t.email,t.slack_email].some(v=>v?.trim().toLowerCase()===identity.email.toLowerCase()));if(identity.viewOnly&&matches.length===0)return NextResponse.json({classes:[]},{headers});if(matches.length!==1)throw Error('AUTH');
 const teacher=matches[0],admin=identity.department==='경영지원'&&teacher.role==='admin';
 if(['trend','trendExport'].includes(input.intent)){
  const days=input.days===182?182:input.days===365?365:30,from=trendFrom(days),classes=await visibleClasses(db,teacher.id),scores=await fetchScoreRows(db,classes,from);
  if(input.intent==='trendExport'){const cell=(value:unknown)=>{const raw=value==null?'':String(value),safe=typeof value==='string'&&/^[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';};const csv='\uFEFF'+[['반','번호','이름','과제','제출일','종합','정확도','유창성','완성도','억양'],...scores.map(r=>[r.className,r.studentNumber,r.studentName,r.assignmentTitle,r.date,r.overall,r.accuracy,r.fluency,r.completeness,r.prosody])].map(row=>row.map(cell).join(',')).join('\r\n');return NextResponse.json({csv,filename:'유스피킹_성적_'+from+'_'+todayKST()+'.csv'},{headers});}
  return NextResponse.json({from,until:todayKST(),series:classes.map(c=>{const rows=scores.filter(r=>r.classId===c.id);return {id:c.id,name:c.name,count:rows.length,points:dailyAverage(rows),average:rows.length?rows.reduce((n,r)=>n+r.overall,0)/rows.length:null};})},{headers});
 }
 if(['rewardSettings','saveRewardSettings'].includes(input.intent)){
  if(!admin||identity.viewOnly)throw Error('SCOPE');
  if(input.intent==='saveRewardSettings'){if(!uuid(input.teacherId)||!Number.isInteger(input.goal)||input.goal<1||input.goal>100||typeof input.reward!=='string'||input.reward.length>500||!rows.data.some(t=>t.id===input.teacherId))throw Error('INVALID');const r=await db.from('teachers').update({coupon_goal:input.goal,coupon_reward_text:input.reward.trim()}).eq('id',input.teacherId);if(r.error)throw Error('READ');return NextResponse.json({ok:true,message:'쿠폰·보상 설정을 저장했습니다.'},{headers});}
  return NextResponse.json({teachers:rows.data.map(t=>({id:t.id,name:t.name||t.email,goal:t.coupon_goal??25,reward:t.coupon_reward_text||''}))},{headers});
 }
 if(input.intent==='createClass'){
  if(identity.viewOnly||teacher.role!=='admin'&&await getSyncMode()==='oneway')throw Error('SCOPE');if(typeof input.name!=='string'||input.name.trim().length<2||input.name.length>60)throw Error('INVALID');
  for(let i=0;i<5;i++){const r=await db.from('classes').insert({teacher_id:teacher.id,name:input.name.trim(),class_code:generateClassCode()}).select('id').single();if(!r.error)return NextResponse.json({ok:true,id:r.data.id,message:'유스피킹 반을 만들었습니다.'},{headers});if(r.error.code!=='23505')throw Error('READ');}throw Error('READ');
 }
 const shared=Array.from(new Set([...await coTaughtClassIds(teacher.id),...await couponHelperClassIds(teacher.id)]));
 let q=db.from('classes').select('id,name,teacher_id').is('archived_at',null).order('name').limit(1001);if(!admin)q=shared.length?q.or(`teacher_id.eq.${teacher.id},id.in.(${shared.join(',')})`):q.eq('teacher_id',teacher.id);
 const result=await q;if(result.error||result.data.length>1000)throw Error('READ');
 if(!input.classId)return NextResponse.json({classes:result.data.map(c=>({id:c.id,name:c.name}))},{headers});
 const klass=result.data.find(c=>c.id===input.classId);if(!klass)throw Error('SCOPE');
 if(input.intent==='grant'){
  if(identity.viewOnly)throw Error('SCOPE');
  if(!uuid(input.studentId)||!uuid(input.requestId)||input.amount!==1||typeof input.reason!=='string'||!input.reason.trim()||input.reason.trim().length>100)throw Error('INVALID');
  if(!admin&&!await canGrantCoupons(teacher.id,klass.id))throw Error('SCOPE');
  const grant=await db.rpc('grant_special_coupon',{p_teacher:teacher.id,p_class:klass.id,p_student:input.studentId,p_amount:1,p_reason:input.reason.trim(),p_request:input.requestId});if(grant.error)throw Error('GRANT');return NextResponse.json({ok:true,message:'특별 쿠폰과 지급 사유를 저장했습니다.'},{headers});
 }
 const students=await db.from('students').select('id,name,number,bonus_coupons,carried_coupons,coupons_reset_at',{count:'exact'}).eq('class_id',klass.id).eq('status','approved').order('number').limit(1001);if(students.error||students.data.length>1000||students.count!==null&&students.count>students.data.length)throw Error('READ');
 const members=await Promise.all(students.data.map(async s=>{let q=db.from('submissions').select('id',{count:'exact',head:true}).eq('student_id',s.id).eq('status','evaluated').gte('completeness',90);if(s.coupons_reset_at)q=q.gt('created_at',s.coupons_reset_at);const [auto,history]=await Promise.all([q,db.from('special_coupon_events').select('id,amount,reason,created_at').eq('student_id',s.id).order('created_at',{ascending:false}).limit(20)]);if(auto.error||auto.count===null||history.error)throw Error('READ');return {...s,auto:auto.count,total:auto.count+Math.max(0,s.bonus_coupons||0)+Math.max(0,s.carried_coupons||0),history:history.data};}));
 const setting=rows.data.find(t=>t.id===klass.teacher_id);return NextResponse.json({class:klass,goal:Math.max(1,setting?.coupon_goal??25),reward:setting?.coupon_reward_text?.trim()||'',students:members},{headers});
}catch(error){const reason=error instanceof Error?error.message:'';return NextResponse.json({error:reason==='AUTH'?'교사용 로그인을 확인해 주세요.':reason==='SCOPE'?'담당 반만 조회·지급할 수 있습니다.':reason==='INVALID'?'특별 쿠폰은 1개씩 지급합니다. 짧은 사유(100자 이내)를 입력해 주세요.':'쿠폰 결과를 확인하지 못했습니다. 지급을 반복하지 말고 현황을 새로 확인해 주세요.'},{status:reason==='AUTH'?401:reason==='SCOPE'?403:400,headers});}}
