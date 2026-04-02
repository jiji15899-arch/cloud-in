// functions/api/auth/login.js
import { ok, err, hashPassword, genToken, handleOptions } from '../../_lib/utils.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB)       return err('서버 설정 오류: DB 바인딩 없음', 503);
    if (!env.SESSIONS) return err('서버 설정 오류: SESSIONS 바인딩 없음', 503);

    let body;
    try { body = await request.json(); } catch { return err('잘못된 요청'); }

    const { email, password } = body;
    if (!email || !password) return err('이메일과 비밀번호를 입력해주세요.');

    const user = await env.DB.prepare('SELECT * FROM users WHERE email=?')
      .bind(email.toLowerCase()).first();
    if (!user) return err('이메일 또는 비밀번호가 올바르지 않습니다.');

    const hash = await hashPassword(password);
    if (hash !== user.password_hash) return err('이메일 또는 비밀번호가 올바르지 않습니다.');

    const token = genToken();
    await env.SESSIONS.put(`session:${token}`, user.id, { expirationTtl: 7 * 86400 });

    return ok({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan } });
  } catch (e) {
    console.error('login error:', e?.message ?? e);
    if (e?.message?.includes('no such table')) return err('DB 스키마가 초기화되지 않았습니다. wrangler d1 execute로 schema.sql을 적용해주세요.', 503);
    return err('서버 오류', 500);
  }
}
