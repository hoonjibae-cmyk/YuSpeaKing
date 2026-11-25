import { NextRequest, NextResponse } from "next/server";
import { verifyPortalIdentity } from "@/lib/learning-portal-report";
import { createAdminClient } from "@/lib/supabase/admin";
import { activityWeek,activityMarks,activityPages } from "@/lib/learning-activity";
import { todayKST } from "@/lib/date";
export const dynamic = "force-dynamic";
const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
export async function GET(request:NextRequest){
 try{
  const identity=await verifyPortalIdentity(request.headers.get("authorization")),db=createAdminClient();
  if(identity.isTest&&!process.env.PORTAL_TEST_SPEAKING_STUDENT)throw Error("TEST_NOT_LINKED");
  const student=await db.from("students").select("id,class_id,status,hr_student_id,classes(archived_at)").eq(identity.isTest?"id":"hr_student_id",identity.isTest?process.env.PORTAL_TEST_SPEAKING_STUDENT:identity.cardId).maybeSingle();
  const s=student.data,k=Array.isArray(s?.classes)?s.classes[0]:s?.classes;
  if(student.error||!s||s.status!=="approved"||!k||k.archived_at||(identity.isTest&&s.hr_student_id!==null))return NextResponse.json({error:"연결된 재원생이 없습니다."},{status:404,headers});
  const [assignments,submissions]=await Promise.all([
   db.from("assignments").select("id,title,due_date,created_at").eq("class_id",s.class_id).order("created_at",{ascending:false}).order("id").limit(201),
   db.from("submissions").select("assignment_id,status,created_at").eq("student_id",s.id).order("created_at",{ascending:false}).limit(1001)
  ]);
  if(assignments.error||submissions.error||(submissions.data?.length||0)>1000)throw Error("TASK_READ_FAILED");
  const today=todayKST(),latest=new Map<string,string>();for(const row of submissions.data||[])if(!latest.has(row.assignment_id))latest.set(row.assignment_id,row.status);
  let activity=null;const week=request.nextUrl.searchParams.get("week");if(week){try{const b=activityWeek(week);const rows=await activityPages<{created_at:string;status:string}>((from,to)=>db.from("submissions").select("created_at,status",{count:"exact"}).eq("student_id",s.id).gte("created_at",b.from).lt("created_at",b.to).order("created_at").order("id").range(from,to));activity={connected:true,week,days:activityMarks(rows.map(x=>({time:x.created_at,completed:["submitted","evaluating","evaluated"].includes(x.status)})))};}catch{activity={connected:false,week,days:[]};}}
  return NextResponse.json({connected:true,activity,date:today,scope:"현재 반의 최근 200개 과제",hasMore:(assignments.data?.length||0)>200,tasks:(assignments.data||[]).slice(0,200).map(a=>{
   const status=latest.get(a.id)||"not_submitted";return {id:a.id,title:a.title,dueAt:a.due_date,createdAt:a.created_at,overdue:!!a.due_date&&a.due_date<today,status,completed:["submitted","evaluating","evaluated"].includes(status),target:"/student/assignments/"+a.id};
  })},{headers});
 }catch{return NextResponse.json({error:"과제 연결을 확인하지 못했습니다."},{status:503,headers});}
}
