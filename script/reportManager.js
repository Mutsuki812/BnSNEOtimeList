/* ============================================================
   回報管理器
   負責留言/回報區塊的 UI 渲染、表單提交、歷史記録載入與刪除。

   Supabase 資料表：
   - feedback_reports：儲存使用者留言與回報（非即時野王回報）
   - Users：關聯查詢使用者名稱與角色

   UI 結構（由 render() 方法動態產生）：
   - 任務選擇下拉 + 回報類型下拉 + 文字輸入欄 + 送出按鈕
   - 回報列表（從 Supabase 即時載入，含刪除功能）
   ============================================================ */

import { CONFIG, REPORT_TASK, REPORT_TYPES, TEXTS } from "./config.js";
import { DOMHelper, SupabaseHelper, RemoteConfig } from "./utils.js";

/**
 * 回報管理器，統一管理留言/回報區塊的所有邏輯。
 */
export class ReportManager {
  /**
   * @param {import('./userManager.js').UserManager} userManager - 使用者管理器實例
   * @param {import('./utils.js').TimeUtils}         timeUtils   - 時間工具實例
   */
  constructor(userManager, timeUtils) {
    this.userManager = userManager;
    this.timeUtils   = timeUtils;

    // 快取 DOM 元素參考（由 render() 方法填充）
    this.reportTaskTypeEl = null;
    this.reportTypeEl     = null;
    this.reportCommentEl  = null;
    this.msgEl            = null;
    this.submitReportBtn  = null;
    this.reportListEl     = null;
    this.reportTextEl     = null;

    this.render();
    this.updateAll();
    this.loadReports();
    this.attachEventListeners();
  }

  // ============================================================
  // UI 渲染
  // ============================================================

  /**
   * 在 #reportRoot 元素中動態產生回報區塊的完整 HTML 結構，
   * 並快取各主要 DOM 元素的參考以供後續操作使用。
   */
  render() {
    const root = document.getElementById("reportRoot");
    if (!root) return;

    root.style.display = "block";
    root.innerHTML = `
      <section id="reportSection" class="reportSection">
        <div class="reportTitle"></div>
        <div class="reportForm">
          <div class="reportText"></div>
          <div class="reportFields">
            <select id="reportTaskType" aria-label="選擇任務類型"></select>
            <select id="reportType"     aria-label="選擇回報類型"></select>
            <input  type="text" id="reportComment" autocomplete="off" />
            <div id="reportMessage" role="status" aria-live="polite"></div>
            <div class="reportButtons">
              <button id="submitReport" class="report-submit-btn">送出</button>
            </div>
          </div>
        </div>
        <div class="reportLog">
          <div id="reportList" class="reportList"></div>
        </div>
      </section>
    `;

    this.reportTaskTypeEl = root.querySelector("#reportTaskType");
    this.reportTypeEl     = root.querySelector("#reportType");
    this.reportCommentEl  = root.querySelector("#reportComment");
    this.msgEl            = root.querySelector("#reportMessage");
    this.submitReportBtn  = root.querySelector("#submitReport");
    this.reportListEl     = root.querySelector("#reportList");
    this.reportTextEl     = root.querySelector(".reportText");
  }

  /**
   * 綁定表單的 DOM 事件監聽器。
   * - 任務選擇改變：聯動更新回報類型、提示文字、按鈕顏色
   * - 送出按鈕點擊：觸發回報提交流程
   */
  attachEventListeners() {
    this.reportTaskTypeEl?.addEventListener("change", () => {
      this.updateReportTypeOptions();
      this.updateReportCommentPlaceholder();
      this.updateButtonColor();
    });
    this.submitReportBtn?.addEventListener("click", () => this.submitReport());
  }

  // ============================================================
  // 狀態查詢
  // ============================================================

  /**
   * 判斷當前台灣時間是否在 DATE_RANGES 的活動期間內。
   * 用於決定顯示哪種說明文字。
   * @returns {boolean}
   */
  isInDateRange() {
    const ranges = RemoteConfig.getDateRanges();
    if (!ranges) return false;
    const now   = this.timeUtils.getNowBySVR();
    const start = this.timeUtils.getShiftedDate(ranges.start);
    const end   = this.timeUtils.getShiftedDate(ranges.end);
    return now >= start && now <= end;
  }

