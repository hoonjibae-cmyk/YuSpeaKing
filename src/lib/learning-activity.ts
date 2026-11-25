// Calendar records use the actual activity time in Korea, never the assignment date.
export function activityWeek(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('INVALID_WEEK');const start=new Date(value+'T00:00:00+09:00');
 if(Number.isNaN(start.getTime())||new Date(start.getTime()+32400000).toISOString().slice(0,10)!==value||new Date(start.getTime()+32400000).getUTCDay()!==1)throw Error('INVALID_WEEK');
 return {from:start.toISOString(),to:new Date(start.getTime()+604800000).toISOString()};
}
export function activityMarks(rows:Array<{time:string|null;completed:boolean}>,week?:string){
 const days=new Map<string,'progress'|'completed'>();for(const row of rows){if(!row.time)continue;const d=new Date(row.time);if(Number.isNaN(d.getTime()))continue;const date=new Date(d.getTime()+32400000).toISOString().slice(0,10);if(week&&(date<week||d.getTime()>=new Date(activityWeek(week).to).getTime()))continue;if(row.completed||!days.has(date))days.set(date,row.completed?'completed':'progress');}
 return Array.from(days).map(([date,state])=>({date,state}));
}

export async function activityPages<Row>(query:(from:number,to:number)=>PromiseLike<{data:Row[]|null;error:unknown;count?:number|null}>){const rows:Row[]=[];for(;;){const r=await query(rows.length,rows.length+499);if(r.error||!r.data)throw Error('ACTIVITY_READ_FAILED');if(!r.data.length){if(r.count!=null&&rows.length<r.count)throw Error('INCOMPLETE_ACTIVITY');return rows;}rows.push(...r.data);if(r.count!=null&&rows.length>=r.count)return rows;if(rows.length>50000)throw Error('TOO_MANY_ACTIVITIES');}}
