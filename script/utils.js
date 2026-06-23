/* ============================================================
   工具函式庫
   提供時間處理、任務邏輯、DOM 操作、儲存與 Supabase 的共用工具
   ============================================================ */

import { CONFIG, MAINTENANCE_PATTERN, WEEKDAYS } from "./config.js";

// ============================================================
// 時間工具類別
// ============================================================

/**
 * 負責所有時間計算與格式化的工具類別。
 * 本專案以台灣伺服器時間 (UTC+8) 為基準，所有時間操作皆需透過此類別。
 */
export class TimeUtils {
  constructor() {}

  /**
   * 將任意 Date 物件強制轉換至 UTC+8 時區。
   * 無論使用者的本地時區為何，均以台灣時間為準。
   * @param {Date} date - 輸入的日期物件
   * @returns {Date} - 對應 UTC+8 的日期物件
   */
  getShiftedDate(date) {
    const utcMs = date.getTime() + date.getTimezoneOffset() * 60_000;
    const utc8OffsetMs = 8 * 60 * 60_000;
    return new Date(utcMs + utc8OffsetMs);
  }

  /**
   * 取得當前台灣伺服器時間 (UTC+8)。
   * @returns {Date} - 當前 UTC+8 的日期物件
   */
  getNowBySVR() {
    return this.getShiftedDate(new Date());
  }

  /**
   * 將 Date 物件格式化為「年/月/日（星期）」字串。
   * 例如：2024/4/20（六）
   * @param {Date} date - 要格式化的日期物件
   * @returns {string} - 格式化後的日期字串
   */
  formatDateLabel(date) {
    const year    = date.getFullYear();
    const month   = date.getMonth() + 1;
    const day     = date.getDate();
    const weekday = WEEKDAYS[date.getDay()];
    return `${year}/${month}/${day}（${weekday}）`;
  }

  /**
   * 將 "HH:MM" 格式的時間字串，轉換為「今日」對應的 Date 物件。
   * 常用於計算剩餘時間或比較任務時間點。
   * @param {string} timeStr - "HH:MM" 格式的時間字串
   * @returns {Date|null} - 轉換後的 Date 物件；格式錯誤時回傳 null
   */
  timeStringToDateToday(timeStr) {
    const now = this.getNowBySVR();
    const [h, m] = (timeStr || "--:--").split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  }

  /**
   * 將 "HH:MM" 格式的時間字串轉換為從午夜 00:00 起算的總分鐘數。
   * 常用於任務時間的數值比較與排序。
   * @param {string} timeStr - "HH:MM" 格式的時間字串
   * @returns {number} - 從午夜起算的總分鐘數；輸入無效時回傳 0
   */
  timeToMinutes(timeStr) {
    if (typeof timeStr !== "string" || timeStr.trim() === "") {
      console.warn("[TimeUtils] 收到無效的時間字串：", timeStr);
      return 0;
    }
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + (minutes || 0);
  }

  /**
   * 判斷當前時間是否落在指定任務時間後的 N 分鐘窗口內。
   * 用於觸發任務警示音效與高亮標記（例如：任務出現後 5 分鐘內）。
   * @param {string} taskTimeStr - 任務時間，格式為 "HH:MM"
   * @param {number} [windowMinutes=5] - 時間窗口長度（分鐘）
   * @returns {boolean} - 若當前時間在窗口內則回傳 true
   */
  isWithinWindow(taskTimeStr, windowMinutes = 5) {
    if (!taskTimeStr || taskTimeStr === "--:--") return false;
    const now     = this.getNowBySVR();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const taskMins = this.timeToMinutes(taskTimeStr);
    return nowMins >= taskMins && nowMins < taskMins + windowMinutes;
  }

  /**
   * 標準化從 Supabase 讀取的時間值。
   * 處理兩種格式：
   * - 數值型：小數表示的時間（如 0.375 代表 09:00，為舊版資料的相容格式）
   * - 字串型：可能包含「_?」不確定標記的時間字串（如 "09:00_?"）
   * @param {string|number} timeStr - Supabase 回傳的原始時間值
   * @returns {{ time: string, hasQuestionMark: boolean }} - 標準化後的 HH:MM 字串與不確定標記
   */
  normalizeScheduleTime(timeStr) {
    if (typeof timeStr === "number") {
      const hours   = Math.floor(timeStr * 24);
      const minutes = Math.floor((timeStr * 24 - hours) * 60);
      return {
        time: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
        hasQuestionMark: false,
      };
    }

    let actualTime = String(timeStr || "00:00");
    const hasQuestionMark = actualTime.includes("_?");
    actualTime = actualTime.replace("_?", "");

    return { time: actualTime, hasQuestionMark };
  }

