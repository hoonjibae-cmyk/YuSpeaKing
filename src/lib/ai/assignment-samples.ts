import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { synthesizeSpeech } from "@/lib/ai/tts";
import { isWaveNetVoice, selectSampleVoice, waveNetTestEnabled } from "@/lib/sample-voices";
import { synthesizeWaveNetPair } from "@/lib/ai/wavenet";
import { publishSamplePair } from "@/lib/ai/sample-pair";
// 정상 속도 + 느린 샘플 음성 2종 생성 → Storage 업로드 → URL 저장
export async function generateAndStoreSamples(
  assignmentId: string,
  passageText: string,
  voice?: string,
  assignmentPatch?: { title: string; passage_text: string; due_date: string | null; max_attempts: number },
) {
  const selectedVoice = selectSampleVoice(voice, waveNetTestEnabled());
  if (isWaveNetVoice(selectedVoice)) {
    const { normal, slow } = await synthesizeWaveNetPair(passageText, selectedVoice);
    const admin = createAdminClient();
    const version = randomBytes(16).toString("hex");
    await publishSamplePair({ normal, slow, voice: selectedVoice,
      upload: async (mode, audio) => {
        const objectPath = `${assignmentId}_wavenet_${version}_${mode}.mp3`;
        const { error } = await admin.storage.from("sample-audio").upload(objectPath, audio, { contentType: "audio/mpeg", upsert: false });
        if (error) throw new Error("샘플음성 저장 실패. 기존 음성을 유지합니다.");
        return admin.storage.from("sample-audio").getPublicUrl(objectPath).data.publicUrl;
      },
      commit: async (normalUrl, slowUrl, selected) => {
        const { error } = await admin.from("assignments")
          .update({ ...assignmentPatch, sample_audio_url: normalUrl, sample_audio_slow_url: slowUrl, sample_voice: selected })
          .eq("id", assignmentId).select("id").single();
        if (error) throw new Error("샘플음성 연결 실패. 기존 음성을 유지합니다.");
      },
    });
    return;
  }
  const admin = createAdminClient();
  const [normal, slow] = await Promise.all([
    synthesizeSpeech(passageText, "normal", voice),
    synthesizeSpeech(passageText, "slow", voice),
  ]);
  const normalPath = `${assignmentId}.mp3`;
  const slowPath = `${assignmentId}_slow.mp3`;
  await Promise.all([
    admin.storage
      .from("sample-audio")
      .upload(normalPath, normal, { contentType: "audio/mpeg", upsert: true }),
    admin.storage
      .from("sample-audio")
      .upload(slowPath, slow, { contentType: "audio/mpeg", upsert: true }),
  ]);
  const normalUrl = admin.storage.from("sample-audio").getPublicUrl(normalPath)
    .data.publicUrl;
  const slowUrl = admin.storage.from("sample-audio").getPublicUrl(slowPath)
    .data.publicUrl;
  await admin
    .from("assignments")
    .update({ sample_audio_url: normalUrl, sample_audio_slow_url: slowUrl, sample_voice: selectedVoice })
    .eq("id", assignmentId);
}

