// api/analyze-company-news.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';
import { kv } from '@vercel/kv';

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
    const cacheKey = `report:${companyName.toLowerCase().replace(/\s/g, '')}`;
    const CACHE_DURATION_SECONDS = 86400; // 24時間

    const cachedReport: string | null = await kv.get(cacheKey);

    if (cachedReport) {
      console.log(`[Cache Hit] for report: ${cacheKey}. Returning cached report.`);
      return res.status(200).json({ report: cachedReport });
    }
    
    console.log(`[Cache Miss] for report: ${cacheKey}. Generating new report.`);

    const gnewsParams = new URLSearchParams({
      q: companyName,
      lang: 'ja',
      country: 'jp',
      max: '5',
      apikey: gnewsApiKey,
    });
    const gnewsUrl = `https://gnews.io/api/v4/search?${gnewsParams.toString()}`;
    const gnewsRes = await fetch(gnewsUrl);
    
    // === ここからが修正箇所です ===
    if (!gnewsRes.ok) {
        const errorData = await gnewsRes.json();
        console.error('GNews API Error:', { status: gnewsRes.status, body: errorData });

        if (gnewsRes.status === 401) {
            // 401 Unauthorized: APIキーが不正
            return res.status(401).json({ error: 'ニュースAPIの認証に失敗しました。APIキーを確認してください。' });
        }
        if (gnewsRes.status === 429) {
            // 429 Too Many Requests: 利用上限
            return res.status(429).json({ error: 'ニュースAPIの利用上限に達しました。しばらく時間をおいてから再度お試しください。' });
        }
        // その他のエラー
        throw new Error('GNews APIからのニュース取得中に予期せぬエラーが発生しました。');
    }
    // === ここまでが修正箇所です ===
    
    const newsData = await gnewsRes.json();
    const articles = newsData.articles || [];

    if (articles.length === 0) {
      return res.status(404).json({ error: '関連するニュースが見つかりませんでした。' });
    }

    const scrapingPromises = articles.map((article: any) => scrapeArticleText(article.url));
    const allArticleTexts = (await Promise.all(scrapingPromises)).filter(text => text.length > 100);

    if (allArticleTexts.length === 0) {
      throw new Error('ニュース記事から十分なテキストを抽出できませんでした。');
    }

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

    if (!geminiRes.ok) throw new Error(`AI APIがエラー: ${geminiRes.status}`);
    
    const geminiData = await geminiRes.json();
    const analysisReport = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!analysisReport) throw new Error('AIからの応答が空です。');

    const finalReport = analysisReport.trim();

    await kv.set(cacheKey, finalReport, { ex: CACHE_DURATION_SECONDS });
    console.log(`[Cache Set] for report: ${cacheKey}`);

    res.status(200).json({ report: finalReport });

  } catch (error: any) {
    console.error('An error occurred in analyze-company-news handler:', error);
    res.status(500).json({ error: error.message });
  }
}
