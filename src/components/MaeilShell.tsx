"use client";
import {useEffect,useState} from 'react';import {usePathname} from 'next/navigation';
const PORTAL='https://learning.yussam.com';
export default function MaeilShell({app,initialEnabled=false}:{app:'speaking'|'voca';initialEnabled?:boolean}){
 const [embedded,setEmbedded]=useState(false);
 useEffect(()=>{setEmbedded(window.self!==window.top);},[]);
 const path=usePathname(),studentRoute=!/^\/(admin|teacher|login|guide|account)(\/|$)/.test(path),[enabled,setEnabled]=useState(initialEnabled);
 useEffect(()=>{const active=studentRoute&&document.cookie.split('; ').includes('maeil_ui=1');setEnabled(active);if(active){document.documentElement.dataset.maeilApp=app;document.title="소리 내어 읽기 · 매일 러닝";}else delete document.documentElement.dataset.maeilApp;return()=>{delete document.documentElement.dataset.maeilApp;};},[path,studentRoute,app]);
 if(!enabled)return null;return <><header className="maeil-shell"><a target={embedded?'_top':undefined} className="maeil-identity" href={PORTAL+'/portal'} aria-label="매일 러닝 학습 홈"><img src="/maeil-crown.svg" alt="목동유쌤영어 왕관"/><span><strong>매일 러닝</strong><small>MY DAILY LEARNING</small></span></a><nav className="maeil-primary-nav" aria-label="주 메뉴"><a target={embedded?'_top':undefined} href={PORTAL+'/portal'}>나의 학습</a><a target={embedded?'_top':undefined} href={PORTAL+'/reports'}>주간 리포트</a><a target={embedded?'_top':undefined} href={PORTAL+'/coupons'}>쿠폰함</a></nav><a target={embedded?'_top':undefined} className="maeil-guide" href={PORTAL+'/guide'}>사용법</a></header><div className="maeil-context"><strong>{app==='speaking'?'소리 내어 읽기':'오늘의 단어'}</strong><a target={embedded?'_top':undefined} href={PORTAL+'/portal'}>← 나의 학습</a></div></>;
}
