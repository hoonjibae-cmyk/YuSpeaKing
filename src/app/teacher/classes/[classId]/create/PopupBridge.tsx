'use client';
import {useEffect} from 'react';
export default function PopupBridge({classId}:{classId:string}){
 useEffect(()=>{window.parent.postMessage({type:'maeil-speaking-popup-ready',classId},'https://learning.yussam.com');},[classId]);
 return null;
}
