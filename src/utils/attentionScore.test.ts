import { describe, it, expect } from 'vitest';
import { calculateAttentionScore } from './attentionScore';

describe('calculateAttentionScore', () => {
  // テストケース1: すべてのキーワードが含まれる場合
  it('should return the total score when all keywords are present', () => {
    const text = '当社の新製品は、DXを推進し、A社との提携を通じて、市場の課題を解決します。';
    // 新製品(10) + DX(10) + 提携(10) + 課題(5) = 35
    expect(calculateAttentionScore(text)).toBe(35);
  });

  // テストケース2: 一部のキーワードが含まれる場合
  it('should return the sum of scores for present keywords', () => {
    const text = 'この新製品は、我々の課題を解決するものです。';
    // 新製品(10) + 課題(5) = 15
    expect(calculateAttentionScore(text)).toBe(15);
  });

  // テストケース3: キーワードが一つも含まれない場合
  it('should return 0 when no keywords are present', () => {
    const text = 'このレポートには特に重要な情報はありません。';
    expect(calculateAttentionScore(text)).toBe(0);
  });

  // テストケース4: 同じキーワードが複数回出現する場合（ユニークでカウント）
  it('should count each keyword only once even if it appears multiple times', () => {
    const text = 'DXは重要です。我が社のDX戦略について説明します。';
    // DX(10)
    expect(calculateAttentionScore(text)).toBe(10);
  });

  // テストケース5: 空の文字列が渡された場合
  it('should return 0 for an empty string', () => {
    const text = '';
    expect(calculateAttentionScore(text)).toBe(0);
  });

  // テストケース6: キーワードが大文字・小文字混合の場合 (例: DX, dx)
  it('should be case-insensitive when matching keywords', () => {
    const text = '当社のdx戦略は、市場の課題を解決します。';
    // DX(10) + 課題(5) = 15
    expect(calculateAttentionScore(text)).toBe(15);
  });

  // テストケース7: スコアが高いキーワードのみの場合
  it('should correctly score high-value keywords', () => {
    const text = '新製品の発表と、B社との提携について。';
    // 新製品(10) + 提携(10) = 20
    expect(calculateAttentionScore(text)).toBe(20);
  });
});
