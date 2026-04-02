// functions/api/user/index.js
import { ok, err, requireAuth, hashPassword, handleOptions } from '../../_lib/utils.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuth(env, request);
    if (!user) return err('인증 필요', 401);

    const row = await env.DB.prepare(
      'SELECT COUNT(*) count FROM sites WHERE user_id=?'
    ).bind(user.id).first();
    const siteCount = row?.count ?? 0;

    return ok({ user: { ...user, site_count: siteCount } });
  } catch (e) {
    console.error('user GET error:', e);
    return err('서버 오류', 500);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const user = await requireAuth(env, request);
    if (!user) return err('인증 필요', 401);

    let body;
    try { body = await request.json(); } catch { return err('잘못된 요청'); }

    const { name, current_password, new_password } = body;

    if (new_password) {
      if (!current_password) return err('현재 비밀번호를 입력해주세요.');
      const dbUser = await env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(user.id).first();
      if (!dbUser) return err('사용자를 찾을 수 없습니다.', 404);
      const curHash = await hashPassword(current_password);
      if (curHash !== dbUser.password_hash) return err('현재 비밀번호가 올바르지 않습니다.');
      if (new_password.length < 6) return err('새 비밀번호는 6자 이상이어야 합니다.');
      const newHash = await hashPassword(new_password);
      await env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(newHash, user.id).run();
    }

    if (name) {
      await env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(name.trim(), user.id).run();
    }

    const updated = await env.DB.prepare(
      'SELECT id,name,email,role,plan,created_at FROM users WHERE id=?'
    ).bind(user.id).first();
    if (!updated) return err('사용자를 찾을 수 없습니다.', 404);

    return ok({ user: updated });
  } catch (e) {
    console.error('user PUT error:', e);
    return err('서버 오류', 500);
  }
}
