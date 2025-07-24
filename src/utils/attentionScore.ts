
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
} as const; // 定数として関数の外で定義

/**
 * レポートのテキストから注目度スコアを計算します。
 * @param reportText レポートの全文
 * @returns 注目度スコア
 */
export const calculateAttentionScore = (reportText: string): number => {
  let score = 0;


  // オブジェクトの各キー（キーワード）をループ処理
  for (const keyword in KEYWORD_SCORES) {
    // レポートテキストにキーワードが含まれているかチェック
    if (reportText.includes(keyword)) {
      // 含まれていればスコアを加算
      score += KEYWORD_SCORES[keyword as keyof typeof KEYWORD_SCORES];
    }
  }

  return score;
};