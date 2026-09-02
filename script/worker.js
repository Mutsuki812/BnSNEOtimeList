/* ============================================================
   Web Worker 背景服務

   負責：
   1. feedback_reports 的 INSERT / DELETE Realtime
   2. 精準分鐘計時器
   3. 預警計時器

   spawn_reports 不再使用 postgres_changes。
   活動期間由主執行緒以 5～10 秒錯開 polling 更新。
   ============================================================ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let supabaseClient = null;
let feedbackChannel = null;
let tickerStarted = false;

self.onmessage = async function (e) {
  const { type, config } = e.data;

  if (type === "INIT") {
    try {
      supabaseClient = createClient(config.url, config.key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      if (feedbackChannel) {
        await feedbackChannel.unsubscribe();
      }

      feedbackChannel = supabaseClient
        .channel("feedback-reports-changes")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            table: "feedback_reports",
            schema: "public",
          },
          () => self.postMessage({ type: "FEEDBACK_UPDATE" })
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            table: "feedback_reports",
            schema: "public",
          },
          () => self.postMessage({ type: "FEEDBACK_UPDATE" })
        )
        .subscribe((status) => {
          console.log(`[Worker] feedback_reports Realtime：${status}`);
          if (status === "SUBSCRIBED") {
            self.postMessage({ type: "REALTIME_READY" });
          }
        });
    } catch (error) {
      console.error("[Worker] Realtime 初始化失敗：", error);
      self.postMessage({
        type: "INIT_FAILED",
        reason: error?.message ?? String(error),
      });
    }

    if (!tickerStarted) {
      tickerStarted = true;

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

  if (type === "STOP_REALTIME" && feedbackChannel) {
    await feedbackChannel.unsubscribe();
    feedbackChannel = null;
  }
};
