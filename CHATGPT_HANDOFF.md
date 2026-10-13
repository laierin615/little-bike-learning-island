# ChatGPT 專案交接：小小單車學習島

## 交接目標
請在此專案上接續開發，不要從零重做。使用者希望持續優化一款適合幼兒園大班的繁體中文 3D 數字、注音與簡單漢字學習遊戲。

## 目前版本
- Manus 來源版本：`01f6bcf42d1a9615238de5a28711d08d9696bec2`（2026-10-13）。
- GitHub repository：`laierin615/little-bike-learning-island`（private）。
- 技術：Three.js、TypeScript、Vite；套件管理器 pnpm。
- 24 關分四段：數字果園、注音森林、國字小鎮、綜合山道；使用單車路線節點逐關解鎖，星數與完成進度保存在瀏覽器。
- 五種玩法：連連看、翻牌記憶配對、泡泡靶場、局部消除／落下補位的三消、終點接力；另保留三項自由練習。
- 3D 場景保留小島、單車環道、騎士主角及不同學習路標；每關都有繁體中文挑戰描述。
- Web Audio 即時合成配樂和遊戲音效；總音訊可關閉。Web Speech API 指定繁體中文 `zh-TW`，提供導讀、重聽與文字後援（實際音色依裝置）。
- 兒童體驗：無倒數、不扣分、可重試且不因答錯鎖關；騎士 PNG 與 favicon 隨 repo 提供，不含原始上傳照片。

## 本機執行與檢查
1. `pnpm install --frozen-lockfile`
2. `pnpm dev -- --host 0.0.0.0`
3. `pnpm typecheck`
4. `pnpm test`（目前 50 個測試）
5. `pnpm build`
6. `pnpm smoke`（24 關地圖、五種玩法、進度、音訊和手機操作）

GitHub 專案已含建置必要圖檔；在一般 ChatGPT／Claude 開發環境中可直接使用上述命令。`pnpm build` 保留 Manus 資產還原／分享包裝流程；若無法使用該流程，`pnpm manus:build-source` 可單獨做 TypeScript、Vite build 與大小檢查。若要回到 Manus，請保留現有 build 工作流程與 asset registry。

## 專案範圍與安全界線
- 保留 Three.js 3D 遊戲、繁體中文、24 關五種玩法、自由練習、騎士主角、兒童友善重試方式及本機進度。
- 避免將專案改成多人連線、登入或雲端個資服務；若確有需要，先詢問使用者。
- 不要永久發布、公開程式碼或替使用者建立外部儲存庫，除非使用者明確要求。
- 若需要改變題目教學方式、語音預設、視覺主角或學習年齡層等核心決策，先與使用者確認。
- 專案包不含 `.git`、`.env`、Manus 專案識別檔、`node_modules` 或 `dist`。

## 可貼給 ChatGPT 的續作提示
> 請接手這個現有的「小小單車學習島」專案。先閱讀 `README.md`、`TODO.md`、本交接文件及相關程式碼，確認 24 關戰役、五種玩法、音樂／音效與自由練習，再依我的下一個要求修改。請維持 Three.js、TypeScript、繁體中文、幼兒園大班友善的可重試玩法和單車主題。先跑測試驗證，不要未經我同意就公開 repository、正式發布或新增登入／多人／雲端個資功能。
