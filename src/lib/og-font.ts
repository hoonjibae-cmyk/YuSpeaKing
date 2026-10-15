import "server-only";

// 그림(OG 이미지)에 한글을 그리려면 글꼴 파일이 필요하다. 기본 글꼴에는
// 한글 글립이 없어서 전부 네모로 나온다.
//
// 전체 Noto Sans KR 은 한 벌에 6MB 라 저장소에 넣기 부담스럽다. 대신 구글
// 폰트에 '이 글자들만' 달라고 하면 그 글자만 든 글꼴을 돌려준다 — 보통
// 10KB 안쪽이다. 학생 이름처럼 미리 알 수 없는 글자도 그때그때 받으면 된다.
//
// 네트워크에 기대는 만큼, 실패하면 부르는 쪽에서 글(텍스트) 알림으로
// 되돌아가도록 null 이 아니라 예외를 던진다.

const CSS = "https://fonts.googleapis.com/css2";

// 같은 실행 안에서 굵기만 다른 두 벌을 받으므로 잠깐 담아 둔다.
const cache = new Map<string, ArrayBuffer>();

export async function loadKoreanFont(
  text: string,
  weight: 400 | 700,
): Promise<ArrayBuffer> {
  // 같은 글자를 여러 번 보내 봐야 소용없다. 중복을 없애 URL 을 짧게 유지한다.
  const chars = Array.from(new Set(Array.from(text))).join("");
  const key = `${weight}:${chars}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const url =
    `${CSS}?family=${encodeURIComponent(`Noto Sans KR:wght@${weight}`)}` +
    `&text=${encodeURIComponent(chars)}`;

  // 최신 브라우저인 척하면 woff2 를 주는데, 그림 그리는 쪽이 읽지 못한다.
  // 평범한 요청으로 두어 truetype 을 받는다.
  const cssRes = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!cssRes.ok) throw new Error(`글꼴 목록 조회 실패 (${cssRes.status})`);
  const css = await cssRes.text();

  const match =
    css.match(/src:\s*url\((https:[^)]+)\)\s*format\('truetype'\)/) ??
    css.match(/url\((https:[^)]+\.ttf)\)/);
  if (!match) throw new Error("truetype 글꼴 주소를 찾지 못했어요.");

  const fontRes = await fetch(match[1], { cache: "no-store" });
  if (!fontRes.ok) throw new Error(`글꼴 내려받기 실패 (${fontRes.status})`);
  const buf = await fontRes.arrayBuffer();

  cache.set(key, buf);
  return buf;
}
