// 방문자 접속 로그 기록용 Vercel Serverless Function
// GET /api/log?page=/foo → 구글 시트(Apps Script 웹앱)로 IP·시간·유입경로·페이지·중복접속여부를 전달

// 같은 IP가 이 시간(ms) 내에 다시 접속하면 "중복(부정의심) 접속"으로 표시
// Vercel Storage(Upstash) 연동이 없으면 항상 false를 반환하므로,
// 연동 전에도 기존 로그 기능은 그대로 동작한다.
const DUPLICATE_WINDOW_MS = 180000;

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

    const getRes = await fetch(`${redisUrl}/get/${key}`, { headers });
    const getData = await getRes.json();
    const lastSeen = getData.result ? Number(getData.result) : null;
    const isDuplicate = lastSeen !== null && (now - lastSeen) < DUPLICATE_WINDOW_MS;

    // 마지막 접속 시각 갱신 (240초 후 자동 만료되어 저장공간이 계속 쌓이지 않음)
    fetch(`${redisUrl}/set/${key}/${now}/EX/240`, { headers }).catch(() => {});

    return isDuplicate;
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
