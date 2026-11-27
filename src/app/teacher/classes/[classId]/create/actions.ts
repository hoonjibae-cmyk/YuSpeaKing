'use server';
import {getSpeakingAuthoringContext} from '@/lib/speaking-authoring-context';
import {createSpeakingAssignment} from '@/lib/create-speaking-assignment';
import {revalidatePath} from 'next/cache';

export async function createPopupAssignment(form:FormData){
 const classId=String(form.get('classId')||'');
 const context=await getSpeakingAuthoringContext(classId);
 if(!context)return {error:'이 반의 출제 권한이 없습니다.'};
 try{
  const result=await createSpeakingAssignment(context.db,form);
  revalidatePath('/teacher/classes/'+classId);
  return {...result,error:null};
 }catch(error){return {error:error instanceof Error?error.message:'과제를 등록하지 못했습니다.'};}
}
