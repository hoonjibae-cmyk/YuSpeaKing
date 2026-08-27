import "server-only";

// 참조 지문과 실제 인식된 문장을 단어 단위로 정렬한다.
//
// Azure 발음평가는 enableMiscue 로 누락/삽입을 표시해 주는데, 연속 인식에서
// 학생이 쉬지 않고 이어 읽으면 구간 경계의 단어를 정렬하지 못해 '안 읽음'으로
// 잘못 표시하는 일이 잦다. 실제로는 인식 결과(recognizedText)에 그 단어가
// 멀쩡히 들어 있다. 그래서 전체 인식문을 기준으로 다시 맞춰 본다.

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface WordAlignment {
  refWords: string[];
  /** 인식문에서 실제로 읽힌 것으로 확인된 참조 단어의 인덱스 */
  matchedRefIdx: Set<number>;
  /** 읽힌 참조 단어 수 */
  matched: number;
}

// LCS(최장 공통 부분수열)로 정렬. 순서를 지키므로 같은 단어가 여러 번 나와도
// 한 번 읽은 것을 여러 번 읽은 것으로 세지 않는다.
export function alignWords(
  referenceText: string,
  hypothesisText: string
): WordAlignment {
  const ref = normalizeWords(referenceText);
  const hyp = normalizeWords(hypothesisText);
  const n = ref.length;
  const m = hyp.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        ref[i - 1] === hyp[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const matchedRefIdx = new Set<number>();
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (ref[i - 1] === hyp[j - 1]) {
      matchedRefIdx.add(i - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return { refWords: ref, matchedRefIdx, matched: dp[n][m] };
}
