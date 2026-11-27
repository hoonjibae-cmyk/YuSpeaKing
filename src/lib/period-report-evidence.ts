import type {AzureScores} from './types';
type Assignment={id:string;title:string;created_at:string;due_date:string|null};
type Submission={id:string;assignment_id:string;student_id:string;status:string;overall_score:number|null;azure_scores:AzureScores|null;created_at:string;updated_at?:string;attempt_count?:number;teacher_feedback?:string|null;teacher_reviewed?:boolean};
const day=(v:string)=>new Date(Date.parse(v)+9*3600000).toISOString().slice(0,10);
const mean=(values:(number|null|undefined)[])=>{const n=values.filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));return n.length?Math.round(n.reduce((a,b)=>a+b,0)/n.length*10)/10:null;};
export function speakingPeriodEvidence(student:{id:string;approved_at?:string|null},assignments:Assignment[],submissions:Submission[],from:string,until:string,now=Date.now()){
 const end=Math.min(Date.parse(until+'T00:00:00+09:00'),now),start=Date.parse(from+'T00:00:00+09:00'),ids=new Set(assignments.map(a=>a.id));
 // A student/assignment is counted once; deterministic ordering also handles legacy duplicate rows.
 const eligible=submissions.filter(s=>s.student_id===student.id&&ids.has(s.assignment_id)&&Date.parse(s.created_at)<end&&['submitted','evaluating','evaluated','error'].includes(s.status));
 const latest=new Map<string,Submission>();for(const s of eligible.sort((a,b)=>(a.updated_at||a.created_at).localeCompare(b.updated_at||b.created_at)||a.id.localeCompare(b.id)))latest.set(s.assignment_id,s);
 const activity=Array.from(latest.values()).filter(s=>Date.parse(s.created_at)>=start),graded=activity.filter(s=>s.status==='evaluated'&&s.overall_score!==null);
 const assigned=assignments.filter(a=>{const target=a.due_date?.slice(0,10)||day(a.created_at);return target>=from&&target<until&&target<=day(new Date(now).toISOString())&&(!student.approved_at||target>=day(student.approved_at));});
 const weak=new Map<string,{word:string;times:number;kind:string}>();for(const s of graded){for(const w of s.azure_scores?.words||[]){
  if(!w.errorType||w.errorType==='None'||w.errorType==='Insertion'||s.azure_scores?.truncated&&w.errorType==='Omission')continue;
  const key=w.word.toLowerCase();const v=weak.get(key)||{word:key,times:0,kind:w.errorType==='Omission'?'누락':'발음 확인'};v.times++;weak.set(key,v);
 }}
 const dimensions=Object.fromEntries(['accuracy','fluency','completeness','prosody'].map(key=>[key,mean(graded.map(s=>key==='completeness'&&s.azure_scores?.truncated?null:s.azure_scores?.[key as keyof AzureScores] as number|null))]));
 return {submissions:activity.length,score:mean(graded.map(s=>s.overall_score)),assigned:assigned.length,completed:assigned.filter(a=>latest.has(a.id)).length,graded:graded.length,pendingEvaluation:activity.length-graded.length,
  resubmissions:activity.filter(s=>(s.attempt_count||1)>1).length,activity:Array.from(new Set(activity.map(s=>day(s.created_at)))).sort().map(day=>({day,program:'speaking'})),
  trend:graded.map(s=>({day:day(s.created_at),score:s.overall_score,title:assignments.find(a=>a.id===s.assignment_id)?.title})).sort((a,b)=>a.day.localeCompare(b.day)),dimensions,
  weakWords:Array.from(weak.values()).sort((a,b)=>b.times-a.times||a.word.localeCompare(b.word)).slice(0,8),
  feedback:graded.filter(s=>s.teacher_reviewed&&s.teacher_feedback?.trim()).map(s=>s.teacher_feedback!.slice(0,2000)).slice(-3),
  pending:assigned.filter(a=>!latest.has(a.id)).map(a=>({title:a.title,day:a.due_date?.slice(0,10)||day(a.created_at)}))};
}
