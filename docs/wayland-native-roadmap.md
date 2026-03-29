# Wayland Native Architecture

本文档说明 CeleMod Wayland Native 的实现边界、技术选型和当前发布范围。

## 定位
CeleMod Wayland Native 是一个仅面向 Linux Wayland 的分支实现，目标是在保留原 CeleMod 核心工作流的前提下，提供更稳定的窗口运行环境与更直接的 Linux 打包路径。

## 技术选型
- UI runtime: `Tauri v2`
- Web frontend: `Preact + TypeScript + Vite`
- Backend: `Rust`
- 配置目录: XDG 规范，默认位于 `~/.config/celemod-wayland-native`

## 架构说明
- Celeste 目录是整个应用的工作区根路径
- Everest 作为加载器安装在同一 Celeste 目录中
- Mod 扫描、Profile、在线安装、依赖补全都围绕该工作区展开
- 前端负责页面工作流与状态展示，核心业务逻辑继续由 Rust 后端处理

## Linux / Wayland 边界
- 本项目不再维护旧 Sciter 路线
- 不再面向 Windows 与 macOS 发布
- 不提供应用内软件自更新
- 运行时诊断与兼容开关以 Wayland 环境为核心设计

## 当前发布范围
- 稳定发布目标：`.deb`、`.AppImage`
- `.rpm` 保留为单独验证产物
- 默认使用仓库内的 `.cargo-home` 完成桌面打包

## 兼容说明
在部分环境中，WebKitGTK/Wayland 仍可能需要 `WEBKIT_DISABLE_DMABUF_RENDERER=1` 这一兼容开关。项目已在启动链路中为相关场景提供处理与诊断入口。
