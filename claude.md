# Claude Code プロジェクトガイド

## プロジェクト概要
Cloudflare Workerで公開鍵認証を使った認証システム。
事前に登録されたクライアントのみがSecretデータにアクセスできる。

## ソースコード構成ルール

### ディレクトリ構造
- すべてのソースコードは `src/` フォルダ配下に配置する
- すべてのテストコードは `test/` フォルダ配下に配置する
- TypeScriptファイルは機能ごとにモジュール化する

```
src/
├── index.ts          # Workerエントリーポイント
├── types.ts          # 型定義
├── auth.ts           # 認証ロジック（署名検証）
├── challenge.ts      # チャレンジ管理
└── utils.ts          # ユーティリティ関数

test/
├── auth.test.ts      # 認証ロジックのテスト
├── challenge.test.ts # チャレンジ管理のテスト
└── integration.test.ts # 統合テスト
```

### コーディング規約
- TypeScriptの厳格モードを使用
- 環境変数の型定義は `wrangler types` で自動生成
- エラーハンドリングを適切に実装

### 型定義の生成
```bash
# wrangler.toml の設定から型定義を自動生成　追記変更はしない
npx wrangler types
```

## 技術仕様

### 認証・セキュリティ
- **チャレンジ保存**: Durable Objects を使用（スケーラブルな状態管理）
- **トークン形式**: JWT（JSON Web Token）
- **エラーレスポンス**: セキュリティのため抽象的なメッセージ（例: "Authentication failed"）
- **ログ**: 詳細なエラー情報はサーバーログに記録

### 暗号化
- **公開鍵暗号**: RSA 2048ビット以上
- **署名方式**: RSASSA-PKCS1-v1_5
- **ハッシュ**: SHA-256
- **実装**: Cloudflare Worker の Web Crypto API を使用

### テスト方針
- 単体テストのみ実装
- テストフレームワーク: Vitest 推奨

## 参照ドキュメント
詳細な仕様は [SPEC.md](SPEC.md) を参照
