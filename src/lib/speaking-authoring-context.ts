import 'server-only';
import {getTeacherContext} from '@/lib/teacher-context';
import {createAdminClient} from '@/lib/supabase/admin';
import {sharedClassIds,accessFor} from '@/lib/class-access';

// A verified administrator can author in any class without impersonating its
// teacher. Ordinary teachers retain their RLS client and class-level checks.
export async function getSpeakingAuthoringContext(classId:string){
 const context=await getTeacherContext();
 const isAdmin=context.role==='admin';
 const db=isAdmin?createAdminClient():context.db;
 const [klass,shared]=await Promise.all([
  db.from('classes').select('id,name,teacher_id').eq('id',classId).maybeSingle(),
  isAdmin?Promise.resolve({manage:[],viewOnly:[],all:[]}):sharedClassIds(context.effectiveId),
 ]);
 if(klass.error)throw Error('반 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
 if(!klass.data||!isAdmin&&!accessFor(classId,klass.data.teacher_id===context.effectiveId,shared).canManage)return null;
 return {db,klass:klass.data};
}
