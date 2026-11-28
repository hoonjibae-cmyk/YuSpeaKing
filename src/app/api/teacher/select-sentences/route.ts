import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectSentences } from "@/lib/ai/select-sentences";
import { prepareSelection, SelectionInputError, SelectionOutputError } from "@/lib/ai/sentence-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  const { data: teacher, error: teacherError } = await supabase.from("teachers").select("role,status").eq("id", user.id).maybeSingle();
  if (teacherError || !teacher || (teacher.role !== "admin" && (teacher.role !== "teacher" || teacher.status !== "approved"))) {
    return NextResponse.json({ error: "승인된 선생님 또는 관리자만 과제를 만들 수 있어요." }, { status: 403 });
  }
  const input = await req.json().catch(() => null);
  try {
    const prepared = prepareSelection(input?.text, input?.mode, input?.limit);
    return NextResponse.json(await selectSentences(input.text, prepared.limit, prepared.mode));
  } catch (error) {
    if (error instanceof SelectionInputError || error instanceof SelectionOutputError) {
      return NextResponse.json({ error: error.message }, { status: error instanceof SelectionInputError ? 400 : 422 });
    }
    console.error("[select-sentences] 생성 실패", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "문장 생성에 실패했어요. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
}