  // ============================================================
  // UI 更新方法
  // ============================================================

  /**
   * 一次性更新所有 UI 元件的狀態（表單說明、選項、提示、按鈕顏色）。
   * 在初始化及活動期間切換時呼叫。
   */
  updateAll() {
    const root = document.getElementById("reportRoot");
    if (root) root.style.display = "block";

    // 儲存目前的選取狀態，更新後嘗試還原
    const savedTask = this.reportTaskTypeEl?.value;
    const savedType = this.reportTypeEl?.value;

    this.updateReportText();
    this.updateReportTaskOptions(savedTask);
    this.updateReportTypeOptions(savedType);
    this.updateReportCommentPlaceholder();
    this.updateButtonColor();
  }

  /**
   * 更新回報區塊頂部的說明文字（依活動期間顯示不同內容）。
   */
  updateReportText() {
    if (!this.reportTextEl) return;
    const isActivity = this.isInDateRange();
    this.reportTextEl.innerHTML = isActivity
      ? TEXTS.Report_temporaryNotice
      : TEXTS.Report_regularNotice;
  }

  /**
   * 更新任務類型下拉選單的選項，並嘗試還原先前的選取值。
   * @param {string} [savedValue] - 要嘗試還原的選取值
   */
  updateReportTaskOptions(savedValue) {
    if (!this.reportTaskTypeEl) return;

    const currentVal = savedValue ?? this.reportTaskTypeEl.value;
    this.reportTaskTypeEl.innerHTML = "";

    REPORT_TASK.forEach((task) => {
      const opt       = document.createElement("option");
      opt.textContent = task;
      opt.value       = task;
      this.reportTaskTypeEl.appendChild(opt);
    });

    // 嘗試還原先前的選取，否則預設選第一個
    if (currentVal && Array.from(this.reportTaskTypeEl.options).some((o) => o.value === currentVal)) {
      this.reportTaskTypeEl.value = currentVal;
    }
  }

  /**
   * 依據目前選取的任務類型，更新回報類型下拉選單。
   * - 野王/儀式任務：顯示「數據提供、時間修正、地點修正」
   * - 「其他」類型：顯示「音效相關、BUG回報、想説」
   * @param {string} [savedValue] - 要嘗試還原的選取值
   */
  updateReportTypeOptions(savedValue) {
    if (!this.reportTypeEl || !this.reportTaskTypeEl) return;

    const selectedTask = this.reportTaskTypeEl.value;
    const options      = ["可疑的儀式", "白青野王", "仙幻島野王"].includes(selectedTask)
      ? REPORT_TYPES.default
      : REPORT_TYPES.otherOnly;

    this.reportTypeEl.innerHTML = "";
    options.forEach((optText) => {
      const opt       = document.createElement("option");
      opt.textContent = optText;
      opt.value       = optText;
      this.reportTypeEl.appendChild(opt);
    });

    // 嘗試還原先前的選取
    if (savedValue && Array.from(this.reportTypeEl.options).some((o) => o.value === savedValue)) {
      this.reportTypeEl.value = savedValue;
    } else if (selectedTask === "其他") {
      this.reportTypeEl.value = "想説"; // 「其他」類型預設選「想説」
    } else if (!this.isInDateRange() && selectedTask === "仙幻島野王") {
      this.reportTypeEl.value = "時間修正"; // 非活動期間的仙幻島預設選「時間修正」
    }
  }

  /**
   * 依據目前選取的任務類型，更新輸入框的提示文字 (placeholder)。
   */
  updateReportCommentPlaceholder() {
    if (!this.reportCommentEl || !this.reportTaskTypeEl) return;
    const selectedTask = this.reportTaskTypeEl.value;
    this.reportCommentEl.placeholder =
      selectedTask === "其他"
        ? "例如：音效太小聲 / 網站有BUG / 建議增加功能"
        : "例如：五 09:26 地點";
  }

