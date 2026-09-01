// 동일 IP+브라우저의 최초 접속만 통과시키고, 이후 재접속은 일정 기간 차단하는 Edge Middleware
// Vercel Storage(Upstash Redis)에 "이미 방문했는지" 여부를 기록해 판단한다.
// KV_REST_API_URL / KV_REST_API_TOKEN 연동이 없으면 항상 통과시켜, 사이트 접속 자체는 절대 막히지 않는다.

export const config = {
  matcher: ['/', '/index.html', '/price-calculator', '/price-calculator/', '/price-calculator/index.html'],
};

const COOLDOWN_SECONDS = 86400; // 최초 접속 후 이 기간(24시간) 동안 동일 IP+브라우저 재접속 차단

export default async function middleware(req) {
  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return;

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '';
  const ua = req.headers.get('user-agent') || '';
  if (!ip) return;

  const key = `gate:${ip}:${ua}`;
  const now = Date.now();
  const authHeaders = { Authorization: `Bearer ${redisToken}` };

  try {
    // SET key value EX 초 NX → 키가 없을 때만 세팅됨(최초 접속: "OK"), 이미 있으면 세팅 안 되고 result가 null(재접속: 차단)
    const setRes = await fetch(
      `${redisUrl}/set/${encodeURIComponent(key)}/${now}/EX/${COOLDOWN_SECONDS}/NX`,
      { headers: authHeaders }
    );
    const setData = await setRes.json();
    const isRepeatVisit = setData.result === null;

    if (isRepeatVisit) {
      const sheetUrl = process.env.SHEET_WEBHOOK_URL;
      if (sheetUrl) {
        const params = new URLSearchParams({
          ip,
          ua,
          referer: req.headers.get('referer') || '',
          country: req.headers.get('x-vercel-ip-country') || '',
          page: new URL(req.url).pathname,
          duplicate: 'BLOCKED',
        });
        fetch(`${sheetUrl}?${params.toString()}`).catch(() => {});
      }

      return new Response(
        '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<meta name="robots" content="noindex"><title>잠시만요</title></head>' +
          '<body style="font-family:-apple-system,sans-serif;text-align:center;padding:100px 24px;color:#333">' +
          '<p style="font-size:16px">이미 접속하신 기록이 있어 페이지 접속이 제한됩니다.<br>' +
          '상담이 필요하시면 전화로 문의해주세요.<br>' +
          '<a href="tel:15666427" style="color:#132242;font-weight:700;font-size:20px;text-decoration:none">1566-6427</a></p>' +
          '</body></html>',
        { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
  } catch {
    return; // Redis 오류 시에도 사이트 접속은 항상 보장되도록 통과시킴
  }
}
