/* ============================================================
   Web Worker 背景服務
   在獨立執行緒中處理以下兩項任務：
   1. Supabase Realtime 即時監聽 (spawn_reports 資料表異動)
   2. 精準分鐘計時器 (解決分頁佇立時瀏覽器對 setInterval 的節流問題)

   使用 ES Module Worker (type: 'module')，
   需在 main.js 以 new Worker('./script/worker.js', { type: 'module' }) 方式啟動。
   ============================================================ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ============================================================
// 模組層級狀態
// Worker 執行緒的全域狀態變數，不與主執行緒共享
// ============================================================

let supabaseClient = null; // Supabase 客戶端實例
let channel        = null; // Realtime 訂閱頻道
let tickerStarted  = false; // 防止定時器被重複啟動的旗標

// ============================================================
// 訊息處理入口
// 接收來自主執行緒 (main.js) 的指令
// ============================================================

self.onmessage = async function (e) {
  const { type, config } = e.data;

  // ----------------------------------------------------------
  // 指令：INIT - 初始化 Supabase 客戶端並啟動 Realtime 監聽
  // ----------------------------------------------------------
  if (type === "INIT") {
    try {
      // Worker 環境中沒有 localStorage，必須停用 Session 持久化，
      // 否則 Supabase Auth 模組初始化時會拋出 ReferenceError。
      supabaseClient = createClient(config.url, config.key, {
        auth: {
          persistSession:     false, // Worker 無 localStorage，必須停用
          autoRefreshToken:   false, // 本應用不使用使用者登入 session，無需自動刷新
          detectSessionInUrl: false, // Worker 無 URL 存取能力
        },
      });

      // 若已存在舊的訂閱頻道，先取消訂閱再重建
      if (channel) channel.unsubscribe();

      channel = supabaseClient
        .channel("db-changes")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            table: "spawn_reports",
            schema: "public"
          },
          () => {
            self.postMessage({ type: "DB_UPDATE" });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            table: "spawn_reports",
            schema: "public"
          },
          () => {
            self.postMessage({ type: "DB_UPDATE" });
          }
        )
        .subscribe((status) => {
          console.log(`[Worker] Realtime 連線狀態：${status}`);
          if (status === "SUBSCRIBED") {
            self.postMessage({ type: "REALTIME_READY" });
          }
        });

      console.log("[Worker] 初始化完成，Realtime 監聽已啟動");
    } catch (err) {
      console.error("[Worker] Supabase 初始化失敗：", err.message);
      self.postMessage({ type: "INIT_FAILED", reason: err.message });
      // 初始化失敗時，主執行緒應降級為純定時器模式，仍可正常運作
    }

    // ----------------------------------------------------------
    // 精準分鐘計時器
    // Worker 的 setInterval 在分頁隱藏 (background tab) 時不會被瀏覽器
    // 大幅節流 (Throttling)，因此比主執行緒的計時器更可靠。
    // 使用 tickerStarted 旗標確保即使 INIT 被重複呼叫，也只建立一個計時器。
    // ----------------------------------------------------------
    if (!tickerStarted) {
      tickerStarted = true;

      // 對齊到下一個分鐘邊界 (:00 秒)，之後每次重新計算確保不漂移
      const scheduleTick = () => {
        const msUntilNextMinute = 60_000 - (Date.now() % 60_000);
        setTimeout(() => {
          self.postMessage({ type: "TICK_MINUTE" });
          scheduleTick();
        }, msUntilNextMinute);
      };

      const schedulePreAlertTick = () => {
        const msIntoMinute = Date.now() % 60_000;
        let msUntilPreAlert = 55_000 - msIntoMinute;
        if (msUntilPreAlert <= 0) msUntilPreAlert += 60_000;

        setTimeout(() => {
          self.postMessage({ type: "TICK_PRE_ALERT" });
          schedulePreAlertTick();
        }, msUntilPreAlert);
      };

      scheduleTick();
      schedulePreAlertTick();
    }
  }

  // ----------------------------------------------------------
  // 指令：STOP_REALTIME - 暫停 Realtime 監聽（預留給未來使用）
  // ----------------------------------------------------------
  if (type === "STOP_REALTIME") {
    if (channel) {
      channel.unsubscribe();
      channel = null;
    }
    console.log("[Worker] Realtime 監聽已暫停");
  }
};
