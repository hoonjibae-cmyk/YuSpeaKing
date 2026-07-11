import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <main className="relative w-full overflow-hidden">
      {/* ===== 모바일(세로): 이미지 전체 표시 + 하단 버튼 띠 ===== */}
      <div className="flex min-h-[100dvh] flex-col bg-[#5ba2fc] md:hidden">
        <div className="relative flex-1">
          <Image
            src="/hero-mobile.png"
            alt="유스피킹 · 목동유쌤영어"
            fill
            priority
            sizes="100vw"
            className="object-contain object-top"
          />
        </div>
        <div className="flex gap-3 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          <Link
            href="/student"
            className="flex-1 rounded-2xl bg-brand px-6 py-4 text-center text-lg font-bold text-white shadow-lg shadow-brand-dark/30 transition hover:bg-brand-dark"
          >
            🎙️ 학생 입장
          </Link>
          <Link
            href="/teacher"
            className="flex-1 rounded-2xl bg-white px-6 py-4 text-center text-lg font-bold text-brand shadow-lg transition hover:bg-brand-light"
          >
            🧑‍🏫 선생님
          </Link>
        </div>
      </div>

      {/* ===== 데스크톱(가로): 이미지 꽉 채우고 버튼 오버레이 ===== */}
      <div className="relative hidden min-h-[100dvh] bg-[#eaf1fb] md:block">
        <Image
          src="/hero-desktop.png"
          alt="유스피킹 · 목동유쌤영어"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/85 via-white/40 to-transparent px-5 pb-8 pt-20">
          <div className="ml-[7vw] flex justify-start gap-3">
            <Link
              href="/student"
              className="rounded-2xl bg-brand px-12 py-4 text-center text-lg font-bold text-white shadow-lg shadow-brand/30 transition hover:bg-brand-dark"
            >
              🎙️ 학생 입장
            </Link>
            <Link
              href="/teacher"
              className="rounded-2xl border border-brand/20 bg-white px-12 py-4 text-center text-lg font-bold text-brand shadow-lg transition hover:bg-brand-light"
            >
              🧑‍🏫 선생님
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
