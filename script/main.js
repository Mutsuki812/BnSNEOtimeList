/* ==========================
   ==== 主應用程式 ====
   ========================== */

import { CONFIG, DATE_RANGES, WEEKDAYS } from './config.js?v=20260520-1';
import { TimeUtils, TaskUtils, DOMHelper } from './utils.js';
import { ExcelDataLoader, TaskDataProcessor } from './taskProcessor.js';
import { UIRenderer } from './uiRenderer.js';
import { ReportManager } from './reportManager.js';
import { SoundManager } from './soundManager.js';
import { OnlinePredictionManager } from './onlinePrediction.js';
import { UserManager } from './userManager.js';
import { SupplementalManager } from './supplementalManager.js';

/**
 * 主應用程式類別
 */
class TaskScheduleApp {
  constructor() {
    // 初始化依賴項目
    this.timeUtils = new TimeUtils();
    this.taskUtils = new TaskUtils();
    this.excelLoader = new ExcelDataLoader(this.timeUtils);
    this.taskProcessor = new TaskDataProcessor(this.timeUtils, this.taskUtils);
    this.soundManager = new SoundManager();
    this.userManager = new UserManager(this.soundManager);
    this.uiRenderer = new UIRenderer(this.timeUtils, this.taskUtils, this.soundManager);
    this.reportManager = new ReportManager(this.userManager, this.timeUtils);
    this.onlinePredictionManager = new OnlinePredictionManager(this.timeUtils, this.userManager, this.soundManager);
    this.supplementalManager = new SupplementalManager(this.timeUtils, this.userManager, this.onlinePredictionManager);

    // 資料快取
    this.cachedExcelRows = null;
    this.minuteRefreshIntervalId = null;
    this.minuteRefreshTimeoutId = null;
    this.hourlyRefreshIntervalId = null;
    this.hourlyRefreshTimeoutId = null;
    this.secondlyIntervalId = null; // 載入操作的序列號，用來處理非同步渲染的競爭問題。
    this.worker = null;
    this.loadToken = 0;
    
    // 記錄最後播放的時間，防止世界王音效重複播放
    this.lastPlayedId = null;
  }

  /**
   * 應用程式初始化
   */
  async init() {
    this.uiRenderer.updateTopTime();
    this.initWorker();

    // 優先渲染功能按鈕，不等待 Excel 載入
    this.renderFunctionalButtons();

    if (this.isInDateRange()) {
      this.initInDateRange();
    } else {
      this.initOutDateRange();
    }

    this.reportManager.updateAll();
    this.reportManager.loadReports();
    this.startTimers();

    // 綁定隱藏的管理者登入觸發點
    const timeBox = document.getElementById('timeBox');
    if (timeBox) {
      timeBox.addEventListener('click', (e) => {
        if (e.target.classList.contains('admin-trigger')) {
          this.userManager.showAdminLoginModal();
        }
      });
    }

    // 僅在中文環境下，延遲短時間後顯示音效解鎖提示，引導使用者互動
    // 這樣可以確保音效功能正常運作
    setTimeout(() => {
      this.soundManager.showUnlockModal();
    }, 500);
  }

  /**
   * 初始化 Web Worker
   */
  initWorker() {
    if (typeof(Worker) !== "undefined") {
      this.worker = new Worker('./script/worker.js');
      
      this.worker.postMessage({
        type: 'INIT',
        config: { url: CONFIG.SUPABASE_URL, key: CONFIG.SUPABASE_KEY }
      });

      this.worker.onmessage = (e) => {
        const { type } = e.data;
        if (type === 'DB_UPDATE') {
          console.log('[即時更新] 收到資料庫異動訊號，重新獲取數據');
          this.loadTasksAndRender(); // 觸發全域重新渲染
        } else if (type === 'TICK_MINUTE') {
          // 來自 Worker 的精準計時，確保網頁佇立時仍準確更新
          if (this.cachedExcelRows) this.renderAllGroups(this.cachedExcelRows);
        }
      };
    }
  }

