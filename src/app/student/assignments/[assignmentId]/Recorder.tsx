"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { blobToWav16kMono } from "@/lib/wav-client";
import { createClient } from "@/lib/supabase/client";

// 서버가 이유를 알려 준 오류. 재시도해도 결과가 같으므로 즉시 학생에게 보여 준다.
class SubmitError extends Error {}

// 녹음 상한. 15문장 과제도 3분 안팎이면 충분한데, 학생이 중지를 깜빡하고
// 그대로 두면 파일만 커지고 채점도 오래 걸린다. 넉넉히 두되 자동으로 멈춘다.
const MAX_RECORD_SEC = 360; // 6분
// 이 시점부터 남은 시간을 알려 준다
const WARN_AT_SEC = MAX_RECORD_SEC - 60;

// 녹음 데이터를 1초마다 흘려 받는다. 인자 없이 start() 하면 중지할 때까지
// 브라우저 내부에만 쌓여 있다가, 화면이 꺼지거나 다른 앱으로 넘어가면
// 그때까지 모은 것만 남고 뒷부분이 통째로 사라진다.
const CHUNK_MS = 1000;

// 초6이 영어 문장을 소리내어 읽는 속도의 하한(단어당 초).
// 이보다 짧으면 지문을 끝까지 읽지 않았을 가능성이 높다.
const MIN_SEC_PER_WORD = 0.3;

// 실제 오디오 길이가 녹음한 시간의 이 비율보다 짧으면 중간에 끊긴 것으로 본다
const TRUNCATED_RATIO = 0.6;

// 16kHz · mono · 16bit WAV 는 초당 32,000바이트 (44는 헤더)
function wavSeconds(size: number) {
  return Math.max(0, (size - 44) / 32000);
}

