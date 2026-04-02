// functions/api/auth/me.js
import { ok, err, requireAuth, handleOptions } from '../../_lib/utils.js';
export const onRequestOptions = () => handleOptions();
export async function onRequestGet({ request, env }) {
  try {
    const user = await requireAuth(env, request);
    if (!user) return err('인증이 필요합니다.', 401);
    return ok({ user });
  } catch (e) {
    console.error('me error:', e);
    return err('서버 오류', 500);
  }
}
