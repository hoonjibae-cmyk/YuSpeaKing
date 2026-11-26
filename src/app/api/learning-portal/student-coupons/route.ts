import {NextRequest,NextResponse} from 'next/server';
import {verifyPortalIdentity} from '@/lib/learning-portal-report';
import {createAdminClient} from '@/lib/supabase/admin';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function GET(request:NextRequest){try{
 const identity=await verifyPortalIdentity(request.headers.get('authorization')),db=createAdminClient();if(identity.isTest&&!process.env.PORTAL_TEST_SPEAKING_STUDENT)throw Error('TEST_NOT_LINKED');
 const student=await db.from('students').select('id,class_id,status,hr_student_id,coupons_reset_at,bonus_coupons,carried_coupons').eq(identity.isTest?'id':'hr_student_id',identity.isTest?process.env.PORTAL_TEST_SPEAKING_STUDENT:identity.cardId).maybeSingle();
 const s=student.data;if(student.error||!s||s.status!=='approved'||(identity.isTest&&s.hr_student_id!==null))return NextResponse.json({error:'연결된 쿠폰 계정이 없습니다.'},{status:404,headers});
 const c=await db.from('classes').select('teacher_id').eq('id',s.class_id).single();if(c.error||!c.data)throw Error('CLASS_READ');
 const teacher=await db.from('teachers').select('coupon_goal,coupon_reward_text').eq('id',c.data.teacher_id).maybeSingle();if(teacher.error)throw Error('TEACHER_READ');
 let query=db.from('submissions').select('id',{head:true,count:'exact'}).eq('student_id',s.id).eq('status','evaluated').gte('completeness',90);if(s.coupons_reset_at)query=query.gt('created_at',s.coupons_reset_at);const coupons=await query;if(coupons.error||coupons.count===null)throw Error('COUPON_READ');
 const auto=coupons.count,bonus=Math.max(0,s.bonus_coupons??0),carried=Math.max(0,s.carried_coupons??0);return NextResponse.json({count:auto+bonus+carried,auto,bonus,carried,goal:Math.max(1,teacher.data?.coupon_goal??25),reward:teacher.data?.coupon_reward_text?.trim()||''},{headers});
 }catch{return NextResponse.json({error:'쿠폰 현황을 확인하지 못했습니다.'},{status:503,headers});}}
