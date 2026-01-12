import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';
import { kv } from '@vercel/kv';

type GeminiApiVersion = 'v1beta' | 'v1';

async function scrapeArticleText(url: string): Promise<string> {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return '';
    const html = await response.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header').remove();
    return $('body').text().trim().substring(0, 2000);
  } catch {
    return '';
  }
}

async function listModels(version: GeminiApiVersion, apiKey: string): Promise<string[]> {
  const url = `https://generativelanguage.googleapis.com/${version}/models`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'x-goog-api-key': apiKey }, // 公式推奨
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`ListModels failed (${version}): ${res.status} ${detail}`);
  }

  const data: any = await res.json();
  const models = Array.isArray(data?.models) ? data.models : [];
  return models.map((m: any) => m?.name).filter((n: any) => typeof n === 'string');
}

async function pickModelAndVersion(apiKey: string): Promise<{ version: GeminiApiVersion; model: string; available: string[] }> {
  // 使いたい順（必要ならここに追加）
  const preferred = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-lite'];

  // 公式例は v1beta が中心なので、まず v1beta を試す :contentReference[oaicite:3]{index=3}
  for (const version of ['v1beta', 'v1'] as const) {
    try {
      const names = await listModels(version, apiKey);
      const short = new Set(names.map((n) => n.replace(/^models\//, '')));
      const hit = preferred.find((p) => short.has(p));
      if (hit) return { version, model: hit, available: names };
      // preferred が無いが何かはある、という状況もログで追えるよう返す候補を保持
      if (names.length > 0) return { version, model: names[0].replace(/^models\//, ''), available: names };
    } catch (e) {
      console.warn(`[WARN] ${String(e)}`);
      // 次のversionへ
    }
  }

  throw new Error('No models available for this API key (checked v1beta and v1).');
}

async function generateContent(
  version: GeminiApiVersion,
  model: string,
  apiKey: string,
  prompt: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey, // 公式推奨 :contentReference[oaicite:4]{index=4}
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini generateContent failed: ${res.status} ${detail}`);
  }

  const data: any = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini response is empty.');
  return text;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('=== [VER 2.6] Gemini model/version auto-pick (v1beta/v1) ===');

  if (req.method !== 'POST') return res.status(405).end();

  const { companyName } = req.body ?? {};
  if (typeof companyName !== 'string' || companyName.trim() === '') {
    return res.status(400).json({ error: 'companyName is required.' });
  }

  const gnewsApiKey = process.env.GNEWS_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  // env未設定だと後段が分かりにくいので、ここで明確に落とす
  if (!gnewsApiKey) return res.status(500).json({ error: 'GNEWS_API_KEY is not set.' });
  if (!geminiApiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not set.' });

  try {
    const cacheKey = `report:${companyName.toLowerCase().replace(/\s/g, '')}`;

    // ✅ キャッシュがあれば即返す（あなたのコードは set だけで get が無かった）
    const cached = await kv.get(cacheKey);
    if (typeof cached === 'string' && cached.trim()) {
      return res.status(200).json({ report: cached.trim(), cached: true });
    }

    // 1) GNews 検索
    const gnewsUrl =
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(companyName)}` +
      `&lang=ja&country=jp&max=3&apikey=${gnewsApiKey}`;
    const gnewsRes = await fetch(gnewsUrl);
    const newsData: any = await gnewsRes.json();
    const articles = newsData && Array.isArray(newsData.articles) ? newsData.articles : [];
    if (articles.length === 0) return res.status(404).json({ error: '関連ニュースが見つかりませんでした。' });

    // 2) スクレイピング
    const articleTexts = await Promise.all(articles.map((a: any) => scrapeArticleText(a.url)));
    const combinedText = articleTexts.filter((t) => t.length > 50).join('\n\n---\n\n');
    if (!combinedText) return res.status(404).json({ error: '記事本文を取得できませんでした。' });

    // 3) Gemini（モデル＆version自動選択 → generateContent）
    const prompt =
      `マーケットアナリストとして「${companyName}」の分析レポートをMarkdown形式で作成してください。\n\n資料：\n${combinedText}`;

    const picked = await pickModelAndVersion(geminiApiKey);
    console.log('[DEBUG] Picked Gemini:', { version: picked.version, model: picked.model });
    console.log('[DEBUG] Available models (first 10):', picked.available.slice(0, 10));

    const analysisReport = await generateContent(picked.version, picked.model, geminiApiKey, prompt);

    // 4) キャッシュ保存と返却
    await kv.set(cacheKey, analysisReport.trim(), { ex: 86400 * 7 });
    return res.status(200).json({ report: analysisReport.trim(), cached: false });

  } catch (error: any) {
    console.error('Final Error Handler:', error?.message ?? error);
    return res.status(500).json({ error: error?.message ?? String(error) });
  }
}
