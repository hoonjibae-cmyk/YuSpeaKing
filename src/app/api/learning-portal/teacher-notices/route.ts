import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendPushToStudents } from '@/lib/push';
import { appOrigin } from '@/lib/app-url';

export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
type Notice = { id: string; author_id: string; scope: string; class_id: string | null; title: string; body: string; pinned: boolean; created_at?: string };

// Maeil owns the management screen. This authenticated adapter preserves the
// existing notice history, student read state and device subscriptions.
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 65536) fail('공지 내용이 너무 깁니다.', 413);
    const input = JSON.parse(raw);
    if (!input || typeof input.proof !== 'string' || !input.proof || input.proof.length > 4096) fail('교사용 로그인을 확인해 주세요.', 401);
    if (!['list', 'preview', 'audience', 'create', 'delete'].includes(input.intent)) fail('공지 요청을 확인해 주세요.');
    const check = await fetch('https://portal.yussam.com/api/learning-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proof: input.proof }),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!check.ok) fail('교사용 로그인을 확인해 주세요.', 401);
    const identity = await check.json();
    if (identity.allowed !== true || typeof identity.email !== 'string' || !identity.email.trim()) fail('공지 접근 권한이 없습니다.', 403);
    if (identity.viewOnly && input.intent !== 'list') fail('선생님 화면 조회 중에는 공지를 등록하거나 삭제할 수 없습니다.', 403);
    const db = createAdminClient();
    const teachers = await db.from('teachers').select('id,email,slack_email,status,role,name', { count: 'exact' }).limit(2000);
    if (teachers.error || !teachers.data || teachers.count !== null && teachers.count > teachers.data.length) fail('교사 정보를 불러오지 못했습니다.', 503);
    const matches = teachers.data.filter(t => (t.status === 'approved' || t.role === 'admin') && [t.email, t.slack_email].some(v => v?.trim().toLowerCase() === identity.email.trim().toLowerCase()));
    if (matches.length === 0 && input.intent === 'list') return NextResponse.json({ classes: [], notices: [], canCreate: false, canSendAll: false, message: '현재 계정에 연결된 공지 발송 반이 없습니다.' }, { headers });
    if (matches.length !== 1) fail('교사 계정 연결을 확인해 주세요.', 403);
    const teacher = matches[0];
    const admin = !identity.viewOnly && (identity.supervisor === true || identity.department === '경영지원' && teacher.role === 'admin');
    const overview = !identity.viewOnly && (admin || identity.supervisor === true);
    const canCreate = !identity.viewOnly;
    let classQuery = db.from('classes').select('id,name,teacher_id', { count: 'exact' }).is('archived_at', null).order('name').limit(2000);
    if (!overview) classQuery = classQuery.eq('teacher_id', teacher.id);
    const classes = await classQuery;
    if (classes.error || !classes.data || classes.count !== null && classes.count > classes.data.length) fail('반 목록을 불러오지 못했습니다.', 503);
    const allowedClasses = classes.data.filter(c => admin || c.teacher_id === teacher.id);
    const classNames = new Map(classes.data.map(c => [c.id, c.name]));
    const teacherNames = new Map(teachers.data.map(t => [t.id, t.name]));

    if (input.intent === 'list') {
      const links = allowedClasses.length ? await db.from('class_links').select('class_id,hr_class_id').in('class_id', allowedClasses.map(c => c.id)) : { data: [], error: null };
      if (links.error) fail('반 연결 정보를 불러오지 못했습니다.', 503);
      let query = db.from('notices').select('id,author_id,scope,class_id,title,body,pinned,created_at,classes(name)').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(50);
      if (!overview) query = query.or(`author_id.eq.${teacher.id},scope.eq.all`);
      const result = await query;
      if (result.error) fail('공지 이력을 불러오지 못했습니다.', 503);
      return NextResponse.json({
        classes: allowedClasses.map(c => { const mapped = (links.data || []).filter(l => l.class_id === c.id); return { id: c.id, name: c.name, isOwn: c.teacher_id === teacher.id, cardClassId: mapped.length === 1 ? mapped[0].hr_class_id : null }; }), canCreate, canSendAll: admin,
        notices: (result.data || []).map(n => {
          const joined = Array.isArray(n.classes) ? n.classes[0] : n.classes;
          return { id: n.id, title: n.title, body: n.body, pinned: n.pinned, createdAt: n.created_at,
            target: n.scope === 'all' ? '전체 반' : n.scope === 'my_classes' ? (teacherNames.get(n.author_id) || '작성 선생님') + ' 담당 반 전체' : classNames.get(n.class_id) || joined?.name || '이전 반',
            authorName: teacherNames.get(n.author_id) || '선생님', canDelete: canCreate && n.author_id === teacher.id };
        }),
      }, { headers });
    }
    if (input.intent === 'delete') {
      if (!uuid(input.noticeId)) fail('삭제할 공지를 확인해 주세요.');
      const existing = await db.from('notices').select('id,author_id').eq('id', input.noticeId).maybeSingle();
      if (existing.error) fail('공지 삭제 상태를 확인하지 못했습니다.', 503);
      if (!existing.data) return NextResponse.json({ ok: true }, { headers });
      if (existing.data.author_id !== teacher.id) fail('직접 작성한 공지만 삭제할 수 있습니다.', 403);
      const result = await db.from('notices').delete().eq('id', input.noticeId).eq('author_id', teacher.id).select('id');
      if (result.error) fail('공지를 삭제하지 못했습니다.', 503);
      if (!result.data?.length) fail('직접 작성한 공지만 삭제할 수 있습니다.', 403);
      return NextResponse.json({ ok: true, message: '공지를 삭제했습니다.' }, { headers });
    }
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || typeof input.body !== 'string' || input.body.length > 10000 || typeof input.pinned !== 'boolean') fail('제목은 200자, 내용은 10,000자 이내로 입력해 주세요.');
    const target = input.target;
    if (target === 'all' && !admin) fail('전체 반 공지는 관리자만 등록할 수 있습니다.', 403);
    if (target !== 'all' && target !== 'my_classes' && (!uuid(target) || !allowedClasses.some(c => c.id === target))) fail('담당하는 반만 선택할 수 있습니다.', 403);
    const selectedClasses = target === 'all' ? classes.data : target === 'my_classes' ? classes.data.filter(c => c.teacher_id === teacher.id) : allowedClasses.filter(c => c.id === target);
    const notice: Notice = { id: input.requestId, author_id: teacher.id, scope: target === 'all' ? 'all' : target === 'my_classes' ? 'my_classes' : 'class', class_id: uuid(target) ? target : null, title: input.title.trim(), body: input.body.trim(), pinned: input.pinned };
    const findExisting = async () => {
      const found = await db.from('notices').select('id,author_id,scope,class_id,title,body,pinned').eq('id', notice.id).maybeSingle();
      if (found.error) fail('공지 등록 상태를 확인하지 못했습니다.', 503);
      const existing = found.data;
      if (!existing) return false;
      if ((['author_id', 'scope', 'class_id', 'title', 'body', 'pinned'] as const).some(k => existing[k] !== notice[k])) fail('요청이 변경되었습니다. 공지 목록을 확인한 뒤 다시 작성해 주세요.', 409);
      return true;
    };
    const repeated = () => NextResponse.json({ ok: true, repeated: true, id: notice.id, message: '이미 등록된 공지입니다. 알림을 중복 발송하지 않았습니다.' }, { headers });
    if (input.intent === 'create') {
      if (!uuid(input.requestId)) fail('공지 등록 요청을 확인해 주세요.');
      if (await findExisting()) return repeated();
    }
    if (!selectedClasses.length) fail('공지 발송 대상 반이 없습니다.');
    // Paginate before sending; do not silently truncate an academy-wide notice.
    const students = new Set<string>(), studentKeys = new Set<string>();
    for (let start = 0; start < selectedClasses.length; start += 100) {
      const ids = selectedClasses.slice(start, start + 100).map(c => c.id);
      for (let offset = 0; ; offset += 500) {
        const page = await db.from('students').select('id,hr_student_id').in('class_id', ids).eq('status', 'approved').order('id').range(offset, offset + 499);
        if (page.error || !page.data) fail('발송 대상을 확인하지 못했습니다.', 503);
        for (const student of page.data) {
          students.add(student.id);
          studentKeys.add(student.hr_student_id && /^\d+$/.test(student.hr_student_id) ? 'card:' + student.hr_student_id
            : student.id === process.env.PORTAL_TEST_SPEAKING_STUDENT && process.env.PORTAL_TEST_VOCA_SUBJECT ? 'test:voca:' + process.env.PORTAL_TEST_VOCA_SUBJECT : 'speaking:' + student.id);
        }
        if (page.data.length < 500) break;
      }
    }
    if (input.intent === 'audience') return NextResponse.json({ studentKeys: Array.from(studentKeys) }, { headers });
    if (input.intent === 'preview') return NextResponse.json({ target: target === 'all' ? '전체 반' : target === 'my_classes' ? '내가 담당하는 모든 반' : classNames.get(target), classCount: selectedClasses.length, studentCount: students.size }, { headers });
    const inserted = await db.from('notices').insert(notice).select('id').single();
    if (inserted.error?.code === '23505' && await findExisting()) return repeated();
    if (inserted.error) fail('공지를 등록하지 못했습니다. 같은 화면에서 다시 시도해 주세요.', 503);
    let sent = 0, failed = 0, deliveryUnknown = false;
    const audience = Array.from(students), origin = appOrigin();
    try {
      for (let start = 0; start < audience.length; start += 100) {
        const result = await sendPushToStudents(audience.slice(start, start + 100), { title: `📢 ${notice.title}`, body: notice.body.slice(0, 120) || '새 공지가 등록되었어요', studentUrl: `${origin}/student/notices`, origin });
        sent += result.sent; failed += result.failed;
      }
    } catch { deliveryUnknown = true; }
    return NextResponse.json({ ok: true, id: notice.id, sent, failed, deliveryUnknown, studentCount: students.size,
      message: deliveryUnknown ? '공지는 등록됐지만 일부 알림 결과를 확인하지 못했습니다. 다시 등록하지 말고 공지 목록을 확인해 주세요.' : `공지를 등록했습니다. 기기 알림 ${sent}건 전송${failed ? ` · ${failed}건 실패` : ''}.` }, { headers });
  } catch (error) {
    const known = error as Error & { status?: number };
    return NextResponse.json({ error: known.status ? known.message : '공지 요청을 처리하지 못했습니다. 등록 이력을 확인한 뒤 다시 시도해 주세요.' }, { status: known.status || 500, headers });
  }
}
