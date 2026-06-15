import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const SUPPORTED_LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const localeNames: Record<Locale, string> = {
  en: 'English',
  'zh-TW': '繁體中文',
  'ja-JP': '日本語'
};

const messages = {
  en: {
    'cli.description': 'Cross-platform CLI tool for the Runestone local development environment',
    'commands.setup.description': 'Interactive setup for runestone',
    'commands.up.description': 'Start the runestone environment',
    'commands.stop.description': 'Stop the Runestone environment without deleting data',
    'commands.down.description': 'Remove the Runestone environment',
    'commands.status.description': 'Show environment status',
    'commands.certs.description': 'Manage SSL certificates',
    'commands.certs.create.description': 'Generate local SSL certificate for a domain',
    'commands.certs.remove.description': 'Remove certificate for a domain',
    'commands.keys.description': 'Manage SSH keys for Runestone',
    'commands.keys.ls.description': 'List injected SSH keys',
    'commands.keys.add.description': 'Add an SSH key to Runestone',
    'options.forceRecreate.description': 'Recreate services before starting',
    'options.noDeps.description': 'Start only the main service',
    'options.removeNetwork.description': 'Remove the shared network after teardown',
    'options.removeVolumes.description': 'Remove saved data volumes',
    'options.purge.description': 'Remove all local Runestone resources and images',
    'arguments.domain.create': 'Domain to generate certificate for',
    'arguments.domain.remove': 'Domain to remove certificate for',
    'arguments.keyPath': 'Path to the SSH private key file',
    'common.yes': 'Yes',
    'common.no': 'No',
    'setup.intro': 'runestone setup',
    'setup.cancelled': 'Setup cancelled.',
    'setup.failed': 'Setup failed: {message}',
    'setup.language.title': 'Language',
    'setup.language.description': 'Choose the language used by setup and saved to this Runestone configuration.',
    'setup.language.prompt': 'Language',
    'setup.runestonePath.title': 'Runestone path',
    'setup.runestonePath.description':
      'Runestone stores its .env, compose.yml, certificates, and Traefik configuration here. The default is ~/.runestone.',
    'setup.runestonePath.required': 'Runestone path is required',
    'setup.existingSettings': 'Existing settings found at {envPath}. Current values will be used as defaults.',
    'setup.dockerDomain.title': 'Docker domain',
    'setup.dockerDomain.description':
      'This base domain is used for generated service hostnames such as traefik.<domain> and mailpit.<domain>.',
    'setup.dockerDomain.required': 'Domain is required',
    'setup.domainCheck.title': 'Docker domain check',
    'setup.domainCheck.description1': 'Runestone uses hosts under *.{domain}, so the check only verifies wildcard DNS.',
    'setup.domainCheck.description2':
      'The wildcard check queries runestone-wildcard-check.{domain} instead of the bare domain.',
    'setup.domainCheck.description3':
      'The check accepts 127.0.0.1, ::1, and IP addresses from local network interfaces.',
    'setup.domainCheck.prompt': 'Check whether this Docker domain resolves to this machine?',
    'setup.domainCheck.skipped': 'Docker domain resolution check skipped by user.',
    'setup.domainCheck.spinner': 'Checking Docker domain resolution',
    'setup.domainCheck.spinnerDone': 'Docker domain resolution check {status}',
    'setup.domainCheck.localAddresses': 'Local addresses considered for {domain}:',
    'setup.domainCheck.externalIpv6': 'External IPv6 detected: {value}',
    'setup.domainCheck.resolvedTo': '{host} resolved to:',
    'setup.domainCheck.noRecords': 'no records',
    'setup.domainCheck.success': 'Docker domain resolves to this machine.',
    'setup.domainCheck.warnContinue': 'Docker domain check has warnings. Ignore and continue?',
    'setup.domainCheck.failContinue': 'Docker domain check failed. Ignore and continue?',
    'setup.domainCheck.cancelled': 'Setup cancelled. Update DNS or hosts file, then run setup again.',
    'setup.projectPrefix.title': 'Project prefix',
    'setup.projectPrefix.description':
      'The prefix is used for Docker resource names such as the container, network, and SSH volume.',
    'setup.projectPrefix.required': 'Prefix is required',
    'setup.httpGroup.title': 'HTTP entrypoint & HTTP entrypoint port',
    'setup.httpGroup.description1': 'HTTP entrypoint name is passed to the Runestone container.',
    'setup.httpGroup.description2':
      'HTTP entrypoint port defaults to 80 and maps plain HTTP traffic plus Traefik web redirects from the host.',
    'setup.httpName.prompt': 'HTTP entrypoint name',
    'setup.httpName.required': 'HTTP entrypoint name is required',
    'setup.httpPort.prompt': 'HTTP entrypoint port',
    'setup.httpsGroup.title': 'HTTPS entrypoint & HTTPS entrypoint port',
    'setup.httpsGroup.description1': 'HTTPS entrypoint name is passed to the Runestone container.',
    'setup.httpsGroup.description2':
      'HTTPS entrypoint port defaults to 443 and is where browsers connect with the generated local certificates.',
    'setup.httpsName.prompt': 'HTTPS entrypoint name',
    'setup.httpsName.required': 'HTTPS entrypoint name is required',
    'setup.httpsPort.prompt': 'HTTPS entrypoint port',
    'setup.mailpit.title': 'Mailpit SMTP port',
    'setup.mailpit.description':
      'Defaults to 1025. Applications use this host port to send mail into Mailpit during local development.',
    'setup.mailpit.prompt': 'Mailpit SMTP port',
    'setup.hotkey.back': 'Esc Back',
    'setup.hotkey.next': 'Enter Next',
    'setup.hotkey.cancel': 'Ctrl+C Cancel',
    'setup.backSubmitted': 'Back',
    'setup.review.title': 'Review settings',
    'setup.review.prompt': 'Apply these settings?',
    'setup.review.apply': 'Apply settings',
    'setup.review.back': 'Back to previous step',
    'setup.review.cancel': 'Cancel',
    'setup.port.number': 'Port must be a number',
    'setup.port.range': 'Port must be between 1 and 65535',
    'setup.port.inUse': 'Port {port} is already in use. Choose an unused port before continuing.',
    'setup.writingFiles': 'Writing runestone project files',
    'setup.configurationWritten': 'Configuration written to {envPath}',
    'setup.localCa.title': 'Install local CA for SSL certificates',
    'setup.localCa.description':
      'This trusts the local certificate authority and generates default wildcard certificates for the Runestone domain and traefik.me.',
    'setup.localCa.prompt': 'Install local CA for SSL certificates?',
    'setup.localCa.spinner': 'Installing local CA and generating default certificates',
    'setup.localCa.done': 'Local CA installed and default certificates generated',
    'setup.restart.prompt': 'Runestone settings changed. Restart runestone now?',
    'setup.restart.spinner': 'Restarting runestone',
    'setup.restart.done': 'Runestone restarted',
    'setup.restart.notRunning': 'No running runestone container was found to restart.',
    'setup.result.path': 'Runestone path: {path}',
    'setup.result.compose': 'Compose file: {path}',
    'setup.result.domain': 'Domain: {domain}',
    'setup.outro': 'Setup complete. Run `runestone up` to start the environment.'
  },
  'zh-TW': {
    'cli.description': 'Runestone 本地開發環境的跨平台 CLI 工具',
    'commands.setup.description': 'Runestone 互動式設定',
    'commands.up.description': '啟動 Runestone 環境',
    'commands.stop.description': '停止 Runestone 環境但保留資料',
    'commands.down.description': '移除 Runestone 環境',
    'commands.status.description': '顯示環境狀態',
    'commands.certs.description': '管理 SSL 憑證',
    'commands.certs.create.description': '為網域產生本地 SSL 憑證',
    'commands.certs.remove.description': '移除指定網域的憑證',
    'commands.keys.description': '管理 Runestone 的 SSH keys',
    'commands.keys.ls.description': '列出已注入的 SSH keys',
    'commands.keys.add.description': '將 SSH key 加入 Runestone',
    'options.forceRecreate.description': '啟動前重新建立服務',
    'options.noDeps.description': '只啟動主要服務',
    'options.removeNetwork.description': '拆除後移除共用網路',
    'options.removeVolumes.description': '移除保存的資料 volumes',
    'options.purge.description': '移除所有本機 Runestone 資源與 images',
    'arguments.domain.create': '要產生憑證的網域',
    'arguments.domain.remove': '要移除憑證的網域',
    'arguments.keyPath': 'SSH private key 檔案路徑',
    'common.yes': '是',
    'common.no': '否',
    'setup.intro': 'runestone 設定',
    'setup.cancelled': '設定已取消。',
    'setup.failed': '設定失敗：{message}',
    'setup.language.title': '語言',
    'setup.language.description': '選擇 setup 使用並寫入此 Runestone 設定的語言。',
    'setup.language.prompt': '語言',
    'setup.runestonePath.title': 'Runestone path',
    'setup.runestonePath.description':
      'Runestone 會在這裡存放 .env、compose.yml、憑證與 Traefik 設定。預設是 ~/.runestone。',
    'setup.runestonePath.required': 'Runestone path 必填',
    'setup.existingSettings': '找到既有設定：{envPath}。目前值會作為預設值。',
    'setup.dockerDomain.title': 'Docker domain',
    'setup.dockerDomain.description':
      '這個基礎網域會用來產生 traefik.<domain>、mailpit.<domain> 等服務 hostname。',
    'setup.dockerDomain.required': 'Domain 必填',
    'setup.domainCheck.title': 'Docker domain 檢查',
    'setup.domainCheck.description1': 'Runestone 使用 *.{domain} 底下的 hosts，所以只檢查 wildcard DNS。',
    'setup.domainCheck.description2': 'Wildcard 檢查會查詢 runestone-wildcard-check.{domain}，不是 bare domain。',
    'setup.domainCheck.description3': '檢查會接受 127.0.0.1、::1，以及本機網路介面上的 IP。',
    'setup.domainCheck.prompt': '是否檢查這個 Docker domain 是否解析到本機？',
    'setup.domainCheck.skipped': '使用者略過 Docker domain 解析檢查。',
    'setup.domainCheck.spinner': '正在檢查 Docker domain 解析',
    'setup.domainCheck.spinnerDone': 'Docker domain 解析檢查結果：{status}',
    'setup.domainCheck.localAddresses': '{domain} 檢查採用的本機 IP：',
    'setup.domainCheck.externalIpv6': '偵測到外部 IPv6：{value}',
    'setup.domainCheck.resolvedTo': '{host} 解析到：',
    'setup.domainCheck.noRecords': '沒有記錄',
    'setup.domainCheck.success': 'Docker domain 已解析到本機。',
    'setup.domainCheck.warnContinue': 'Docker domain 檢查有警告。是否忽略並繼續？',
    'setup.domainCheck.failContinue': 'Docker domain 檢查失敗。是否忽略並繼續？',
    'setup.domainCheck.cancelled': '設定已取消。請更新 DNS 或 hosts file 後再重新執行 setup。',
    'setup.projectPrefix.title': 'Project prefix',
    'setup.projectPrefix.description': 'Prefix 會用於 Docker resource 名稱，例如 container、network 和 SSH volume。',
    'setup.projectPrefix.required': 'Prefix 必填',
    'setup.httpGroup.title': 'HTTP entrypoint 與 HTTP entrypoint port',
    'setup.httpGroup.description1': 'HTTP entrypoint name 會傳給 Runestone container。',
    'setup.httpGroup.description2': 'HTTP entrypoint port 預設是 80，會對應 host 上的 HTTP 流量與 Traefik web redirect。',
    'setup.httpName.prompt': 'HTTP entrypoint name',
    'setup.httpName.required': 'HTTP entrypoint name 必填',
    'setup.httpPort.prompt': 'HTTP entrypoint port',
    'setup.httpsGroup.title': 'HTTPS entrypoint 與 HTTPS entrypoint port',
    'setup.httpsGroup.description1': 'HTTPS entrypoint name 會傳給 Runestone container。',
    'setup.httpsGroup.description2': 'HTTPS entrypoint port 預設是 443，瀏覽器會透過這個 port 使用本地憑證連線。',
    'setup.httpsName.prompt': 'HTTPS entrypoint name',
    'setup.httpsName.required': 'HTTPS entrypoint name 必填',
    'setup.httpsPort.prompt': 'HTTPS entrypoint port',
    'setup.mailpit.title': 'Mailpit SMTP port',
    'setup.mailpit.description': '預設是 1025。應用程式會用這個 host port 將測試信件送進 Mailpit。',
    'setup.mailpit.prompt': 'Mailpit SMTP port',
    'setup.hotkey.back': 'Esc 上一步',
    'setup.hotkey.next': 'Enter 下一步',
    'setup.hotkey.cancel': 'Ctrl+C 取消',
    'setup.backSubmitted': '上一步',
    'setup.review.title': '確認設定',
    'setup.review.prompt': '是否套用這些設定？',
    'setup.review.apply': '套用設定',
    'setup.review.back': '回到上一步',
    'setup.review.cancel': '取消',
    'setup.port.number': 'Port 必須是數字',
    'setup.port.range': 'Port 必須介於 1 到 65535',
    'setup.port.inUse': 'Port {port} 已被使用。請選擇未被占用的 port。',
    'setup.writingFiles': '正在寫入 Runestone 專案檔案',
    'setup.configurationWritten': '設定已寫入 {envPath}',
    'setup.localCa.title': '安裝本地 CA 給 SSL 憑證使用',
    'setup.localCa.description': '這會信任本地憑證授權單位，並為 Runestone domain 與 traefik.me 產生預設 wildcard 憑證。',
    'setup.localCa.prompt': '是否安裝本地 CA 給 SSL 憑證使用？',
    'setup.localCa.spinner': '正在安裝本地 CA 並產生預設憑證',
    'setup.localCa.done': '本地 CA 已安裝，預設憑證已產生',
    'setup.restart.prompt': 'Runestone 設定已變更。是否現在 restart runestone？',
    'setup.restart.spinner': '正在 restart runestone',
    'setup.restart.done': 'Runestone 已 restart',
    'setup.restart.notRunning': '找不到正在執行的 runestone container 可 restart。',
    'setup.result.path': 'Runestone path：{path}',
    'setup.result.compose': 'Compose file：{path}',
    'setup.result.domain': 'Domain：{domain}',
    'setup.outro': 'Setup 完成。執行 `runestone up` 啟動環境。'
  },
  'ja-JP': {
    'cli.description': 'Runestone ローカル開発環境用のクロスプラットフォーム CLI ツール',
    'commands.setup.description': 'Runestone の対話式設定',
    'commands.up.description': 'Runestone 環境を起動します',
    'commands.stop.description': 'データを残したまま Runestone 環境を停止します',
    'commands.down.description': 'Runestone 環境を削除します',
    'commands.status.description': '環境の状態を表示します',
    'commands.certs.description': 'SSL 証明書を管理します',
    'commands.certs.create.description': 'ドメイン用のローカル SSL 証明書を生成します',
    'commands.certs.remove.description': '指定したドメインの証明書を削除します',
    'commands.keys.description': 'Runestone の SSH keys を管理します',
    'commands.keys.ls.description': '注入済み SSH keys を一覧表示します',
    'commands.keys.add.description': 'SSH key を Runestone に追加します',
    'options.forceRecreate.description': '起動前にサービスを再作成します',
    'options.noDeps.description': 'メインサービスのみ起動します',
    'options.removeNetwork.description': '削除後に共有ネットワークも削除します',
    'options.removeVolumes.description': '保存されたデータ volumes を削除します',
    'options.purge.description': 'ローカルの Runestone resources と images をすべて削除します',
    'arguments.domain.create': '証明書を生成するドメイン',
    'arguments.domain.remove': '証明書を削除するドメイン',
    'arguments.keyPath': 'SSH private key ファイルのパス',
    'common.yes': 'はい',
    'common.no': 'いいえ',
    'setup.intro': 'runestone 設定',
    'setup.cancelled': '設定をキャンセルしました。',
    'setup.failed': '設定に失敗しました: {message}',
    'setup.language.title': '言語',
    'setup.language.description': 'setup で使用し、この Runestone 設定に保存する言語を選択します。',
    'setup.language.prompt': '言語',
    'setup.runestonePath.title': 'Runestone path',
    'setup.runestonePath.description':
      'Runestone は .env、compose.yml、証明書、Traefik 設定をここに保存します。既定値は ~/.runestone です。',
    'setup.runestonePath.required': 'Runestone path は必須です',
    'setup.existingSettings': '既存の設定が見つかりました: {envPath}。現在の値を既定値として使用します。',
    'setup.dockerDomain.title': 'Docker domain',
    'setup.dockerDomain.description':
      'このベースドメインは traefik.<domain> や mailpit.<domain> などの service hostname に使われます。',
    'setup.dockerDomain.required': 'Domain は必須です',
    'setup.domainCheck.title': 'Docker domain チェック',
    'setup.domainCheck.description1': 'Runestone は *.{domain} 配下の hosts を使うため、wildcard DNS のみ確認します。',
    'setup.domainCheck.description2':
      'Wildcard チェックでは bare domain ではなく runestone-wildcard-check.{domain} を問い合わせます。',
    'setup.domainCheck.description3': '127.0.0.1、::1、およびローカルネットワークインターフェイスの IP を許可します。',
    'setup.domainCheck.prompt': 'この Docker domain がこのマシンに解決されるか確認しますか？',
    'setup.domainCheck.skipped': 'Docker domain の解決チェックはユーザーによりスキップされました。',
    'setup.domainCheck.spinner': 'Docker domain の解決を確認しています',
    'setup.domainCheck.spinnerDone': 'Docker domain 解決チェック: {status}',
    'setup.domainCheck.localAddresses': '{domain} の確認に使うローカル IP:',
    'setup.domainCheck.externalIpv6': '外部 IPv6 検出: {value}',
    'setup.domainCheck.resolvedTo': '{host} の解決先:',
    'setup.domainCheck.noRecords': 'レコードなし',
    'setup.domainCheck.success': 'Docker domain はこのマシンに解決されます。',
    'setup.domainCheck.warnContinue': 'Docker domain チェックに警告があります。無視して続行しますか？',
    'setup.domainCheck.failContinue': 'Docker domain チェックに失敗しました。無視して続行しますか？',
    'setup.domainCheck.cancelled': '設定をキャンセルしました。DNS または hosts file を更新してから再実行してください。',
    'setup.projectPrefix.title': 'Project prefix',
    'setup.projectPrefix.description': 'Prefix は container、network、SSH volume などの Docker resource 名に使われます。',
    'setup.projectPrefix.required': 'Prefix は必須です',
    'setup.httpGroup.title': 'HTTP entrypoint と HTTP entrypoint port',
    'setup.httpGroup.description1': 'HTTP entrypoint name は Runestone container に渡されます。',
    'setup.httpGroup.description2':
      'HTTP entrypoint port の既定値は 80 で、host の HTTP 通信と Traefik web redirect に使われます。',
    'setup.httpName.prompt': 'HTTP entrypoint name',
    'setup.httpName.required': 'HTTP entrypoint name は必須です',
    'setup.httpPort.prompt': 'HTTP entrypoint port',
    'setup.httpsGroup.title': 'HTTPS entrypoint と HTTPS entrypoint port',
    'setup.httpsGroup.description1': 'HTTPS entrypoint name は Runestone container に渡されます。',
    'setup.httpsGroup.description2':
      'HTTPS entrypoint port の既定値は 443 で、ブラウザが生成済みローカル証明書で接続する port です。',
    'setup.httpsName.prompt': 'HTTPS entrypoint name',
    'setup.httpsName.required': 'HTTPS entrypoint name は必須です',
    'setup.httpsPort.prompt': 'HTTPS entrypoint port',
    'setup.mailpit.title': 'Mailpit SMTP port',
    'setup.mailpit.description': '既定値は 1025 です。アプリケーションはこの host port から Mailpit にメールを送信します。',
    'setup.mailpit.prompt': 'Mailpit SMTP port',
    'setup.hotkey.back': 'Esc 戻る',
    'setup.hotkey.next': 'Enter 次へ',
    'setup.hotkey.cancel': 'Ctrl+C キャンセル',
    'setup.backSubmitted': '戻る',
    'setup.review.title': '設定の確認',
    'setup.review.prompt': 'この設定を適用しますか？',
    'setup.review.apply': '設定を適用',
    'setup.review.back': '前のステップへ戻る',
    'setup.review.cancel': 'キャンセル',
    'setup.port.number': 'Port は数値で入力してください',
    'setup.port.range': 'Port は 1 から 65535 の範囲で入力してください',
    'setup.port.inUse': 'Port {port} は既に使用中です。未使用の port を選択してください。',
    'setup.writingFiles': 'Runestone project files を書き込んでいます',
    'setup.configurationWritten': '設定を {envPath} に書き込みました',
    'setup.localCa.title': 'SSL 証明書用のローカル CA をインストール',
    'setup.localCa.description':
      'ローカル認証局を信頼し、Runestone domain と traefik.me の既定 wildcard 証明書を生成します。',
    'setup.localCa.prompt': 'SSL 証明書用のローカル CA をインストールしますか？',
    'setup.localCa.spinner': 'ローカル CA をインストールし、既定証明書を生成しています',
    'setup.localCa.done': 'ローカル CA をインストールし、既定証明書を生成しました',
    'setup.restart.prompt': 'Runestone 設定が変更されました。今すぐ runestone を restart しますか？',
    'setup.restart.spinner': 'runestone を restart しています',
    'setup.restart.done': 'Runestone を restart しました',
    'setup.restart.notRunning': 'restart できる実行中の runestone container が見つかりません。',
    'setup.result.path': 'Runestone path: {path}',
    'setup.result.compose': 'Compose file: {path}',
    'setup.result.domain': 'Domain: {domain}',
    'setup.outro': 'Setup が完了しました。`runestone up` で環境を起動してください。'
  }
} as const;

