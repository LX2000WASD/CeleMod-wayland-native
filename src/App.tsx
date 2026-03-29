import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { invoke } from '@tauri-apps/api/core';
import { getRecommendationSections, type RecommendedMod } from './recommendations';
import { detectPreferredLanguage, useI18n, type TranslateFn } from './i18n';

type AppInfo = {
  version: string;
  gitHash: string;
};

type AppPaths = {
  configDir: string;
  dataDir: string;
};

type CelesteInstall = {
  source: string;
  path: string;
  valid: boolean;
  everestVersion: number | null;
};

type RuntimeSettings = {
  requireWaylandSession: boolean;
  disableDmabufRenderer: boolean;
  disableCompositingMode: boolean;
  logRuntimeDiagnostics: boolean;
};

type RuntimeDiagnostics = {
  configPath: string;
  configExists: boolean;
  settingsSource: string;
  isWaylandSession: boolean;
  requireWaylandSession: boolean;
  xdgSessionType: string | null;
  waylandDisplay: string | null;
  display: string | null;
  xdgRuntimeDir: string | null;
  gdkBackend: string | null;
  webkitDisableDmabufRenderer: string | null;
  webkitDisableCompositingMode: string | null;
  effectiveDisableDmabufRenderer: boolean;
  effectiveDisableCompositingMode: boolean;
  warnings: string[];
};

type RuntimeSaveResult = {
  settings: RuntimeSettings;
  configPath: string;
  restartRequired: boolean;
};

type ModDependency = {
  name: string;
  version: string;
  optional: boolean;
};

type InstalledMod = {
  name: string;
  version: string;
  deps: ModDependency[];
  file: string;
  size: number;
  entryKind: 'directory' | 'zip';
};

type ModBlacklistEntry = {
  name: string;
  file: string;
};

type ModBlacklistProfile = {
  name: string;
  mods: ModBlacklistEntry[];
  modOptionsOrder: string[];
};

type DependencyInstallResult = {
  name: string;
  requiredVersion: string;
  resolvedVersion: string | null;
  status: string;
  savedPath: string | null;
  note: string | null;
};

type InstallProfileBehavior =
  | 'keepEnabled'
  | 'applySelectedProfile'
  | 'disableInAllProfiles';

type InstallModResult = {
  installedMod: InstalledMod;
  savedPath: string;
  replacedFiles: string[];
  updatedProfiles: string[];
  appliedProfile: string | null;
  installProfileBehavior: InstallProfileBehavior;
  dependencyResults: DependencyInstallResult[];
};

type OnlineModSummary = {
  id: string;
  name: string;
  version: string;
  subtitle: string | null;
  description: string;
  submitter: string;
  authorNames: string[];
  pageUrl: string | null;
  downloadUrl: string;
  categoryName: string | null;
  views: number;
  likes: number;
  downloads: number;
  size: number;
  latestUpdateAddedTime: string | null;
  screenshotUrls: string[];
  gameBananaId: number | null;
};

type OnlineModSearchResult = {
  content: OnlineModSummary[];
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalElements: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

type EverestRelease = {
  date: string;
  mainFileSize: number;
  mainDownload: string;
  commit: string;
  branch: string;
  version: number;
  isNative: boolean;
  author?: string;
  description?: string;
};

type ModUpdateInfo = {
  name: string;
  file: string;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
};

type DependencyIssue = {
  name: string;
  requiredVersion: string;
  installedVersion: string | null;
  latestVersion: string | null;
  status: string;
  requiredBy: string[];
  downloadUrl: string | null;
  note: string | null;
};

type WorkspaceMaintenance = {
  availableUpdates: ModUpdateInfo[];
  dependencyIssues: DependencyIssue[];
};

type InstallTask = {
  id: string;
  source: 'manual' | 'search' | 'recommendation' | 'manage';
  title: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  message: string;
};

type DeleteModsResult = {
  removedModNames: string[];
  removedFiles: string[];
  updatedProfiles: string[];
};

type DependencyHealthStatus = 'healthy' | 'missing' | 'disabled' | 'outdated';

type ManagedDependency = {
  name: string;
  requiredVersion: string;
  optional: boolean;
  status: DependencyHealthStatus;
  installedVersion: string | null;
  targetKey: string | null;
  duplicateCount: number;
};

type ManagedModGroup = {
  key: string;
  name: string;
  displayVersion: string;
  versions: string[];
  mods: InstalledMod[];
  files: string[];
  duplicateCount: number;
  totalSize: number;
  entryKinds: InstalledMod['entryKind'][];
  enabled: boolean;
  isAlwaysOn: boolean;
  comment: string;
  dependencies: ManagedDependency[];
  requiredBy: string[];
  health: DependencyHealthStatus;
  availableUpdate: ModUpdateInfo | null;
  dependencyIssue: DependencyIssue | null;
};

type DownloadMirror = 'wegfan' | '0x0ade' | 'gamebanana';

type AppPage =
  | 'home'
  | 'everest'
  | 'search'
  | 'manage'
  | 'multiplayer'
  | 'recommendMods'
  | 'recommendMaps';

type OnlineCategoryOption = {
  value: string;
  categoryId: number | null;
  aliases?: string[];
};

const ALWAYS_ON_STORAGE_KEY = 'celemod-wayland-native.alwaysOnMods';
const DOWNLOAD_MIRROR_STORAGE_KEY = 'celemod-wayland-native.downloadMirror';
const LAST_GAME_PATH_STORAGE_KEY = 'celemod-wayland-native.lastGamePath';
const MOD_COMMENT_STORAGE_KEY = 'celemod-wayland-native.modComments';
const ONLINE_CATEGORY_OPTIONS: OnlineCategoryOption[] = [
  { value: 'Maps', categoryId: 6800, aliases: ['Map'] },
  { value: 'Assets', categoryId: 15655 },
  { value: 'Effects', categoryId: 1501 },
  { value: 'UI', categoryId: 2317 },
  { value: 'Dialog', categoryId: 4633 },
  { value: 'Other/Misc', categoryId: 4632 },
  { value: 'Helpers', categoryId: 5081 },
  { value: 'Skins', categoryId: 11181 },
  { value: 'Mechanics', categoryId: 4635 },
  { value: 'Lönn Plugin', categoryId: 1098 },
];
const ONLINE_CATEGORY_OPTION_BY_NAME = new Map(
  ONLINE_CATEGORY_OPTIONS.flatMap((option) => [
    [option.value, option] as const,
    ...(option.aliases ?? []).map((alias) => [alias, option] as const),
  ]),
);

function getInstallProfileBehaviorLabel(
  behavior: InstallProfileBehavior,
  t: TranslateFn,
) {
  switch (behavior) {
    case 'keepEnabled':
      return t('保持启用，不改 profile');
    case 'applySelectedProfile':
      return t('安装后应用当前选中 profile');
    case 'disableInAllProfiles':
      return t('写入所有 profile 的 blacklist');
  }
}

function getInstallProfileBehaviorDescription(
  behavior: InstallProfileBehavior,
  selectedProfileName: string,
  appliedProfileName: string,
  t: TranslateFn,
) {
  const targetProfile = selectedProfileName || appliedProfileName || t('当前磁盘 profile');

  switch (behavior) {
    case 'keepEnabled':
      return t('新模组安装后保持启用，不会修改任何 blacklist profile。');
    case 'applySelectedProfile':
      return t('安装完成后会重新应用 {targetProfile}，把它对应的 blacklist 状态写回磁盘。', {
        targetProfile,
      });
    case 'disableInAllProfiles':
      return t('新模组会被追加到所有 profile 的 blacklist，然后重新应用当前磁盘 profile，适合“先装上但默认不启用”的场景。');
  }
}

function summarizeInstallProfileOutcome(result: InstallModResult, t: TranslateFn) {
  switch (result.installProfileBehavior) {
    case 'keepEnabled':
      return t('未改动任何 profile。');
    case 'applySelectedProfile':
      return result.appliedProfile
        ? t('已重新应用 profile {profileName}。', { profileName: result.appliedProfile })
        : t('未找到可重新应用的 profile。');
    case 'disableInAllProfiles':
      if (result.updatedProfiles.length && result.appliedProfile) {
        return t(
          '已写入 {profileCount} 个 profile 的 blacklist，并重新应用 {profileName}。',
          {
            profileCount: result.updatedProfiles.length,
            profileName: result.appliedProfile,
          },
        );
      }
      if (result.updatedProfiles.length) {
        return t('已写入 {profileCount} 个 profile 的 blacklist。', {
          profileCount: result.updatedProfiles.length,
        });
      }
      return result.appliedProfile
        ? t('未更新额外 profile，但已重新应用 {profileName}。', {
            profileName: result.appliedProfile,
          })
        : t('未发现可更新的 profile。');
  }
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 100 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function compareVersionValues(left: string, right: string) {
  const normalize = (value: string) =>
    value
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((part) => Number.parseInt(part, 10));
  const leftParts = normalize(left);
  const rightParts = normalize(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }
  return left.localeCompare(right);
}

function pickHighestVersion(versions: string[]) {
  return [...versions].sort((left, right) => compareVersionValues(right, left))[0] ?? '0.0.0';
}

function summarizeDeps(deps: ModDependency[], t: TranslateFn) {
  if (!deps.length) return t('无显式依赖');
  return deps
    .map((dep) => `${dep.name} ${dep.version}${dep.optional ? ` ${t('(optional)')}` : ''}`)
    .join(' / ');
}

function parseDisabledFiles(content: string) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .sort((left, right) => left.localeCompare(right));
}

function buildEffectiveOrder(mods: InstalledMod[], profile: ModBlacklistProfile | null) {
  const installedFiles = mods.map((mod) => mod.file);
  const inOrder = (profile?.modOptionsOrder ?? []).filter((file) => installedFiles.includes(file));
  const rest = installedFiles
    .filter((file) => !inOrder.includes(file))
    .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
  return [...inOrder, ...rest];
}

function stripHtml(input: string) {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function sanitizeDescriptionHtml(input: string) {
  if (typeof document === 'undefined') {
    return stripHtml(input).replace(/\n/g, '<br />');
  }

  const template = document.createElement('template');
  template.innerHTML = input;

  template.content
    .querySelectorAll('script, iframe, style, link, meta, form, button')
    .forEach((element) => element.remove());

  template.content.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
      }
    });

    if (element instanceof HTMLAnchorElement) {
      element.removeAttribute('href');
      element.removeAttribute('target');
      element.removeAttribute('rel');
    }

    if (element instanceof HTMLImageElement) {
      element.removeAttribute('srcset');
      element.loading = 'lazy';
    }
  });

  return template.innerHTML;
}

function formatAbsoluteTime(
  value: string | null,
  t: TranslateFn,
  locale: string,
) {
  if (!value) return t('未知');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('未知');
  return date.toLocaleString(locale);
}

function formatRelativeTimestamp(value: number | null, locale: string) {
  if (!value) return '...';
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const deltaSeconds = Math.round((value - Date.now()) / 1000);
  if (Math.abs(deltaSeconds) < 60) {
    return formatter.format(deltaSeconds, 'second');
  }
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (Math.abs(deltaMinutes) < 60) {
    return formatter.format(deltaMinutes, 'minute');
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) {
    return formatter.format(deltaHours, 'hour');
  }
  return formatter.format(Math.round(deltaHours / 24), 'day');
}

function getTaskMonogram(
  title: string,
  fallback: string,
) {
  const source = title.trim() || fallback.trim();
  return Array.from(source).slice(0, 2).join('').toUpperCase();
}

function getTaskProgressRatio(task: InstallTask) {
  if (task.status === 'succeeded') return 1;
  if (task.status === 'failed') return 0.26;
  const elapsedSeconds = Math.max(0, (Date.now() - task.startedAt) / 1000);
  return Math.max(0.12, Math.min(0.88, 0.12 + elapsedSeconds / 90));
}

function normalizeDownloadMirror(value: string | null | undefined): DownloadMirror {
  if (value === '0x0ade' || value === 'gamebanana' || value === 'wegfan') {
    return value;
  }
  return detectPreferredLanguage() === 'zh-CN' ? 'wegfan' : '0x0ade';
}

function normalizeStringList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function dedupePreservingOrder(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalizedValue = value.trim();
    if (!normalizedValue || seen.has(normalizedValue)) {
      return false;
    }
    seen.add(normalizedValue);
    return true;
  });
}

function loadStoredStringValue(key: string) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

function loadStoredStringList(key: string) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? normalizeStringList(parsed.filter((value): value is string => typeof value === 'string'))
      : [];
  } catch {
    return [];
  }
}

function loadStoredRecordValue(key: string) {
  if (typeof window === 'undefined') return {} as Record<string, string>;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {} as Record<string, string>;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {} as Record<string, string>;
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {} as Record<string, string>;
  }
}

function getModCommentStorageId(gamePath: string, modName: string) {
  return `${gamePath}::${modName}`;
}

function getDependencyHealthWeight(status: DependencyHealthStatus) {
  switch (status) {
    case 'missing':
      return 3;
    case 'outdated':
      return 2;
    case 'disabled':
      return 1;
    case 'healthy':
      return 0;
  }
}

function getDependencyHealthLabel(
  status: DependencyHealthStatus,
  t: TranslateFn,
  optional = false,
) {
  switch (status) {
    case 'healthy':
      return optional ? t('可选依赖已满足') : t('依赖已满足');
    case 'missing':
      return optional ? t('可选依赖缺失') : t('缺失依赖');
    case 'disabled':
      return optional ? t('可选依赖未启用') : t('依赖未启用');
    case 'outdated':
      return optional ? t('可选依赖版本不足') : t('依赖版本不足');
  }
}

function getInstallTaskSourceLabel(source: InstallTask['source'], t: TranslateFn) {
  switch (source) {
    case 'manual':
      return t('手动安装');
    case 'search':
      return t('在线搜索');
    case 'recommendation':
      return t('推荐安装');
    case 'manage':
      return t('管理页维护');
  }
}

function getInstallTaskStatusLabel(status: InstallTask['status'], t: TranslateFn) {
  switch (status) {
    case 'running':
      return t('进行中');
    case 'succeeded':
      return t('已完成');
    case 'failed':
      return t('失败');
  }
}

function getDownloadMirrorLabel(mirror: DownloadMirror, t: TranslateFn) {
  switch (mirror) {
    case 'wegfan':
      return 'WEGFan';
    case '0x0ade':
      return '0x0ade';
    case 'gamebanana':
      return t('GameBanana');
  }
}

function getDownloadMirrorDescription(mirror: DownloadMirror, t: TranslateFn) {
  switch (mirror) {
    case 'wegfan':
      return t('优先走 Wegfan 提供的下载接口，中文环境下默认使用。');
    case '0x0ade':
      return t('改走 0x0ade 的 banana mirror，更接近旧版默认海外线路。');
    case 'gamebanana':
      return t('直接回落到 GameBanana 原始下载地址。');
  }
}

function getDependencyIssueStatusLabel(issue: DependencyIssue, t: TranslateFn) {
  switch (issue.status) {
    case 'missing':
      return t('缺失');
    case 'outdated':
      return t('版本不足');
    case 'unavailable':
      return t('无法自动补全');
    default:
      return issue.status;
  }
}

function getCategoryDisplayLabel(category: string | null | undefined, t: TranslateFn) {
  switch ((category ?? '').trim()) {
    case '':
      return t('未分类');
    case 'Maps':
    case 'Map':
      return t('地图');
    case 'Assets':
      return t('资源');
    case 'Effects':
      return t('特效');
    case 'Dialog':
      return t('对话');
    case 'Other/Misc':
      return t('其他');
    case 'Helpers':
      return t('辅助');
    case 'Skins':
      return t('皮肤');
    case 'Mechanics':
      return t('机制');
    case 'UI':
      return t('界面');
    case 'Lönn Plugin':
      return t('Lönn 插件');
    default:
      return category ?? t('未分类');
  }
}

function normalizeOnlineCategoryValue(category: string | null | undefined) {
  const trimmed = (category ?? '').trim();
  if (!trimmed) return '';
  return ONLINE_CATEGORY_OPTION_BY_NAME.get(trimmed)?.value ?? trimmed;
}

function getOnlineCategoryId(category: string | null | undefined) {
  const normalizedCategory = normalizeOnlineCategoryValue(category);
  if (!normalizedCategory) return null;
  return ONLINE_CATEGORY_OPTION_BY_NAME.get(normalizedCategory)?.categoryId ?? null;
}

type ManageDependencyTreeProps = {
  dependencies: ManagedDependency[];
  modGroupByKey: Map<string, ManagedModGroup>;
  t: TranslateFn;
  lineage?: string[];
  depth?: number;
};

