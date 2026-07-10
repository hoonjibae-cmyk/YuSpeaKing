import { redirect } from "next/navigation";

// 이전 명단 선택 방식은 PIN 로그인으로 대체됨.
export default function StudentSelectRedirectPage() {
  redirect("/student");
}
