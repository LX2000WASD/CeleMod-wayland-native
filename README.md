# CeleMod Wayland Native

CeleMod Wayland Native 是面向 Linux Wayland 桌面的 CeleMod 分支实现，使用 `Tauri v2 + WebKitGTK + Preact/Vite + Rust` 构建。

项目目标是保留原 CeleMod 的核心使用路径，同时提供更适合现代 Linux Wayland 环境的窗口栈、打包方式和维护方式。

## 特性
- Celeste 安装目录探测、校验与自动恢复
- Everest 版本探测与 `Stable / Beta / Dev` 通道安装
- 本地 Mod 扫描、卸载、重复分组和依赖分析
- Blacklist profile 创建、切换、应用与磁盘回灌
- 在线搜索、URL 安装、推荐安装与依赖补全
- `Home / Everest / Search / Manage / Multiplayer / Recommend Mods / Recommend Maps` 多页面桌面工作流
- Wayland 运行时诊断与启动期兼容开关
- 内置 `zh-CN / en-US`，并支持外部翻译包

## 平台范围
- 仅支持 Linux
- 仅面向 Wayland 桌面环境
- 不维护旧 Sciter UI 主路径
- 不提供应用内软件自更新

## 技术栈
- Desktop shell: `Tauri v2`
- Frontend: `Preact + TypeScript + Vite`
- Backend: `Rust`
- Package manager: `pnpm`

## 开发
```bash
pnpm install
pnpm tauri:dev
```

前端构建：
```bash
pnpm build
```

桌面打包：
```bash
pnpm tauri:build
```

如需单独构建指定 bundle：
```bash
pnpm tauri:build -- --bundles deb
pnpm tauri:build -- --bundles appimage
pnpm tauri:build:rpm -- --debug
```

## 打包说明
- `pnpm tauri:dev` 和 `pnpm tauri:build` 会自动使用仓库内的 `.cargo-home`
- `pnpm tauri:build` 默认按 `deb -> appimage` 顺序分开构建
- AppImage 构建会自动注入 `NO_STRIP=1`
- 当前稳定发布目标为 `.deb` 与 `.AppImage`
- `.rpm` 保留为单独验证产物

## 本地化
自定义翻译包目录和 JSON 格式说明见 [docs/localization.md](docs/localization.md)。

## 额外说明
关于当前 Wayland 原生架构、运行时兼容约束和发布边界，见 [docs/wayland-native-roadmap.md](docs/wayland-native-roadmap.md)。
