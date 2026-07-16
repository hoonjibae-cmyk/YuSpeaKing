import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { selectSentences } from "@/lib/ai/select-sentences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 본문 텍스트 → AI가 초6 난이도·고유명사 필터로 핵심 10문장 선별 (교사 인증 필요)
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const source = String(text ?? "").trim();
  if (source.length < 20) {
    return NextResponse.json(
      { error: "본문이 너무 짧아요. 지문을 붙여넣거나 PDF를 올려 주세요." },
      { status: 400 }
    );
  }

  try {
    const result = await selectSentences(source, 10);
    if (result.selected.length === 0) {
      return NextResponse.json(
        {
          error:
            "적합한 문장을 찾지 못했어요. 본문을 확인하거나 직접 문장을 골라 주세요.",
        },
        { status: 422 }
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[select-sentences] 실패:", e);
    return NextResponse.json(
      { error: "문장 선별에 실패했어요. (Anthropic 키 확인)" },
      { status: 500 }
    );
  }
}