  /**
   * 檢查是否在特定日期範圍內
   */
  isInDateRange() {
    const now = this.timeUtils.getNowBySVR();
    const start = this.timeUtils.getShiftedDate(DATE_RANGES.start);
    const end = this.timeUtils.getShiftedDate(DATE_RANGES.end);
    return now >= start && now <= end;
  }

  /**
   * 通用初始化處理
   */
  initCommon({ isSpecialPeriod }) {
    // 標題公告：常態顯示
    this.uiRenderer.updateTitleNotice();

    // 常態公告：僅在特殊期間外顯示
    if (isSpecialPeriod) {
      DOMHelper.updateElement("regularNotice", undefined, "none");
    } else {
      this.uiRenderer.updateRegularNotice();
    }

    // 限時公告：僅在特殊期間內顯示
    if (isSpecialPeriod) {
      this.uiRenderer.updateTemporaryNoticeText();
    } else {
      DOMHelper.updateElement("temporaryNotice", undefined, "none");
    }

    DOMHelper.updateElement("taskContainer", null, "block");
    this.loadTasksAndRender();

    // 原本的 minuteRefreshIntervalId 改由 Worker 處理
    // startTimers() 內僅保留秒級 UI 更新
  }

  /**
   * 非活動期間的初始化
   */
  initOutDateRange() {
    this.initCommon({ isSpecialPeriod: false });
  }

  /**
   * 活動期間內的初始化
   */
  initInDateRange() {
    this.initCommon({ isSpecialPeriod: true });
    // onlinePredictionManager 的初始化已移至 loadTasksAndRender 中。
    // 這是為了防止在資料載入完成前渲染舊 UI 導致畫面閃爍。
  }

  /**
   * 載入任務資料並渲染
   */
  async loadTasksAndRender() {
    this.loadToken++; // 產生新的載入序列號，使舊請求的渲染作廢。
    const currentToken = this.loadToken;

    const loadPromises = [this.excelLoader.loadExcel()];

    // 如果在特殊活動期間，同時初始化線上預測系統
    if (this.isInDateRange()) {
      loadPromises.push(this.onlinePredictionManager.init());
    } else {
      this.onlinePredictionManager.isInitialized = false;
    }

    // 等待所有必要的資料載入完成
    const [rows] = await Promise.all(loadPromises);

    // 在 await 之後，檢查是否有新的載入請求已開始。若有，則中止本次渲染。
    if (currentToken !== this.loadToken) {
      console.log(`[渲染] 操作已中止 (序號: ${currentToken})，已有新的載入請求 (序號: ${this.loadToken})。`);
      return;
    }

    this.cachedExcelRows = rows;
    this.renderAllGroups(rows);
  }

  /**
   * 渲染所有任務群組
   * @param {Array} rows - Excel/JSON 資料列
   */
  renderAllGroups(rows) {
    const container = document.getElementById("taskContainer");
    if (!container || container.style.display === "none") {
      return;
    }

    // 儲存展開狀態
    const openStates = this.saveOpenStates(container);
    // 儲存線上回報系統的輸入狀態
    const inputStates = this.onlinePredictionManager.saveInputStates();

    container.innerHTML = "";

    const now = this.timeUtils.getNowBySVR();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentDay = now.getDay();
    
    // 將星期轉換為資料庫對應的數字 (1=Mon ... 6=Sat, 7=Sun)
    const todayWeek = currentDay === 0 ? 7 : currentDay;
    const tomorrowDayIndex = (currentDay + 1) % 7;
    const tomorrowWeek = tomorrowDayIndex === 0 ? 7 : tomorrowDayIndex;

    const isActivityPeriod = this.isInDateRange();

    this.taskProcessor.getVisibleTaskTypes().forEach(type => {
      const group = this.createTaskGroup(
        rows,
        type,
        todayWeek,
        tomorrowWeek,
        currentHour,
        currentMinute,
        currentDay,
        openStates,
        isActivityPeriod
      );
      container.appendChild(group);
    });

    // 渲染完成後，注入線上預測與回報 UI
    this.onlinePredictionManager.updateView(inputStates);
  }

