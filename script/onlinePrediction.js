/* ==========================
   ==== 線上預測與回報系統 ====
   ========================== */

import { CONFIG, DATE_RANGES, WEEKDAYS } from './config.js';
import { DOMHelper, SupabaseHelper } from './utils.js';

const CONSTANTS = {
  PREDICTION_OFFSET_MINUTES: {
    START: 85, // +1h 25m
    END: 100,  // +1h 40m
  },
  GISHIKI_LOCATIONS: ['-', '黑森林', '巨岩海岸', '孤村', '土門客棧', '悲鳴村', '灰狼村', '豬豬農場', '鬼都', '雪原(叛軍駐地)', '樹林(北方討伐隊)', '染坊'],
};

export class OnlinePredictionManager {
  constructor(timeUtils, userManager, soundManager) {
    this.timeUtils = timeUtils;
    this.userManager = userManager;
    this.soundManager = soundManager;
    this.lastReports = {}; // 儲存從 GAS 獲取的最新回報資料
    // 初始化狀態旗標
    this.isInitialized = false;
    this.openHistoryType = null; // 紀錄當前開啟的歷史紀錄類型
  }

  /**
   * 初始化
   */
  async init() {
    if (!this.isInDateRange()) return;

    // 載入最新回報數據
    await this.fetchPredictionData();
    this.isInitialized = true;
  }

  /**
   * 檢查是否在活動期間內
   */
  isInDateRange() {
    const now = this.timeUtils.getNowBySVR();
    const start = this.timeUtils.getShiftedDate(DATE_RANGES.start);
    const end = this.timeUtils.getShiftedDate(DATE_RANGES.end);
    return now >= start && now <= end;
  }

  /**
   * 從 GAS 獲取預測所需的回報數據
   * 規則：
   * 1. 優先抓取今日的最後一筆回報。
   * 2. 如果今日無任何回報，則抓取昨日的最後一筆回報。
   */
  async fetchPredictionData() {
    try {
      const supabase = await SupabaseHelper.getClient();
      const now = this.timeUtils.getNowBySVR();
      
      // 計算 WeekDay 數字 (1-7)
      const dayOfWeek = now.getDay();
      const todayWeekDay = dayOfWeek === 0 ? 7 : dayOfWeek;
      const yesterdayWeekDay = todayWeekDay === 1 ? 7 : todayWeekDay - 1;

      // 同時抓取今天和昨天的回報資料
      const [todayRes, yesterdayRes] = await Promise.all([
        supabase
        .from('spawn_reports')
        .select('*')
        .eq('weekDay', todayWeekDay)
        .order('timeStamp', { ascending: false }),
        
        supabase
        .from('spawn_reports')
        .select('*')
        .eq('weekDay', yesterdayWeekDay)
        .order('timeStamp', { ascending: false })
      ]);

      const todayData = todayRes.data || [];
      const yesterdayData = yesterdayRes.data || [];

      const reports = {};
      const bossTypes = ['gishiki', 'shirao', 'sengen'];

      bossTypes.forEach(type => {
        // 優先尋找今日最晚的一筆 (因為已經 order desc，所以取第一筆)
        const latestToday = todayData.find(d => d.bossType === type);
        
        if (latestToday) {
          reports[type] = {
            time: latestToday.timeStamp,
            location: latestToday.locationA,
            locationA: latestToday.locationA,
            locationB: latestToday.locationB,
            weekDay: latestToday.weekDay
          };
        } else {
          // 規則 2: 若今日無資料，顯示昨日最晚一筆
          const latestYesterday = yesterdayData.find(d => d.bossType === type);
          if (latestYesterday) {
            reports[type] = {
              time: latestYesterday.timeStamp,
              location: latestYesterday.locationA,
              locationA: latestYesterday.locationA,
              locationB: latestYesterday.locationB,
              weekDay: latestYesterday.weekDay
            };
          }
        }
      });

      this.lastReports = reports;
    } catch (e) {
      console.error("Fetch prediction data error:", e);
      this.lastReports = {};
    }
  }

