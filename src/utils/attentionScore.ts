// キーワードとスコアの定義
const KEYWORD_SCORES: { [key: string]: number } = {
  '新製品': 10,
  'DX': 10,
  '提携': 10,
  '課題': 5,
};

/**
 * レポート本文からキーワードを検出し、注目度スコアを算出します。
 * キーワードのマッチングはケースインセンシティブ（大文字・小文字を区別しない）です。
 * 各キーワードは、複数回出現しても1回としてカウントされます。
 *
 * @param text - 分析対象のレポート本文
 * @returns 算出された注目度スコア
 */
export function calculateAttentionScore(text: string): number {
  if (!text) {
    return 0;
  }

  let totalScore = 0;
  const lowerCaseText = text.toLowerCase();

  // 定義された各キーワードについてループ処理
  for (const keyword in KEYWORD_SCORES) {
    // レポート本文にキーワードが含まれているか、大文字・小文字を区別せずにチェック
    if (lowerCaseText.includes(keyword.toLowerCase())) {
      // 含まれていればスコアを加算
      totalScore += KEYWORD_SCORES[keyword];
    }
  }

  return totalScore;
}
