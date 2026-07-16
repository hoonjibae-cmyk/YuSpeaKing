import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// PDF 업로드 → 텍스트 추출 (교사 인증 필요)
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "PDF 파일이 없어요." }, { status: 400 });
  }
  if (file.size > 15 * 1024 * 1024) {
    return NextResponse.json(
      { error: "파일이 너무 커요. 15MB 이하 PDF를 올려 주세요." },
      { status: 400 }
    );
  }

  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = (Array.isArray(text) ? text.join("\n") : text)
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!clean) {
      return NextResponse.json(
        {
          error:
            "PDF에서 글자를 읽지 못했어요. 스캔 이미지 PDF일 수 있어요. 텍스트를 직접 붙여넣어 주세요.",
        },
        { status: 422 }
      );
    }
    return NextResponse.json({ text: clean });
  } catch (e) {
    console.error("[extract-pdf] 실패:", e);
    return NextResponse.json(
      { error: "PDF 처리에 실패했어요. 텍스트를 직접 붙여넣어 주세요." },
      { status: 500 }
    );
  }
}