type MessageKey = keyof typeof messages.en;

function normalizeLocale(value?: string): Locale | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace('_', '-').trim().toLowerCase();
  if (normalized === 'zh-tw' || normalized === 'zh-hant' || normalized === 'zh-hant-tw') {
    return 'zh-TW';
  }
  if (normalized === 'ja' || normalized === 'ja-jp') {
    return 'ja-JP';
  }
  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 'en';
  }

  return undefined;
}

function osLocale(): Locale | undefined {
  const candidates = [
    Intl.DateTimeFormat().resolvedOptions().locale,
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG
  ];

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale) {
      return locale;
    }
  }

  return undefined;
}

function readEnvLocale(envPath: string): Locale | undefined {
  if (!fs.existsSync(envPath)) {
    return undefined;
  }

  try {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    return normalizeLocale(parsed.RUNESTONE_LANG);
  } catch {
    return undefined;
  }
}

function persistedLocale(): Locale | undefined {
  const envLocale = normalizeLocale(process.env.RUNESTONE_LANG);
  if (envLocale) {
    return envLocale;
  }

  const cwdEnv = path.resolve(process.cwd(), '.env');
  return readEnvLocale(cwdEnv) ?? readEnvLocale(path.join(os.homedir(), '.runestone', '.env'));
}

export function resolveLocale(userLocale?: string): Locale {
  return normalizeLocale(userLocale) ?? persistedLocale() ?? osLocale() ?? 'en';
}

export function initialSetupLocale(userLocale?: string): Locale {
  return normalizeLocale(userLocale) ?? osLocale() ?? 'en';
}

export function languageChoices(): Array<{ value: Locale; label: string }> {
  return SUPPORTED_LOCALES.map((locale) => ({ value: locale, label: localeNames[locale] }));
}

export function formatMessage(locale: Locale, key: string, vars: Record<string, string | number | boolean> = {}): string {
  const table = messages[locale] as Record<string, string>;
  const fallback = messages.en as Record<string, string>;
  const template = table[key] ?? fallback[key] ?? key;
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function createTranslator(locale: Locale): (key: MessageKey, vars?: Record<string, string | number | boolean>) => string {
  return (key, vars) => formatMessage(locale, key, vars);
}

export function t(key: MessageKey, vars?: Record<string, string | number | boolean>): string {
  return formatMessage(resolveLocale(), key, vars);
}
