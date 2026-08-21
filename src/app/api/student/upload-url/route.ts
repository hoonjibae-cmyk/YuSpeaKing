import { NextResponse } from "next/server";
import { getStudentSession } from "@/lib/student-session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkCanSubmit,
  SUBMISSIONS_BUCKET,
} from "@/lib/student-submit";

export const runtime = "nodejs";

// 녹음 파일을 Supabase Storage 로 곧바로 올리기 위한 1회용 업로드 URL 발급.
//
// 예전에는 녹음 파일 전체가 이 서버(Vercel 함수)를 거쳐 갔는데,
// 서버리스 함수는 요청 본문이 4.5MB 로 제한된다. 16kHz WAV 는 초당 32KB라
// 2분 20초가 넘는 녹음은 아예 올라가지 못하고 'Failed to fetch' 로 끊겼다.
// 이제는 브라우저가 Supabase 로 직접 올리므로 그 한도를 받지 않는다.
export async function POST(req: Request) {
  const session = await getStudentSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401 });
  }

  const { assignmentId } = (await req.json().catch(() => ({}))) as {
    assignmentId?: string;
  };
  if (!assignmentId) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const check = await checkCanSubmit(
    session.studentId,
    session.classId,
    assignmentId
  );
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(SUBMISSIONS_BUCKET)
    .createSignedUploadUrl(check.path, { upsert: true });

  if (error || !data) {
    console.error("[제출] 업로드 URL 발급 실패:", error);
    return NextResponse.json(
      { error: "업로드 준비에 실패했어요. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
