import "server-only";
import { ImageResponse } from "next/og";
import { loadKoreanFont } from "./og-font";
import { mmss, type ClassWeek, type WeeklySummary } from "./weekly";

// 주간 요약을 그림 한 장으로. 슬랙 코드블록은 글꼴·너비가 기기마다 달라
// 표가 쉽게 어긋나는데, 그림은 어디서 보든 똑같이 보인다.

const W = 1000;
const PAD = 40;

// 색 (화면과 같은 계열)
const INK = "#0f172a";
const MUTE = "#64748b";
const LINE = "#e2e8f0";
const BRAND = "#2563eb";
const WARN = "#b45309";
const WARN_BG = "#fffbeb";

// ImageResponse 는 높이를 미리 받아야 한다. 글자 높이에 맡기면 실제 그림이
// 계산보다 길어져 아래가 잘리므로, 모든 덩어리에 높이를 못 박고 그 값을
// 그대로 더한다. 아래 상수를 고칠 때는 JSX 의 height 도 같이 고쳐야 한다.
const H_HEADER = 110; // 제목 + 기간
const H_TEACHER = 50; // 선생님 이름 줄 (위 여백 포함)
const H_THEAD = 38; // 표 머리
const H_ROW = 46; // 표 한 줄
const H_GROUP_GAP = 14; // 선생님 묶음 사이
const H_TOTAL = 52; // 합계 줄
const BOX_PAD = 28; // 미제출 상자 위아래 여백
const H_MISS_HEAD = 36; // 미제출 제목
const H_MISS_LABEL = 30; // '반 · 선생님 · n명'
const H_MISS_LINE = 34; // 이름 한 줄
const H_MISS_GAP = 10; // 반 사이
const H_NOTE = 32; // 맨 아래 안내
const H_BOX_TOP = 12; // 미제출 상자 위 여백

// 그림에 들어가는 고정 문구. 여기 있는 글자로 글꼴을 받으므로, 문구를
// 고치면 글꼴 요청도 자동으로 따라간다. JSX 에 글자를 직접 쓰면 그 글자만
// 다른 글꼴로 떨어져 굵기가 들쭉날쭉해진다.
const T = {
  title: "유스피킹 주간 운영 요약",
  none: "운영 중인 반이 없어요.",
  teacherSuffix: " 선생님",
  colName: "반",
  colCreated: "과제",
  colRate: "제출율",
  colScore: "평균점수",
  colSec: "평균녹음",
  allSubmitted: "지난주 모든 학생이 한 번 이상 제출했어요",
  missingHead: "지난주 한 건도 제출하지 않은 학생",
  note: "평균 녹음 시간은 이 기능을 켠 뒤 들어온 제출물부터 집계돼요.",
  total: "합계 과제 개 제출율 명",
  unit: "명분초—·()/%0123456789",
} as const;

function visibleClasses(sum: WeeklySummary) {
  return sum.classes.filter((c) => c.students > 0);
}

function groupByTeacher(rows: ClassWeek[]) {
  const m = new Map<string, ClassWeek[]>();
  for (const c of rows)
    m.set(c.teacherName, [...(m.get(c.teacherName) ?? []), c]);
  return Array.from(m.entries());
}

// 미제출 명단은 한 줄에 이만큼씩 끊어 적는다 (이름이 길어도 넘치지 않게)
function missingLines(c: ClassWeek): string[] {
  const per = 8;
  const out: string[] = [];
  for (let i = 0; i < c.missing.length; i += per) {
    out.push(c.missing.slice(i, i + per).join(", "));
  }
  return out;
}

function measure(sum: WeeklySummary): number {
  const rows = visibleClasses(sum);
  if (rows.length === 0) return PAD * 2 + H_HEADER + 60;

  let h = PAD * 2 + H_HEADER;
  for (const [, list] of groupByTeacher(rows)) {
    h += H_TEACHER + H_THEAD + list.length * H_ROW + H_GROUP_GAP;
  }
  if (rows.length > 1) h += H_TOTAL;

  const missing = rows.filter((c) => c.missing.length > 0);
  h += H_BOX_TOP + BOX_PAD + H_MISS_HEAD;
  for (const c of missing) {
    h += H_MISS_GAP + H_MISS_LABEL + missingLines(c).length * H_MISS_LINE;
  }
  if (sum.noDurationYet) h += H_NOTE;
  return h;
}

// 표 열 너비 (합이 W - PAD*2 = 920)
const COL = { name: 300, created: 110, rate: 230, score: 130, sec: 150 };

