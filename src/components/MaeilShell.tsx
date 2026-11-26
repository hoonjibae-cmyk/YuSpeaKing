"use client";
import {useEffect,useState} from 'react';import {usePathname} from 'next/navigation';
const PORTAL='https://learning.yussam.com';
export default function MaeilShell({app,initialEnabled=false}:{app:'speaking'|'voca';initialEnabled?:boolean}){
 const [programs,setPrograms]=useState<string[]>([app]);
 useEffect(()=>{const value=document.cookie.split('; ').find(c=>c.startsWith('maeil_programs='))?.split('=')[1]||'';const allowed=value.split('.').filter(p=>['speaking','voca','review'].includes(p));setPrograms(allowed.includes(app)?allowed:[app]);},[app]);
 const [embedded,setEmbedded]=useState(false);
 useEffect(()=>{setEmbedded(window.self!==window.top);},[]);
 const path=usePathname(),studentRoute=!/^\/(admin|teacher|login|guide|account)(\/|$)/.test(path),[enabled,setEnabled]=useState(initialEnabled);
 useEffect(()=>{const active=studentRoute&&document.cookie.split('; ').includes('maeil_ui=1');setEnabled(active);if(active){document.documentElement.dataset.maeilApp=app;document.title="소리 내어 읽기 · 매일 러닝";}else delete document.documentElement.dataset.maeilApp;return()=>{delete document.documentElement.dataset.maeilApp;};},[path,studentRoute,app]);
 if(!enabled)return null;return <><header className="maeil-shell program-header"><a target={embedded?'_top':undefined} className="maeil-identity" href={PORTAL+'/portal'} aria-label="매일 러닝 학습 홈"><img src="/maeil-crown.svg" alt="목동유쌤영어 왕관"/><span><strong>매일 러닝</strong><small>MY DAILY LEARNING</small></span></a><nav className="maeil-program-switcher" aria-label="학습 프로그램">{(['speaking','voca','review'] as const).filter(id=>programs.includes(id)).map(id=>id===app?<span key={id} aria-current="page">{{speaking:'유스피킹',voca:'하루보카',review:'하루리뷰'}[id]}</span>:<a key={id} target={embedded?'_top':undefined} href={PORTAL+'/go/'+id}>{{speaking:'유스피킹',voca:'하루보카',review:'하루리뷰'}[id]}</a>)}</nav><nav className="maeil-primary-nav" aria-label="유스피킹 메뉴"><a href="/student/home" aria-current={path==='/student/home'||path.startsWith('/student/assignments/')?'page':undefined}>과제</a><a href="/student/history" aria-current={path.startsWith('/student/history')?'page':undefined}>내 기록</a></nav><a target={embedded?'_top':undefined} className="maeil-guide" href={PORTAL+'/guide'}>사용법</a></header><div className="maeil-context"><a target={embedded?'_top':undefined} href={PORTAL+'/portal'}>← 매일 러닝으로</a></div></>;
}
