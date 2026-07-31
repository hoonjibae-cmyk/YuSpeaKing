import "server-only";
import { headers } from "next/headers";

// 밖으로 나가는 링크(Slack 알림·푸시·복사용 링크)의 기본 주소.
//
// 크론(매일 제출 현황 등)은 브라우저 요청이 아니라 Vercel 이 내부에서 호출하므로
// 요청 주소가 배포용 주소(...vercel.app)로 잡힌다. 그래서 정식 도메인을
// 환경변수(NEXT_PUBLIC_APP_URL)로 지정해 두고 항상 그 값을 우선 사용한다.
export function appOrigin(fallback?: string): string {
  const trim = (v: string) => v.trim().replace(/\/+$/, "");

  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && configured.trim()) return trim(configured);

  // 환경변수가 없으면 현재 요청의 호스트를 쓴다 (브라우저에서 들어온 경우)
  try {
    const host = headers().get("host");
    if (host) return `https://${host}`;
  } catch {
    // 요청 컨텍스트 밖(크론 등)에서는 headers() 사용 불가
  }

  return fallback ? trim(fallback) : "";
}
