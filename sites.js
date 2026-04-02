// functions/api/admin/sites.js
import { ok, err, requireAdmin, handleOptions } from '../../_lib/utils.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet({ request, env }) {
  try {
    const admin = await requireAdmin(env, request);
    if (!admin) return err('어드민 권한 필요', 403);

    const url    = new URL(request.url);
    const q      = url.searchParams.get('q') || '';
    const page   = parseInt(url.searchParams.get('page') || '1');
    const status = url.searchParams.get('status') || '';
    const limit  = 20;
    const offset = (page - 1) * limit;

    const conds = [];
    const binds = [];
    if (q)      { conds.push('(s.name LIKE ? OR s.subdomain LIKE ?)'); binds.push(`%${q}%`, `%${q}%`); }
    if (status) { conds.push('s.status=?'); binds.push(status); }

    const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
    const query = `SELECT s.*,u.name user_name,u.email user_email
      FROM sites s JOIN users u ON s.user_id=u.id${where}
      ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;

    const { results } = await env.DB.prepare(query).bind(...binds, limit, offset).all();
    const countRow = await env.DB.prepare(`SELECT COUNT(*) c FROM sites s${where}`).bind(...binds).first();
    const total = countRow?.c ?? 0;

    return ok({ sites: results ?? [], total, page, pages: Math.ceil(total / limit) });
  } catch (e) {
    console.error('admin sites GET error:', e);
    return err('서버 오류', 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const admin = await requireAdmin(env, request);
    if (!admin) return err('어드민 권한 필요', 403);

    let body;
    try { body = await request.json(); } catch { return err('잘못된 요청'); }

    const { id } = body;
    if (!id) return err('id 필요');
    await env.DB.prepare('DELETE FROM sites WHERE id=?').bind(id).run();
    return ok({ message: '삭제 완료' });
  } catch (e) {
    console.error('admin sites DELETE error:', e);
    return err('서버 오류', 500);
  }
}
