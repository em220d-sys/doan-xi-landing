// 관심고객 등록 / 상담신청 폼 제출 → 구글시트(Apps Script 웹앱)로 기록
// Formspree 대신 이 엔드포인트로 전송한다. 시트 기록은 doGet 방식(쿼리스트링)으로
// api/log.js와 동일한 패턴을 사용 — 같은 Apps Script 프로젝트가 아니어도 되지만
// 구조를 통일해 유지보수를 쉽게 한다.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  const body = req.body || {};
  const name = (body.name || '').toString().trim();
  const phone = (body.phone || '').toString().trim();
  const size = (body.size || '').toString().trim();
  const agree = body.agree ? 'Y' : 'N';
  const source = (body.source || '').toString().trim();

  if (!name || !phone || agree !== 'Y') {
    res.status(400).json({ ok: false, error: 'invalid input' });
    return;
  }

  const sheetUrl = process.env.CONSULT_SHEET_WEBHOOK_URL;

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
  const ua = req.headers['user-agent'] || '';
  const referer = req.headers['referer'] || '';

  if (sheetUrl) {
    const params = new URLSearchParams({ name, phone, size, agree, source, ip, ua, referer });
    try {
      const sheetRes = await fetch(`${sheetUrl}?${params.toString()}`);
      if (!sheetRes.ok) throw new Error('sheet webhook non-200');
    } catch {
      res.status(502).json({ ok: false, error: 'sheet write failed' });
      return;
    }
  }

  res.status(200).json({ ok: true });
}
