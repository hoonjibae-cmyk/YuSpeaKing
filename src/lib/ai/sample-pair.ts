// Publish metadata only after BOTH new objects exist. No old object is overwritten/deleted.
export async function publishSamplePair({ normal, slow, voice, upload, commit }: {
  normal: Buffer; slow: Buffer; voice: string;
  upload: (mode: "normal" | "slow", audio: Buffer) => Promise<string>;
  commit: (normalUrl: string, slowUrl: string, voice: string) => Promise<void>;
}) {
  const normalUrl = await upload("normal", normal);
  const slowUrl = await upload("slow", slow);
  await commit(normalUrl, slowUrl, voice);
}
