import 'server-only';
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {createServerClient,type CookieOptions} from '@supabase/ssr';
import {createAdminClient} from '@/lib/supabase/admin';
const portal='https://learning.yussam.com';
const name='maeil_teacher_transaction';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const nonce=()=>randomBytes(32).toString('base64url');
function secret(){const value=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;if(!value)throw Error('Missing server configuration');return createHash('sha256').update('maeil-teacher-transaction:'+value).digest();}
function seal(value:object){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret(),iv);const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(b=>b.toString('base64url')).join('.');}
function unseal(value:string){const [iv,tag,data]=value.split('.').map(b=>Buffer.from(b,'base64url')),cipher=createDecipheriv('aes-256-gcm',secret(),iv);cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString());}
export function teacherDestination(app:'speaking'|'voca',target:unknown){if(typeof target!=='string')return null;const id='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',pattern=app==='speaking'?'^/teacher(?:/(?:notices|move|transfers|archived)|/classes/'+id+'(?:#maeil-create)?|/assignments/'+id+')?$':'^(?:/admin/classes(?:/'+id+'(?:/self-tests(?:/'+id+')?)?)?|/admin/students|/reports/daily(?:/'+id+')?)$';return new RegExp(pattern,'i').test(target)?target:null;}
export function startTeacherLogin(request:NextRequest,app:'speaking'|'voca'){
 try{const target=teacherDestination(app,request.nextUrl.searchParams.get('target'));if(!target)return NextResponse.json({error:'허용되지 않은 출제 화면입니다.'},{status:400,headers});
 const state=nonce(),verifier=nonce(),tx=seal({state,verifier,target,app,expires:Date.now()+180000});
 const url=new URL('/teacher/authorize',portal);url.search=new URLSearchParams({client_id:app,state,target,code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();
 const response=NextResponse.redirect(url,{headers});response.cookies.set(name,tx,{path:'/api/learning-portal/teacher',httpOnly:true,secure:true,sameSite:'lax',maxAge:180});return response;
 }catch{return NextResponse.json({error:'출제 화면 연결을 준비 중입니다.'},{status:503,headers});}
}
export async function finishTeacherLogin(request:NextRequest,app:'speaking'|'voca'){
 try{
 const tx=unseal(request.cookies.get(name)?.value||'');
 if(tx.app!==app||tx.expires<=Date.now()||typeof tx.state!=='string'||tx.state!==request.nextUrl.searchParams.get('state')||!teacherDestination(app,tx.target))throw Error('Invalid login transaction');
 const exchanged=await fetch(portal+'/api/teacher/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:app,code:request.nextUrl.searchParams.get('code'),code_verifier:tx.verifier}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!exchanged.ok)throw Error('Exchange failed');const exchange=await exchanged.json();
 if(exchange.audience!==app||exchange.target!==tx.target||typeof exchange.proof!=='string')throw Error('Invalid exchange identity');
 const checked=await fetch('https://portal.yussam.com/api/learning-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proof:exchange.proof,purpose:'launch'}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!checked.ok)throw Error('Staff access unavailable');const staff=await checked.json();
 if(staff.allowed!==true||typeof staff.email!=='string'||typeof staff.empNo!=='string')throw Error('Staff access denied');
 const admin=createAdminClient();let userId:string,viewTeacherId:string|undefined;
 if(app==='speaking'){
 const result=await admin.from('teachers').select('id,email,slack_email,status,role',{count:'exact'}).limit(2000);
 if(result.error||result.count!==null&&result.count>result.data.length)throw Error('Teacher lookup failed');
 const matches=result.data.filter((t:{id:string;email?:string;slack_email?:string;status:string;role:string})=>(t.status==='approved'||t.role==='admin')&&[t.email,t.slack_email].some(e=>e?.trim().toLowerCase()===staff.email.toLowerCase()));
 if(matches.length!==1)throw Error('Ambiguous teacher');userId=matches[0].id;
 if(exchange.navigation?.viewing){if(staff.department!=='경영지원'||matches[0].role!=='admin')throw Error('Supervisor login required');const targets=result.data.filter((t:{id:string;email?:string;slack_email?:string;status:string;role:string})=>(t.status==='approved'||t.role==='admin')&&[t.email,t.slack_email].some(e=>e?.trim().toLowerCase()===exchange.navigation.viewing.email?.toLowerCase()));if(targets.length!==1)throw Error('View teacher mapping failed');viewTeacherId=targets[0].id;}
 }else{
 const result=await admin.from('profiles').select('id,work_email,role,is_active,password_recovery_id').eq('hr_emp_no',staff.empNo).eq('is_active',true).in('role',['teacher','admin']).limit(2);
 if(result.error||result.data.length!==1||result.data[0].work_email?.trim().toLowerCase()!==staff.email.toLowerCase()||result.data[0].password_recovery_id)throw Error('Teacher mapping failed');userId=result.data[0].id;
 }
 const found=await admin.auth.admin.getUserById(userId),user=found.data.user;
 if(found.error||!user?.email||user.id!==userId||user.app_metadata?.must_change_password||user.app_metadata?.password_recovery_id||user.banned_until&&Date.parse(user.banned_until)>Date.now())throw Error('Inactive auth account');
 const link=await admin.auth.admin.generateLink({type:'magiclink',email:user.email});
 if(link.error||link.data.user?.id!==userId||!link.data.properties?.hashed_token)throw Error('Session preparation failed');
 const response=NextResponse.redirect(new URL(tx.target,request.url),{headers});
 const supabase=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,{cookies:{getAll:()=>request.cookies.getAll(),setAll:(items:{name:string;value:string;options:CookieOptions}[])=>items.forEach(({name,value,options})=>response.cookies.set(name,value,options))}});
 const verified=await supabase.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});
 if(verified.error||verified.data.user?.id!==userId)throw Error('Session identity mismatch');
 response.cookies.set('maeil_teacher_nav',JSON.stringify({isAdmin:staff.department==='경영지원',supervisor:staff.supervisor===true,programs:exchange.navigation?.programs||['speaking','voca','review']}),{path:'/',secure:true,sameSite:'lax',maxAge:43200});
 response.cookies.set(name,'',{path:'/api/learning-portal/teacher',maxAge:0});response.cookies.set('maeil_teacher_ui','1',{path:'/',secure:true,sameSite:'lax',maxAge:43200});
 if(app==='speaking')response.cookies.set('yus_admin_as',viewTeacherId||'',{path:'/',httpOnly:true,secure:true,sameSite:'lax',maxAge:viewTeacherId?1750:0});
 else response.cookies.set('yv_portal_account','',{path:'/',maxAge:0});
 return response;
 }catch{const response=NextResponse.json({error:'교사용 로그인을 연결하지 못했습니다. 매일 러닝에서 다시 시작해 주세요.'},{status:403,headers});response.cookies.set(name,'',{path:'/api/learning-portal/teacher',maxAge:0});return response;}
}
