/* ==========================
   ==== レポート機能 ====
   ========================== */

import { CONFIG, REPORTTASK_TYPES, REPORT_TYPES, TEXTS } from "./config.js";
import { StorageHelper, DOMHelper } from "./utils.js";

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwI2_v_FA17GVDyDOJqYRkHWGBNrhKuQ4BQ3mvcQUzEtaVRuBFJ9JKN20yCym0-J36rlQ/exec";

/**
 * レポートマネージャー
 */
export class ReportManager {
  constructor() {
    this.render();
    this.updateAll();
    this.loadReports();
    this.attachEventListeners();
  }

  render() {
    const root = document.getElementById("reportRoot");
    if (!root) return;

    root.style.display = "block";

    root.innerHTML = `
      <section id="reportSection" class="reportSection">
        <div class="reportTitle"></div>
        <div class="reportForm">
          <div class="reportText"></div>
          <select id="reportTaskType" aria-label="任務選擇"></select>
          <select id="reportType" aria-label="回報類型"></select>
          <input type="text" id="reportComment" aria-label="備註" placeholder="備註..." autocomplete="off" />
          <div class="reportContainer">
            <div id="reportMessage" role="status" aria-live="polite"></div>
            <div class="reportButtons"><button id="submitReport"></button></div>
          </div>
        </div>
        <div class="reportLog"><div id="reportList" class="reportList"></div></div>
      </section>
    `;

    this.reportTaskTypeEl = root.querySelector("#reportTaskType");
    this.reportTypeEl = root.querySelector("#reportType");
    this.reportCommentEl = root.querySelector("#reportComment");
    this.msgEl = root.querySelector("#reportMessage");
    this.submitReportBtn = root.querySelector("#submitReport");
    this.reportListEl = root.querySelector("#reportList");
    this.reportTextEl = root.querySelector(".reportText");
  }

  attachEventListeners() {
    this.reportTaskTypeEl?.addEventListener("change", () => this.updateReportTypeOptions());
    this.submitReportBtn?.addEventListener("click", () => this.submitReport());
  }

  updateReportText() {
    const text = "請幫忙填寫儀式或是白青野王的系統提示時間<br>有你的幫忙 能讓數據更完善 感謝";
    if (this.reportTextEl) {
      this.reportTextEl.innerHTML = text;
    }
  }

  updateReportTaskOptions() {
    if (!this.reportTaskTypeEl) return;
    
    this.reportTaskTypeEl.innerHTML = "";
    REPORTTASK_TYPES.forEach(task => {
      const opt = document.createElement("option");
      // opt.value = task;
      opt.textContent = task;
      this.reportTaskTypeEl.appendChild(opt);
    });
  }

  updateReportTypeOptions() {
    if (!this.reportTypeEl || !this.reportTaskTypeEl) return;
    
    const selectedTask = this.reportTaskTypeEl.value;
    const options = ["可疑的儀式", "白青野王", "仙幻島野王"].includes(selectedTask)
      ? REPORT_TYPES.default
      : REPORT_TYPES.otherOnly;

    this.reportTypeEl.innerHTML = "";
    options.forEach(optData => {
      const opt = document.createElement("option");
      opt.textContent = optData;;
      this.reportTypeEl.appendChild(opt);
    });
  }

  updateReportCommentPlaceholder() {
    if (this.reportCommentEl) {
      this.reportCommentEl.placeholder = "10/15 09:26 地點 / 地點";
    }
    
    if (this.submitReportBtn) {
      this.submitReportBtn.textContent = "送出";
    }
  }

  showMessage(text, isError = false) {
    if (!this.msgEl) return;
    
    this.msgEl.textContent = text;
    this.msgEl.style.color = isError ? "red" : "green";
    setTimeout(() => { this.msgEl.textContent = ""; }, 3000);
  }

  async submitReport() {
    const taskType = this.reportTaskTypeEl?.value;
    const reportType = this.reportTypeEl?.value;
    const comment = this.reportCommentEl?.value.trim();

    if (!comment) {
      const errorMsg = "請輸入內容";
      this.showMessage(errorMsg, true);
      return;
    }

    if (GAS_WEB_APP_URL === "YOUR_GOOGLE_APPS_SCRIPT_URL_HERE") {
      const errorMsg = "GAS URL is not configured.";
      this.showMessage("後端服務未設定" , true);
      console.error(errorMsg);
      return;
    }

    const payload = {
      taskType,
      reportType,
      comment
    };

    try {
      this.submitReportBtn.disabled = true; // 防止重複點擊
      const response = await fetch(GAS_WEB_APP_URL, {
        method: "POST",
        // text/plain 避免觸發複雜的 CORS preflight 請求
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify(payload),
      });

      // 即使 fetch 成功，檢查後端是否真的成功
      const result = await response.json();
      if (result.status !== "success") {
        throw new Error(result.message || "Server-side error");
      }

      if (this.reportCommentEl) { 
        this.reportCommentEl.value = "";
      }
      const successMsg = "感謝你";
      this.showMessage(successMsg);
      // 延遲一下再重新載入
      setTimeout(() => this.loadReports(), 1000);
    } catch (error) {
      console.error("Error submitting report:", error);
      const errorMsg = "回報失敗，請稍後再試";
      this.showMessage(errorMsg, true);
    } finally {
      this.submitReportBtn.disabled = false; // 恢復按鈕
    }
  }

  async loadReports() {
    if (!this.reportListEl) return;
    
    if (GAS_WEB_APP_URL === "YOUR_GOOGLE_APPS_SCRIPT_URL_HERE") {
      this.reportListEl.innerHTML = `<div class="reportItem">後端服務未設定，無法載入紀錄。</div>`;
      return;
    }

    try {
      // 加入時間戳記參數，避免瀏覽器快取導致讀不到最新資料
      const response = await fetch(`${GAS_WEB_APP_URL}?t=${new Date().getTime()}`);
      const result = await response.json();

      if (result.status !== "success") {
        throw new Error(result.message || "Failed to load reports");
      }

      const reports = result.data || [];
      this.reportListEl.innerHTML = "";

      if (reports.length === 0) {
        const noReportMsg = "目前尚無回報紀錄";
        this.reportListEl.innerHTML = `<div class="reportItem">${noReportMsg}</div>`;
        return;
      }

      reports.forEach((r) => {
        const div = DOMHelper.createElement("div", "reportItem");
        const formatDate = r.Timestamp.substring(0, 10);
        let respond = '';

        const isResponded = r.Respond === true || r.Respond === "TRUE";
        if (isResponded) {
          respond = '<img src="./images/thanks24.png" alt="thx!!">';
        }

        div.innerHTML = `[${formatDate}][${r.TaskType} ${r.ReportType}] ${r.Comment} ${respond}`;

        this.reportListEl.appendChild(div);
      });
    } catch (error) {
      console.error("Error loading reports:", error);
      this.reportListEl.innerHTML = `<div class="reportItem" style="color: red;">載入失敗：${error.message}</div>`;
    }
  }

  updateAll() {
    this.updateReportText();
    this.updateReportTaskOptions();
    this.updateReportTypeOptions();
    this.updateReportCommentPlaceholder();
  }
}