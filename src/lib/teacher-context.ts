import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const IMPERSONATE_COOKIE = "yus_admin_as";

type DB = ReturnType<typeof createAdminClient>;

export interface TeacherContext {
  effectiveId: string; // 데이터 조회/쓰기의 기준 교사 id
  selfId: string; // 실제 로그인한 사용자 id
  isImpersonating: boolean;
  actingName: string | null; // 대행 중인 선생님 이름
  role: string; // 'teacher' | 'admin' — 페이지에서 재조회하지 않도록 함께 반환
  db: DB; // 데이터 접근 클라이언트 (대행 시 admin, 아니면 RLS)
}

// 실효 교사 컨텍스트. 운영자가 특정 선생님으로 "대행" 중이면 그 선생님 기준으로 동작.
export async function getTeacherContext(): Promise<TeacherContext> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teacher/login");

  // role 과 status 를 한 번에 읽는다 (따로 조회하면 왕복이 한 번 더 든다)
  const { data: me } = await supabase
    .from("teachers")
    .select("role, status")
    .eq("id", user.id)
    .single();
  const role = (me?.role as string) ?? "teacher";
  const isAdmin = role === "admin";

  if (!isAdmin && me?.status && me.status !== "approved") {
    redirect(
      me.status === "rejected" ? "/teacher/pending?rejected=1" : "/teacher/pending"
    );
  }

  const impId = cookies().get(IMPERSONATE_COOKIE)?.value;

  if (isAdmin && impId && impId !== user.id) {
    // 대행 모드: admin 클라이언트로 대상 교사 데이터 접근
    const admin = createAdminClient();
    const { data: target } = await admin
      .from("teachers")
      .select("name, email")
      .eq("id", impId)
      .single();
    return {
      effectiveId: impId,
      selfId: user.id,
      isImpersonating: true,
      actingName: target?.name || target?.email || "선생님",
      role,
      db: admin,
    };
  }

  return {
    effectiveId: user.id,
    selfId: user.id,
    isImpersonating: false,
    actingName: null,
    role,
    db: supabase as unknown as DB,
  };
}

export function setImpersonation(teacherId: string) {
  cookies().set(IMPERSONATE_COOKIE, teacherId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4,
  });
}

export function clearImpersonation() {
  cookies().delete(IMPERSONATE_COOKIE);
}
