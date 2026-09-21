// 동일 IP+브라우저가 일정 기간 내 허용 횟수(MAX_VISITS)까지만 통과시키고, 그다음 접속부터 차단하는 Edge Middleware
// Vercel Storage(Upstash Redis)에 "기간 내 방문 횟수"를 기록해 판단한다.
// KV_REST_API_URL / KV_REST_API_TOKEN 연동이 없으면 항상 통과시켜, 사이트 접속 자체는 절대 막히지 않는다.

export const config = {
  matcher: ['/', '/index.html', '/price-calculator', '/price-calculator/', '/price-calculator/index.html'],
};

const COOLDOWN_SECONDS = 86400; // 최초 접속 후 이 기간(24시간) 동안 방문 횟수를 센다
const MAX_VISITS = 2; // 기간 내 이 횟수까지는 통과, 그다음(3회째) 접속부터 차단

export default async function middleware(req) {
  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return;

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '';
  const ua = req.headers.get('user-agent') || '';
  if (!ip) return;

  // 임시 해제 이전(gate:)에 쌓인 방문 기록은 버리고, 차단 재개 시점부터 새로 센다
  const key = `gate2:${ip}:${ua}`;
  const authHeaders = { Authorization: `Bearer ${redisToken}` };

  try {
    // MULTI/EXEC(원자적 실행): SET key 0 EX 초 NX → 키가 없을 때만 0으로 만들고 만료시간 설정(이미 있으면 그대로 둠),
    // INCR key → 방문 횟수 +1 (만료시간은 유지되므로 최초 접속 시점부터 24시간 고정 창)
    const res = await fetch(`${redisUrl}/multi-exec`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['SET', key, '0', 'EX', String(COOLDOWN_SECONDS), 'NX'],
        ['INCR', key],
      ]),
    });
    const data = await res.json();
    const visitCount = Number(data?.[1]?.result);
    if (!Number.isFinite(visitCount)) return; // 응답 형식이 예상과 다르면 차단하지 않고 통과
    const isBlocked = visitCount > MAX_VISITS;

    if (isBlocked) {
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
