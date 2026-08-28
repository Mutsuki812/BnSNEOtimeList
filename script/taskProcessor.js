/* ============================================================
   任務資料處理器
   負責從 Supabase 載入排程資料，並將其轉換、分類為 UI 可直接使用的格式

   Supabase 資料表：
   - schedule_data：儲存各野王/儀式的每週出現時刻表
   ============================================================ */

import { CONFIG, TASK_TYPES } from "./config.js";
import { TimeUtils, TaskUtils, SupabaseHelper } from "./utils.js";

// ============================================================
// 排程資料讀取器
// ============================================================

/**
 * 負責從 Supabase 的 schedule_data 資料表讀取排程資料，
 * 並將原始資料轉換為系統內部統一格式。
 */
export class ScheduleDataLoader {
  /**
   * @param {TimeUtils} timeUtils - 時間工具實例
   */
  constructor(timeUtils) {
    this.timeUtils = timeUtils;
  }

  /**
   * 從 Supabase 的 schedule_data 資料表讀取排程資料。
   * 讀取完成後，呼叫 _transformData 將寬/長表格統一轉換為內部格式。
   * @returns {Promise<Array>} - 轉換後的排程資料陣列；失敗時回傳空陣列
   */
  async loadSchedule() {

    // // TEST ONLY
    // throw {
    //   //status: 403,
    //   message: "connection terminated due to connection timeout"
    // };

    const supabase = await SupabaseHelper.getClient();

    const { data, error } = await supabase
      .from("schedule_data")
      .select("*");

    if (error) {
      console.error(
        "[ScheduleDataLoader] Supabase 查詢失敗：",
        error
      );

      throw error;
    }

    console.log(
      `[ScheduleDataLoader] 排程資料載入成功，共 ${data?.length ?? 0} 筆`
    );

    return this._transformData(data || []);
  }

  /**
   * 將 Supabase 回傳的原始資料列轉換為系統內部統一格式。
   *
   * 支援兩種資料結構：
   * - 長表格（每列含 type 與 time 欄位）：直接解析
   * - 寬表格（每列含 gishikiTime / shiraoTime / sengenTime 欄位）：展開為多列
   *
   * @param {Array<object>} rows - Supabase 回傳的原始資料列
   * @returns {Array<{ week: number, type: string, time: string, location: string }>}
   */
  _transformData(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    // 除錯用：印出第一筆資料的欄位結構，方便驗證資料庫 Schema
    console.log("[Debug] DB 第一筆資料範例：", rows[0]);
    console.log("[Debug] DB 欄位列表：", Object.keys(rows[0]));

    // 星期中文字轉換為資料庫數字 (1=週一 ~ 6=週六, 7=週日)
    const weekMap = { 日: 7, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

    // 寬表格的欄位名稱對應到內部 type key（兼容大小寫）
    const typeMapping = {
      gishikitime: "gishiki",
      shiraotime:  "shirao",
      sengentime:  "sengen",
      gishikiTime: "gishiki",
      shiraoTime:  "shirao",
      sengenTime:  "sengen",
    };

    const result = [];

    rows.forEach((row) => {
      // --- 1. 解析星期欄位 ---
      // 優先讀取小寫 week（DB 標準欄位），其次嘗試大寫 Week（舊格式相容）
      let w = row["week"] ?? row["Week"];
      if (typeof w === "string" && weekMap[w] !== undefined) {
        w = weekMap[w];
      } else if (typeof w === "string") {
        w = parseInt(w, 10);
      }

      // --- 2. 解析地點欄位 ---
      const loc = row["location"] ?? row["Location"] ?? "";

      // --- 3. 判斷資料格式並處理 ---
      const rawType = row["type"] ?? row["Type"] ?? row["bossType"];
      const rawTime = row["time"] ?? row["Time"];

      if (rawType && rawTime) {
        // 長表格：直接解析 type 欄位並正規化為內部 key
        let typeKey = String(rawType).toLowerCase();
        if (typeKey.includes("儀式") || typeKey.includes("gishiki")) typeKey = "gishiki";
        else if (typeKey.includes("白青") || typeKey.includes("shirao")) typeKey = "shirao";
        else if (typeKey.includes("仙幻") || typeKey.includes("sengen")) typeKey = "sengen";

        result.push({ week: w, type: typeKey, time: rawTime, location: loc });
      } else {
        // 寬表格：將每個時間欄位展開為獨立的一筆資料
        Object.keys(typeMapping).forEach((key) => {
          if (row[key]) {
            result.push({ week: w, type: typeMapping[key], time: row[key], location: loc });
          }
        });
      }
    });

    return result;
  }
}

// ============================================================
// 任務資料處理器
// ============================================================

/**
 * 負責將已載入的排程原始資料，依照時間與任務類型進行過濾、分類與排序，
 * 為 UI 渲染器提供結構化的任務資料。
 */
export class TaskDataProcessor {
  /**
   * @param {TimeUtils} timeUtils - 時間工具實例
   * @param {TaskUtils} taskUtils - 任務邏輯工具實例
   */
  constructor(timeUtils, taskUtils) {
    this.timeUtils = timeUtils;
    this.taskUtils = taskUtils;
  }

