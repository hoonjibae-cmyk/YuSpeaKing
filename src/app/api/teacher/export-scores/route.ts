import { getTeacherContext } from "@/lib/teacher-context";
import {
  fetchScoreRows,
  resolvePeriod,
  trendFrom,
  visibleClasses,
} from "@/lib/trend";
import { todayKST } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 값 안의 쉼표·따옴표·줄바꿈이 칸을 깨뜨리지 않도록 감싼다
function cell(v: string | number | null) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 반별 성적 CSV 내려받기.
// classId 를 주면 그 반만, 없으면 선생님이 보는 모든 반.
export async function GET(req: Request) {
  const { db, effectiveId } = await getTeacherContext();
  const url = new URL(req.url);
  const classId = url.searchParams.get("classId");
  const period = resolvePeriod(url.searchParams.get("p") ?? undefined);
  const from = trendFrom(period.days);

  // 볼 수 있는 반만 내보낸다 (classId 를 줘도 권한 밖이면 빈 목록)
  const all = await visibleClasses(db, effectiveId);
  const classes = classId ? all.filter((c) => c.id === classId) : all;
  if (classId && classes.length === 0) {
    return new Response("권한이 없어요", { status: 403 });
  }

  const rows = await fetchScoreRows(db, classes, from);

  const header = [
    "반",
    "번호",
    "이름",
    "과제",
    "제출일",
    "종합",
    "정확도",
    "유창성",
    "완성도",
    "억양",
  ];
  const body = rows.map((r) =>
    [
      r.className,
      r.studentNumber,
      r.studentName,
      r.assignmentTitle,
      r.date,
      r.overall,
      r.accuracy,
      r.fluency,
      r.completeness,
      r.prosody,
    ]
      .map(cell)
      .join(",")
  );

  // 엑셀이 UTF-8 로 열도록 BOM 을 앞에 붙인다 (없으면 한글이 깨진다)
  const csv = "﻿" + [header.join(","), ...body].join("\r\n") + "\r\n";

  const scope = classId ? classes[0].name : "전체반";
  const name = `유스피킹_성적_${scope}_${from}~${todayKST()}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
