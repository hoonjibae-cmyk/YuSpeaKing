import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {createAdminClient} from '@/lib/supabase/admin';
import {recordingRetainsUntil} from '@/lib/recording-retention';

type Db=ReturnType<typeof createAdminClient>;
type Submission={id:string;assignment_id:string;student_id:string;created_at:string;updated_at?:string|null;status:string;audio_path?:string|null;audio_expired?:boolean|null};
type StoredFile={name:string;updated_at?:string|null;created_at?:string|null;id?:string|null};
export type ReportRecording={id:string;title:string;submittedAt:string;retainsUntil:string;audioUrl:string|null};
type Grant={v:1;id:string;student:string;assignment:string;uploadedAt:string;expiresAt:number};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
function signature(value:string){const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw Error('RECORDING_CONFIG');return createHmac('sha256',key).update('weekly-report-recording-v1:'+value).digest('hex');}
export function recordingGrant(grant:Grant){const value=Buffer.from(JSON.stringify(grant)).toString('base64url');return value+'.'+signature(value);}
export function verifyRecordingGrant(token:string,now=Date.now()):Grant{
 if(token.length>2000||!/^[-_A-Za-z0-9]+\.[a-f0-9]{64}$/.test(token))throw Error('RECORDING_ACCESS');
 const [value,sig]=token.split('.');if(!timingSafeEqual(Buffer.from(sig),Buffer.from(signature(value))))throw Error('RECORDING_ACCESS');
 const grant=JSON.parse(Buffer.from(value,'base64url').toString()) as Grant;
 if(grant.v!==1||!uuid(grant.id)||!uuid(grant.student)||!uuid(grant.assignment)||!Number.isFinite(Date.parse(grant.uploadedAt))||!Number.isFinite(grant.expiresAt)||grant.expiresAt<=now)throw Error('RECORDING_ACCESS');
 return grant;
}
const pathFor=(s:Pick<Submission,'assignment_id'|'student_id'>)=>`${s.assignment_id}/${s.student_id}.wav`;

// One folder read per assignment, not one signed URL request per student/file.
// Storage upload time handles re-submission without treating later grading edits as uploads.
export async function weeklyRecordings(db:Db,assignments:{id:string;title:string}[],submissions:Submission[],from:string,until:string,now=Date.now()){
 const lo=Date.parse(from+'T00:00:00+09:00'),hi=Math.min(Date.parse(until+'T00:00:00+09:00'),now);
 const students=new Map<string,{recordings:ReportRecording[];recordingsUnavailable:boolean}>();
 const titles=new Map(assignments.map(a=>[a.id,a.title]));
 const latest=new Map<string,Submission>();
 for(const s of submissions){
  if(!titles.has(s.assignment_id)||!['submitted','evaluating','evaluated','error'].includes(s.status)||s.audio_path!==pathFor(s))continue;
  if(!Number.isFinite(Date.parse(s.created_at))||Date.parse(s.created_at)>=hi||Date.parse(s.updated_at||s.created_at)<lo)continue;
  const key=s.student_id+'|'+s.assignment_id,old=latest.get(key);
  if(!old||Date.parse(s.updated_at||s.created_at)>Date.parse(old.updated_at||old.created_at))latest.set(key,s);
 }
 const rows=Array.from(latest.values());
 const groups=Array.from(new Set(rows.map(s=>s.assignment_id)));
 for(let i=0;i<groups.length;i+=4)await Promise.all(groups.slice(i,i+4).map(async assignmentId=>{
  const candidates=rows.filter(s=>s.assignment_id===assignmentId),files:StoredFile[]=[];let failed=false;
  try{
   for(let offset=0;offset<10000;offset+=500){
    const result=await db.storage.from('submissions').list(assignmentId,{limit:500,offset,sortBy:{column:'name',order:'asc'}});
    if(result.error||!result.data)throw Error('RECORDING_LIST');files.push(...result.data);
    if(result.data.length<500)break;if(offset===9500)throw Error('RECORDING_LIST_LIMIT');
   }
  }catch{failed=true;}
  for(const sub of candidates){
   const result=students.get(sub.student_id)||{recordings:[],recordingsUnavailable:false};students.set(sub.student_id,result);
   if(failed){result.recordingsUnavailable=true;continue;}
   const file=files.find(f=>f.name===sub.student_id+'.wav');
   const submittedAt=file?.updated_at||file?.created_at||sub.created_at;
   if(!Number.isFinite(Date.parse(submittedAt))||Date.parse(submittedAt)<lo||Date.parse(submittedAt)>=hi)continue;
   const retainsUntil=recordingRetainsUntil(sub.created_at),expiresAt=Date.parse(retainsUntil);
   const available=!!file&&!sub.audio_expired&&expiresAt>now;
   const token=available?recordingGrant({v:1,id:sub.id,student:sub.student_id,assignment:sub.assignment_id,uploadedAt:submittedAt,expiresAt}):null;
   result.recordings.push({id:sub.id,title:titles.get(sub.assignment_id)||'유스피킹 과제',submittedAt,retainsUntil,
    audioUrl:token?'https://yuspeaking.yussam.com/api/learning-portal/report-recording?token='+token:null});
  }
 }));
 students.forEach(result=>result.recordings.sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt)||a.id.localeCompare(b.id)));
 return students;
}

