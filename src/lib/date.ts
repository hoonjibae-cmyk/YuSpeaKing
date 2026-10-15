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
  return (
    ARCHIVE_AFTER_DAYS -
    Math.floor((dayMs(today) - dayMs(dueDate)) / MS_PER_DAY)
  );
}

// 성적 추이 그래프가 다루는 가장 이른 날짜.
// 이전 데이터는 채점 기준이 여러 번 바뀌어 같은 선으로 잇기에 적절하지 않다.
export const TREND_START = "2026-09-01";

// ---------- 주 단위 구간 ----------

// 오프셋 주(0=이번 주, 1=지난주)의 [시작, 끝) 구간을 KST 월요일 기준으로.
// 서버는 UTC 라서 그냥 자르면 월요일 새벽이 전주로 밀린다.
export function kstWeekWindow(offset: number): {
  startUtc: string;
  endUtc: string;
  /** '10/06 ~ 10/12' 처럼 사람이 읽는 구간 */
  range: string;
  label: string;
} {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const dow = kst.getUTCDay(); // 0=일..6=토 (KST 벽시계)
  const sinceMon = (dow + 6) % 7;
  const mondayKstMidnight =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) -
    sinceMon * MS_PER_DAY;
  const startKst = mondayKstMidnight - offset * 7 * MS_PER_DAY;
  const endKst = startKst + 7 * MS_PER_DAY;
  // KST 벽시계 자정 → 실제 UTC 순간(−9h)
  const startUtc = new Date(startKst - 9 * 3600 * 1000).toISOString();
  const endUtc = new Date(endKst - 9 * 3600 * 1000).toISOString();

  const md = (ms: number) =>
    new Date(ms).toISOString().slice(5, 10).replace("-", "/");
  const range = `${md(startKst)} ~ ${md(endKst - MS_PER_DAY)}`;

  const label =
    offset === 0
      ? "이번 주"
      : offset === 1
        ? "지난주"
        : offset === 2
          ? "지지난주"
          : `${offset}주 전`;
  return { startUtc, endUtc, range, label };
}
