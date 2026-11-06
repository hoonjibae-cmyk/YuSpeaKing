import { randomBytes } from "crypto";

// 반 코드 (학생 로그인용). 헷갈리는 글자(0/O, 1/I) 를 뺀 6자리.
// 선생님이 반을 만들 때와 Student Card 에서 반을 받아 만들 때가 같이 쓴다.
export function generateClassCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}
