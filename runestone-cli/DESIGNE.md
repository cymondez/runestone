# Runestone npm Global CLI Tool

> 純 Node.js 實作的跨平台 CLI 工具，直接呼叫 Docker CLI（**不依賴 Make**），完整實現 Runestone 所有功能。

專案資源預設位置： `~/.runestone` (docker compose 的 project-directory 位置)
.env, compose.yaml 都會在此目錄下建立。

## 一、專案定位

| 項目         | 說明                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| **名稱**     | `@developers-homelab/runestone-cli`                                     |
| **類型**     | npm Global CLI Tool                                                     |
| **語言**     | TypeScript → JavaScript (CommonJS)                                      |
| **核心策略** | **獨立實作**：所有邏輯由 Node.js 直接呼叫 Docker CLI，完全繞過 Makefile |

---

## 二、技術棧

| 層級                   | 套件                                   | 用途                                                 |
| ---------------------- | -------------------------------------- | ---------------------------------------------------- |
| **Setup 安裝引道精靈** | `@clack/prompts`                       | 提供初次執行up 時呼叫初始設定環境變數與之後的env修感 |
| **CLI 框架**           | `commander` (v12)                      | 命令路由、參數解析、子命令支援                       |
| **程式碼執行**         | `child_process.execSync` / `spawnSync` | 直接呼叫 Docker CLI                                  |
| **互動式輸入**         | `enquirer` (v2.4)                      | First-time setup 的提問流程                          |
| **環境變數**           | `dotenv` (v16)                         | 載入 `.env` 檔                                       |
| **日誌輸出**           | `kleur` (v4)                           | Terminal 顏色、Spinner                               |
| **路徑處理**           | Node.js `path` / `os` 內建模組         | 跨平台路徑、Home 目錄偵測                            |
| **JSON 解析**          | `--format json` + `JSON.parse()`       | Docker CLI JSON 輸出                                 |
| **TypeScript**         | `tsc` + `tsconfig.json`                | 開發期型別安全，Compile 後發佈 JS                    |
| **本地自簽憑證**       | `@mkcert/node`                         | 產生/安裝本地自簽憑證                                |

### Node.js 版本要求

- **最低版本：** Node.js 18.x (LTS)
- **建議版本：** Node.js 20.x / 22.x (LTS)

---

## 三、目錄結構

```text
npm-tool/
├── package.json              # Package metadata, bin entry point
├── .npmignore                # 排除 TypeScript source、測試檔
├── tsconfig.json             # TypeScript 編譯設定
├── README.md                 # 本檔案
│
├── bin/
│   └── runestone            # CLI Entry Point (#!/usr/bin/env node)
│                               → require('../dist/cli.js')
│
├── src/
│   ├── cli.ts                # Commander 程式根、版本、全域選項
│   │
│   ├── commands/             # CLI 命令實作
│   │   ├── setup.ts          # runestone setup (互動式初裝)
│   │   ├── up.ts             # runestone up
│   │   ├── stop.ts           # runestone stop
│   │   ├── down.ts           # runestone down
│   │   ├── status.ts         # runestone status
│   │   ├── certs.ts          # runestone certs create/remove
│   │   └── keys.ts           # runestone keys ls/add
│   │
│   ├── services/             # Docker CLI 抽象層
│   │   ├── docker-compose.ts  # compose up/down/ps/execute
│   │   ├── docker-network.ts  # network create/exists/remove
│   │   ├── docker-volume.ts   # volume create/exists/remove
│   │   ├── docker-run.ts      # run (一次性容器、ssh-add)
│   │   ├── docker-exec.ts     # exec (進入容器)
│   │   └── ssh-manager.ts     # SSH key 掃描、注入邏輯
│   │
│   └── utils/                # 公用函式
│       ├── env-loader.ts      # .env 載入、驗證
│       ├── os-detector.ts     # OS + Arch 偵測
│       ├── docker-checker.ts  # Docker 安裝檢查
│       ├── logger.ts          # Terminal 輸出格式化工具
│       └── path-helpers.ts    # Cross-platform path 處理
│
├── dist/                     # TypeScript 編譯輸出 (gitignored)
│
└── tests/                    # Unit / Integration 測試
    ├── services/
    │   ├── docker-compose.test.ts
    │   └── ssh-manager.test.ts
    └── commands/
        └── status.test.ts
```

