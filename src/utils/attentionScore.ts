/**
 * スコア計算に使うキーワードと点数の対応表
 */
const KEYWORD_SCORES = {
  '新製品': 10,
  'DX': 10,
  '提携': 10,
  '構造改革': 5,
  '課題': 5,
  'リスク': 5,
} as const;

/**
 * 注目度レベル
 */
export type AttentionLevel = '高' | '中' | '低';

/**
 * レポートのテキストから注目度スコアを計算します。
 * @param reportText レポートの全文
 * @returns 注目度スコア
 */
export const calculateAttentionScore = (reportText: string): number => {
  let score = 0;

  for (const keyword in KEYWORD_SCORES) {
    if (reportText.includes(keyword)) {
      score += KEYWORD_SCORES[keyword as keyof typeof KEYWORD_SCORES];
    }
  }

  return score;
};

/**
 * --- ADDED: ここから新しい関数を追加 ---
 * スコアから注目度レベル（高・中・低）を判定します。
 * @param score 注目度スコア
 * @returns 注目度レベル
 */
export const getAttentionLevel = (score: number): AttentionLevel => {
  if (score >= 30) {
    return '高';
  }
  if (score >= 10) {
    return '中';
  }
  return '低';
};
