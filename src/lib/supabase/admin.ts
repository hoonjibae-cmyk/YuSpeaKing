import { createClient } from "@supabase/supabase-js";

// 서비스 롤 클라이언트 (RLS 우회).
// 학생 반코드 로그인/제출 등 학생 흐름은 서버에서 이 클라이언트로 처리하고,
// 접근 권한은 앱 레벨(학생 세션 쿠키)에서 검사한다.
// !!! 절대 클라이언트 컴포넌트에서 import 하지 말 것 !!!
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
