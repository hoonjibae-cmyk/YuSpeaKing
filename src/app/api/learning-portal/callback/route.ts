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
  const testSubject=process.env.PORTAL_TEST_VOCA_SUBJECT, testStudent=process.env.PORTAL_TEST_SPEAKING_STUDENT;
  const nativeTest=!!testSubject && !!testStudent && identity.is_test===true && identity.card_id===null && identity.subject==="test:voca:"+testSubject && identity.test_auth_subject===testSubject;
  if(!nativeTest && (identity.is_test||!identity.card_id))throw new Error("실제 학생 연결을 확인해 주세요.");
  const { data: student, error } = await createAdminClient().from("students").select("id,name,number,class_id,status,hr_student_id,classes(archived_at)").eq(nativeTest?"id":"hr_student_id", nativeTest?testStudent:identity.card_id).maybeSingle();
  const klass = Array.isArray(student?.classes) ? student.classes[0] : student?.classes;
  if (error || !student || (nativeTest && (student.id!==testStudent || student.hr_student_id!==null)) || student.status !== "approved" || !klass || klass.archived_at) throw new Error("유스피킹에 연결된 재원생을 찾지 못했습니다. 선생님께 문의해 주세요.");
  await setStudentSession({ studentId: student.id, classId: student.class_id, name: student.name, number: student.number });
  return setPortalUiCookie(clearPortalTransaction(NextResponse.redirect(new URL(identity.target||"/student/home", request.url))),identity.programs);
 } catch (e) {
  return clearPortalTransaction(NextResponse.json({ error: e instanceof Error ? e.message : "포탈 로그인을 완료하지 못했습니다." }, { status: 403, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }));
 }
}
