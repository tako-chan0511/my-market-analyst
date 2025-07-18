// api/fetch-stock-quote.ts のサンプルコード
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { symbol } = req.query; // クエリから証券コードを取得 (例: 'AAPL')
  const apiKey = process.env.FINNHUB_API_KEY; // 環境変数からAPIキーを取得

  if (!symbol || !apiKey) {
    return res.status(400).json({ error: 'Symbol and API key are required.' });
  }

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
    const apiRes = await fetch(url);
    if (!apiRes.ok) {
      throw new Error(`Finnhub API error: ${apiRes.status}`);
    }
    const data = await apiRes.json();

    // フロントエンドに株価データを返す
    res.status(200).json(data);

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}