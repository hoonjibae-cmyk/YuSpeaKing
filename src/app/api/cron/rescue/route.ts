import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateSubmission } from "@/lib/ai/evaluate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 채점이 시작되지 않았거나 도중에 멈춘 제출을 서버가 스스로 되살린다.
//
// 채점은 학생 브라우저가 제출 직후 /api/student/evaluate 를 호출해서 시작한다.
// 그런데 학생이 제출 버튼을 누른 뒤 곧바로 화면을 닫거나, 휴대폰을 잠그거나,
// 다른 앱으로 넘어가면 그 호출이 끊겨 채점이 아예 시작되지 않는다.
// 이때 제출물은 'submitted' 상태로 남고, 녹음은 멀쩡히 올라가 있는데도
// 학생 화면에는 '채점 중', 선생님 화면에는 '제출됨'으로 영영 멈춰 있게 된다.
//
// 이 크론이 그런 제출을 찾아 서버에서 직접 채점을 실행한다.
// 학생이 앱을 다시 열지 않아도, 선생님이 [AI 재평가 실행]을 누르지 않아도 복구된다.

// 채점이 시작되지 않은 채 이만큼 지났으면 학생 브라우저가 끊긴 것으로 본다
const NEVER_STARTED_MIN = 10;
// 채점 도중 멈춘 것으로 보는 기준
const STALLED_MIN = 15;

// 자동 재시도 한도. 넘으면 오류로 표시하고 더 시도하지 않는다.
// (Azure 사용량을 헛되이 쓰지 않기 위한 안전장치. 선생님이 [AI 재평가 실행]을
//  누르면 횟수가 0으로 초기화되어 언제든 다시 시도할 수 있다)
const MAX_ATTEMPTS = 3;

// 한 번에 처리할 최대 건수 (한 건이 길게는 3분까지 걸릴 수 있다)
const MAX_PER_RUN = 2;
// 새 건을 시작해도 되는 시점. 이 이후에는 시작하지 않아 함수가 강제 종료되는
// (그래서 또 'evaluating' 으로 남는) 상황을 막는다.
const START_CUTOFF_MS = 60_000;

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60 * 1000).toISOString();

type Row = { id: string; evaluate_attempts: number | null };

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const started = Date.now();
  const admin = createAdminClient();

  const cols = "id, evaluate_attempts";
  const [{ data: neverStarted }, { data: stalled }] = await Promise.all([
    admin
      .from("submissions")
      .select(cols)
      .eq("status", "submitted")
      .lt("updated_at", minutesAgo(NEVER_STARTED_MIN))
      .order("updated_at", { ascending: true })
      .limit(20),
    admin
      .from("submissions")
      .select(cols)
      .eq("status", "evaluating")
      .lt("updated_at", minutesAgo(STALLED_MIN))
      .order("updated_at", { ascending: true })
      .limit(20),
  ]);

  const all = [
    ...((neverStarted ?? []) as Row[]),
    ...((stalled ?? []) as Row[]),
  ];

  // 재시도 한도를 넘긴 건은 더 시도하지 않고 오류로 정리한다
  const exhausted = all.filter((r) => (r.evaluate_attempts ?? 0) >= MAX_ATTEMPTS);
  let gaveUp = 0;
  if (exhausted.length) {
    await admin
      .from("submissions")
      .update({
        status: "error",
        error_message:
          "채점을 여러 번 시도했는데도 끝나지 않았어요. [AI 재평가 실행]으로 다시 시도해 주세요.",
      })
      .in(
        "id",
        exhausted.map((r) => r.id)
      );
    gaveUp = exhausted.length;
  }

  const targets = all
    .filter((r) => (r.evaluate_attempts ?? 0) < MAX_ATTEMPTS)
    .slice(0, MAX_PER_RUN);

  // 한 건씩 순서대로 (동시에 돌리면 Azure 동시 요청 한도에 걸릴 수 있다)
  let rescued = 0;
  let failed = 0;
  for (const row of targets) {
    if (Date.now() - started > START_CUTOFF_MS) break;

    // 채점을 시작하기 전에 먼저 횟수를 올린다.
    // (도중에 함수가 종료되어도 시도한 것으로 남아야 무한 재시도를 막는다)
    await admin
      .from("submissions")
      .update({ evaluate_attempts: (row.evaluate_attempts ?? 0) + 1 })
      .eq("id", row.id);

    try {
      // 실패해도 내부에서 status='error' 로 정리하고 예외를 던지지 않는다
      await evaluateSubmission(row.id);
      const { data: after } = await admin
        .from("submissions")
        .select("status")
        .eq("id", row.id)
        .single();
      if (after?.status === "evaluated") rescued++;
      else failed++;
    } catch (e) {
      failed++;
      console.error("[크론] 채점 복구 실패:", row.id, e);
    }
  }

  return NextResponse.json({
    ok: true,
    picked: targets.length,
    rescued,
    failed,
    gaveUp,
  });
}
