import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <main className="relative min-h-[100dvh] w-full overflow-hidden bg-[#eaf1fb]">
      {/* 모바일(세로) 히어로 */}
      <Image
        src="/hero-mobile.png"
        alt="유스피킹 · 목동유쌤영어"
        fill
        priority
        sizes="100vw"
        className="object-cover object-top md:hidden"
      />
      {/* 데스크톱(가로) 히어로 */}
      <Image
        src="/hero-desktop.png"
        alt="유스피킹 · 목동유쌤영어"
        fill
        priority
        sizes="100vw"
        className="hidden object-cover object-center md:block"
      />

      {/* 진입 버튼 오버레이 */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/85 via-white/40 to-transparent px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-20">
        <div className="mx-auto flex w-full max-w-md gap-3 md:mx-0 md:ml-[7vw] md:max-w-none md:justify-start">
          <Link
            href="/student"
            className="flex-1 rounded-2xl bg-brand px-6 py-4 text-center text-lg font-bold text-white shadow-lg shadow-brand/30 transition hover:bg-brand-dark md:flex-none md:px-12"
          >
            🎙️ 학생 입장
          </Link>
          <Link
            href="/teacher"
            className="flex-1 rounded-2xl border border-brand/20 bg-white px-6 py-4 text-center text-lg font-bold text-brand shadow-lg transition hover:bg-brand-light md:flex-none md:px-12"
          >
            🧑‍🏫 선생님
          </Link>
        </div>
      </div>
    </main>
  );
}
