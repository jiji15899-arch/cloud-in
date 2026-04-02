// functions/api/admin/notices.js
import { ok, err, requireAdminOrManager, genId, handleOptions } from '../../_lib/utils.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet({ request, env }) {
  try {
    const url    = new URL(request.url);
    const active = url.searchParams.get('active');

    let query = 'SELECT * FROM notices';
    const binds = [];
    if (active === '1') { query += ' WHERE is_active=1'; }
    query += ' ORDER BY created_at DESC';

    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return ok({ notices: results ?? [] });
  } catch (e) {
    console.error('notices GET error:', e);
    return err('서버 오류', 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireAdminOrManager(env, request);
    if (!user) return err('권한 필요', 403);

    let body;
    try { body = await request.json(); } catch { return err('잘못된 요청'); }

    const { title, content, type = 'info' } = body;
    if (!title || !content) return err('제목과 내용을 입력해주세요.');

    const id = genId();
    await env.DB.prepare(
      'INSERT INTO notices (id,title,content,type,is_active,created_by) VALUES (?,?,?,?,1,?)'
    ).bind(id, title, content, type, user.id).run();
    return ok({ id });
  } catch (e) {
    console.error('notices POST error:', e);
    return err('서버 오류', 500);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const user = await requireAdminOrManager(env, request);
    if (!user) return err('권한 필요', 403);

    let body;
    try { body = await request.json(); } catch { return err('잘못된 요청'); }

    const { id, title, content, type, is_active } = body;
    if (!id) return err('id 필요');

    const now = Math.floor(Date.now() / 1000);
    const fields = ['updated_at=?'];
    const binds  = [now];
    if (title     !== undefined) { fields.push('title=?');     binds.push(title); }
    if (content   !== undefined) { fields.push('content=?');   binds.push(content); }
    if (type      !== undefined) { fields.push('type=?');      binds.push(type); }
    if (is_active !== undefined) { fields.push('is_active=?'); binds.push(is_active ? 1 : 0); }

    binds.push(id);
    await env.DB.prepare(`UPDATE notices SET ${fields.join(',')} WHERE id=?`).bind(...binds).run();
    return ok({ message: '업데이트 완료' });
  } catch (e) {
    console.error('notices PUT error:', e);
    return err('서버 오류', 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const user = await requireAdminOrManager(env, request);
    if (!user) return err('권한 필요', 403);

    let body;
    try { body = await request.json(); } catch { return err('잘못된 요청'); }

    const { id } = body;
    if (!id) return err('id 필요');
    await env.DB.prepare('DELETE FROM notices WHERE id=?').bind(id).run();
    return ok({ message: '삭제 완료' });
  } catch (e) {
    console.error('notices DELETE error:', e);
    return err('서버 오류', 500);
  }
}
