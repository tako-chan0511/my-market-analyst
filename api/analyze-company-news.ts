// api/analyze-company-news.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';

// ヘルパー関数：指定されたURLから本文を抽出する
async function scrapeArticleText(url: string): Promise<string> {
  try {
    const articleResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    if (!articleResponse.ok) return ""; // 失敗したら空文字を返す
    
    const html = await articleResponse.text();
    const $ = cheerio.load(html);
    $('script, style, noscript, nav, footer, header, aside, form').remove();
    return $('body').text().trim().replace(/\s{2,}/g, '\n\n');
  } catch (error) {
    console.error(`Scraping error for ${url}:`, error);
    return ""; // エラー時も空文字を返す
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- 1. リクエストと環境変数の準備 ---
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
    // --- 2. GNews APIで関連ニュースを検索 ---
    const gnewsParams = new URLSearchParams({
      q: companyName,
      lang: 'ja',
      country: 'jp',
      max: '5', // 5件のニュースを取得
      apikey: gnewsApiKey,
    });
    const gnewsUrl = `https://gnews.io/api/v4/search?${gnewsParams.toString()}`;
    const gnewsRes = await fetch(gnewsUrl);
    if (!gnewsRes.ok) throw new Error('GNews APIからのニュース取得に失敗しました。');
    
    const newsData = await gnewsRes.json();
    const articles = newsData.articles || [];
    if (articles.length === 0) {
      return res.status(404).json({ error: '関連するニュースが見つかりませんでした。' });
    }

    // --- 3. 各ニュース記事の本文を並行してスクレイピング ---
    const scrapingPromises = articles.map((article: any) => scrapeArticleText(article.url));
    const allArticleTexts = (await Promise.all(scrapingPromises)).filter(text => text.length > 100); // 短すぎる記事は除外

    if (allArticleTexts.length === 0) {
      throw new Error('ニュース記事から十分なテキストを抽出できませんでした。');
    }

    // --- 4. Gemini APIに分析を依頼 ---
    const combinedText = allArticleTexts.join('\n\n---\n\n'); // 全記事のテキストを結合
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

    // --- 5. フロントエンドに分析レポートを返す ---
    res.status(200).json({ report: analysisReport.trim() });

  } catch (error: any) {
    console.error('An error occurred in analyze-company-news handler:', error);
    res.status(500).json({ error: error.message });
  }
}