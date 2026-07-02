# Blade & Soul NEO 時間表工具

## 🇹🇼 中文（繁體）

用於顯示《劍靈 NEO》野外 Boss 與儀式系統的提示時間、音效，並整合玩家即時回報功能。

---

## ✨ 功能特色

### ⏰ 即時伺服器時間顯示
- 以台灣時間（UTC+8）為基準
- 每秒更新，顯示完整日期與星期

### 📊 任務時間表
- 排程資料從 Supabase（`schedule_data` 資料表）即時讀取
- 依當前時間自動分類顯示：
  - 前一小時任務（條件顯示）
  - 當前任務
  - 接下來 2 小時
  - 其他時間（可展開 / 收合）
- 支援不確定時間標記 `[?]`
- 21 點後自動附加跨日隔天任務

### 🔧 維修時段處理
- 自動識別「例行維護中」為維修時段
- 連續維修時段自動合併顯示
- 維修中仍可預覽後續任務，並靜音所有音效

### 🎯 Boss 出現時間判定
顯示的是「系統出字時間」，實際 Boss 出現時間約為：
- 儀式：+3 分鐘（30 分鐘內無人擊殺則自動消失）
- 白青野王 / 仙幻島野王：+5 分鐘
- 超過出字時間後任務列會自動顯示為灰色

### 🔊 音效提示（可選）
- 世界王 21:00（平日）/ 15:00（週末）出現前 10 / 5 / 1 分鐘倒計時提示
- 野王系統出字（打雷）提示音（依類型播放不同音效）
- 仙幻島野王出現 10 秒前預告音（靜態班表模式）
- 音效開關 + 整體音量滑桿（Popup 面板）
- 瀏覽器首次互動後自動解鎖音訊

### 🌐 線上即時回報系統（賽季第一周或是野王重置時啟用）
- 活動期間由 Supabase Realtime + Web Worker 監聽資料庫異動，自動更新畫面
- 玩家可即時回報野王出現時間與地點
- 系統根據玩家回報自動推算下一次出現時間
- 歷史紀錄查閱（可查看並刪除自己的回報）
- 非活動期間自動切回靜態班表模式

### 👤 使用者系統
- 登入後可進行回報與留言
- 身份識別機制：`device_token`（Supabase 產生），同時儲存於 `localStorage` 與 Cookie，跨分頁持久有效
- 支援改名、登出
- 管理者角色（`admin`）可回覆留言，並享有特殊標識

### 📝 玩家留言與回報（永久區塊）
- 留言儲存於 Supabase `feedback_reports` 資料表（雲端持久）
- 可選擇回報類型：
  - 野王類型：數據提供 / 時間修正 / 地點修正
  - 其他：音效相關 / BUG回報 / 想說
- 管理者可回覆留言（顯示感謝圖示）
- MVP 玩家顯示特殊標識
- 僅本人可刪除自己的留言（附確認 Modal）

### 🌓 深色 / 淺色主題
- 一鍵切換，設定儲存於 `localStorage`
- 首次載入即還原上次設定，防止閃爍（FOUC）

---

## 🏗️ 架構說明

### 技術棧
- 純原生 ES Module（無打包工具）
- [Supabase](https://supabase.com/)：資料庫、即時通訊（Realtime）、使用者資料
- Web Worker：在背景執行 Supabase Realtime 監聽與精準分鐘計時
- Service Worker：PWA 支援
- Google Analytics（GA4）

### Supabase 資料表
| 資料表 | 說明 |
| :-- | :-- |
| `schedule_data` | 每週靜態野王 / 儀式時刻表 |
| `spawn_reports` | 玩家回報的即時出現紀錄（活動期間） |
| `feedback_reports` | 玩家留言與意見回報 |
| `Users` | 使用者資訊（帳號、角色、device_token） |
| `UserInfo` | 管理者密碼（僅管理者驗證時讀取） |
| `event_config` | 活動期間設定、公告文字、MVP 名單（RemoteConfig） |

### 模組結構
```
script/
├─ main.js               主控制器（TaskScheduleApp）
├─ config.js             全域設定、常數、靜態文字
├─ utils.js              TimeUtils / TaskUtils / DOMHelper / SupabaseHelper / RemoteConfig
├─ taskProcessor.js      ScheduleDataLoader / TaskDataProcessor
├─ uiRenderer.js         DOM 渲染邏輯
├─ reportManager.js      留言 / 回報區塊（feedback_reports）
├─ onlinePrediction.js   線上即時回報與預測（spawn_reports）
├─ userManager.js        使用者登入 / 登出 / 驗證
├─ soundManager.js       音效播放 / 開關 / 音量管理
├─ supplementalManager.js 補完計畫（開發中）
├─ theme-switch.js       深色 / 淺色主題切換
└─ worker.js             Web Worker（Realtime + 分鐘計時器）
```

### 完整專案結構
```
/
├─ audio/
│  ├─ boss1.mp3 / boss5.mp3 / boss10.mp3   世界王倒計時音效
│  ├─ gishiki.mp3                           儀式出字音效
│  ├─ sengen*.mp3                           仙幻島相關音效
│  ├─ shirao*.mp3                           白青野王相關音效
│  └─ soundON.mp3                           音效開啟提示
├─ images/
├─ script/                                  （見上方模組結構）
├─ style/
│  ├─ main.css
│  ├─ reset.css
│  ├─ utilities.css
│  ├─ modals.css
│  └─ report.css
├─ index.html
└─ service-worker.js
```

---

## 📄 schedule_data 格式說明

資料儲存於 Supabase，支援以下兩種格式：

**長表格**（每列含 `type` 與 `time` 欄位）

**寬表格**（每列含三個時間欄位）

| 欄位 | 說明 |
| :-- | :-- |
| `Week` | 星期（日、一、二 …） |
| `gishikiTime` | 可疑的儀式出字時間 |
| `shiraoTime` | 白青野王出字時間 |
| `sengenTime` | 仙幻島野王出字時間 |

**補充規則**
- 時間格式：`HH:MM`
- 不確定時間在時間後加入 `_?`（例：`19:30_?`）
- 維護時段填入「例行維護中」

---

## 🤝 資料來源與貢獻

### 📌 資料來源
- 本工具所使用之時間資料，主要整理自 [**巴哈姆特劍靈Blade&Soul討論區**](https://forum.gamer.com.tw/C.php?bsn=12980&snA=79447)
- 資料為玩家實測與經驗分享，非官方公告內容
- 感謝每一位熱心回報、提供修正的玩家

若資料有誤或有更精確的時間，歡迎透過網頁下方的回報功能協助補充與修正。

---

## ⚠️ 免責聲明
- 本專案為非官方工具
- 與 NCSOFT 無任何關聯
- 所有遊戲名稱與內容版權屬原廠所有
- 時間僅供參考，請以實際遊戲內狀況為準
