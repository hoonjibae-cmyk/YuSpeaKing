"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
const PORTAL = "https://yussam-learning-portal.vercel.app";

/** Presentation only. Authentication is checked separately on the server. */
export default function MaeilShell({ app }: { app: "speaking" | "voca" }) {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const studentRoute = !/^\/(admin|teacher|login|guide|account)(\/|$)/.test(pathname);
  useEffect(() => {
    const active = studentRoute && document.cookie.split("; ").includes("maeil_ui=1");
    setEnabled(active);
    if (active) document.documentElement.dataset.maeilApp = app;
    else delete document.documentElement.dataset.maeilApp;
    return () => { delete document.documentElement.dataset.maeilApp; };
  }, [pathname, studentRoute, app]);
  if (!enabled) return null;
  function leave() {
    document.cookie = "maeil_ui=; Path=/; Max-Age=0; Secure; SameSite=Lax";
    delete document.documentElement.dataset.maeilApp;
    setEnabled(false);
  }
  return <header className="maeil-shell">
    <a className="maeil-identity" href={PORTAL + "/portal"} aria-label="매일 러닝 학습 홈"><span className="maeil-symbol" aria-hidden="true">매</span><span><strong>매일 러닝</strong><small>{app === "speaking" ? "유스피킹 · 소리 내어 배우기" : "하루보카 · 매일 단어 쌓기"}</small></span></a>
    <details className="maeil-menu" key={pathname}><summary>학습 메뉴 <span aria-hidden="true">⌄</span></summary><nav aria-label="매일 러닝 프로그램">
      <a href={PORTAL + "/portal"}>⌂ <span>오늘의 학습</span></a>
      <a href={PORTAL + "/go/speaking"} aria-current={app === "speaking" ? "page" : undefined}>◉ <span>유스피킹</span></a>
      <a href={PORTAL + "/go/voca"} aria-current={app === "voca" ? "page" : undefined}>▣ <span>하루보카</span></a>
      <a href={PORTAL + "/go/review"}>✦ <span>하루리뷰</span></a>
      <a href={PORTAL + "/reports"}>▤ <span>나의 리포트</span></a>
      <button type="button" onClick={leave}>기존 앱 화면으로 보기</button>
    </nav></details>
  </header>;
}