export async function renderWeeklyImage(
  sum: WeeklySummary,
): Promise<ArrayBuffer> {
  const rows = visibleClasses(sum);
  const groups = groupByTeacher(rows);
  const missing = rows.filter((c) => c.missing.length > 0);
  const missingTotal = missing.reduce((t, c) => t + c.missing.length, 0);

  const students = rows.reduce((t, c) => t + c.students, 0);
  const submitted = rows.reduce((t, c) => t + c.submitted, 0);
  const created = rows.reduce((t, c) => t + c.created, 0);
  const totalRate = students ? Math.round((submitted / students) * 100) : 0;

  const height = measure(sum);

  // 그림에 들어갈 모든 글자를 모아 그 글자만 든 글꼴을 받는다.
  // 고정 문구는 T 에서, 바뀌는 값은 자료에서 그대로 가져온다.
  const allText =
    Object.values(T).join("") +
    sum.range +
    rows
      .map((c) => `${c.className}${c.teacherName}${c.missing.join("")}`)
      .join("");

  const [regular, bold] = await Promise.all([
    loadKoreanFont(allText, 400),
    loadKoreanFont(allText, 700),
  ]);

  const cell = (
    text: string,
    width: number,
    opts: {
      align?: "left" | "right";
      color?: string;
      bold?: boolean;
      size?: number;
    } = {},
  ) => (
    <div
      style={{
        display: "flex",
        width,
        justifyContent: opts.align === "right" ? "flex-end" : "flex-start",
        color: opts.color ?? INK,
        fontWeight: opts.bold ? 700 : 400,
        fontSize: opts.size ?? 26,
      }}
    >
      {text}
    </div>
  );

  return new ImageResponse(
    <div
      style={{
        width: W,
        height,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#ffffff",
        padding: PAD,
        fontFamily: "Noto",
      }}
    >
      {/* 머리말 */}
      <div
        style={{ display: "flex", flexDirection: "column", height: H_HEADER }}
      >
        <div
          style={{
            display: "flex",
            height: 62,
            alignItems: "center",
            fontSize: 38,
            fontWeight: 700,
            color: INK,
          }}
        >
          {T.title}
        </div>
        <div
          style={{
            display: "flex",
            height: 48,
            alignItems: "center",
            fontSize: 24,
            color: MUTE,
          }}
        >
          {sum.range}
        </div>
      </div>

      {rows.length === 0 ? (
        <div
          style={{ display: "flex", marginTop: 40, fontSize: 26, color: MUTE }}
        >
          {T.none}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {groups.map(([teacher, list]) => (
            <div
              key={teacher}
              style={{
                display: "flex",
                flexDirection: "column",
                marginBottom: H_GROUP_GAP,
              }}
            >
              <div
                style={{
                  display: "flex",
                  height: H_TEACHER,
                  alignItems: "center",
                  fontSize: 28,
                  fontWeight: 700,
                  color: BRAND,
                }}
              >
                {teacher}
                {T.teacherSuffix}
              </div>
              {/* 표 머리 */}
              <div
                style={{
                  display: "flex",
                  height: H_THEAD,
                  alignItems: "center",
                  borderBottom: `2px solid ${LINE}`,
                }}
              >
                {cell(T.colName, COL.name, { color: MUTE, size: 22 })}
                {cell(T.colCreated, COL.created, {
                  align: "right",
                  color: MUTE,
                  size: 22,
                })}
                {cell(T.colRate, COL.rate, {
                  align: "right",
                  color: MUTE,
                  size: 22,
                })}
                {cell(T.colScore, COL.score, {
                  align: "right",
                  color: MUTE,
                  size: 22,
                })}
                {cell(T.colSec, COL.sec, {
                  align: "right",
                  color: MUTE,
                  size: 22,
                })}
              </div>
              {list.map((c) => (
                <div
                  key={c.classId}
                  style={{
                    display: "flex",
                    height: H_ROW,
                    alignItems: "center",
                    borderBottom: `1px solid ${LINE}`,
                  }}
                >
                  {cell(c.className, COL.name, { bold: true })}
                  {cell(String(c.created), COL.created, { align: "right" })}
                  {cell(
                    c.rate == null
                      ? "—"
                      : `${c.rate}% (${c.submitted}/${c.students})`,
                    COL.rate,
                    {
                      align: "right",
                      // 절반도 안 내면 눈에 띄어야 한다
                      color: c.rate != null && c.rate < 50 ? WARN : INK,
                      bold: c.rate != null && c.rate < 50,
                    },
                  )}
                  {cell(
                    c.avgScore == null ? "—" : String(c.avgScore),
                    COL.score,
                    {
                      align: "right",
                      color: c.avgScore == null ? MUTE : INK,
                    },
                  )}
                  {cell(mmss(c.avgSeconds), COL.sec, {
                    align: "right",
                    color: c.avgSeconds == null ? MUTE : INK,
                  })}
                </div>
              ))}
            </div>
          ))}

          {rows.length > 1 && (
            <div
              style={{
                display: "flex",
                height: H_TOTAL,
                alignItems: "center",
                fontSize: 24,
                color: INK,
              }}
            >
              {`합계 — 과제 ${created}개 · 제출율 ${totalRate}% (${submitted}/${students}명)`}
            </div>
          )}

          {/* 미제출 명단 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: H_BOX_TOP,
              padding: `${BOX_PAD / 2}px 18px`,
              borderRadius: 14,
              backgroundColor: missing.length ? WARN_BG : "#f8fafc",
            }}
          >
            <div
              style={{
                display: "flex",
                height: H_MISS_HEAD,
                alignItems: "center",
                fontSize: 25,
                fontWeight: 700,
                color: missing.length ? WARN : MUTE,
              }}
            >
              {missing.length
                ? `${T.missingHead} ${missingTotal}명`
                : T.allSubmitted}
            </div>
            {missing.map((c) => (
              <div
                key={c.classId}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  marginTop: H_MISS_GAP,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    height: H_MISS_LABEL,
                    alignItems: "center",
                    fontSize: 22,
                    color: MUTE,
                  }}
                >
                  {`${c.className} · ${c.teacherName} · ${c.missing.length}명`}
                </div>
                {missingLines(c).map((line, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      height: H_MISS_LINE,
                      alignItems: "center",
                      fontSize: 24,
                      color: INK,
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {sum.noDurationYet && (
            <div
              style={{
                display: "flex",
                height: H_NOTE,
                alignItems: "center",
                fontSize: 21,
                color: MUTE,
              }}
            >
              {T.note}
            </div>
          )}
        </div>
      )}
    </div>,
    {
      width: W,
      height,
      fonts: [
        { name: "Noto", data: regular, weight: 400, style: "normal" },
        { name: "Noto", data: bold, weight: 700, style: "normal" },
      ],
    },
  ).arrayBuffer();
}
