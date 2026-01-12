import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';

type GeminiApiVersion = 'v1beta' | 'v1';

type GeminiModel = {
  name?: string; // e.g. "models/gemini-2.0-flash"
  supportedGenerationMethods?: string[];
};

type GeminiListModelsResponse = {
  models?: GeminiModel[];
};

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function scrapeArticleText(url: string): Promise<string> {
  try {
    const resp = await fetchWithTimeout(
      url,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
      8000
    );
    if (!resp.ok) return '';

    const contentType = resp.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return '';

    const html = await resp.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, noscript').remove();

    const text = normalizeText($('body').text());
    // 取りすぎるとプロンプトが肥大化するので強めに制限
    return text.substring(0, 2000);
  } catch {
    return '';
  }
}

/**
 * ===== KV (Upstash REST) : @vercel/kv を使わず fetch で直叩き =====
 * - `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Vercel KV)
 * - もしくは `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (Upstash直)
 */
function getKvConfig(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL ??
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.UPSTASH_REDIS_REST_URL; // 念のため重複

  const token =
    process.env.KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  // 末尾スラッシュを除去
  return { url: url.replace(/\/+$/, ''), token };
}

async function kvGetString(key: string): Promise<string | null> {
  const cfg = getKvConfig();
  if (!cfg) return null;

  // GET /get/<key> は値が短い想定、キーはエンコード
  const endpoint = `${cfg.url}/get/${encodeURIComponent(key)}`;
  const resp = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
    },
  });

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`KV GET failed: ${resp.status} ${raw}`);
  }

  const data = JSON.parse(raw) as { result?: unknown; error?: string };
  if (data?.error) throw new Error(`KV GET error: ${data.error}`);

  if (typeof data?.result === 'string') return data.result;
  // null のこともある
  return null;
}

async function kvSetEx(key: string, value: string, ttlSeconds: number): Promise<void> {
  const cfg = getKvConfig();
  if (!cfg) return;

  // 値が長いので /pipeline を使ってボディに載せる
  const endpoint = `${cfg.url}/pipeline`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([['SETEX', key, ttlSeconds, value]]),
  });

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`KV SETEX failed: ${resp.status} ${raw}`);
  }

  const data = JSON.parse(raw) as Array<{ result?: unknown; error?: string }> | { error?: string };
  if (!Array.isArray(data)) {
    throw new Error(`KV pipeline unexpected response (not array): ${raw}`);
  }
  const first = data[0];
  if (first?.error) {
    throw new Error(`KV SETEX error: ${first.error}`);
  }
}

/**
 * ===== Gemini (REST) =====
 */
async function listModels(version: GeminiApiVersion, apiKey: string): Promise<GeminiModel[]> {
  const url = `https://generativelanguage.googleapis.com/${version}/models`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'x-goog-api-key': apiKey,
    },
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`ListModels failed (${version}): ${resp.status} ${detail}`);
  }

  const data = (await resp.json()) as GeminiListModelsResponse;
  return Array.isArray(data?.models) ? data.models : [];
}

function shortModelName(fullName: string): string {
  return fullName.replace(/^models\//, '');
}

function modelSupportsGenerateContent(m: GeminiModel): boolean {
  const methods = m.supportedGenerationMethods;
  // 古いレスポンス等でフィールドが無い場合は「試す価値あり」とみなす
  if (!Array.isArray(methods) || methods.length === 0) return true;
  return methods.includes('generateContent');
}

async function generateContent(version: GeminiApiVersion, model: string, apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
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

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`Gemini generateContent failed (${version}/${model}): ${resp.status} ${raw}`);
  }

  const data = JSON.parse(raw) as any;
  const text: unknown = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`Gemini response is empty (${version}/${model}). raw=${raw}`);
  }
  return text;
}

function isGeminiNotFoundOrUnsupported(errMsg: string): boolean {
  // 404 のときに "not found" / "not supported" が混ざるケースが多い
  return errMsg.includes(': 404') || errMsg.includes('"code": 404') || errMsg.includes('NOT_FOUND');
}

