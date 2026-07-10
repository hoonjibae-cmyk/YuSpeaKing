import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// 교사 인증 가드: 로그인 안 되어 있으면 로그인 페이지로.
export async function requireTeacher() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/teacher/login");
  return user;
}

// 로그인 여부만 조회 (리다이렉트 없음)
export async function getTeacher() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// 로그인한 교사의 role 조회 ('teacher' | 'admin')
export async function getRole(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "teacher";
  const { data } = await supabase
    .from("teachers")
    .select("role")
    .eq("id", user.id)
    .single();
  return data?.role ?? "teacher";
}

// 운영자(admin) 전용 가드
export async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teacher/login");
  const { data } = await supabase
    .from("teachers")
    .select("role")
    .eq("id", user.id)
    .single();
  if (data?.role !== "admin") redirect("/teacher");
  return user;
}
