# Netflix 雙字幕

同時顯示 Netflix 提供的兩條字幕軌；不翻譯、不呼叫第三方服務、不使用 AI。

[安裝／下載 Userscript](https://raw.githubusercontent.com/kinjih/automation-toolbox/main/userscripts/netflix-dual-subs/netflix-dual-subs.user.js)

建議一般 Safari 使用者採用免費、開源的
[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)。
已經使用 AdGuard for Mac 的人也可以直接安裝同一個 `.user.js` 檔案。

> 請只選一個 userscript 管理器啟用本腳本，不要同時在 Userscripts 與
> AdGuard 啟用。

## 方法一：Userscripts（推薦分享方式）

1. 從 App Store 安裝 **Userscripts**。
2. 到 Safari 的「設定 → 延伸功能」啟用 Userscripts。
3. 授予 Userscripts 存取 `netflix.com` 的權限。
4. 在 Userscripts 中加入 `netflix-dual-subs.user.js`：
   - 開啟 Userscripts 的管理頁，按 `＋` 後匯入檔案；或
   - 把檔案放入 Userscripts 的 scripts 目錄。
5. 重新整理 Netflix 播放頁。

本腳本使用 `document-start` 與頁面環境，才能在 Netflix 送出播放
manifest 要求前加入文字字幕格式。

## 方法二：AdGuard for Mac

1. 開啟 **AdGuard for Mac**。
2. 進入「設定 → 擴充功能（Extensions）」。
3. 按 `＋`，選擇從檔案或 URL 匯入。
4. 選取 `netflix-dual-subs.user.js` 並啟用。
5. 確認 AdGuard 對 Safari／`netflix.com` 的保護已開啟。
6. 重新整理 Netflix 播放頁。

## 使用

- 播放 Netflix 後，右上角會出現 `CC²`。
- 開啟「統一顯示雙字幕」後：
  - 主字幕由腳本顯示在上方。
  - 第二字幕由腳本顯示在下方，字體稍小。
  - Netflix 原生字幕只會在兩條字幕都成功載入後隱藏。
- 「穩定整句」會合併被切成前後半段的短句，讓兩種語言共用開始與
  結束時間；其中一條較早結束時也不會先消失。無法可靠配對的單邊短句
  不會獨自閃現，因此版面不會在句尾只剩一行或上下跳動。
- 若想完全保留兩份字幕各自的時間碼，可改選「Netflix 提供的原始時間」。
- 可以分別選擇主字幕與第二字幕，並調整整體大小、距離底部與時間延遲。
- 展開「字幕風格」可以調整字型、字重、兩條字幕各自的顏色、第二字幕
  比例、背景深度、描邊、行距與雙字幕間距；「恢復預設字幕外觀」只會
  重設外觀，不會改變語言或時間軸設定。
- 預設外觀為距離底部 6%、中等字重、無背景；底部距離可在 2–42% 間調整。
- `Option/Alt + D`：開關雙字幕接管。
- `Option/Alt + S`：開關設定面板。

## 安全回退

若任一字幕軌下載或解析失敗，腳本不會隱藏 Netflix 原生字幕。關閉雙字幕
接管時，也會立刻恢復 Netflix 原生字幕。

## 隱私與限制

- 腳本只讀取 Netflix 當集播放 manifest 中已提供的字幕。
- 不使用 AI、不呼叫翻譯服務，也不把字幕或觀看資料送往第三方。
- 設定只存在 `netflix.com` 的瀏覽器本機儲存空間。
- 腳本無法取得 Netflix 未對目前影片、帳號、地區或 Profile 提供的語言。
- 支援 WebVTT／TTML 文字字幕；純圖片字幕軌會略過。
- 自訂渲染會保留字幕文字與時間，但不保證完整重現 Netflix 的特殊位置、
  顏色或進階排版。
- Netflix 播放器屬於未公開介面，Netflix 改版後可能需要更新腳本。

## 故障排除

- **沒有出現 `CC²`：**確認腳本及網站權限已啟用，再完整重新整理播放頁。
- **顯示等待字幕資料：**切換一次 Netflix 原生字幕，再重新整理播放頁。
- **接管失敗：**Netflix 原生字幕應仍然可見；可換一條文字字幕軌重試。
- **找不到語言：**先在 Netflix Profile 語言設定加入該語言。
- **兩條字幕分句不一致：**這是兩套字幕的時間碼差異，可用字幕延遲微調。
- **需要診斷資訊：**在 Safari Web Inspector 的 Console 執行：

  ```js
  NetflixDualSubs.status()
  ```

## 升級相容性

從舊版升級時，腳本會自動讀取並遷移
`netflix-official-dual-subs:*` 中的既有設定。
