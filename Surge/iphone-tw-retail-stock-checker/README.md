# iPhone 台灣直營店庫存檢查

這個 Surge 模組會在指定的開賣時間後，每分鐘查詢 Apple 台灣直營店的店內取貨庫存；台灣時間 08:00–21:59 之間只要任一指定門市出現可取貨庫存，就會發送本機通知。

## 安裝

[在 Surge 安裝模組](surge:///install-module?url=https%3A%2F%2Fraw.githubusercontent.com%2Fkinjih%2Fautomation-toolbox%2Fmain%2FSurge%2Fiphone-tw-retail-stock-checker%2Fiphone-tw-retail-stock-checker.sgmodule)

也可以在 Surge 的模組頁面加入：

```text
https://raw.githubusercontent.com/kinjih/automation-toolbox/main/Surge/iphone-tw-retail-stock-checker/iphone-tw-retail-stock-checker.sgmodule
```

安裝時設定三個參數：

- `機型代號`：可直接填 Apple 零件編號（例如 `MG8G4ZP/A`），也可貼上 Apple 台灣官網中已選定尺寸、容量與顏色的完整產品頁網址。若使用網址，腳本會向該 Apple 頁面讀取 `defaultOnloadPart`／SKU，辨識後快取零件編號，不會每分鐘重抓產品頁。網址必須位於 `https://www.apple.com/tw/shop/buy-iphone/`。
- `門市代號`：預設 `R713|R694`，分別是台北 101 與信義 A13。只查一間時可刪掉另一個；多間以 `|` 分隔。
- `開賣時間`：直接使用台灣時間 `YYYY-MM-DD HH:mm`，例如 `2026-09-18 08:00`。腳本也相容 10 位 Unix 秒、13 位 Unix 毫秒與含時區的 ISO 8601；若商品早已開賣，可填 `立即`。

### 怎麼取得機型代號

最省事的方式是不查代號：在 [Apple 台灣 iPhone 選購頁](https://www.apple.com/tw/shop/buy-iphone) 選完機型、尺寸、容量與顏色後，複製完整網址貼到 `機型代號` 參數，腳本會自行辨識。

若要手動確認零件編號，可在電腦瀏覽器開啟同一個完整產品頁，檢視網頁原始碼並搜尋 `defaultOnloadPart`；它旁邊的值就是這支腳本需要的 SKU。請勿拿 `Axxxx` 硬體型號或 `iPhone18,1` 裝置識別碼代替。Apple 的台灣 SKU 後綴可能隨產品改變，不應假設一定是 `TA/A`。

### 怎麼決定開賣時間

以 Apple 台灣產品頁或 Apple Newsroom 公布的台灣預購／開賣時刻為準，直接填台灣時間，不用自行換算 epoch。若公告只有日期而沒有時刻，先不要猜；等 Apple 顯示可訂購的確切時間再更新參數，或在確定已開放後填 `立即` 或 `Now`。

## 行為與限制

- 模組每分鐘執行，但開賣前及台灣時間 08:00–21:59 以外不會連線查庫存。
- 庫存查詢使用 Apple 台灣官網的 `https://www.apple.com/tw/shop/retail/pickup-message`，不需要 MITM 或安裝 Surge CA。
- 有貨時每次排程都會通知，直到庫存再次變成無法取貨或停用模組；這保留原工具偏向搶購提醒的行為。
- Apple 可隨時修改未公開保證的商店回應格式；若 API 或產品頁結構改變，模組可能需要更新。
- 商品名稱、庫存文字與產品頁內容只從 Apple 讀取。腳本不登入 Apple 帳號、不下單，也不會操作購物袋。

## Reference

本工具沿用 Black Magic Lab 的 [`iphone_check_store.sgmodule`](https://github.com/Black-Magic-Lab/Surge/blob/master/modules/iphone_check_store.sgmodule) 所採用的「每分鐘執行庫存檢查腳本」設計為改寫起點。由於舊腳本使用的 `mobileapp.apple.com` App 端點與固定 App headers 已不再適用，這一版改用目前 Apple 台灣官網的店內取貨查詢端點，並加入模組參數、輸入驗證、產品網址解析與正確的非同步 `$done()` 時機。
