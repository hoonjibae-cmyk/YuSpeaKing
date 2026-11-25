// Registered Korean full names: three syllables, or four with a compound surname.
// Short names and other scripts are preserved rather than guessing a surname.
const COMPOUND_SURNAMES = new Set(["남궁", "황보", "제갈", "선우", "독고", "서문", "사공", "동방"]);
export function feedbackGivenName(name?: string | null): string {
  const full = name?.trim() ?? "";
  if (/^[가-힣]{4}$/.test(full) && COMPOUND_SURNAMES.has(full.slice(0, 2))) return full.slice(2);
  return /^[가-힣]{3}$/.test(full) ? full.slice(1) : full;
}

export function feedbackAddress(name?: string | null): string {
  const given = feedbackGivenName(name);
  if (!/^[가-힣]+$/.test(given)) return "";
  const hasFinalConsonant = (given.charCodeAt(given.length - 1) - 0xac00) % 28 !== 0;
  return given + (hasFinalConsonant ? "아" : "야");
}

// Correct only this student's full-name vocative, never ordinary name mentions.
export function displayStudentFeedback(text: string, name?: string | null): string {
  const full = name?.trim() ?? "";
  const address = feedbackAddress(full);
  if (!full || feedbackGivenName(full) === full || !address) return text;
  const escaped = full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(^|[\\s,，.!?。！？:：“”"'‘’(])${escaped}[아야](?=$|[\\s~～,，.!?。！？:：“”"'‘’)])`, "g"), `$1${address}`);
}
