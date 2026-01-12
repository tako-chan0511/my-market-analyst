// api/ask-follow-up.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

type GeminiApiVersion = 'v1beta' | 'v1';

type GeminiModel = {
  name?: string; // e.g. "models/gemini-2.0-flash"
  supportedGenerationMethods?: string[];
};

type GeminiListModelsResponse = {
  models?: GeminiModel[];
};

function clampText(s: string, maxChars: number): string {
  const t = String(s ?? '');
  return t.length > maxChars ? t.slice(0, maxChars) : t;
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

/**
 * ===== Gemini (REST) =====
 */
async function listModels(version: GeminiApiVersion, apiKey: string): Promise<GeminiModel[]> {
  const url = `https://generativelanguage.googleapis.com/${version}/models`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
    },
    8000
  );

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
  // フィールドが無い/空なら「試す」
  if (!Array.isArray(methods) || methods.length === 0) return true;
  return methods.includes('generateContent');
}

async function generateContent(version: GeminiApiVersion, model: string, apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;

  const resp = await fetchWithTimeout(
    url,
    {
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
    },
    30000
  );

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`Gemini API request failed (${version}/${model}): ${resp.status} ${raw}`);
  }

  const data = JSON.parse(raw) as any;
  const text: unknown = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`Gemini response is empty (${version}/${model}). raw=${raw}`);
  }
  return text;
}

function isGeminiNotFoundOrUnsupported(errMsg: string): boolean {
  // 404 not found / not supported が混ざるケースが多い
  return errMsg.includes(': 404') || errMsg.includes('"code": 404') || errMsg.includes('NOT_FOUND');
}

async function generateWithAutoPick(
  apiKey: string,
  prompt: string
): Promise<{ version: GeminiApiVersion; model: string; text: string }> {
  // 使いたい順（必要なら追加）
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

    // preferred優先 → それ以外も順に試す
    const candidates: string[] = [];
    for (const p of preferred) if (available.includes(p)) candidates.push(p);
    for (const a of available) if (!candidates.includes(a)) candidates.push(a);

    for (const model of candidates) {
      if (generateCapable.size > 0 && !generateCapable.has(model)) continue;

      try {
        const text = await generateContent(version, model, apiKey, prompt);
        return { version, model, text };
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        console.warn(`[WARN] generateContent failed: ${msg}`);
        if (isGeminiNotFoundOrUnsupported(msg)) continue; // 次へ
        throw e; // 認証/課金/レート等は即エラー
      }
    }
  }

  throw new Error('No working Gemini model found (checked v1beta/v1).');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('=== [VER 1.1] ask-follow-up (Gemini auto-pick v1beta/v1) ===');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST method required.' });
  }

  const { analysisReport, question } = (req.body ?? {}) as {
    analysisReport?: unknown;
    question?: unknown;
  };

  if (typeof analysisReport !== 'string' || analysisReport.trim() === '') {
    return res.status(400).json({ error: '分析レポートが必要です。' });
  }
  if (typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ error: '質問が必要です。' });
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return res.status(500).json({ error: 'Gemini APIキーがサーバーに設定されていません。' });
  }

  try {
    // プロンプト肥大化で失敗しやすいので、適度に制限（必要なら調整）
    const report = clampText(analysisReport, 12000);
    const q = clampText(question, 2000);

    const prompt = `
あなたは優秀なマーケットアナリストです。
以下の「これまでの分析レポート」の内容を踏まえた上で、ユーザーからの「追加の質問」に、専門家として回答してください。

【重要】回答は必ず以下のルールに従ってください。
- 全体をMarkdown形式で、見出し、太字、リストなどを使用して構造化する。
- 企業間の比較を求められた場合は、必ずMarkdownのテーブル形式（表）で見やすくまとめる。
- 特に強調したいキーワードは **太字** で表現する。

---これまでの分析レポート---
${report}

---追加の質問---
${q}

---回答---
`.trim();

    const generated = await generateWithAutoPick(geminiApiKey, prompt);
    console.log('[DEBUG] Gemini picked:', { version: generated.version, model: generated.model });

    return res.status(200).json({ answer: generated.text.trim() });
  } catch (error: any) {
    console.error('An error occurred in ask-follow-up handler:', error?.message ?? error);
    return res.status(500).json({ error: error?.message ?? 'サーバーでエラーが発生しました。' });
  }
}
