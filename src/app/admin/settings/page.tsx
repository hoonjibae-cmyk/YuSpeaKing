import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_MODELS, DEFAULT_AI_MODEL, isKnownModel } from "@/lib/settings";
import { alimtalkConfigured } from "@/lib/solapi";
import { saveAiModel } from "../actions";
import SubmitButton from "@/components/SubmitButton";
import { CrownMark } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: { saved?: string };
}) {
  await requireAdmin();

  const { data } = await createAdminClient()
    .from("app_settings")
    .select("ai_model, updated_at")
    .eq("id", 1)
    .maybeSingle();

  const saved = (data as { ai_model?: string | null } | null)?.ai_model ?? null;
  const envModel = process.env.ANTHROPIC_MODEL || null;
  // 실제로 쓰이는 값 (settings.getAiModel 과 같은 우선순위)
  const effective =
    saved && isKnownModel(saved) ? saved : envModel || DEFAULT_AI_MODEL;

  const talkReady = alimtalkConfigured();
  const envRows: [string, boolean][] = [
    ["SOLAPI_API_KEY", !!process.env.SOLAPI_API_KEY],
    ["SOLAPI_API_SECRET", !!process.env.SOLAPI_API_SECRET],
    ["SOLAPI_PFID (발신프로필)", !!process.env.SOLAPI_PFID],
    ["SOLAPI_TEMPLATE_ID (템플릿)", !!process.env.SOLAPI_TEMPLATE_ID],
    ["SOLAPI_SENDER (발신번호·문자 대체용)", !!process.env.SOLAPI_SENDER],
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/admin" className="text-sm text-slate-500 hover:underline">
        ← 운영자
      </Link>
      <header className="mt-3 flex items-center gap-3">
        <CrownMark className="h-9 w-9" />
        <div>
          <h1 className="text-2xl font-bold text-brand">설정</h1>
          <p className="text-sm text-slate-500">AI 모델 · 알림톡 연동 상태</p>
        </div>
      </header>

      {searchParams.saved && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          ✅ 저장했어요. 새로 생성되는 채점·피드백·리포트부터 적용됩니다.
        </p>
      )}

      {/* AI 모델 */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">AI 모델</h2>
        <p className="mt-1 text-xs text-slate-500">
          학생 피드백·월말 리포트·PDF 문장 선별에 함께 쓰입니다. 발음 채점은
          Azure가 맡으므로 이 설정과 무관해요.
        </p>

        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          지금 쓰는 모델 <b className="text-brand">{effective}</b>
          <span className="ml-2 text-xs text-slate-400">
            {saved && isKnownModel(saved)
              ? "(이 화면에서 지정)"
              : envModel
                ? "(환경변수 ANTHROPIC_MODEL)"
                : "(기본값)"}
          </span>
        </div>

        <form action={saveAiModel} className="mt-4 space-y-2">
          {AI_MODELS.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:border-brand"
            >
              <input
                type="radio"
                name="model"
                value={m.id}
                defaultChecked={m.id === effective}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="font-medium">{m.label}</span>
                <span className="ml-2 font-mono text-[11px] text-slate-400">
                  {m.id}
                </span>
                <span className="block text-xs text-slate-500">{m.note}</span>
              </span>
            </label>
          ))}
          <SubmitButton
            pendingText="저장 중…"
            className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            모델 저장
          </SubmitButton>
        </form>
      </section>

      {/* 알림톡 */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">카카오 알림톡 (솔라피)</h2>
        <p className="mt-1 text-xs text-slate-500">
          월말 리포트를 학부모께 알림톡으로 보낼 때 씁니다. 값은 보안상 화면에서
          입력하지 않고 <b>Vercel 환경변수</b>로만 설정합니다.
        </p>

        <div
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            talkReady
              ? "bg-green-50 text-green-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {talkReady
            ? "✅ 발송 준비 완료"
            : "⚠️ 아직 발송할 수 없어요. 아래 빠진 값을 채워 주세요."}
        </div>

        <ul className="mt-3 space-y-1.5">
          {envRows.map(([k, ok]) => (
            <li
              key={k}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs"
            >
              <span className="font-mono text-slate-600">{k}</span>
              <span className={ok ? "text-green-600" : "text-slate-400"}>
                {ok ? "설정됨" : "비어 있음"}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[11px] text-slate-400">
          알림톡은 카카오 심사를 통과한 템플릿으로만 보낼 수 있어요. 템플릿 문안은
          저장소의 <code>docs/alimtalk-template.md</code> 에 정리해 두었습니다.
        </p>
      </section>
    </main>
  );
}
