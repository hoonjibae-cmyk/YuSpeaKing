import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { StudentSession } from "./types";

const COOKIE_NAME = "yus_student";
const MAX_AGE = 60 * 60 * 12; // 12시간

function secret() {
  const s = process.env.STUDENT_SESSION_SECRET;
  if (!s) throw new Error("STUDENT_SESSION_SECRET 가 설정되지 않았습니다.");
  return new TextEncoder().encode(s);
}

// 학생 세션 발급 → httpOnly 쿠키 설정
export async function setStudentSession(session: StudentSession) {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

// 현재 학생 세션 조회 (없거나 검증 실패 시 null)
export async function getStudentSession(): Promise<StudentSession | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      studentId: String(payload.studentId),
      classId: String(payload.classId),
      name: String(payload.name),
      number: Number(payload.number),
    };
  } catch {
    return null;
  }
}

export function clearStudentSession() {
  cookies().delete(COOKIE_NAME);
}
