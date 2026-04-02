// functions/_lib/provisioner.js
// InstaWP API 프로비저너 + Cloudflare CDN 무제한 트래픽 레이어

const INSTAWP_API = 'https://app.instawp.io/api/v2';

// ── 플랜 → InstaWP 플랜 매핑 ──────────────────────────────
const PLAN_MAP = {
  starter:    'starter',
  pro:        'pro',
  enterprise: 'turbo',   // 기본 turbo, 관리자 상의 후 변경
  free:       'starter', // free 는 starter로 (사이트 수 DB에서 제한)
};

// 자동 설치 플러그인 (wordpress.org 슬러그)
const AUTO_PLUGINS = [
  'rank-math-seo',      // Rank Math SEO
  'litespeed-cache',    // LiteSpeed Cache
  'instawp-connect',    // InstaWP 자체 마이그레이션 플러그인
];

// ── 사이트 생성 ───────────────────────────────────────────
export async function provisionSite(env, { siteId, subdomain, userPlan = 'free' }) {
  const apiKey = env.INSTAWP_API_KEY;
  if (!apiKey) throw new Error('INSTAWP_API_KEY 환경변수가 설정되지 않았습니다.');

  const siteName   = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const iwpPlan    = PLAN_MAP[userPlan] || 'starter';

  // InstaWP 사이트 생성 요청
  // - wordpress_version: "latest" (항상 최신)
  // - php_version: "latest" (항상 최신)
  // - region: "ap-southeast-1" (Singapore)
  // - is_reserved: true (임시 사이트 아님, 영구 사이트)
  // - plan: InstaWP 플랜
  // - plugins: 자동 설치 플러그인 목록
  const payload = {
    site_name:         siteName,
    wordpress_version: 'latest',
    php_version:       'latest',
    region:            'ap-southeast-1',  // Singapore (AWS ap-southeast-1)
    is_reserved:       true,
    plan:              iwpPlan,
    plugins:           AUTO_PLUGINS,
  };

  const resp = await fetch(`${INSTAWP_API}/sites`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();

  if (!resp.ok || !data.status) {
    throw new Error(`InstaWP 생성 실패: ${data.message || resp.status}`);
  }

  // 즉시 완료된 경우 (풀 사이트)
  if (data.data?.wp_url) {
    const site = data.data;
    const iwpSiteId = String(site.id);

    // Cloudflare CDN 서브도메인 연결
    await connectCloudflare(env, subdomain, site.wp_url);

    return {
      iwpSiteId,
      wpUrl:       site.wp_url,
      wpAdminUrl:  site.wp_url.replace(/\/?$/, '/wp-admin'),
      wpUsername:  site.wp_username,
      wpPassword:  site.wp_password,
      taskId:      null,
      status:      'active',
    };
  }

  // 비동기 생성 중인 경우 (task_id 반환)
  if (data.data?.task_id) {
    return {
      iwpSiteId: null,
      wpUrl:     null,
      taskId:    data.data.task_id,
      status:    'provisioning',
    };
  }

  throw new Error('InstaWP: 예상치 못한 응답 형식');
}

// ── 태스크 상태 폴링 ──────────────────────────────────────
export async function getSiteStatus(env, { taskId, iwpSiteId, subdomain }) {
  const apiKey = env.INSTAWP_API_KEY;
  if (!apiKey) return { status: 'unknown' };

  // task_id로 폴링
  if (taskId && !iwpSiteId) {
    const resp = await fetch(`${INSTAWP_API}/tasks/${taskId}/status`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const data = await resp.json();
    const taskStatus = data.data?.status;  // 'progress' | 'completed' | 'failed'

    if (taskStatus === 'progress') return { status: 'provisioning' };
    if (taskStatus === 'failed')   return { status: 'error', message: '사이트 생성 실패' };

    // 완료 → 사이트 정보 가져오기
    if (taskStatus === 'completed') {
      const resourceId = data.data?.resource_id;
      if (resourceId) {
        return fetchSiteInfo(env, String(resourceId), subdomain);
      }
    }
    return { status: 'provisioning' };
  }

  // iwpSiteId로 직접 조회
  if (iwpSiteId) {
    return fetchSiteInfo(env, iwpSiteId, subdomain);
  }

  return { status: 'unknown' };
}

async function fetchSiteInfo(env, iwpSiteId, subdomain) {
  const apiKey = env.INSTAWP_API_KEY;
  const resp = await fetch(`${INSTAWP_API}/sites/${iwpSiteId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  const data = await resp.json();
  if (!data.status || !data.data?.wp_url) return { status: 'provisioning' };

  const site = data.data;

  // 처음 완료됐을 때 Cloudflare CDN 연결
  if (subdomain) {
    await connectCloudflare(env, subdomain, site.wp_url).catch(() => {});
  }

  return {
    status:      'active',
    iwpSiteId,
    wpUrl:       site.wp_url,
    wpAdminUrl:  site.wp_url.replace(/\/?$/, '/wp-admin'),
    wpUsername:  site.wp_username || '',
    wpPassword:  site.wp_password || '',
  };
}

// ── 사이트 삭제 ───────────────────────────────────────────
export async function destroySite(env, iwpSiteId) {
  if (!iwpSiteId || !env.INSTAWP_API_KEY) return;

  await fetch(`${INSTAWP_API}/sites/${iwpSiteId}`, {
    method:  'DELETE',
    headers: { 'Authorization': `Bearer ${env.INSTAWP_API_KEY}` },
  }).catch(() => {});
}

// ── Cloudflare CDN 연결 (무제한 트래픽 레이어) ─────────────
// InstaWP 사이트 URL → Cloudflare 서브도메인 CNAME + 캐시 규칙
// 결과: 정적 파일·캐싱된 페이지는 CF가 서빙 → InstaWP 대역폭 사실상 무제한
async function connectCloudflare(env, subdomain, originUrl) {
  const token   = env.CF_API_TOKEN;
  const zoneId  = env.CF_ZONE_ID;
  if (!token || !zoneId) return;  // CF 미설정이면 스킵 (InstaWP URL 그대로 사용)

  const cfApi  = `https://api.cloudflare.com/client/v4/zones/${zoneId}`;
  const origin = new URL(originUrl).hostname;

  // 1. CNAME 생성: subdomain.cloudpress.cloud-in.co.kr → instawp-hostname
  //    proxy: true → Cloudflare가 중간에서 트래픽 처리
  await fetch(`${cfApi}/dns_records`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      type:    'CNAME',
      name:    subdomain,
      content: origin,
      proxied: true,   // ← Cloudflare 프록시 ON = CDN + DDoS방어 활성화
      ttl:     1,      // 1 = Auto
    }),
  }).catch(() => {});

  // 2. Cache Rules: 정적 자산 무조건 캐시 (이미지·CSS·JS·폰트)
  //    Cloudflare가 캐시 히트 시 InstaWP 서버에 요청 안 함
  await fetch(`${cfApi}/rulesets/phases/http_request_cache_settings/entrypoint/rules`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      description: `CloudPress CDN - ${subdomain}`,
      expression:  `(http.host eq "${subdomain}.${env.SITE_DOMAIN || 'cloudpress.cloud-in.co.kr'}")`,
      action:      'set_cache_settings',
      action_parameters: {
        cache:                    true,
        edge_ttl: {
          mode:    'override_origin',
          default: 86400,           // 기본 1일
          status_code_ttl: [
            { status_code: 200, value: 86400  },   // 200 → 1일
            { status_code: 301, value: 86400  },   // 리다이렉트 → 1일
            { status_code: 404, value: 60    },    // 404 → 1분
          ],
        },
        browser_ttl: {
          mode:    'override_origin',
          default: 3600,            // 브라우저 1시간 캐시
        },
        cache_key: {
          ignore_query_strings_order: true,
          cache_deception_armor:      true,
        },
        serve_stale: {
          disable_stale_while_updating: false,
        },
      },
    }),
  }).catch(() => {});

  // 3. 압축 활성화 (Brotli) — CF가 자동 압축, InstaWP 부하 감소
  await fetch(`${cfApi}/settings/brotli`, {
    method:  'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ value: 'on' }),
  }).catch(() => {});

  // 4. HTTP/2, HTTP/3 활성화 (CF 계정 단위 설정이므로 zone 설정으로)
  await fetch(`${cfApi}/settings/http2`, {
    method:  'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ value: 'on' }),
  }).catch(() => {});
}

// ── 엔터프라이즈 플랜 변경 (관리자 상의 필요) ──────────────
// 관리자가 직접 InstaWP 대시보드에서 변경하거나 아래 함수로 API 호출
export async function updateSitePlan(env, iwpSiteId, newIwpPlan) {
  const apiKey = env.INSTAWP_API_KEY;
  if (!apiKey || !iwpSiteId) throw new Error('API 키 또는 사이트 ID 없음');

  const resp = await fetch(`${INSTAWP_API}/sites/${iwpSiteId}`, {
    method:  'PATCH',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ plan: newIwpPlan }),
  });
  const data = await resp.json();
  if (!data.status) throw new Error(`플랜 변경 실패: ${data.message}`);
  return data;
    }
