import type { AzureScores } from "@/lib/types";

// Azure 단어별 점수로 지문을 색칠해 보여준다.
// 초록(잘함) / 노랑(보통) / 빨강(개선) / 회색 취소선(안 읽음)
export default function WordHighlights({
  words,
}: {
  words: AzureScores["words"];
}) {
  if (!words || words.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full bg-green-500" /> 잘함
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full bg-amber-400" /> 보통
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full bg-red-400" /> 개선
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full bg-slate-300" /> 안 읽음
        </span>
      </div>
      <p className="text-lg leading-relaxed">
        {words.map((w, i) => {
          const omitted = w.errorType === "Omission";
          const cls = omitted
            ? "text-slate-400 line-through"
            : w.accuracy >= 80
            ? "text-green-600"
            : w.accuracy >= 60
            ? "text-amber-600"
            : "text-red-500";
          return (
            <span key={i} className={`${cls} mr-1.5 inline-block font-medium`}>
              {w.word}
            </span>
          );
        })}
      </p>
    </div>
  );
}
