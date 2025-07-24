import { describe, it, expect } from 'vitest';
// attentionScore.ts はまだ存在しないため、以下の行はエラーになります（それで正常です）
import { calculateAttentionScore } from './attentionScore';

describe('calculateAttentionScore', () => {

  // テストケース1: キーワードが複数含まれる場合
  it('指定されたキーワードに基づいて注目度スコアを正しく計算する', () => {
    const reportText = `
      当社の新製品は、市場のDXを強力に推進します。
      しかし、いくつかの課題も残されています。
    `;
    // 「新製品」(+10), 「DX」(+10), 「課題」(+5) = 合計 25点
    const expectedScore = 25;

    // このテストは "calculateAttentionScore is not defined" エラーで失敗するはず
    expect(calculateAttentionScore(reportText)).toBe(expectedScore);
  });

  // テストケース2: キーワードが一つも含まれない場合
  it('キーワードが含まれない場合は0を返す', () => {
    const reportText = '本日の天気は晴れです。特に報告事項はありません。';
    const expectedScore = 0;

    expect(calculateAttentionScore(reportText)).toBe(expectedScore);
  });

});