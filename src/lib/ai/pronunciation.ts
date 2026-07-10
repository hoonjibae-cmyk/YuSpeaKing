import "server-only";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { AzureScores } from "../types";

// Azure Speech - Pronunciation Assessment.
// 입력: 16kHz mono PCM WAV 버퍼 + 참조 지문(referenceText)
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
  const audioConfig = sdk.AudioConfig.fromWavFileInput(
    wav as unknown as File
  );

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
    recognizer.recognizeOnceAsync(
      (result) => {
        try {
          if (result.reason === sdk.ResultReason.NoMatch) {
            recognizer.close();
            reject(new Error("음성을 인식하지 못했어요. 더 또렷하게 녹음해 주세요."));
            return;
          }
          const pa = sdk.PronunciationAssessmentResult.fromResult(result);
          const detail = (pa as unknown as {
            detailResult?: {
              Words?: Array<{
                Word: string;
                PronunciationAssessment?: {
                  AccuracyScore?: number;
                  ErrorType?: string;
                };
              }>;
            };
          }).detailResult;

          const scores: AzureScores = {
            accuracy: pa.accuracyScore,
            fluency: pa.fluencyScore,
            completeness: pa.completenessScore,
            prosody: (pa as unknown as { prosodyScore?: number }).prosodyScore,
            pronunciation: pa.pronunciationScore,
            recognizedText: result.text,
            words: detail?.Words?.map((w) => ({
              word: w.Word,
              accuracy: w.PronunciationAssessment?.AccuracyScore ?? 0,
              errorType: w.PronunciationAssessment?.ErrorType,
            })),
          };
          recognizer.close();
          resolve(scores);
        } catch (e) {
          recognizer.close();
          reject(e);
        }
      },
      (err) => {
        recognizer.close();
        reject(new Error(typeof err === "string" ? err : "발음 평가 실패"));
      }
    );
  });
}
