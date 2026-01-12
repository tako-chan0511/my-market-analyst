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
  // 反映確認用の目立つログ
  console.log('=== [VER 2.1 - CACHE DISABLED] analyze-company-news called ===');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "POST method required." });
  }

  const { companyName } = req.body;
  const gnewsApiKey = process.env.GNEWS_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!companyName) return res.status(400).json({ error: '企業名が必要です。' });
  if (!gnewsApiKey || !geminiApiKey) return res.status(500).json({ error: 'APIキー未設定' });

  try {
    const cacheKey = `report:${companyName.toLowerCase().replace(/\s/g, '')}`;

    // --- 【動作確認のため一時的にキャッシュを無効化】 ---
    // const cachedReport: string | null = await kv.get(cacheKey);
    const cachedReport = null; 
    
    if (cachedReport) {
      console.log(`[Cache Hit] returning cached report.`);
      return res.status(200).json({ report: cachedReport });
    }

    const gnewsUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent(companyName)}&lang=ja&country=jp&max=5&apikey=${gnewsApiKey}`;
    const gnewsRes = await fetch(gnewsUrl);
    const newsData: any = await gnewsRes.json();

    if (!gnewsRes.ok) throw new Error(`GNews Error: ${gnewsRes.status}`);

    // 【最重要】articles の存在と配列チェックを厳格に行う
    const articles = (newsData && Array.isArray(newsData.articles)) ? newsData.articles : [];
    console.log('Detected articles count:', articles.length);

    if (articles.length === 0) {
      return res.status(404).json({ error: '関連ニュースが見つかりませんでした。' });
    }

    // スクレイピング処理
    const scrapingPromises = articles.map((article: any) => {
      if (!article || !article.url) return Promise.resolve("");
      return scrapeArticleText(article.url);
    });
    
    const articleTexts = await Promise.all(scrapingPromises);
    const allArticleTexts = articleTexts.filter(text => text && text.length > 100);

    if (allArticleTexts.length === 0) throw new Error('記事本文を抽出できませんでした。');

    // Gemini分析
    const prompt = `マーケットアナリストとして「${companyName}」を分析してください。\n\n記事本文：\n${allArticleTexts.join('\n\n')}`;
    const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    const geminiData = await geminiRes.json();
    const analysisReport = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!analysisReport) throw new Error('AI応答が空です');

    // 成功したらキャッシュに保存（※読み込みはスキップ中）
    await kv.set(cacheKey, analysisReport, { ex: 86400 * 7 });
    
    res.status(200).json({ report: analysisReport.trim() });

  } catch (error: any) {
    console.error('Error detail:', error.message);
    res.status(500).json({ error: error.message });
  }
}