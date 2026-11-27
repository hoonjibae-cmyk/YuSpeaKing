import { DEFAULT_WAVENET_VOICE, isWaveNetVoice, WAVENET_VOICES } from "@/lib/sample-voices";

export default function SampleVoiceSelect({ enabled = false, value, compact = false, newAssignment = false }: {
  enabled?: boolean; value?: string | null; compact?: boolean; newAssignment?: boolean;
}) {
  // Stored legacy recordings remain playable. New synthesis uses Google only.
  const selected = value && isWaveNetVoice(value) ? value : DEFAULT_WAVENET_VOICE;
  return (
    <select name="voice" defaultValue={enabled ? selected : ""} aria-label="샘플음성 목소리" required
      className={compact
        ? "max-w-[14rem] rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-500 focus:border-brand focus:outline-none"
        : "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"}>
      {!enabled && <option value="" disabled>Google 음성 연결을 확인해 주세요</option>}
      {enabled && <optgroup label="Google WaveNet · 일반 + 자연스럽게 천천히 (0.7배속)">
        {WAVENET_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
      </optgroup>}
    </select>
  );
}
