# YAMAHA LIFE 每日簽到

這個 Surge 模組每天 00:05 呼叫台灣山葉機車 YAMAHA LIFE App 的官方 API，先執行會員簽到，再查詢目前點數，等兩個請求都完成後以一則本機通知合併顯示結果。

## 適用範圍

- App：台灣 YAMAHA LIFE（通知可開啟 `ymtrevsapp://`）
- API 主機：`app.yamaha-motor.com.tw`
- 簽到：`POST /api/fans/Signin`
- 點數：`POST /api/Fans/PointList`

兩個請求都只傳送 JSON：`{"access_token":"你的會員編號"}`。這裡的 API 欄位名稱雖然是 `access_token`，原工具實際填入的是會員編號。模組不攔截、修改或保存 Yamaha App 的 request／response。

## 安裝

[在 Surge 安裝模組](surge:///install-module?url=https%3A%2F%2Fraw.githubusercontent.com%2Fkinjih%2Fautomation-toolbox%2Fmain%2FSurge%2Fyamaha-life-daily-sign-in%2Fyamaha-life-daily-sign-in.sgmodule)

也可以在 Surge 的模組頁面加入以下網址：

```text
https://raw.githubusercontent.com/kinjih/automation-toolbox/main/Surge/yamaha-life-daily-sign-in/yamaha-life-daily-sign-in.sgmodule
```

安裝時請設定：

- `會員編號`：請將預設的「請填入會員編號」完整替換成自己的會員編號。會員編號可在 YAMAHA LIFE App 的「Ya 粉資訊 > 個人資料 > 會員編號」找到；repo 不提供會員編號，也不會從 App 流量自動擷取。

模組使用 cron `5 0 * * *`，依裝置當地時間於每天 00:05 執行。也可以在 Surge 的腳本列表手動執行。

## MITM 與流量

不需要 MITM，也不需要安裝 Surge CA。模組只有一條 `type=cron` 的 `[Script]` 設定；腳本透過 Surge `$httpClient` 直接連線到上述兩個精確 HTTPS URL，所以沒有 hostname、URL regex、rewrite、`requires-body`、`max-size` 或 `binary-body-mode` 設定。

## 隱私與安全

- 會員編號是個人資料，請勿貼到 issue、日誌、截圖或提交到 Git。
- 會員編號只由 Surge 的模組參數提供給腳本，不會寫入 `$persistentStore`，也不會輸出會員編號或原始 response body。
- 會員編號會以 `access_token` 欄位送往 `app.yamaha-motor.com.tw` 的兩個 API；GitHub Raw 只用來下載模組與 JavaScript，不會收到會員編號。
- 合併通知會顯示簽到狀態、點數餘額及 Yamaha API 提供的狀態文字，請留意鎖定畫面的通知預覽設定。

## 已知限制

- 使用者必須自行在 YAMAHA LIFE App 內找到有效的會員編號；本工具不提供擷取方法。
- 會員編號無效、帳號狀態、API 改版或 Yamaha 服務異常都可能導致失敗。
- Surge 必須在 00:05 運作並允許腳本執行；錯過排程時當天不會自動補跑。
- 此工具只重現原始草稿的簽到與點數查詢，不會操作交易、兌換、預約或其他會員功能。
- 測試只使用假的會員編號與模擬回應，不會連線 Yamaha 或操作真實帳號。

## 停用與移除

在 Surge 的模組頁面關閉此模組即可暫停排程；向左滑動或使用模組管理選單刪除它即可完整移除。刪除模組後，會員編號也會從這個模組的參數設定中移除；這不會刪除 Yamaha 帳號或 App 內的會員資料。