  /**
   * 將 Date 物件格式化為 "YYYY-MM-DD" 字串。
   * 主要用於 Supabase 的日期查詢條件。
   * @param {Date} date - 要格式化的日期物件
   * @returns {string} - "YYYY-MM-DD" 格式的日期字串
   */
  formatDateToYYYYMMDD(date) {
    const year  = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day   = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

// ============================================================
// 任務邏輯工具類別
// ============================================================

/**
 * 負責任務資料判斷與列表處理的工具類別。
 */
export class TaskUtils {
  constructor() {}

  /**
   * 判斷一個任務項目是否為「例行維護中」的維護任務。
   * 維護任務在 UI 上有特殊的呈現方式（灰色、合併顯示）。
   * @param {object} item - 任務項目物件
   * @returns {boolean} - 若為維護任務則回傳 true
   */
  isMaintenanceTask(item) {
    if (!item) return false;
    return MAINTENANCE_PATTERN.test(this.getTaskContent(item));
  }

  /**
   * 取得任務項目的內容文字。
   * 封裝欄位存取，方便未來變更資料結構時集中修改。
   * @param {object} item - 任務項目物件
   * @returns {string} - 任務內容文字
   */
  getTaskContent(item) {
    return item.content;
  }

  /**
   * 合併列表中連續且內容相同的維護任務。
   * 例如：3 個連續的「例行維護中」會合併為一筆，
   * 並附上 maintenanceSpanStart / maintenanceSpanEnd 屬性記錄時間範圍。
   * @param {Array<object>} list - 原始任務列表
   * @returns {Array<object>} - 合併維護任務後的列表
   */
  mergeConsecutiveMaintenance(list) {
    const merged   = [];
    let skipUntil  = -1;

    list.forEach((item, index) => {
      if (index < skipUntil) return;

      const content       = this.getTaskContent(item);
      const isMaintenance = MAINTENANCE_PATTERN.test(content);

      if (isMaintenance) {
        // 向後找出連續相同維護項目的最末索引
        let lastIndex = index;
        for (let i = index + 1; i < list.length; i++) {
          if (this.getTaskContent(list[i]) === content) {
            lastIndex = i;
          } else {
            break;
          }
        }

        merged.push({
          ...item,
          maintenanceSpanStart: parseInt(item.time.split(":")[0], 10),
          maintenanceSpanEnd:   parseInt(list[lastIndex].time.split(":")[0], 10),
        });
        skipUntil = lastIndex + 1;
      } else {
        merged.push(item);
      }
    });

    return merged;
  }
}

// ============================================================
// DOM 操作輔助類別
// ============================================================

/**
 * 提供簡化 DOM 操作的靜態方法工具類別。
 */
export class DOMHelper {
  /**
   * 更新指定 ID 元素的 innerHTML 與 display 樣式。
   * 若元素不存在則靜默跳過，避免錯誤中斷程式。
   * @param {string} id       - 目標元素的 ID
   * @param {string} [content]  - 要設置的 innerHTML（省略時不修改內容）
   * @param {string|null} [display] - 要設置的 display 樣式；null 表示不修改
   */
  static updateElement(id, content, display = null) {
    const el = document.getElementById(id);
    if (!el) return;
    if (content !== undefined) el.innerHTML = content;
    if (display !== null)      el.style.display = display;
  }

  /**
   * 建立並回傳一個新的 DOM 元素。
   * @param {string} tag       - HTML 標籤名（如 "div", "span", "button"）
   * @param {string} [className] - 要附加的 CSS class 字串
   * @param {string} [innerHTML] - 元素的初始內部 HTML
   * @returns {HTMLElement} - 建立的元素
   */
  static createElement(tag, className = "", innerHTML = "") {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML) el.innerHTML = innerHTML;
    return el;
  }

  /**
   * 清空指定 ID 元素的所有子內容。
   * @param {string} id - 目標元素的 ID
   */
  static clearElement(id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  }
}

// ============================================================
// localStorage 存取輔助類別
// ============================================================

/**
 * 封裝 localStorage 的讀寫操作，並自動處理 JSON 序列化。
 * 所有操作均有 try-catch 保護，避免隱私模式或儲存空間不足時崩潰。
 */
export class StorageHelper {
  /**
   * 從 localStorage 讀取指定鍵的值，並自動 JSON.parse。
   * @param {string} key            - 儲存鍵名
   * @param {*}      [defaultValue=null] - 鍵不存在或解析失敗時的預設值
   * @returns {*} - 反序列化後的儲存值，或預設值
   */
  static get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  /**
   * 將值 JSON.stringify 後存入 localStorage。
   * @param {string} key   - 儲存鍵名
   * @param {*}      value - 要儲存的值（將自動序列化）
   */
  static set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("[StorageHelper] localStorage 寫入失敗：", e);
    }
  }

  /**
   * 從 localStorage 移除指定鍵。
   * @param {string} key - 要移除的鍵名
   */
  static remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn("[StorageHelper] localStorage 移除失敗：", e);
    }
  }
}

