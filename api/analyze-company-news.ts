import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';
import { kv } from '@vercel/kv';

async function scrapeArticleText(url: string): Promise<string> {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return "";
    const html = await response.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header').remove();
    return $('body').text().trim().substring(0, 2000); 
  } catch { return ""; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('=== [VER 2.3] Gemini API FIX BASED ON REPORT ===');
  
  if (req.method !== 'POST') return res.status(405).end();
  const { companyName } = req.body;
  const gnewsApiKey = process.env.GNEWS_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  try {
    const cacheKey = `report:${companyName.toLowerCase().replace(/\s/g, '')}`;

    // 1. GNews 検索
    const gnewsUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent(companyName)}&lang=ja&country=jp&max=3&apikey=${gnewsApiKey}`;
    const gnewsRes = await fetch(gnewsUrl);
    const newsData: any = await gnewsRes.json();
    const articles = (newsData && Array.isArray(newsData.articles)) ? newsData.articles : [];

    if (articles.length === 0) return res.status(404).json({ error: 'ニュースが見つかりませんでした。' });

    // 2. スクレイピング
    const articleTexts = await Promise.all(articles.map((a: any) => scrapeArticleText(a.url)));
    const combinedText = articleTexts.filter(t => t.length > 50).join('\n\n---\n\n');

    // 3. Gemini API (修正版エンドポイント)
    // リポートを参考に、/v1/ エンドポイントと確定モデル名を使用
    const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
    
    console.log('[DEBUG] Calling Gemini API...');
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `マーケットアナリストとして「${companyName}」の分析レポートを作成してください。\n\n資料：\n${combinedText}` }]
        }]
      })
    });

    // リポートの教訓：エラー時は json() ではなく text() で詳細を確認する
    if (!geminiRes.ok) {
      const errorText = await geminiRes.text();
      console.error(`[ERROR] Gemini API Detail: ${errorText}`);
      throw new Error(`Gemini API Error: ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();
    const analysisReport = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!analysisReport) {
      console.error('[ERROR] Unexpected structure:', JSON.stringify(geminiData));
      throw new Error('AIからの応答構造が不正です。');
    }

    // 4. キャッシュ保存と返却
    await kv.set(cacheKey, analysisReport.trim(), { ex: 86400 * 7 });
    res.status(200).json({ report: analysisReport.trim() });

  } catch (error: any) {
    console.error('Final Error Handler:', error.message);
    res.status(500).json({ error: error.message });
  }
}