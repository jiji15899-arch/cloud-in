// functions/api/admin/settings.js
import { ok, err, requireAdmin, handleOptions } from '../../_lib/utils.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet({ request, env }) {
  try {
    const { results } = await env.DB.prepare('SELECT key,value FROM settings').all();
    const cfg = Object.fromEntries((results || []).map(r => [r.key, r.value]));
    // 시크릿 키는 어드민만
    const admin = await requireAdmin(env, request);
    if (!admin) {
      delete cfg.toss_secret_key;
      delete cfg.provisioner_secret;
    }
    return ok({ settings: cfg });
  } catch (e) {
    console.error('settings GET error:', e);
    return err('서버 오류', 500);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const admin = await requireAdmin(env, request);
    if (!admin) return err('어드민 권한 필요', 403);

    let body;
    try { body = await request.json(); } catch { return err('잘못된 요청'); }

    const { settings } = body;
    if (!settings || typeof settings !== 'object') return err('잘못된 요청');

    const now = Math.floor(Date.now() / 1000);
    for (const [key, value] of Object.entries(settings)) {
      await env.DB.prepare(
        'INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=?,updated_at=?'
      ).bind(key, String(value), now, String(value), now).run();
    }
    return ok({ message: '설정 저장 완료' });
  } catch (e) {
    console.error('settings PUT error:', e);
    return err('서버 오류', 500);
  }
}
