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
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { marked } from 'marked'; // Markdown表示のため

const companyName = ref('');
const analysisReport = ref('');
const loading = ref(false);
const error = ref('');

const getAnalysis = async () => {
  if (!companyName.value) {
    error.value = '企業名を入力してください。';
    return;
  }
  loading.value = true;
  error.value = '';
  analysisReport.value = '';

  try {
    // 新しく作成したバックエンドAPIを呼び出す
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
    error.value = e.message;
  } finally {
    loading.value = false;
  }
};
</script>

<style>
/* スタイルはmy-daily-digestから必要なものをコピーするか、
   以下のようなシンプルなものを貼り付けてください */
.app-header { padding: 1rem; text-align: center; background-color: #f8f9fa; }
.search-container input { padding: 0.5rem; font-size: 1rem; margin-right: 0.5rem; }
.dashboard { padding: 1rem; }
.analysis-report { margin-top: 1rem; padding: 1.5rem; border: 1px solid #e0e0e0; border-radius: 8px; }
.error-message { color: red; margin: 1rem; }
.loading-spinner { /* my-daily-digestからコピー */ }
.markdown-body { /* my-daily-digestからコピー */ }
</style>