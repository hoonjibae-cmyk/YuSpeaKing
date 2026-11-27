import {randomUUID} from 'crypto';
import {notFound} from 'next/navigation';
import {getSpeakingAuthoringContext} from '@/lib/speaking-authoring-context';
import {waveNetEnabled} from '@/lib/sample-voices';
import PassageComposer from '../PassageComposer';
import PopupBridge from './PopupBridge';
export const maxDuration=300;

export default async function CreateAssignmentPopup({params}:{params:{classId:string}}){
 const context=await getSpeakingAuthoringContext(params.classId);
 if(!context)notFound();
 return <main className="maeil-assignment-popup"><PopupBridge classId={params.classId}/><p className="mb-4 text-sm text-slate-500">{context.klass.name} · 유스피킹</p><PassageComposer classId={params.classId} wavenetEnabled={waveNetEnabled()} popupRequestId={randomUUID()}/></main>;
}
