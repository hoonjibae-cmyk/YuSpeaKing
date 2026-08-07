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

// 마감 후 며칠이 지나면 보관함으로 넘길지
export const ARCHIVE_AFTER_DAYS = 3;

const MS_PER_DAY = 86_400_000;

// 'YYYY-MM-DD' 를 UTC 자정 기준 밀리초로. 문자열만 다루므로 시간대 영향이 없다.
function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

// KST 기준 n일 전 날짜 ('YYYY-MM-DD'). 보관 기준일 계산에 쓴다.
export function daysAgoKST(n: number): string {
  const d = new Date(dayMs(todayKST()) - n * MS_PER_DAY);
  return d.toISOString().slice(0, 10);
}

// 이 날짜 이하로 마감된 과제는 보관함으로 간다.
export function archiveCutoffKST(): string {
  return daysAgoKST(ARCHIVE_AFTER_DAYS);
}

// 보관함으로 넘어가기까지 남은 일수. 0 이하면 이미 보관 대상.
export function daysUntilArchive(dueDate: string, today: string): number {
  return ARCHIVE_AFTER_DAYS - Math.floor((dayMs(today) - dayMs(dueDate)) / MS_PER_DAY);
}