  /**
   * 取得需要在畫面上顯示的任務類型列表。
   * 目前固定顯示三種：儀式、白青、仙幻島。
   * @returns {Array<object>} - TASK_TYPES 中符合條件的類型物件陣列
   */
  getVisibleTaskTypes() {
    const visibleKeys = ["gishiki", "shirao", "sengen"];
    return TASK_TYPES.filter((type) => visibleKeys.includes(type.key));
  }

  /**
   * 從原始資料中篩選出指定任務類型、指定星期的任務列表，並依時間排序。
   * @param {Array}  rows    - 完整的排程原始資料
   * @param {object} type    - 任務類型物件（含 key 屬性）
   * @param {number} week    - 目標星期數字（1-7）
   * @returns {Array<object>} - 排序後的任務列表
   */
  getTaskListForWeek(rows, type, week) {
    return rows
      .filter((r) => parseInt(r["week"], 10) === week && r["type"] === type.key)
      .map((r) => {
        const timeResult = this.timeUtils.normalizeScheduleTime(r["time"]);
        return {
          time:            timeResult.time,
          hasQuestionMark: timeResult.hasQuestionMark,
          content:         r["location"] || "",
          isNextDay:       false,
        };
      })
      .sort((a, b) => this.timeUtils.timeToMinutes(a.time) - this.timeUtils.timeToMinutes(b.time));
  }

  /**
   * 根據當前時間，將任務列表分類為五個群組：
   * - previousItem: 前一小時結束的任務（可能尚未消失，顯示提示）
   * - currentItem:  當前小時正在進行的任務
   * - nextItems:    接下來 2 小時即將出現的任務
   * - remainingItems: 今日其他時間的任務（可折疊顯示）
   * - isInMaintenance: 當前時段是否為維護時段
   *
   * @param {Array}  list           - 已合併維護任務的任務列表
   * @param {number} currentHour    - 當前小時 (0-23)
   * @param {number} currentMinute  - 當前分鐘 (0-59)
   * @returns {object} - 包含各分類任務的物件
   */
  categorizeTasksByTime(list, currentHour, currentMinute) {
    let currentItem  = null;
    let previousItem = null;
    const nextItems              = [];
    const remainingItemsToday    = [];
    const remainingItemsTomorrow = [];

    // 偵測當前小時是否在維護時段內
    const maintenanceHours = this._getMaintenanceHours(list);
    const isInMaintenance  = maintenanceHours.has(currentHour);

    if (isInMaintenance) {
      // 維護時段：只找維護任務作為「當前任務」，其餘歸入接下來或剩餘
      currentItem = this._findMaintenanceItem(list, currentHour);
      this._categorizeNonMaintenanceTasks(list, currentHour, nextItems, remainingItemsToday, remainingItemsTomorrow);
    } else {
      // 一般時段：依據時間區間將任務分配到各分類
      const previousHour   = (currentHour + 23) % 24;
      const halfHourStart  = previousHour * 60 + 30; // 前一小時的 HH:30
      const halfHourEnd    = previousHour * 60 + 59; // 前一小時的 HH:59

      list.forEach((item) => {
        const [itemHour, itemMinute] = item.time.split(":").map(Number);
        const itemTotalMinutes       = itemHour * 60 + (itemMinute || 0);
        const actualHour             = item.isNextDay ? itemHour + 24 : itemHour;

        // 前一小時的任務（可能尚未消失）：
        // 條件：在上一小時的 HH:30 ~ HH:59 之間，且當前時間未超過「任務時間 + 30 分鐘」
        if (!item.isNextDay && !this.taskUtils.isMaintenanceTask(item)) {
          if (itemTotalMinutes >= halfHourStart && itemTotalMinutes <= halfHourEnd) {
            const nowTotalMinutes    = currentHour * 60 + currentMinute;
            const taskDeadlineMinutes = itemTotalMinutes + 30;
            if (nowTotalMinutes <= taskDeadlineMinutes) {
              previousItem = item;
            }
          }
        }

        if (actualHour === currentHour) {
          // 當前小時的任務
          currentItem = item;
        } else if (actualHour === currentHour + 1 || actualHour === currentHour + 2) {
          // 接下來 2 小時的任務
          nextItems.push(item);
        } else if (actualHour > currentHour + 2 && !item.isNextDay && itemHour <= 23) {
          // 今日剩餘任務（超過 2 小時後且非跨日）
          remainingItemsToday.push(item);
        } else if (item.isNextDay && itemHour >= 0 && itemHour <= 5 && actualHour > currentHour + 2) {
          // 明日清晨任務（跨日且在凌晨 5 點前）
          remainingItemsTomorrow.push(item);
        }
      });
    }

    // 決定剩餘任務的呈現策略：
    // - 21點前：只顯示今日剩餘（凌晨部分不顯示）
    // - 21點後：同時顯示今日剩餘與明日清晨任務
    const remainingItems =
      remainingItemsToday.length > 0 || currentHour < 21
        ? remainingItemsToday
        : remainingItemsTomorrow;

    return { previousItem, currentItem, nextItems, remainingItems, isInMaintenance };
  }

