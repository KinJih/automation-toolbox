# 停車繳費車牌自動填入

在支援的停車繳費網站顯示一個「車牌」浮動按鈕，讓同一組車牌可以被記憶、自動填入或暫時停用。

## 支援網站

- Intella 停車繳費頁面
- UTagGo 停車繳費頁面
- 嘟嘟房線上繳費頁面

網站介面若有調整，欄位辨識或提醒視窗操作可能需要同步更新。

## 安裝

先安裝支援 Userscript 的瀏覽器擴充功能，再開啟：

[安裝 Userscript](https://raw.githubusercontent.com/kinjih/automation-toolbox/main/userscripts/parking-payment-plate-autofill/parking-payment-plate-autofill.user.js)

本地開發期間也可以直接匯入 [parking-payment-plate-autofill.user.js](parking-payment-plate-autofill.user.js)。

## 使用方式

1. 開啟支援的停車繳費網站。
2. 點擊左下角「車牌」。
3. 輸入車牌並選擇「儲存填入」。
4. 之後進入其他支援網站時會使用同一組車牌。

面板也可以記錄頁面目前的車牌、清除記憶，或暫時關閉自動填入。

## 儲存與隱私

腳本只在本機儲存：

- 車牌號碼
- 自動填入開關
- 支援網站使用的車種偏好

優先使用 Userscript 管理器提供的 GM storage，資料不會由本腳本傳送到作者或其他服務。若管理器不支援 GM storage，腳本會退回使用網站的 `localStorage`；此時資料依網域分開，無法跨網站共用。

## 權限

- `GM_getValue` / `GM.getValue`：讀取本機設定。
- `GM_setValue` / `GM.setValue`：儲存本機設定。
- `GM_deleteValue` / `GM.deleteValue`：清除本機設定。

腳本沒有跨網域連線權限。

## 新增網站

新增支援網站時，需要：

1. 在 metadata 增加精確的 `@match`。
2. 在 `SITE_ADAPTERS` 增加一個 adapter。
3. 為 adapter 指定網站判斷、車牌欄位及必要的提醒視窗規則。

儲存、介面及填入流程由共用核心處理，不需要新增各網站設定。
