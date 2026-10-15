import { requireAdmin } from "@/lib/auth";
import { gatherWeekly } from "@/lib/weekly";
import { renderWeeklyImage } from "@/lib/weekly-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 주간 요약 그림 미리보기 (운영자 전용).
// 보내기 전에 어떻게 나오는지 눈으로 확인하는 용도다. 반별 점수와 학생
// 이름이 들어 있으므로 반드시 운영자 확인을 거친다.
export async function GET(req: Request) {
  await requireAdmin();

  const raw = Number(new URL(req.url).searchParams.get("w"));
  // 0=이번 주, 1=지난주(기본). 너무 과거는 의미가 없어 막아 둔다.
  const offset = Number.isFinite(raw) ? Math.min(8, Math.max(0, raw)) : 1;

  const png = await renderWeeklyImage(await gatherWeekly(offset));
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
