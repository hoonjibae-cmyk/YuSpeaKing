import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// 교사(Supabase Auth) 세션 쿠키를 갱신한다.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 세션 갱신 (교사 라우트에서만 의미 있음)
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // 교사 세션 갱신은 교사/운영자 라우트에서만 필요.
  // 학생·랜딩 등 다른 경로에서는 Supabase auth 왕복을 하지 않아 더 빠르다.
  matcher: ["/teacher/:path*", "/admin/:path*"],
};
