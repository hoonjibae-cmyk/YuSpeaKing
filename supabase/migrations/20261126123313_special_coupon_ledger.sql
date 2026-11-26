create table public.special_coupon_events (
 id uuid primary key, student_id uuid not null references public.students(id),
 class_id uuid not null references public.classes(id), teacher_id uuid not null references public.teachers(id),
 amount integer not null check(amount between -20 and 20 and amount<>0),
 reason text not null check(length(btrim(reason)) between 1 and 100),
 created_at timestamptz not null default now()
);
create index special_coupon_student_time on public.special_coupon_events(student_id,created_at desc);
alter table public.special_coupon_events enable row level security;
revoke all on public.special_coupon_events from public,anon,authenticated;
grant select,insert on public.special_coupon_events to service_role;
create function public.grant_special_coupon(p_teacher uuid,p_class uuid,p_student uuid,p_amount integer,p_reason text,p_request uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare current_bonus integer; previous public.special_coupon_events%rowtype;
begin
 if p_amount is null or p_amount=0 or abs(p_amount)>20 or p_reason is null or length(btrim(p_reason)) not between 1 and 100 or p_request is null then raise exception 'INVALID_COUPON'; end if;
 if not exists(select 1 from public.teachers t join public.classes c on c.id=p_class where t.id=p_teacher and (t.status='approved' or t.role='admin') and (c.teacher_id=t.id or t.role='admin' or exists(select 1 from public.class_coteachers co where co.class_id=c.id and co.teacher_id=t.id and (co.role='coupon' or co.starts_on<=(now() at time zone 'Asia/Seoul')::date and co.ends_on>=(now() at time zone 'Asia/Seoul')::date)))) then raise exception 'COUPON_ACCESS_DENIED'; end if;
 select coalesce(bonus_coupons,0) into current_bonus from public.students where id=p_student and class_id=p_class and status='approved' for update;
 if not found then raise exception 'STUDENT_NOT_FOUND'; end if;
 select * into previous from public.special_coupon_events where id=p_request;
 if found then
  if previous.student_id<>p_student or previous.teacher_id<>p_teacher or previous.amount<>p_amount or previous.reason<>btrim(p_reason) then raise exception 'REQUEST_CONFLICT'; end if;
  return current_bonus;
 end if;
 if current_bonus+p_amount<0 then raise exception 'INSUFFICIENT_SPECIAL_COUPONS'; end if;
 insert into public.special_coupon_events(id,student_id,class_id,teacher_id,amount,reason) values(p_request,p_student,p_class,p_teacher,p_amount,btrim(p_reason));
 update public.students set bonus_coupons=current_bonus+p_amount where id=p_student;
 return current_bonus+p_amount;
end $$;
revoke all on function public.grant_special_coupon(uuid,uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.grant_special_coupon(uuid,uuid,uuid,integer,text,uuid) to service_role;
