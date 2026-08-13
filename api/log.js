// 방문자 접속 로그 기록용 Vercel Serverless Function
// GET /api/log?page=/foo → 구글 시트(Apps Script 웹앱)로 IP·시간·유입경로·페이지를 전달

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

  const params = new URLSearchParams({ ip, ua, referer, country, page });

  // 구글 시트 기록 실패해도 방문자 페이지 로딩에는 영향 없게 처리
  fetch(`${sheetUrl}?${params.toString()}`).catch(() => {});

  res.status(204).end();
}