  /**
   * 依據目前選取的任務類型，更新送出按鈕的主題色 CSS class。
   */
  updateButtonColor() {
    if (!this.submitReportBtn || !this.reportTaskTypeEl) return;
    const selectedTask = this.reportTaskTypeEl.value;

    this.submitReportBtn.classList.remove("type-gishiki", "type-shirao", "type-sengen", "type-other");

    if (selectedTask.includes("儀式"))  this.submitReportBtn.classList.add("type-gishiki");
    else if (selectedTask.includes("白青"))  this.submitReportBtn.classList.add("type-shirao");
    else if (selectedTask.includes("仙幻"))  this.submitReportBtn.classList.add("type-sengen");
    else                                     this.submitReportBtn.classList.add("type-other");
  }

  /**
   * 顯示操作結果訊息，3 秒後自動清除。
   * @param {string}  text    - 訊息內容
   * @param {boolean} [isError=false] - true 表示錯誤訊息（套用錯誤樣式）
   */
  showMessage(text, isError = false) {
    if (!this.msgEl) return;
    this.msgEl.textContent = text;
    this.msgEl.className   = isError ? "report-msg error" : "report-msg success";
    setTimeout(() => { this.msgEl.textContent = ""; }, 3000);
  }

  // ============================================================
  // 資料操作
  // ============================================================

  /**
   * 提交留言/回報至 Supabase 的 feedback_reports 資料表。
   * 提交前會確認使用者已登入（若未登入會彈出登入 Modal）。
   */
  async submitReport() {
    const taskType  = this.reportTaskTypeEl?.value;
    const reportType = this.reportTypeEl?.value;
    const comment   = this.reportCommentEl?.value.trim();

    if (!comment) {
      this.showMessage("請輸入內容", true);
      return;
    }

    // 確保使用者已登入
    const user = await this.userManager.requireUser();
    if (!user) return;

    const payload = {
      bossType:      taskType,
      reportType:    reportType,
      comment:       comment,
      user_id:       user.id,
      adminResponse: null, // 管理者回覆初始為 null
    };

    try {
      this.showMessage("傳送中...");
      this.submitReportBtn.disabled    = true;
      this.submitReportBtn.textContent = "傳送中...";

      console.log("[回報] 提交留言：", payload);

      const supabase    = await SupabaseHelper.getClient();
      const { error }   = await supabase.from("feedback_reports").insert([payload]);
      if (error) throw error;

      if (this.reportCommentEl) this.reportCommentEl.value = "";
      this.showMessage("感謝你");
      // 短暫延遲後重新載入回報列表，給資料庫時間完成寫入
      setTimeout(() => this.loadReports(), 1000);
    } catch (error) {
      console.error("[回報] 提交失敗：", error);
      this.showMessage("回報失敗，請稍後再試", true);
    } finally {
      this.submitReportBtn.disabled    = false;
      this.submitReportBtn.textContent = "送出";
    }
  }

