/**
 * @vitest-environment jsdom
 */
import { mount } from '@vue/test-utils';
import App from '@/App.vue';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateAttentionScore } from '@/utils/attentionScore';

// './utils/attentionScore' モジュールをモック化
vi.mock('@/utils/attentionScore');

describe('App.vue - 注目度レベル表示', () => {

  // 各テストの前に実行するセットアップ
  beforeEach(() => {
    // fetch APIをモック化し、テスト用のダミーデータを返すように設定
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ report: 'テスト用のレポート本文' }),
      } as Response)
    );
  });

  // 各テストの後に実行するクリーンアップ
  afterEach(() => {
    // モックを元の状態に戻す
    vi.restoreAllMocks();
  });

  // レベルをテストするための共通関数
  const testAttentionLevel = async (score: number, expectedLevel: string, expectedClass: string) => {
    // 1. Arrange (準備)
    (calculateAttentionScore as vi.Mock).mockReturnValue(score);
    const wrapper = mount(App);

    // 2. Act (実行)
    await wrapper.find('input').setValue('テスト企業');
    await wrapper.find('button').trigger('click');

    // 3. Assert (検証)
    // vi.waitFor を使って、要素が表示されるまでポーリング（繰り返し確認）する
    await vi.waitFor(() => {
      // .attention-score-wrapper がDOMに存在することを確認
      expect(wrapper.find('.attention-score-wrapper').exists()).toBe(true);
    });

    // 要素が見つかった後、内容を検証する
    const scoreWrapper = wrapper.find('.attention-score-wrapper');
    expect(scoreWrapper.text()).toContain(expectedLevel);
    expect(scoreWrapper.text()).toContain(`(${score})`);
    expect(scoreWrapper.classes()).toContain(expectedClass);
  };

  it('スコアが25の場合、注目度レベル「高」が表示されること', async () => {
    await testAttentionLevel(25, '高', 'level-high');
  });

  it('スコアが15の場合、注目度レベル「中」が表示されること', async () => {
    await testAttentionLevel(15, '中', 'level-medium');
  });

  it('スコアが5の場合、注目度レベル「低」が表示されること', async () => {
    await testAttentionLevel(5, '低', 'level-low');
  });
});
