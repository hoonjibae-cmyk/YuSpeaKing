import { NextRequest, NextResponse } from "next/server";
import { exchangePortalCode, clearPortalTransaction, setPreviewCookie, setPortalUiCookie } from "@/lib/learning-portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { setStudentSession } from "@/lib/student-session";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
 try {
  const preview=request.nextUrl.searchParams.get("preview")==="1";
  const identity = await exchangePortalCode(request, preview?"speaking-preview":"speaking");
  if(preview&&identity.preview_token)return setPreviewCookie(NextResponse.redirect(new URL("/learning-portal/preview",request.url)),identity.preview_token);
  if(identity.is_test||!identity.card_id)throw new Error("실제 학생 연결을 확인해 주세요.");
  const { data: student, error } = await createAdminClient().from("students").select("id,name,number,class_id,status,classes(archived_at)").eq("hr_student_id", identity.card_id).maybeSingle();
  const klass = Array.isArray(student?.classes) ? student.classes[0] : student?.classes;
  if (error || !student || student.status !== "approved" || !klass || klass.archived_at) throw new Error("유스피킹에 연결된 재원생을 찾지 못했습니다. 선생님께 문의해 주세요.");
  await setStudentSession({ studentId: student.id, classId: student.class_id, name: student.name, number: student.number });
  return setPortalUiCookie(clearPortalTransaction(NextResponse.redirect(new URL("/student/home", request.url))));
 } catch (e) {
  return clearPortalTransaction(NextResponse.json({ error: e instanceof Error ? e.message : "포탈 로그인을 완료하지 못했습니다." }, { status: 403, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }));
 }
}
