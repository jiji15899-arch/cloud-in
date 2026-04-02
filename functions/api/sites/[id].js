// functions/api/sites/[id].js
import { ok, err, requireAuth, handleOptions } from '../../_lib/utils.js';
import { destroySite, getSiteStatus } from '../../_lib/provisioner.js';

export const onRequestOptions = () => handleOptions();

export async function onRequest({ params, request, env }) {
  try {
    const url = new URL(request.url);

    // ── GET /api/sites/:id/status — 프로비저닝 상태 폴링 ──────
    if (url.pathname.endsWith('/status')) {
      const user = await requireAuth(env, request);
      if (!user) return err('인증 필요', 401);

      const site = await env.DB.prepare(
        `SELECT id, status, wp_url, wp_admin_url, wp_username, wp_password,
                subdomain, custom_domain, iwp_site_id, iwp_task_id
         FROM sites WHERE id=? AND user_id=?`
      ).bind(params.id, user.id).first();
      if (!site) return err('사이트 없음', 404);

      // 아직 provisioning 중이면 InstaWP에 실시간 조회
      if (site.status === 'provisioning') {
        try {
          const result = await getSiteStatus(env, {
            taskId:    site.iwp_task_id,
            iwpSiteId: site.iwp_site_id,
            subdomain: site.subdomain,
          });

          if (result.status === 'active') {
            // DB 업데이트
            await env.DB.prepare(
              `UPDATE sites SET
                 status='active',
                 iwp_site_id=?,
                 wp_url=?,
                 wp_admin_url=?,
                 wp_username=?,
                 wp_password=?
               WHERE id=?`
            ).bind(
              result.iwpSiteId || site.iwp_site_id,
              result.wpUrl,
              result.wpAdminUrl,
              result.wpUsername || '',
              result.wpPassword || '',
              params.id
            ).run();

            return ok({
              site: {
                ...site,
                status:       'active',
                wp_url:       result.wpUrl,
                wp_admin_url: result.wpAdminUrl,
                wp_username:  result.wpUsername,
                wp_password:  result.wpPassword,
              },
            });
          }

          if (result.status === 'error') {
            await env.DB.prepare("UPDATE sites SET status='error' WHERE id=?")
              .bind(params.id).run();
            return ok({ site: { ...site, status: 'error' } });
          }
        } catch (pollErr) {
          console.warn('status poll error:', pollErr?.message);
        }
      }

      return ok({ site });
    }

    switch (request.method) {
      case 'GET':     return getSite(params, request, env);
      case 'DELETE':  return deleteSite(params, request, env);
      case 'PUT':     return updateSite(params, request, env);
      case 'OPTIONS': return handleOptions();
      default:        return err('Method not allowed', 405);
    }
  } catch (e) {
    console.error('[id] onRequest error:', e);
    return err('서버 오류', 500);
  }
}

async function getSite(params, request, env) {
  try {
    const user = await requireAuth(env, request);
    if (!user) return err('인증 필요', 401);
    const site = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND user_id=?')
      .bind(params.id, user.id).first();
    if (!site) return err('사이트 없음', 404);
    return ok({ site });
  } catch (e) {
    console.error('getSite error:', e);
    return err('서버 오류', 500);
  }
}

async function deleteSite(params, request, env) {
  try {
    const user = await requireAuth(env, request);
    if (!user) return err('인증 필요', 401);
    const site = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND user_id=?')
      .bind(params.id, user.id).first();
    if (!site) return err('사이트 없음', 404);

    // InstaWP 사이트 삭제
    if (site.iwp_site_id) {
      try { await destroySite(env, site.iwp_site_id); } catch (_) {}
    }

    // Cloudflare DNS 삭제
    if (env.CF_API_TOKEN && env.CF_ZONE_ID) {
      try { await deleteDNS(env, site.subdomain); } catch (_) {}
      if (site.custom_domain) {
        try { await deleteDNS(env, site.custom_domain); } catch (_) {}
      }
    }

    await env.DB.prepare('DELETE FROM sites WHERE id=? AND user_id=?')
      .bind(params.id, user.id).run();
    return ok({ message: '사이트가 삭제되었습니다.' });
  } catch (e) {
    console.error('deleteSite error:', e);
    return err('서버 오류', 500);
  }
}

async function updateSite(params, request, env) {
  try {
    const user = await requireAuth(env, request);
    if (!user) return err('인증 필요', 401);
    const site = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND user_id=?')
      .bind(params.id, user.id).first();
    if (!site) return err('사이트 없음', 404);

    let body;
    try { body = await request.json(); } catch { return err('잘못된 요청'); }

    const { custom_domain, name } = body;

    if (name) {
      await env.DB.prepare('UPDATE sites SET name=? WHERE id=?')
        .bind(name.trim(), params.id).run();
    }

    if (custom_domain) {
      if (!/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(custom_domain))
        return err('올바른 도메인 형식이 아닙니다.');
      const dup = await env.DB.prepare(
        'SELECT id FROM sites WHERE custom_domain=? AND id!=?'
      ).bind(custom_domain, params.id).first();
      if (dup) return err('이미 다른 사이트에 연결된 도메인입니다.');

      // Cloudflare에 커스텀 도메인 CNAME 추가 (InstaWP URL을 오리진으로)
      if (env.CF_API_TOKEN && env.CF_ZONE_ID && site.wp_url) {
        const origin = new URL(site.wp_url).hostname;
        try { await addDNS(env, custom_domain, origin); } catch (_) {}
      }

      await env.DB.prepare('UPDATE sites SET custom_domain=? WHERE id=?')
        .bind(custom_domain, params.id).run();
    }

    const updated = await env.DB.prepare('SELECT * FROM sites WHERE id=?')
      .bind(params.id).first();
    return ok({ site: updated });
  } catch (e) {
    console.error('updateSite error:', e);
    return err('서버 오류', 500);
  }
}

/* ── Cloudflare DNS helpers ── */
async function addDNS(env, name, target) {
  await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ type: 'CNAME', name, content: target, proxied: true, ttl: 1 }),
  });
}

async function deleteDNS(env, name) {
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records?name=${name}`,
      { headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` } }
    ).then(r => r.json());
    for (const rec of (r.result || [])) {
      await fetch(
        `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records/${rec.id}`,
        { method: 'DELETE', headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` } }
      );
    }
  } catch (_) {}
}
