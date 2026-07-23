"use client";

import { useState } from "react";
import { createAssignment } from "../../actions";
import SubmitButton from "@/components/SubmitButton";
import { TTS_VOICES, DEFAULT_TTS_VOICE } from "@/lib/tts-voices";

type Mode = "type" | "pdf";
interface Excluded {
  sentence: string;
  reason: string;
}

export default function PassageComposer({ classId }: { classId: string }) {
  const [mode, setMode] = useState<Mode>("type");
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Excluded[]>([]);
  const [aiRan, setAiRan] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 최종 지문: AI로 문장을 골랐으면 그 문장들, 아니면 원문 전체
  const passage = (selected.length ? selected.join("\n") : source).trim();

  async function onPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("PDF 파일만 올릴 수 있어요.");
      return;
    }
    setError(null);
    setPdfLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/teacher/extract-pdf", {
        method: "POST",
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "PDF 처리 실패");
      setSource(j.text);
      setSelected([]);
      setExcluded([]);
      setAiRan(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 처리 실패");
    } finally {
      setPdfLoading(false);
    }
  }

  async function runAI() {
    if (passageSourceEmpty()) {
      setError("먼저 지문을 입력하거나 PDF를 올려 주세요.");
      return;
    }
    setError(null);
    setAiLoading(true);
    try {
      const res = await fetch("/api/teacher/select-sentences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: source }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "문장 선별 실패");
      setSelected(j.selected ?? []);
      setExcluded(j.excluded ?? []);
      setAiRan(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "문장 선별 실패");
    } finally {
      setAiLoading(false);
    }
  }

  function passageSourceEmpty() {
    return source.trim().length < 20;
  }

  function removeSentence(i: number) {
    setSelected((prev) => prev.filter((_, idx) => idx !== i));
  }

  function editSentence(i: number, val: string) {
    setSelected((prev) => prev.map((s, idx) => (idx === i ? val : s)));
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 1. 입력 방식 선택 */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("type")}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
            mode === "type"
              ? "border-brand bg-brand-light text-brand"
              : "border-slate-300 text-slate-500 hover:bg-slate-50"
          }`}
        >
          ⌨️ 직접 입력
        </button>
        <button
          type="button"
          onClick={() => setMode("pdf")}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
            mode === "pdf"
              ? "border-brand bg-brand-light text-brand"
              : "border-slate-300 text-slate-500 hover:bg-slate-50"
          }`}
        >
          📄 PDF 업로드
        </button>
      </div>

      {mode === "pdf" && (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-4 text-sm font-medium text-slate-600 transition hover:border-brand hover:bg-brand-light hover:text-brand">
          {pdfLoading ? "PDF에서 글자 읽는 중…" : "📄 교과서 PDF 선택하기"}
          <input
            type="file"
            accept="application/pdf"
            onChange={onPdf}
            disabled={pdfLoading}
            className="hidden"
          />
        </label>
      )}

      {/* 원문(교과서 본문) — 타이핑 또는 PDF 추출 결과, 편집 가능 */}
      <textarea
        value={source}
        onChange={(e) => {
          setSource(e.target.value);
          setSelected([]);
          setExcluded([]);
          setAiRan(false);
        }}
        rows={mode === "pdf" ? 5 : 6}
        placeholder={
          mode === "pdf"
            ? "PDF를 올리면 여기에 본문이 채워져요. 필요하면 직접 수정할 수 있어요."
            : "교과서 본문(한 챕터, 수십 문장)을 붙여넣으세요. 아래에서 AI가 핵심 10문장을 골라줍니다."
        }
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
      />

      {/* 2. AI 문장 선별 */}
      <button
        type="button"
        onClick={runAI}
        disabled={aiLoading || passageSourceEmpty()}
        className="w-full rounded-lg border border-brand bg-brand-light py-2 text-sm font-semibold text-brand transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {aiLoading
          ? "AI가 문장 고르는 중… (십여 초)"
          : "✨ AI로 중요한 10문장 뽑기"}
      </button>
      <p className="text-[11px] text-slate-400">
        초6에게 너무 어려운 단어·고유명사가 든 문장은 자동으로 제외돼요. 뽑은 뒤
        직접 지우거나 고칠 수 있어요.
      </p>

      {/* 선별된 문장 목록 */}
      {aiRan && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-brand">
              선별된 문장 {selected.length}개
            </span>
            {selected.length === 0 && (
              <span className="text-xs text-amber-600">
                직접 문장을 입력해 주세요
              </span>
            )}
          </div>
          <ol className="space-y-2">
            {selected.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-2 text-xs font-medium text-slate-400">
                  {i + 1}
                </span>
                <textarea
                  value={s}
                  onChange={(e) => editSentence(i, e.target.value)}
                  rows={1}
                  className="min-h-[2.4rem] flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeSentence(i)}
                  className="mt-1 text-slate-400 hover:text-red-500"
                  aria-label="문장 삭제"
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>

          {excluded.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                제외된 문장 보기 ({excluded.length})
              </summary>
              <ul className="mt-2 space-y-1.5">
                {excluded.map((e, i) => (
                  <li key={i} className="text-xs text-slate-500">
                    <span className="text-slate-400">“{e.sentence}”</span>
                    <span className="ml-1 text-amber-600">— {e.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* 3. 과제 정보 + 등록 */}
      <form action={createAssignment} className="space-y-2 border-t border-slate-100 pt-3">
        <input type="hidden" name="classId" value={classId} />
        <input type="hidden" name="passage_text" value={passage} />
        <input
          name="title"
          placeholder="과제 제목 (예: Unit 3 - My Day)"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
        <label className="block text-sm text-slate-500">
          🎙️ 샘플음성 목소리
          <select
            name="voice"
            defaultValue={DEFAULT_TTS_VOICE}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          >
            {TTS_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="block text-sm text-slate-500">
            마감일 (선택)
            <input
              name="due_date"
              type="date"
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1 focus:border-brand focus:outline-none"
            />
          </label>
        </div>
        <p className="text-[11px] text-slate-400">
          제출(녹음·분석)은 학생당 <b>1회</b>로 제한돼요.
        </p>

        {passage ? (
          <p className="text-[11px] text-slate-400">
            최종 지문 {passage.split("\n").filter(Boolean).length}문장 · 등록 시
            원어민 샘플 음성이 자동 생성돼요.
          </p>
        ) : (
          <p className="text-[11px] text-amber-600">
            지문을 입력하거나 AI로 문장을 선별하면 등록할 수 있어요.
          </p>
        )}

        {passage && (
          <SubmitButton
            pendingText="샘플음성 만드는 중… (몇 초 걸려요)"
            className="w-full rounded-lg bg-brand py-2 font-medium text-white hover:bg-brand-dark"
          >
            등록 (샘플음성 생성)
          </SubmitButton>
        )}
      </form>
    </div>
  );
}
