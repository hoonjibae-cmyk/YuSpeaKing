import "server-only";
import { createAdminClient } from "./supabase/admin";

export interface NoticeRow {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
  scope: string;
  authorName: string | null;
  read: boolean;
}

// 한 학생에게 보이는 공지 = 우리 반 공지 + 담임의 전체 반 공지 + 운영자 전체 공지
export async function getStudentNotices(
  studentId: string,
  classId: string
): Promise<NoticeRow[]> {
  const admin = createAdminClient();

  // 담임 확인 (선생님이 '담당 전체 반'에 올린 공지를 포함하기 위해)
  const { data: klass } = await admin
    .from("classes")
    .select("teacher_id")
    .eq("id", classId)
    .maybeSingle();
  const teacherId = (klass as { teacher_id?: string } | null)?.teacher_id;

  const filters = [
    "scope.eq.all",
    `and(scope.eq.class,class_id.eq.${classId})`,
  ];
  if (teacherId) {
    filters.push(`and(scope.eq.my_classes,author_id.eq.${teacherId})`);
  }

  const { data } = await admin
    .from("notices")
    .select("id, title, body, pinned, created_at, scope, teachers(name)")
    .or(filters.join(","))
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  const list = (data ?? []) as Array<{
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    created_at: string;
    scope: string;
    teachers: { name?: string } | { name?: string }[] | null;
  }>;
  if (list.length === 0) return [];

  const { data: reads } = await admin
    .from("notice_reads")
    .select("notice_id")
    .eq("student_id", studentId)
    .in(
      "notice_id",
      list.map((n) => n.id)
    );
  const readSet = new Set(
    ((reads ?? []) as { notice_id: string }[]).map((r) => r.notice_id)
  );

  return list.map((n) => {
    const t = Array.isArray(n.teachers) ? n.teachers[0] : n.teachers;
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      pinned: n.pinned,
      created_at: n.created_at,
      scope: n.scope,
      authorName: t?.name ?? null,
      read: readSet.has(n.id),
    };
  });
}

// 안 읽은 공지 개수 (홈 배지용)
export async function countUnreadNotices(
  studentId: string,
  classId: string
): Promise<number> {
  const list = await getStudentNotices(studentId, classId);
  return list.filter((n) => !n.read).length;
}

// 공지 대상 학생 id 목록 (푸시 발송용)
export async function resolveNoticeAudience(notice: {
  scope: string;
  class_id: string | null;
  author_id: string;
}): Promise<string[]> {
  const admin = createAdminClient();

  let classIds: string[] = [];
  if (notice.scope === "class" && notice.class_id) {
    classIds = [notice.class_id];
  } else {
    let q = admin.from("classes").select("id").is("archived_at", null);
    if (notice.scope === "my_classes") q = q.eq("teacher_id", notice.author_id);
    const { data } = await q;
    classIds = ((data ?? []) as { id: string }[]).map((c) => c.id);
  }
  if (classIds.length === 0) return [];

  const { data: students } = await admin
    .from("students")
    .select("id")
    .in("class_id", classIds)
    .eq("status", "approved");
  return ((students ?? []) as { id: string }[]).map((s) => s.id);
}
