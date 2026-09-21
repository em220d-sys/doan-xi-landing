// 방문자 접속 로그 기록용 Vercel Serverless Function
// GET /api/log?page=/foo → 구글 시트(Apps Script 웹앱)로 IP·시간·유입경로·페이지·중복접속여부를 전달

// 같은 IP가 최초 접속 후 이 기간(초) 내에 MAX_VISITS를 넘겨 접속하면 "중복(부정의심) 접속"으로 표시
// middleware.js의 실제 차단 기준(24시간, 3회째부터 차단)과 동일하게 맞춰, 시트에 찍히는 Y/N이 차단 여부와 일치하게 한다.
// Vercel Storage(Upstash) 연동이 없으면 항상 false를 반환하므로,
// 연동 전에도 기존 로그 기능은 그대로 동작한다.
const COOLDOWN_SECONDS = 86400;
const MAX_VISITS = 2; // 이 횟수까지는 정상, 그다음(3회째) 접속부터 중복(Y)

async function checkDuplicateVisit(ip) {
  // Vercel Storage 마켓플레이스로 연결하면 KV_REST_API_* 이름으로 주입됨
  // (직접 Upstash 계정을 연결한 경우 UPSTASH_REDIS_REST_* 이름일 수 있어 둘 다 지원)
  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken || ip === 'unknown') return false;

  try {
    const headers = { Authorization: `Bearer ${redisToken}` };
    const key = `visit:${ip}`;

    // MULTI/EXEC(원자적 실행): SET key 0 EX 초 NX → 키가 없을 때만 0으로 만들고 만료시간 설정,
    // INCR key → 방문 횟수 +1 (만료시간은 최초 접속 시점 기준으로 유지)
    const res = await fetch(`${redisUrl}/multi-exec`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['SET', key, '0', 'EX', String(COOLDOWN_SECONDS), 'NX'],
        ['INCR', key],
      ]),
    });
    const data = await res.json();
    const visitCount = Number(data?.[1]?.result);

    return Number.isFinite(visitCount) && visitCount > MAX_VISITS;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const sheetUrl = process.env.SHEET_WEBHOOK_URL;

  res.setHeader('Cache-Control', 'no-store');

  if (!sheetUrl) {
    res.status(204).end();
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
  const ua = req.headers['user-agent'] || '';
  const referer = req.headers['referer'] || '';
  const country = req.headers['x-vercel-ip-country'] || '';
  const page = (req.query && req.query.page) || '';
  const duplicate = (await checkDuplicateVisit(ip)) ? 'Y' : 'N';

  const params = new URLSearchParams({ ip, ua, referer, country, page, duplicate });

  // 구글 시트 기록 실패해도 방문자 페이지 로딩에는 영향 없게 처리
  fetch(`${sheetUrl}?${params.toString()}`).catch(() => {});

  res.status(204).end();
}
