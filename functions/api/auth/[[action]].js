// functions/api/auth/[[action]].js
// login / register / logout / me 를 하나의 파일에서 처리

import { ok, err, json, hashPassword, genToken, genId, getToken, handleOptions } from '../../_lib/utils.js';

export const onRequestOptions = () => handleOptions();

export async function onRequest({ request, env, params }) {
  // action = ['login'] | ['register'] | ['logout'] | ['me']
  const action = (params.action || []).join('/');

  // ── 공통 체크 ──────────────────────────────────────────
  if (!env.DB)       return err('서버 설정 오류: DB 바인딩 없음', 503);
  if (!env.SESSIONS) return err('서버 설정 오류: SESSIONS 바인딩 없음', 503);

  const method = request.method.toUpperCase();

  try {
    // ── POST /api/auth/login ───────────────────────────────
    if (action === 'login' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return err('잘못된 요청'); }

      const { email, password } = body || {};
      if (!email || !password) return err('이메일과 비밀번호를 입력해주세요.');

      const user = await env.DB.prepare(
        'SELECT * FROM users WHERE email=?'
      ).bind(email.toLowerCase().trim()).first();

      if (!user) return err('이메일 또는 비밀번호가 올바르지 않습니다.');

      const hash = await hashPassword(password);
      if (hash !== user.password_hash) return err('이메일 또는 비밀번호가 올바르지 않습니다.');

      const token = genToken();
      await env.SESSIONS.put(`session:${token}`, user.id, { expirationTtl: 7 * 86400 });

      return ok({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan } });
    }

    // ── POST /api/auth/register ────────────────────────────
    if (action === 'register' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return err('잘못된 요청'); }

      const { name, email, password } = body || {};
      if (!name || !email || !password) return err('이름, 이메일, 비밀번호를 입력해주세요.');
      if (password.length < 6)          return err('비밀번호는 6자 이상이어야 합니다.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('올바른 이메일 형식이 아닙니다.');

      const lc  = email.toLowerCase().trim();
      const dup = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(lc).first();
      if (dup) return err('이미 사용 중인 이메일입니다.');

      const id   = genId();
      const hash = await hashPassword(password);
      const adminEmail = (env.ADMIN_EMAIL || 'choichoi3227@gmail.com').toLowerCase();
      const role = lc === adminEmail ? 'admin' : 'user';

      await env.DB.prepare(
        'INSERT INTO users (id,name,email,password_hash,role,plan) VALUES (?,?,?,?,?,?)'
      ).bind(id, name.trim(), lc, hash, role, 'free').run();

      const token = genToken();
      await env.SESSIONS.put(`session:${token}`, id, { expirationTtl: 7 * 86400 });

      return ok({ token, user: { id, name: name.trim(), email: lc, role, plan: 'free' } });
    }

    // ── POST /api/auth/logout ──────────────────────────────
    if (action === 'logout' && method === 'POST') {
      const t = getToken(request);
      if (t) {
        try { await env.SESSIONS.delete(`session:${t}`); } catch (_) {}
      }
      return ok({ message: '로그아웃 완료' });
    }

    // ── GET /api/auth/me ───────────────────────────────────
    if (action === 'me' && method === 'GET') {
      const t = getToken(request);
      if (!t) return err('인증이 필요합니다.', 401);

      const userId = await env.SESSIONS.get(`session:${t}`);
      if (!userId) return err('세션이 만료되었습니다.', 401);

      const user = await env.DB.prepare(
        'SELECT id,name,email,role,plan,plan_expires_at,created_at FROM users WHERE id=?'
      ).bind(userId).first();

      if (!user) return err('사용자를 찾을 수 없습니다.', 401);
      return ok({ user });
    }

    return err('Not found', 404);

  } catch (e) {
    console.error(`auth [${action}] error:`, e?.message ?? e);
    if (e?.message?.includes('no such table')) {
      return err('DB 스키마 미초기화. wrangler d1 execute --remote DB --file=schema.sql 실행 필요.', 503);
    }
    return err('서버 오류', 500);
  }
}
