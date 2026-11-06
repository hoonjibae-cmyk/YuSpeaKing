import "server-only";

// 유스피킹 명단과 Student Card 명단을 맞춰 보는 규칙.
// 화면·DB 와 무관한 순수 함수만 둔다 — 시험하기 쉽고, 동기화와 운영자 화면이
// 같은 규칙을 쓰게 하기 위해서다.
//
// 학생은 1) 이름 2) 전화번호 순으로 맞춘다.
//  · 이름이 같고 후보가 하나면 잇는다.
//  · 이름 후보가 여럿이면(동명이인) 전화번호로 하나를 고를 수 있을 때만 잇는다.
//  · 이름이 다른데 학생 본인 번호가 같으면 잇는다 (이름 오타·개명).
//  · 이름이 다른데 학부모 번호만 같으면 잇지 않고 '확인 필요' 로 남긴다.
//    형제자매는 학부모 번호를 같이 쓰기 때문에, 이것만으로 잇으면 다른 아이와
//    연결될 수 있다.

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
  studentPhone?: string | null;
  parentPhone?: string | null;
  /** 'none' 이면 운영자가 'Student Card 에 없는 학생' 으로 표시한 것 — 맞추지 않는다 */
  linkMethod?: string | null;
}

export type MatchKind =
  /** 이전에 이어 둔 Student Card 학생 ID */
  | "id"
  /** 이름이 그대로 같다 */
  | "exact"
  /** 꼬리표만 다르고 후보가 하나뿐이다 (홍길동 = 홍길동A) */
  | "suffix"
  /** 같은 이름이 여럿인데 전화번호로 하나를 골랐다 */
  | "name+phone"
  /** 이름은 다르지만 학생 본인 번호가 같다 */
  | "phone";

export interface Matched {
  local: LocalStudent;
  hr: HrStudent;
  kind: MatchKind;
}

export interface Ambiguous {
  local: LocalStudent;
  /** 사람이 골라야 하는 후보 */
  candidates: HrStudent[];
  /** 왜 골라야 하는지 (화면 표시용) */
  reason: "same-name" | "parent-phone";
}

export interface MatchResult {
  matched: Matched[];
  /** Student Card 에만 있는 학생 — 유스피킹에 새로 들어올 대상 */
  onlyInHr: HrStudent[];
  /** 유스피킹에만 있는 학생 — 운영자가 판단할 대상 */
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

const compactName = (name: string) => name.replace(/\s+/g, "");

// 휴대폰 번호 비교용. 숫자만 남기고, 휴대폰 형태가 아니면 비교하지 않는다.
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return /^01\d{8,9}$/.test(d) ? d : null;
}

function sharesPhone(l: LocalStudent, h: HrStudent): boolean {
  const mine = [phoneKey(l.studentPhone), phoneKey(l.parentPhone)].filter(
    Boolean,
  );
  const theirs = [phoneKey(h.studentPhone), phoneKey(h.parentPhone)].filter(
    Boolean,
  );
  return mine.some((p) => theirs.includes(p));
}

function sharesStudentPhone(l: LocalStudent, h: HrStudent): boolean {
  const a = phoneKey(l.studentPhone);
  return !!a && a === phoneKey(h.studentPhone);
}

