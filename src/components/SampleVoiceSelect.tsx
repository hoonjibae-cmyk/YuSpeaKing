import { DEFAULT_TTS_VOICE, TTS_VOICES } from "@/lib/tts-voices";
import { WAVENET_VOICES } from "@/lib/sample-voices";

export default function SampleVoiceSelect({ enabled = false, value, compact = false }: {
  enabled?: boolean; value?: string | null; compact?: boolean;
}) {
  const selected = value || DEFAULT_TTS_VOICE;
  const unavailable = !enabled && WAVENET_VOICES.some((v) => v.id === selected);
  return (
    <select name="voice" defaultValue={selected} aria-label="샘플음성 목소리"
      className={compact
        ? "max-w-[14rem] rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-500 focus:border-brand focus:outline-none"
        : "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"}>
      {unavailable && <option value={selected}>{selected} · 테스트 환경에서 재생성 가능</option>}
      <optgroup label="OpenAI">
        {TTS_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
      </optgroup>
      {enabled && <optgroup label="Google WaveNet · 일반 + 자연스럽게 천천히 (0.7배속)">
        {WAVENET_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
      </optgroup>}
    </select>
  );
}
