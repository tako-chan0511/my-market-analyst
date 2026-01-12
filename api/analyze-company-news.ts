// api/analyze-company-news.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';
import { kv } from '@vercel/kv';

// ヘルパー関数：指定されたURLから本文を抽出する（変更なし）
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
    // ★★ キャッシュキーを「レポート」用に変更 ★★
    const cacheKey = `report:${companyName.toLowerCase().replace(/\s/g, '')}`;
    const CACHE_DURATION_SECONDS = 86400*7; // 24時間*7日間

    // ★★ 1. まずKVから「最終分析レポート」のキャッシュを探す ★★
    const cachedReport: string | null = await kv.get(cacheKey);

    // ★★ 2. キャッシュがあれば、即座にそれを返して処理を終了 ★★
    if (cachedReport) {
      console.log(`[Cache Hit] for report: ${cacheKey}. Returning cached report.`);
      return res.status(200).json({ report: cachedReport });
    }
    
    console.log(`[Cache Miss] for report: ${cacheKey}. Generating new report.`);

    // --- 以下はキャッシュがなかった場合のみ実行される ---

    // 3. GNews APIで関連ニュースを検索
    const gnewsParams = new URLSearchParams({
      q: companyName,
      lang: 'ja',
      country: 'jp',
      max: '5',
      apikey: gnewsApiKey,
    });
    const gnewsUrl = `https://gnews.io/api/v4/search?${gnewsParams.toString()}`;
    console.log('Fetching GNews from:', gnewsUrl.replace(gnewsApiKey, 'REDACTED'));
    const gnewsRes = await fetch(gnewsUrl);
    
    if (!gnewsRes.ok) {
      const errorText = await gnewsRes.text();
      console.error(`GNews API Error: ${gnewsRes.status}`, errorText);
      throw new Error(`GNews APIからのニュース取得に失敗しました (ステータス: ${gnewsRes.status})`);
    }
    
    const newsData = await gnewsRes.json();
    console.log('GNews response:', JSON.stringify(newsData).substring(0, 500));
    
    const articles = newsData.articles || [];
    
    if (!Array.isArray(articles)) {
      console.error('Articles is not an array:', typeof articles, articles);
      throw new Error('GNews APIからの応答が期待される形式ではありません');
    }

    if (articles.length === 0) {
      return res.status(404).json({ error: '関連するニュースが見つかりませんでした。' });
    }

    // 4. 各ニュース記事の本文を並行してスクレイピング
    const scrapingPromises = articles.map((article: any) => scrapeArticleText(article.url));
    const allArticleTexts = (await Promise.all(scrapingPromises)).filter(text => text.length > 100);

    if (allArticleTexts.length === 0) {
      throw new Error('ニュース記事から十分なテキストを抽出できませんでした。');
    }

    // 5. Gemini APIに分析を依頼
    const combinedText = allArticleTexts.join('\n\n---\n\n');
    const prompt = `
      あなたは優秀なマーケットアナリストです。以下の最新ニュース記事群を元に、「${companyName}」の現在の経営状況、市場での評判、そして将来的なリスクとチャンスについて、多角的に分析し、レポートをMarkdown形式で作成してください。
      レポートの構成：
      * **総合的な状況（サマリー）**
      * **ポジティブな要因**（具体的なニュースを引用して）
      * **ネガティブな要因**（具体的なニュースを引用して）
      * **将来性の考察**
      ---ニュース記事群---
      ${combinedText}
    `;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    if (!geminiRes.ok) {
      const errorText = await geminiRes.text();
      console.error(`Gemini API Error: ${geminiRes.status}`, errorText);
      throw new Error(`AI API がエラー: ${geminiRes.status} - ${errorText.substring(0, 200)}`);
    }
    
    const geminiData = await geminiRes.json();
    const analysisReport = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!analysisReport) throw new Error('AIからの応答が空です。');

    const finalReport = analysisReport.trim();

    // ★★ 6. 生成した「最終分析レポート」をKVに保存する ★★
    await kv.set(cacheKey, finalReport, { ex: CACHE_DURATION_SECONDS });
    console.log(`[Cache Set] for report: ${cacheKey}`);

    // 7. フロントエンドに分析レポートを返す
    res.status(200).json({ report: finalReport });

  } catch (error: any) {
    console.error('An error occurred in analyze-company-news handler:', error);
    console.error('Error stack:', error.stack);
    console.error('Full error object:', JSON.stringify(error, null, 2));
    
    // より詳細なエラーメッセージを返す
    const errorMessage = error.message || 'Unknown error occurred';
    const statusCode = error.statusCode || 500;
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}