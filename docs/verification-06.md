# Bot 06 Flex Message 驗證紀錄

日期：2026-10-30（Asia/Taipei）。部署來源：`66037c4509b3c1309a972b30d4287b6da5bc09d1`。

## 範圍

本版把 Google ADK `cinema_schedule`／`cinema_compare` 的成功結果改成 LINE Flex carousel，每頁五部電影，含介紹、版本、時間與分頁按鈕。多版本保留在同一作品卡片內，不混合時間；無資料或無法解析時仍回覆現況及來源。一般全台推薦與附近影院的彙整沿用既有格式。

原有四格 Rich Menu、Published MINI App、私人票匣 API 與草稿確認保留，不增加資料庫欄位。

## 自動測試與版面檢查

- [部署版本 GitHub CI](https://github.com/zonawang/movie-companion-bot-06-flex-message/actions/runs/41079363673)：test、browser 均成功，109 項 Node 測試全部通過。
- 瀏覽器測試包含既有票匣登入及操作，另測五張卡片／第二頁、介紹、完整場次與返回、手機頁面無橫向溢出，以及主按鈕文字可讀。
- 已下載檢查手機、桌面預覽截圖。預覽使用虛構電影及實際 Flex JSON 的 HTML 版面，不是 LINE 官方渲染器。公開的 [手機版面預覽](images/flex-mobile-preview.png) 有標示示範資料。
- 其他測試涵蓋 actor 綁定、過期、錯誤索引、重送事件、來源 URL、同名作品歧義、TMDB 暫時失敗、快取、訊息大小、卡片與票根確認並存，以及呈現失敗時保留真正場次的文字回覆。

## 真實 Gemini / ADK / 資料與 LINE 格式

在切換前的獨立 release 執行 `examples/flex-adk-smoke.mjs`，使用真正的 `gemini-3.5-flash-lite`、ADK Runner、誠品公開時刻表與 TMDB；票根資料庫為隔離的記憶體資料庫。

- 「誠品現在有哪些電影好看？」確實呼叫 `cinema_schedule`；未使用 `now_playing` 或 `recommend_movies` 的全台候選替代影城片單。最終版本取得文字說明與 Flex 回覆，LINE 格式驗證為 200。
- 明確指定公告日期及完整片單時取得三張真實電影卡片；電影介紹與完整場次皆通過 LINE `validate/reply`。
- 同一查詢的虛構多頁 fixture 另驗證首／次頁 Flex JSON；不將它當成真實影城片單。
- 確認測試 actor 沒有新增票根或待確認草稿；沒有向使用者推播或送出測試訊息。

查詢時間較晚時，依模型產生的時間條件及來源公告，可能沒有剩餘場次；此時以實際工具狀態說明，不補造電影。以上是指定案例的驗證，未宣稱所有自然語言問法都會產生相同工具順序。

## 正式服務與資料保存

- Google Compute Engine 原主機來源更新為 Bot 06；systemd `movie-bot` 為 active，release symlink 指向上述部署版本。
- 公開 `/health` 與 `/tickets/` 為 200，`X-Movie-Bot-Version: 06`；簽章空事件 Webhook 為 200。
- Published LIFF ID 仍是 `2012222034-AVyO2nk3`；未登入讀取私人票匣 API 回傳 401。
- LINE Bot 仍為 Zona Movie `@796qcwyz`，Rich Menu 預設仍是 `richmenu-84a49e99500597707f98168075c09c7f`。這次沒有替換圖稿或個別使用者綁定。
- 更新前建立 `/var/lib/movie-bot/pre-flex-20261030.sqlite`；更新後兩筆正式票根的 ID、擁有者、完整內容與建立時間雜湊一致，SQLite `quick_check=ok`。

新版 Flex 已在 LINE API 驗證完成並啟用後端。真人手機上的字體、海報、滑動及按鈕操作，仍待使用者實際確認。
