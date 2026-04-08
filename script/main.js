/* ==========================
   ==== 主應用程式 ====
   ========================== */

import { CONFIG, DATE_RANGES, WEEKDAYS } from './config.js?v=20260408-2';
import { TimeUtils, TaskUtils, DOMHelper } from './utils.js';
import { ExcelDataLoader, TaskDataProcessor } from './taskProcessor.js';
import { UIRenderer } from './uiRenderer.js';
import { ReportManager } from './reportManager.js';
import { SoundManager } from './soundManager.js';
import { OnlinePredictionManager } from './onlinePrediction.js';
import { UserManager } from './userManager.js';

/**
 * 主應用程式類別
 */
class TaskScheduleApp {
  constructor() {
    // 初始化依賴項目
    this.userManager = new UserManager();
    this.timeUtils = new TimeUtils();
    this.taskUtils = new TaskUtils();
    this.excelLoader = new ExcelDataLoader(this.timeUtils);
    this.taskProcessor = new TaskDataProcessor(this.timeUtils, this.taskUtils);
    this.soundManager = new SoundManager();
    this.uiRenderer = new UIRenderer(this.timeUtils, this.taskUtils, this.soundManager);
    this.reportManager = new ReportManager(this.userManager);
    this.onlinePredictionManager = new OnlinePredictionManager(this.timeUtils, this.userManager, this.soundManager);

    // 資料快取
    this.cachedExcelRows = null;
    this.minuteRefreshIntervalId = null;
    this.minuteRefreshTimeoutId = null;
    this.hourlyRefreshIntervalId = null;
    this.hourlyRefreshTimeoutId = null;
    this.secondlyIntervalId = null; // 載入操作的序列號，用來處理非同步渲染的競爭問題。
    this.loadToken = 0;
  }

