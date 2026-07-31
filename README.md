# Automation Toolbox

一組可獨立安裝、解決重複操作的小型自動化工具。

## 工具

| 工具 | 類型 | 功能 | 狀態 |
| --- | --- | --- | --- |
| [停車繳費車牌自動填入](userscripts/parking-payment-plate-autofill/) | Userscript | 在支援的停車繳費網站共用、記憶並填入車牌 | Stable |
| [Netflix 雙字幕](userscripts/netflix-dual-subs/) | Userscript | 同時顯示 Netflix 提供的兩條字幕軌，不翻譯或呼叫第三方服務 | Stable |

## 收錄原則

- 工具必須能獨立安裝並有清楚的使用說明。
- 不提交 access token、Cookie、帳密、個人資料或封包紀錄。
- Userscript 應說明執行網站、權限及本機儲存內容。
- Surge 工具完成後會以可安裝的 `.sgmodule` 發布，JavaScript 放在同一工具目錄。
- 未完成或仍含私人設定的草稿不會進入公開 Git 歷史。

## 開發與驗證

本專案的測試只使用 Node.js 內建功能，不需要安裝依賴：

```sh
npm test
npm run check
```

## 授權

[MIT](LICENSE)