  /**
   * 從 Supabase 載入並渲染回報列表。
   * 關聯查詢 Users 資料表以取得使用者名稱與角色（admin 顯示為「管理者」）。
   * 若為當前使用者的留言，顯示刪除按鈕。
   */
  async loadReports() {
    if (!this.reportListEl) return;

    try {
      const supabase = await SupabaseHelper.getClient();
      const { data: reports, error } = await supabase
        .from("feedback_reports")
        .select("*, Users!user_id(userName, role)")
        .order("postTime", { ascending: false });

      if (error) throw error;

      this.reportListEl.innerHTML = "";

      if (reports.length === 0) {
        this.reportListEl.innerHTML = `<div class="reportItem">目前尚無回報記録</div>`;
        return;
      }

      const currentUserId = this.userManager.getCurrentUser()?.id;

      reports.forEach((r) => {
        const div         = DOMHelper.createElement("div", "report-message-item");
        const displayTime = r.postTime.substring(5, 16).replace("-", "/").replace("T", " "); // MM/DD HH:mm

        const isAdmin   = !!(r.Users?.role === "admin");
        const userName  = isAdmin ? "管理者" : (r.Users?.userName ?? "");

        // MVP 榮譽識別：依照 Supabase mvp_config 設定套用特殊樣式
        let userClass = isAdmin ? "msg-user admin-tag" : "msg-user user-tag gray";
        if (!isAdmin) {
          const mvp = RemoteConfig.getMvpConfig();
          if (userName === mvp.first)  userClass += " is-mvp-1";
          else if (userName === mvp.second) userClass += " is-mvp-2";
        }

        // 「感謝」標記：管理者已回應時顯示感謝圖示
        const isResponded = r.respond === true || r.respond === "TRUE";
        const respondHtml = isResponded
          ? `<img src="./images/thanks24.png" alt="已回應" class="icon-thanks">`
          : "";

        // 「想説」類型不顯示回報類型前綴
        const reportPrefix = r.reportType === "想説" ? "" : `${r.reportType}: `;

        // 管理者回覆區塊（若有）
        const adminBlockHtml = r.adminResponse
          ? `<div class="msg-divider"></div>
             <div class="msg-admin">
               <span class="admin-badge">回</span>
               <div class="admin-text">${r.adminResponse}</div>
             </div>`
          : "";

        // 任務類型對應的顏色 class
        const typeClass = r.bossType?.includes("儀式") ? "type-gishiki"
          : r.bossType?.includes("白青") ? "type-shirao"
          : r.bossType?.includes("仙幻") ? "type-sengen"
          : "type-other";

        div.innerHTML = `
          <div class="msg-card">
            <div class="msg-main">
              <span class="msg-time">${displayTime}</span>
              <span class="msg-type ${typeClass}">${r.bossType}</span>
              <span class="msg-text">${reportPrefix}${r.comment}</span>
              <div class="msg-nameRes">
                <div class="msg-nameRes-inner">
                  <span class="msg-respond">${respondHtml}</span>
                  <span class="msg-actions"></span>
                </div>
                <span class="${userClass}">${userName}</span>
              </div>
            </div>
            ${adminBlockHtml}
          </div>
        `;

        // 若為當前使用者的留言，掛載刪除按鈕
        if (currentUserId && r.user_id === currentUserId) {
          const actionsSpan = div.querySelector(".msg-actions");
          const delBtn      = DOMHelper.createElement("span", "msg-del-btn");
          delBtn.innerHTML  = `<img src="./images/delete24_c.png" alt="刪除" class="icon-delete" data-icon-light="./images/delete24_c.png" data-icon-dark="./images/delete24_w.png">`;
          delBtn.title      = "刪除此留言";
          delBtn.addEventListener("click", () => this.deleteReport(r.postTime));
          actionsSpan.appendChild(delBtn);
        }

        this.reportListEl.appendChild(div);
      });
    } catch (error) {
      console.error("[回報] 載入失敗：", error);
      this.reportListEl.innerHTML =
        `<div class="reportItem" style="color: var(--color-text-red);">載入失敗：${error.message}</div>`;
    }
  }

  /**
   * 刪除指定的回報記録（限本人的留言）。
   * 使用 postTime 作為主鍵，並加入 user_id 驗證確保只能刪除自己的資料。
   * 刪除前會顯示確認 Modal。
   * @param {string} postTime - 要刪除的留言的 postTime 欄位值
   */
  deleteReport(postTime) {
    this.userManager.showConfirmModal(
      "確定要刪除這條回報嗎？",
      async () => {
        try {
          const user = this.userManager.getCurrentUser();
          if (!user) return;

          const supabase  = await SupabaseHelper.getClient();
          console.log("[回報] 刪除留言：", { postTime, user_id: user.id });

          // user_id 條件確保使用者只能刪除自己的留言（雙重保護，Supabase RLS 也應設定）
          const { error } = await supabase
            .from("feedback_reports")
            .delete()
            .eq("postTime", postTime)
            .eq("user_id", user.id);

          if (error) throw error;

          this.showMessage("已刪除");
          this.loadReports();
        } catch (e) {
          console.error("[回報] 刪除失敗：", e);
          this.showMessage("刪除失敗", true);
        }
      },
      true // isDanger = true：確認按鈕套用危險樣式
    );
  }
}