export function matchRosters(
  locals: LocalStudent[],
  hrs: HrStudent[],
): MatchResult {
  const matched: Matched[] = [];
  const ambiguous: Ambiguous[] = [];
  const usedHr = new Set<string>();
  const usedLocal = new Set<string>();

  const link = (l: LocalStudent, h: HrStudent, kind: MatchKind) => {
    matched.push({ local: l, hr: h, kind });
    usedHr.add(h.hrId);
    usedLocal.add(l.id);
  };

  // 운영자가 'Student Card 에 없음' 으로 표시한 학생은 아예 맞추지 않는다
  const active = locals.filter((l) => l.linkMethod !== "none");

  // 0) 이전에 이어 둔 짝(hrId)이 있으면 그것을 가장 먼저 믿는다.
  //    이름이 바뀌어도 연결이 끊기지 않는다.
  const hrById = new Map(hrs.map((h) => [h.hrId, h]));
  for (const l of active) {
    const h = l.hrId ? hrById.get(l.hrId) : undefined;
    if (h && !usedHr.has(h.hrId)) link(l, h, "id");
  }

  const free = () => hrs.filter((h) => !usedHr.has(h.hrId));

  // 1·2) 이름 — 그대로 같은 이름, 그다음 꼬리표를 뗀 이름
  for (const keyOf of [compactName, baseName] as const) {
    const kind: MatchKind = keyOf === compactName ? "exact" : "suffix";
    for (const l of active) {
      if (usedLocal.has(l.id)) continue;
      const key = keyOf(l.name);
      const cands = free().filter((h) => keyOf(h.name) === key);
      if (cands.length === 0) continue;
      // 유스피킹 쪽에도 같은 이름이 여럿일 수 있다. 먼저 본 학생이 후보를
      // 가져가 버리지 않도록 양쪽이 모두 하나일 때만 이름만으로 잇는다.
      const rivals = active.filter(
        (x) => !usedLocal.has(x.id) && keyOf(x.name) === key,
      );
      if (cands.length === 1 && rivals.length === 1) {
        link(l, cands[0], kind);
        continue;
      }
      // 동명이인 — 전화번호로 짝이 하나로 정해지면 잇는다.
      // (그 후보와 번호가 겹치는 다른 유스피킹 학생이 없어야 한다)
      const byPhone = cands.filter((h) => sharesPhone(l, h));
      if (
        byPhone.length === 1 &&
        rivals.filter((x) => sharesPhone(x, byPhone[0])).length === 1
      ) {
        link(l, byPhone[0], "name+phone");
      }
    }
  }

  // 이름 후보가 있는데 이름·전화로 하나를 못 고른 학생 → 사람이 고른다
  for (const l of active) {
    if (usedLocal.has(l.id)) continue;
    const cands = free().filter((h) => baseName(h.name) === baseName(l.name));
    if (cands.length > 0) {
      ambiguous.push({ local: l, candidates: cands, reason: "same-name" });
      usedLocal.add(l.id);
    }
  }

  // 3) 전화번호 — 이름으로 못 찾은 학생만
  for (const l of active) {
    if (usedLocal.has(l.id)) continue;
    const strong = free().filter((h) => sharesStudentPhone(l, h));
    if (strong.length === 1) {
      link(l, strong[0], "phone");
      continue;
    }
    // 학부모 번호만 같은 경우는 형제자매일 수 있어 잇지 않는다
    const weak = free().filter((h) => sharesPhone(l, h));
    if (weak.length > 0) {
      ambiguous.push({ local: l, candidates: weak, reason: "parent-phone" });
      usedLocal.add(l.id);
    }
  }

  // 사람이 골라야 하는 후보는 '새로 들어올 학생' 에서 뺀다.
  // 그대로 두면 같은 학생이 유스피킹에 한 번 더 만들어질 수 있다.
  const pending = new Set(
    ambiguous.flatMap((a) => a.candidates.map((c) => c.hrId)),
  );

  return {
    matched,
    ambiguous,
    onlyInHr: hrs.filter((h) => !usedHr.has(h.hrId) && !pending.has(h.hrId)),
    onlyInLocal: active.filter((l) => !usedLocal.has(l.id)),
  };
}

// 반 이름 비교용. 공백·괄호·밑줄을 지우고 소문자로.
export function normalizeClassName(name: string): string {
  return name.replace(/[\s_()[\]-]/g, "").toLowerCase();
}

// ---------- 선생님 ----------

