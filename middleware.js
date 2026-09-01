// 짧은 시간 내 동일 IP+브라우저의 반복 접속을 서버 단에서 차단하는 Edge Middleware
// Vercel Storage(Upstash Redis)로 마지막 접속 시각을 기록해 판단한다.
// KV_REST_API_URL / KV_REST_API_TOKEN 연동이 없으면 항상 통과시켜, 사이트 접속 자체는 절대 막히지 않는다.

export const config = {
  matcher: ['/', '/index.html', '/price-calculator', '/price-calculator/', '/price-calculator/index.html'],
};

const WINDOW_MS = 30000; // 같은 IP+브라우저가 이 시간(30초) 내 재요청하면 차단

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
    const getRes = await fetch(`${redisUrl}/get/${encodeURIComponent(key)}`, { headers: authHeaders });
    const getData = await getRes.json();
    const lastSeen = getData.result ? Number(getData.result) : null;

    // 마지막 접속 시각 갱신 (60초 후 자동 만료, 차단 기준보다 여유있게)
    fetch(`${redisUrl}/set/${encodeURIComponent(key)}/${now}/EX/60`, { headers: authHeaders }).catch(() => {});

    if (lastSeen !== null && (now - lastSeen) < WINDOW_MS) {
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
          '<p style="font-size:16px">짧은 시간 내 반복 접속이 감지되어 잠시 제한됩니다.<br>몇 초 후 다시 시도해주세요.</p>' +
          '</body></html>',
        { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
  } catch {
    return; // Redis 오류 시에도 사이트 접속은 항상 보장되도록 통과시킴
  }
}
