# Localization

CeleMod Wayland Native 内置 `zh-CN` 与 `en-US` 两套语言包，并支持从本地配置目录加载额外翻译包。

## 自定义翻译包目录
- Linux 路径：`$XDG_CONFIG_HOME/celemod-wayland-native/locales`
- 如果未设置 `XDG_CONFIG_HOME`，通常等价于：`~/.config/celemod-wayland-native/locales`

应用会在启动时扫描该目录下的 `*.json` 文件，并把可用语言加入首页语言列表。

## 推荐 JSON 格式
```json
{
  "code": "ja-JP",
  "label": "日本語",
  "messages": {
    "主页": "ホーム",
    "搜索": "検索",
    "管理": "管理",
    "启动游戏": "ゲームを起動",
    "打开 Mods 文件夹": "Mods フォルダを開く"
  }
}
```

也支持扁平格式：
```json
{
  "code": "pirate-en",
  "label": "Pirate English",
  "主页": "Harbor",
  "搜索": "Hunt",
  "管理": "Deck"
}
```

## 字段说明
- `code`: 建议使用语言代码，例如 `ja-JP`、`es-ES`
- `label`: 语言列表中显示的名字
- `messages`: 以源码中的源字符串为 key 的翻译表

## 加载规则
- 未提供的 key 会回退到内置文案
- JSON 解析失败或没有有效翻译时，应用会在语言面板中显示加载错误
- 更新翻译包后，重启应用即可重新扫描并载入
