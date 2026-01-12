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
  // 動作確認のためのログ
  console.log('=== [VER 2.5] Gemini 2.5-Flash Stable ===');
  
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
    
    // 配列チェックを厳格化して res.map エラーを防止
    const articles = (newsData && Array.isArray(newsData.articles)) ? newsData.articles : [];

    if (articles.length === 0) return res.status(404).json({ error: '関連ニュースが見つかりませんでした。' });

    // 2. スクレイピング
    const articleTexts = await Promise.all(articles.map((a: any) => scrapeArticleText(a.url)));
    const combinedText = articleTexts.filter(t => t.length > 50).join('\n\n---\n\n');

    // 3. Gemini API 呼び出し (本日午前中に動作確認済みの設定を適用)
    const prompt = `マーケットアナリストとして「${companyName}」の分析レポートをMarkdown形式で作成してください。\n\n資料：\n${combinedText}`;
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
    
    console.log('[DEBUG] Calling Gemini API (2.5-flash)...');
    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ 
          parts: [{ text: prompt }] 
        }] 
      }),
    });

    // 404などのエラー時に詳細をログ出力する
    if (!apiResponse.ok) {
      const errorData = await apiResponse.text();
      console.error(`[ERROR] Gemini API Error Response: ${errorData}`);
      throw new Error(`AI APIがエラー: ${apiResponse.status}`);
    }
    
    const responseData = await apiResponse.json();
    const analysisReport = responseData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!analysisReport) throw new Error('AIからの応答が空です。');

    // 4. キャッシュ保存と返却
    await kv.set(cacheKey, analysisReport.trim(), { ex: 86400 * 7 });
    res.status(200).json({ report: analysisReport.trim() });

  } catch (error: any) {
    console.error('Final Error Handler:', error.message);
    res.status(500).json({ error: error.message });
  }
}