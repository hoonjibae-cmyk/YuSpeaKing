import "server-only";

// 유스피킹 학생 명단과 Student Card 명단을 맞춰 보는 규칙.
//
// Student Card 에는 동명이인을 구분하려고 이름 뒤에 A·B 같은 표시가 붙는다.
// 유스피킹에는 선생님이 그냥 "홍길동" 으로 적어 두었을 수 있다.
// 그래서 꼬리표를 떼고 비교하되, **떼고 났을 때 후보가 둘 이상이면
// 자동으로 잇지 않는다.** 둘 중 누구인지 우리가 알 방법이 없기 때문이다.

export interface HrStudent {
  hrId: string;
  name: string;
  studentPhone: string | null;
  parentPhone: string | null;
}

export interface LocalStudent {
  id: string;
  name: string;
  hrId: string | null;
}

export type MatchKind =
  /** 이름이 그대로 같다 */
  | "exact"
  /** 꼬리표만 다르고 후보가 하나뿐이다 (홍길동 = 홍길동A) */
  | "suffix";

export interface Matched {
  local: LocalStudent;
  hr: HrStudent;
  kind: MatchKind;
}

export interface Ambiguous {
  local: LocalStudent;
  /** 꼬리표만 다른 후보가 여럿 (홍길동A, 홍길동B) */
  candidates: HrStudent[];
}

export interface MatchResult {
  matched: Matched[];
  /** HR 에만 있는 학생 — 선생님이 유스피킹에 등록해야 할 대상 */
  onlyInHr: HrStudent[];
  /** 유스피킹에만 있는 학생 — 퇴원했거나 HR 에 아직 없는 경우 */
  onlyInLocal: LocalStudent[];
  /** 사람이 골라 줘야 하는 경우 */
  ambiguous: Ambiguous[];
}

// 공백을 없애고 이름 뒤 구분자(A, B, 1, 2…)를 떼어 낸다.
// "홍길동A" → "홍길동", "홍 길동 B" → "홍길동"
//
// 영문·숫자 한 자만 뗀다. '박서준가' 처럼 한글로 끝나는 이름은 그대로 둔다 —
// 가·나·하 는 실제 이름의 끝 글자일 수 있어서, 떼면 엉뚱한 사람과 이어진다.
export function baseName(name: string): string {
  const compact = name.replace(/\s+/g, "");
  // 한글 이름 두 자 이상 뒤에 붙은 영문 1자 또는 숫자 1자
  return compact.replace(/(?<=[가-힣]{2,})[A-Za-z0-9]$/, "");
}

export function matchRosters(
  locals: LocalStudent[],
  hrs: HrStudent[],
): MatchResult {
  const matched: Matched[] = [];
  const ambiguous: Ambiguous[] = [];
  const usedHr = new Set<string>();
  const usedLocal = new Set<string>();

  // 0) 이전에 이어 둔 짝(hrId)이 있으면 그것을 가장 먼저 믿는다.
  //    이름이 바뀌어도 연결이 끊기지 않는다.
  const hrById = new Map(hrs.map((h) => [h.hrId, h]));
  for (const l of locals) {
    if (!l.hrId) continue;
    const h = hrById.get(l.hrId);
    if (h) {
      matched.push({ local: l, hr: h, kind: "exact" });
      usedHr.add(h.hrId);
      usedLocal.add(l.id);
    }
  }

  const restLocal = locals.filter((l) => !usedLocal.has(l.id));
  const restHr = hrs.filter((h) => !usedHr.has(h.hrId));

  // 1) 이름이 그대로 같은 경우
  const byExact = new Map<string, HrStudent[]>();
  for (const h of restHr) {
    const k = h.name.replace(/\s+/g, "");
    byExact.set(k, [...(byExact.get(k) ?? []), h]);
  }
  for (const l of restLocal) {
    if (usedLocal.has(l.id)) continue;
    const cands = (byExact.get(l.name.replace(/\s+/g, "")) ?? []).filter(
      (h) => !usedHr.has(h.hrId),
    );
    if (cands.length === 1) {
      matched.push({ local: l, hr: cands[0], kind: "exact" });
      usedHr.add(cands[0].hrId);
      usedLocal.add(l.id);
    }
  }

  // 2) 꼬리표를 떼고 비교 — 후보가 정확히 하나일 때만 잇는다
  const byBase = new Map<string, HrStudent[]>();
  for (const h of restHr) {
    if (usedHr.has(h.hrId)) continue;
    const k = baseName(h.name);
    byBase.set(k, [...(byBase.get(k) ?? []), h]);
  }
  for (const l of restLocal) {
    if (usedLocal.has(l.id)) continue;
    const cands = (byBase.get(baseName(l.name)) ?? []).filter(
      (h) => !usedHr.has(h.hrId),
    );
    if (cands.length === 1) {
      matched.push({ local: l, hr: cands[0], kind: "suffix" });
      usedHr.add(cands[0].hrId);
      usedLocal.add(l.id);
    } else if (cands.length > 1) {
      // 홍길동A, 홍길동B 가 함께 있으면 사람이 골라야 한다
      ambiguous.push({ local: l, candidates: cands });
      usedLocal.add(l.id);
    }
  }

  // 사람이 골라야 하는 후보는 '신규 등록 대상'에서 뺀다.
  // 그대로 두면 선생님에게 홍길동A·홍길동B 를 새로 등록하라고 안내하게 된다.
  const pending = new Set(
    ambiguous.flatMap((a) => a.candidates.map((c) => c.hrId)),
  );

  return {
    matched,
    ambiguous,
    onlyInHr: hrs.filter((h) => !usedHr.has(h.hrId) && !pending.has(h.hrId)),
    onlyInLocal: locals.filter((l) => !usedLocal.has(l.id)),
  };
}

// 반 이름 비교용. 공백·괄호·밑줄을 지우고 소문자로.
export function normalizeClassName(name: string): string {
  return name.replace(/[\s_()[\]-]/g, "").toLowerCase();
}
