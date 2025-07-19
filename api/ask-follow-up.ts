// api/ask-follow-up.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "POST method required." });
  }

  const { analysisReport, question } = req.body;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!analysisReport || !question) {
    return res.status(400).json({ error: '分析レポートと質問の両方が必要です。' });
  }
  if (!geminiApiKey) {
    return res.status(500).json({ error: 'Gemini APIキーがサーバーに設定されていません。' });
  }

  try {
    const prompt = `
      あなたは優秀なマーケットアナリストです。
      以下の「これまでの分析レポート」の内容を踏まえた上で、ユーザーからの「追加の質問」に、専門家として簡潔かつ的確に回答してください。

      ---これまでの分析レポート---
      ${analysisReport}
      
      ---追加の質問---
      ${question}
      
      ---回答（Markdown形式）---
    `;
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`;
    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    if (!apiResponse.ok) throw new Error(`AI APIがエラー: ${apiResponse.status}`);
    
    const responseData = await apiResponse.json();
    const answer = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!answer) throw new Error('AIからの応答が空です。');

    res.status(200).json({ answer: answer.trim() });

  } catch (error: any) {
    console.error('An error occurred in ask-follow-up handler:', error);
    res.status(500).json({ error: error.message });
  }
}