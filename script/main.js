/* ==========================
   ==== メインアプリケーション ====
   ========================== */

import { CONFIG, DATE_RANGES } from './config.js';
import { LanguageManager, TimeUtils, TaskUtils, DOMHelper } from './utils.js';
import { ExcelDataLoader, TaskDataProcessor } from './taskProcessor.js';
import { UIRenderer } from './uiRenderer.js';
import { ReportManager } from './reportManager.js';

/**
 * メインアプリケーションクラス
 */
class TaskScheduleApp {
  constructor() {
    // 依存関係の初期化
    this.languageManager = new LanguageManager();
    this.timeUtils = new TimeUtils(this.languageManager);
    this.taskUtils = new TaskUtils(this.languageManager);
    this.excelLoader = new ExcelDataLoader(this.languageManager);
    this.taskProcessor = new TaskDataProcessor(this.languageManager, this.timeUtils, this.taskUtils);
    this.uiRenderer = new UIRenderer(this.languageManager, this.timeUtils, this.taskUtils);
    this.reportManager = new ReportManager(this.languageManager);

    // データキャッシュ
    this.cachedExcelRows = null;
    this.minuteRefreshIntervalId = null;
  }

  /**
   * アプリケーション初期化
   */
  async init() {
    this.languageManager.detect();
    this.setupLanguageToggle();
    this.uiRenderer.updateTopTime();

    if (this.isInDateRange()) {
      this.initInDateRange();
    } else {
      this.initOutDateRange();
    }

    this.reportManager.updateAll();
    this.reportManager.loadReports();
    this.startTimers();
  }

  /**
   * 言語切り替えボタンの設定
   */
  setupLanguageToggle() {
    const langBtn = document.getElementById("langBtn");
    if (!langBtn) return;

    this.updateLangButtonText();

    langBtn.addEventListener("click", () => {
      this.languageManager.toggle();
      this.updateLangButtonText();
      this.uiRenderer.updateTopTime();

      if (this.isInDateRange()) {
        this.initInDateRange();
      } else {
        this.initOutDateRange();
      }

      this.reportManager.updateAll();
    });
  }

  /**
   * 言語ボタンテキスト更新
   */
  updateLangButtonText() {
    const langBtn = document.getElementById("langBtn");
    if (langBtn) {
      langBtn.textContent = this.languageManager.current === "zh"
        ? "日本鯖切替"
        : "切換到台服";
    }
  }

  /**
   * 特定期間内かチェック
   */
  isInDateRange() {
    const now = this.timeUtils.getNowBySVR();
    const range = DATE_RANGES[this.languageManager.current];
    return now >= range.start && now <= range.end;
  }

  /**
   * 共通初期化処理
   */
  initCommon({ showFirstWeek }) {
    this.uiRenderer.updateNotice();

    // シリーズの第一週目
    const firstWeekDiv = document.getElementById("firstWeek");
    if (firstWeekDiv) {
      firstWeekDiv.style.display = showFirstWeek ? "block" : "none";
      if (showFirstWeek) {
        this.uiRenderer.updateFirstWeekText();
      }
    }

    DOMHelper.updateElement("taskContainer", null, "block");
    this.loadTasksAndRender();

    // 分単位の更新タイマー
    if (this.minuteRefreshIntervalId) {
      clearInterval(this.minuteRefreshIntervalId);
    }
    this.minuteRefreshIntervalId = setInterval(() => {
      if (this.cachedExcelRows) {
        this.renderAllGroups(this.cachedExcelRows);
      }
    }, CONFIG.REFRESH_INTERVAL);
  }

  /**
   * 期間外の初期化
   */
  initOutDateRange() {
    this.initCommon({ showFirstWeek: false });
  }

  /**
   * 期間内の初期化
   */
  initInDateRange() {
    this.initCommon({ showFirstWeek: true });
  }

  /**
   * タスクデータのロードとレンダリング
   */
  async loadTasksAndRender() {
    const rows = await this.excelLoader.loadExcel();
    this.cachedExcelRows = rows;
    this.renderAllGroups(rows);
  }

