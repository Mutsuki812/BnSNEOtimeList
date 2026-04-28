/* ==========================
   ==== Web Worker 背景服務 ====
   ========================== */

// Worker 內部不能直接 import 模組，需使用 importScripts
importScripts('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');

let supabase = null;
let channel = null;

self.onmessage = function(e) {
  const { type, config } = e.data;

  if (type === 'INIT') {
    supabase = supabase.createClient(config.url, config.key);
    
    // 1. 設定即時監聽 (Realtime)
    if (channel) channel.unsubscribe();
    
    channel = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', table: 'spawn_reports', schema: 'public' }, (payload) => {
        // 當資料庫有任何異動 (新增、刪除)，立即通知主線程重新載入數據
        self.postMessage({ type: 'DB_UPDATE', payload });
      })
      .subscribe();

    // 2. 精準定時器：解決網頁佇立問題
    // Worker 的 setInterval 在分頁隱藏時不會被瀏覽器過度節流 (Throttling)
    setInterval(() => {
      self.postMessage({ type: 'TICK_MINUTE' });
    }, 60000);

    console.log('[Worker] 初始化完成，監聽已啟動');
  }

  if (type === 'STOP_REALTIME') {
    if (channel) channel.unsubscribe();
    console.log('[Worker] 即時監聽已暫停');
  }
};
