// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import App from './App.vue'; // テスト対象のコンポーネント
import * as attentionScoreUtils from './utils/attentionScore';

// ----------------------------------------------------------------
// Mocks Setup
// ----------------------------------------------------------------

// `calculateAttentionScore`関数をモック化
vi.mock('./utils/attentionScore', () => ({
  calculateAttentionScore: vi.fn(),
}));

// グローバルな `fetch` APIをモック化
global.fetch = vi.fn();

// fetchの成功レスポンスを生成するヘルパー関数
const createFetchResponse = (report = 'dummy report') => ({
  ok: true,
  json: () => Promise.resolve({ report }),
});

// ----------------------------------------------------------------
// Test Suite
// ----------------------------------------------------------------

describe('App.vue - 注目度レベル表示のテスト', () => {
  // 各テストの前にモックをリセット
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // テストケース: 高レベル (スコア >= 25)
  it('スコアが25以上の場合に「高」レベルを表示し、対応する背景色クラスを適用する', async () => {
    // --- Arrange ---
    // `calculateAttentionScore` が高スコア(例: 30)を返すように設定
    vi.spyOn(attentionScoreUtils, 'calculateAttentionScore').mockReturnValue(30);
    // fetchが成功するように設定
    (fetch as any).mockResolvedValue(createFetchResponse());

    const wrapper = mount(App);

    // --- Act ---
    // ユーザー操作をシミュレートして分析を実行
    await wrapper.find('input').setValue('テスト会社');
    await wrapper.find('button').trigger('click');
    await nextTick(); // DOMの更新を待つ

    // --- Assert ---
    const scoreContainer = wrapper.find('.attention-score-container');
    expect(scoreContainer.exists()).toBe(true); // スコア表示エリアが存在すること
    expect(scoreContainer.classes()).toContain('level-high'); // 背景色用のクラスがあること
    expect(scoreContainer.text()).toContain('注目度レベル: 高'); // テキストが正しいこと
    expect(scoreContainer.text()).toContain('(スコア: 30)'); // スコアが正しいこと
  });

  // テストケース: 中レベル (10 <= スコア < 25)
  it('スコアが10以上25未満の場合に「中」レベルを表示し、対応する背景色クラスを適用する', async () => {
    // --- Arrange ---
    vi.spyOn(attentionScoreUtils, 'calculateAttentionScore').mockReturnValue(15);
    (fetch as any).mockResolvedValue(createFetchResponse());
    const wrapper = mount(App);

    // --- Act ---
    await wrapper.find('input').setValue('テスト会社');
    await wrapper.find('button').trigger('click');
    await nextTick();

    // --- Assert ---
    const scoreContainer = wrapper.find('.attention-score-container');
    expect(scoreContainer.exists()).toBe(true);
    expect(scoreContainer.classes()).toContain('level-medium');
    expect(scoreContainer.text()).toContain('注目度レベル: 中');
    expect(scoreContainer.text()).toContain('(スコア: 15)');
  });

  // テストケース: 低レベル (スコア < 10)
  it('スコアが10未満の場合に「低」レベルを表示し、対応する背景色クラスを適用する', async () => {
    // --- Arrange ---
    vi.spyOn(attentionScoreUtils, 'calculateAttentionScore').mockReturnValue(5);
    (fetch as any).mockResolvedValue(createFetchResponse());
    const wrapper = mount(App);

    // --- Act ---
    await wrapper.find('input').setValue('テスト会社');
    await wrapper.find('button').trigger('click');
    await nextTick();

    // --- Assert ---
    const scoreContainer = wrapper.find('.attention-score-container');
    expect(scoreContainer.exists()).toBe(true);
    expect(scoreContainer.classes()).toContain('level-low');
    expect(scoreContainer.text()).toContain('注目度レベル: 低');
    expect(scoreContainer.text()).toContain('(スコア: 5)');
  });
});
