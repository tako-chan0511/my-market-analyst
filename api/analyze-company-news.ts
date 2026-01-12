// api/analyze-company-news.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';
import { kv } from '@vercel/kv';

// ヘルパー関数：指定されたURLから本文を抽出する
async function scrapeArticleText(url: string): Promise<string> {
  try {
    const articleResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    if (!articleResponse.ok) return "";
    
    const html = await articleResponse.text();
    const $ = cheerio.load(html);
    $('script, style, noscript, nav, footer, header, aside, form').remove();
    return $('body').text().trim().replace(/\s{2,}/g, '\n\n');
  } catch (error) {
    console.error(`Scraping error for ${url}:`, error);
    return "";
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('=== analyze-company-news handler called at', new Date().toISOString(), '===');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "POST method required." });
  }

  const { companyName } = req.body;
  const gnewsApiKey = process.env.GNEWS_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!companyName) {
    return res.status(400).json({ error: '企業名が必要です。' });
  }
  if (!gnewsApiKey || !geminiApiKey) {
    return res.status(500).json({ error: 'APIキーがサーバーに設定されていません。' });
  }

  try {
    console.log('=== Starting analyze-company-news handler ===');
    console.log('Company name:', companyName);
    
    const cacheKey = `report:${companyName.toLowerCase().replace(/\s/g, '')}`;
    const CACHE_DURATION_SECONDS = 86400 * 7; // 7日間

    // 1. KVキャッシュ確認
    const cachedReport: string | null = await kv.get(cacheKey);
    if (cachedReport) {
      console.log(`[Cache Hit] for report: ${cacheKey}`);
      return res.status(200).json({ report: cachedReport });
    }
    
    console.log(`[Cache Miss] for report: ${cacheKey}. Generating new report.`);

    // 2. GNews API検索
    const gnewsParams = new URLSearchParams({
      q: companyName,
      lang: 'ja',
      country: 'jp',
      max: '5',
      apikey: gnewsApiKey,
    });
    const gnewsUrl = `https://gnews.io/api/v4/search?${gnewsParams.toString()}`;
    
    const gnewsRes = await fetch(gnewsUrl);
    const newsData: any = await gnewsRes.json();
    
    if (!gnewsRes.ok) {
      throw new Error(`GNews API Error: ${gnewsRes.status} ${newsData?.errors?.join(', ') || ''}`);
    }
    
    // 【修正ポイント】articles が確実に配列であることを保証する
    // これにより "res.map is not a function" エラーを防止します
    const articles = (newsData && Array.isArray(newsData.articles)) ? newsData.articles : [];
    console.log('Articles count:', articles.length);

    if (articles.length === 0) {
      return res.status(404).json({ error: '関連するニュースが見つかりませんでした。' });
    }

    // 3. スクレイピング（並行処理）
    const scrapingPromises = articles.map((article: any) => {
      if (!article || !article.url) return Promise.resolve("");
      return scrapeArticleText(article.url);
    });
    
    const articleTexts = await Promise.all(scrapingPromises);
    const allArticleTexts = articleTexts.filter(text => text && text.length > 100);

    if (allArticleTexts.length === 0) {
      throw new Error('ニュース記事から十分なテキストを抽出できませんでした。');
    }

    // 4. Gemini API分析
    const combinedText = allArticleTexts.join('\n\n---\n\n');
    const prompt = `
      あなたは優秀なマーケットアナリストです。以下の最新ニュース記事群を元に、「${companyName}」の現在の経営状況、市場での評判、そして将来的なリスクとチャンスについて、多角的に分析し、レポートをMarkdown形式で作成してください。
      レポートの構成：
      * **総合的な状況（サマリー）**
      * **ポジティブな要因**
      * **ネガティブな要因**
      * **将来性の考察**
      ---ニュース記事群---
      ${combinedText}
    `;

    // 安定版 v1 エンドポイントを使用
    const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      throw new Error(`Gemini API Error: ${geminiData?.error?.message || geminiRes.status}`);
    }
    
    const analysisReport = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!analysisReport) throw new Error('AIからの応答が空です。');

    const finalReport = analysisReport.trim();

    // 5. キャッシュ保存と返却
    await kv.set(cacheKey, finalReport, { ex: CACHE_DURATION_SECONDS });
    res.status(200).json({ report: finalReport });

  } catch (error: any) {
    console.error('An error occurred:', error.message);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}