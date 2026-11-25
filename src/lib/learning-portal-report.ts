import "server-only";
import { portalEnabled } from "./learning-portal";
const voca = "https://ylmekshcospqexruztbv.supabase.co";
export async function verifyPortalStudent(authorization: string | null): Promise<string> {
 if (!portalEnabled() || !process.env.VOCA_PUBLISHABLE_KEY) throw new Error("포탈 리포트 연결을 준비 중입니다.");
 if (!authorization?.startsWith("Bearer ") || authorization.length > 8192) throw new Error("학생 로그인이 필요합니다.");
 const headers = { apikey: process.env.VOCA_PUBLISHABLE_KEY, Authorization: authorization };
 const response = await fetch(voca + "/auth/v1/user", { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
 if (!response.ok) throw new Error("학생 로그인을 확인해 주세요.");
 const user = await response.json(), meta = user.app_metadata;
 if (!user.id || meta?.source_system !== "student_card" || !/^\d+$/.test(String(meta.external_student_id)) || meta.must_change_password || meta.password_recovery_id) throw new Error("학생카드 연결 계정이 아닙니다.");
 const profiles = await fetch(voca + "/rest/v1/profiles?id=eq." + encodeURIComponent(user.id) + "&select=role,is_active,external_student_id,student_card_status,password_auth_version,password_recovery_id", { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
 if (!profiles.ok) throw new Error("계정 상태 확인에 실패했습니다.");
 const [profile] = await profiles.json();
 if (!profile?.is_active || profile.role !== "student" || profile.student_card_status !== "active" || profile.external_student_id !== String(meta.external_student_id) || profile.password_recovery_id || (profile.password_auth_version && profile.password_auth_version !== meta.password_auth_version)) throw new Error("현재 사용 가능한 재원생 계정이 아닙니다.");
 return String(meta.external_student_id);
}
export function portalWeek(value: string | null) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error("주간 시작일을 확인해 주세요.");
 const date = new Date(value + "T00:00:00+09:00");
 if (Number.isNaN(date.getTime()) || new Date(date.getTime() + 32400000).toISOString().slice(0, 10) !== value || new Date(date.getTime() + 32400000).getUTCDay() !== 1) throw new Error("월요일을 시작일로 지정해 주세요.");
 return { from: date.toISOString(), to: new Date(date.getTime() + 604800000).toISOString() };
}
