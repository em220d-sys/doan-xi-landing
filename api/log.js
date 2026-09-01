// 방문자 접속 로그 기록용 Vercel Serverless Function
// GET /api/log?page=/foo → 구글 시트(Apps Script 웹앱)로 IP·시간·유입경로·페이지·중복접속여부를 전달

// 같은 IP가 최초 접속 후 이 기간(초) 내에 다시 접속하면 "중복(부정의심) 접속"으로 표시
// middleware.js의 실제 차단 기준과 동일한 24시간으로 맞춰, 시트에 찍히는 Y/N이 차단 여부와 일치하게 한다.
// Vercel Storage(Upstash) 연동이 없으면 항상 false를 반환하므로,
// 연동 전에도 기존 로그 기능은 그대로 동작한다.
const COOLDOWN_SECONDS = 86400;

async function checkDuplicateVisit(ip) {
  // Vercel Storage 마켓플레이스로 연결하면 KV_REST_API_* 이름으로 주입됨
  // (직접 Upstash 계정을 연결한 경우 UPSTASH_REDIS_REST_* 이름일 수 있어 둘 다 지원)
  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken || ip === 'unknown') return false;

  try {
    const headers = { Authorization: `Bearer ${redisToken}` };
    const key = `visit:${ip}`;
    const now = Date.now();

    // SET key value EX 초 NX → 키가 없을 때만 세팅됨(최초 접속), 이미 있으면 세팅 안 되고 result가 null(재접속)
    const setRes = await fetch(`${redisUrl}/set/${key}/${now}/EX/${COOLDOWN_SECONDS}/NX`, { headers });
    const setData = await setRes.json();

    return setData.result === null;
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
