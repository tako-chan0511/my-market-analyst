// api/fetch-stock-quote.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. フロントエンドから企業の証券コード（symbol）を受け取る
  // 例: /api/fetch-stock-quote?symbol=AAPL
  const { symbol } = req.query;

  // 2. Vercelの環境変数からAPIキーを安全に読み込む
  const apiKey = process.env.FINNHUB_API_KEY;

  if (typeof symbol !== 'string' || !symbol) {
    return res.status(400).json({ error: '証券コードが必要です。' });
  }
  if (!apiKey) {
    return res.status(500).json({ error: 'Finnhub APIキーがサーバーに設定されていません。' });
  }

  try {
    // 3. FinnhubのAPIを呼び出す
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
    const apiRes = await fetch(url);

    if (!apiRes.ok) {
      throw new Error(`Finnhub API エラー: ${apiRes.status}`);
    }
    const data = await apiRes.json();
    
    // 4. 取得した株価データをフロントエンドに返す
    res.status(200).json(data);

  } catch (error: any) {
    console.error('An error occurred in fetch-stock-quote handler:', error);
    res.status(500).json({ error: error.message });
  }
}