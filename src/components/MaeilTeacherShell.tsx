"use client";
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
export default function MaeilTeacherShell({app}:{app:'speaking'|'voca'}){
 const path=usePathname(),[active,setActive]=useState(false);
 useEffect(()=>{const enabled=document.cookie.split('; ').includes('maeil_teacher_ui=1')&&(app==='speaking'?path.startsWith('/teacher')&&!path.startsWith('/teacher/login'):(/^\/(admin|reports)(\/|$)/.test(path)));setActive(enabled);if(enabled)document.documentElement.dataset.maeilTeacher=app;else delete document.documentElement.dataset.maeilTeacher;
 if(enabled&&location.hash==='#maeil-create'){const form=document.getElementById('maeil-create');if(form instanceof HTMLDetailsElement){form.open=true;form.scrollIntoView({block:'start'});}}
 return ()=>{delete document.documentElement.dataset.maeilTeacher;};},[path,app]);
 if(!active)return null;
 const portal='https://learning.yussam.com';
 return <header className="maeil-teacher-shell"><div className="maeil-teacher-bar"><a className="maeil-teacher-brand" href={portal+'/teacher'}><img src="/maeil-crown.svg" alt="목동유쌤영어 왕관" width="34" height="34"/><strong>매일 러닝<small>교사용 · {app==='speaking'?'유스피킹':'하루보카'}</small></strong></a><nav aria-label="교사용 학습 메뉴"><a href={portal+'/teacher'}>대시보드</a><a aria-current={app==='speaking'?'page':undefined} href={portal+'/teacher/go/speaking?target='+encodeURIComponent('/teacher')}>유스피킹</a><a aria-current={app==='voca'?'page':undefined} href={portal+'/teacher/go/voca?target='+encodeURIComponent('/admin/classes')}>하루보카</a><a href={portal+'/teacher/review'}>하루리뷰</a><a href={portal+'/teacher/settings'}>반 설정</a><a href={portal+'/teacher/reports'}>리포트</a><a href={portal+'/teacher/coupons'}>쿠폰</a></nav></div><div className="maeil-teacher-context"><span>과제 만들기 · 확인 · 학습 현황</span><a href={portal+'/teacher'}>매일 러닝에서 과제 확인 →</a></div></header>;
}