  /**
   * 渲染功能區 (世界王音效 + 補完計畫)
   * 獨立於任務列表，確保穩定顯示
   */
  renderFunctionalButtons() {
    const bossSoundEl = document.querySelector('.bossSound');
    const isActivityPeriod = this.isInDateRange();

    if (bossSoundEl) {
      bossSoundEl.innerHTML = ''; // 清空重新渲染
      
      this.renderWorldBossToggle(bossSoundEl);

      // 補完計畫暫時隱藏 (功能尚未開發完成)
      // this.supplementalManager.renderEntryButton(bossSoundEl);
    }
  }

  /**
   * 渲染世界王音效切換開關
   */
  renderWorldBossToggle(parentEl) {
    const isEnabled = this.soundManager.isSoundEnabled('world_boss');
    const container = DOMHelper.createElement('div', 'user-info-content switch-container');
    container.innerHTML = `
      <span class="switch-label">世界王音效</span>
      <label class="neumo-switch">
        <input type="checkbox" id="wbSoundToggle" ${isEnabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    `;
    
    const checkbox = container.querySelector('#wbSoundToggle');
    checkbox.onchange = () => {
      this.soundManager.unlockAudio();
      this.soundManager.toggleSound('world_boss');

      // 如果切換後的狀態為開啟，則播放提示音
      if (checkbox.checked && typeof this.soundManager.playEffect === 'function') {
        this.soundManager.playEffect('./audio/soundON.mp3');
      }
    };
    
    parentEl.appendChild(container);
  }
  
  /**
   * 檢查並播放預告音效
   */
  checkPreAlerts() {
    if (!this.cachedExcelRows) {
      console.log('[預警檢查] 無快取 Excel 資料，跳過預警。');
      return;
    }
    
    // 特殊期間內，完全禁用基於靜態班表的預警音效
    if (this.isInDateRange()) {
      console.log('[預警檢查] 處於活動期間，跳過靜態班表預警。');
      return;
    }

    const now = this.timeUtils.getNowBySVR();
    const s = now.getSeconds();

    // 仙幻島 (sengen) 野王出現前10秒提示 (任務時間 + 4分50秒)
    if (s === 50) {
      // 當前時間是 HH:MM:50，我們要找的任務時間是 HH:(MM-4):00
      // 所以我們從當前時間回推4分鐘，來取得任務應該開始的小時與分鐘
      const taskTime = new Date(now.getTime() - (4 * 60 * 1000));
      const tHour = taskTime.getHours();
      const tMinute = taskTime.getMinutes();
      const tDay = taskTime.getDay();

      const week = tDay === 0 ? 7 : tDay;

      const type = { key: "sengen" };
      const tasks = this.taskProcessor.getTaskListForWeek(this.cachedExcelRows, type, week);

      // 檢查在 4 分鐘前是否有仙幻島任務
      const hasTask = tasks.some(t => {
        const [h, m] = t.time.split(":").map(Number);
        return h === tHour && m === tMinute;
      });

      if (hasTask) {
        this.soundManager.playSengenPreAlert();
      }
    }
  }

  /**
   * 檢查並播放靜態班表音效 (儀式、白青、仙幻島)
   * 只有在非活動期間，或該任務未啟用線上系統時才播放
   */
  checkStaticTaskSounds() {
    if (!this.cachedExcelRows) return;

    const now = this.timeUtils.getNowBySVR();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const second = now.getSeconds();

    // 只在進入新分鐘的 0-5 秒內檢查，避免重複觸發
    if (second > 5) return;

    const currentDay = now.getDay();
    const todayWeek = currentDay === 0 ? 7 : currentDay;
    const isActivityPeriod = this.isInDateRange();

    this.taskProcessor.getVisibleTaskTypes().forEach(type => {
      // 活動期間且該任務有線上系統，不播放靜態音效 (符合需求：活動期間儀式不播放)
      if (isActivityPeriod && type.useOnlineSystem) return;

      const todayList = this.taskProcessor.getTaskListForWeek(this.cachedExcelRows, type, todayWeek);
      todayList.forEach(item => {
        if (item.time) {
          const [h, m] = item.time.split(":").map(Number);
          if (h === currentHour && m === currentMinute) {
            // 維護中不播放
            if (this.taskUtils.isMaintenanceTask(item)) return;

            // 世界王時間抑制
            const isTargetTask = ['gishiki', 'shirao', 'sengen'].includes(type.key);
            if (isTargetTask) {
              const isWeekend = (currentDay === 0 || currentDay === 6);
              const isDailySuppressionTime = (currentHour === 20 && currentMinute >= 50 && currentMinute <= 59);
              const isWeekendSuppressionTime = (isWeekend && currentHour === 14 && currentMinute >= 50 && currentMinute <= 59);
              if (isDailySuppressionTime || isWeekendSuppressionTime) return;
            }
            this.soundManager.playTaskSound(type.key, item);
          }
        }
      });
    });
  }

