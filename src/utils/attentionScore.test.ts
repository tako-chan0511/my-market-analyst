import { describe, it, expect } from 'vitest';
import { calculateAttentionScore } from './attentionScore';

// テストスイート: 注目度スコア計算ロジック
describe('calculateAttentionScore', () => {

  // テストケース1: すべてのキーワードが1回ずつ出現する場合
  it('should return the correct score when all keywords appear once', () => {
    const text = '当社の新製品は、DXを推進し、A社との提携により、市場の課題を解決します。';
    // 新製品(10) + DX(10) + 提携(10) + 課題(5) = 35
    expect(calculateAttentionScore(text)).toBe(35);
  });

  // テストケース2: 特定のキーワードが複数回出現する場合
  it('should handle multiple occurrences of the same keyword', () => {
    const text = 'この新製品は画期的な新製品です。';
    // 新製品(10) + 新製品(10) = 20
    expect(calculateAttentionScore(text)).toBe(20);
  });

  // テストケース3: キーワードが全く出現しない場合
  it('should return 0 when no keywords are found', () => {
    const text = '本日の天気は晴れです。特に変わったことはありません。';
    expect(calculateAttentionScore(text)).toBe(0);
  });

  // テストケース4: テキストが空の場合
  it('should return 0 for an empty string', () => {
    const text = '';
    expect(calculateAttentionScore(text)).toBe(0);
  });

  // テストケース5: 大文字・小文字のキーワードが混在している場合 (例: DX)
  it('should be case-insensitive for keywords like "DX"', () => {
    const text = '当社のdx戦略は、新たな価値を創造します。';
    // DX(10)
    expect(calculateAttentionScore(text)).toBe(10);
  });
  
  // テストケース6: 課題キーワードのみの場合
  it('should correctly score only the "課題" keyword', () => {
    const text = '当社の課題は、コスト削減です。';
    // 課題(5)
    expect(calculateAttentionScore(text)).toBe(5);
  });

  // テストケース7: 複数のキーワードが複雑に組み合わさっている場合
  it('should calculate the score correctly for a complex text', () => {
    const text = 'A社の新製品発表会に参加。DXに関する提携の可能性と、今後の課題について議論した。この提携が成功すれば、大きな前進だ。';
    // 新製品(10) + DX(10) + 提携(10) + 課題(5) + 提携(10) = 45
    expect(calculateAttentionScore(text)).toBe(45);
  });
});