---

## 四、命令樹狀結構

### 完整命令列

```text
runestone [command] [options]

Commands:
  setup                          互動式初次設定 (產生 .env)
  up [--project <path>]          啟動 runestone 環境
  stop                           停止所有容器 (不刪除)
  down                           完全拆除環境
  status                         顯示環境狀態與 SSH keys
  certs create <domain>          為網域產生 SSL 憑證
  certs remove <domain>          移除指定網域的憑證
  keys ls                        列出已注入的 SSH keys
  keys add <path>                將 SSH key 注入 Docker Volume

Options:
  -V, --version                  顯示版本號碼
  -h, --help                     顯示幫助資訊
```

### 命令別名

| 主命令         | 別名                   | 說明          |
| -------------- | ---------------------- | ------------- |
| `certs remove` | `certs rm`, `cert del` | 刪除憑證      |
| `keys list`    | `keys ls`              | 列出 SSH keys |

---

## 五、核心設計原則

### 1. 服務層隔離

所有 Docker CLI 呼叫必須透過 Service 層，Command 層只負責流程控制：

```typescript
// ✅ Command 層 (up.ts) - 流程控制
import { composeService } from '../services/docker-compose';
import { networkService } from '../services/docker-network';

export async function handleUp() {
  // 1. 檢查環境
  // 2. 建立網路/Volume
  await networkService.createNetwork(env.NETWORK_NAME);
  await volumeService.createVolume(env.SSH_VOLUME_NAME);
  // 3. 啟動 Compose
  await composeService.up(env.COMPOSE_FILE_PATH, { wait: true });
  // 4. 注入 SSH keys
  await sshManager.addKeys();
}

// ✅ Service 層 (docker-compose.ts) - Docker CLI 包裝
import { execSync } from 'child_process';

export const composeService = {
  up(composePath: string, options: { wait?: boolean }) {
    const flags = options.wait ? '--wait' : '';
    execSync(`docker compose -f ${composePath} up -d ${flags}`, { stdio: 'inherit' });
  },
  // ...
};
```

### 2. 環境變數優先級

| 順序 | 來源                        | 說明                                          |
| ---- | --------------------------- | --------------------------------------------- |
| 1    | Command-line `--env`        | 手動指定 `.env` 路徑                          |
| 2    | 當前工作目錄 `.env`         | `process.cwd()/.env`                          |
| 3    | runestone 專案根目錄 `.env` | 透過 `package.json` 中的 `runestoneRoot` 定位 |
| 4    | 內建預設值                  | `HOST_DOMAIN=docker.so`, `PREFIX=runestone`   |

### 3. 錯誤處理層級

```typescript
// Level 1: Guard (環境檢查)
if (!dockerChecker.isInstalled()) {
  logger.error('Docker is not installed or not in PATH');
  process.exit(1);
}

// Level 2: Service (Docker CLI 執行)
try {
  await composeService.up(path);
} catch (err) {
  if (err.stderr.includes('no such image')) {
    logger.warn('Image not found, pulling...');
    await composeService.pull(path);
  } else {
    throw err;
  }
}

// Level 3: Command (使用者提示)
logger.success('runestone is ready!');
logger.info(`  Traefik: https://traefik.${env.HOST_DOMAIN}`);
logger.info(`  Mailpit: http://mailpit.${env.HOST_DOMAIN}`);
```

---

## 六、服務層 API 設計

### `services/docker-compose.ts`

```typescript
interface ComposeOptions {
  wait?: boolean;
  removeVolumes?: boolean;
  removeImages?: boolean;
}

export const composeService = {
  up(composePath: string, options?: ComposeOptions): void,
  down(composePath: string, options?: ComposeOptions): void,
  stop(composePath: string): void,
  ps(composePath: string): DockerContainer[],
  pull(composePath: string): void,
  logs(composePath: string, service?: string): void,
};

interface DockerContainer {
  Id: string;
  Name: string;
  State: string;
  Status: string;
  Service: string;
}
```

### `services/docker-network.ts`

```typescript
export const networkService = {
  createNetwork(name: string, driver?: string): void,
  exists(name: string): boolean,
  removeNetwork(name: string): void,
  list(): DockerNetwork[],
};

