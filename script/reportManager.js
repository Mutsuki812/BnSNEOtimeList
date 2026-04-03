/* ==========================
   ==== 回報功能 ====
   ========================== */

import { CONFIG, REPORT_TASK, REPORT_TYPES, TEXTS } from "./config.js";
import { DOMHelper, SupabaseHelper } from "./utils.js";

/**
 * 回報管理器
 */
export class ReportManager {
  constructor(userManager) {
    this.userManager = userManager;
    this.render();
    this.updateAll();
    this.loadReports();
    this.attachEventListeners();
  }

  /**
   * 渲染回報系統的 UI 結構
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
          <select id="reportTaskType" aria-label="任務選擇"></select>
          <select id="reportType" aria-label="回報類型"></select>
          <input type="text" id="reportComment" aria-label="備註" placeholder="備註..." autocomplete="off" />
          <div class="reportContainer">
            <div id="reportMessage" role="status" aria-live="polite"></div>
            <div class="reportButtons"><button id="submitReport" class="report-submit-btn">送出</button></div>
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

  /**
   * 綁定 DOM 事件監聽器
   */
  attachEventListeners() {
    this.reportTaskTypeEl?.addEventListener("change", () => {
      this.updateReportTypeOptions();
      this.updateButtonColor();
    });
    this.submitReportBtn?.addEventListener("click", () => this.submitReport());
  }

  /**
   * 更新回報說明文字
   */
  updateReportText() {
    const text = "請幫忙填寫儀式或是白青野王的系統提示時間<br>有你的幫忙 能讓數據更完善 感謝";
    if (this.reportTextEl) {
      this.reportTextEl.innerHTML = text;
    }
  }

  /**
   * 更新任務類型下拉選單
   */
  updateReportTaskOptions() {
    if (!this.reportTaskTypeEl) return;
    
    this.reportTaskTypeEl.innerHTML = "";
    REPORT_TASK.forEach(task => {
      const opt = document.createElement("option");
      opt.textContent = task;
      this.reportTaskTypeEl.appendChild(opt);
    });
  }

  /**
   * 根據選擇的任務更新回報類型選項
   */
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

  /**
   * 更新備註欄位的提示文字
   */
  updateReportCommentPlaceholder() {
    if (this.reportCommentEl) {
      this.reportCommentEl.placeholder = "五 09:26 地點 / 地點";
    }
    
    if (this.submitReportBtn) {
      this.submitReportBtn.textContent = "送出";
    }
  }

  /**
   * 根據選擇的任務更新按鈕顏色
   */
  updateButtonColor() {
    if (!this.submitReportBtn || !this.reportTaskTypeEl) return;
    
    const selectedTask = this.reportTaskTypeEl.value;
    this.submitReportBtn.classList.remove('type-gishiki', 'type-shirao', 'type-sengen', 'type-other');
    
    if (selectedTask.includes('儀式')) this.submitReportBtn.classList.add('type-gishiki');
    else if (selectedTask.includes('白青')) this.submitReportBtn.classList.add('type-shirao');
    else if (selectedTask.includes('仙幻')) this.submitReportBtn.classList.add('type-sengen');
    else this.submitReportBtn.classList.add('type-other');
  }

  /**
   * 顯示操作訊息 (成功或失敗)
   * @param {string} text - 訊息內容
   * @param {boolean} isError - 是否為錯誤訊息
   */
  showMessage(text, isError = false) {
    if (!this.msgEl) return;
    
    this.msgEl.textContent = text;
    this.msgEl.className = isError ? "error" : "success";
    setTimeout(() => { this.msgEl.textContent = ""; }, 3000);
  }

  /**
   * 提交回報至 Supabase
   */
  async submitReport() {
    const taskType = this.reportTaskTypeEl?.value;
    const reportType = this.reportTypeEl?.value;
    const comment = this.reportCommentEl?.value.trim();

    if (!comment) {
      const errorMsg = "請輸入內容";
      this.showMessage(errorMsg, true);
      return;
    }

    const user = await this.userManager.requireUser();
    if (!user) return; // 使用者取消登入

    const payload = {
      bossType: taskType,
      reportType: reportType,
      comment: comment,
      user_id: user.id
    };

    try {
      this.showMessage("傳送中...");
      this.submitReportBtn.disabled = true; // 防止重複點擊
      this.submitReportBtn.textContent = "傳送中...";
      
      console.log('[表單新增] 一般留言區:', payload);

      const supabase = await SupabaseHelper.getClient();
      const { error } = await supabase
        .from('feedback_reports')
        .insert([payload]);

      if (error) {
        throw error;
      }

      if (this.reportCommentEl) { 
        this.reportCommentEl.value = "";
      }
      const successMsg = "感謝你";
      this.showMessage(successMsg);
      // 延遲一下再重新載入
      setTimeout(() => this.loadReports(), 1000);
    } catch (error) {
      console.error("提交回報時發生錯誤:", error);
      const errorMsg = "回報失敗，請稍後再試";
      this.showMessage(errorMsg, true);
    } finally {
      this.submitReportBtn.disabled = false; // 恢復按鈕
      this.submitReportBtn.textContent = "送出";
    }
  }