// ============================================================
// Cookie 存取輔助類別
// ============================================================

/**
 * 提供簡易的 Cookie 讀寫工具，用於跨瀏覽器 session 的使用者識別。
 */
export class CookieHelper {
  /**
   * 讀取指定名稱的 Cookie 值。
   * @param {string} name - Cookie 名稱
   * @returns {string|null} - Cookie 的值；不存在時回傳 null
   */
  static get(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  /**
   * 設定一個持久性 Cookie（預設有效期為 365 天）。
   * @param {string} name  - Cookie 名稱
   * @param {string} value - Cookie 值
   * @param {number} [days=365] - 有效天數
   */
  static set(name, value, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  }

  /**
   * 透過將過期日設為過去來刪除指定 Cookie。
   * @param {string} name - 要刪除的 Cookie 名稱
   */
  static remove(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  }
}

// ============================================================
// Supabase 客戶端單例工具類別
// ============================================================

/**
 * 管理 Supabase 客戶端的初始化與單例存取。
 * 確保整個應用程式中只建立一個 Supabase 客戶端實例，避免重複連線。
 */
export class SupabaseHelper {
  static _client = null; // 單例快取

  /**
   * 取得已初始化的 Supabase 客戶端。
   * 若尚未初始化，會先從 CDN 動態載入 SDK 再建立客戶端。
   * 後續呼叫直接回傳快取的實例（不重複建立）。
   * @returns {Promise<import('@supabase/supabase-js').SupabaseClient>} - Supabase 客戶端實例
   */
  static async getClient() {
    if (this._client) return this._client;

    // 若 SDK 尚未載入，動態插入 script 標籤並等待其完成
    if (!window.supabase) {
      await new Promise((resolve, reject) => {
        const script  = document.createElement("script");
        script.src    = CONFIG.SUPABASE_CDN;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Supabase SDK 載入失敗"));
        document.head.appendChild(script);
      });
    }

    this._client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
    return this._client;
  }
}

// ============================================================
// 遠端設定快取
// ============================================================

/**
 * 從 Supabase 取得 event_config（活動期間）與 mvp_config（MVP 排行）。
 * 結果快取於 _cache，透過 refresh() 清除快取以重新取得最新資料。
 */
export class RemoteConfig {
  static _cache = null;

  static async refresh() {
    const supabase = await SupabaseHelper.getClient();
    const [{ data: eventData }, { data: mvpData }] = await Promise.all([
      supabase.from("event_config").select("start, end").eq("id", 1).single(),
      supabase.from("mvp_config").select("first, second").eq("id", 1).single(),
    ]);
    this._cache = {
      dateRanges: {
        start: new Date(eventData.start),
        end:   new Date(eventData.end),
      },
      mvpConfig: {
        first:  mvpData?.first  ?? "",
        second: mvpData?.second ?? "",
      },
    };
    return this._cache;
  }

  static getDateRanges() {
    return this._cache?.dateRanges ?? null;
  }

  static getMvpConfig() {
    return this._cache?.mvpConfig ?? { first: "", second: "" };
  }
}