  /**
   * 檢查並播放世界王提示音
   */
  checkAndPlayWorldBossSound() {
    const now = this.timeUtils.getNowBySVR();
    const day = now.getDay(); // 0=日, 1=一, ..., 6=六
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();

    let audioSrc = null;
    const isWeekend = (day === 0 || day === 6);

    // 判斷播放ID (HH:MM 格式)
    const playId = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    
    // 如果這一分鐘已經播放過，則跳過
    if (this.lastPlayedId === playId) {
      return;
    }

    // 考慮到分頁在背景執行時的計時器節流 (Throttling)，只在進入新分鐘的 0-5 秒內觸發
    // 這確保了即使瀏覽器佇立，仍能在正確的時間播放
    if (second > 5) return;

    if (hour === 20) {
      if (minute === 50) audioSrc = './audio/boss10.mp3';
      else if (minute === 55) audioSrc = './audio/boss5.mp3';
      else if (minute === 59) audioSrc = './audio/boss1.mp3';
    } else if (isWeekend && hour === 14) {
      if (minute === 50) audioSrc = './audio/boss10.mp3';
      else if (minute === 55) audioSrc = './audio/boss5.mp3';
      else if (minute === 59) audioSrc = './audio/boss1.mp3';
    }

    if (audioSrc) {
      // 標記這一分鐘已處理，避免重複播放
      this.lastPlayedId = playId;
      console.log(`[世界王] 精確秒數觸發 (${second}s)：在 ${hour}:${minute} 播放 ${audioSrc}`);
      console.log(`[世界王] 成功觸發：在 ${playId} 播放 ${audioSrc}`);
      this.soundManager.playWorldBossSound(audioSrc, playId);
    }
  }

  /**
   * 儲存目前的展開狀態 (其他時間是否已展開)
   * @param {HTMLElement} container - 任務容器元素
   */
  saveOpenStates(container) {
    const openStates = {};
    this.taskProcessor.getVisibleTaskTypes().forEach(type => {
      const existingGroup = container.querySelector(`.group.${type.key}`);
      if (existingGroup) {
        const remContainer = existingGroup.querySelector('.remainingContainer');
        if (remContainer && remContainer.classList.contains('open')) {
          openStates[type.key] = true;
        }
      }
    });
    return openStates;
  }

