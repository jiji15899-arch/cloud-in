// functions/api/payments/checkout.js
import { ok, err, requireAuth, genId, handleOptions } from '../../_lib/utils.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireAuth(env, request);
    if (!user) return err('인증 필요', 401);

    let body;
    try { body = await request.json(); } catch { return err('잘못된 요청'); }

    const { plan } = body;
    if (!plan || plan === 'free') return err('유효한 플랜을 선택해주세요.');

    const [starterRow, proRow, enterpriseRow] = await Promise.all([
      env.DB.prepare("SELECT value FROM settings WHERE key='plan_starter_price'").first(),
      env.DB.prepare("SELECT value FROM settings WHERE key='plan_pro_price'").first(),
      env.DB.prepare("SELECT value FROM settings WHERE key='plan_enterprise_price'").first(),
    ]);

    const prices = {
      starter:    parseInt(starterRow?.value    || '9900'),
      pro:        parseInt(proRow?.value        || '29900'),
      enterprise: parseInt(enterpriseRow?.value || '99000'),
    };

    const amount = prices[plan];
    if (!amount) return err('알 수 없는 플랜입니다.');

    const orderId = `order_${genId()}`;
    const planNames = { starter: '스타터', pro: '프로', enterprise: '엔터프라이즈' };

    await env.DB.prepare(
      'INSERT INTO payments (id,user_id,order_id,amount,plan,status) VALUES (?,?,?,?,?,?)'
    ).bind(genId(), user.id, orderId, amount, plan, 'pending').run();

    return ok({
      orderId,
      orderName: `CloudPress ${planNames[plan]} 플랜`,
      amount,
      customerName: user.name,
      customerEmail: user.email,
      tossClientKey: env.TOSS_CLIENT_KEY || '',
      plan,
    });
  } catch (e) {
    console.error('checkout error:', e);
    return err('서버 오류', 500);
  }
}