  /**
   * 從 Supabase 載入現有的回報列表
   */
  async loadReports() {
    if (!this.reportListEl) return;
    
    try {
      const supabase = await SupabaseHelper.getClient();
      const { data: reports, error } = await supabase
        .from('feedback_reports')
        .select('*, Users(userName, role)')
        .order('postTime', { ascending: false })
        .limit(20);

      if (error) {
        throw error;
      }

      this.reportListEl.innerHTML = "";

      if (reports.length === 0) {
        const noReportMsg = "目前尚無回報紀錄";
        this.reportListEl.innerHTML = `<div class="reportItem">${noReportMsg}</div>`;
        return;
      }

      const currentUserId = this.userManager.getCurrentUser()?.id;
      reports.forEach((r) => {
        const div = DOMHelper.createElement("div", "report-history-item");
        const displayTime = r.postTime.substring(5, 16).replace('-', '/').replace('T', ' '); // 顯示 MM/DD HH:mm
        const isAdmin = !!(r.Users && r.Users.role === 'admin');
        const userName = isAdmin ? '管理者' : (r.Users ? r.Users.userName : ''); // 管理者顯示為 [管理者]，一般使用者顯示其名稱
        
        let respond = '';
        // 檢查是否有管理員回覆
        const isResponded = r.respond === true || r.respond === "TRUE";
        if (isResponded) {
          respond = '<img src="./images/thanks24.png" alt="thx!!">';
        }

        // 判斷任務類型以套用顏色類別
        let typeClass = 'hist-tag';
        if (r.bossType.includes('儀式')) typeClass += ' type-gishiki';
        else if (r.bossType.includes('白青')) typeClass += ' type-shirao';
        else if (r.bossType.includes('仙幻')) typeClass += ' type-sengen';
        else typeClass += ' type-other';

        const userClass = isAdmin ? 'hist-user admin-tag' : 'hist-user user-tag gray';
        
        // 判定是否為「其他 - 想說」組合，若是則隱藏 reportType 顯示
        const reportPrefix = (r.bossType === '其他' && r.reportType === '想說') ? '' : `${r.reportType}: `;

        div.innerHTML = `
          <div class="hist-left">
            <span class="hist-time gray">${displayTime}</span>
            <span class="${typeClass}">${r.bossType}</span>
            <span class="hist-loc">${reportPrefix}${r.comment} ${respond}</span>
          </div>
          <div class="hist-right">
            <span class="${userClass}">${userName}</span>
            <span class="hist-actions"></span>
          </div>
        `;

        // 如果是該使用者的回報，顯示刪除按鈕
        if (currentUserId && r.user_id === currentUserId) {
          const actionsSpan = div.querySelector('.hist-actions');
          const delBtn = document.createElement("span");
          delBtn.innerHTML = '<img src="./images/delete24.png" alt="刪除" class="icon-delete">';
          delBtn.className = 'hist-del-btn';
          delBtn.title = "刪除";
          delBtn.onclick = () => this.deleteReport(r.postTime);
          actionsSpan.appendChild(delBtn);
        }

        this.reportListEl.appendChild(div);
      });
    } catch (error) {
      console.error("載入回報時發生錯誤:", error);
      this.reportListEl.innerHTML = `<div class="reportItem" style="color: red;">載入失敗：${error.message}</div>`;
    }
  }

  deleteReport(postTime) {
    this.userManager.showConfirmModal("確定要刪除這條回報嗎？", async () => {
      try {
        const user = this.userManager.getCurrentUser();
        if (!user) return;

        const supabase = await SupabaseHelper.getClient();
        console.log('[表單刪除] 一般留言區:', { postTime, user_id: user.id });

        // 增加 user_id 檢查，確保只能刪除自己的資料
        const { error } = await supabase.from('feedback_reports').delete().eq('postTime', postTime).eq('user_id', user.id);
        if (error) throw error;
        this.showMessage("已刪除");
        this.loadReports();
      } catch (e) {
        console.error(e);
        this.showMessage("刪除失敗", true);
      }
    }, true);
  }

  /**
   * 更新所有 UI 元件
   */
  updateAll() {
    const root = document.getElementById("reportRoot");
    if (root) {
      root.style.display = "block";
    }

    this.updateReportText();
    this.updateReportTaskOptions();
    this.updateReportTypeOptions();
    this.updateReportCommentPlaceholder();
    this.updateButtonColor();
  }
}