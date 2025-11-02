# Deploy Command

このコマンドは以下を自動実行します：
1. 変更をコミット（日本語のコミットメッセージ）
2. GitHubにプッシュ
3. Cloudflare Workerにデプロイ

## 実行手順

1. `git status` と `git diff` で変更内容を確認
2. すべての変更をステージング（`git add .`）
3. 変更内容を分析して適切な日本語のコミットメッセージを生成
4. コミット実行（Co-Authored-By付き）
5. リモートにプッシュ（`git push`）
6. Cloudflare Workerにデプロイ（`npx wrangler deploy`）

## 注意事項

- コミットメッセージは変更内容に基づいて自動生成します
- "feat:", "fix:", "refactor:" などのプレフィックスを適切に使用します
- すべての手順が成功するまで自動的に実行します