export async function reportRecordingResponse(request:Request,db:Db,now=Date.now()){
 const headers=new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
 try{
  const grant=verifyRecordingGrant(new URL(request.url).searchParams.get('token')||'',now);
  const result=await db.from('submissions').select('id,student_id,assignment_id,audio_path,audio_expired,created_at,status').eq('id',grant.id).eq('student_id',grant.student).eq('assignment_id',grant.assignment).maybeSingle();
  const sub=result.data as Submission|null;
  if(result.error||!sub||sub.id!==grant.id||sub.student_id!==grant.student||sub.assignment_id!==grant.assignment||sub.audio_expired||sub.audio_path!==pathFor(sub)||Date.parse(recordingRetainsUntil(sub.created_at))<=now)throw Error('RECORDING_UNAVAILABLE');
  const fileResult=await db.storage.from('submissions').list(grant.assignment,{limit:100,search:grant.student+'.wav'});
  const file=fileResult.data?.find(f=>f.name===grant.student+'.wav');
  if(fileResult.error||!file||(file.updated_at||file.created_at)!==grant.uploadedAt)throw Error('RECORDING_REPLACED');
  const range=request.headers.get('range');if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return new Response(null,{status:416,headers});
  const signed=await db.storage.from('submissions').createSignedUrl(sub.audio_path!,60);
  if(signed.error||!signed.data?.signedUrl)throw Error('RECORDING_UNAVAILABLE');
  const url=new URL(signed.data.signedUrl),storage=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if(url.protocol!=='https:'||url.origin!==storage.origin||!url.pathname.startsWith('/storage/v1/object/sign/submissions/'))throw Error('RECORDING_UNAVAILABLE');
  const media=await fetch(url,{headers:range?{Range:range}:{},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(60000)});
  if(media.status===416){const contentRange=media.headers.get('content-range');if(contentRange)headers.set('Content-Range',contentRange);return new Response(null,{status:416,headers});}
  if(![200,206].includes(media.status)||!media.body)throw Error('RECORDING_UNAVAILABLE');
  headers.set('Content-Type','audio/wav');headers.set('Accept-Ranges','bytes');
  for(const name of ['content-length','content-range']){const value=media.headers.get(name);if(value)headers.set(name,value);}
  return new Response(media.body,{status:media.status,headers});
 }catch{return new Response('녹음 파일을 재생할 수 없습니다. 보관 기한이 지났거나 파일이 교체되었을 수 있습니다.',{status:404,headers});}
}
