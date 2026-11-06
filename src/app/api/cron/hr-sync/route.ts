import { NextResponse } from "next/server";
import { hrConfigured } from "@/lib/hr/client";
import { runFullSync } from "@/lib/hr/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 이어 둔 반의 Student Card 명단을 매일 새벽에 한 번 받아 온다.
//
// 결과는 hr_pending_students 에 저장되고, 선생님 화면은 그 저장된 값만 읽는다.
// 그래서 선생님이 아침에 로그인하면 버튼을 누르지 않아도 '등록 안 된 학생'
// 알림이 이미 떠 있다.
//
// Vercel Cron 이 호출. CRON_SECRET 로 보호.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!hrConfigured()) {
    return NextResponse.json({ skipped: "Student Card 연동 미설정" });
  }

  try {
    // 전환 상태면 맞추기만, 일원화 상태면 Student Card 를 따라 만들고 옮긴다
    const s = await runFullSync();
    return NextResponse.json({
      mode: s.mode,
      filterApplied: s.filterApplied,
      classes: s.reports.length,
      teachersLinked: s.teachersLinked,
      classesLinked: s.classesLinked,
      classesCreated: s.classesCreated,
      ownersChanged: s.ownersChanged,
      studentsLinked: s.reports.reduce((n, r) => n + r.linked, 0),
      studentsCreated: s.reports.reduce((n, r) => n + r.created, 0),
      studentsMoved: s.studentsMoved,
      studentsWithdrawn: s.studentsWithdrawn,
      warnings: s.warnings,
      failed: s.reports
        .filter((r) => r.error)
        .map((r) => ({ class: r.className, error: r.error })),
    });
  } catch (e) {
    console.error("[크론] Student Card 명단 동기화 실패:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