interface DockerNetwork {
  Name: string;
  Id: string;
  Driver: string;
  Scope: string;
}
```

### `services/docker-volume.ts`

```typescript
export const volumeService = {
  createVolume(name: string): void,
  exists(name: string): boolean,
  removeVolume(name: string): void,
  list(): DockerVolume[],
};

interface DockerVolume {
  Name: string;
  Driver: string;
  Mountpoint: string;
}
```

### `services/ssh-manager.ts`

```typescript
export const sshManager = {
  addKeys(keys?: string[]): void,
  addKey(keyPath: string): boolean,
  listKeys(): string[],
  scanHomeDirectory(): string[],
};
```

### `services/docker-run.ts`

```typescript
interface RunOptions {
  rm?: boolean;
  interactive?: boolean;
  tty?: boolean;
  user?: string;
  volumes?: Array<{ source: string; target: string }>;
  volumesFrom?: string;
  name?: string;
}

export const runService = {
  run(image: string, command: string[], options?: RunOptions): string,
};
```

---

## 七、跨平台策略

### OS 偵測 (`utils/os-detector.ts`)

```typescript
type Platform = 'win32' | 'darwin' | 'linux';
type Arch = 'x64' | 'arm64' | 'other';

export const osDetector = {
  platform(): Platform,
  arch(): Arch,
  homeDir(): string,            // os.homedir() wrapper
  sshDir(): string,             // ~/.ssh (Windows: %USERPROFILE%\.ssh)
  isWsl(): boolean,             // /proc/version 包含 Microsoft
};
```

### 路徑處理 (`utils/path-helpers.ts`)

```typescript
export const pathHelpers = {
  resolveComposePath(): string,     // 找到 compose.yaml 的絕對路徑
  resolveEnvPath(cliArg?: string): string,
  normalizePath(path: string): string,    // Windows → Linux mount path (WSL)
};
```

### Docker CLI 參數差異

| 情境              | Linux/macOS       | Windows                                                 |
| ----------------- | ----------------- | ------------------------------------------------------- |
| Volume Mount Path | `/home/user/.ssh` | `C:\Users\user\.ssh` (Docker Desktop 自動轉換)          |
| Line Ending       | `\n`              | Docker CLI JSON 輸出無差異                              |
| Exec Sync         | `execSync`        | `spawnSync` with `shell: true` (Windows CMD/PowerShell) |

---

## 八、互動式 Setup 流程

### 觸發條件

以下情況自動提示執行 `setup`：

1. `.env` 檔案不存在
2. `.env` 缺少必要變數 (`HOST_DOMAIN`, `PREFIX`)
3. 使用者明確執行 `runestone setup`

### 提問流程

```typescript
import enquirer from 'enquirer';

