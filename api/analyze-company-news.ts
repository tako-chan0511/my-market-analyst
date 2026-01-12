import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';
import { kv } from '@vercel/kv';

type GeminiApiVersion = 'v1beta' | 'v1';

const SCRAPE_MAX_CHARS = 2000;
const CACHE_TTL_SEC = 86400 * 7; // 7 days
const FETCH_TIMEOUT_MS = 15000;

function normalizeCompanyKey(companyName: string): string {
  return companyName.toLowerCase().replace(/\s/g, '');
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeArticleText(url: string): Promise<string> {
  try {
    const resp = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
      12000
    );
    if (!resp.ok) return '';

    const html = await resp.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header').remove();

    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return text.substring(0, SCRAPE_MAX_CHARS);
  } catch {
    return '';
  }
}

async function listModels(version: GeminiApiVersion, apiKey: string): Promise<string[]> {
  const url = `https://generativelanguage.googleapis.com/${version}/models`;
  const resp = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { 'x-goog-api-key': apiKey },
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`ListModels failed (${version}): ${resp.status} ${detail}`);
  }

  const data: unknown = await resp.json();
  const models = (data as any)?.models;
  if (!Array.isArray(models)) return [];

  return models
    .map((m: any) => m?.name)
    .filter((n: any) => typeof n === 'string') as string[];
}

async function pickModelAndVersion(
  apiKey: string
): Promise<{ version: GeminiApiVersion; model: string; available: string[] }> {
  const preferred = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite',
  ];

  for (const version of ['v1beta', 'v1'] as const) {
    try {
      const names = await listModels(version, apiKey); // ["models/xxx", ...]
      const short = new Set(names.map((n) => n.replace(/^models\//, '')));

      const hit = preferred.find((p) => short.has(p));
      if (hit) return { version, model: hit, available: names };

      if (names.length > 0) {
        // preferredが無いが何かはある場合、先頭を返す（デバッグ用）
        return { version, model: names[0].replace(/^models\//, ''), available: names };
      }
    } catch (e) {
      console.warn(`[WARN] pickModelAndVersion: ${String(e)}`);
    }
  }

  throw new Error('No models available for this API key (checked v1beta and v1).');
}

function extractCandidateText(geminiResponse: any): string {
  const parts = geminiResponse?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p: any) => p?.text ?? '').join('').trim();
}

async function generateContent(
  version: GeminiApiVersion,
  model: string,
  apiKey: string,
  prompt: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;

  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
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

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Gemini generateContent failed: ${resp.status} ${detail}`);
  }

  const data = await resp.json();
  const text = extractCandidateText(data);
  if (!text) throw new Error('Gemini response is empty.');
  return text;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('=== [VER 2.7] analyze-company-news (Gemini model/version auto-pick v1beta/v1) ===');

  if (req.method !== 'POST') return res.status(405).end();

  const { companyName } = (req.body ?? {}) as { companyName?: unknown };
  if (typeof companyName !== 'string' || companyName.trim() === '') {
    return res.status(400).json({ error: 'companyName is required.' });
  }

  const gnewsApiKey = process.env.GNEWS_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!gnewsApiKey) return res.status(500).json({ error: 'GNEWS_API_KEY is not set.' });
  if (!geminiApiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not set.' });

  try {
    const cacheKey = `report:${normalizeCompanyKey(companyName)}`;

    // キャッシュがあれば即返す
    const cached = await kv.get(cacheKey);
    if (typeof cached === 'string' && cached.trim()) {
      return res.status(200).json({ report: cached.trim(), cached: true });
    }

    // 1) GNews 検索
    const gnewsUrl =
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(companyName)}` +
      `&lang=ja&country=jp&max=3&apikey=${gnewsApiKey}`;

    const gnewsResp = await fetchWithTimeout(gnewsUrl, { method: 'GET' });
    if (!gnewsResp.ok) {
      const detail = await gnewsResp.text();
      console.error('[ERROR] GNews error:', gnewsResp.status, detail);
      return res.status(502).json({ error: `GNews API error: ${gnewsResp.status}` });
    }

    const newsData: any = await gnewsResp.json();
    const articles = Array.isArray(newsData?.articles) ? newsData.articles : [];
    if (articles.length === 0) {
      return res.status(404).json({ error: '関連ニュースが見つかりませんでした。' });
    }

    // 2) スクレイピング
    const articleTexts = await Promise.all(
      articles.map((a: any) => scrapeArticleText(String(a?.url ?? '')))
    );
    const combinedText = articleTexts.filter((t) => t.length > 50).join('\n\n---\n\n');

    if (!combinedText) {
      return res.status(404).json({ error: '記事本文を取得できませんでした。' });
    }

    // 3) Gemini（モデル＆version自動選択 → generateContent）
    const prompt =
      `あなたはマーケットアナリストです。「${companyName}」について、以下の記事内容を根拠に` +
      `分析レポートをMarkdown形式で作成してください。\n\n` +
      `【レポート要件】\n` +
      `- 直近のトピック要約\n` +
      `- ポジティブ要因/ネガティブ要因\n` +
      `- 今後の注目点（3つ）\n` +
      `- 注意点（情報が不十分な場合はその旨を明記）\n\n` +
      `【記事本文】\n${combinedText}`;

    const picked = await pickModelAndVersion(geminiApiKey);
    console.log('[DEBUG] Picked Gemini:', { version: picked.version, model: picked.model });
    console.log('[DEBUG] Available models (first 10):', picked.available.slice(0, 10));

    const analysisReport = await generateContent(picked.version, picked.model, geminiApiKey, prompt);

    // 4) キャッシュ保存と返却
    await kv.set(cacheKey, analysisReport.trim(), { ex: CACHE_TTL_SEC });
    return res.status(200).json({ report: analysisReport.trim(), cached: false });

  } catch (error: any) {
    // ここで stack も出すと、次回の特定が一瞬で終わります
    console.error('Final Error Handler:', error);
    return res.status(500).json({ error: error?.message ?? String(error) });
  }
}