// 담임 이름 비교용. Student Card 는 '레이첼', 유스피킹은 '레이첼T' 처럼 적는
// 일이 흔해서 호칭·꼬리표를 떼고 비교한다.
//  "레이첼T" → "레이첼", "배승희 선생님" → "배승희", "Rachel" → "rachel"
// 영문 이름 끝의 t 는 떼지 않는다 (Matt → Matt). 한글 뒤에 붙은 T 만 호칭이다.
export function normalizeTeacherName(name: string): string {
  return name
    .replace(/\s+/g, "")
    .replace(/(선생님|쌤|샘|강사님?)$/, "")
    .replace(/(?<=[가-힣])[Tt]$/, "")
    .toLowerCase();
}

export interface TeacherMatch {
  /** 자동으로 이을 수 있는 것 (이름이 하나에만 맞음) */
  auto: { cardName: string; teacherId: string }[];
  /** 같은 이름의 선생님이 여럿 — 운영자가 골라야 함 */
  ambiguous: { cardName: string; teacherIds: string[] }[];
  /** 맞는 선생님이 없음 */
  unmatched: string[];
}

export function matchTeachers(
  cardNames: string[],
  teachers: { id: string; name: string | null }[],
  alreadyLinked: Set<string>,
): TeacherMatch {
  const byKey = new Map<string, string[]>();
  for (const t of teachers) {
    const k = normalizeTeacherName(t.name ?? "");
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), t.id]);
  }
  const out: TeacherMatch = { auto: [], ambiguous: [], unmatched: [] };
  for (const cardName of Array.from(new Set(cardNames))) {
    if (!cardName.trim() || alreadyLinked.has(cardName)) continue;
    const ids = byKey.get(normalizeTeacherName(cardName)) ?? [];
    if (ids.length === 1) out.auto.push({ cardName, teacherId: ids[0] });
    else if (ids.length > 1) out.ambiguous.push({ cardName, teacherIds: ids });
    else out.unmatched.push(cardName);
  }
  return out;
}

// ---------- 반 ----------

export interface CardClassLite {
  hrClassId: string;
  name: string;
  teacherName?: string | null;
}
export interface LocalClassLite {
  id: string;
  name: string;
  teacherId: string;
}

// 아직 이어지지 않은 반 중에서 자동으로 이을 수 있는 짝을 찾는다.
//  · 반 이름이 양쪽에 하나씩뿐이면 잇는다.
//  · 같은 이름이 여럿이면, Student Card 담임이 가리키는 선생님의 반으로 하나가
//    정해질 때만 잇는다. (두 선생님이 같은 반 이름을 쓰는 경우)
export function matchClasses(
  cards: CardClassLite[],
  locals: LocalClassLite[],
  teacherOf: Map<string, string>, // Student Card 담임 이름 → 유스피킹 선생님 id
): { classId: string; hrClassId: string }[] {
  const out: { classId: string; hrClassId: string }[] = [];
  const usedCard = new Set<string>();
  const usedLocal = new Set<string>();

  const sameName = <T extends { name: string }>(list: T[], name: string) =>
    list.filter((x) => normalizeClassName(x.name) === normalizeClassName(name));

  for (const l of locals) {
    const cands = sameName(cards, l.name).filter(
      (c) => !usedCard.has(c.hrClassId),
    );
    const rivals = sameName(locals, l.name).filter((x) => !usedLocal.has(x.id));
    let pick: CardClassLite | undefined;
    if (cands.length === 1 && rivals.length === 1) {
      pick = cands[0];
    } else if (cands.length > 0) {
      const mine = cands.filter(
        (c) => c.teacherName && teacherOf.get(c.teacherName) === l.teacherId,
      );
      const sameTeacherRivals = rivals.filter(
        (x) => x.teacherId === l.teacherId,
      );
      if (mine.length === 1 && sameTeacherRivals.length === 1) pick = mine[0];
    }
    if (pick) {
      out.push({ classId: l.id, hrClassId: pick.hrClassId });
      usedCard.add(pick.hrClassId);
      usedLocal.add(l.id);
    }
  }
  return out;
}
