'use server';
import {getTeacherContext} from '@/lib/teacher-context';
import {sharedClassIds,accessFor} from '@/lib/class-access';
import {createSpeakingAssignment} from '@/lib/create-speaking-assignment';
import {revalidatePath} from 'next/cache';

export async function createPopupAssignment(form:FormData){
 const {db,effectiveId,role}=await getTeacherContext();
 const classId=String(form.get('classId')||'');
 const [klass,shared]=await Promise.all([db.from('classes').select('id,teacher_id').eq('id',classId).maybeSingle(),sharedClassIds(effectiveId)]);
 if(!klass.data||!(role==='admin'||accessFor(classId,klass.data.teacher_id===effectiveId,shared).canManage))return {error:'이 반의 출제 권한이 없습니다.'};
 try{
  const result=await createSpeakingAssignment(db,form);
  revalidatePath('/teacher/classes/'+classId);
  return {...result,error:null};
 }catch(error){return {error:error instanceof Error?error.message:'과제를 등록하지 못했습니다.'};}
}
