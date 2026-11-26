"use client";
import {useEffect,useState} from 'react';import {usePathname} from 'next/navigation';
const PORTAL='https://learning.yussam.com';
export default function MaeilShell({app,initialEnabled=false}:{app:'speaking'|'voca';initialEnabled?:boolean}){
 const [embedded,setEmbedded]=useState(false);
 useEffect(()=>{setEmbedded(window.self!==window.top);},[]);
 const path=usePathname(),studentRoute=!/^\/(admin|teacher|login|guide|account)(\/|$)/.test(path),[enabled,setEnabled]=useState(initialEnabled);
 useEffect(()=>{const active=studentRoute&&document.cookie.split('; ').includes('maeil_ui=1');setEnabled(active);if(active){document.documentElement.dataset.maeilApp=app;document.title="소리 내어 읽기 · 매일 러닝";}else delete document.documentElement.dataset.maeilApp;return()=>{delete document.documentElement.dataset.maeilApp;};},[path,studentRoute,app]);
 if(!enabled)return null;return <><header className="maeil-shell"><a target={embedded?'_top':undefined} className="maeil-identity" href={PORTAL+'/portal'} aria-label="매일 러닝 학습 홈"><img src="/maeil-crown.svg" alt="목동유쌤영어 왕관"/><span><strong>매일 러닝</strong><small>MY DAILY LEARNING</small></span></a><span className="maeil-program-name">{app==='speaking'?'유스피킹':'하루보카'}</span><nav className="maeil-primary-nav" aria-label="유스피킹 메뉴"><a href="/student/home" aria-current={path==='/student/home'||path.startsWith('/student/assignments/')?'page':undefined}>과제</a><a href="/student/history" aria-current={path.startsWith('/student/history')?'page':undefined}>내 기록</a></nav><a target={embedded?'_top':undefined} className="maeil-guide" href={PORTAL+'/guide'}>사용법</a></header><div className="maeil-context"><strong>{app==='speaking'?'소리 내어 읽기':'오늘의 단어'}</strong><a target={embedded?'_top':undefined} href={PORTAL+'/portal'}>← 나의 학습</a></div></>;
}