  /**
   * 應用程式初始化
   */
  async init() {
    this.uiRenderer.updateTopTime();

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
  initCommon({ showTemporaryNotice }) {
    this.uiRenderer.updateRegularNotice();

    // 限時公告
    const temporaryNoticeDiv = document.getElementById("temporaryNotice");
    if (temporaryNoticeDiv) {
      const shouldShow = showTemporaryNotice;
      
      temporaryNoticeDiv.style.display = shouldShow ? "block" : "none";

      if (shouldShow) {
        this.uiRenderer.updateTemporaryNoticeText();
      }
    }

    DOMHelper.updateElement("taskContainer", null, "block");
    this.loadTasksAndRender();

    // 分鐘單位的更新計時器
    if (this.minuteRefreshIntervalId) {
      clearInterval(this.minuteRefreshIntervalId);
    }
    this.minuteRefreshIntervalId = setInterval(() => {
      if (this.cachedExcelRows) {
        this.renderAllGroups(this.cachedExcelRows);
      }
    }, CONFIG.REFRESH_INTERVAL);
    // 分鐘單位的更新計時器由 startTimers 統一管理。
  }

  /**
   * 非活動期間的初始化
   */
  initOutDateRange() {
    this.initCommon({ showTemporaryNotice: false });
  }

  /**
   * 活動期間內的初始化
   */
  initInDateRange() {
    this.initCommon({ showTemporaryNotice: true });
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
      console.log(`渲染操作已中止 (Token: ${currentToken})，因為已有新的載入請求 (Token: ${this.loadToken})。`);
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
    this.onlinePredictionManager.updateView();
  }

  /**
   * 檢查並播放預告音效
   */
  checkPreAlerts() {
    if (!this.cachedExcelRows) return;

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

    // 考慮到分頁在背景執行時的計時器節流 (Throttling)，將觸發視窗調整為 30 秒
    // 搭配 SoundManager 內部的 playId (HH:MM) 檢查，同一分鐘內仍只會播放一次
    if (second > 30) return;

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
      const playId = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

      // 只有當這一分鐘還沒播過時，才執行 Log 與播放指令
      if (this.lastPlayedId !== playId) {
        console.log(`[世界王] 精確秒數觸發 (${second}s)：在 ${hour}:${minute} 播放 ${audioSrc}`);
        console.log(`[世界王] 成功觸發：在 ${playId} 播放 ${audioSrc}`);
        this.soundManager.playWorldBossSound(audioSrc, playId);
        this.lastPlayedId = playId; // 標記這一分鐘已處理
      }
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

    // 音效播放檢查：如果存在當前任務且音效尚未播放，則進行播放。
    combinedList.forEach(item => {
      if (item.time) {
        const [h, m] = item.time.split(":").map(Number);
        if (h === currentHour && m === currentMinute) {
          // 只有今天的任務才播放音效，避免播放到明天同一時間的任務
          if (item.isNextDay) {
            console.log(`[音效檢查] 跳過明日任務: ${type.key} 於 ${item.time}`);
            return; // 明天的任務，跳過
          }

          // 如果開啟了線上模式，則「禁止」播放固定班表的音效，改由 OnlinePredictionManager 負責
          // 以免跟 OnlinePredictionManager 觸發的音效重疊
          if (isOnlineMode) {
            return;
          }

          // 維護中，不播放音效
          if (this.taskUtils.isMaintenanceTask(item)) {
            return; // continue to next item in forEach
          }

          // 在世界王出現的時間 (每日 20:50-59, 週末 14:50-59) 暫停儀式/白青/仙幻島的音效
          const isTargetTask = ['gishiki', 'shirao', 'sengen'].includes(type.key);
          if (isTargetTask) {
            const day = currentDay; // 0 = Sunday, 6 = Saturday
            const hour = currentHour;
            const minute = currentMinute;
            const isWeekend = (day === 0 || day === 6);

             const isDailySuppressionTime = (hour === 20 && minute >= 50 && minute <= 59);
             const isWeekendSuppressionTime = (isWeekend && hour === 14 && minute >= 50 && minute <= 59);
 
             if (isDailySuppressionTime || isWeekendSuppressionTime) {
               console.log(`[音效檢查] 因世界王時間，抑制 ${type.key} 在 ${hour}:${minute} 的音效。`);
               return; // continue to next item in forEach
             }
          }
          console.log(`[音效檢查] 時間吻合! 任務: ${type.key}, 時間: ${item.time}`);
          this.soundManager.playTaskSound(type.key, item);
        }
      }
    });

    // 建立群組元素
    const group = DOMHelper.createElement("div", `group ${type.key}`);

    // 前一小時的任務
    let showPrevious = false;

    if (type.key === "gishiki" || type.key === "shirao") {
      showPrevious = true;
    } else if (type.key === "sengen" && previousItem) {
      const prevMin = parseInt(previousItem.time.split(":")[1], 10);
      if (prevMin >= 55 && currentMinute <= 5) {
        showPrevious = true;
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

    // 每秒更新一次時間
    this.secondlyIntervalId = setInterval(() => {
      // 將音效檢查移至最頂端，優先於 UI 渲染執行，避免阻塞
      this.checkAndPlayWorldBossSound();
      this.checkPreAlerts();
      
      this.uiRenderer.updateTopTime();
    }, 1000);

    // 每分鐘更新 (與分鐘開始時同步)
    const minuteUpdate = () => {
      if (this.cachedExcelRows) {
        this.renderAllGroups(this.cachedExcelRows);
      }
    };

    const now = this.timeUtils.getNowBySVR();

    const nextMinute = new Date(now);
    nextMinute.setMinutes(now.getMinutes() + 1, 0, 0);
    const msUntilNextMinute = nextMinute.getTime() - now.getTime();

    this.minuteRefreshTimeoutId = setTimeout(() => {
      minuteUpdate();
      this.minuteRefreshIntervalId = setInterval(minuteUpdate, CONFIG.REFRESH_INTERVAL);
    }, msUntilNextMinute);

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