export async function runSetup() {
  const answers = await enquirer.prompt([
    {
      type: 'input',
      name: 'domain',
      message: 'Docker domain (e.g., docker.so)',
      initial: 'docker.so',
    },
    {
      type: 'input',
      name: 'prefix',
      message: 'Project prefix (e.g., runestone)',
      initial: 'runestone',
    },
    {
      type: 'confirm',
      name: 'mkcert',
      message: 'Install mkcert for local SSL certificates?',
      initial: true,
    },
    {
      type: 'select',
      name: 'ports',
      message: 'Custom port mapping?',
      choices: [
        { name: 'Default (HTTPS:443, HTTP:80)', value: 'default' },
        { name: 'Non-root ports (HTTPS:8443, HTTP:8080)', value: 'nonroot' },
      ],
    },
  ]);

  // 寫入 .env
  writeEnvFile(answers);
}
```

### 產生的 `.env` 範例

```bash
# runestone Configuration
HOST_DOMAIN=docker.so
PREFIX=runestone
HTTPS_PORT=443
HTTP_PORT=80
SMTP_PORT=25
RUNESTONE_IMAGE=cymondez/runestone
RUNESTONE_TAG=latest
MKCERT_INSTALLED=true
```

---

## 九、Makefile Target → CLI Command 映射表

| Makefile Target           | CLI Command                | Service Layer                                             |
| ------------------------- | -------------------------- | --------------------------------------------------------- |
| `make up`                 | `runestone up`             | compose.up + network.create + volume.create + ssh.addKeys |
| `make stop`               | `runestone stop`           | compose.stop                                              |
| `make down`               | `runestone down`           | compose.down + network.remove + volume.remove             |
| `make status` / `make ps` | `runestone status`         | compose.ps + ssh.listKeys                                 |
| `make addkeys`            | *(up 流程中自動執行)*      | ssh.addKeys                                               |
| `make addkey KEY=/path`   | `runestone keys add /path` | ssh.addKey                                                |
| `make keys`               | `runestone keys ls`        | ssh.listKeys                                              |
| `make update`             | *(Phase 2)*                | git.pull + compose.pull + compose.up                      |
| `make upgrade`            | *(Phase 2)*                | compose.down + update                                     |
| `make rollback`           | *(Phase 2)*                | compose.down + git.checkout + compose.up                  |

---

## 十、實作優先順序

### Phase 1: 核心生命週期

- [ ] `src/utils/env-loader.ts` — `.env` 載入與驗證
- [ ] `src/utils/docker-checker.ts` — Docker 安裝檢查
- [ ] `src/services/docker-compose.ts` — compose up/stop/down/ps
- [ ] `src/services/docker-network.ts` — network create/exists/remove
- [ ] `src/services/docker-volume.ts` — volume create/exists/remove
- [ ] `src/commands/up.ts` — 啟動流程整合
- [ ] `src/commands/stop.ts` — 停止容器
- [ ] `src/commands/down.ts` — 拆除環境
- [ ] `src/commands/status.ts` — 狀態顯示

### Phase 2: SSH Key + Setup

- [ ] `src/services/docker-run.ts` — 一次性容器執行
- [ ] `src/services/ssh-manager.ts` — SSH key 掃描與注入
- [ ] `src/commands/keys.ts` — keys ls/add
- [ ] `src/commands/setup.ts` — 互動式初裝

### Phase 3: 憑證管理 + 更新

- [ ] `src/commands/certs.ts` — SSL 憑證 CRUD
- [ ] `src/commands/update.ts` — Git pull + Image pull
- [ ] `tests/` — 單元測試補齊

---

## 十一、`.npmignore` 設定

```text
# TypeScript sources
src/
*.ts
tsconfig.json

# Tests
tests/

# Dev files
.vscode/
.github/
.gitignore
.env*

# Compiled output (use .npmrc or postinstall)
dist/

# Docs (optional: include if helpful)
docs/
```

---

## 十二、`package.json` 關鍵欄位

```json
{
  "name": "@druidfi/runestone-cli",
  "version": "1.0.0",
  "description": "Cross-platform CLI tool for runestone Docker development environment",
  "bin": {
    "runestone": "./bin/runestone"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "dotenv": "^16.4.0",
    "enquirer": "^2.4.0",
    "kleur": "^4.1.5"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
```

---

## 十三、開發流程

```bash
# 1. 安裝開發依賴
cd npm-tool
npm install

# 2. 編譯 TypeScript
npm run build        # tsc --project tsconfig.json

# 3. 本地連結測試
npm link             # 全域安裝開發版本

# 4. 執行 CLI
runestone setup
runestone up
runestone status
runestone down

# 5. 開發循環
npm run watch        # tsc --watch，即時編譯

# 6. 除錯模式
DEBUG=1 runestone up   # 顯示所有 Docker CLI 輸出
```

---

## 十四、與 Makefile 共存策略

| 使用者類型            | 使用方式                   |
| --------------------- | -------------------------- |
| **npm 使用者**        | `runestone up` (推薦)      |
| **Shell/Make 使用者** | `make up` (不受影響)       |
| **CI/CD Pipeline**    | 可選任一種，建議統一為 CLI |

兩條路徑共享相同的 `compose.yaml`、`.env`、和 Traefik 設定，互不衝突。

---

## 十五、未來擴充方向

- [ ] `runestone doctor` — 環境診斷報告（Docker 版本、Disk Space、網路狀態）
- [ ] `runestone logs <service>` — 容器日誌串流
- [ ] `runestone exec <service>` — 進入容器 Shell
- [ ] `runestone project add <name> <path>` — 專案註冊管理
- [ ] Plugin 機制（Phase 3）— 第三方技術棧擴充

---

## License

與主專案相同 (查看根目錄 `LICENSE`)