  // ----------------------------------------------------------
  // 私有輔助方法
  // ----------------------------------------------------------

  /**
   * 從任務列表中提取所有維護時段的小時集合。
   * @param {Array} list - 任務列表
   * @returns {Set<number>} - 維護時段的小時集合
   */
  _getMaintenanceHours(list) {
    const hours = new Set();
    list.forEach((item) => {
      if (this.taskUtils.isMaintenanceTask(item)) {
        const h = parseInt(item.time.split(":")[0], 10);
        // 若有合併維護時段，補上 start ~ end 之間的所有小時
        const start = item.maintenanceSpanStart ?? h;
        const end   = item.maintenanceSpanEnd   ?? h;
        for (let i = start; i <= end; i++) hours.add(i);
      }
    });
    return hours;
  }

  /**
   * 在維護時段內，找出對應當前小時的維護任務項目。
   * @param {Array}  list        - 任務列表
   * @param {number} currentHour - 當前小時
   * @returns {object|null} - 符合的維護任務項目；找不到時回傳 null
   */
  _findMaintenanceItem(list, currentHour) {
    return (
      list.find((item) => {
        if (!this.taskUtils.isMaintenanceTask(item)) return false;
        const start = item.maintenanceSpanStart ?? parseInt(item.time.split(":")[0], 10);
        const end   = item.maintenanceSpanEnd   ?? start;
        return currentHour >= start && currentHour <= end;
      }) ?? null
    );
  }

  /**
   * 在維護時段內，將非維護任務分配到「接下來 2 小時」或「今日剩餘」。
   * @param {Array}  list                   - 任務列表
   * @param {number} currentHour            - 當前小時
   * @param {Array}  nextItems              - 接收「接下來 2 小時」任務的陣列（傳入後修改）
   * @param {Array}  remainingItemsToday    - 接收「今日剩餘」任務的陣列（傳入後修改）
   * @param {Array}  remainingItemsTomorrow - 接收「明日清晨」任務的陣列（傳入後修改）
   */
  _categorizeNonMaintenanceTasks(list, currentHour, nextItems, remainingItemsToday, remainingItemsTomorrow) {
    list.forEach((item) => {
      if (this.taskUtils.isMaintenanceTask(item)) return;

      const [itemHour] = item.time.split(":").map(Number);
      const actualHour = item.isNextDay ? itemHour + 24 : itemHour;

      if (actualHour === currentHour + 1 || actualHour === currentHour + 2) {
        nextItems.push(item);
      } else if (actualHour > currentHour + 2 && !item.isNextDay) {
        remainingItemsToday.push(item);
      } else if (item.isNextDay && itemHour >= 0 && itemHour <= 5) {
        remainingItemsTomorrow.push(item);
      }
    });
  }
}
