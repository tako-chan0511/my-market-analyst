import { describe, it, expect } from 'vitest';
// getAttentionLevel はまだ存在しないため、以下の行はエラーになります（それで正常です）
import { calculateAttentionScore, getAttentionLevel } from './attentionScore';

describe('calculateAttentionScore', () => {

  // このテストは既存のもので、変更ありません
  it('指定されたキーワードに基づいて注目度スコアを正しく計算する', () => {
    const reportText = `
      当社の新製品は、市場のDXを強力に推進します。
      しかし、いくつかの課題も残されています。
    `;
    // 「新製品」(+10), 「DX」(+10), 「課題」(+5) = 合計 25点
    const expectedScore = 25;
    expect(calculateAttentionScore(reportText)).toBe(expectedScore);
  });

  // このテストも既存のもので、変更ありません
  it('キーワードが含まれない場合は0を返す', () => {
    const reportText = '本日の天気は晴れです。特に報告事項はありません。';
    const expectedScore = 0;
    expect(calculateAttentionScore(reportText)).toBe(expectedScore);
  });

});

// --- ADDED: ここから新しいテストを追加 ---
describe('getAttentionLevel', () => {

  it('スコアが30以上の場合は「高」を返す', () => {
    // このテストは "getAttentionLevel is not defined" エラーで失敗するはず
    expect(getAttentionLevel(30)).toBe('高');
    expect(getAttentionLevel(50)).toBe('高');
  });

  it('スコアが10以上30未満の場合は「中」を返す', () => {
    expect(getAttentionLevel(10)).toBe('中');
    expect(getAttentionLevel(29)).toBe('中');
  });

  it('スコアが10未満の場合は「低」を返す', () => {
    expect(getAttentionLevel(0)).toBe('低');
    expect(getAttentionLevel(9)).toBe('低');
  });

});
