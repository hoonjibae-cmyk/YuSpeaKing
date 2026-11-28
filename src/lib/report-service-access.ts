import 'server-only';
import {createAdminClient} from '@/lib/supabase/admin';
export async function reportServiceClasses(input:{serviceTicket:unknown;cardClassId:unknown;from:string;until:string}){
 if(typeof input.serviceTicket!=='string'||input.serviceTicket.length>2048)throw Error('REPORT_SERVICE_AUTH');
 const verified=await fetch('https://voca.yussam.com/api/internal/report-source-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:input.serviceTicket}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(7000)});
 if(!verified.ok)throw Error('REPORT_SERVICE_AUTH');const scope=await verified.json();
 if(scope.allowed!==true||scope.cardClassId!==input.cardClassId||scope.from!==input.from||scope.until!==input.until)throw Error('REPORT_SERVICE_AUTH');
 const db=createAdminClient(),links=await db.from('class_links').select('class_id').eq('hr_class_id',scope.cardClassId).limit(3);
 if(links.error||links.data.length>1)throw Error('REPORT_SERVICE_LINK');if(!links.data.length)return [];
 const found=await db.from('classes').select('id').eq('id',links.data[0].class_id).is('archived_at',null).maybeSingle();
 if(found.error)throw Error('REPORT_SERVICE_LINK');return found.data?[found.data]:[];
}
