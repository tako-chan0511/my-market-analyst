<template>
  <div id="app">
    <header class="app-header">
      <h1>簡易マーケット・アナリスト</h1>
      <div class="search-container">
        <input
          v-model="companyName"
          @keyup.enter="getAnalysis"
          placeholder="企業名を入力 (例: トヨタ自動車)"
        />
        <button @click="getAnalysis" :disabled="loading">
          <span v-if="!loading">分析する</span>
          <span v-else>分析中...</span>
        </button>
      </div>
    </header>

    <main class="dashboard">
      <div v-if="loading" class="loading-spinner"></div>
      <div v-if="error" class="error-message">{{ error }}</div>

      <section v-if="analysisReport" class="analysis-report">
        <div class="markdown-body" v-html="marked(analysisReport)"></div>

        <div class="follow-up-section">
          <h3>アナリストへの追加質問</h3>
          <div class="question-form">
            <textarea
              v-model="followUpQuestion"
              placeholder="分析レポートの内容について質問を入力..."
              rows="3"
            ></textarea>
            <button
              @click="askQuestion"
              :disabled="loadingAnswer || !followUpQuestion"
            >
              <span v-if="!loadingAnswer">質問する</span>
              <span v-else>回答中...</span>
            </button>
          </div>
          <div v-if="errorAnswer" class="error-message">{{ errorAnswer }}</div>

          <div v-if="qaHistory.length > 0" class="qa-history">
            <h4>対話履歴</h4>
            <div
              v-for="(item, index) in qaHistory"
              :key="index"
              class="qa-item"
            >
              <p class="question">{{ item.question }}</p>
              <p class="answer markdown-body" v-html="marked(item.answer)"></p>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'; // reactive をインポートに追加
import { marked } from "marked"; // Markdown表示のため

const companyName = ref("");
const analysisReport = ref("");
const loading = ref(false);
const error = ref("");
// ... 既存のrefの下に追加 ...
const followUpQuestion = ref('');
const qaHistory = ref<{ question: string; answer: string }[]>([]);
const loadingAnswer = ref(false);
const errorAnswer = ref('');

const getAnalysis = async () => {
  if (!companyName.value) {
    error.value = '企業名を入力してください。';
    return;
  }
  loading.value = true;
  error.value = '';
  analysisReport.value = '';
  qaHistory.value = [];

  try {
    const res = await fetch('/api/analyze-company-news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: companyName.value }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || '分析に失敗しました。');
    }
    analysisReport.value = data.report;
    
  } catch (e: any) {
    // ★★ここからが変更点★★
    // エラーメッセージに「503」が含まれているかチェック
    if (e.message && e.message.includes('503')) {
      // 含まれていれば、ユーザー向けのメッセージに置き換える
      error.value = '現在、AIサーバーへのリクエストが混み合っているようです。大変お手数ですが、1分ほど時間をおいてから再度お試しください。';
    } else {
      // それ以外のエラーは、そのまま表示
      error.value = e.message;
    }
    // ★★ここまでが変更点★★
  } finally {
    loading.value = false;
  }
};

const askQuestion = async () => {
  if (!followUpQuestion.value || !analysisReport.value) return;

  loadingAnswer.value = true;
  errorAnswer.value = '';
  const currentQuestion = followUpQuestion.value;
  
  try {
    const res = await fetch('/api/ask-follow-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysisReport: analysisReport.value,
        question: currentQuestion,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || '回答の生成に失敗しました。');
    }
    
    qaHistory.value.unshift({ question: currentQuestion, answer: data.answer });
    followUpQuestion.value = '';

  } catch (e: any) {
    // ★★ここからが変更点★★
    // エラーメッセージに「503」が含まれているかチェック
    if (e.message && e.message.includes('503')) {
      // 含まれていれば、ユーザー向けのメッセージに置き換える
      errorAnswer.value = '現在、AIサーバーが混み合っているようです。少し時間をおいてから、もう一度ご質問ください。';
    } else {
      // それ以外のエラーは、そのまま表示
      errorAnswer.value = e.message;
    }
    // ★★ここまでが変更点★★
  } finally {
    loadingAnswer.value = false;
  }
};
</script>

<style>
/* スタイルはmy-daily-digestから必要なものをコピーするか、
   以下のようなシンプルなものを貼り付けてください */
.app-header {
  padding: 1rem;
  text-align: center;
  background-color: #f8f9fa;
}
.search-container input {
  padding: 0.5rem;
  font-size: 1rem;
  margin-right: 0.5rem;
}
.dashboard {
  padding: 1rem;
}
.analysis-report {
  margin-top: 1rem;
  padding: 1.5rem;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}
.error-message {
  color: red;
  margin: 1rem;
}
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 2rem auto;
}

.markdown-body {
  line-height: 1.7;
  text-align: left; /* ★★ この一行を追加 ★★ */
}

.follow-up-section > h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  font-size: 1rem;
  font-weight: 600;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.75rem;
}

.question-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.qa-history {
  margin-top: 1.5rem;
  padding: 0 0.5rem;
  flex-grow: 1;
  overflow-y: auto;
}
.qa-history h4 {
  margin-top: 0;
  font-size: 0.9rem;
  color: var(--sub-text-color);
}
.qa-item {
  margin-bottom: 1.5rem;
  border-bottom: none;
  display: flex;
  flex-direction: column;
}
.qa-item .question {
  padding: 0.75rem 1rem;
  border-radius: 12px;
  line-height: 1.6;
  max-width: 90%;
  background-color: var(--selected-bg-color);
  align-self: flex-end;
  border-bottom-right-radius: 0;
  font-weight: 600;
}
.qa-item .answer {
  padding: 0.75rem 1rem;
  border-radius: 12px;
  line-height: 1.6;
  max-width: 90%;
  background-color: #f1f3f4;
  align-self: flex-start;
  border-bottom-left-radius: 0;
  white-space: pre-wrap;
  margin-top: 0.5rem;
}
.qa-item p {
  margin: 0;
}


</style>
