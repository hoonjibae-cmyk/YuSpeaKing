-- The route validates HR supervisor access and passes only its authorized class IDs.
-- One aggregate query replaces the former per-class student/task/submission requests.
create function public.maeil_directory_metrics(p_classes uuid[],p_week date)
returns jsonb language sql stable security invoker set search_path='' as $$
 with allowed as (
  select c.id from public.classes c where c.id=any(p_classes) and c.archived_at is null
 ), members as (
  select distinct s.class_id,s.id from public.students s join allowed c on c.id=s.class_id where s.status='approved'
 ), tasks as (
  select a.id,a.class_id from public.assignments a join allowed c on c.id=a.class_id
  where (a.created_at>=p_week::timestamp at time zone 'Asia/Seoul' and a.created_at<(p_week+7)::timestamp at time zone 'Asia/Seoul')
   or (a.due_date>=p_week and a.due_date<p_week+7)
 ), submitted as (
  select distinct on (a.id,m.id) a.class_id,a.id assignment_id,m.id student_id,s.status,s.overall_score
  from tasks a join members m on m.class_id=a.class_id
  join public.submissions s on s.assignment_id=a.id and s.student_id=m.id
  where s.status in ('submitted','evaluating','evaluated')
  order by a.id,m.id,s.updated_at desc,s.id desc
 ) select coalesce(jsonb_agg(jsonb_build_object(
  'classId',c.id,'studentCount',(select count(*) from members m where m.class_id=c.id),
  'taskCount',(select count(*) from tasks a where a.class_id=c.id),
  'expectedCount',(select count(*) from tasks a join members m on m.class_id=a.class_id where a.class_id=c.id),
  'completedCount',(select count(*) from submitted s where s.class_id=c.id),
  'averageScore',(select avg(s.overall_score) from submitted s where s.class_id=c.id and s.status='evaluated')
 )), '[]'::jsonb) from allowed c;
$$;
revoke all on function public.maeil_directory_metrics(uuid[],date) from public,anon,authenticated;
grant execute on function public.maeil_directory_metrics(uuid[],date) to service_role;