  /**
   * すべてのタスクグループをレンダリング
   */
  renderAllGroups(rows) {
    const container = document.getElementById("taskContainer");
    if (!container || container.style.display === "none") {
      return;
    }

    // 展開状態を保存
    const openStates = this.saveOpenStates(container);

    container.innerHTML = "";

    const now = this.timeUtils.getNowBySVR();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentDay = now.getDay();

    const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
    const todayWeekZh = WEEKDAYS_ZH[currentDay];
    const tomorrowWeekZh = WEEKDAYS_ZH[(currentDay + 1) % 7];

    this.taskProcessor.getVisibleTaskTypes().forEach(type => {
      const group = this.createTaskGroup(
        rows,
        type,
        todayWeekZh,
        tomorrowWeekZh,
        currentHour,
        currentMinute,
        openStates
      );
      container.appendChild(group);
    });
  }

  /**
   * 展開状態を保存
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
   * タスクグループの作成
   */
  createTaskGroup(rows, type, todayWeekZh, tomorrowWeekZh, currentHour, currentMinute, openStates) {
    // 今日と明日のタスクリストを取得
    let todayList = this.taskProcessor.getTaskListForWeek(rows, type, todayWeekZh);
    let tomorrowList = this.taskProcessor.getTaskListForWeek(rows, type, tomorrowWeekZh);

    // 組み合わせ
    let combinedList = [...todayList];
    if (tomorrowList.length > 0 && currentHour > 20) {
      const markedTomorrowList = tomorrowList.map(item => ({
        ...item,
        isNextDay: true,
        displayTime: item.time
      }));
      combinedList = [...todayList, ...markedTomorrowList];
    }

    // メンテナンスタスクのマージ
    combinedList = this.taskUtils.mergeConsecutiveMaintenance(combinedList);

    // タスクの分類
    const { previousItem, currentItem, nextItems, remainingItems } =
      this.taskProcessor.categorizeTasksByTime(combinedList, currentHour, currentMinute);

    // グループ要素の作成
    const group = DOMHelper.createElement("div", `group ${type.key}`);

    // 前の時間のタスク
    const lang = this.languageManager.current;
    let showPrevious = false;

    if (lang === "jp") {
      showPrevious = true;
    } else if (lang === "zh") {
      if (type.key === "gishiki") {
        showPrevious = true;
      } else if ((type.key === "shirao" || type.key === "sengen") && previousItem) {
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

    // 現在のタスク
    const curRow = this.uiRenderer.createCurrentTaskRow(type, currentItem);
    group.appendChild(curRow);

    // タスクラッパー
    const wrapper = DOMHelper.createElement("div", "taskWrapper");

    // 次の2時間のタスク
    nextItems.forEach(item => {
      wrapper.appendChild(this.uiRenderer.createTaskRow(item, false));
    });

    // 残りのタスク（折りたたみ可能）
    const remWrapper = DOMHelper.createElement("div", "remainingContainer");
    if (openStates[type.key]) {
      remWrapper.classList.add('open');
    }

    remainingItems.forEach(item => {
      remWrapper.appendChild(this.uiRenderer.createTaskRow(item, true));
    });

    wrapper.appendChild(remWrapper);

    // フッターとボタン
    const footer = this.uiRenderer.createFooterWithButton(remWrapper, remainingItems, openStates[type.key]);
    wrapper.appendChild(footer);

    group.appendChild(wrapper);

    return group;
  }

  /**
   * タイマーの開始
   */
  startTimers() {
    // 1秒ごとに時刻を更新
    setInterval(() => this.uiRenderer.updateTopTime(), 1000);

    // 1時間ごとにデータを更新
    setInterval(() => {
      this.uiRenderer.updateTopTime();

      if (this.isInDateRange()) {
        this.initInDateRange();
      } else {
        this.initOutDateRange();
      }
    }, CONFIG.HOUR_INTERVAL);
  }
}

// アプリケーションの起動
document.addEventListener("DOMContentLoaded", () => {
  const app = new TaskScheduleApp();
  app.init();
});