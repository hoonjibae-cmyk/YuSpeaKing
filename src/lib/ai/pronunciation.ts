import "server-only";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { AzureScores } from "../types";

type WordResult = { word: string; accuracy: number; errorType?: string };
type Segment = {
  accuracy: number;
  fluency: number;
  completeness: number;
  prosody?: number;
  words: WordResult[];
};

// Azure Speech - Pronunciation Assessment (연속 인식).
// 긴 지문(여러 문장)도 끝까지 처리하도록 continuous recognition 으로 각 구간 결과를
// 모아 전체 점수를 집계한다. (recognizeOnceAsync 는 ~15초/단일 발화까지만 처리해
// 뒷문장이 누락 처리되는 문제가 있었음)
export async function assessPronunciation(
  wav: Buffer,
  referenceText: string
): Promise<AzureScores> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION 이 설정되지 않았습니다.");
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechRecognitionLanguage = "en-US";

  // Node SDK 는 Buffer 입력을 허용하지만 타입 정의는 File 이라 캐스팅.
  const audioConfig = sdk.AudioConfig.fromWavFileInput(wav as unknown as File);

  const paConfig = new sdk.PronunciationAssessmentConfig(
    referenceText,
    sdk.PronunciationAssessmentGradingSystem.HundredMark,
    sdk.PronunciationAssessmentGranularity.Phoneme,
    true // enableMiscue: 누락/삽입 감지
  );
  paConfig.enableProsodyAssessment = true;

  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  paConfig.applyTo(recognizer);

  return new Promise<AzureScores>((resolve, reject) => {
    const segments: Segment[] = [];
    const textParts: string[] = [];
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        recognizer.stopContinuousRecognitionAsync(
          () => {
            recognizer.close();
            fn();
          },
          () => {
            recognizer.close();
            fn();
          }
        );
      } catch {
        fn();
      }
    };

    // 안전장치: 무한 대기 방지 (Vercel maxDuration 내)
    const timer = setTimeout(() => {
      finish(() => {
        if (segments.length) resolve(aggregate(segments, textParts.join(" "), referenceText));
        else reject(new Error("발음 평가 시간이 초과되었어요."));
      });
    }, 50000);

    recognizer.recognized = (_s, e) => {
      if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
      const pa = sdk.PronunciationAssessmentResult.fromResult(e.result);
      const detail = (pa as unknown as {
        detailResult?: {
          Words?: Array<{
            Word: string;
            PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
          }>;
        };
      }).detailResult;

      if (e.result.text) textParts.push(e.result.text);
      segments.push({
        accuracy: pa.accuracyScore,
        fluency: pa.fluencyScore,
        completeness: pa.completenessScore,
        prosody: (pa as unknown as { prosodyScore?: number }).prosodyScore,
        words: (detail?.Words ?? []).map((w) => ({
          word: w.Word,
          accuracy: w.PronunciationAssessment?.AccuracyScore ?? 0,
          errorType: w.PronunciationAssessment?.ErrorType,
        })),
      });
    };

    recognizer.canceled = (_s, e) => {
      clearTimeout(timer);
      if (e.reason === sdk.CancellationReason.Error) {
        finish(() => reject(new Error(e.errorDetails || "발음 평가 실패")));
      } else {
        finish(() => {
          if (segments.length) resolve(aggregate(segments, textParts.join(" "), referenceText));
          else reject(new Error("음성을 인식하지 못했어요. 더 또렷하게 녹음해 주세요."));
        });
      }
    };

    recognizer.sessionStopped = () => {
      clearTimeout(timer);
      finish(() => {
        if (segments.length) resolve(aggregate(segments, textParts.join(" "), referenceText));
        else reject(new Error("음성을 인식하지 못했어요. 더 또렷하게 녹음해 주세요."));
      });
    };

    recognizer.startContinuousRecognitionAsync(undefined, (err) => {
      clearTimeout(timer);
      finish(() => reject(new Error(typeof err === "string" ? err : "발음 평가 시작 실패")));
    });
  });
}

function normalizeCount(text: string): number {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

// 구간별 결과를 지문 전체 기준으로 집계
function aggregate(
  segments: Segment[],
  recognizedText: string,
  referenceText: string
): AzureScores {
  const allWords = segments.flatMap((s) => s.words);
  const refCount = normalizeCount(referenceText) || 1;

  // 정확도: 삽입(Insertion) 제외 단어들의 평균 (누락은 0점으로 반영)
  const scored = allWords.filter((w) => w.errorType !== "Insertion");
  const accuracy = scored.length
    ? scored.reduce((a, w) => a + w.accuracy, 0) / scored.length
    : 0;

  // 완성도: 실제로 읽은(누락 아님) 단어 수 / 지문 단어 수
  const spoken = allWords.filter(
    (w) => w.errorType !== "Omission" && w.errorType !== "Insertion"
  ).length;
  const completeness = Math.min(100, (spoken / refCount) * 100);

  // 유창성/억양: 구간 단어 수로 가중 평균
  const totalWords = segments.reduce((a, s) => a + (s.words.length || 1), 0) || 1;
  const fluency =
    segments.reduce((a, s) => a + s.fluency * (s.words.length || 1), 0) / totalWords;
  const prosodyVals = segments.filter((s) => typeof s.prosody === "number");
  const prosody = prosodyVals.length
    ? prosodyVals.reduce((a, s) => a + (s.prosody as number) * (s.words.length || 1), 0) /
      (prosodyVals.reduce((a, s) => a + (s.words.length || 1), 0) || 1)
    : undefined;

  // 종합 발음 점수 (Azure 권장 가중치, 억양 포함 시)
  const pronunciation =
    prosody != null
      ? accuracy * 0.4 + prosody * 0.2 + fluency * 0.2 + completeness * 0.2
      : accuracy * 0.5 + fluency * 0.25 + completeness * 0.25;

  return {
    accuracy: Math.round(accuracy),
    fluency: Math.round(fluency),
    completeness: Math.round(completeness),
    prosody: prosody != null ? Math.round(prosody) : undefined,
    pronunciation: Math.round(pronunciation),
    recognizedText,
    words: allWords,
  };
}
