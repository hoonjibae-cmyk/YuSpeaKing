import {randomUUID} from 'crypto';
import {notFound} from 'next/navigation';
import {getTeacherContext} from '@/lib/teacher-context';
import {sharedClassIds,accessFor} from '@/lib/class-access';
import {waveNetEnabled} from '@/lib/sample-voices';
import PassageComposer from '../PassageComposer';
import PopupBridge from './PopupBridge';
export const maxDuration=300;

export default async function CreateAssignmentPopup({params}:{params:{classId:string}}){
 const {db,effectiveId,role}=await getTeacherContext();
 const [klass,shared]=await Promise.all([db.from('classes').select('id,name,teacher_id').eq('id',params.classId).maybeSingle(),sharedClassIds(effectiveId)]);
 if(!klass.data||!(role==='admin'||accessFor(params.classId,klass.data.teacher_id===effectiveId,shared).canManage))notFound();
 return <main className="maeil-assignment-popup"><PopupBridge classId={params.classId}/><p className="mb-4 text-sm text-slate-500">{klass.data.name} · 유스피킹</p><PassageComposer classId={params.classId} wavenetEnabled={waveNetEnabled()} popupRequestId={randomUUID()}/></main>;
}
