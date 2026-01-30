/* ==========================
   ==== レポート機能 ====
   ========================== */

import { CONFIG, REPORTTASK_TYPES, REPORT_TYPES, TEXTS } from './config.js';
import { StorageHelper, DOMHelper } from './utils.js';

/**
 * レポートマネージャー
 */
export class ReportManager {
  constructor(languageManager) {
    this.languageManager = languageManager;
    this.initElements();
    this.attachEventListeners();
  }

  initElements() {
    this.reportTaskTypeEl = document.getElementById("reportTaskType");
    this.reportTypeEl = document.getElementById("reportType");
    this.reportCommentEl = document.getElementById("reportComment");
    this.msgEl = document.getElementById("reportMessage");
    this.submitReportBtn = document.getElementById("submitReport");
    this.reportListEl = document.getElementById("reportList");
    this.clearReportsBtn = document.getElementById("clearReports");
  }

  attachEventListeners() {
    this.reportTaskTypeEl?.addEventListener("change", () => this.updateReportTypeOptions());
    this.submitReportBtn?.addEventListener("click", () => this.submitReport());
    this.clearReportsBtn?.addEventListener("click", () => this.clearReports());
  }

  updateReportText() {
    const text = TEXTS.reportHelp[this.languageManager.current];
    let reportText = document.querySelector(".reportText");
    
    if (!reportText) {
      reportText = DOMHelper.createElement("div", "reportText");
      this.reportTaskTypeEl?.appendChild(reportText);
    }
    
    reportText.innerHTML = text;
  }

  updateReportTaskOptions() {
    if (!this.reportTaskTypeEl) return;
    
    this.reportTaskTypeEl.innerHTML = "";
    REPORTTASK_TYPES.forEach(task => {
      const opt = document.createElement("option");
      opt.value = task.key;
      opt.textContent = this.languageManager.current === "zh" ? task.labelZh : task.labelJp;
      this.reportTaskTypeEl.appendChild(opt);
    });
  }

  updateReportTypeOptions() {
    if (!this.reportTypeEl || !this.reportTaskTypeEl) return;
    
    const selectedTask = this.reportTaskTypeEl.value;
    const options = ["gishiki", "shirao", "sengentou"].includes(selectedTask)
      ? REPORT_TYPES.default
      : REPORT_TYPES.otherOnly;

    this.reportTypeEl.innerHTML = "";
    options.forEach(optData => {
      const opt = document.createElement("option");
      opt.value = optData.value;
      opt.textContent = this.languageManager.current === "zh" ? optData.labelZh : optData.labelJp;
      this.reportTypeEl.appendChild(opt);
    });
  }

  updateReportCommentPlaceholder() {
    if (this.reportCommentEl) {
      this.reportCommentEl.placeholder = this.languageManager.current === "zh" 
        ? "10/15 09:26 地點 / 地點" 
        : "10/15 09:26 場所 / 場所";
    }
    
    if (this.submitReportBtn) {
      this.submitReportBtn.textContent = this.languageManager.current === "zh" ? "送出" : "送信";
    }
  }

  showMessage(text, isError = false) {
    if (!this.msgEl) return;
    
    this.msgEl.textContent = text;
    this.msgEl.style.color = isError ? "red" : "green";
    setTimeout(() => { this.msgEl.textContent = ""; }, 3000);
  }

  submitReport() {
    const taskType = this.reportTaskTypeEl?.value;
    const reportType = this.reportTypeEl?.value;
    const comment = this.reportCommentEl?.value.trim();

    if (!comment) {
      const errorMsg = this.languageManager.current === "zh" 
        ? "請輸入內容" 
        : "コメントを入力してください";
      this.showMessage(errorMsg, true);
      return;
    }

    const report = {
      id: Date.now(),
      taskType,
      reportType,
      comment,
      timestamp: new Date().toLocaleString(this.languageManager.current === "zh" ? "zh-TW" : "ja-JP")
    };

    const reports = StorageHelper.get(CONFIG.REPORT_STORAGE_KEY, []);
    reports.unshift(report);
    StorageHelper.set(CONFIG.REPORT_STORAGE_KEY, reports);

    if (this.reportCommentEl) {
      this.reportCommentEl.value = "";
    }
    
    const successMsg = this.languageManager.current === "zh" ? "感謝你" : "ありがとうございました";
    this.showMessage(successMsg);
    this.loadReports();
  }

  loadReports() {
    if (!this.reportListEl) return;
    
    const reports = StorageHelper.get(CONFIG.REPORT_STORAGE_KEY, []);
    this.reportListEl.innerHTML = "";

    reports.forEach(r => {
      const div = DOMHelper.createElement("div", "reportItem");
      const taskLabel = this.getTaskTypeLabelSingle(r.taskType);
      const reportLabel = this.getReportTypeLabelSingle(r.reportType, r.taskType);
      
      div.innerHTML = `[${r.timestamp}] ${taskLabel} ${reportLabel} ${r.comment}`;
      this.reportListEl.appendChild(div);
    });
  }

  clearReports() {
    StorageHelper.remove(CONFIG.REPORT_STORAGE_KEY);
    this.loadReports();
  }

  getTaskTypeLabelSingle(key) {
    const task = REPORTTASK_TYPES.find(t => t.key === key);
    return task ? (this.languageManager.current === "zh" ? task.labelZh : task.labelJp) : key;
  }

  getReportTypeLabelSingle(value, taskKey) {
    const types = ["gishiki", "shirao", "sengentou"].includes(taskKey)
      ? REPORT_TYPES.default
      : REPORT_TYPES.otherOnly;
    const type = types.find(t => t.value === value) || { labelZh: value, labelJp: value };
    return this.languageManager.current === "zh" ? type.labelZh : type.labelJp;
  }

  updateAll() {
    this.updateReportText();
    this.updateReportTaskOptions();
    this.updateReportTypeOptions();
    this.updateReportCommentPlaceholder();
  }
}