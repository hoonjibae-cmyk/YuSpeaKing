import { NextRequest, NextResponse } from "next/server";
import { verifyPortalStudent, portalWeek } from "@/lib/learning-portal-report";
import { createAdminClient } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
 try {
  const cardId = await verifyPortalStudent(request.headers.get("authorization"));
  const week = portalWeek(request.nextUrl.searchParams.get("week")), db = createAdminClient();
  const { data: student, error } = await db.from("students").select("id,status,classes(archived_at)").eq("hr_student_id",cardId).maybeSingle();
  const klass = Array.isArray(student?.classes) ? student.classes[0] : student?.classes;
  if (error || !student || student.status !== "approved" || !klass || klass.archived_at) return NextResponse.json({ error: "연결된 재원생이 없습니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { data, error: readError } = await db.from("submissions").select("id,assignment_id,overall_score,status,created_at").eq("student_id",student.id).eq("status","evaluated").gte("created_at",week.from).lt("created_at",week.to).order("created_at",{ascending:true});
  if (readError) throw new Error("학습 기록 조회에 실패했습니다.");
  return NextResponse.json({ connected:true,events:(data||[]).map(s=>({id:s.id,program:"speaking",kind:"evaluated_submission",value:1,occurred_at:s.created_at,detail:{score:s.overall_score,assignmentId:s.assignment_id}})) }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
 } catch (e) {
  return NextResponse.json({error:e instanceof Error?e.message:"리포트 조회에 실패했습니다."},{status:403,headers:{"Cache-Control":"no-store"}});
 }
}