  /**
   * 建立單一類型的任務群組 (包含 UI 元素)
   */
  createTaskGroup(rows, type, todayWeek, tomorrowWeek, currentHour, currentMinute, currentDay, openStates, isGlobalActivity) {
    // 確保 isOnlineMode 判定基準一致
    const isActivityPeriod = this.isInDateRange(); 
    const isOnlineMode = isGlobalActivity && type.useOnlineSystem;

    // 獲取今天和明天的任務列表
    let todayList = this.taskProcessor.getTaskListForWeek(rows, type, todayWeek);
    let tomorrowList = this.taskProcessor.getTaskListForWeek(rows, type, tomorrowWeek);

    // 組合列表
    let combinedList = [...todayList];
    if (tomorrowList.length > 0 && currentHour > 20) {
      const markedTomorrowList = tomorrowList.map(item => ({
        ...item,
        isNextDay: true,
        displayTime: item.time
      }));
      combinedList = [...todayList, ...markedTomorrowList];
    }

    // 合併維護任務
    combinedList = this.taskUtils.mergeConsecutiveMaintenance(combinedList);

    // 任務分類
    const { previousItem, currentItem, nextItems, remainingItems, isInMaintenance } =
      this.taskProcessor.categorizeTasksByTime(combinedList, currentHour, currentMinute);

    // 建立群組元素
    const group = DOMHelper.createElement("div", `group ${type.key}`);

    // 前一小時的任務
    let showPrevious = false;

    // 僅在非線上模式(非特殊期間)顯示前一小時提示
    if (!isOnlineMode) {
      if (type.key === "gishiki" || type.key === "shirao") {
        showPrevious = true;
      } else if (type.key === "sengen" && previousItem) {
        const prevMin = parseInt(previousItem.time.split(":")[1], 10);
        if (prevMin >= 55 && currentMinute <= 5) {
          showPrevious = true;
        }
      }
    }

    if (showPrevious) {
      const previousRow = this.uiRenderer.createPreviousHourTaskRow(
        previousItem,
        currentItem,
        currentHour,
        currentMinute,
        type
      );
      group.appendChild(previousRow);
    }

    // 目前的任務
    const curRow = this.uiRenderer.createCurrentTaskRow(type, currentItem, isOnlineMode);
    group.appendChild(curRow);

    // 在活動期間外顯示的傳統任務容器
    const wrapper = DOMHelper.createElement("div", "taskWrapper");
    // 在活動期間內顯示的線上回報系統容器
    const onlineWrapper = DOMHelper.createElement("div", "onlineWrapper");

    // 總是將內容添加到傳統容器中
    // 接下來2小時的任務
    nextItems.forEach(item => {
      wrapper.appendChild(this.uiRenderer.createTaskRow(item, false, type));
    });

    // 剩餘的任務 (可折疊)
    const remWrapper = DOMHelper.createElement("div", "remainingContainer");
    if (openStates[type.key]) {
      remWrapper.classList.add('open');
    }
    remainingItems.forEach(item => {
      remWrapper.appendChild(this.uiRenderer.createTaskRow(item, true, type));
    });
    wrapper.appendChild(remWrapper);

    // 頁尾與按鈕
    const footer = this.uiRenderer.createFooterWithButton(remWrapper, remainingItems, openStates[type.key]);
    wrapper.appendChild(footer);

    group.appendChild(wrapper);
    group.appendChild(onlineWrapper);

    // 根據 isInitialized 的狀態切換顯示
    // 關鍵修改：只要 useOnlineSystem 是 false，就必須顯示傳統 wrapper
    if (!this.onlinePredictionManager.isInitialized || !isOnlineMode) {
      onlineWrapper.style.display = 'none';
      wrapper.style.display = 'block';
    } else {
      wrapper.style.display = 'none';
      onlineWrapper.style.display = 'block';
    }

    return group;
  }

  /**
   * 啟動和重置計時器 (秒級、分級、時級更新)
   */
  startTimers() {
    // 清除所有現有的計時器
    clearInterval(this.secondlyIntervalId);
    clearTimeout(this.minuteRefreshTimeoutId);
    clearInterval(this.minuteRefreshIntervalId);
    clearTimeout(this.hourlyRefreshTimeoutId);
    clearInterval(this.hourlyRefreshIntervalId);

    const now = this.timeUtils.getNowBySVR();

    // 每秒更新一次時間
    this.secondlyIntervalId = setInterval(() => {
      // 將音效檢查移至最頂端，優先於 UI 渲染執行，避免阻塞
      this.checkAndPlayWorldBossSound();
      this.checkStaticTaskSounds();
      this.checkPreAlerts();
      
      this.uiRenderer.updateTopTime();
    }, 1000);

    // 每小時更新 (與小時開始時同步)
    const hourlyUpdate = () => {
      this.uiRenderer.updateTopTime();
      if (this.isInDateRange()) {
        this.initInDateRange();
      } else {
        this.initOutDateRange();
      }
    };

    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    const msUntilNextHour = nextHour.getTime() - now.getTime();

    this.hourlyRefreshTimeoutId = setTimeout(() => {
      hourlyUpdate();
      this.hourlyRefreshIntervalId = setInterval(hourlyUpdate, CONFIG.HOUR_INTERVAL);
    }, msUntilNextHour);
  }
}

// 啟動應用程式
document.addEventListener("DOMContentLoaded", () => {
  const app = new TaskScheduleApp();
    app.init();
});