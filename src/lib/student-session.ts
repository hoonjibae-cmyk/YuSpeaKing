import "server-only";
import { createHmac, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { StudentSession } from "./types";

const COOKIE_NAME = "yus_student";
const PENDING_COOKIE = "yus_pending";
const MAX_AGE = 60 * 60 * 12; // 12시간
const PENDING_MAX_AGE = 60 * 10; // 10분 (PIN 입력 단계용)

function secret() {
  const s = process.env.STUDENT_SESSION_SECRET;
  if (!s) throw new Error("STUDENT_SESSION_SECRET 가 설정되지 않았습니다.");
  return new TextEncoder().encode(s);
}

// ---------- 비밀번호 해시 (scrypt + 랜덤 salt) ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = scryptSync(password, salt, expected.length);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
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
      number: payload.number == null ? null : Number(payload.number),
    };
  } catch {
    return null;
  }
}

export function clearStudentSession() {
  cookies().delete(COOKIE_NAME);
}

// ---------- PIN 해시 ----------

// 4자리 PIN 을 학생ID 를 salt 로 한 HMAC 으로 해시 (평문 저장 방지)
export function hashPin(studentId: string, pin: string): string {
  const s = process.env.STUDENT_SESSION_SECRET || "";
  return createHmac("sha256", s).update(`${studentId}:${pin}`).digest("hex");
}

// ---------- PIN 입력 단계용 임시(pending) 세션 ----------

export interface PendingStudent extends StudentSession {
  pinSet: boolean; // 이미 PIN 이 설정된 학생인지
}

export async function setPendingStudent(p: PendingStudent) {
  const token = await new SignJWT({ ...p })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_MAX_AGE}s`)
    .sign(secret());
  cookies().set(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_MAX_AGE,
  });
}

export async function getPendingStudent(): Promise<PendingStudent | null> {
  const token = cookies().get(PENDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      studentId: String(payload.studentId),
      classId: String(payload.classId),
      name: String(payload.name),
      number: Number(payload.number),
      pinSet: Boolean(payload.pinSet),
    };
  } catch {
    return null;
  }
}

export function clearPendingStudent() {
  cookies().delete(PENDING_COOKIE);
}
