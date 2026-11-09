import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  extractPassageFromImages,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGES,
  type ImageType,
} from "@/lib/ai/extract-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 사진은 브라우저에서 줄여서 보낸다 (긴 변 1600px JPEG, 한 장 수백 KB).
// Vercel 요청 본문 한도가 4.5MB 라 합계도 그 아래로 막는다.
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

// 교과서 사진 → 영어 본문 텍스트 (교사 인증 필요)
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  const form = await req.formData();
  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "사진이 없어요." }, { status: 400 });
  }
  if (files.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `사진은 한 번에 ${MAX_IMAGES}장까지 올릴 수 있어요.` },
      { status: 400 },
    );
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: "사진이 너무 커요. 장 수를 줄여 다시 올려 주세요." },
      { status: 400 },
    );
  }
  for (const f of files) {
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(f.type)) {
      return NextResponse.json(
        { error: "JPG·PNG 사진만 올릴 수 있어요." },
        { status: 400 },
      );
    }
  }

  try {
    const images = await Promise.all(
      files.map(async (f) => ({
        type: f.type as ImageType,
        base64: Buffer.from(await f.arrayBuffer()).toString("base64"),
      })),
    );
    const text = await extractPassageFromImages(images);
    if (!text) {
      return NextResponse.json(
        {
          error:
            "사진에서 영어 본문을 찾지 못했어요. 본문이 잘 보이게 다시 찍거나 직접 입력해 주세요.",
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ text });
  } catch (e) {
    console.error("[extract-image] 실패:", e);
    return NextResponse.json(
      { error: "사진 처리에 실패했어요. 다시 시도하거나 직접 입력해 주세요." },
      { status: 500 },
    );
  }
}