function mmss(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

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
  passageWords,
}: {
  assignmentId: string;
  alreadySubmitted: boolean;
  remainingAttempts: number;
  passageWords: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(alreadySubmitted ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [elapsed, setElapsed] = useState(0);
  // 중지 시점의 녹음 길이(초). 미리듣기와 짧은 녹음 경고에 쓴다.
  const [recordedSec, setRecordedSec] = useState(0);

  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
        if (tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
        setElapsed((v) => {
          setRecordedSec(v);
          return v;
        });
        wakeLockRef.current?.release().catch(() => {});
        wakeLockRef.current = null;
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
      // 1초 단위로 받아 둬야 중간에 끊겨도 그때까지가 남는다
      mr.start(CHUNK_MS);

      // 읽는 동안 화면이 꺼지면 녹음이 중단될 수 있어 화면을 깨워 둔다
      // (지원하지 않는 브라우저에서는 조용히 넘어간다)
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
        };
        wakeLockRef.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        wakeLockRef.current = null;
      }

      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
      setPhase("recording");
    } catch {
      setError("마이크를 사용할 수 없어요. 브라우저 권한을 확인해 주세요.");
      setPhase("error");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  // 상한에 닿으면 자동으로 멈춘다 (녹음한 내용은 그대로 남는다)
  useEffect(() => {
    if (phase === "recording" && elapsed >= MAX_RECORD_SEC) stopRecording();
  }, [phase, elapsed]);

  // 화면을 벗어날 때 타이머 정리
  useEffect(
    () => () => {
      if (tickRef.current) clearInterval(tickRef.current);
    },
    []
  );

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

  // 휴대폰 네트워크는 순간적으로 끊기는 일이 잦다. 한 번 실패했다고 바로
  // 포기하지 않고 잠깐 쉬었다 다시 시도한다.
  async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        // 정해진 안내 문구가 있는 오류(마감·횟수 초과 등)는 다시 시도해도 소용없다
        if (e instanceof SubmitError) throw e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
    console.error(`[제출] ${label} 실패:`, lastErr);
    throw new Error(
      "인터넷 연결이 불안정해서 제출하지 못했어요. 잠시 뒤 아래 [다시 제출하기]를 눌러 주세요."
    );
  }

  async function postJson(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 서버가 이유를 알려 준 경우엔 그대로 학생에게 보여 준다
      throw new SubmitError(json.error || "제출에 실패했어요");
    }
    return json;
  }

  async function submit() {
    if (!blobRef.current) return;
    setPhase("uploading");
    setError(null);
    try {
      // Azure 발음평가용 16kHz mono WAV 로 변환
      const wav = await blobToWav16kMono(blobRef.current);

      // 녹음한 시간보다 실제 오디오가 크게 짧으면 중간에 끊긴 것이다.
      // (화면 잠김·앱 전환 등) 그대로 내면 뒷부분이 통째로 빠진 채 채점돼
      // 한 자리 점수가 나오므로, 제출 횟수를 쓰기 전에 여기서 막는다.
      const audioSec = wavSeconds(wav.size);
      if (recordedSec > 20 && audioSec < recordedSec * TRUNCATED_RATIO) {
        throw new SubmitError(
          `녹음이 중간에 끊겼어요. (${mmss(recordedSec)} 동안 녹음했는데 ` +
            `${mmss(Math.round(audioSec))} 만 저장됐어요)\n` +
            "읽는 동안 화면을 끄거나 다른 앱으로 넘어가지 말고, 처음부터 다시 녹음해 주세요."
        );
      }

      // 1) 1회용 업로드 URL 발급
      const { path, token } = (await withRetry("업로드 URL 발급", () =>
        postJson("/api/student/upload-url", { assignmentId })
      )) as { path: string; token: string };

      // 2) Supabase Storage 로 직접 업로드.
      //    서버(Vercel 함수)를 거치지 않으므로 요청 본문 4.5MB 제한이 없다.
      await withRetry("녹음 업로드", async () => {
        const supabase = createClient();
        const { error } = await supabase.storage
          .from("submissions")
          .uploadToSignedUrl(path, token, wav, {
            contentType: "audio/wav",
            upsert: true,
          });
        if (error) throw error;
      });

      // 3) 제출 기록 생성
      const { submissionId } = (await withRetry("제출 기록", () =>
        postJson("/api/student/submit", { assignmentId })
      )) as { submissionId?: string };

      // 제출(저장) 성공 → 채점 단계로. 채점이 실패/지연돼도 제출은 이미 유효하므로
      // 완료 화면을 보여주고, 피드백은 준비되는 대로 표시된다.
      setPhase("evaluating");
      try {
        if (submissionId) {
          await fetch("/api/student/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ submissionId }),
            // 학생이 채점을 기다리다 화면을 닫거나 휴대폰을 잠가도 요청이
            // 끊기지 않도록 한다. (그래도 끊기면 서버 크론이 되살린다)
            keepalive: true,
          });
        }
      } catch {
        // 채점 지연/실패는 무시 — 10분 뒤 서버가 스스로 다시 채점한다
      }
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "제출에 실패했어요");
      // 녹음(blobRef)은 그대로 두어 다시 녹음하지 않고 재시도할 수 있게 한다
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
        <p className="whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 제출만 실패한 경우: 녹음을 그대로 두고 다시 제출할 수 있게 한다.
          (다시 녹음하게 만들면 학생이 읽은 걸 통째로 날린다) */}
      {phase === "error" && audioUrl && (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-700">
            녹음은 그대로 있어요. 다시 녹음하지 말고 아래 버튼을 눌러 주세요.
          </p>
          <audio src={audioUrl} controls className="w-full" />
          <button
            onClick={submit}
            className="w-full rounded-xl bg-brand py-3 font-semibold text-white hover:bg-brand-dark"
          >
            다시 제출하기
          </button>
        </div>
      )}

      {(phase === "idle" || phase === "error") && (
        <div className="space-y-3">
          <button
            onClick={startRecording}
            className="w-full rounded-2xl bg-red-500 py-5 text-lg font-semibold text-white transition hover:bg-red-600"
          >
            {phase === "error" && audioUrl
              ? "🔴 처음부터 다시 녹음하기"
              : "🔴 지금 녹음하기"}
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
        <div className="space-y-2">
          <button
            onClick={stopRecording}
            className="w-full animate-pulse rounded-2xl bg-slate-800 py-5 text-lg font-semibold text-white"
          >
            ⏹ 녹음 중지 · {mmss(elapsed)}
          </button>
          {elapsed >= WARN_AT_SEC && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
              ⏱️ {mmss(MAX_RECORD_SEC - elapsed)} 뒤에 녹음이 자동으로 멈춰요.
              다 읽었으면 중지를 눌러 주세요.
            </p>
          )}
        </div>
      )}

      {phase === "recorded" && audioUrl && (
        <div className="space-y-3">
          {recordedSec > 0 && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>🎙️ 녹음 길이 {mmss(recordedSec)}</span>
              <span className="text-slate-400">
                지문 {passageWords}단어
              </span>
            </div>
          )}
          {recordedSec > 0 &&
            passageWords > 0 &&
            recordedSec < passageWords * MIN_SEC_PER_WORD && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ⚠️ 지문 길이에 비해 <b>녹음이 짧아요.</b> 끝까지 다 읽었는지
                들어보고, 빠뜨린 부분이 있으면 <b>다시 녹음</b>해 주세요.
                <br />
                (끝까지 읽지 않으면 점수가 크게 낮아져요)
              </p>
            )}
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