async function generateWithAutoPick(apiKey: string, prompt: string): Promise<{ version: GeminiApiVersion; model: string; text: string }> {
  const preferred = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-lite'];

  for (const version of ['v1beta', 'v1'] as const) {
    let models: GeminiModel[] = [];
    try {
      models = await listModels(version, apiKey);
    } catch (e: any) {
      console.warn(`[WARN] listModels failed: ${String(e?.message ?? e)}`);
      continue;
    }

    const available = models
      .filter((m) => typeof m?.name === 'string')
      .map((m) => shortModelName(m.name as string))
      .filter((n) => n);

    const generateCapable = new Set(
      models
        .filter((m) => typeof m?.name === 'string' && modelSupportsGenerateContent(m))
        .map((m) => shortModelName(m.name as string))
    );

    // preferred を優先し、無ければ generateContent できそうなモデルを前から試す
    const candidates: string[] = [];
    for (const p of preferred) {
      if (available.includes(p)) candidates.push(p);
    }
    for (const a of available) {
      if (!candidates.includes(a)) candidates.push(a);
    }

    for (const model of candidates) {
      // supportedGenerationMethods があるなら generateContent 対応だけ試す（無いなら試す）
      if (generateCapable.size > 0 && !generateCapable.has(model)) continue;

      try {
        const text = await generateContent(version, model, apiKey, prompt);
        return { version, model, text };
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        console.warn(`[WARN] generateContent failed: ${msg}`);
        if (isGeminiNotFoundOrUnsupported(msg)) continue; // 次のモデル/バージョンへ
        throw e; // それ以外（認証/課金/レート等）は即エラー
      }
    }
  }

  throw new Error('No working Gemini model found (checked v1beta/v1).');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('=== [VER 2.8] analyze-company-news (Gemini auto-pick v1beta/v1, KV via REST fetch) ===');

  if (req.method !== 'POST') return res.status(405).end();

  const { companyName } = (req.body ?? {}) as { companyName?: unknown };
  if (typeof companyName !== 'string' || companyName.trim() === '') {
    return res.status(400).json({ error: 'companyName is required.' });
  }

  const gnewsApiKey = process.env.GNEWS_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!gnewsApiKey) return res.status(500).json({ error: 'GNEWS_API_KEY is not set.' });
  if (!geminiApiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not set.' });

  const cacheKey = `report:${companyName.toLowerCase().replace(/\s/g, '')}`;

  try {
    // 0) キャッシュ（失敗しても本処理は続行）
    try {
      const cached = await kvGetString(cacheKey);
      if (typeof cached === 'string' && cached.trim()) {
        return res.status(200).json({ report: cached.trim(), cached: true });
      }
    } catch (e: any) {
      console.warn(`[WARN] KV get skipped: ${String(e?.message ?? e)}`);
    }

    // 1) GNews 検索
    const gnewsUrl =
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(companyName)}` +
      `&lang=ja&country=jp&max=3&apikey=${gnewsApiKey}`;

    const gnewsResp = await fetchWithTimeout(gnewsUrl, { method: 'GET' }, 8000);
    const gnewsRaw = await gnewsResp.text();
    if (!gnewsResp.ok) {
      throw new Error(`GNews failed: ${gnewsResp.status} ${gnewsRaw}`);
    }

    const newsData = JSON.parse(gnewsRaw) as any;
    const articles = newsData && Array.isArray(newsData.articles) ? newsData.articles : [];
    if (articles.length === 0) {
      return res.status(404).json({ error: '関連ニュースが見つかりませんでした。' });
    }

    // 2) スクレイピング
    const articleTexts = await Promise.all(articles.map((a: any) => scrapeArticleText(a?.url)));
    const combinedText = articleTexts.filter((t) => t.length > 50).join('\n\n---\n\n');
    if (!combinedText) {
      return res.status(404).json({ error: '記事本文を取得できませんでした。' });
    }

    // 3) Gemini（モデル＆version 自動選択 → generateContent）
    const prompt =
      `あなたはマーケットアナリストです。` +
      `「${companyName}」について、直近ニュースを根拠にした分析レポートをMarkdownで作成してください。\n\n` +
      `# 必須構成\n` +
      `- 主要トピック（箇条書き）\n` +
      `- ポジティブ要因 / ネガティブ要因\n` +
      `- 今後の注目点（短期/中期）\n` +
      `- 参考（ニュース要約）\n\n` +
      `# ニュース本文（抜粋）\n${combinedText}`;

    const generated = await generateWithAutoPick(geminiApiKey, prompt);
    console.log('[DEBUG] Gemini picked:', { version: generated.version, model: generated.model });

    const report = generated.text.trim();

    // 4) キャッシュ保存（失敗しても本処理は成功扱い）
    try {
      await kvSetEx(cacheKey, report, 86400 * 7);
    } catch (e: any) {
      console.warn(`[WARN] KV set skipped: ${String(e?.message ?? e)}`);
    }

    return res.status(200).json({ report, cached: false });
  } catch (error: any) {
    console.error('Final Error Handler:', error?.message ?? error);
    return res.status(500).json({ error: error?.message ?? String(error) });
  }
}