function ManageDependencyTree({
  dependencies,
  modGroupByKey,
  t,
  lineage = [],
  depth = 0,
}: ManageDependencyTreeProps) {
  if (!dependencies.length) {
    return <p className="muted">{t('无显式依赖')}</p>;
  }

  return (
    <ul className={`dependency-tree depth-${Math.min(depth, 3)}`}>
      {dependencies.map((dependency) => {
        const target = dependency.targetKey ? modGroupByKey.get(dependency.targetKey) ?? null : null;
        const hasCycle = Boolean(target && lineage.includes(target.key));
        return (
          <li
            key={`${lineage.join('>')}::${dependency.name}::${dependency.requiredVersion}::${String(
              dependency.optional,
            )}`}
            className={`dependency-tree-item status-${dependency.status}`}
          >
            <div className="dependency-tree-head">
              <div className="dependency-tree-copy">
                <strong>{dependency.name}</strong>
                <small>
                  {dependency.optional ? t('可选依赖') : t('硬依赖')}
                  {' · '}
                  {t('需要 {version}', { version: dependency.requiredVersion })}
                  {dependency.installedVersion
                    ? t(' · 已装 {version}', { version: dependency.installedVersion })
                    : t(' · 当前未安装')}
                </small>
              </div>
              <div className="tag-row">
                <span className={`pill ${dependency.status === 'healthy' ? 'solid' : 'warn'}`}>
                  {getDependencyHealthLabel(dependency.status, t, dependency.optional)}
                </span>
                {dependency.duplicateCount > 1 ? (
                  <span className="pill warn">
                    {t('重复 {count} 份', { count: dependency.duplicateCount })}
                  </span>
                ) : null}
                {hasCycle ? <span className="pill">{t('循环引用')}</span> : null}
              </div>
            </div>
            {target && !hasCycle && target.dependencies.length ? (
              <ManageDependencyTree
                dependencies={target.dependencies}
                modGroupByKey={modGroupByKey}
                t={t}
                lineage={[...lineage, target.key]}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function App() {
  const {
    t,
    currentLanguage,
    setCurrentLanguage,
    languageOptions,
    translationPackDirectory,
    translationPackErrors,
  } = useI18n();
  const [activePage, setActivePage] = useState<AppPage>('home');
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [installs, setInstalls] = useState<CelesteInstall[]>([]);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const [runtimeDraft, setRuntimeDraft] = useState<RuntimeSettings | null>(null);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [runtimeMessage, setRuntimeMessage] = useState('');
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [manualPath, setManualPath] = useState(() => loadStoredStringValue(LAST_GAME_PATH_STORAGE_KEY) ?? '');
  const [verifyResult, setVerifyResult] = useState('');
  const [baseDataLoaded, setBaseDataLoaded] = useState(false);
  const [selectedGamePath, setSelectedGamePath] = useState('');
  const [selectedEverestVersion, setSelectedEverestVersion] = useState<number | null>(null);
  const [mods, setMods] = useState<InstalledMod[]>([]);
  const [profiles, setProfiles] = useState<ModBlacklistProfile[]>([]);
  const [selectedProfileName, setSelectedProfileName] = useState('');
  const [appliedProfileName, setAppliedProfileName] = useState('');
  const [diskBlacklistContent, setDiskBlacklistContent] = useState('');
  const [availableUpdates, setAvailableUpdates] = useState<ModUpdateInfo[]>([]);
  const [dependencyIssues, setDependencyIssues] = useState<DependencyIssue[]>([]);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [alwaysOnMods, setAlwaysOnMods] = useState<string[]>(() =>
    loadStoredStringList(ALWAYS_ON_STORAGE_KEY),
  );
  const [modComments, setModComments] = useState<Record<string, string>>(() =>
    loadStoredRecordValue(MOD_COMMENT_STORAGE_KEY),
  );
  const [workspaceMessage, setWorkspaceMessage] = useState('');
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [modFilter, setModFilter] = useState('');
  const [showDependencyTree, setShowDependencyTree] = useState(false);
  const [showManageDetails, setShowManageDetails] = useState(false);
  const [selectedDeletionMods, setSelectedDeletionMods] = useState<string[]>([]);
  const [installUrl, setInstallUrl] = useState('');
  const [installProfileBehavior, setInstallProfileBehavior] =
    useState<InstallProfileBehavior>('keepEnabled');
  const [installDependencies, setInstallDependencies] = useState(true);
  const [installResult, setInstallResult] = useState<InstallModResult | null>(null);
  const [recommendationMessage, setRecommendationMessage] = useState('');
  const [installTasks, setInstallTasks] = useState<InstallTask[]>([]);
  const [downloadMirror, setDownloadMirror] = useState<DownloadMirror>(() =>
    normalizeDownloadMirror(loadStoredStringValue(DOWNLOAD_MIRROR_STORAGE_KEY)),
  );
  const [installTaskPanelOpen, setInstallTaskPanelOpen] = useState(false);
  const [onlineQuery, setOnlineQuery] = useState('');
  const [onlineSort, setOnlineSort] = useState<'likes' | 'new' | 'updateAdded' | 'updated' | 'views'>('likes');
  const [onlineCategoryFilter, setOnlineCategoryFilter] = useState('');
  const [onlinePage, setOnlinePage] = useState(1);
  const [onlineSearchResult, setOnlineSearchResult] = useState<OnlineModSearchResult | null>(null);
  const [selectedOnlineMod, setSelectedOnlineMod] = useState<OnlineModSummary | null>(null);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [everestVersions, setEverestVersions] = useState<EverestRelease[] | null>(null);
  const [everestLoading, setEverestLoading] = useState(false);
  const [everestMessage, setEverestMessage] = useState('');
  const [everestInstallBusy, setEverestInstallBusy] = useState(false);
  const [error, setError] = useState('');
  const installTaskCounter = useRef(0);
  const initialWorkspaceRestoreAttempted = useRef(false);
  const installProfileBehaviorOptions = useMemo(
    () => [
      { value: 'keepEnabled' as const, label: t('保持启用，不改 profile') },
      { value: 'applySelectedProfile' as const, label: t('安装后应用当前选中 profile') },
      { value: 'disableInAllProfiles' as const, label: t('写入所有 profile 的 blacklist') },
    ],
    [t],
  );
  const recommendationSections = useMemo(() => getRecommendationSections(t), [t]);

  const loadBaseData = async () => {
    const [info, resolvedPaths, detectedInstalls, settings, diagnostics] = await Promise.all([
      invoke<AppInfo>('app_info'),
      invoke<AppPaths>('app_paths'),
      invoke<CelesteInstall[]>('detect_celeste_installs'),
      invoke<RuntimeSettings>('get_runtime_settings'),
      invoke<RuntimeDiagnostics>('get_runtime_diagnostics'),
    ]);
    setAppInfo(info);
    setPaths(resolvedPaths);
    setInstalls(detectedInstalls);
    setRuntimeSettings(settings);
    setRuntimeDraft(settings);
    setRuntimeDiagnostics(diagnostics);
  };

  useEffect(() => {
    const load = async () => {
      try {
        await loadBaseData();
        setBaseDataLoaded(true);
      } catch (err) {
        setError(String(err));
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ALWAYS_ON_STORAGE_KEY, JSON.stringify(alwaysOnMods));
  }, [alwaysOnMods]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DOWNLOAD_MIRROR_STORAGE_KEY, downloadMirror);
  }, [downloadMirror]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MOD_COMMENT_STORAGE_KEY, JSON.stringify(modComments));
  }, [modComments]);

  useEffect(() => {
    if (typeof window === 'undefined' || !selectedGamePath) return;
    window.localStorage.setItem(LAST_GAME_PATH_STORAGE_KEY, selectedGamePath);
  }, [selectedGamePath]);

  const summary = useMemo(() => {
    if (!installs.length) return t('未自动发现 Celeste 安装。');
    return t('已发现 {count} 个 Celeste 安装目录，可直接载入业务层。', {
      count: installs.length,
    });
  }, [installs, t]);

  const resolveCelestePathInput = async (input: string) => {
    const rawPath = input.trim();
    if (!rawPath) return '';
    const resolvedPath = await invoke<string | null>('resolve_celeste_path', { path: rawPath });
    return (resolvedPath ?? rawPath).trim();
  };

  const verifyPath = async () => {
    setVerifyResult('');
    try {
      const path = await resolveCelestePathInput(manualPath);
      if (path) {
        setManualPath(path);
      }
      const valid = await invoke<boolean>('verify_celeste_install', { path });
      const everestVersion = valid
        ? await invoke<number | null>('get_everest_version', { path })
        : null;
      setVerifyResult(
        valid
          ? everestVersion
            ? t('安装有效，Everest 版本 {version}', { version: everestVersion })
            : t('安装有效，但未检测到 Everest')
          : t('路径无效，未找到 Celeste 可执行文件。'),
      );
    } catch (err) {
      setVerifyResult(t('校验失败: {error}', { error: String(err) }));
    }
  };

  useEffect(() => {
    if (!baseDataLoaded || initialWorkspaceRestoreAttempted.current) return;

    initialWorkspaceRestoreAttempted.current = true;
    const storedGamePath = loadStoredStringValue(LAST_GAME_PATH_STORAGE_KEY) ?? '';
    const candidates = dedupePreservingOrder([
      storedGamePath,
      ...installs.filter((install) => install.valid).map((install) => install.path),
    ]);

    if (!candidates.length) {
      if (storedGamePath) {
        setManualPath(storedGamePath);
      }
      return;
    }

    const restoreWorkspace = async () => {
      setWorkspaceBusy(true);
      try {
        for (const candidate of candidates) {
          try {
            const resolvedPath = await resolveCelestePathInput(candidate);
            await fetchWorkspace(resolvedPath || candidate);
            const isStoredPath = Boolean(storedGamePath) && candidate === storedGamePath;
            setWorkspaceMessage(
              isStoredPath
                ? t('已恢复上次使用的 Celeste 目录: {gamePath}。', {
                    gamePath: resolvedPath || candidate,
                  })
                : t('已自动载入检测到的 Celeste 目录: {gamePath}。', {
                    gamePath: resolvedPath || candidate,
                  }),
            );
            return;
          } catch {
            continue;
          }
        }

        if (storedGamePath) {
          setManualPath(storedGamePath);
        }
      } finally {
        setWorkspaceBusy(false);
      }
    };

    void restoreWorkspace();
  }, [baseDataLoaded, installs, t]);

  const refreshRuntimeDiagnostics = async () => {
    const diagnostics = await invoke<RuntimeDiagnostics>('get_runtime_diagnostics');
    setRuntimeDiagnostics(diagnostics);
  };

  const loadWorkspaceMaintenance = async (gamePath: string) => {
    try {
      const maintenance = await invoke<WorkspaceMaintenance>('get_workspace_maintenance', {
        gamePath,
        downloadMirror,
      });
      setAvailableUpdates(maintenance.availableUpdates);
      setDependencyIssues(maintenance.dependencyIssues);
      setMaintenanceMessage('');
    } catch (err) {
      setAvailableUpdates([]);
      setDependencyIssues([]);
      setMaintenanceMessage(t('更新/依赖检测失败: {error}', { error: String(err) }));
    }
  };

  const updateRuntimeDraft = <K extends keyof RuntimeSettings>(
    key: K,
    value: RuntimeSettings[K],
  ) => {
    setRuntimeDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const saveRuntimeConfig = async () => {
    if (!runtimeDraft) return;
    setRuntimeBusy(true);
    setRuntimeMessage('');
    try {
      const result = await invoke<RuntimeSaveResult>('save_runtime_settings', {
        settings: runtimeDraft,
      });
      setRuntimeSettings(result.settings);
      setRuntimeDraft(result.settings);
      setRuntimeMessage(
        t('运行时配置已保存到 {configPath}。', { configPath: result.configPath }) +
          (result.restartRequired ? t('重启应用后完全生效。') : ''),
      );
      await refreshRuntimeDiagnostics();
    } catch (err) {
      setRuntimeMessage(t('保存失败: {error}', { error: String(err) }));
    } finally {
      setRuntimeBusy(false);
    }
  };

  const resetRuntimeConfig = async () => {
    setRuntimeBusy(true);
    setRuntimeMessage('');
    try {
      const result = await invoke<RuntimeSaveResult>('reset_runtime_settings');
      setRuntimeSettings(result.settings);
      setRuntimeDraft(result.settings);
      setRuntimeMessage(
        t('已恢复默认运行时配置。') + (result.restartRequired ? t('重启应用后完全生效。') : ''),
      );
      await refreshRuntimeDiagnostics();
    } catch (err) {
      setRuntimeMessage(t('重置失败: {error}', { error: String(err) }));
    } finally {
      setRuntimeBusy(false);
    }
  };

  const fetchWorkspace = async (gamePath: string, preferredProfileName?: string) => {
    const path = await resolveCelestePathInput(gamePath);
    const valid = await invoke<boolean>('verify_celeste_install', { path });
    if (!valid) {
      throw new Error(t('路径无效，未找到 Celeste 可执行文件。'));
    }

    const [
      everestVersion,
      installedMods,
      loadedProfiles,
      currentProfile,
      blacklistContent,
    ] = await Promise.all([
      invoke<number | null>('get_everest_version', { path }),
      invoke<InstalledMod[]>('get_installed_mods', { path }),
      invoke<ModBlacklistProfile[]>('get_blacklist_profiles', { gamePath: path }),
      invoke<string>('get_current_profile', { gamePath: path }),
      invoke<string>('get_current_blacklist_content', { gamePath: path }),
    ]);

    const nextSelectedProfile =
      preferredProfileName && loadedProfiles.some((profile) => profile.name === preferredProfileName)
        ? preferredProfileName
        : loadedProfiles.some((profile) => profile.name === currentProfile)
          ? currentProfile
          : (loadedProfiles[0]?.name ?? '');

    setSelectedGamePath(path);
    setManualPath(path);
    setSelectedEverestVersion(everestVersion);
    setMods(installedMods);
    setProfiles(loadedProfiles);
    setAppliedProfileName(currentProfile);
    setSelectedProfileName(nextSelectedProfile);
    setDiskBlacklistContent(blacklistContent);
    await loadWorkspaceMaintenance(path);
  };

  const loadWorkspace = async (gamePath: string, preferredProfileName?: string, message?: string) => {
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      const path = await resolveCelestePathInput(gamePath);
      await fetchWorkspace(path, preferredProfileName);
      setWorkspaceMessage(message ?? t('已载入 {gamePath}。', { gamePath: path }));
    } catch (err) {
      setWorkspaceMessage(t('载入失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const refreshWorkspace = async (message = t('已刷新工作区。')) => {
    if (!selectedGamePath) return;
    await loadWorkspace(selectedGamePath, selectedProfileName, message);
  };

  const startGame = async () => {
    if (!selectedGamePath) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      await invoke('start_game', { gamePath: selectedGamePath });
      setWorkspaceMessage(t('已发送启动请求，请切回桌面会话查看游戏窗口。'));
    } catch (err) {
      setWorkspaceMessage(t('启动失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const openModsFolder = async () => {
    if (!selectedGamePath) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      await invoke('open_mods_folder', { gamePath: selectedGamePath });
      setWorkspaceMessage(t('已请求打开当前工作区的 Mods 文件夹。'));
    } catch (err) {
      setWorkspaceMessage(t('打开 Mods 文件夹失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const refreshWorkspaceMaintenance = async () => {
    if (!selectedGamePath) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      const maintenance = await invoke<WorkspaceMaintenance>('get_workspace_maintenance', {
        gamePath: selectedGamePath,
        downloadMirror,
      });
      setAvailableUpdates(maintenance.availableUpdates);
      setDependencyIssues(maintenance.dependencyIssues);
      setMaintenanceMessage('');
      setWorkspaceMessage(t('已刷新更新与依赖状态。'));
    } catch (err) {
      setMaintenanceMessage(t('更新/依赖检测失败: {error}', { error: String(err) }));
      setWorkspaceMessage(t('刷新维护状态失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const performManagedUpdateByName = async (modName: string) =>
    invoke<InstallModResult>('update_mod_by_name', {
      gamePath: selectedGamePath,
      modName,
      installProfileBehavior: maintenanceInstallProfileBehavior,
      selectedProfileName: maintenanceTargetProfileName,
      installDependencies: true,
      alwaysOnMods,
      downloadMirror,
    });

  const updateModFromManage = async (modName: string) => {
    if (!selectedGamePath) return;
    const update = updateByName.get(modName);
    if (!update) return;

    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    const taskId = pushInstallTask(
      'manage',
      t('更新: {modName}', { modName }),
      t('正在检查并下载最新版本...'),
    );

    try {
      const result = await performManagedUpdateByName(modName);
      updateInstallTask(taskId, {
        status: 'succeeded',
        finishedAt: Date.now(),
        message: t('已从 {currentVersion} 更新到 {nextVersion}。', {
          currentVersion: update.currentVersion,
          nextVersion: result.installedMod.version,
        }),
      });
      await fetchWorkspace(selectedGamePath, selectedProfileName || appliedProfileName || undefined);
      setWorkspaceMessage(
        t('已更新 {modName} 到 {version}。', {
          modName,
          version: result.installedMod.version,
        }),
      );
    } catch (err) {
      updateInstallTask(taskId, {
        status: 'failed',
        finishedAt: Date.now(),
        message: t('更新失败: {error}', { error: String(err) }),
      });
      setWorkspaceMessage(t('更新失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const updateAllModsFromManage = async () => {
    if (!selectedGamePath || !availableUpdates.length) return;

    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    const taskId = pushInstallTask(
      'manage',
      t('批量更新已装 Mod'),
      t('准备处理 {count} 个可更新 Mod。', { count: availableUpdates.length }),
    );

    let succeeded = 0;
    let failed = 0;

    try {
      for (const update of availableUpdates) {
        updateInstallTask(taskId, {
          message: t('正在更新 {modName} ({index}/{total})...', {
            modName: update.name,
            index: succeeded + failed + 1,
            total: availableUpdates.length,
          }),
        });

        try {
          await performManagedUpdateByName(update.name);
          succeeded += 1;
        } catch (err) {
          failed += 1;
          updateInstallTask(taskId, {
            message: t('更新 {modName} 失败: {error}。', {
              modName: update.name,
              error: String(err),
            }),
          });
        }
      }

      updateInstallTask(taskId, {
        status: failed ? 'failed' : 'succeeded',
        finishedAt: Date.now(),
        message: t('批量更新完成，成功 {succeeded}，失败 {failed}。', {
          succeeded,
          failed,
        }),
      });
      await fetchWorkspace(selectedGamePath, selectedProfileName || appliedProfileName || undefined);
      setWorkspaceMessage(
        t('批量更新完成，成功 {succeeded}，失败 {failed}。', {
          succeeded,
          failed,
        }),
      );
    } catch (err) {
      updateInstallTask(taskId, {
        status: 'failed',
        finishedAt: Date.now(),
        message: t('批量更新中断: {error}', { error: String(err) }),
      });
      setWorkspaceMessage(t('批量更新中断: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const repairAllDependencyIssues = async () => {
    if (!selectedGamePath || !dependencyIssues.length) return;

    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    const taskId = pushInstallTask(
      'manage',
      t('补全缺失依赖'),
      t('准备处理 {count} 项依赖问题。', { count: dependencyIssues.length }),
    );

    try {
      const results = await invoke<DependencyInstallResult[]>('repair_dependency_issues', {
        gamePath: selectedGamePath,
        installProfileBehavior: maintenanceInstallProfileBehavior,
        selectedProfileName: maintenanceTargetProfileName,
        alwaysOnMods,
        downloadMirror,
      });
      const installedCount = results.filter((result) => result.status === 'installed').length;
      const failedCount = results.filter((result) => result.status === 'failed').length;
      const unresolvedCount = results.filter((result) => result.status === 'unresolved').length;

      updateInstallTask(taskId, {
        status: failedCount || unresolvedCount ? 'failed' : 'succeeded',
        finishedAt: Date.now(),
        message: t('依赖处理完成，安装 {installedCount}，失败 {failedCount}，仍未解决 {unresolvedCount}。', {
          installedCount,
          failedCount,
          unresolvedCount,
        }),
      });
      await fetchWorkspace(selectedGamePath, selectedProfileName || appliedProfileName || undefined);
      setWorkspaceMessage(
        t('依赖处理完成，安装 {installedCount}，失败 {failedCount}，仍未解决 {unresolvedCount}。', {
          installedCount,
          failedCount,
          unresolvedCount,
        }),
      );
    } catch (err) {
      updateInstallTask(taskId, {
        status: 'failed',
        finishedAt: Date.now(),
        message: t('依赖补全失败: {error}', { error: String(err) }),
      });
      setWorkspaceMessage(t('依赖补全失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const repairDependencyIssueByName = async (dependencyName: string) => {
    if (!selectedGamePath) return;

    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    const taskId = pushInstallTask(
      'manage',
      t('修复依赖: {dependencyName}', { dependencyName }),
      t('正在下载并修复依赖...'),
    );

    try {
      const results = await invoke<DependencyInstallResult[]>('repair_dependency_issue_by_name', {
        gamePath: selectedGamePath,
        dependencyName,
        installProfileBehavior: maintenanceInstallProfileBehavior,
        selectedProfileName: maintenanceTargetProfileName,
        alwaysOnMods,
        downloadMirror,
      });
      const installedCount = results.filter((result) => result.status === 'installed').length;
      const failedCount = results.filter((result) => result.status === 'failed').length;
      const unresolvedCount = results.filter((result) => result.status === 'unresolved').length;

      updateInstallTask(taskId, {
        status: failedCount || unresolvedCount ? 'failed' : 'succeeded',
        finishedAt: Date.now(),
        message: t('{dependencyName} 处理完成，安装 {installedCount}，失败 {failedCount}，未解决 {unresolvedCount}。', {
          dependencyName,
          installedCount,
          failedCount,
          unresolvedCount,
        }),
      });
      await fetchWorkspace(selectedGamePath, selectedProfileName || appliedProfileName || undefined);
      setWorkspaceMessage(
        t('{dependencyName} 处理完成，安装 {installedCount}，失败 {failedCount}，未解决 {unresolvedCount}。', {
          dependencyName,
          installedCount,
          failedCount,
          unresolvedCount,
        }),
      );
    } catch (err) {
      updateInstallTask(taskId, {
        status: 'failed',
        finishedAt: Date.now(),
        message: t('修复失败: {error}', { error: String(err) }),
      });
      setWorkspaceMessage(t('修复失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const toggleAlwaysOn = async (modName: string) => {
    const nextAlwaysOnMods = normalizeStringList(
      alwaysOnMods.includes(modName)
        ? alwaysOnMods.filter((name) => name !== modName)
        : [...alwaysOnMods, modName],
    );

    setAlwaysOnMods(nextAlwaysOnMods);

    if (!selectedGamePath || !appliedProfileName) {
      setWorkspaceMessage(
        nextAlwaysOnMods.includes(modName)
          ? t('已将 {modName} 加入 Always On。', { modName })
          : t('已将 {modName} 从 Always On 移除。', { modName }),
      );
      return;
    }

    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      await invoke('apply_blacklist_profile', {
        gamePath: selectedGamePath,
        profileName: appliedProfileName,
        alwaysOnMods: nextAlwaysOnMods,
      });
      await fetchWorkspace(selectedGamePath, selectedProfileName || appliedProfileName);
      setWorkspaceMessage(
        nextAlwaysOnMods.includes(modName)
          ? t('已将 {modName} 设为 Always On，并重新应用 {profileName}。', {
              modName,
              profileName: appliedProfileName,
            })
          : t('已取消 {modName} 的 Always On，并重新应用 {profileName}。', {
              modName,
              profileName: appliedProfileName,
            }),
      );
    } catch (err) {
      setAlwaysOnMods(alwaysOnMods);
      setWorkspaceMessage(t('更新 Always On 失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const applyProfile = async (profileName: string, successMessage?: string) => {
    if (!selectedGamePath || !profileName) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      await invoke('apply_blacklist_profile', {
        gamePath: selectedGamePath,
        profileName,
        alwaysOnMods,
      });
      await fetchWorkspace(selectedGamePath, profileName);
      setWorkspaceMessage(
        successMessage ?? t('已应用 profile {profileName}。', { profileName }),
      );
    } catch (err) {
      setWorkspaceMessage(t('应用失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const applySelectedProfile = async () => {
    await applyProfile(selectedProfileName);
  };

  const createProfile = async () => {
    const profileName = newProfileName.trim();
    if (!selectedGamePath || !profileName) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      await invoke('new_mod_blacklist_profile', {
        gamePath: selectedGamePath,
        profileName,
      });
      setNewProfileName('');
      await fetchWorkspace(selectedGamePath, profileName);
      setWorkspaceMessage(t('已创建 profile {profileName}。', { profileName }));
    } catch (err) {
      setWorkspaceMessage(t('创建失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const removeSelectedProfile = async () => {
    if (!selectedGamePath || !selectedProfileName) return;
    if (!window.confirm(t('确定删除 profile {profileName} 吗？', { profileName: selectedProfileName }))) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      await invoke('remove_mod_blacklist_profile', {
        gamePath: selectedGamePath,
        profileName: selectedProfileName,
      });
      await fetchWorkspace(selectedGamePath);
      setWorkspaceMessage(t('已删除 profile {profileName}。', { profileName: selectedProfileName }));
    } catch (err) {
      setWorkspaceMessage(t('删除失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const toggleModState = async (mod: InstalledMod, enabled: boolean) => {
    if (!selectedGamePath || !selectedProfileName) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      await invoke('switch_mod_blacklist_profile', {
        gamePath: selectedGamePath,
        profileName: selectedProfileName,
        mods: [{ name: mod.name, file: mod.file }],
        enabled,
      });
      await fetchWorkspace(selectedGamePath, selectedProfileName);
      setWorkspaceMessage(
        enabled
          ? t('已在 {profileName} 中启用 {modName}。', {
              profileName: selectedProfileName,
              modName: mod.name,
            })
          : t('已在 {profileName} 中禁用 {modName}。', {
              profileName: selectedProfileName,
              modName: mod.name,
            }),
      );
    } catch (err) {
      setWorkspaceMessage(t('更新失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const syncAppliedProfileFromDisk = async () => {
    if (!selectedGamePath || !appliedProfileName) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      await invoke('sync_blacklist_profile_from_file', {
        gamePath: selectedGamePath,
        profileName: appliedProfileName,
        alwaysOnMods,
      });
      await fetchWorkspace(selectedGamePath, selectedProfileName || appliedProfileName);
      setWorkspaceMessage(
        t('已从磁盘 blacklist.txt 同步回 profile {profileName}。', {
          profileName: appliedProfileName,
        }),
      );
    } catch (err) {
      setWorkspaceMessage(t('同步失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const hasRuntimeChanges = JSON.stringify(runtimeDraft) !== JSON.stringify(runtimeSettings);
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.name === selectedProfileName) ?? null,
    [profiles, selectedProfileName],
  );
  const appliedProfile = useMemo(
    () => profiles.find((profile) => profile.name === appliedProfileName) ?? null,
    [profiles, appliedProfileName],
  );
  const alwaysOnSet = useMemo(
    () => new Set(alwaysOnMods),
    [alwaysOnMods],
  );
  const modByFile = useMemo(
    () => new Map(mods.map((mod) => [mod.file, mod])),
    [mods],
  );
  const recommendationModSections = useMemo(
    () => recommendationSections.filter((section) => section.id !== 'maps'),
    [recommendationSections],
  );
  const recommendationMapSections = useMemo(
    () => recommendationSections.filter((section) => section.id === 'maps'),
    [recommendationSections],
  );
  const blacklistedNames = useMemo(
    () => new Set(selectedProfile?.mods.map((entry) => entry.name) ?? []),
    [selectedProfile],
  );
  const updateByName = useMemo(
    () => new Map(availableUpdates.map((update) => [update.name, update])),
    [availableUpdates],
  );
  const dependencyIssueByName = useMemo(
    () => new Map(dependencyIssues.map((issue) => [issue.name, issue])),
    [dependencyIssues],
  );
  const managedModGroups = useMemo(() => {
    const groupMap = new Map<string, ManagedModGroup>();
    const sortedMods = [...mods].sort((left, right) =>
      left.name.localeCompare(right.name) || left.file.localeCompare(right.file),
    );

    sortedMods.forEach((mod) => {
      const existing = groupMap.get(mod.name);
      if (existing) {
        existing.mods.push(mod);
        existing.files.push(mod.file);
        existing.totalSize += mod.size;
        existing.versions = normalizeStringList([...existing.versions, mod.version]);
        if (!existing.entryKinds.includes(mod.entryKind)) {
          existing.entryKinds.push(mod.entryKind);
        }
        return;
      }

      groupMap.set(mod.name, {
        key: mod.name,
        name: mod.name,
        displayVersion: mod.version,
        versions: [mod.version],
        mods: [mod],
        files: [mod.file],
        duplicateCount: 1,
        totalSize: mod.size,
        entryKinds: [mod.entryKind],
        enabled: alwaysOnSet.has(mod.name) || !blacklistedNames.has(mod.name),
        isAlwaysOn: alwaysOnSet.has(mod.name),
        comment: selectedGamePath
          ? modComments[getModCommentStorageId(selectedGamePath, mod.name)] ?? ''
          : '',
        dependencies: [],
        requiredBy: [],
        health: 'healthy',
        availableUpdate: updateByName.get(mod.name) ?? null,
        dependencyIssue: dependencyIssueByName.get(mod.name) ?? null,
      });
    });

    groupMap.forEach((group) => {
      group.files.sort((left, right) => left.localeCompare(right));
      group.duplicateCount = group.files.length;
      group.displayVersion = pickHighestVersion(group.versions);

      const seenDependencies = new Set<string>();
      group.mods.forEach((mod) => {
        mod.deps.forEach((dependency) => {
          const dependencyId = `${dependency.name}::${dependency.version}::${String(dependency.optional)}`;
          if (seenDependencies.has(dependencyId)) return;
          seenDependencies.add(dependencyId);

          const target = groupMap.get(dependency.name) ?? null;
          let status: DependencyHealthStatus = 'healthy';
          const installedVersion = target?.displayVersion ?? null;
          if (!target) {
            status = 'missing';
          } else if (compareVersionValues(target.displayVersion, dependency.version) < 0) {
            status = 'outdated';
          } else if (!target.enabled) {
            status = 'disabled';
          }

          group.dependencies.push({
            name: dependency.name,
            requiredVersion: dependency.version,
            optional: dependency.optional,
            status,
            installedVersion,
            targetKey: target?.key ?? null,
            duplicateCount: target?.duplicateCount ?? 0,
          });

          if (target && !dependency.optional && !target.requiredBy.includes(group.name)) {
            target.requiredBy.push(group.name);
          }
        });
      });

      group.dependencies.sort((left, right) => {
        const statusDiff =
          getDependencyHealthWeight(right.status) - getDependencyHealthWeight(left.status);
        if (statusDiff !== 0) return statusDiff;
        if (left.optional !== right.optional) return left.optional ? 1 : -1;
        return left.name.localeCompare(right.name);
      });
      group.requiredBy.sort((left, right) => left.localeCompare(right));

      group.health = group.dependencies
        .filter((dependency) => !dependency.optional)
        .reduce<DependencyHealthStatus>((current, dependency) => {
          return getDependencyHealthWeight(dependency.status) >
            getDependencyHealthWeight(current)
            ? dependency.status
            : current;
        }, 'healthy');
    });

    return [...groupMap.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [
    alwaysOnSet,
    blacklistedNames,
    dependencyIssueByName,
    modComments,
    mods,
    selectedGamePath,
    updateByName,
  ]);
  const modGroupByKey = useMemo(
    () => new Map(managedModGroups.map((modGroup) => [modGroup.key, modGroup])),
    [managedModGroups],
  );
  const installedModNameSet = useMemo(
    () => new Set(managedModGroups.map((modGroup) => modGroup.name)),
    [managedModGroups],
  );
  const filteredModGroups = useMemo(() => {
    const keyword = modFilter.trim().toLowerCase();
    if (!keyword) return managedModGroups;
    return managedModGroups.filter((mod) => {
      const haystacks = [
        mod.name,
        mod.displayVersion,
        ...mod.versions,
        ...mod.files,
        mod.comment,
        ...mod.dependencies.map((dependency) => dependency.name),
        ...mod.requiredBy,
      ];
      return haystacks.some((value) => value.toLowerCase().includes(keyword));
    });
  }, [managedModGroups, modFilter]);
  const filteredModNames = useMemo(
    () => filteredModGroups.map((mod) => mod.name),
    [filteredModGroups],
  );
  const groupedManagedModSections = useMemo(
    () => [
      {
        id: 'enabled',
        label: t('已启用'),
        items: filteredModGroups.filter((modGroup) => modGroup.enabled && modGroup.health === 'healthy'),
      },
      {
        id: 'errors',
        label: t('错误'),
        items: filteredModGroups.filter((modGroup) => modGroup.health !== 'healthy'),
      },
      {
        id: 'disabled',
        label: t('已禁用'),
        items: filteredModGroups.filter((modGroup) => !modGroup.enabled && modGroup.health === 'healthy'),
      },
    ].filter((section) => section.items.length),
    [filteredModGroups, t],
  );
  const diskDisabledFiles = useMemo(
    () => parseDisabledFiles(diskBlacklistContent),
    [diskBlacklistContent],
  );
  const expectedAppliedDisabledFiles = useMemo(
    () =>
      [...(appliedProfile?.mods
        .filter((entry) => !alwaysOnSet.has(entry.name))
        .map((entry) => entry.file) ?? [])].sort((left, right) => left.localeCompare(right)),
    [alwaysOnSet, appliedProfile],
  );
  const hasDiskBlacklistDrift =
    JSON.stringify(expectedAppliedDisabledFiles) !== JSON.stringify(diskDisabledFiles);
  const effectiveOrder = useMemo(
    () => buildEffectiveOrder(mods, selectedProfile),
    [mods, selectedProfile],
  );
  const workspaceLoaded = Boolean(selectedGamePath);
  const validInstallCount = useMemo(
    () => installs.filter((install) => install.valid).length,
    [installs],
  );
  const maintenanceTargetProfileName = selectedProfileName || appliedProfileName || null;
  const maintenanceInstallProfileBehavior: InstallProfileBehavior = maintenanceTargetProfileName
    ? 'applySelectedProfile'
    : 'keepEnabled';
  const selectedProfileDisabledCount =
    selectedProfile?.mods.filter((entry) => !alwaysOnSet.has(entry.name)).length ?? 0;
  const selectedProfileEnabledCount = Math.max(managedModGroups.length - selectedProfileDisabledCount, 0);
  const warningCount = runtimeDiagnostics?.warnings.length ?? 0;
  const duplicateModGroupCount = useMemo(
    () => managedModGroups.filter((mod) => mod.duplicateCount > 1).length,
    [managedModGroups],
  );
  const modCommentCount = useMemo(
    () => managedModGroups.filter((mod) => mod.comment.trim()).length,
    [managedModGroups],
  );
  const preferChineseMultiplayerRoute = currentLanguage === 'zh-CN' || downloadMirror === 'wegfan';
  const multiplayerRoutes = useMemo(
    () => [
      {
        id: 'miaonet',
        title: 'MiaoCelesteNet',
        modName: 'Miao.CelesteNet.Client',
        description: t('面向 celemiao 中文群服的联机客户端。'),
        detail: t('如果你打算走中文论坛注册和中文群服，这条就是主路线。'),
        downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/Miao.CelesteNet.Client',
        installed: installedModNameSet.has('Miao.CelesteNet.Client'),
        recommended: preferChineseMultiplayerRoute,
      },
      {
        id: 'celestenet',
        title: 'CelesteNet',
        modName: 'CelesteNet.Client',
        description: t('上游通用联机客户端，适合不走中文群服的时候使用。'),
        detail: t('如果你只是想保留通用 CelesteNet 兼容入口，可以装这条。'),
        downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/CelesteNet.Client',
        installed: installedModNameSet.has('CelesteNet.Client'),
        recommended: !preferChineseMultiplayerRoute,
      },
      {
        id: 'china-mirror',
        title: 'ChinaMirror',
        modName: 'ChinaMirror',
        description: t('国内环境下辅助游戏内下载与更新的镜像支持。'),
        detail: t('如果你走国内网络环境，这个辅助组件通常值得一起装。'),
        downloadUrl: 'https://celeste.weg.fan/api/v2/download/mods/ChinaMirror',
        installed: installedModNameSet.has('ChinaMirror'),
        recommended: preferChineseMultiplayerRoute,
      },
    ],
    [installedModNameSet, preferChineseMultiplayerRoute, t],
  );
  const multiplayerPrimaryRoute =
    multiplayerRoutes.find((route) => route.recommended && route.id !== 'china-mirror') ??
    multiplayerRoutes[0];
  const multiplayerSecondaryRoute =
    multiplayerRoutes.find(
      (route) => route.id !== multiplayerPrimaryRoute?.id && route.id !== 'china-mirror',
    ) ?? null;
  const multiplayerHelperRoute =
    multiplayerRoutes.find((route) => route.id === 'china-mirror') ?? null;
  const availableOnlineCategories = useMemo(() => {
    const extraCategories = new Set<string>();
    onlineSearchResult?.content.forEach((onlineMod) => {
      const category = normalizeOnlineCategoryValue(onlineMod.categoryName);
      if (category && !ONLINE_CATEGORY_OPTION_BY_NAME.has(category)) {
        extraCategories.add(category);
      }
    });
    if (onlineCategoryFilter && !ONLINE_CATEGORY_OPTION_BY_NAME.has(onlineCategoryFilter)) {
      extraCategories.add(onlineCategoryFilter);
    }
    return [
      ...ONLINE_CATEGORY_OPTIONS.map((option) => option.value),
      ...[...extraCategories].sort((left, right) => left.localeCompare(right)),
    ];
  }, [onlineCategoryFilter, onlineSearchResult]);
  const visibleOnlineMods = useMemo(() => {
    const content = onlineSearchResult?.content ?? [];
    if (!onlineCategoryFilter) return content;
    return content.filter(
      (onlineMod) =>
        normalizeOnlineCategoryValue(onlineMod.categoryName) ===
        normalizeOnlineCategoryValue(onlineCategoryFilter),
    );
  }, [onlineCategoryFilter, onlineSearchResult]);
  const everestReleasesByBranch = useMemo(() => {
    const releases = everestVersions ?? [];
    const sortByVersion = (left: EverestRelease, right: EverestRelease) => right.version - left.version;
    return {
      stable: releases.filter((release) => release.branch === 'stable').sort(sortByVersion).slice(0, 6),
      beta: releases.filter((release) => release.branch === 'beta').sort(sortByVersion).slice(0, 6),
      dev: releases.filter((release) => release.branch === 'dev').sort(sortByVersion).slice(0, 6),
    };
  }, [everestVersions]);
  const latestInstallTask = installTasks[0] ?? null;
  const runningInstallTaskCount = installTasks.filter((task) => task.status === 'running').length;
  const succeededInstallTaskCount = installTasks.filter((task) => task.status === 'succeeded').length;
  const failedInstallTaskCount = installTasks.filter((task) => task.status === 'failed').length;
  const finishedInstallTaskCount = installTasks.filter((task) => task.status !== 'running').length;
  const runningTasks = installTasks.filter((task) => task.status === 'running');
  const maintenanceTasks = installTasks.filter((task) => task.source === 'manage').slice(0, 4);
  const completedTasks = installTasks.filter((task) => task.status !== 'running').slice(0, 6);
  const latestStableEverestRelease = everestReleasesByBranch.stable[0] ?? null;
  const navigationItems = [
    { id: 'home' as const, label: t('主页'), hint: t('Home'), symbol: 'HM' },
    { id: 'everest' as const, label: 'Everest', hint: 'Loader', symbol: 'EV' },
    { id: 'search' as const, label: t('搜索'), hint: t('Search'), symbol: 'SR' },
    { id: 'manage' as const, label: t('管理'), hint: t('Manage'), symbol: 'MG' },
    { id: 'multiplayer' as const, label: t('联机相关'), hint: t('Multiplayer'), symbol: 'MP' },
    { id: 'recommendMods' as const, label: t('模组'), hint: t('Mods'), symbol: 'RM' },
    { id: 'recommendMaps' as const, label: t('地图'), hint: t('Maps'), symbol: 'RP' },
  ];
  const currentPageMeta =
    navigationItems.find((item) => item.id === activePage) ?? navigationItems[0];
  const primaryTopbarItems = navigationItems.filter((item) =>
    item.id === 'home' || item.id === 'search' || item.id === 'manage',
  );
  const homeFocusProfile = selectedProfile ?? appliedProfile ?? null;
  const homeFocusProfileDisabledCount =
    homeFocusProfile?.mods.filter((entry) => !alwaysOnSet.has(entry.name)).length ?? 0;
  const homeFocusProfileAlwaysOnCount =
    homeFocusProfile?.mods.filter((entry) => alwaysOnSet.has(entry.name)).length ?? 0;
  const homeFocusProfileEnabledCount = Math.max(
    managedModGroups.length - homeFocusProfileDisabledCount,
    0,
  );
  const recentHomeTasks = installTasks.slice(0, 4);
  const handleGlobalSearchSubmit = () => {
    setActivePage('search');
    void searchOnlineMods(1);
  };
  const featuredRecommendedModSection = recommendationModSections[0] ?? null;
  const recommendationModHeroItems = featuredRecommendedModSection?.mods.slice(0, 3) ?? [];
  const featuredRecommendedMap = recommendationMapSections[0]?.mods[0] ?? null;

  useEffect(() => {
    if (!selectedOnlineMod) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedOnlineMod(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedOnlineMod]);

  useEffect(() => {
    if (!installTaskPanelOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setInstallTaskPanelOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [installTaskPanelOpen]);

  useEffect(() => {
    setSelectedOnlineMod(null);
    setOnlineSearchResult(null);
    setOnlinePage(1);
    if (selectedGamePath) {
      void loadWorkspaceMaintenance(selectedGamePath);
    }
  }, [downloadMirror]);

  const selectedOnlineModDescriptionHtml = useMemo(
    () => (selectedOnlineMod ? sanitizeDescriptionHtml(selectedOnlineMod.description) : ''),
    [selectedOnlineMod],
  );

  const saveModOptionsOrder = async (order: string[]) => {
    if (!selectedGamePath || !selectedProfileName) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      await invoke('set_mod_options_order', {
        gamePath: selectedGamePath,
        profileName: selectedProfileName,
        order,
      });
      setProfiles((current) =>
        current.map((profile) =>
          profile.name === selectedProfileName ? { ...profile, modOptionsOrder: order } : profile,
        ),
      );
      setWorkspaceMessage(
        order.length
          ? t('已更新 {profileName} 的 modoptionsorder。', { profileName: selectedProfileName })
          : t('已清空 {profileName} 的 modoptionsorder，将回退到字母序。', {
              profileName: selectedProfileName,
            }),
      );
    } catch (err) {
      setWorkspaceMessage(t('顺序更新失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const moveOrderItem = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= effectiveOrder.length) return;
    const next = [...effectiveOrder];
    [next[index], next[target]] = [next[target], next[index]];
    await saveModOptionsOrder(next);
  };

  const moveOrderItemToTop = async (index: number) => {
    if (index <= 0) return;
    const next = [...effectiveOrder];
    const [item] = next.splice(index, 1);
    next.unshift(item);
    await saveModOptionsOrder(next);
  };

  const clearModOptionsOrder = async () => {
    await saveModOptionsOrder([]);
  };

  const pushInstallTask = (
    source: InstallTask['source'],
    title: string,
    message: string,
  ) => {
    installTaskCounter.current += 1;
    const id = `install-task-${installTaskCounter.current}`;
    const task: InstallTask = {
      id,
      source,
      title,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      message,
    };
    setSelectedOnlineMod(null);
    setInstallTaskPanelOpen(true);
    setInstallTasks((current) => [task, ...current].slice(0, 16));
    return id;
  };

  const updateInstallTask = (
    id: string,
    patch: Partial<InstallTask>,
  ) => {
    if (patch.status === 'failed') {
      setInstallTaskPanelOpen(true);
    }
    setInstallTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    );
  };

  const clearFinishedInstallTasks = () => {
    setInstallTasks((current) => current.filter((task) => task.status === 'running'));
  };

  const performInstallFromUrl = async (
    url: string,
    source: InstallTask['source'],
    title: string,
  ) => {
    if (!selectedGamePath || !url.trim()) return;
    const taskId = pushInstallTask(source, title, t('正在下载并校验模组包...'));
    try {
      const result = await invoke<InstallModResult>('install_mod_from_url', {
        gamePath: selectedGamePath,
        url: url.trim(),
        installProfileBehavior,
        selectedProfileName: selectedProfileName || null,
        installDependencies,
        alwaysOnMods,
        downloadMirror,
      });
      const preferredProfileName = result.appliedProfile || selectedProfileName || undefined;
      setInstallResult(result);
      await fetchWorkspace(selectedGamePath, preferredProfileName);
      setWorkspaceMessage(
        t('已安装 {modName} {version}。', {
          modName: result.installedMod.name,
          version: result.installedMod.version,
        }) +
          ' ' +
          summarizeInstallProfileOutcome(result, t) +
          (result.dependencyResults.length
            ? ` ${t('依赖处理 {count} 项。', { count: result.dependencyResults.length })}`
            : ''),
      );
      updateInstallTask(taskId, {
        status: 'succeeded',
        finishedAt: Date.now(),
        message: t('安装完成，主模组 {modName} v{version}，策略：{strategy}{dependencySuffix}', {
          modName: result.installedMod.name,
          version: result.installedMod.version,
          strategy: getInstallProfileBehaviorLabel(result.installProfileBehavior, t),
          dependencySuffix: result.dependencyResults.length
            ? t('，依赖处理 {count} 项', { count: result.dependencyResults.length })
            : '',
        }),
      });
      return result;
    } catch (err) {
      updateInstallTask(taskId, {
        status: 'failed',
        finishedAt: Date.now(),
        message: t('安装失败: {error}', { error: String(err) }),
      });
      throw err;
    }
  };

  const runInstallFromUrl = async (
    url: string,
    source: InstallTask['source'],
    title: string,
  ) => {
    if (!selectedGamePath || !url.trim()) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      await performInstallFromUrl(url, source, title);
    } catch (err) {
      setWorkspaceMessage(t('安装失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const installModFromUrl = async () => {
    await runInstallFromUrl(installUrl, 'manual', t('手动 URL 安装'));
  };

  const searchOnlineMods = async (
    page = 1,
    categoryFilter = onlineCategoryFilter,
  ) => {
    setOnlineLoading(true);
    try {
      const result = await invoke<OnlineModSearchResult>('search_online_mods', {
        params: {
          page,
          size: 10,
          query: onlineQuery,
          sort: onlineSort,
          categoryId: getOnlineCategoryId(categoryFilter),
          downloadMirror,
        },
      });
      setOnlineSearchResult(result);
      setOnlinePage(result.currentPage);
    } catch (err) {
      setWorkspaceMessage(t('在线搜索失败: {error}', { error: String(err) }));
    } finally {
      setOnlineLoading(false);
    }
  };

  const loadEverestVersions = async () => {
    setEverestLoading(true);
    setEverestMessage('');
    try {
      const response = await fetch(
        'https://maddie480.ovh/celeste/everest-versions?supportsNativeBuilds=true',
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const releases = (await response.json()) as EverestRelease[];
      setEverestVersions(releases.filter((release) => release.isNative));
    } catch (err) {
      setEverestMessage(t('载入 Everest 列表失败: {error}', { error: String(err) }));
    } finally {
      setEverestLoading(false);
    }
  };

  const getEverestDownloadUrl = (release: EverestRelease) => {
    if (release.branch === 'stable' && downloadMirror === 'wegfan') {
      return `https://celeste.weg.fan/api/v2/download/everest/${release.version}`;
    }
    return release.mainDownload;
  };

  const installEverest = async (release: EverestRelease) => {
    if (!selectedGamePath) {
      setEverestMessage(t('先载入一个游戏目录，再安装 Everest。'));
      setActivePage('home');
      return;
    }

    setWorkspaceBusy(true);
    setEverestInstallBusy(true);
    setEverestMessage(t('正在下载并安装 Everest...'));
    try {
      const installedVersion = await invoke<number | null>('download_and_install_everest', {
        gamePath: selectedGamePath,
        url: getEverestDownloadUrl(release),
      });
      await fetchWorkspace(selectedGamePath, selectedProfileName || appliedProfileName || undefined);
      setEverestMessage(
        installedVersion
          ? t('已安装 Everest，当前检测版本 {version}。', { version: installedVersion })
          : t('安装成功，但暂未重新读到 Everest 版本号。'),
      );
    } catch (err) {
      setEverestMessage(t('安装 Everest 失败: {error}', { error: String(err) }));
    } finally {
      setEverestInstallBusy(false);
      setWorkspaceBusy(false);
    }
  };

  const applyOnlineCategoryFilter = (nextCategory: string) => {
    const normalizedCategory = normalizeOnlineCategoryValue(nextCategory);
    setOnlineCategoryFilter(normalizedCategory);
    setOnlinePage(1);
    if (onlineSearchResult) {
      void searchOnlineMods(1, normalizedCategory);
    }
  };

  useEffect(() => {
    if (activePage !== 'everest' || everestVersions !== null || everestLoading) return;
    void loadEverestVersions();
  }, [activePage, everestLoading, everestVersions]);

  const installRecommendedMods = async (modsToInstall: RecommendedMod[]) => {
    if (!selectedGamePath) return;
    const pending = modsToInstall.filter(
      (recommendedMod) => !mods.some((installedMod) => installedMod.name === recommendedMod.name),
    );
    if (!pending.length) {
      setRecommendationMessage(t('当前这一组推荐模组都已经安装。'));
      return;
    }

    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    setRecommendationMessage('');

    let successCount = 0;
    const failedMods: string[] = [];

    for (let index = 0; index < pending.length; index += 1) {
      const recommendedMod = pending[index];
      setRecommendationMessage(
        t('正在安装 {modName} ({index}/{total})...', {
          modName: recommendedMod.name,
          index: index + 1,
          total: pending.length,
        }),
      );
      try {
        await performInstallFromUrl(
          recommendedMod.downloadUrl,
          'recommendation',
          t('推荐安装: {modName}', { modName: recommendedMod.name }),
        );
        successCount += 1;
      } catch (error) {
        failedMods.push(t('{modName}: {error}', { modName: recommendedMod.name, error: String(error) }));
      }
    }

    setWorkspaceBusy(false);

    setRecommendationMessage(
      failedMods.length
        ? t('推荐安装完成：成功 {successCount}，失败 {failedCount}。{details}', {
            successCount,
            failedCount: failedMods.length,
            details: failedMods.join(' / '),
          })
        : t('推荐安装完成：成功安装 {count} 项。', { count: successCount }),
    );
  };

  const toggleDeletionSelection = (modName: string) => {
    setSelectedDeletionMods((current) =>
      current.includes(modName)
        ? current.filter((name) => name !== modName)
        : [...current, modName],
    );
  };

  const setModComment = (modName: string, value: string) => {
    if (!selectedGamePath) return;
    const storageId = getModCommentStorageId(selectedGamePath, modName);
    setModComments((current) => {
      const next = { ...current };
      if (value.trim()) {
        next[storageId] = value;
      } else {
        delete next[storageId];
      }
      return next;
    });
  };

  const selectAllFilteredMods = () => {
    setSelectedDeletionMods((current) => {
      const next = new Set(current);
      filteredModNames.forEach((name) => next.add(name));
      return [...next];
    });
  };

  const clearDeletionSelection = () => {
    setSelectedDeletionMods([]);
  };

  const deleteModsByName = async (modNames: string[]) => {
    if (!selectedGamePath || !modNames.length) return;
    const summary = modNames.length === 1 ? modNames[0] : t('{count} 个模组', { count: modNames.length });
    if (!window.confirm(t('确定删除 {summary} 吗？', { summary }))) return;

    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      const result = await invoke<DeleteModsResult>('delete_mods', {
        gamePath: selectedGamePath,
        modNames,
        alwaysOnMods,
      });
      setSelectedDeletionMods((current) =>
        current.filter((name) => !result.removedModNames.includes(name)),
      );
      await fetchWorkspace(selectedGamePath, selectedProfileName);
      setWorkspaceMessage(
        t('已删除 {removedNames}。', { removedNames: result.removedModNames.join(', ') }) +
          (result.updatedProfiles.length
            ? ` ${t('已同步清理 {count} 个 profile。', { count: result.updatedProfiles.length })}`
            : ''),
      );
    } catch (err) {
      setWorkspaceMessage(t('删除失败: {error}', { error: String(err) }));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const openManualInstaller = (url: string) => {
    setInstallUrl(url);
    setActivePage('search');
  };

  const renderMapRecommendationBlocks = (
    sections: typeof recommendationMapSections,
    title: string,
    description: string,
  ) => (
    <section className="panel map-recommend-panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p className="muted">{description}</p>
        </div>
        <span className="pill">{t('{count} 个分区', { count: sections.length })}</span>
      </div>

      {!selectedGamePath ? (
        <p className="muted">{t('先载入一个游戏目录，再使用推荐安装。')}</p>
      ) : (
        <>
          {sections.map((section) => {
            const installableMods = section.mods.filter((item) => item.batchInstall !== false);
            const installedCount = section.mods.filter((item) =>
              mods.some((installedMod) => installedMod.name === item.name),
            ).length;
            const [featuredMap, ...otherMaps] = section.mods;

            return (
              <article key={section.id} className="recommend-section map-recommend-section">
                <div className="panel-head">
                  <div>
                    <h3>{section.title}</h3>
                    <p className="muted">{section.description}</p>
                  </div>
                  <div className="tag-row">
                    <span className="pill">
                      {t('{installedCount}/{totalCount} 已安装', {
                        installedCount,
                        totalCount: section.mods.length,
                      })}
                    </span>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void installRecommendedMods(installableMods)}
                      disabled={workspaceBusy || !installableMods.length}
                    >
                      {t('批量安装可批量项')}
                    </button>
                  </div>
                </div>

                {featuredMap ? (
                  <article className="map-feature-card">
                    <div
                      className="map-feature-cover"
                      style={{
                        backgroundImage: featuredMap.coverImage
                          ? `linear-gradient(180deg, rgba(8, 9, 15, 0.12), rgba(8, 9, 15, 0.86)), url(${featuredMap.coverImage})`
                          : undefined,
                        backgroundPosition: featuredMap.coverPosition ?? 'center center',
                      }}
                    >
                      <div className="map-feature-copy">
                        <span className="eyebrow">{section.title}</span>
                        <h4>{featuredMap.displayName ?? featuredMap.name}</h4>
                        {featuredMap.alias ? (
                          <p className="map-feature-alias">
                            {t('别名')}
                            {' · '}
                            {featuredMap.alias}
                          </p>
                        ) : null}
                        {featuredMap.highlight ? (
                          <p className="map-feature-highlight">{featuredMap.highlight}</p>
                        ) : null}
                        <p className="map-feature-description">{featuredMap.description}</p>
                        {featuredMap.metrics?.length ? (
                          <div className="map-metric-row">
                            {featuredMap.metrics.map((metric) => (
                              <article key={`${featuredMap.name}-${metric.label}`} className="map-metric-card">
                                <span>{metric.label}</span>
                                <strong>{metric.value}</strong>
                              </article>
                            ))}
                          </div>
                        ) : null}
                        {featuredMap.highlights?.length ? (
                          <ul className="map-highlight-list">
                            {featuredMap.highlights.map((highlight) => (
                              <li key={highlight}>{highlight}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                    <div className="map-feature-actions">
                      <div className="tag-row">
                        <span
                          className={`pill ${mods.some((installedMod) => installedMod.name === featuredMap.name) ? 'solid' : ''}`}
                        >
                          {mods.some((installedMod) => installedMod.name === featuredMap.name)
                            ? t('已安装')
                            : t('未安装')}
                        </span>
                        {featuredMap.batchInstall === false ? (
                          <span className="pill">{t('仅单装')}</span>
                        ) : null}
                      </div>
                      <div className="action-row compact-row">
                        <button
                          type="button"
                          onClick={() =>
                            void runInstallFromUrl(
                              featuredMap.downloadUrl,
                              'recommendation',
                              t('推荐安装: {modName}', { modName: featuredMap.name }),
                            )
                          }
                          disabled={workspaceBusy}
                        >
                          {t('安装此项')}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => openManualInstaller(featuredMap.downloadUrl)}
                          disabled={workspaceBusy}
                        >
                          {t('填入手动安装器')}
                        </button>
                      </div>
                    </div>
                  </article>
                ) : null}

                {otherMaps.length ? (
                  <div className="map-card-grid">
                    {otherMaps.map((item) => {
                      const installed = mods.some((installedMod) => installedMod.name === item.name);
                      return (
                        <article key={item.name} className="map-card">
                          <div
                            className="map-card-cover"
                            style={{
                              backgroundImage: item.coverImage
                                ? `linear-gradient(180deg, rgba(10, 10, 16, 0.12), rgba(10, 10, 16, 0.88)), url(${item.coverImage})`
                                : undefined,
                              backgroundPosition: item.coverPosition ?? 'center center',
                            }}
                          >
                            <span className="pill">{item.alias ?? (item.displayName ?? item.name)}</span>
                          </div>
                          <div className="map-card-body">
                            <div className="panel-head">
                              <div>
                                <h4>{item.displayName ?? item.name}</h4>
                                <p className="muted">{item.highlight ?? item.description}</p>
                              </div>
                              <span className={`pill ${installed ? 'solid' : ''}`}>
                                {installed ? t('已安装') : t('未安装')}
                              </span>
                            </div>
                            {item.metrics?.length ? (
                              <div className="map-inline-metrics">
                                {item.metrics.map((metric) => (
                                  <span key={`${item.name}-${metric.label}`} className="map-inline-metric">
                                    <strong>{metric.value}</strong>
                                    <small>{metric.label}</small>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {item.highlights?.length ? (
                              <ul className="map-highlight-list compact">
                                {item.highlights.slice(0, 2).map((highlight) => (
                                  <li key={highlight}>{highlight}</li>
                                ))}
                              </ul>
                            ) : null}
                            <div className="action-row compact-row">
                              <button
                                type="button"
                                onClick={() =>
                                  void runInstallFromUrl(
                                    item.downloadUrl,
                                    'recommendation',
                                    t('推荐安装: {modName}', { modName: item.name }),
                                  )
                                }
                                disabled={workspaceBusy}
                              >
                                {t('安装此项')}
                              </button>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => openManualInstaller(item.downloadUrl)}
                                disabled={workspaceBusy}
                              >
                                {t('填入手动安装器')}
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}

          {recommendationMessage ? <p className="verify-result">{recommendationMessage}</p> : null}
        </>
      )}
    </section>
  );

  const renderRecommendationBlocks = (
    sections: typeof recommendationSections,
    title: string,
    description: string,
  ) => (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p className="muted">{description}</p>
        </div>
        <span className="pill">{t('{count} 个分区', { count: sections.length })}</span>
      </div>

      {!selectedGamePath ? (
        <p className="muted">{t('先载入一个游戏目录，再使用推荐安装。')}</p>
      ) : (
        <>
          {sections.map((section) => {
            const installableMods = section.mods.filter((item) => item.batchInstall !== false);
            const installedCount = section.mods.filter((item) =>
              mods.some((installedMod) => installedMod.name === item.name),
            ).length;

            return (
              <article key={section.id} className="recommend-section">
                <div className="panel-head">
                  <div>
                    <h3>{section.title}</h3>
                    <p className="muted">{section.description}</p>
                  </div>
                  <div className="tag-row">
                    <span className="pill">
                      {t('{installedCount}/{totalCount} 已安装', {
                        installedCount,
                        totalCount: section.mods.length,
                      })}
                    </span>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void installRecommendedMods(installableMods)}
                      disabled={workspaceBusy || !installableMods.length}
                    >
                      {t('批量安装可批量项')}
                    </button>
                  </div>
                </div>

                <div className="recommend-grid">
                  {section.mods.map((item) => {
                    const installed = mods.some((installedMod) => installedMod.name === item.name);
                    const displayName = item.displayName ?? item.name;
                    return (
                      <article key={item.name} className="recommend-card">
                        <div className="panel-head">
                          <div>
                            <h4>{displayName}</h4>
                            <p className="muted">{item.description}</p>
                          </div>
                          <div className="tag-row">
                            <span className={`pill ${installed ? 'solid' : ''}`}>
                              {installed ? t('已安装') : t('未安装')}
                            </span>
                            {item.batchInstall === false ? (
                              <span className="pill">{t('仅单装')}</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="action-row compact-row">
                          <button
                            type="button"
                            onClick={() =>
                              void runInstallFromUrl(
                                item.downloadUrl,
                                'recommendation',
                                t('推荐安装: {modName}', { modName: displayName }),
                              )
                            }
                            disabled={workspaceBusy}
                          >
                            {t('安装此项')}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => openManualInstaller(item.downloadUrl)}
                            disabled={workspaceBusy}
                          >
                            {t('填入手动安装器')}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </article>
            );
          })}

          {recommendationMessage ? <p className="verify-result">{recommendationMessage}</p> : null}
        </>
      )}
    </section>
  );

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">CM</div>
          <div className="brand-copy">
            <strong>CeleMod</strong>
            <span>{t('Wayland Native')}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navigationItems.map((page) => (
            <button
              key={page.id}
              type="button"
              className={`nav-button ${activePage === page.id ? 'active' : ''}`}
              onClick={() => setActivePage(page.id)}
            >
              <span className="nav-symbol">{page.symbol}</span>
              <span className="nav-label">{page.label}</span>
              <span className="nav-hint">{page.hint}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className={`pill ${selectedGamePath ? 'solid' : ''}`}>
            {selectedGamePath ? t('工作区已载入') : t('未载入目录')}
          </span>
          <span className={`pill ${failedInstallTaskCount ? 'warn' : runningInstallTaskCount ? 'solid' : ''}`}>
            {runningInstallTaskCount
              ? t('{count} 进行中', { count: runningInstallTaskCount })
              : failedInstallTaskCount
                ? t('{count} 失败', { count: failedInstallTaskCount })
                : installTasks.length
                  ? t('{count} 记录', { count: installTasks.length })
                  : t('暂无任务')}
          </span>
          <span className="muted">
            {appInfo?.version ? `v${appInfo.version}` : t('读取版本中')}
          </span>
        </div>
      </aside>

      <div className="page-shell">
        <header className="shell-topbar">
          <div className="shell-topbar-main">
            <div className="topbar-title-group">
              <span className="topbar-kicker">MOD ARCHITECT</span>
              <div className="topbar-title-copy">
                <strong>{currentPageMeta.label}</strong>
                <span>{currentPageMeta.hint}</span>
              </div>
            </div>

            <nav className="topbar-tabs">
              {primaryTopbarItems.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className={`topbar-tab ${activePage === page.id ? 'active' : ''}`}
                  onClick={() => setActivePage(page.id)}
                >
                  {page.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="topbar-tools">
            <label className="topbar-search">
              <input
                type="search"
                placeholder={t('输入名称或关键字')}
                value={onlineQuery}
                onInput={(event) => setOnlineQuery((event.currentTarget as HTMLInputElement).value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleGlobalSearchSubmit();
                  }
                }}
              />
            </label>

            <button
              type="button"
              className="ghost-button topbar-utility-button"
              onClick={() => setInstallTaskPanelOpen(true)}
            >
              {t('任务')}
            </button>
            <button
              type="button"
              className="ghost-button topbar-utility-button"
              onClick={() => {
                setActivePage('manage');
                if (selectedGamePath) {
                  void loadWorkspaceMaintenance(selectedGamePath);
                }
              }}
              disabled={!workspaceLoaded || workspaceBusy}
            >
              {t('更新检测')}
            </button>
            <button
              type="button"
              onClick={handleGlobalSearchSubmit}
              disabled={onlineLoading}
            >
              {t('搜索')}
            </button>
          </div>
        </header>

        <div className="page-content">
        {activePage === 'home' ? (
          <>
            <section className="hero home-hero">
              <div className="hero-grid home-hero-grid">
                <div className="hero-copy-block">
                  <p className="eyebrow">{workspaceLoaded ? t('工作区已就绪') : t('等待目录')}</p>
                  <h1>{t('欢迎回来，{name}', { name: selectedProfileName || appliedProfileName || 'Climber' })}</h1>
                  <p className="lede">
                    {workspaceLoaded
                      ? t('当前工作区已经同步目录、Everest 与 profile。可以直接启动游戏，或者继续处理安装和维护任务。')
                      : t('先锁定 Celeste 目录，再把搜索、管理和 profile 工作流接回同一块桌面。')}
                  </p>
                  <div className="hero-chip-row">
                    <span className={`pill ${workspaceLoaded ? 'solid' : ''}`}>
                      {workspaceLoaded ? t('工作区已载入') : t('未载入目录')}
                    </span>
                    <span className={`pill ${warningCount ? 'warn' : ''}`}>
                      {warningCount ? t('{count} Warnings', { count: warningCount }) : t('Healthy')}
                    </span>
                    <span className="pill">{getDownloadMirrorLabel(downloadMirror, t)}</span>
                    <span className="pill">
                      {languageOptions.find((option) => option.code === currentLanguage)?.label ?? currentLanguage}
                    </span>
                  </div>
                  <div className="action-row hero-actions">
                    <button
                      type="button"
                      onClick={() => void startGame()}
                      disabled={!workspaceLoaded || workspaceBusy}
                    >
                      {t('启动游戏')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void openModsFolder()}
                      disabled={!workspaceLoaded || workspaceBusy}
                    >
                      {t('打开 Mods 文件夹')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivePage('search')}
                      disabled={!workspaceLoaded || workspaceBusy}
                    >
                      {t('搜索模组')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setActivePage('multiplayer')}
                      disabled={workspaceBusy}
                    >
                      {t('联机相关')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivePage('manage')}
                      disabled={!workspaceLoaded || workspaceBusy}
                    >
                      {t('管理本地 Mod')}
                    </button>
                  </div>
                </div>

                <div className="hero-summary-grid">
                  <article className="hero-summary-card">
                    <span className="hero-summary-label">{t('工作区')}</span>
                    <strong>{workspaceLoaded ? t('已载入') : t('未载入')}</strong>
                    <small>{workspaceLoaded ? t('目录、Mod 和 profile 已联动') : t('请先载入 Celeste 目录')}</small>
                  </article>
                  <article className="hero-summary-card">
                    <span className="hero-summary-label">{t('Celeste 目录')}</span>
                    <strong>{validInstallCount}</strong>
                    <small>{summary}</small>
                  </article>
                  <article className="hero-summary-card">
                    <span className="hero-summary-label">{t('已装 Mod')}</span>
                    <strong>{managedModGroups.length}</strong>
                    <small>
                      {selectedProfileName
                        ? t('{profileName} 当前启用 {enabledCount}', {
                            profileName: selectedProfileName,
                            enabledCount: selectedProfileEnabledCount,
                          })
                        : t('等待 profile')}
                    </small>
                  </article>
                  <article className="hero-summary-card">
                    <span className="hero-summary-label">{t('运行警告')}</span>
                    <strong>{warningCount}</strong>
                    <small>{warningCount ? t('Wayland 诊断有待处理项') : t('当前未发现额外警告')}</small>
                  </article>
                </div>
              </div>
            </section>

            <section className="home-dashboard">
              <div className="home-focus-column">
                <article className="panel home-focus-card">
                  <div className="panel-head">
                    <div>
                      <h2>{t('Celeste 目录与工作区')}</h2>
                      <p className="muted">
                        {selectedGamePath || t('未载入时仍可先在下方控制台输入目录。')}
                      </p>
                    </div>
                    <span className={`pill ${workspaceLoaded ? 'solid' : ''}`}>
                      {workspaceLoaded ? t('工作区已就绪') : t('等待目录')}
                    </span>
                  </div>

                  <div className="focus-stat-grid">
                    <article className="focus-stat-card">
                      <span>{t('Game Path')}</span>
                      <strong>{selectedGamePath || t('未载入')}</strong>
                    </article>
                    <article className="focus-stat-card">
                      <span>{t('Everest')}</span>
                      <strong>
                        {selectedEverestVersion
                          ? t('Build {version}', { version: selectedEverestVersion })
                          : t('未检测到')}
                      </strong>
                    </article>
                    <article className="focus-stat-card">
                      <span>{t('Applied Profile')}</span>
                      <strong>{appliedProfileName || t('Default')}</strong>
                    </article>
                  </div>

                  <div className="action-row compact-row">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void refreshWorkspace()}
                      disabled={!workspaceLoaded || workspaceBusy}
                    >
                      {t('刷新工作区')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setActivePage('everest')}
                      disabled={workspaceBusy}
                    >
                      Everest
                    </button>
                  </div>
                </article>

                <article className="panel accent home-focus-card profile-spotlight">
                  <div className="panel-head">
                    <div>
                      <h2>{t('Profiles')}</h2>
                      <p className="muted">
                        {homeFocusProfile
                          ? homeFocusProfile.name
                          : t('先载入一个游戏目录，再读取 profile 列表。')}
                      </p>
                    </div>
                    {homeFocusProfile ? (
                      <span className="pill solid">{homeFocusProfile.name.slice(0, 2).toUpperCase()}</span>
                    ) : (
                      <span className="pill">{t('等待 profile')}</span>
                    )}
                  </div>

                  {homeFocusProfile ? (
                    <>
                      <div className="profile-spotlight-main">
                        <div className="profile-avatar">{homeFocusProfile.name.slice(0, 2).toUpperCase()}</div>
                        <div className="profile-spotlight-copy">
                          <strong>{homeFocusProfile.name}</strong>
                          <p className="muted">
                            {homeFocusProfile.name === appliedProfileName ? t('当前磁盘已应用') : t('仅在内存中查看')}
                            {homeFocusProfile.name === selectedProfileName ? t(' · 当前选中') : ''}
                          </p>
                        </div>
                      </div>

                      <div className="focus-stat-grid">
                        <article className="focus-stat-card">
                          <span>{t('启用')}</span>
                          <strong>{homeFocusProfileEnabledCount}</strong>
                        </article>
                        <article className="focus-stat-card">
                          <span>{t('禁用')}</span>
                          <strong>{homeFocusProfileDisabledCount}</strong>
                        </article>
                        <article className="focus-stat-card">
                          <span>Always On</span>
                          <strong>{homeFocusProfileAlwaysOnCount}</strong>
                        </article>
                      </div>

                      <div className="action-row compact-row">
                        <button
                          type="button"
                          onClick={() => setActivePage('manage')}
                          disabled={!workspaceLoaded || workspaceBusy}
                        >
                          {t('管理本地 Mod')}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void applyProfile(homeFocusProfile.name)}
                          disabled={workspaceBusy || homeFocusProfile.name === appliedProfileName}
                        >
                          {homeFocusProfile.name === appliedProfileName ? t('已应用到磁盘') : t('应用到磁盘')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="muted">{t('当前目录还没有可用 profile。')}</p>
                  )}
                </article>
              </div>

              <div className="home-flow-column">
                <div className="home-quick-grid">
                  <button
                    type="button"
                    className="home-quick-card"
                    onClick={() => setActivePage('search')}
                    disabled={!workspaceLoaded || workspaceBusy}
                  >
                    <span className="home-quick-symbol">SR</span>
                    <span className="home-quick-copy">
                      <strong>{t('搜索模组')}</strong>
                      <small>ONLINE INSTALLER</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="home-quick-card"
                    onClick={() => setActivePage('everest')}
                    disabled={workspaceBusy}
                  >
                    <span className="home-quick-symbol">EV</span>
                    <span className="home-quick-copy">
                      <strong>Everest</strong>
                      <small>STABLE / BETA / DEV</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="home-quick-card"
                    onClick={() => setInstallTaskPanelOpen(true)}
                  >
                    <span className="home-quick-symbol">TS</span>
                    <span className="home-quick-copy">
                      <strong>{t('Install Tasks')}</strong>
                      <small>GLOBAL TRACKER</small>
                    </span>
                  </button>
                </div>

                <article className="panel activity-panel">
                  <div className="panel-head">
                    <div>
                      <h2>{t('最近已完成的安装或维护')}</h2>
                      <p className="muted">
                        {t('任务记录现在独立成全局浮层，Home / Search / Manage 都能打开查看。')}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setInstallTaskPanelOpen(true)}
                    >
                      {t('查看记录')}
                    </button>
                  </div>

                  {recentHomeTasks.length ? (
                    <div className="activity-table">
                      <div className="activity-table-head">
                        <span>{t('任务')}</span>
                        <span>{t('版本')}</span>
                        <span>{t('状态')}</span>
                        <span>{t('时间')}</span>
                      </div>
                      {recentHomeTasks.map((task) => (
                        <article key={task.id} className="activity-row">
                          <div className="activity-main">
                            <span className="activity-badge">
                              {getTaskMonogram(task.title, getInstallTaskSourceLabel(task.source, t))}
                            </span>
                            <div>
                              <strong>{task.title}</strong>
                              <p className="muted">{getInstallTaskSourceLabel(task.source, t)}</p>
                            </div>
                          </div>
                          <span className="activity-version">
                            {task.message.match(/v[\w.\-]+/)?.[0] ?? '...'}
                          </span>
                          <span
                            className={`pill ${task.status === 'succeeded' ? 'solid' : task.status === 'failed' ? 'warn' : ''}`}
                          >
                            {getInstallTaskStatusLabel(task.status, t)}
                          </span>
                          <span className="activity-time">
                            {formatRelativeTimestamp(task.finishedAt ?? task.startedAt, currentLanguage)}
                          </span>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="activity-empty-grid">
                      <article className="focus-stat-card">
                        <span>{t('更新检测')}</span>
                        <strong>{availableUpdates.length}</strong>
                        <small className="muted">
                          {availableUpdates.length
                            ? t('当前发现 {count} 个可更新 Mod。', { count: availableUpdates.length })
                            : t('当前没有检测到可更新的 Mod。')}
                        </small>
                      </article>
                      <article className="focus-stat-card">
                        <span>{t('依赖补全')}</span>
                        <strong>{dependencyIssues.length}</strong>
                        <small className="muted">
                          {dependencyIssues.length
                            ? t('当前发现 {count} 项依赖问题。', { count: dependencyIssues.length })
                            : t('当前没有检测到缺失依赖。')}
                        </small>
                      </article>
                      <article className="focus-stat-card">
                        <span>{t('Warnings')}</span>
                        <strong>{warningCount}</strong>
                        <small className="muted">
                          {warningCount ? t('Wayland 诊断有待处理项') : t('当前没有检测到额外运行时警告。')}
                        </small>
                      </article>
                    </div>
                  )}
                </article>
              </div>
            </section>

            <section className="home-layout home-lower-layout">
              <div className="home-main">
                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>{t('Celeste 目录与工作区')}</h2>
                      <p className="muted">
                        {t('这里填写的是 Celeste 安装目录，不是单独的 Everest 路径。Everest 安装后会直接落在同一目录里，所以版本探测、启动和 Mod 管理都仍然以这个目录为准。')}
                      </p>
                    </div>
                    <span className={`pill ${workspaceLoaded ? 'solid' : ''}`}>
                      {workspaceLoaded ? t('工作区已就绪') : t('等待目录')}
                    </span>
                  </div>

                  <div className="verify-box">
                    <input
                      type="text"
                      placeholder="/path/to/Celeste or /path/to/Celeste.exe"
                      value={manualPath}
                      onInput={(event) => setManualPath((event.currentTarget as HTMLInputElement).value)}
                    />
                    <button
                      type="button"
                      onClick={() => void loadWorkspace(manualPath.trim())}
                      disabled={!manualPath.trim() || workspaceBusy}
                    >
                      {t('载入目录')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={verifyPath}
                      disabled={!manualPath.trim() || workspaceBusy}
                    >
                      {t('仅校验')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void refreshWorkspace()}
                      disabled={!workspaceLoaded || workspaceBusy}
                    >
                      {t('刷新工作区')}
                    </button>
                  </div>

                  <p className="muted">
                    {t('这里也接受直接粘贴 `Celeste` / `Celeste.exe`、`file://` 路径或 `~` 开头路径，并会自动归一化到游戏目录。')}
                  </p>

                  {workspaceLoaded ? (
                    <div className="workspace-card-grid">
                      <article className="workspace-card">
                        <span>{t('Game Path')}</span>
                        <strong>{selectedGamePath}</strong>
                      </article>
                      <article className="workspace-card">
                        <span>{t('Everest')}</span>
                        <strong>
                          {selectedEverestVersion
                            ? t('Build {version}', { version: selectedEverestVersion })
                            : t('未检测到')}
                        </strong>
                      </article>
                      <article className="workspace-card">
                        <span>{t('Applied Profile')}</span>
                        <strong>{appliedProfileName || t('Default')}</strong>
                      </article>
                      <article className="workspace-card">
                        <span>{t('Selected Profile')}</span>
                        <strong>{selectedProfileName || t('(none)')}</strong>
                      </article>
                    </div>
                  ) : null}

                  {workspaceMessage ? <p className="verify-result">{workspaceMessage}</p> : null}
                  {verifyResult ? <p className="verify-result">{verifyResult}</p> : null}

                  {installs.length ? (
                    <>
                      <p className="muted install-summary">{summary}</p>
                      <div className="install-list">
                        {installs.map((install) => (
                          <article key={`${install.source}:${install.path}`} className="install-card">
                            <div className="install-meta">
                              <strong>{install.source}</strong>
                              <span>{install.valid ? t('Valid') : t('Invalid')}</span>
                            </div>
                            <code>{install.path}</code>
                            <p>
                              {install.everestVersion
                                ? t('Everest {version}', { version: install.everestVersion })
                                : t('未检测到 Everest')}
                            </p>
                            <div className="card-actions">
                              <button
                                type="button"
                                onClick={() => void loadWorkspace(install.path)}
                                disabled={!install.valid || workspaceBusy}
                              >
                                {t('使用此目录')}
                              </button>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => setManualPath(install.path)}
                                disabled={workspaceBusy}
                              >
                                {t('填入输入框')}
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </>
                  ) : null}
                </article>

                <article className="panel accent">
                  <div className="panel-head">
                    <div>
                      <h2>{t('Profiles')}</h2>
                      <p className="muted">
                        {t('这里回到原版首页的核心心智模型：先理解自己当前在用哪个 profile，再决定是切换、应用还是进入管理页细调。')}
                      </p>
                    </div>
                    <span className="pill">{t('{count} Profiles', { count: profiles.length })}</span>
                  </div>

                  {!workspaceLoaded ? (
                    <p className="muted">{t('先载入一个游戏目录，再读取 profile 列表。')}</p>
                  ) : profiles.length ? (
                    <div className="profile-deck">
                      {profiles.map((profile) => {
                        const isSelected = profile.name === selectedProfileName;
                        const isApplied = profile.name === appliedProfileName;
                        const alwaysOnCount = profile.mods.filter((entry) => alwaysOnSet.has(entry.name)).length;
                        const disabledCount = profile.mods.filter((entry) => !alwaysOnSet.has(entry.name)).length;
                        const enabledCount = Math.max(managedModGroups.length - disabledCount, 0);

                        return (
                          <article
                            key={profile.name}
                            className={`profile-card ${isSelected ? 'selected' : ''} ${isApplied ? 'applied' : ''}`}
                          >
                            <div className="profile-card-head">
                              <div>
                                <h3>{profile.name}</h3>
                                <p className="muted">
                                  {isApplied ? t('当前磁盘已应用') : t('仅在内存中查看')}
                                  {isSelected ? t(' · 当前选中') : ''}
                                </p>
                              </div>
                              <div className="tag-row">
                                {isSelected ? <span className="pill solid">{t('选中')}</span> : null}
                                {isApplied ? <span className="pill">{t('已应用')}</span> : null}
                                {alwaysOnCount ? <span className="pill">{t('{count} Always On', { count: alwaysOnCount })}</span> : null}
                              </div>
                            </div>

                            <div className="profile-card-stats">
                              <div>
                                <span>{t('启用')}</span>
                                <strong>{enabledCount}</strong>
                              </div>
                              <div>
                                <span>{t('禁用')}</span>
                                <strong>{disabledCount}</strong>
                              </div>
                              <div>
                                <span>{t('顺序项')}</span>
                                <strong>{profile.modOptionsOrder.length}</strong>
                              </div>
                            </div>

                            <div className="action-row compact-row">
                              <button
                                type="button"
                                className={isSelected ? 'ghost-button' : ''}
                                onClick={() => setSelectedProfileName(profile.name)}
                                disabled={workspaceBusy}
                              >
                                {isSelected ? t('当前选中') : t('选中查看')}
                              </button>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => void applyProfile(profile.name)}
                                disabled={workspaceBusy || isApplied}
                              >
                                {isApplied ? t('已应用到磁盘') : t('应用到磁盘')}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="muted">{t('当前目录还没有可用 profile。')}</p>
                  )}
                </article>
              </div>

              <aside className="home-side">
                <article className="panel accent">
                  <div className="panel-head">
                    <div>
                      <h2>{t('下载设置')}</h2>
                      <p className="muted">{t('这里恢复原版首页里的下载镜像入口，并把设置真正接到搜索、更新与依赖补全链路里。')}</p>
                    </div>
                    <span className="pill">{getDownloadMirrorLabel(downloadMirror, t)}</span>
                  </div>

                  <div className="status-callout">
                    <strong>{t('当前镜像: {mirrorLabel}', { mirrorLabel: getDownloadMirrorLabel(downloadMirror, t) })}</strong>
                    <p>{getDownloadMirrorDescription(downloadMirror, t)}</p>
                    <div className="action-row compact-row">
                      <select
                        className="select-input"
                        value={downloadMirror}
                        onChange={(event) =>
                          setDownloadMirror(
                            normalizeDownloadMirror(
                              (event.currentTarget as HTMLSelectElement).value,
                            ),
                          )
                        }
                      >
                        <option value="wegfan">WEGFan</option>
                        <option value="0x0ade">0x0ade</option>
                        <option value="gamebanana">GameBanana</option>
                      </select>
                    </div>
                    <p>{t('切换后会影响在线搜索结果中的下载地址、管理页更新检测、缺失依赖补全，以及安装时自动补依赖的来源。')}</p>
                  </div>
                </article>

                <article className="panel accent">
                  <div className="panel-head">
                    <div>
                      <h2>{t('语言')}</h2>
                      <p className="muted">{t('当前默认内置简体中文和 English，同时支持从本地目录加载玩家自定义翻译包。')}</p>
                    </div>
                    <span className="pill">{languageOptions.find((option) => option.code === currentLanguage)?.label ?? currentLanguage}</span>
                  </div>

                  <div className="status-callout">
                    <strong>{t('当前语言: {languageLabel}', {
                      languageLabel: languageOptions.find((option) => option.code === currentLanguage)?.label ?? currentLanguage,
                    })}</strong>
                    <p>{t('切换语言后会立即重绘整个应用 shell，推荐页和状态消息也会一起切换。')}</p>
                    <div className="action-row compact-row">
                      <select
                        className="select-input"
                        value={currentLanguage}
                        onChange={(event) =>
                          setCurrentLanguage((event.currentTarget as HTMLSelectElement).value)
                        }
                      >
                        {languageOptions.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p>{t('自定义翻译包目录: {directory}', {
                      directory: translationPackDirectory || t('加载中...'),
                    })}</p>
                    {translationPackErrors.length ? (
                      <div className="warning-box compact-warning">
                        <strong>{t('翻译包加载错误')}</strong>
                        <ul className="warning-list">
                          {translationPackErrors.map((error) => (
                            <li key={`${error.path}:${error.message}`}>
                              {error.path}: {error.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p>{t('把 JSON 翻译包放到上面的目录后，重启应用即可出现在语言列表里。')}</p>
                    )}
                  </div>
                </article>

                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>{t('应用信息')}</h2>
                      <p className="muted">{t('这里保留版本和本地目录信息，避免把首页重新变回调试页。')}</p>
                    </div>
                    <span className="pill">{appInfo?.version ? `v${appInfo.version}` : '...'}</span>
                  </div>
                  <dl className="kv">
                    <div>
                      <dt>{t('Git Hash')}</dt>
                      <dd>{appInfo?.gitHash.slice(0, 12) ?? '...'}</dd>
                    </div>
                    <div>
                      <dt>{t('Config Dir')}</dt>
                      <dd>{paths?.configDir ?? '...'}</dd>
                    </div>
                    <div>
                      <dt>{t('Data Dir')}</dt>
                      <dd>{paths?.dataDir ?? '...'}</dd>
                    </div>
                    <div>
                      <dt>{t('Session Type')}</dt>
                      <dd>{runtimeDiagnostics?.xdgSessionType ?? 'unknown'}</dd>
                    </div>
                  </dl>
                </article>

                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>{t('Wayland 运行时诊断')}</h2>
                      <p className="muted">{t('诊断保留，但退回到首页侧栏，不再盖过主业务路径。')}</p>
                    </div>
                    <span className={`pill ${warningCount ? 'warn' : 'solid'}`}>
                      {warningCount ? t('{count} Warnings', { count: warningCount }) : t('Healthy')}
                    </span>
                  </div>
                  <dl className="kv">
                    <div>
                      <dt>{t('Wayland Display')}</dt>
                      <dd>{runtimeDiagnostics?.waylandDisplay ?? '(unset)'}</dd>
                    </div>
                    <div>
                      <dt>DISPLAY</dt>
                      <dd>{runtimeDiagnostics?.display ?? '(unset)'}</dd>
                    </div>
                    <div>
                      <dt>GDK_BACKEND</dt>
                      <dd>{runtimeDiagnostics?.gdkBackend ?? '(unset)'}</dd>
                    </div>
                    <div>
                      <dt>{t('当前镜像: {mirrorLabel}', {
                        mirrorLabel: getDownloadMirrorLabel(downloadMirror, t),
                      })}</dt>
                      <dd>{getDownloadMirrorDescription(downloadMirror, t)}</dd>
                    </div>
                  </dl>
                  {runtimeDiagnostics?.warnings.length ? (
                    <div className="warning-box compact-warning">
                      <strong>{t('当前警告')}</strong>
                      <ul className="warning-list">
                        {runtimeDiagnostics.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="muted">{t('当前没有检测到额外运行时警告。')}</p>
                  )}
                </article>

                <article className="panel accent">
                  <div className="panel-head">
                    <div>
                      <h2>{t('运行时开关')}</h2>
                      <p className="muted">{t('保存后需重启应用，启动阶段变量才会完全按新配置生效。')}</p>
                    </div>
                    <span className={`pill ${hasRuntimeChanges ? 'warn' : ''}`}>
                      {hasRuntimeChanges ? t('有未保存改动') : t('已同步')}
                    </span>
                  </div>

                  <div className="toggle-list">
                    <label className="toggle-item">
                      <input
                        type="checkbox"
                        checked={runtimeDraft?.requireWaylandSession ?? false}
                        onChange={(event) =>
                          updateRuntimeDraft('requireWaylandSession', event.currentTarget.checked)
                        }
                      />
                      <span>
                        <strong>{t('要求 Wayland 会话')}</strong>
                        <small>{t('仅做诊断提示，不会阻止程序启动。')}</small>
                      </span>
                    </label>

                    <label className="toggle-item">
                      <input
                        type="checkbox"
                        checked={runtimeDraft?.disableDmabufRenderer ?? false}
                        onChange={(event) =>
                          updateRuntimeDraft('disableDmabufRenderer', event.currentTarget.checked)
                        }
                      />
                      <span>
                        <strong>{t('禁用 DMA-BUF renderer')}</strong>
                        <small>{t('当前默认开启，用于规避 WebKitGTK 在 Wayland 下的协议错误。')}</small>
                      </span>
                    </label>

                    <label className="toggle-item">
                      <input
                        type="checkbox"
                        checked={runtimeDraft?.disableCompositingMode ?? false}
                        onChange={(event) =>
                          updateRuntimeDraft('disableCompositingMode', event.currentTarget.checked)
                        }
                      />
                      <span>
                        <strong>{t('禁用 compositing mode')}</strong>
                        <small>{t('仅在需要进一步压制渲染问题时启用。')}</small>
                      </span>
                    </label>

                    <label className="toggle-item">
                      <input
                        type="checkbox"
                        checked={runtimeDraft?.logRuntimeDiagnostics ?? false}
                        onChange={(event) =>
                          updateRuntimeDraft('logRuntimeDiagnostics', event.currentTarget.checked)
                        }
                      />
                      <span>
                        <strong>{t('输出启动诊断日志')}</strong>
                        <small>{t('启动时将当前运行时环境和警告打印到 stderr。')}</small>
                      </span>
                    </label>
                  </div>

                  <div className="action-row">
                    <button
                      type="button"
                      onClick={saveRuntimeConfig}
                      disabled={!runtimeDraft || runtimeBusy || !hasRuntimeChanges}
                    >
                      {t('保存开关')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={resetRuntimeConfig}
                      disabled={runtimeBusy}
                    >
                      {t('恢复默认')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={refreshRuntimeDiagnostics}
                      disabled={runtimeBusy}
                    >
                      {t('刷新诊断')}
                    </button>
                  </div>

                  {runtimeMessage ? <p className="verify-result">{runtimeMessage}</p> : null}
                </article>
              </aside>
            </section>
          </>
        ) : null}

        {activePage === 'everest' ? (
          <>
            <section className="page-header page-hero everest-hero">
              <p className="eyebrow">Everest</p>
              <h1>{t('查看当前加载器版本，并把 Stable / Beta / Dev 通道安装到当前 Celeste 目录。')}</h1>
              <p className="lede">
                {t('Everest 是安装在当前 Celeste 目录中的 Mod 加载器。这里不会要求单独选择 Everest 路径，而是直接对当前工作区执行安装或升级。')}
              </p>
              <div className="page-hero-metrics">
                <article className="page-hero-metric">
                  <span>{t('工作区')}</span>
                  <strong>{workspaceLoaded ? t('工作区已就绪') : t('等待目录')}</strong>
                </article>
                <article className="page-hero-metric">
                  <span>Everest</span>
                  <strong>
                    {selectedEverestVersion
                      ? t('Build {version}', { version: selectedEverestVersion })
                      : t('未安装 Everest')}
                  </strong>
                </article>
                <article className="page-hero-metric">
                  <span>{t('Stable 通道')}</span>
                  <strong>
                    {latestStableEverestRelease
                      ? t('Build {version}', { version: latestStableEverestRelease.version })
                      : t('加载中...')}
                  </strong>
                </article>
              </div>
              <div className="page-hero-actions">
                <button
                  type="button"
                  onClick={() => void loadEverestVersions()}
                  disabled={everestLoading || everestInstallBusy}
                >
                  {t('刷新 Everest 列表')}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setActivePage('home')}
                >
                  {t('返回主页')}
                </button>
              </div>
            </section>

            <section className="workspace-card-grid">
              <article className="workspace-card">
                <span>{t('Celeste 目录')}</span>
                <strong>{selectedGamePath || t('未载入')}</strong>
              </article>
              <article className="workspace-card">
                <span>Everest</span>
                <strong>
                  {selectedEverestVersion
                    ? t('Build {version}', { version: selectedEverestVersion })
                    : t('未安装 Everest')}
                </strong>
              </article>
              <article className="workspace-card">
                <span>{t('当前镜像: {mirrorLabel}', {
                  mirrorLabel: getDownloadMirrorLabel(downloadMirror, t),
                })}</span>
                <strong>{getDownloadMirrorLabel(downloadMirror, t)}</strong>
              </article>
              <article className="workspace-card">
                <span>{t('工作区')}</span>
                <strong>{workspaceLoaded ? t('工作区已就绪') : t('等待目录')}</strong>
              </article>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>{t('Everest 安装')}</h2>
                  <p className="muted">
                    {t('Stable 通道会跟随当前下载镜像切换；Beta / Dev 继续使用上游构建地址。安装目标始终是当前 Celeste 工作区。')}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void loadEverestVersions()}
                  disabled={everestLoading || everestInstallBusy}
                >
                  {t('刷新 Everest 列表')}
                </button>
              </div>

              {!workspaceLoaded ? (
                <p className="muted">{t('先载入一个游戏目录，再安装 Everest。')}</p>
              ) : null}

              {everestMessage ? <p className="verify-result">{everestMessage}</p> : null}

              {everestLoading ? (
                <p className="muted">{t('加载中...')}</p>
              ) : everestVersions?.length ? (
                <div className="everest-channel-grid">
                  {[
                    { key: 'stable' as const, title: t('Stable 通道'), releases: everestReleasesByBranch.stable },
                    { key: 'beta' as const, title: t('Beta 通道'), releases: everestReleasesByBranch.beta },
                    { key: 'dev' as const, title: t('Dev 通道'), releases: everestReleasesByBranch.dev },
                  ].map((channel) => (
                    <article key={channel.key} className="panel everest-channel-card">
                      <div className="panel-head">
                        <div>
                          <h3>{channel.title}</h3>
                          <p className="muted">
                            {channel.key === 'stable'
                              ? t('适合大多数玩家，稳定版可跟随当前镜像设置。')
                              : t('测试通道更新更快，但默认直接走上游构建地址。')}
                          </p>
                        </div>
                        <span className="pill">{channel.releases.length}</span>
                      </div>

                      {channel.releases.length ? (
                        <div className="everest-release-list">
                          {channel.releases.map((release) => (
                            <article key={`${channel.key}-${release.version}`} className="everest-release-item">
                              <div className="everest-release-meta">
                                <strong>{release.version}</strong>
                                <span className="muted">
                                  {new Date(release.date).toLocaleDateString(currentLanguage)} · {formatBytes(release.mainFileSize)}
                                </span>
                                <span className="muted">
                                  {release.commit.slice(0, 7)}
                                  {release.author ? ` · ${release.author}` : ''}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => void installEverest(release)}
                                disabled={!workspaceLoaded || everestInstallBusy || workspaceBusy}
                              >
                                {everestInstallBusy ? t('正在安装') : t('安装')}
                              </button>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">{t('无数据')}</p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">{t('无数据')}</p>
              )}
            </section>
          </>
        ) : null}

        {activePage === 'manage' ? (
          <>
            <section className="page-header">
              <p className="eyebrow">{t('Manage')}</p>
              <h1>{t('管理已装 Mod、Profile 与磁盘状态。')}</h1>
              <p className="lede">
                {t('这一页继续向原版 Manage 收敛：左侧处理 profile，右侧直接看同名分组、重复包、依赖链和本地备注。')}
              </p>
            </section>

            {!workspaceLoaded ? (
              <section className="panel">
                <p className="muted">{t('先回到主页载入一个游戏目录，再进入管理工作台。')}</p>
              </section>
            ) : (
              <div className="manage-layout">
                <aside className="manage-sidebar">
                  <article className="panel accent">
                    <div className="panel-head">
                      <div>
                        <h2>{t('Blacklist Profiles')}</h2>
                        <p className="muted">{t('左侧重新回到原版 Manage 的主入口：先选 profile，再决定应用或细调。')}</p>
                      </div>
                      {selectedProfileName && appliedProfileName && selectedProfileName !== appliedProfileName ? (
                        <span className="pill warn">{t('未应用')}</span>
                      ) : (
                        <span className="pill solid">{t('已同步')}</span>
                      )}
                    </div>

                    <div className="manage-profile-list">
                      {profiles.map((profile) => {
                        const isSelected = profile.name === selectedProfileName;
                        const isApplied = profile.name === appliedProfileName;
                        const disabledCount = profile.mods.filter((entry) => !alwaysOnSet.has(entry.name)).length;
                        const enabledCount = Math.max(managedModGroups.length - disabledCount, 0);

                        return (
                          <button
                            key={profile.name}
                            type="button"
                            className={`manage-profile-card ${isSelected ? 'active' : ''} ${isApplied ? 'applied' : ''}`}
                            onClick={() => setSelectedProfileName(profile.name)}
                            disabled={workspaceBusy}
                          >
                            <strong>{profile.name}</strong>
                            <span>{t('{enabledCount} 启用 · {disabledCount} 禁用', {
                              enabledCount,
                              disabledCount,
                            })}</span>
                            <small>
                              {isApplied ? t('当前磁盘已应用') : t('尚未应用到磁盘')}
                            </small>
                          </button>
                        );
                      })}
                    </div>

                    <div className="status-callout">
                      <strong>{selectedProfileName || t('未选中 profile')}</strong>
                      <p>
                        {selectedProfile
                          ? t(
                              '当前 profile 记录 {blacklistCount} 个 blacklist 项，其中 {alwaysOnCount} 个被 Always On 覆盖，modoptionsorder 记录 {orderCount} 项。',
                              {
                                blacklistCount: selectedProfile.mods.length,
                                alwaysOnCount: selectedProfile.mods.filter((entry) =>
                                  alwaysOnSet.has(entry.name)
                                ).length,
                                orderCount: selectedProfile.modOptionsOrder.length,
                              },
                            )
                          : t('当前还没有可用 profile。')}
                      </p>
                    </div>

                    <div className="action-row">
                      <button
                        type="button"
                        onClick={applySelectedProfile}
                        disabled={!selectedProfileName || workspaceBusy}
                      >
                        {t('应用当前 Profile')}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={removeSelectedProfile}
                        disabled={!selectedProfileName || workspaceBusy}
                      >
                        {t('删除当前 Profile')}
                      </button>
                    </div>

                    <div className="inline-form">
                      <input
                        type="text"
                        placeholder={t('新的 profile 名称')}
                        value={newProfileName}
                        onInput={(event) =>
                          setNewProfileName((event.currentTarget as HTMLInputElement).value)
                        }
                      />
                      <button
                        type="button"
                        onClick={createProfile}
                        disabled={!newProfileName.trim() || workspaceBusy}
                      >
                        {t('新建 Profile')}
                      </button>
                    </div>
                  </article>

                  <article className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>{t('Always On')}</h2>
                        <p className="muted">
                          {t('这些 Mod 会在任何 profile 应用到磁盘时被强制保留启用，不会写入 `blacklist.txt`。')}
                        </p>
                      </div>
                      <span className="pill">{t('{count} Mods', { count: alwaysOnMods.length })}</span>
                    </div>

                    {alwaysOnMods.length ? (
                      <div className="profile-chip-row">
                        {alwaysOnMods.map((modName) => (
                          <button
                            key={modName}
                            type="button"
                            className="profile-chip"
                            onClick={() => void toggleAlwaysOn(modName)}
                            disabled={workspaceBusy}
                          >
                            {modName}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">{t('当前还没有 Always On Mod。可在右侧 Mod 列表中逐项切换。')}</p>
                    )}
                  </article>

                  <article className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>{t('磁盘 Blacklist')}</h2>
                        <p className="muted">
                          {t('这里直接读取 `Mods/blacklist.txt`，确认磁盘状态是否和当前已应用 profile 一致。')}
                        </p>
                      </div>
                      {hasDiskBlacklistDrift ? (
                        <span className="pill warn">{t('磁盘漂移')}</span>
                      ) : (
                        <span className="pill solid">{t('磁盘一致')}</span>
                      )}
                    </div>

                    <dl className="kv">
                      <div>
                        <dt>{t('Applied Profile')}</dt>
                        <dd>{appliedProfileName || t('Default')}</dd>
                      </div>
                      <div>
                        <dt>{t('Expected Disabled Files')}</dt>
                        <dd>{expectedAppliedDisabledFiles.length}</dd>
                      </div>
                      <div>
                        <dt>{t('Actual Disabled Files')}</dt>
                        <dd>{diskDisabledFiles.length}</dd>
                      </div>
                      <div>
                        <dt>{t('Disk Drift')}</dt>
                        <dd>{hasDiskBlacklistDrift ? t('磁盘文件与已应用 profile 不一致') : t('当前没有漂移')}</dd>
                      </div>
                    </dl>

                    <div className="action-row">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void refreshWorkspace(t('已刷新磁盘 blacklist 状态。'))}
                        disabled={workspaceBusy}
                      >
                        {t('刷新磁盘状态')}
                      </button>
                      <button
                        type="button"
                        onClick={syncAppliedProfileFromDisk}
                        disabled={!hasDiskBlacklistDrift || !appliedProfileName || workspaceBusy}
                      >
                        {t('从磁盘同步已应用 Profile')}
                      </button>
                    </div>

                    <pre className="mono-block manage-disk-preview">
                      {diskBlacklistContent || t('# blacklist.txt 目前为空\n')}
                    </pre>
                  </article>

                  <article className="panel accent">
                    <div className="panel-head">
                      <div>
                        <h2>{t('Mod Options 顺序')}</h2>
                        <p className="muted">
                          {t('这里编辑当前选中 profile 的 `modOptionsOrder`，并立即写入 `Mods/modoptionsorder.txt`。')}
                        </p>
                      </div>
                      <span className="pill">{t('{count} Ordered', { count: selectedProfile?.modOptionsOrder.length ?? 0 })}</span>
                    </div>

                    {!selectedProfile ? (
                      <p className="muted">{t('先选中一个 profile，再调整顺序。')}</p>
                    ) : (
                      <>
                        <div className="action-row compact-row">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => void clearModOptionsOrder()}
                            disabled={!selectedProfile.modOptionsOrder.length || workspaceBusy}
                          >
                            {t('清空顺序')}
                          </button>
                        </div>

                        {effectiveOrder.length ? (
                          <div className="order-list compact-order-list">
                            {effectiveOrder.map((file, index) => {
                              const mod = modByFile.get(file);
                              return (
                                <div key={file} className="order-item">
                                  <div className="order-meta">
                                    <strong>{mod?.name ?? file}</strong>
                                    <code>{file}</code>
                                  </div>
                                  <div className="order-actions">
                                    <button
                                      type="button"
                                      className="ghost-button mini-button"
                                      onClick={() => void moveOrderItemToTop(index)}
                                      disabled={index === 0 || workspaceBusy}
                                    >
                                      {t('置顶')}
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost-button mini-button"
                                      onClick={() => void moveOrderItem(index, -1)}
                                      disabled={index === 0 || workspaceBusy}
                                    >
                                      {t('上移')}
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost-button mini-button"
                                      onClick={() => void moveOrderItem(index, 1)}
                                      disabled={index === effectiveOrder.length - 1 || workspaceBusy}
                                    >
                                      {t('下移')}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="muted">{t('当前没有可排序的 Mod 文件。')}</p>
                        )}
                      </>
                    )}
                  </article>
                </aside>

                <section className="panel manage-main-panel">
                  <div className="panel-head">
                    <div>
                      <h2>{t('已装 Mod')}</h2>
                      <p className="muted">
                        {t('勾选表示该 Mod 在当前 profile 中保持启用；取消勾选表示写入该 profile 的 blacklist 项。变更只写入 profile，点击“应用当前 Profile”后才落到 `Mods/blacklist.txt`。')}
                      </p>
                    </div>
                    <span className="pill">{t('{count} Mods', { count: managedModGroups.length })}</span>
                  </div>

                  <div className="workspace-card-grid manage-stats-grid">
                    <article className="workspace-card">
                      <span>{t('Installed Mods')}</span>
                      <strong>{managedModGroups.length}</strong>
                    </article>
                    <article className="workspace-card">
                      <span>{t('Selected Profile')}</span>
                      <strong>{selectedProfileName || t('None')}</strong>
                    </article>
                    <article className="workspace-card">
                      <span>{t('Blacklisted')}</span>
                      <strong>{selectedProfileDisabledCount}</strong>
                    </article>
                    <article className="workspace-card">
                      <span>{t('重复 Mod')}</span>
                      <strong>{duplicateModGroupCount}</strong>
                    </article>
                    <article className="workspace-card">
                      <span>{t('本地备注')}</span>
                      <strong>{modCommentCount}</strong>
                    </article>
                    <article className="workspace-card">
                      <span>{t('磁盘状态')}</span>
                      <strong>{hasDiskBlacklistDrift ? t('Drift') : t('Synced')}</strong>
                    </article>
                  </div>

                  <div className="maintenance-grid">
                    <article className="status-callout maintenance-card">
                      <strong>{t('更新检测')}</strong>
                      <p>
                        {t('当前发现 {count} 个可更新 Mod。', { count: availableUpdates.length })}
                        {maintenanceTargetProfileName
                          ? t(' 更新完成后会重新应用 {profileName}。', {
                              profileName: maintenanceTargetProfileName,
                            })
                          : t(' 当前未选中 profile，更新后保持默认启用状态。')}
                      </p>
                      <div className="action-row compact-row">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void refreshWorkspaceMaintenance()}
                          disabled={workspaceBusy}
                        >
                          {t('刷新检测')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void updateAllModsFromManage()}
                          disabled={!availableUpdates.length || workspaceBusy}
                        >
                          {t('一键更新全部')}
                        </button>
                      </div>
                      {availableUpdates.length ? (
                        <div className="maintenance-list">
                          {availableUpdates.map((update) => (
                            <div key={update.name} className="maintenance-item">
                              <div className="maintenance-item-copy">
                                <strong>{update.name}</strong>
                                <p>
                                  {update.currentVersion} {'->'} {update.latestVersion}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => void updateModFromManage(update.name)}
                                disabled={workspaceBusy}
                              >
                                {t('更新')}
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">{t('当前没有检测到可更新的 Mod。')}</p>
                      )}
                    </article>

                    <article className="status-callout maintenance-card">
                      <strong>{t('依赖修复')}</strong>
                      <p>
                        {t('当前发现 {count} 项缺失或版本不足的硬依赖。', {
                          count: dependencyIssues.length,
                        })}
                        {t('补全时会优先尝试满足更高的版本需求。')}
                      </p>
                      <div className="action-row compact-row">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void refreshWorkspaceMaintenance()}
                          disabled={workspaceBusy}
                        >
                          {t('刷新检测')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void repairAllDependencyIssues()}
                          disabled={!dependencyIssues.length || workspaceBusy}
                        >
                          {t('补全缺失依赖')}
                        </button>
                      </div>
                      {dependencyIssues.length ? (
                        <div className="maintenance-list">
                          {dependencyIssues.map((issue) => (
                            <div key={issue.name} className="maintenance-item">
                              <div className="maintenance-item-copy">
                                <strong>{issue.name}</strong>
                                <p>
                                  {getDependencyIssueStatusLabel(issue, t)}
                                  {' · '}
                                  {t('需要 {version}', { version: issue.requiredVersion })}
                                  {issue.installedVersion
                                    ? t(' · 已装 {version}', { version: issue.installedVersion })
                                    : t(' · 当前未安装')}
                                  {issue.latestVersion
                                    ? t(' · 线上 {version}', { version: issue.latestVersion })
                                    : ''}
                                </p>
                                <p>
                                  {t('由 {requiredBy}', {
                                    requiredBy: issue.requiredBy.join(' / '),
                                  })}
                                  {issue.note ? ` · ${issue.note}` : ''}
                                </p>
                              </div>
                              {issue.downloadUrl ? (
                                <button
                                  type="button"
                                  className="ghost-button"
                                  onClick={() => void repairDependencyIssueByName(issue.name)}
                                  disabled={workspaceBusy}
                                >
                                  {t('处理')}
                                </button>
                              ) : (
                                <span className="pill warn">{t('手动处理')}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">{t('当前没有检测到缺失依赖或版本不足的依赖。')}</p>
                      )}
                    </article>
                  </div>

                  {workspaceMessage ? <p className="verify-result">{workspaceMessage}</p> : null}
                  {maintenanceMessage ? <p className="verify-result">{maintenanceMessage}</p> : null}

                  <div className="mods-toolbar manage-toolbar-panel">
                    <div className="manage-toolbar-strip">
                      <span className={`manage-signal-pill ${availableUpdates.length ? 'hot' : ''}`}>
                        {t('更新检测')} · {availableUpdates.length}
                      </span>
                      <span className={`manage-signal-pill ${dependencyIssues.length ? 'warn' : ''}`}>
                        {t('依赖修复')} · {dependencyIssues.length}
                      </span>
                      <span className="manage-signal-note">
                        {t('显示 {filteredCount} / {totalCount} 个 Mod，待删除选择 {selectedCount} 项。', {
                          filteredCount: filteredModGroups.length,
                          totalCount: managedModGroups.length,
                          selectedCount: selectedDeletionMods.length,
                        })}
                      </span>
                    </div>

                    <div className="manage-toolbar-main">
                      <input
                        type="text"
                        className="filter-input"
                        placeholder={t('按名称、文件名或依赖过滤')}
                        value={modFilter}
                        onInput={(event) => setModFilter((event.currentTarget as HTMLInputElement).value)}
                      />
                      <div className="manage-flag-row">
                        <label className="toggle-chip">
                          <input
                            type="checkbox"
                            checked={showDependencyTree}
                            onChange={(event) => setShowDependencyTree(event.currentTarget.checked)}
                          />
                          <span>{t('显示依赖树')}</span>
                        </label>
                        <label className="toggle-chip">
                          <input
                            type="checkbox"
                            checked={showManageDetails}
                            onChange={(event) => setShowManageDetails(event.currentTarget.checked)}
                          />
                          <span>{t('显示详细信息')}</span>
                        </label>
                      </div>
                      <div className="action-row compact-row">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={selectAllFilteredMods}
                          disabled={!filteredModGroups.length || workspaceBusy}
                        >
                          {t('选中当前过滤结果')}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={clearDeletionSelection}
                          disabled={!selectedDeletionMods.length || workspaceBusy}
                        >
                          {t('清空删除选择')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteModsByName(selectedDeletionMods)}
                          disabled={!selectedDeletionMods.length || workspaceBusy}
                        >
                          {t('删除已选择项')}
                        </button>
                      </div>
                    </div>

                    <p className="muted">
                      {t('同名重复包会在这里按一组显示，避免 UI 和后端按名操作的语义继续错位。')}
                    </p>
                  </div>

                  {filteredModGroups.length ? (
                    <div className="mod-list">
                      {groupedManagedModSections.map((section) => (
                        <section key={section.id} className={`mod-section mod-section-${section.id}`}>
                          <div className="mod-section-title">{section.label}</div>
                          <div className="mod-section-body">
                            {section.items.map((modGroup) => {
                        const representativeMod = modGroup.mods[0];
                        const selectedForDeletion = selectedDeletionMods.includes(modGroup.name);
                        return (
                          <article key={modGroup.key} className={`mod-row ${showManageDetails ? 'detailed' : ''}`}>
                            <input
                              type="checkbox"
                              checked={modGroup.enabled}
                              onChange={(event) =>
                                representativeMod
                                  ? void toggleModState(representativeMod, event.currentTarget.checked)
                                  : undefined
                              }
                              disabled={!selectedProfileName || workspaceBusy || modGroup.isAlwaysOn}
                            />
                            <div className="mod-main">
                              <div className="mod-title-row">
                                <div className="mod-title-copy">
                                  <strong>{modGroup.name}</strong>
                                  <p className="mod-meta">
                                    v{modGroup.displayVersion}
                                    {modGroup.versions.length > 1
                                      ? t(' · 检测到 {count} 个版本', { count: modGroup.versions.length })
                                      : ''}
                                  </p>
                                </div>
                                <div className="tag-row">
                                  {modGroup.isAlwaysOn ? <span className="pill solid">{t('Always On')}</span> : null}
                                  <span className={`pill ${modGroup.enabled ? 'solid' : 'warn'}`}>
                                    {modGroup.enabled ? t('Enabled') : t('Blacklisted')}
                                  </span>
                                  {selectedForDeletion ? <span className="pill warn">{t('待删除')}</span> : null}
                                  {modGroup.availableUpdate ? <span className="pill warn">{t('可更新')}</span> : null}
                                  {modGroup.health !== 'healthy' ? (
                                    <span className="pill warn">{getDependencyHealthLabel(modGroup.health, t)}</span>
                                  ) : null}
                                  {modGroup.duplicateCount > 1 ? (
                                    <span className="pill warn">
                                      {t('重复 Mod ·')}
                                      {modGroup.duplicateCount}
                                    </span>
                                  ) : null}
                                  {modGroup.comment.trim() ? <span className="pill">{t('有备注')}</span> : null}
                                  <span className="pill">{modGroup.entryKinds.join(' + ')}</span>
                                  <span className="pill">{formatBytes(modGroup.totalSize)}</span>
                                </div>
                              </div>
                              {modGroup.isAlwaysOn ? (
                                <p className="mod-meta">{t('当前已被标记为 Always On，应用 profile 到磁盘时会强制保持启用。')}</p>
                              ) : null}
                              <p className="mod-deps">
                                {modGroup.dependencies.length
                                  ? modGroup.dependencies
                                      .map((dependency) => {
                                        const suffix = dependency.optional ? ` ${t('(optional)')}` : '';
                                        return `${dependency.name} ${dependency.requiredVersion}${suffix}`;
                                      })
                                      .join(' / ')
                                  : t('无显式依赖')}
                              </p>
                              {!showManageDetails && modGroup.comment.trim() ? (
                                <p className="mod-comment-preview">{modGroup.comment}</p>
                              ) : null}
                              <div className="action-row compact-row">
                                <button
                                  type="button"
                                  className="ghost-button"
                                  onClick={() => toggleDeletionSelection(modGroup.name)}
                                  disabled={workspaceBusy}
                                >
                                  {selectedForDeletion ? t('取消删除选择') : t('加入删除选择')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteModsByName([modGroup.name])}
                                  disabled={workspaceBusy}
                                >
                                  {t('删除此 Mod')}
                                </button>
                                <button
                                  type="button"
                                  className="ghost-button"
                                  onClick={() => void toggleAlwaysOn(modGroup.name)}
                                  disabled={workspaceBusy}
                                >
                                  {modGroup.isAlwaysOn ? t('取消 Always On') : t('设为 Always On')}
                                </button>
                                {modGroup.availableUpdate ? (
                                  <button
                                    type="button"
                                    className="ghost-button"
                                    onClick={() => void updateModFromManage(modGroup.name)}
                                    disabled={workspaceBusy}
                                  >
                                    {t('更新此 Mod')}
                                  </button>
                                ) : null}
                              </div>

                              {showManageDetails ? (
                                <div className="mod-detail-grid">
                                  <article className="mod-detail-card">
                                    <span>{t('文件与版本')}</span>
                                    <strong>{modGroup.files.length === 1 ? modGroup.files[0] : t('{count} 个文件', { count: modGroup.files.length })}</strong>
                                    <p>
                                      {modGroup.versions.length > 1
                                        ? modGroup.versions.join(' / ')
                                        : `v${modGroup.displayVersion}`}
                                    </p>
                                    <div className="mod-file-list">
                                      {modGroup.files.map((file) => (
                                        <code key={`${modGroup.name}-${file}`}>{file}</code>
                                      ))}
                                    </div>
                                    {modGroup.duplicateCount > 1 ? (
                                      <p className="muted">
                                        {t('同名重复包会在黑名单、Always On 和删除动作里按整组处理。')}
                                      </p>
                                    ) : null}
                                  </article>

                                  <article className="mod-detail-card">
                                    <span>{t('反向依赖')}</span>
                                    <strong>{modGroup.requiredBy.length || t('无')}</strong>
                                    {modGroup.requiredBy.length ? (
                                      <div className="tag-row">
                                        {modGroup.requiredBy.map((dependencyName) => (
                                          <span key={`${modGroup.name}-required-by-${dependencyName}`} className="pill">
                                            {dependencyName}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="muted">{t('当前没有其他 Mod 依赖它。')}</p>
                                    )}
                                    {modGroup.availableUpdate ? (
                                      <p className="muted">
                                        {t('可更新到 {version}', {
                                          version: modGroup.availableUpdate.latestVersion,
                                        })}
                                      </p>
                                    ) : null}
                                  </article>

                                  <label className="mod-detail-card mod-comment-card">
                                    <span>{t('本地备注')}</span>
                                    <textarea
                                      value={modGroup.comment}
                                      placeholder={t('给这个 Mod 留一条本地备注。')}
                                      onInput={(event) =>
                                        setModComment(
                                          modGroup.name,
                                          (event.currentTarget as HTMLTextAreaElement).value,
                                        )
                                      }
                                    />
                                    <small>{t('备注只保存在当前 CeleMod 本地配置里，不会写进 Mod 包或 profile 文件。')}</small>
                                  </label>
                                </div>
                              ) : null}

                              {showDependencyTree ? (
                                <div className="mod-tree-section">
                                  <div className="panel-head">
                                    <div>
                                      <h4>{t('依赖树')}</h4>
                                      <p className="muted">
                                        {t('这里按当前已安装的同名分组解析依赖，方便直接看出缺失、版本不足和未启用的链路。')}
                                      </p>
                                    </div>
                                    <span
                                      className={`pill ${modGroup.health === 'healthy' ? 'solid' : 'warn'}`}
                                    >
                                      {getDependencyHealthLabel(modGroup.health, t)}
                                    </span>
                                  </div>
                                  <ManageDependencyTree
                                    dependencies={modGroup.dependencies}
                                    modGroupByKey={modGroupByKey}
                                    t={t}
                                    lineage={[modGroup.key]}
                                  />
                                </div>
                              ) : null}
                            </div>
                          </article>
                        );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">{t('当前目录没有可识别的 Everest Mod，或过滤条件没有命中结果。')}</p>
                  )}
                </section>
              </div>
            )}
          </>
        ) : null}

        {activePage === 'multiplayer' ? (
          <>
            <section className="page-header page-hero multiplayer-hero">
              <p className="eyebrow">{t('Multiplayer')}</p>
              <h1>{t('把联机流程拆成安装、注册和登录三个步骤。')}</h1>
              <p className="lede">
                {t('先补回原版的群服入口，同时把 Miao.CelesteNet.Client / CelesteNet.Client 的安装和状态放到一个页面里。')}
              </p>
              <div className="page-hero-metrics">
                <article className="page-hero-metric">
                  <span>{t('主路线')}</span>
                  <strong>{multiplayerPrimaryRoute.title}</strong>
                </article>
                <article className="page-hero-metric">
                  <span>{t('工作区')}</span>
                  <strong>{selectedGamePath || t('未载入')}</strong>
                </article>
                <article className="page-hero-metric">
                  <span>Everest</span>
                  <strong>
                    {selectedEverestVersion
                      ? t('Build {version}', { version: selectedEverestVersion })
                      : t('未安装 Everest')}
                  </strong>
                </article>
              </div>
              <div className="page-hero-actions">
                <button
                  type="button"
                  onClick={() =>
                    installedModNameSet.has(multiplayerPrimaryRoute.modName)
                      ? setActivePage('manage')
                      : void runInstallFromUrl(
                          multiplayerPrimaryRoute.downloadUrl,
                          'recommendation',
                          t('推荐安装: {modName}', { modName: multiplayerPrimaryRoute.title }),
                        )
                  }
                  disabled={workspaceBusy || !workspaceLoaded}
                >
                  {installedModNameSet.has(multiplayerPrimaryRoute.modName) ? t('进入管理页') : t('安装此项')}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void startGame()}
                  disabled={workspaceBusy || !workspaceLoaded}
                >
                  {t('启动游戏')}
                </button>
              </div>
            </section>

            <section className="workspace-card-grid">
              <article className="workspace-card">
                <span>{t('联机工作区')}</span>
                <strong>{selectedGamePath || t('未载入')}</strong>
              </article>
              <article className="workspace-card">
                <span>Everest</span>
                <strong>
                  {selectedEverestVersion
                    ? t('Build {version}', { version: selectedEverestVersion })
                    : t('未安装 Everest')}
                </strong>
              </article>
              <article className="workspace-card">
                <span>{t('主路线')}</span>
                <strong>{multiplayerPrimaryRoute.title}</strong>
                <small>
                  {modGroupByKey.get(multiplayerPrimaryRoute.modName)?.enabled
                    ? t('已安装并启用')
                    : installedModNameSet.has(multiplayerPrimaryRoute.modName)
                      ? t('已安装但当前被禁用')
                      : t('未安装')}
                </small>
              </article>
              <article className="workspace-card">
                <span>{t('备选路线')}</span>
                <strong>{multiplayerSecondaryRoute?.title ?? t('无')}</strong>
                <small>
                  {multiplayerSecondaryRoute
                    ? installedModNameSet.has(multiplayerSecondaryRoute.modName)
                      ? t('已安装')
                      : t('未安装')
                    : t('无')}
                </small>
              </article>
            </section>

            {!workspaceLoaded ? (
              <section className="panel accent">
                <div className="panel-head">
                  <div>
                    <h2>{t('联机相关')}</h2>
                    <p className="muted">{t('先回到主页载入 Celeste 目录，再处理联机 Mod 和账号流程。')}</p>
                  </div>
                  <button type="button" onClick={() => setActivePage('home')}>
                    {t('返回主页')}
                  </button>
                </div>
              </section>
            ) : !selectedEverestVersion ? (
              <section className="panel accent">
                <div className="panel-head">
                  <div>
                    <h2>{t('请先安装 Everest')}</h2>
                    <p className="muted">{t('先安装 Everest，再配置联机 Mod。')}</p>
                  </div>
                  <button type="button" onClick={() => setActivePage('everest')}>
                    {t('转到 Everest 页')}
                  </button>
                </div>
              </section>
            ) : (
              <>
                <div className="multiplayer-layout">
                  <section className="panel accent multiplayer-main-panel">
                    <div className="panel-head">
                      <div>
                        <h2>{t('安装联机 Mod')}</h2>
                        <p className="muted">{t('为了在蔚蓝群服进行联机，你需要安装以下 Mod')}</p>
                      </div>
                      <span className="pill solid">{t('主用客户端')}</span>
                    </div>

                    <article className="multiplayer-route-card primary">
                      <div className="multiplayer-route-copy">
                        <span className="eyebrow">{t('推荐路线')}</span>
                        <h3>{multiplayerPrimaryRoute.title}</h3>
                        <p>{multiplayerPrimaryRoute.description}</p>
                        <p className="muted">{multiplayerPrimaryRoute.detail}</p>
                        <div className="tag-row">
                          <span
                            className={`pill ${
                              modGroupByKey.get(multiplayerPrimaryRoute.modName)?.enabled ? 'solid' : ''
                            }`}
                          >
                            {modGroupByKey.get(multiplayerPrimaryRoute.modName)?.enabled
                              ? t('已安装并启用')
                              : installedModNameSet.has(multiplayerPrimaryRoute.modName)
                                ? t('已安装但当前被禁用')
                                : t('未安装')}
                          </span>
                          {modGroupByKey.get(multiplayerPrimaryRoute.modName)?.isAlwaysOn ? (
                            <span className="pill">{t('当前已是 Always On')}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="action-row compact-row">
                        {installedModNameSet.has(multiplayerPrimaryRoute.modName) ? (
                          <>
                            <button type="button" onClick={() => setActivePage('manage')}>
                              {t('进入管理页')}
                            </button>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => void toggleAlwaysOn(multiplayerPrimaryRoute.modName)}
                              disabled={workspaceBusy}
                            >
                              {modGroupByKey.get(multiplayerPrimaryRoute.modName)?.isAlwaysOn
                                ? t('当前已是 Always On')
                                : t('把联机 Mod 设成 Always On')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              void runInstallFromUrl(
                                multiplayerPrimaryRoute.downloadUrl,
                                'recommendation',
                                t('推荐安装: {modName}', { modName: multiplayerPrimaryRoute.title }),
                              )
                            }
                            disabled={workspaceBusy}
                          >
                            {t('安装此项')}
                          </button>
                        )}
                      </div>
                    </article>

                    <p className="muted multiplayer-note">
                      {t('如果当前 profile 会切联机 Mod，建议把它设成 Always On，避免换 profile 后误禁用。')}
                    </p>
                  </section>

                  <section className="panel multiplayer-guide-panel">
                    <div className="panel-head">
                      <div>
                        <h2>{t('论坛与账号')}</h2>
                        <p className="muted">{t('中文群服当前沿用论坛工作流。先注册，再在游戏里登录。')}</p>
                      </div>
                      <span className="pill">{t('群服账号')}</span>
                    </div>

                    <div className="multiplayer-step-list">
                      <article className="multiplayer-step-card">
                        <strong>Ⅰ</strong>
                        <div>
                          <h3>{t('注册账号')}</h3>
                          <p>{t('你需要在 Celeste 群服论坛 注册一个账号')}</p>
                          <div className="action-row compact-row">
                            <button
                              type="button"
                              onClick={() => void invoke('open_url', { url: 'https://bbs.celemiao.com/' })}
                            >
                              {t('进入注册页')}
                            </button>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => void invoke('open_url', { url: 'https://bbs.celemiao.com/' })}
                            >
                              {t('打开论坛')}
                            </button>
                          </div>
                        </div>
                      </article>

                      <article className="multiplayer-step-card">
                        <strong>Ⅱ</strong>
                        <div>
                          <h3>{t('登录账号')}</h3>
                          <p>{t('打开游戏后，你将需要在 Mod 设置中启用并登录群服 Mod')}</p>
                          <p className="muted">{t('建议注册后回到游戏，在 Mod 设置里完成服务器地址、账号和令牌登录。')}</p>
                        </div>
                      </article>

                      <article className="multiplayer-step-card">
                        <strong>Ⅲ</strong>
                        <div>
                          <h3>{t('游戏内登录')}</h3>
                          <p>{t('启动游戏后，在 Mod 设置里启用并登录对应联机 Mod。')}</p>
                          <div className="action-row compact-row">
                            <button type="button" onClick={() => void startGame()} disabled={workspaceBusy}>
                              {t('启动游戏')}
                            </button>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => setActivePage('manage')}
                              disabled={workspaceBusy}
                            >
                              {t('进入管理页')}
                            </button>
                          </div>
                        </div>
                      </article>
                    </div>
                  </section>
                </div>

                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>{t('备选路线')}</h2>
                      <p className="muted">{t('除了主路线，这里也把通用 CelesteNet 和国内镜像辅助一起放出来，避免你还要再去搜索页翻。')}</p>
                    </div>
                    <span className="pill">{t('联机辅助')}</span>
                  </div>

                  <div className="multiplayer-route-grid">
                    {[multiplayerSecondaryRoute, multiplayerHelperRoute].filter(Boolean).map((route) => {
                      const multiplayerRoute = route!;
                      const routeGroup = modGroupByKey.get(multiplayerRoute.modName);
                      const installed = installedModNameSet.has(multiplayerRoute.modName);
                      return (
                        <article
                          key={multiplayerRoute.id}
                          className={`multiplayer-route-card ${multiplayerRoute.recommended ? 'recommended' : ''}`}
                        >
                          <div className="panel-head">
                            <div>
                              <h3>{multiplayerRoute.title}</h3>
                              <p className="muted">{multiplayerRoute.description}</p>
                            </div>
                            {multiplayerRoute.recommended ? (
                              <span className="pill solid">{t('推荐路线')}</span>
                            ) : (
                              <span className="pill">{t('备用客户端')}</span>
                            )}
                          </div>
                          <p>{multiplayerRoute.detail}</p>
                          <div className="tag-row">
                            <span className={`pill ${routeGroup?.enabled ? 'solid' : ''}`}>
                              {routeGroup?.enabled
                                ? t('已安装并启用')
                                : installed
                                  ? t('已安装但当前被禁用')
                                  : t('未安装')}
                            </span>
                            {routeGroup?.isAlwaysOn ? <span className="pill">{t('当前已是 Always On')}</span> : null}
                          </div>
                          <div className="action-row compact-row">
                            {installed ? (
                              <button type="button" className="ghost-button" onClick={() => setActivePage('manage')}>
                                {t('进入管理页')}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  void runInstallFromUrl(
                                    multiplayerRoute.downloadUrl,
                                    'recommendation',
                                    t('推荐安装: {modName}', { modName: multiplayerRoute.title }),
                                  )
                                }
                                disabled={workspaceBusy}
                              >
                                {t('安装此项')}
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </>
        ) : null}

        {activePage === 'search' ? (
          <>
            <section className="page-header page-hero search-hero">
              <p className="eyebrow">{t('Search')}</p>
              <h1>{t('搜索、安装，并用独立任务面板追踪状态。')}</h1>
              <p className="lede">
                {t('搜索页重新回到“上方筛选、下方结果、旁边安装器”的桌面工作流。现在详情弹窗和独立任务浮层都已补回，分类筛选也已经进入请求层，不再只是结果页前端过滤。')}
              </p>
              <div className="page-hero-metrics">
                <article className="page-hero-metric">
                  <span>{t('Online')}</span>
                  <strong>{onlineSearchResult?.totalElements ?? 0}</strong>
                </article>
                <article className="page-hero-metric">
                  <span>{t('当前镜像: {mirrorLabel}', {
                    mirrorLabel: getDownloadMirrorLabel(downloadMirror, t),
                  })}</span>
                  <strong>{getDownloadMirrorLabel(downloadMirror, t)}</strong>
                </article>
                <article className="page-hero-metric">
                  <span>{t('全部分类')}</span>
                  <strong>{onlineCategoryFilter ? getCategoryDisplayLabel(onlineCategoryFilter, t) : t('全部分类')}</strong>
                </article>
              </div>
              <div className="page-hero-actions">
                <button
                  type="button"
                  onClick={() => void searchOnlineMods(1)}
                  disabled={onlineLoading}
                >
                  {onlineLoading ? t('搜索中') : t('搜索')}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setInstallTaskPanelOpen(true)}
                >
                  {t('打开面板')}
                </button>
              </div>
            </section>

            <div className="search-layout">
              <aside className="search-side">
                <section className="panel accent">
                  <div className="panel-head">
                    <div>
                      <h2>{t('手动 URL 安装器')}</h2>
                      <p className="muted">
                        {t('输入可直接下载的 Mod zip URL。后端会下载到临时文件，校验 `everest.yaml`，再写入当前工作区的 `Mods/`。')}
                      </p>
                    </div>
                    <span className="pill">{t('Installer')}</span>
                  </div>

                  {!selectedGamePath ? (
                    <p className="muted">{t('先载入一个游戏目录，再执行安装。')}</p>
                  ) : (
                    <>
                      <div className="verify-box">
                        <input
                          type="text"
                          placeholder="https://example.com/mod.zip"
                          value={installUrl}
                          onInput={(event) =>
                            setInstallUrl((event.currentTarget as HTMLInputElement).value)
                          }
                        />
                        <button
                          type="button"
                          onClick={() => void installModFromUrl()}
                          disabled={!installUrl.trim() || workspaceBusy}
                        >
                          {t('下载并安装')}
                        </button>
                      </div>

                      <div className="status-callout">
                        <strong>{t('安装后的 profile 处理')}</strong>
                        <p>
                          {getInstallProfileBehaviorDescription(
                            installProfileBehavior,
                            selectedProfileName,
                            appliedProfileName,
                            t,
                          )}
                        </p>
                        <div className="action-row compact-row">
                          <select
                            className="select-input"
                            value={installProfileBehavior}
                            onChange={(event) =>
                              setInstallProfileBehavior(
                                (event.currentTarget as HTMLSelectElement)
                                  .value as InstallProfileBehavior,
                              )
                            }
                          >
                            {installProfileBehaviorOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <label className="toggle-item compact-toggle">
                        <input
                          type="checkbox"
                          checked={installDependencies}
                          onChange={(event) => setInstallDependencies(event.currentTarget.checked)}
                        />
                        <span>
                          <strong>{t('同时安装缺失的硬依赖')}</strong>
                          <small>{t('只处理 `Dependencies`，不递归安装 `OptionalDependencies`。')}</small>
                        </span>
                      </label>

                      {installResult ? (
                        <div className="status-callout">
                          <strong>
                            {t('最近一次安装: {modName} v{version}', {
                              modName: installResult.installedMod.name,
                              version: installResult.installedMod.version,
                            })}
                          </strong>
                          <p>{t('保存路径: {savedPath}', { savedPath: installResult.savedPath })}</p>
                          <p>
                            {t('依赖:')}
                            {' '}
                            {installResult.installedMod.deps.length
                              ? summarizeDeps(installResult.installedMod.deps, t)
                              : t('无显式依赖')}
                          </p>
                          <p>
                            {t('替换旧文件:')}
                            {' '}
                            {installResult.replacedFiles.length
                              ? installResult.replacedFiles.join(', ')
                              : t('无')}
                          </p>
                          <p>
                            {t('安装策略:')}
                            {' '}
                            {getInstallProfileBehaviorLabel(installResult.installProfileBehavior, t)}
                          </p>
                          <p>
                            {t('Profile 处理结果:')}
                            {' '}
                            {summarizeInstallProfileOutcome(installResult, t)}
                          </p>
                          <p>
                            {t('应用到磁盘的 profile:')}
                            {' '}
                            {installResult.appliedProfile ?? t('无')}
                          </p>
                          <p>
                            {t('被更新的 profile:')}
                            {' '}
                            {installResult.updatedProfiles.length
                              ? installResult.updatedProfiles.join(', ')
                              : t('无')}
                          </p>
                          <p>
                            {t('依赖处理结果:')}
                            {' '}
                            {installResult.dependencyResults.length
                              ? installResult.dependencyResults
                                  .map((item) => {
                                    const suffix = item.resolvedVersion ? ` -> ${item.resolvedVersion}` : '';
                                    return `${item.name} [${item.status}]${suffix}`;
                                  })
                                  .join(', ')
                              : t('无')}
                          </p>
                        </div>
                      ) : null}
                    </>
                  )}
                </section>

                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>{t('下载任务面板')}</h2>
                      <p className="muted">{t('任务记录现在独立成全局浮层，Home / Search / Manage 都能打开查看。')}</p>
                    </div>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setInstallTaskPanelOpen(true)}
                    >
                      {t('打开面板')}
                    </button>
                  </div>

                  <div className="task-overview-grid compact-task-overview-grid">
                    <article className="task-overview-card">
                      <span>{t('进行中')}</span>
                      <strong>{runningInstallTaskCount}</strong>
                    </article>
                    <article className="task-overview-card">
                      <span>{t('已完成')}</span>
                      <strong>{succeededInstallTaskCount}</strong>
                    </article>
                    <article className="task-overview-card">
                      <span>{t('失败')}</span>
                      <strong>{failedInstallTaskCount}</strong>
                    </article>
                  </div>

                  {latestInstallTask ? (
                    <article className={`task-card task-summary-card ${latestInstallTask.status}`}>
                      <div className="panel-head">
                        <div>
                          <h3>{latestInstallTask.title}</h3>
                          <p className="muted">{getInstallTaskSourceLabel(latestInstallTask.source, t)}</p>
                        </div>
                        <span
                          className={`pill ${latestInstallTask.status === 'succeeded' ? 'solid' : latestInstallTask.status === 'failed' ? 'warn' : ''}`}
                        >
                          {getInstallTaskStatusLabel(latestInstallTask.status, t)}
                        </span>
                      </div>
                      <p className="task-message">{latestInstallTask.message}</p>
                      <p className="muted task-time">
                        {t('开始时间 {time}', {
                          time: new Date(latestInstallTask.startedAt).toLocaleTimeString(currentLanguage),
                        })}
                        {latestInstallTask.finishedAt
                          ? t(' · 结束时间 {time}', {
                              time: new Date(latestInstallTask.finishedAt).toLocaleTimeString(currentLanguage),
                            })
                          : ''}
                      </p>
                    </article>
                  ) : (
                    <p className="muted">
                      {t('还没有安装任务记录。之后无论从哪个页面发起安装、更新或依赖修复，都可以在这个独立任务面板里查看。')}
                    </p>
                  )}
                </section>
              </aside>

                <section className="panel search-main-panel">
                  <div className="panel-head">
                    <div>
                      <h2>{t('在线 Mod 搜索')}</h2>
                      <p className="muted">
                        {t('通过 `wegfan` 搜索线上 Mod。当前保留关键字、排序、分页与一键安装，分类筛选也已经进入请求层，分页和总数会随筛选一起变化。')}
                      </p>
                    </div>
                    <div className="tag-row">
                      <span className="pill">{t('Online')}</span>
                      <span className="pill">{getDownloadMirrorLabel(downloadMirror, t)}</span>
                    </div>
                  </div>

                <div className="search-toolbar">
                  <input
                    type="text"
                    className="filter-input"
                    placeholder={t('输入名称或关键字')}
                    value={onlineQuery}
                    onInput={(event) => setOnlineQuery((event.currentTarget as HTMLInputElement).value)}
                  />
                  <select
                    className="select-input"
                    value={onlineSort}
                    onChange={(event) =>
                      setOnlineSort((event.currentTarget as HTMLSelectElement).value as typeof onlineSort)
                    }
                  >
                    <option value="likes">{t('最多点赞')}</option>
                    <option value="new">{t('最近发布')}</option>
                    <option value="updateAdded">{t('最近添加')}</option>
                    <option value="updated">{t('最近更新')}</option>
                    <option value="views">{t('最多浏览')}</option>
                  </select>
                  <button type="button" onClick={() => void searchOnlineMods(1)} disabled={onlineLoading}>
                    {onlineLoading ? t('搜索中') : t('搜索')}
                  </button>
                </div>

                {availableOnlineCategories.length ? (
                  <div className="search-category-strip">
                    <button
                      type="button"
                      className={`category-chip ${onlineCategoryFilter ? '' : 'active'}`}
                      onClick={() => applyOnlineCategoryFilter('')}
                    >
                      {t('全部分类')}
                    </button>
                    {availableOnlineCategories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        className={`category-chip ${onlineCategoryFilter === category ? 'active' : ''}`}
                        onClick={() => applyOnlineCategoryFilter(category)}
                      >
                        {getCategoryDisplayLabel(category, t)}
                      </button>
                    ))}
                  </div>
                ) : null}

                {workspaceMessage ? <p className="verify-result">{workspaceMessage}</p> : null}

                {onlineSearchResult ? (
                  <>
                    <div className="search-result-meta">
                      <p className="muted">
                        {t('第 {currentPage} / {totalPages} 页，共 {totalElements} 条结果，当前页展示 {pageCount} 条。', {
                          currentPage: onlineSearchResult.currentPage,
                          totalPages: Math.max(onlineSearchResult.totalPages, 1),
                          totalElements: onlineSearchResult.totalElements,
                          pageCount: visibleOnlineMods.length,
                        })}
                      </p>
                      <span className="pill">{onlineCategoryFilter ? getCategoryDisplayLabel(onlineCategoryFilter, t) : t('全部分类')}</span>
                    </div>

                    {visibleOnlineMods.length ? (
                      <div className="online-grid">
                        {visibleOnlineMods.map((onlineMod) => {
                          const installed = mods.some((mod) => mod.name === onlineMod.name);
                          return (
                            <article key={onlineMod.id} className="online-card">
                              <div className="online-card-head">
                                <div>
                                  <h3>{onlineMod.name}</h3>
                                  <p className="muted">
                                    v{onlineMod.version}
                                    {onlineMod.categoryName ? ` · ${getCategoryDisplayLabel(onlineMod.categoryName, t)}` : ''}
                                    {' · '}
                                    {onlineMod.submitter}
                                  </p>
                                </div>
                                <div className="tag-row">
                                  <span className={`pill ${installed ? 'solid' : ''}`}>
                                    {installed ? t('已安装') : t('未安装')}
                                  </span>
                                  <span className="pill">{formatBytes(onlineMod.size)}</span>
                                  <span className="pill">{t('{count} 下载', { count: onlineMod.downloads })}</span>
                                </div>
                              </div>
                              <p className="online-description">
                                {stripHtml(onlineMod.description) || t('没有可展示的描述。')}
                              </p>
                              <div className="action-row compact-row">
                                <button
                                  type="button"
                                  className="ghost-button"
                                  onClick={() => setSelectedOnlineMod(onlineMod)}
                                  disabled={workspaceBusy}
                                >
                                  {t('查看详情')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void runInstallFromUrl(
                                      onlineMod.downloadUrl,
                                      'search',
                                      t('在线安装: {modName}', { modName: onlineMod.name }),
                                    )
                                  }
                                  disabled={workspaceBusy || !selectedGamePath}
                                >
                                  {t('安装此 Mod')}
                                </button>
                                <button
                                  type="button"
                                  className="ghost-button"
                                  onClick={() => openManualInstaller(onlineMod.downloadUrl)}
                                  disabled={workspaceBusy}
                                >
                                  {t('填入手动安装器')}
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="muted">{t('当前过滤条件下没有命中结果。')}</p>
                    )}

                    <div className="action-row compact-row">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void searchOnlineMods(onlinePage - 1)}
                        disabled={onlineLoading || !onlineSearchResult.hasPreviousPage}
                      >
                        {t('上一页')}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void searchOnlineMods(onlinePage + 1)}
                        disabled={onlineLoading || !onlineSearchResult.hasNextPage}
                      >
                        {t('下一页')}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted">{t('尚未发起在线搜索。')}</p>
                )}
              </section>
            </div>
          </>
        ) : null}

        <footer className="shell-statusbar">
          <div className="status-cluster">
            <span className={`status-dot ${workspaceLoaded ? 'ok' : ''}`} />
            <span className="status-text">{workspaceLoaded ? t('工作区已载入') : t('未载入目录')}</span>
            <span className={`pill ${failedInstallTaskCount ? 'warn' : runningInstallTaskCount ? 'solid' : ''}`}>
              {runningInstallTaskCount
                ? t('{count} 进行中', { count: runningInstallTaskCount })
                : failedInstallTaskCount
                  ? t('{count} 失败', { count: failedInstallTaskCount })
                  : installTasks.length
                    ? t('{count} 记录', { count: installTasks.length })
                    : t('暂无任务')}
            </span>
            <span className="status-path">{selectedGamePath || manualPath || t('等待目录')}</span>
          </div>

          <div className="status-cluster status-cluster-end">
            <span className="status-text">
              {(runtimeDiagnostics?.xdgSessionType ?? 'unknown').toUpperCase()}
            </span>
            <span className="status-text">{getDownloadMirrorLabel(downloadMirror, t)}</span>
            <span className="status-text">{appInfo?.version ? `v${appInfo.version}` : t('读取版本中')}</span>
          </div>
        </footer>
        </div>

        {selectedOnlineMod ? (
          <div
            className="detail-overlay"
            onClick={() => setSelectedOnlineMod(null)}
          >
            <article
              className="detail-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="detail-modal-head">
                <div>
                  <p className="eyebrow">{t('Search Detail')}</p>
                  <h2>{selectedOnlineMod.name}</h2>
                  <p className="detail-subtitle">
                    {selectedOnlineMod.subtitle?.trim() || t('当前结果没有额外副标题。')}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button detail-close-button"
                  onClick={() => setSelectedOnlineMod(null)}
                >
                  {t('关闭')}
                </button>
              </div>

              <div className="detail-pill-row">
                <span className="pill solid">v{selectedOnlineMod.version}</span>
                <span className="pill">{getCategoryDisplayLabel(selectedOnlineMod.categoryName, t)}</span>
                <span className="pill">{t('{count} 下载', { count: selectedOnlineMod.downloads })}</span>
                <span className="pill">{t('{count} 点赞', { count: selectedOnlineMod.likes })}</span>
                <span className="pill">{t('{count} 浏览', { count: selectedOnlineMod.views })}</span>
                <span className="pill">{formatBytes(selectedOnlineMod.size)}</span>
              </div>

              <div className="detail-meta-grid">
                <article className="detail-meta-card">
                  <span>{t('提交者')}</span>
                  <strong>{selectedOnlineMod.submitter}</strong>
                </article>
                <article className="detail-meta-card">
                  <span>{t('作者')}</span>
                  <strong>
                    {selectedOnlineMod.authorNames.length
                      ? selectedOnlineMod.authorNames.join(' / ')
                      : selectedOnlineMod.submitter}
                  </strong>
                </article>
                <article className="detail-meta-card">
                  <span>{t('最近更新')}</span>
                  <strong>{formatAbsoluteTime(selectedOnlineMod.latestUpdateAddedTime, t, currentLanguage)}</strong>
                </article>
                <article className="detail-meta-card">
                  <span>{t('GameBanana ID')}</span>
                  <strong>{selectedOnlineMod.gameBananaId ?? t('无')}</strong>
                </article>
              </div>

              {selectedOnlineMod.screenshotUrls.length ? (
                <div className="detail-gallery">
                  {selectedOnlineMod.screenshotUrls.map((url) => (
                    <img key={url} src={url} alt="" loading="lazy" />
                  ))}
                </div>
              ) : null}

              <div
                className="detail-description"
                dangerouslySetInnerHTML={{ __html: selectedOnlineModDescriptionHtml }}
              />

              <div className="detail-code-grid">
                {selectedOnlineMod.pageUrl ? (
                  <div>
                    <span>{t('发布页')}</span>
                    <code>{selectedOnlineMod.pageUrl}</code>
                  </div>
                ) : null}
                <div>
                  <span>{t('下载地址')}</span>
                  <code>{selectedOnlineMod.downloadUrl}</code>
                </div>
              </div>

              <div className="action-row">
                <button
                  type="button"
                  onClick={() =>
                    void runInstallFromUrl(
                      selectedOnlineMod.downloadUrl,
                      'search',
                      t('在线安装: {modName}', { modName: selectedOnlineMod.name }),
                    )
                  }
                  disabled={workspaceBusy || !selectedGamePath}
                >
                  {t('安装此 Mod')}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => openManualInstaller(selectedOnlineMod.downloadUrl)}
                  disabled={workspaceBusy}
                >
                  {t('填入手动安装器')}
                </button>
                {selectedOnlineMod.pageUrl ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void invoke('open_url', { url: selectedOnlineMod.pageUrl })}
                  >
                    {t('打开发布页')}
                  </button>
                ) : null}
              </div>
            </article>
          </div>
        ) : null}

        {installTaskPanelOpen ? (
          <div
            className="detail-overlay task-overlay"
            onClick={() => setInstallTaskPanelOpen(false)}
          >
            <article
              className="task-drawer"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="detail-modal-head task-drawer-head">
                <div>
                  <p className="eyebrow">{t('任务')}</p>
                  <h2>Task Architect</h2>
                  <p className="detail-subtitle">
                    {t('手动安装、在线安装、推荐批量安装、更新和依赖修复都会在这里汇总，不再只挂在搜索页侧栏。')}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button detail-close-button"
                  onClick={() => setInstallTaskPanelOpen(false)}
                >
                  {t('关闭')}
                </button>
              </div>

              <section className="task-drawer-section">
                <div className="task-section-head">
                  <h3>{t('当前仍在执行的任务')}</h3>
                  <span className={`pill ${runningInstallTaskCount ? 'solid' : ''}`}>
                    {runningInstallTaskCount ? t('{count} 进行中', { count: runningInstallTaskCount }) : t('暂无任务')}
                  </span>
                </div>
                {runningTasks.length ? (
                  <div className="task-architect-list">
                    {runningTasks.map((task) => (
                      <article key={task.id} className="task-architect-card running">
                        <div className="task-architect-head">
                          <div>
                            <strong>{task.title}</strong>
                            <p>{getInstallTaskSourceLabel(task.source, t)}</p>
                          </div>
                          <span className="pill solid">{getInstallTaskStatusLabel(task.status, t)}</span>
                        </div>
                        <div className="task-progress-track">
                          <div
                            className="task-progress-value"
                            style={{ width: `${Math.round(getTaskProgressRatio(task) * 100)}%` }}
                          />
                        </div>
                        <div className="task-architect-meta">
                          <span>{formatRelativeTimestamp(task.startedAt, currentLanguage)}</span>
                          <span>{Math.round(getTaskProgressRatio(task) * 100)}%</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">{t('当前还没有安装、更新或依赖修复任务。')}</p>
                )}
              </section>

              <section className="task-drawer-section">
                <div className="task-section-head">
                  <h3>{t('系统维护')}</h3>
                  <span className={`pill ${maintenanceTasks.some((task) => task.status === 'failed') ? 'warn' : ''}`}>
                    {maintenanceTasks.length ? t('{count} 记录', { count: maintenanceTasks.length }) : t('暂无任务')}
                  </span>
                </div>
                {maintenanceTasks.length ? (
                  <div className="task-maintenance-list">
                    {maintenanceTasks.map((task) => (
                      <article key={task.id} className={`task-maintenance-card ${task.status}`}>
                        <div>
                          <strong>{task.title}</strong>
                          <p>{task.message}</p>
                        </div>
                        <span className={`pill ${task.status === 'failed' ? 'warn' : task.status === 'succeeded' ? 'solid' : ''}`}>
                          {getInstallTaskStatusLabel(task.status, t)}
                        </span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">{t('当前没有管理类维护任务。')}</p>
                )}
              </section>

              <section className="task-drawer-section">
                <div className="task-section-head">
                  <h3>{t('最近已完成的安装或维护')}</h3>
                  <span className={`pill ${failedInstallTaskCount ? 'warn' : ''}`}>
                    {failedInstallTaskCount ? t('有失败') : t('已完成')}
                  </span>
                </div>
                {completedTasks.length ? (
                  <div className="task-completed-list">
                    {completedTasks.map((task) => (
                      <article key={task.id} className="task-completed-row">
                        <div className="task-completed-main">
                          <span className={`task-completed-dot ${task.status}`} />
                          <div>
                            <strong>{task.title}</strong>
                            <p>{formatRelativeTimestamp(task.finishedAt ?? task.startedAt, currentLanguage)}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="ghost-button mini-button"
                          onClick={() => setInstallTaskPanelOpen(true)}
                        >
                          {getInstallTaskStatusLabel(task.status, t)}
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">{t('当前没有已结束任务。')}</p>
                )}
              </section>

              <div className="task-drawer-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={clearFinishedInstallTasks}
                  disabled={!finishedInstallTaskCount}
                >
                  {t('清理已结束任务')}
                </button>
                <button
                  type="button"
                  onClick={() => setInstallTaskPanelOpen(false)}
                >
                  {runningInstallTaskCount ? t('继续浏览页面') : t('关闭')}
                </button>
              </div>
            </article>
          </div>
        ) : null}

        {activePage === 'recommendMods' ? (
          <>
            <section className="page-header recommendation-hero recommendation-mods-hero">
              <div className="recommendation-hero-copy">
                <p className="eyebrow">{t('Recommend Mods')}</p>
                <h1>{t('先恢复原版的常用模组入口。')}</h1>
                <p className="lede">
                  {t('推荐模组页应该是“装常用工具”和“装外观模组”的轻量入口，不该与搜索和管理混成一页。')}
                </p>
                <div className="action-row compact-row">
                  <button
                    type="button"
                    onClick={() =>
                      featuredRecommendedModSection
                        ? void installRecommendedMods(
                            featuredRecommendedModSection.mods.filter((item) => item.batchInstall !== false),
                          )
                        : undefined
                    }
                    disabled={!featuredRecommendedModSection || workspaceBusy || !workspaceLoaded}
                  >
                    {t('批量安装可批量项')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setActivePage('search')}
                    disabled={!workspaceLoaded || workspaceBusy}
                  >
                    {t('搜索模组')}
                  </button>
                </div>
              </div>

              <div className="recommendation-mods-grid">
                {recommendationModHeroItems.map((item) => {
                  const installed = mods.some((installedMod) => installedMod.name === item.name);
                  return (
                    <article key={item.name} className="recommendation-mod-spotlight">
                      <div className="recommendation-mod-symbol">
                        {getTaskMonogram(item.displayName ?? item.name, item.name)}
                      </div>
                      <div className="recommendation-mod-copy">
                        <div className="tag-row">
                          <span className={`pill ${installed ? 'solid' : ''}`}>
                            {installed ? t('已安装') : t('未安装')}
                          </span>
                          {item.batchInstall === false ? <span className="pill">{t('仅单装')}</span> : null}
                        </div>
                        <strong>{item.displayName ?? item.name}</strong>
                        <p className="muted">{item.description}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            {renderRecommendationBlocks(
              recommendationModSections,
              t('推荐模组'),
              t('先回到原版的两类心智模型：功能性模组和外观模组。后续会继续补更接近原版的分组和文案风格。'),
            )}
          </>
        ) : null}

        {activePage === 'recommendMaps' ? (
          <>
            <section
              className="page-header recommendation-hero recommendation-map-hero"
              style={{
                backgroundImage: featuredRecommendedMap?.coverImage
                  ? `linear-gradient(180deg, rgba(12, 14, 23, 0.18), rgba(12, 14, 23, 0.96)), url(${featuredRecommendedMap.coverImage})`
                  : undefined,
                backgroundPosition: featuredRecommendedMap?.coverPosition ?? 'center center',
              }}
            >
              <div className="recommendation-hero-copy">
                <div className="tag-row">
                  <span className="pill solid">{t('Recommend Maps')}</span>
                  {featuredRecommendedMap?.alias ? <span className="pill">{featuredRecommendedMap.alias}</span> : null}
                </div>
                <h1>{featuredRecommendedMap?.displayName ?? t('把地图入口重新独立出来。')}</h1>
                <p className="lede">
                  {featuredRecommendedMap?.highlight ?? t('推荐地图页现在重新回到“先看封面和氛围，再决定装哪张图”的节奏，不再只是文本列表。')}
                </p>
                {featuredRecommendedMap?.metrics?.length ? (
                  <div className="recommendation-map-metrics">
                    {featuredRecommendedMap.metrics.map((metric) => (
                      <article key={`${featuredRecommendedMap.name}-${metric.label}`} className="recommendation-map-metric">
                        <span>{metric.label}</span>
                        <strong>{metric.value}</strong>
                      </article>
                    ))}
                  </div>
                ) : null}
                <div className="action-row compact-row">
                  <button
                    type="button"
                    onClick={() =>
                      featuredRecommendedMap
                        ? void runInstallFromUrl(
                            featuredRecommendedMap.downloadUrl,
                            'recommendation',
                            t('推荐安装: {modName}', { modName: featuredRecommendedMap.name }),
                          )
                        : undefined
                    }
                    disabled={!featuredRecommendedMap || workspaceBusy || !workspaceLoaded}
                  >
                    {t('安装此项')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setActivePage('manage')}
                    disabled={!workspaceLoaded || workspaceBusy}
                  >
                    {t('管理本地 Mod')}
                  </button>
                </div>
              </div>
            </section>
            {renderMapRecommendationBlocks(
              recommendationMapSections,
              t('推荐地图'),
              t('大型图包和代表性独立地图先独立成图像卡片页，先看气质、体量和难度，再决定是否安装。'),
            )}
          </>
        ) : null}

        {error ? <section className="panel error">{error}</section> : null}
      </div>

      {workspaceLoaded || installTasks.length ? (
        <button
          type="button"
          className={`task-fab ${installTaskPanelOpen ? 'active' : ''}`}
          onClick={() => setInstallTaskPanelOpen(true)}
        >
          <span>{t('任务')}</span>
          <strong>{runningInstallTaskCount || installTasks.length}</strong>
          <small>
            {runningInstallTaskCount
              ? t('进行中')
              : failedInstallTaskCount
                ? t('有失败')
                : installTasks.length
                  ? t('查看记录')
                  : t('空闲')}
          </small>
        </button>
      ) : null}
    </main>
  );
}
