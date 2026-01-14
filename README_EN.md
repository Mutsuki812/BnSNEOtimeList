# Blade & Soul NEO Timer Tool
## **🇺🇸 English Version**
Designed to organize and display
Field Boss and Ritual system notification times for Blade & Soul NEO.<br>

It supports automatic language and timezone switching for Taiwan / Japan servers,<br>
and includes a player reporting system that allows the community to refine and correct timing data collaboratively.

### 🔗 Demo
Taiwan Server: https://bit.ly/BnSNEOtimeList<br>
Japan Server: https://x.gd/rkSjt　`2026/03/11 Service Termination`

## ✨ Features
### 🌏 言語・タイムゾーン自動判定
- Automatic Language & Timezone Detection
- Automatically switches based on the user’s system timezone:
  - UTC+8 → Chinese (Taiwan Server)
  - UTC+9 → Japanese (Japan Server)
- Manual language switching is also supported (settings are stored in the browser)

### ⏰ Real-Time Server Clock
- Displays Taiwan and Japan server times
- Updates every second
- Shows full date and weekday information

### 📊 Task Timetable (Excel-Driven)
- All data is sourced from timeList.xlsx
- Automatically displays by weekday:
  - Tasks from the previous hour (Japan server only)
  - Current tasks
  - Upcoming 2 hours
  - Other time slots (expandable / collapsible)
- Supported features:
  - Excel time formats
  - Uncertain time markers [?]
  - Cross-day display (after midnight)

### 🔧 Maintenance Period Handling
- Automatically detects the following as maintenance:
  - 例行維護中
  - 定期メンテナンス中
- Consecutive maintenance periods are merged automatically
- Upcoming tasks can still be previewed during maintenance

### 🎯 Boss Spawn Time Reference
- Displayed times represent the system message timestamp
- Estimated actual spawn times:
  - Rituals: approximately +3 minutes
  - Moonwater / White Blue field bosses: approximately +5 minutes
- Past events are automatically greyed out

### 📝 Player Reporting System (LocalStorage)
- Players can submit:
  - Task type
  - Report category (time / other)
  - Free notes (time, location, etc.)
- All data is stored locally in the user’s browser (no backend)

### 📁 Project Structure
>/<br>
>├─ index.html<br>
>├─ main.js<br>
>├─ style.css<br>
>├─ files/<br>
>│  └─ timeList.xlsx<br>
>└─ images/

### 📄 Excel Format Specification
**Sheet Names**
- Chinese: timeList_ZH
- Japanese: timeList_JP

**Column Definitions**
| Column | Description |
| :-- | :-- |
| Week-zh | Day of the week (Sun, Mon, Tue…) |
| gishiki-time / zh / jp | Ritual |
| mizuki-time / zh / jp | Moonwater Field Boss  `（2026/01/21 Field Boss Removed）` |
| shirao-time / zh / jp | White Blue Field Boss |

**Notes**
- Time can be specified as HH:MM or Excel time format
- Uncertain times can be marked with \_? (e.g. 19:30_?)

### 🤝 Data Source & Contribution
#### 📌 Data Source
- The timing data used in this tool is primarily compiled from player discussions on [**巴哈姆特劍靈Blade&Soul討論區**](https://forum.gamer.com.tw/C.php?bsn=12980&snA=79447)
- All data is based on player observations and shared experiences, and is not official information

#### 🙏 Acknowledgements
- Special thanks to [**不起眼的路人**](https://home.gamer.com.tw/profile/index.php?&owner=nobody9999) for providing detailed time and location compilations
- Thanks to all Bahamut community members who shared their findings and made this tool possible

If you notice any inaccuracies or have more precise data, please use the in-page reporting feature to help improve the information.

### ⚠️ Disclaimer
- This is an unofficial tool
- Not affiliated with NCSOFT
- All game names and content are the property of their respective owners
- Times are for reference only; please rely on actual in-game behavior