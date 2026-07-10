"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { blobToWav16kMono } from "@/lib/wav-client";

type Phase = "idle" | "recording" | "recorded" | "uploading" | "done" | "error";

export default function Recorder({
  assignmentId,
  alreadySubmitted,
}: {
  assignmentId: string;
  alreadySubmitted: boolean;
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
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
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
    if (!file) return;
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
          곧 발음 피드백을 확인할 수 있어요.
        </p>
        <button
          onClick={reset}
          className="mt-4 text-sm text-slate-500 underline hover:text-slate-700"
        >
          다시 녹음해서 제출하기
        </button>
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

      {phase === "idle" && (
        <div className="space-y-3 text-center">
          <button
            onClick={startRecording}
            className="w-full rounded-2xl bg-red-500 py-5 text-lg font-semibold text-white transition hover:bg-red-600"
          >
            🔴 녹음 시작하기
          </button>
          <label className="block cursor-pointer text-sm text-slate-500 hover:text-brand">
            또는 녹음 파일 올리기
            <input
              type="file"
              accept="audio/*"
              onChange={onFilePick}
              className="hidden"
            />
          </label>
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
    </div>
  );
}
