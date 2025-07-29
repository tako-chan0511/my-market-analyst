/**
 * このファイルは、レポートテキストから注目度スコアを計算するためのロジックを定義します。
 */

// キーワードとそれに対応するスコアを定義します。
const KEYWORD_SCORES: { [key: string]: number } = {
  '新製品': 10,
  'DX': 10,
  '提携': 10,
  '課題': 5,
};

/**
 * 指定されたテキスト内のキーワードを検出し、注目度スコアを計算します。
 * * @param text - スコアを計算する対象のレポートテキスト。
 * @returns 計算された注目度スコアの合計値。
 */
export function calculateAttentionScore(text: string): number {
  // テキストが空またはnullの場合は、スコア0を返します。
  if (!text) {
    return 0;
  }

  let totalScore = 0;
  const lowerCaseText = text.toLowerCase(); // DXのようなキーワードを小文字で検索するため、テキスト全体を小文字に変換

  // 定義された各キーワードについてループ処理を行います。
  for (const keyword in KEYWORD_SCORES) {
    // 'g'フラグで全ての出現箇所を検索し、'i'フラグで大文字・小文字を区別しないようにします。
    // これにより、"DX" と "dx" の両方がマッチします。
    const regex = new RegExp(keyword, 'gi');
    
    // テキスト内からキーワードの出現箇所をすべて検索します。
    const matches = text.match(regex);

    // キーワードが見つかった場合、その回数分スコアを加算します。
    if (matches) {
      totalScore += matches.length * KEYWORD_SCORES[keyword];
    }
  }

  return totalScore;
}