  /**
   * 從多種格式的時間輸入中解析並格式化為 HH:MM
   * @param {string | Date} timeInput 
   * @returns {string} HH:MM 格式的時間
   */
  _parseAndFormatTime(timeInput) {
    if (!timeInput) return "--:--";

    // 如果是 Date 物件
    if (timeInput instanceof Date) {
      const h = String(timeInput.getHours()).padStart(2, '0');
      const m = String(timeInput.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    }

    const timeStr = String(timeInput);

    // 格式 1: 已經是 "HH:MM"
    if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
      const [h, m] = timeStr.split(':');
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    // 格式 2: 完整日期字串 "Sat Dec 30..."
    const match = timeStr.match(/(\d{1,2}):(\d{2}):\d{2}/);
    if (match) {
      return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
    }

    // 回退
    return timeStr;
  }

  /**
   * 更新 UI (由 main.js 的 renderAllGroups 呼叫)
   */
  updateView() {
    if (!this.isInitialized || !this.isInDateRange()) return;

    this.updatePredictionDisplay("shirao");
    this.updatePredictionDisplay("sengen");
    this.updateGishikiDisplay();
    
    this.injectReportingUI("gishiki");
    this.injectReportingUI("shirao");
    this.injectReportingUI("sengen");
  }

  /**
   * 更新儀式顯示 (只顯示上次出現時間)
   */
  updateGishikiDisplay() {
    const group = document.querySelector(`.group.gishiki`);
    if (!group) return;

    const currentTaskRow = group.querySelector('.taskRow.current');
    if (currentTaskRow) {
      const timeEl = currentTaskRow.querySelector('.col-time');
      const contentEl = currentTaskRow.querySelector('.col-content');

      // 移除可能由 uiRenderer 添加的灰色樣式
      timeEl.classList.remove('gray', 'text-placeholder');
      contentEl.classList.remove('gray', 'text-placeholder');
      
      const lastReport = this.lastReports['gishiki'];
      
      if (lastReport && lastReport.time) {
        const formattedTime = this._parseAndFormatTime(lastReport.time);
        timeEl.textContent = "上次出現";
        timeEl.classList.add('prediction-label');
        contentEl.textContent = `${formattedTime} ${lastReport.locationA || '-'}/${lastReport.locationB || '-'}`;
      } else {
        timeEl.textContent = "尚無數據";
        timeEl.classList.add('prediction-label', 'text-placeholder');
        contentEl.textContent = "等待回報...";
        contentEl.classList.add('text-placeholder');
      }
    }
  }

  /**
   * 更新預測顯示 (白青/仙幻島)
   */
  updatePredictionDisplay(typeKey) {
    const group = document.querySelector(`.group.${typeKey}`);
    if (!group) return;

    const currentTaskRow = group.querySelector('.taskRow.current');
    if (!currentTaskRow) return;

    const timeEl = currentTaskRow.querySelector('.col-time');
    const contentEl = currentTaskRow.querySelector('.col-content');

    // 移除可能由 uiRenderer 添加的灰色樣式
    timeEl.classList.remove('gray', 'text-placeholder');
    contentEl.classList.remove('gray', 'text-placeholder');

    const lastReport = this.lastReports[typeKey];
    
    // 取得目前時間資訊以進行比對
    const now = this.timeUtils.getNowBySVR();
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    const dayOfWeek = now.getDay();
    const todayWeekDay = dayOfWeek === 0 ? 7 : dayOfWeek;

    if (lastReport && lastReport.time) {
      // 計算預測時間
      // 規則：回報時間 + 1小時25分 (Start) ~ + 1小時40分 (End)
      const formattedTime = this._parseAndFormatTime(lastReport.time);
      const [h, m] = formattedTime.split(':').map(Number);

      if (isNaN(h) || isNaN(m)) {
        console.error("時間解析失敗:", lastReport.time);
        timeEl.textContent = "時間格式錯誤";
        contentEl.textContent = "無法計算預測";
        return;
      }
      const reportTotalMinutes = h * 60 + m;

      const startPredTotalMinutes = reportTotalMinutes + CONSTANTS.PREDICTION_OFFSET_MINUTES.START;
      const endPredTotalMinutes = reportTotalMinutes + CONSTANTS.PREDICTION_OFFSET_MINUTES.END;
console.log("end>>>"+endPredTotalMinutes);
      const formatMinutesToTime = (totalMinutes, showTomorrow = true) => {
        const totalHours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const displayHours = totalHours % 24;
        
        const timeStr = `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        return (totalHours >= 24 && showTomorrow)
          ? `明天 ${timeStr}`
          : timeStr;
      };

      // 判斷是否已超過預測時間
      let effectiveCurrentMinutes = currentTotalMinutes;
      if (lastReport.weekDay !== todayWeekDay) {
        // 如果顯示的是昨天的資料，當前分鐘數需加上一整天的分鐘數 (1440) 來做比對
        effectiveCurrentMinutes += 1440;
      }

      let predInfo;
      let predTimeClass = "pred-row-time";
      if (effectiveCurrentMinutes > endPredTotalMinutes) {
        predInfo = "等待最新回報...";
        predTimeClass += " text-placeholder";
      } else {
        const predStartStr = formatMinutesToTime(startPredTotalMinutes, true);
        const predEndStr = formatMinutesToTime(endPredTotalMinutes, false);
        predInfo = `${predStartStr} ～ ${predEndStr}`;

        // 檢查是否到達啟動音效的時間點
        if (effectiveCurrentMinutes === startPredTotalMinutes) {
          this.soundManager.playForecastSound(typeKey);
        }
      }

      // 顯示兩行資訊：上次出現 & 推算時間
      timeEl.innerHTML = `
        <div class="pred-row-label">上次出現</div>
        <div class="pred-row-value">推算時間</div>
      `;
      timeEl.classList.remove('prediction-highlight', 'prediction-label');

      const lastInfo = `${formattedTime} ${lastReport.location || ''}`;
      contentEl.innerHTML = `
        <div class="pred-row-info">${lastInfo}</div>
        <div class="${predTimeClass}">${predInfo}</div>
      `;
      contentEl.classList.remove('prediction-highlight');
    } else {
      timeEl.textContent = "尚無數據";
      timeEl.classList.add('prediction-label', 'text-placeholder');
      contentEl.textContent = "等待回報...";
      contentEl.classList.add('text-placeholder');
    }
  }

  /**
   * 注入回報區塊
   */
  injectReportingUI(typeKey) {
    const group = document.querySelector(`.group.${typeKey}`);
    if (!group) return;

    const wrapper = group.querySelector('.onlineWrapper');
    if (!wrapper) return;

    // 避免重複注入
    if (wrapper.querySelector('.online-report-box')) return;

    const reportBox = DOMHelper.createElement('div', 'online-report-box');
    const { timeInput, timeControlsRow } = this._createTimeControls();
    
    const historyListDiv = DOMHelper.createElement('div', 'report-history-list');
    const { msgDiv, historyBtn, submitBtn, footerRow } = this._createFooterControls(typeKey, historyListDiv);

    let extraInputs, specificInputsRow;

    if (typeKey === 'gishiki') {
      reportBox.appendChild(timeControlsRow);
      ({ specificInputsRow, extraInputs } = this._createGishikiInputs());
      reportBox.appendChild(specificInputsRow);
    } else {
      // _createBossInputs 會直接修改 timeControlsRow，我們只需要接收它回傳的新元素即可。
      const bossInputs = this._createBossInputs(typeKey, timeControlsRow);
      ({ specificInputsRow, extraInputs } = bossInputs);
      reportBox.appendChild(timeControlsRow);
      reportBox.appendChild(specificInputsRow);
    }

    reportBox.appendChild(historyListDiv);
    reportBox.appendChild(footerRow);

    // 如果狀態紀錄為開啟，則自動顯示並加載數據
    if (this.openHistoryType === typeKey) {
      this.loadAndRenderHistory(typeKey, historyListDiv);
    }

    submitBtn.onclick = () => this.handleSubmit(typeKey, timeInput.value, extraInputs, submitBtn, msgDiv);

    wrapper.insertBefore(reportBox, wrapper.firstChild);
  }

  /**
   * 輔助函式：建立時間輸入相關的 UI
   */
  _createTimeControls() {
    const timeControlsRow = DOMHelper.createElement('div', 'report-form-row flex-row');

    const now = this.timeUtils.getNowBySVR();
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = defaultTime;
    timeInput.className = 'report-time-input';
    
    const nowBtn = document.createElement('button');
    nowBtn.textContent = "現在";
    nowBtn.type = "button";
    nowBtn.className = "report-now-btn";
    nowBtn.onclick = () => {
      const n = this.timeUtils.getNowBySVR();
      timeInput.value = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    };

    timeControlsRow.appendChild(DOMHelper.createElement('span', 'report-label', '時間'));
    timeControlsRow.appendChild(timeInput);
    timeControlsRow.appendChild(nowBtn);

    return { timeInput, timeControlsRow };
  }

  /**
   * 輔助函式：建立儀式專用的地點輸入 UI
   */
  _createGishikiInputs() {
    const specificInputsRow = DOMHelper.createElement('div', 'report-form-row flex-row wrap');

    const createSelect = (label) => {
      const wrap = DOMHelper.createElement('span', 'report-label label-inline', `${label} `);
      const sel = document.createElement('select');
      sel.className = 'report-select';
      CONSTANTS.GISHIKI_LOCATIONS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        sel.appendChild(o);
      });
      wrap.appendChild(sel);
      return { wrap, sel };
    };

    const locA = createSelect("地點１");
    const locB = createSelect("地點２");
    
    specificInputsRow.appendChild(locA.wrap);
    specificInputsRow.appendChild(locB.wrap);
    
    const extraInputs = { locA: locA.sel, locB: locB.sel };
    return { specificInputsRow, extraInputs };
  }

  /**
   * 輔助函式：建立野王專用的地點與方式輸入 UI
   */
  _createBossInputs(typeKey, timeControlsRow) {
    // 1. 地點
    const locationOptions = typeKey === 'shirao' ? ['白樺林', '風之平原'] : ['知性森林', '力王山脈', '武神荒野'];
    const locSelect = document.createElement('select');
    locSelect.className = 'report-select';
    locationOptions.forEach(l => {
      const o = document.createElement('option');
      o.value = l;
      o.textContent = l;
      locSelect.appendChild(o);
    });
    timeControlsRow.appendChild(DOMHelper.createElement('span', 'report-label', '地點'));
    timeControlsRow.appendChild(locSelect);

    // 2. 出現方式
    const specificInputsRow = DOMHelper.createElement('div', 'report-form-row');
    specificInputsRow.style.marginTop = '10px';
    const methodOptions = ['系統出字', '打雷中', '王已出'];
    const radioGroupName = `report-method-${typeKey}`;
    const methodContainer = DOMHelper.createElement('div', 'report-radio-container');
    const radioInputs = [];
    methodOptions.forEach((m, index) => {
      const radioId = `radio-${typeKey}-${m.replace(/\s/g, '')}`;
      const label = document.createElement('label');
      label.className = 'report-radio-label';
      label.setAttribute('for', radioId);
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = radioGroupName;
      radio.value = m;
      radio.id = radioId;
      if (index === 0) radio.checked = true;
      radioInputs.push(radio);
      label.appendChild(radio);
      label.appendChild(document.createTextNode(` ${m}`));
      methodContainer.appendChild(label);
    });
    specificInputsRow.appendChild(methodContainer);

    const extraInputs = { methodRadios: radioInputs, location: locSelect };
    return { specificInputsRow, extraInputs };
  }

  /**
   * 輔助函式：建立包含送出按鈕的頁尾 UI
   */
  _createFooterControls(typeKey, historyListDiv) {
    const footerRow = DOMHelper.createElement('div', 'report-form-row flex-row mt-10 gap-5');

    const msgDiv = DOMHelper.createElement('div', 'report-msg');

    const historyBtn = document.createElement('button');
    historyBtn.className = 'report-history-btn';
    historyBtn.innerHTML = '<img src="./images/history30.png" alt="今日紀錄">';
    historyBtn.title = "今日紀錄";
    historyBtn.onclick = () => this.toggleHistory(typeKey, historyListDiv);

    const submitBtn = document.createElement('button');
    submitBtn.textContent = "回報";
    submitBtn.className = "report-submit-btn";
    // 根據任務類型添加對應的背景顏色類別
    submitBtn.classList.add(`type-${typeKey}`);

    footerRow.appendChild(msgDiv);
    footerRow.appendChild(historyBtn);
    footerRow.appendChild(submitBtn);

    return { msgDiv, historyBtn, submitBtn, footerRow };
  }

  /**
   * 切換顯示歷史紀錄
   */
  async toggleHistory(typeKey, listDiv) {
    const isCurrentlyHidden = listDiv.style.display === 'none' || !listDiv.style.display;

    // 關閉所有其他的歷史紀錄列表
    document.querySelectorAll('.report-history-list').forEach(otherList => {
      if (otherList !== listDiv) {
        otherList.style.display = 'none';
      }
    });

    // 如果原本是隱藏的，就打開它並載入資料
    if (isCurrentlyHidden) {
      this.openHistoryType = typeKey;
      this.loadAndRenderHistory(typeKey, listDiv);
    } else {
      // 如果原本是可見的，就將其隱藏
      this.openHistoryType = null;
      listDiv.style.display = 'none';
    }
  }

  /**
   * 載入並渲染歷史數據
   */
  async loadAndRenderHistory(typeKey, listDiv) {
    listDiv.style.display = 'block';
    listDiv.innerHTML = '載入中...';

    const currentUserId = this.userManager.getCurrentUser()?.id;

    try {
      const supabase = await SupabaseHelper.getClient();
      const now = this.timeUtils.getNowBySVR();
      const dayOfWeek = now.getDay();
      const todayWeekDay = dayOfWeek === 0 ? 7 : dayOfWeek;

      const { data: historyData, error } = await supabase
        .from('spawn_reports')
        .select('*, Users(userName)')
        .eq('bossType', typeKey)
        .eq('weekDay', todayWeekDay)
        .order('timeStamp', { ascending: false });

      if (error) throw error;

      if (historyData && historyData.length > 0) {
        listDiv.innerHTML = '';
        historyData.forEach(item => {
          const row = document.createElement('div');
          row.className = 'report-history-item';

          const formattedTime = this._parseAndFormatTime(item.timeStamp);
          const userName = item.Users ? item.Users.userName : '訪客';

          let methodClass = 'hist-tag';
          if (item.method === '系統出字') methodClass += ' tag-system';
          else if (item.method === '打雷中') methodClass += ' tag-thunder';
          else methodClass += ' tag-spawned';

          let locText = item.locationA || '-';
          if (typeKey === 'gishiki' && item.locationB && item.locationB !== '-') {
            locText += ` / ${item.locationB}`;
          }

          row.innerHTML = `
            <div class="hist-left">
              <span class="hist-time gray">${formattedTime}</span>
              <span class="${methodClass}">${item.method || '王已出'}</span>
              <span class="hist-loc">${locText}</span>
            </div>
            <div class="hist-right">
              <span class="hist-user user-tag gray" title="提交者">${userName}</span>
              <span class="hist-actions"></span>
            </div>
          `;

          if (currentUserId && item.user_id === currentUserId) {
            const actionsSpan = row.querySelector('.hist-actions');
            const delBtn = document.createElement('span');
            delBtn.innerHTML = '<img src="./images/delete24.png" alt="刪除" class="icon-delete">';
            delBtn.className = 'hist-del-btn';
            delBtn.title = "刪除回報";
            delBtn.onclick = () => this.deleteReport(item, typeKey, listDiv);
            actionsSpan.appendChild(delBtn);
          }

          listDiv.appendChild(row);
        });
      } else {
        listDiv.innerHTML = '尚無今日紀錄';
      }
    } catch (e) {
      console.error(e);
      listDiv.innerHTML = '載入失敗';
    }
  }

  deleteReport(item, typeKey, listDiv) {
    this.userManager.showConfirmModal("確定刪除此紀錄？", async () => {
      try {
        const user = this.userManager.getCurrentUser();
        if (!user) return;

        const supabase = await SupabaseHelper.getClient();
        // 使用複合主鍵 + user_id 刪除，確保只能刪除自己的資料
        const { error } = await supabase.from('spawn_reports').delete().match({
          timeStamp: item.timeStamp,
          bossType: item.bossType,
          weekDay: item.weekDay,
          user_id: user.id
        });
        if (error) throw error;
        // 顯示成功訊息
        const msgDiv = document.createElement('div');
        msgDiv.className = 'delete-success-msg';
        msgDiv.textContent = '刪除成功！';
        listDiv.prepend(msgDiv);

        // 1秒後刷新數據，但不關閉列表
        setTimeout(() => this.loadAndRenderHistory(typeKey, listDiv), 1000);
      } catch(e) {
        console.error("刪除失敗", e);
        alert("刪除失敗");
      }
    }, true);
  }

  /**
   * 處理回報送出
   */
  async handleSubmit(typeKey, timeVal, inputs, btnElement, msgDiv) {
    if (!timeVal) {
      msgDiv.className = "report-msg error";
      msgDiv.textContent = "請輸入時間";
      return;
    }

    if (typeKey === 'gishiki') {
      if (inputs.locA.value === '-' && inputs.locB.value === '-') {
        msgDiv.className = "report-msg error";
        msgDiv.textContent = "請至少選擇一個地點";
        return;
      }
    }

    const user = await this.userManager.requireUser();
    if (!user) return;

    msgDiv.textContent = "";
		
		// 增加一個鎖，避免短時間重複提交
		if (btnElement.dataset.isSubmitting === 'true') return;

    btnElement.disabled = true;
    btnElement.textContent = "傳送中...";

    // 準備 Payload
    const nowSVR = this.timeUtils.getNowBySVR();
    const dayOfWeek = nowSVR.getDay(); // 0-6 (日-六)
    // 將 weekday 轉換為數字 (1-7) 以保持資料庫一致性
    const weekdayNumber = dayOfWeek === 0 ? 7 : dayOfWeek;
    
    const payload = {
      weekDay: weekdayNumber,
      timeStamp: `${timeVal}:00`, // 傳送 HH:MM:SS 格式
      bossType: typeKey,
      user_id: user.id
    };

    if (typeKey === 'gishiki') {
      payload.locationA = inputs.locA.value;
      payload.locationB = inputs.locB.value;
      payload.method = "系統出字";
    } else {
      const selectedMethod = inputs.methodRadios.find(radio => radio.checked);
      payload.method = selectedMethod ? selectedMethod.value : '王已出'; // Fallback
      payload.locationA = inputs.location.value;
      payload.locationB = "";
    }

    try {
      const supabase = await SupabaseHelper.getClient();
      const { error } = await supabase
        .from('spawn_reports')
        .insert([payload]);
				btnElement.dataset.isSubmitting = 'true';
      
      if (error) {
        throw error;
      }

      msgDiv.className = "report-msg success";
      msgDiv.textContent = "回報成功！感謝您的貢獻。";
      
      // 更新本地緩存並刷新顯示
      this.updateLocalCache(typeKey, payload);
      this.updateView();

    } catch (error) {
      console.error("回報失敗:", error);
      msgDiv.className = "report-msg error";
      msgDiv.textContent = "回報失敗，請稍後再試。";
    } finally {
      btnElement.disabled = false;
      btnElement.textContent = "回報";
			btnElement.dataset.isSubmitting = 'false';
    }
  }

  /**
   * 暫時更新本地緩存以即時反映 UI
   */
  updateLocalCache(typeKey, payload) {
    const newMinutes = this.timeUtils.timeToMinutes(payload.timeStamp);
    const cached = this.lastReports[typeKey];
    
    // 判斷是否更新顯示的邏輯：
    // 1. 目前沒有資料
    // 2. 目前顯示的是昨天的資料 (payload 永遠是今天)
    // 3. 目前顯示的是今天的資料，且新回報的時間 >= 顯示的時間
    const isNewerToday = cached && cached.weekDay === payload.weekDay && newMinutes >= this.timeUtils.timeToMinutes(cached.time);
    const isFirstToday = cached && cached.weekDay !== payload.weekDay;

    if (!cached || isFirstToday || isNewerToday) {
      if (!this.lastReports[typeKey]) this.lastReports[typeKey] = {};
      
      this.lastReports[typeKey].time = payload.timeStamp;
      this.lastReports[typeKey].weekDay = payload.weekDay;
    
      if (typeKey === 'gishiki') {
        this.lastReports[typeKey].locationA = payload.locationA;
        this.lastReports[typeKey].locationB = payload.locationB;
        this.lastReports[typeKey].method = payload.method;
      } else {
        this.lastReports[typeKey].method = payload.method;
        this.lastReports[typeKey].location = payload.locationA;
      }
    }
  }
}