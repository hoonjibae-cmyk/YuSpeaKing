import Link from "next/link";
import {
  regenerateSample,
  deleteAssignment,
  updateAssignment,
} from "../../actions";
import SubmitButton from "@/components/SubmitButton";
import { TTS_VOICES, DEFAULT_TTS_VOICE } from "@/lib/tts-voices";
import { daysUntilArchive } from "@/lib/date";

export interface AssignmentRow {
  id: string;
  title: string;
  passage_text: string;
  sample_audio_url: string | null;
  sample_audio_slow_url: string | null;
  sample_voice: string | null;
  due_date: string | null;
  submissions?: { overall_score: number | null; status: string }[] | null;
}

// 반 화면과 마감 과제 보관함에서 함께 쓰는 과제 카드
export default function AssignmentCard({
  a,
  classId,
  today,
}: {
  a: AssignmentRow;
  classId: string;
  today: string;
}) {
  const subs = a.submissions ?? [];
  const subCount = subs.length;
  const evaluated = subs.filter(
    (s) => s.status === "evaluated" && s.overall_score != null
  );
  const avg = evaluated.length
    ? Math.round(
        evaluated.reduce((t, s) => t + Number(s.overall_score), 0) /
          evaluated.length
      )
    : null;

  const dueDate = a.due_date || null;
  const isPastDue = !!dueDate && dueDate < today;
  // 마감 후 3일이 지나면 보관함으로 이동한다 (0 이하면 이미 보관 대상)
  const leftToArchive = dueDate ? daysUntilArchive(dueDate, today) : null;

  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* 클릭하면 제출 내역 상세로 이동하는 헤더 */}
      <Link
        href={`/teacher/assignments/${a.id}`}
        className="group flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 transition hover:bg-brand-light"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800 group-hover:text-brand">
              {a.title}
            </span>
            {isPastDue ? (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                마감
              </span>
            ) : (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                진행중
              </span>
            )}
            {/* 마감된 과제가 언제 보관함으로 넘어가는지 안내 */}
            {isPastDue && leftToArchive != null && leftToArchive > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                🗂️ {leftToArchive}일 후 보관함으로 이동
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span>{dueDate ? `📅 마감 ${dueDate}` : "📅 상시 과제"}</span>
            <span className="text-slate-300">·</span>
            <span>
              제출 {subCount}명
              {avg != null && ` · 평균 ${avg}점`}
            </span>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white group-hover:bg-brand-dark">
          제출 내역 보기 →
        </span>
      </Link>

      <div className="p-4">
        {/* 샘플음성 미리듣기 */}
        {a.sample_audio_url && (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-xs text-slate-500">
                🎧 원어민 속도
              </span>
              <audio
                src={a.sample_audio_url}
                controls
                preload="none"
                className="h-8 w-full"
              />
            </div>
            {a.sample_audio_slow_url && (
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-slate-500">
                  🐢 천천히
                </span>
                <audio
                  src={a.sample_audio_slow_url}
                  controls
                  preload="none"
                  className="h-8 w-full"
                />
              </div>
            )}
          </div>
        )}

        <div className="mt-2 flex items-center gap-3 text-xs">
          {a.sample_audio_url ? (
            <span className="text-green-600">✓ 샘플음성 준비됨</span>
          ) : (
            <span className="text-amber-600">⚠ 샘플음성 없음</span>
          )}
          <form action={regenerateSample} className="flex items-center gap-1.5">
            <input type="hidden" name="classId" value={classId} />
            <input type="hidden" name="assignmentId" value={a.id} />
            <select
              name="voice"
              defaultValue={a.sample_voice || DEFAULT_TTS_VOICE}
              className="max-w-[8.5rem] rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-500 focus:border-brand focus:outline-none"
              title="음성 선택 후 재생성"
            >
              {TTS_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <SubmitButton
              pendingText="생성 중…"
              className="whitespace-nowrap text-slate-400 hover:text-brand hover:underline"
            >
              음성 재생성
            </SubmitButton>
          </form>
          <form action={deleteAssignment} className="ml-auto">
            <input type="hidden" name="classId" value={classId} />
            <input type="hidden" name="assignmentId" value={a.id} />
            <SubmitButton
              pendingText="삭제 중…"
              className="text-slate-400 hover:text-red-500 hover:underline"
            >
              삭제
            </SubmitButton>
          </form>
        </div>

        {/* 과제 수정 */}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-brand">
            수정
          </summary>
          <form action={updateAssignment} className="mt-2 space-y-2">
            <input type="hidden" name="classId" value={classId} />
            <input type="hidden" name="assignmentId" value={a.id} />
            <input
              name="title"
              defaultValue={a.title}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
            <textarea
              name="passage_text"
              defaultValue={a.passage_text}
              required
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <label>
                마감일
                <input
                  name="due_date"
                  type="date"
                  defaultValue={a.due_date ?? ""}
                  className="ml-1 rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <SubmitButton
                pendingText="저장 중…"
                className="ml-auto rounded-lg bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark"
              >
                저장
              </SubmitButton>
            </div>
            <p className="text-[11px] text-slate-400">
              제출은 학생당 1회 고정. 지문을 바꾸면 샘플음성이 자동으로 다시
              생성돼요. 마감일을 미래로 바꾸면 보관함에서 다시 나옵니다.
            </p>
          </form>
        </details>
      </div>
    </li>
  );
}
