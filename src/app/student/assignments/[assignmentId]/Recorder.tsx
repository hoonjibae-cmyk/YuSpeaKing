"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { blobToWav16kMono } from "@/lib/wav-client";

type Phase =
  | "idle"
  | "recording"
  | "recorded"
  | "uploading"
  | "evaluating"
  | "done"
  | "error";

export default function Recorder({
  assignmentId,
  alreadySubmitted,
  remainingAttempts,
}: {
  assignmentId: string;
  alreadySubmitted: boolean;
  remainingAttempts: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(alreadySubmitted ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        // iOS Safari는 webm 재생을 못 하므로 실제 녹음 포맷(mr.mimeType)으로 라벨링해야
        // 미리듣기 <audio>가 정상 재생된다. (하드코딩 시 "오류" 표시)
        const type = mr.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        blobRef.current = blob;
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        setPhase("recorded");
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setPhase("recording");
    } catch {
      setError("마이크를 사용할 수 없어요. 브라우저 권한을 확인해 주세요.");
      setPhase("error");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 다시 선택 가능하도록 초기화
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setError("오디오 파일만 올릴 수 있어요. (mp3, m4a, wav 등)");
      setPhase("error");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("파일이 너무 커요. 25MB 이하의 녹음 파일을 올려 주세요.");
      setPhase("error");
      return;
    }
    setError(null);
    blobRef.current = file;
    setAudioUrl(URL.createObjectURL(file));
    setPhase("recorded");
  }

  function reset() {
    blobRef.current = null;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setPhase("idle");
  }

  async function submit() {
    if (!blobRef.current) return;
    setPhase("uploading");
    setError(null);
    try {
      // Azure 발음평가용 16kHz mono WAV 로 변환 후 업로드
      const wav = await blobToWav16kMono(blobRef.current);
      const fd = new FormData();
      fd.append("assignmentId", assignmentId);
      fd.append("audio", wav, "recording.wav");
      const res = await fetch("/api/student/submit", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "제출에 실패했어요");
      }
      const { submissionId } = (await res.json()) as { submissionId?: string };

      // 제출(저장) 성공 → 채점 단계로. 채점이 실패/지연돼도 제출은 이미 유효하므로
      // 완료 화면을 보여주고, 피드백은 준비되는 대로 표시된다.
      setPhase("evaluating");
      try {
        if (submissionId) {
          await fetch("/api/student/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ submissionId }),
          });
        }
      } catch {
        // 채점 지연/실패는 무시 (교사가 재평가 가능)
      }
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "제출에 실패했어요");
      setPhase("error");
    }
  }

  if (phase === "done") {
    return (
      <div className="rounded-2xl bg-green-50 p-6 text-center">
        <div className="text-4xl">✅</div>
        <p className="mt-2 font-semibold text-green-700">제출되었습니다!</p>
        <p className="mt-1 text-sm text-green-600">
          아래에서 발음 피드백을 확인해요.
        </p>
        {remainingAttempts > 0 ? (
          <button
            onClick={reset}
            className="mt-4 text-sm text-slate-500 underline hover:text-slate-700"
          >
            다시 녹음해서 제출하기 (남은 {remainingAttempts}회)
          </button>
        ) : (
          <p className="mt-4 text-xs text-slate-400">
            제출 횟수를 모두 사용했어요.
          </p>
        )}
      </div>
    );
  }

  // 제출 횟수 소진 (미제출 상태에서 이론상 도달 가능)
  if (phase === "idle" && remainingAttempts <= 0) {
    return (
      <div className="rounded-2xl bg-slate-100 p-6 text-center text-sm text-slate-500">
        제출 횟수를 모두 사용했어요. 선생님께 문의하세요.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {(phase === "idle" || phase === "error") && (
        <div className="space-y-3">
          <button
            onClick={startRecording}
            className="w-full rounded-2xl bg-red-500 py-5 text-lg font-semibold text-white transition hover:bg-red-600"
          >
            🔴 지금 녹음하기
          </button>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            또는
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 py-4 text-base font-medium text-slate-600 transition hover:border-brand hover:bg-brand-light hover:text-brand">
            📁 녹음 파일 올리기
            <input
              type="file"
              accept="audio/*"
              onChange={onFilePick}
              className="hidden"
            />
          </label>
          <p className="text-center text-xs text-slate-400">
            미리 녹음해 둔 파일(mp3·m4a·wav 등)을 선택해 제출할 수 있어요.
          </p>
        </div>
      )}

      {phase === "recording" && (
        <button
          onClick={stopRecording}
          className="w-full animate-pulse rounded-2xl bg-slate-800 py-5 text-lg font-semibold text-white"
        >
          ⏹ 녹음 중지 (말하는 중...)
        </button>
      )}

      {phase === "recorded" && audioUrl && (
        <div className="space-y-3">
          <audio src={audioUrl} controls className="w-full" />
          <div className="flex gap-2">
            <button
              onClick={reset}
              className="flex-1 rounded-xl border border-slate-300 py-3 font-medium text-slate-600 hover:bg-slate-100"
            >
              다시 녹음
            </button>
            <button
              onClick={submit}
              className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white hover:bg-brand-dark"
            >
              제출하기
            </button>
          </div>
        </div>
      )}

      {phase === "uploading" && (
        <button
          disabled
          className="w-full rounded-2xl bg-brand/70 py-5 text-lg font-semibold text-white"
        >
          제출 중...
        </button>
      )}

      {phase === "evaluating" && (
        <div className="rounded-2xl bg-brand-light py-5 text-center">
          <div className="text-lg font-semibold text-brand">
            🎧 AI가 발음을 채점하고 있어요…
          </div>
          <p className="mt-1 text-sm text-slate-500">
            10~20초 정도 걸려요. 잠깐만 기다려 주세요!
          </p>
        </div>
      )}
    </div>
  );
}
