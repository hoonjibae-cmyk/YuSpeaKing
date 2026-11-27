import 'server-only';
import {createAdminClient} from '@/lib/supabase/admin';
import {sharedClassIds, accessFor} from '@/lib/class-access';

export const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export function accessError(message:string,status=400){return Object.assign(new Error(message),{status});}

// Scope every read and write before using the service client. A delegated proof
// remains read-only even when the underlying teacher can manage the class.
export async function learningTeacherClass(proof:unknown,classId:unknown){
 if(typeof proof!=='string'||proof.length>4096)throw accessError('교사용 로그인을 확인해 주세요.',401);
 if(!validId(classId))throw accessError('반 주소를 확인해 주세요.');
 const response=await fetch('https://portal.yussam.com/api/learning-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proof}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw accessError('교사용 권한을 확인해 주세요.',response.status===503?503:403);
 const identity=await response.json();
 if(identity.allowed!==true||typeof identity.email!=='string')throw accessError('교사용 권한이 없습니다.',403);
 const db=createAdminClient();
 const [teachers,klass]=await Promise.all([
  db.from('teachers').select('id,email,slack_email,status,role',{count:'exact'}).limit(2000),
  db.from('classes').select('id,name,teacher_id').eq('id',classId).maybeSingle(),
 ]);
 if(teachers.error||teachers.count!==null&&teachers.count>teachers.data.length||klass.error)throw accessError('반 정보를 불러오지 못했습니다.',503);
 if(!klass.data)throw accessError('반을 찾을 수 없습니다.',404);
 const matches=teachers.data.filter(t=>(t.status==='approved'||t.role==='admin')&&[t.email,t.slack_email].some(e=>e?.trim().toLowerCase()===identity.email.toLowerCase()));
 if(matches.length>1||!matches.length&&!identity.supervisor)throw accessError('선생님 계정 연결을 확인해 주세요.',403);
 const teacher=matches[0],shared=teacher?await sharedClassIds(teacher.id):{manage:[],viewOnly:[],all:[]};
 const access=accessFor(classId,teacher?.id===klass.data.teacher_id,shared);
 const admin=identity.department==='경영지원'&&teacher?.role==='admin'&&!identity.viewOnly;
 if(!access.canView&&!identity.supervisor&&!admin)throw accessError('이 반의 조회 권한이 없습니다.',403);
 return {db,klass:klass.data,canManage:!identity.viewOnly&&(access.canManage||admin)};
}
