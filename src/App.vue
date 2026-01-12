<template>
  <div id="app">
    <header class="app-header">
      <h1>ＡＩマーケットアナリスト</h1>
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
              :disabled="loadingAnswer"
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
              <div class="answer markdown-body" v-html="marked(item.answer)"></div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { marked } from "marked";

// --- State ---
const companyName = ref("");
const analysisReport = ref("");
const loading = ref(false);
const error = ref("");

const followUpQuestion = ref('');
const qaHistory = ref<{ question: string; answer: string }[]>([]);
const loadingAnswer = ref(false);
const errorAnswer = ref('');

// API エンドポイント設定（開発環境と本番環境で切り替え）
const API_BASE_URL = import.meta.env.DEV ? 'http://localhost:3001' : '';

// --- Methods ---

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
    const apiUrl = `${API_BASE_URL}/api/analyze-company-news`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: companyName.value }),
    });
    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data.error || '分析に失敗しました。';
      const details = data.details ? `\n詳細: ${data.details}` : '';
      throw new Error(errorMsg + details);
    }
    analysisReport.value = data.report;
    
  } catch (e: any) {
    error.value = e.message;
    console.error('Analysis error:', e);
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
    const apiUrl = `${API_BASE_URL}/api/ask-follow-up`;
    const res = await fetch(apiUrl, {
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
    errorAnswer.value = e.message;
  } finally {
    loadingAnswer.value = false;
  }
};
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
  max-width: 800px;
  margin: 0 auto;
}

.app-header {
  padding: 1rem 2rem;
  text-align: center;
  background-color: #f8f9fa;
  border-bottom: 1px solid #dee2e6;
}

.app-header h1 {
  margin: 0;
  font-size: 1.75rem;
}

.search-container {
  margin-top: 1rem;
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}

.search-container input {
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  width: 60%;
}

.search-container button {
  padding: 0.5rem 1rem;
  font-size: 1rem;
  color: #fff;
  background-color: #007bff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.search-container button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.dashboard {
  padding: 1rem;
}

.analysis-report {
  margin-top: 1rem;
  padding: 1.5rem;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background-color: #fff;
}

.error-message {
  color: #dc3545;
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
  padding: 1rem;
  border-radius: 4px;
  margin: 1rem 0;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 2rem auto;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.markdown-body {
  line-height: 1.7;
  text-align: left;
}

.markdown-body h1, .markdown-body h2, .markdown-body h3 {
  border-bottom: 1px solid #eee;
  padding-bottom: 0.3em;
}

.markdown-body ul {
  padding-left: 2em;
}

.follow-up-section {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #dee2e6;
}

.follow-up-section > h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  font-size: 1.25rem;
  font-weight: 600;
}

.question-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.question-form textarea {
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  resize: vertical;
  min-height: 60px;
}

.question-form button {
  align-self: flex-end;
  padding: 0.5rem 1rem;
  font-size: 1rem;
  color: #fff;
  background-color: #28a745;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.question-form button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.qa-history {
  margin-top: 1.5rem;
}

.qa-history h4 {
  margin-top: 0;
  font-size: 1rem;
  color: #6c757d;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.5rem;
}

.qa-item {
  margin-bottom: 1.5rem;
  display: flex;
  flex-direction: column;
}

.qa-item .question {
  align-self: flex-end;
  background-color: #e9f5ff;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  border-bottom-right-radius: 0;
  line-height: 1.6;
  max-width: 90%;
  font-weight: 600;
}

.qa-item .answer {
  align-self: flex-start;
  background-color: #f1f3f4;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  border-bottom-left-radius: 0;
  line-height: 1.6;
  max-width: 90%;
  margin-top: 0.5rem;
  white-space: pre-wrap;
}

.qa-item p {
  margin: 0;
}

/* --- ここから追加 --- */
/* Markdownのテーブル用スタイル */
.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5rem 0;
  border: 1px solid #dfe2e5;
  font-size: 0.9rem;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid #dfe2e5;
  padding: 0.6em 1em;
  text-align: left;
}

.markdown-body th {
  font-weight: 600;
  background-color: #f6f8fa;
}

/* Markdownの強調文字（太字）用スタイル */
.markdown-body strong {
  color: #0d6efd; /* BootstrapのPrimaryカラーに近い青色 */
}
/* --- ここまで追加 --- */
</style>
