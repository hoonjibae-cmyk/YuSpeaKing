alter table public.app_settings add column if not exists coupon_goal integer check(coupon_goal between 1 and 100);
alter table public.app_settings add column if not exists coupon_reward_text text check(length(coupon_reward_text)<=500);
-- No existing balance or individual goal changes until an administrator saves the global form.
create or replace function public.apply_global_coupon_defaults() returns trigger
language plpgsql security definer set search_path='' as $$
declare setting record;
begin
 select coupon_goal,coupon_reward_text into setting from public.app_settings where id=1;
 if setting.coupon_goal is not null then new.coupon_goal:=setting.coupon_goal;new.coupon_reward_text:=setting.coupon_reward_text;end if;
 return new;
end $$;
create or replace trigger global_coupon_defaults before insert or update of coupon_goal,coupon_reward_text on public.teachers
 for each row execute function public.apply_global_coupon_defaults();
create or replace function public.save_global_coupon_settings(p_goal integer,p_reward text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_goal is null or p_goal<1 or p_goal>100 or p_reward is null or length(p_reward)>500 then raise exception 'INVALID';end if;
 update public.app_settings set coupon_goal=p_goal,coupon_reward_text=btrim(p_reward),updated_at=now() where id=1;
 if not found then raise exception 'SETTINGS_MISSING';end if;
 update public.teachers set coupon_goal=p_goal,coupon_reward_text=btrim(p_reward);
 return true;
end $$;
revoke all on function public.save_global_coupon_settings(integer,text) from public,anon,authenticated;
grant execute on function public.save_global_coupon_settings(integer,text) to service_role;
revoke all on function public.apply_global_coupon_defaults() from public,anon,authenticated;

