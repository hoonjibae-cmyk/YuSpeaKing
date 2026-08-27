import "server-only";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { AzureScores } from "../types";
import { logUsage } from "../usage";
import { alignWords, normalizeWords } from "./align";

// 인식 상한. Vercel Pro(최대 300초) 기준으로 넉넉히 잡아 긴 녹음도 끝까지 인식한다.
// 과제를 15문장까지 낼 수 있게 되면서 녹음이 3분을 넘길 수 있어 상한을 올렸다.
// 점수는 인식이 끝나는 즉시 저장하므로(피드백 생성은 그 뒤) 300초 안에서
// 다운로드·저장에 쓸 여유를 60초 남긴다.
const AZURE_TIMEOUT_MS = 240_000;

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

  // 16kHz mono 16-bit WAV: (전체 - 44바이트 헤더) / (16000*2) = 초
  const audioSeconds = Math.max(0, (wav.length - 44) / (16000 * 2));
  await logUsage("azure", { model: "pronunciation-assessment", audioSeconds });

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
    let truncated = false; // 시간 제한에 걸려 인식이 끊겼는지

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

    // 안전장치: 무한 대기 방지. 긴 녹음도 끝까지 인식하도록 넉넉히 잡는다.
    // (여기에 걸렸다는 건 인식이 도중에 끊겼다는 뜻이라 truncated 로 표시하고,
    //  그 경우 완성도는 실제로 읽은 양이 아니므로 감점에 쓰지 않는다)
    const timer = setTimeout(() => {
      truncated = true;
      finish(() => {
        if (segments.length) {
          resolve(aggregate(segments, textParts.join(" "), referenceText, true));
        } else {
          reject(new Error("발음 평가 시간이 초과되었어요."));
        }
      });
    }, AZURE_TIMEOUT_MS);

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
          if (segments.length) {
            resolve(aggregate(segments, textParts.join(" "), referenceText, truncated));
          } else {
            reject(new Error("음성을 인식하지 못했어요. 더 또렷하게 녹음해 주세요."));
          }
        });
      }
    };

    recognizer.sessionStopped = () => {
      clearTimeout(timer);
      finish(() => {
        if (segments.length) {
          resolve(aggregate(segments, textParts.join(" "), referenceText, truncated));
        } else {
          reject(new Error("음성을 인식하지 못했어요. 더 또렷하게 녹음해 주세요."));
        }
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
  referenceText: string,
  truncated = false
): AzureScores {
  const allWords = segments.flatMap((s) => s.words);
  const refCount = normalizeCount(referenceText) || 1;

  // 정확도: 실제로 읽은 단어(삽입·누락 제외)의 발음 정확도 평균.
  // "얼마나 정확히 읽었나"만 보고, "얼마나 많이 읽었나"는 완성도(completeness)가 담당.
  const scored = allWords.filter(
    (w) => w.errorType !== "Insertion" && w.errorType !== "Omission"
  );
  const accuracy = scored.length
    ? scored.reduce((a, w) => a + w.accuracy, 0) / scored.length
    : 0;

  // 완성도: 실제로 읽은 단어 수 / 지문 단어 수
  //
  // Azure 의 누락(Omission) 표시만 믿지 않는다. 쉬지 않고 이어 읽으면 연속 인식이
  // 구간 경계의 단어를 정렬하지 못해, 학생이 분명히 발음한 단어까지 '안 읽음'으로
  // 찍히는 일이 잦다. 그런 단어도 인식문(recognizedText)에는 남아 있으므로
  // 전체 인식문을 지문과 다시 맞춰 보고, 둘 중 더 많이 읽은 쪽을 인정한다.
  const spokenByAzure = allWords.filter(
    (w) => w.errorType !== "Omission" && w.errorType !== "Insertion"
  ).length;
  const alignment = alignWords(referenceText, recognizedText);
  const spoken = Math.max(spokenByAzure, alignment.matched);
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

  // 읽은 부분의 발음 품질 점수 (완성도는 여기서 제외)
  //
  // 억양은 Azure 가 늘 돌려주지는 않는다(짧거나 조건이 안 맞으면 빠진다).
  // 예전에는 억양이 없을 때 정확도 0.6 / 유창성 0.4 로 갈아탔는데, 그러면
  // 억양이 나온 학생과 안 나온 학생이 서로 다른 잣대로 채점됐다.
  // (억양이 안 나온 쪽은 유창성 비중이 0.25 → 0.40 으로 뛰어 유리해진다)
  // 이제는 억양이 빠지면 그 몫을 정확도·유창성의 원래 비율(2:1)대로 나눠 주어
  // 두 경우의 기준을 맞춘다.
  // 억양은 Azure 에서 가장 박하고 불안정하게 나오는 항목이라 비중을 낮춰 두었다.
  // (초6 단계에서는 정확한 발음과 끊김 없이 읽기가 먼저다)
  const W_ACC = 0.5;
  const W_PROS = 0.15;
  const W_FLU = 0.35;
  const quality =
    prosody != null
      ? accuracy * W_ACC + prosody * W_PROS + fluency * W_FLU
      : (accuracy * W_ACC + fluency * W_FLU) / (W_ACC + W_FLU);

  // 완성도 페널티: 지문을 끝까지 읽지 않으면 종합 점수를 크게 낮춘다.
  // 90% 이상 읽으면 감점 없음, 그 아래로는 읽은 비율에 비례해 가파르게 감점.
  // (예: 지문의 절반만 읽으면 발음이 좋아도 종합점수는 약 절반으로 떨어진다)
  // 인식이 도중에 끊긴 경우(truncated)의 완성도는 '학생이 덜 읽은 것'이 아니라
  // '우리가 다 못 들은 것'이므로 감점하지 않는다.
  const completenessFactor = truncated ? 1 : Math.min(1, completeness / 90);
  const pronunciation = quality * completenessFactor;

  // 화면 표시도 함께 바로잡는다. 인식문에 남아 있는 단어가 '안 읽음'으로
  // 회색 취소선 처리되면 학생·선생님이 사실과 다른 피드백을 보게 된다.
  const heard = new Set(
    Array.from(alignment.matchedRefIdx, (i) => alignment.refWords[i])
  );
  const avgAccuracy = Math.round(accuracy);
  const words = allWords.map((w) => {
    if (w.errorType !== "Omission") return w;
    const key = normalizeWords(w.word)[0];
    if (!key || !heard.has(key)) return w;
    // 실제로는 읽은 단어. Azure 가 점수를 매기지 않았으므로 평균 정확도로 채운다.
    return { ...w, accuracy: avgAccuracy, errorType: "None" };
  });

  return {
    accuracy: Math.round(accuracy),
    fluency: Math.round(fluency),
    completeness: Math.round(completeness),
    prosody: prosody != null ? Math.round(prosody) : undefined,
    pronunciation: Math.round(pronunciation),
    truncated: truncated || undefined,
    recognizedText,
    words,
  };
}
