// 한국 시간(Asia/Seoul) 기준 오늘 날짜를 'YYYY-MM-DD'로 반환.
// 서버(Vercel)는 UTC라 자정 무렵 하루 밀림을 방지하기 위해 KST로 계산한다.
export function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
