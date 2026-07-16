import { redirect } from "next/navigation";

// PIN 로그인은 아이디/비밀번호 방식으로 대체됨.
export default function StudentPinRedirectPage() {
  redirect("/student");
}
