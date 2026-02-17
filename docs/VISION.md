# BiliSorter - Vision

> AI-powered Chrome extension to organize your Bilibili favorites — sort hundreds of unsorted videos in minutes, not hours.

---

## Mission

B站用户平均收藏 200-500 个视频，绝大多数堆在"默认收藏夹"里再也找不到。现有工具要么是基于关键词的机械匹配，要么是要求用户逐条手动分类。BiliSorter 用 AI 理解视频内容（标题、分区、UP主、标签），为每个视频推荐最佳收藏夹，一键移动。

它不是一个收藏管理器，不是视频下载器——它是一个一次性的整理工具，用完即走。

---

## Target Users

| Persona | Pain | What BiliSorter does |
|---------|------|----------------------|
| 重度收藏用户 | 默认收藏夹 500+ 视频，找不到任何东西 | AI 批量分类，10 分钟整理完 |
| 收藏夹强迫症 | 想按分区/主题整理但手动太累 | 自动生成分类建议，一键执行 |
| 信息囤积者 | "先收藏了再说"，但从不回头看 | 整理后的收藏夹重新变得有用 |

Primary market: 个人用户（中文互联网 B 站用户）。不面向 UP 主（他们的需求是管理自己的视频，不是收藏）。

---

## Core Principles

1. **用完即走** — 这不是一个需要"日常使用"的工具。打开 → 索引收藏夹 → 加载源视频 → 生成建议 → 点击移动 → 关闭。整个流程 5-10 分钟。下次收藏夹又乱了再来。

2. **AI 辅助决策，不代替决策** — AI 建议收藏夹 + 置信度，用户决定是否移动。不自动执行，不静默操作。每一步都可见、可控。

3. **三池分离** — 收藏夹索引（结构元数据）、源视频队列（待处理内容）、AI建议（衍生数据）是三个独立的数据池，各自有清晰的触发条件和生命周期。用户只看到两个数字：文件夹数量和当前加载的视频数量。

3. **零配置启动（B站侧）** — 不需要额外登录、注册或授权。只要用户在 B 站已登录，插件自动读取 cookie。唯一的前置配置是用户提供自己的 Claude API Key（用于 AI 分类）。

4. **本地优先，隐私安全** — 无后端服务器。Cookie 不离开浏览器。视频数据不上传。唯一的外部请求是用户自己配置的 LLM API。

5. **极简 UI** — Popup 里一个列表、几个按钮。不做 dashboard，不做数据分析，不做推荐系统。克制地只做分类这一件事。

6. **容错 > 效率** — 5 秒撤销 toast 优先于批量一键操作。误操作的成本远大于多点几下的成本。

---

## Product Shape

### What BiliSorter is
- 一个 Chrome 扩展（Manifest V3），Popup + Side Panel 为交互界面
- 读取用户的 B 站收藏夹，展示视频列表
- 调用 LLM（Claude / Gemini）为每个视频生成收藏夹分类建议
- 一键将视频移动到建议的收藏夹，支持 5 秒撤销
- AI 收藏夹顾问：多轮对话分析收藏现状，提供合并/拆分/重命名建议
- 收藏夹管理：拖拽排序、批量重命名、排序按钮

### What BiliSorter is not
- **不是收藏管理器** — 支持收藏夹排序和重命名，但不做创建/删除。v1 计划加入从 Popup 内创建收藏夹的能力。
- **不是视频播放器或下载器** — 不涉及视频内容本身
- **不是推荐系统** — 不推荐新视频，只整理已收藏的
- **不是数据分析工具** — AI 顾问提供收藏夹结构分析，但不做深度统计/趋势分析

---

## Origin

BiliSorter 源自 RainSorter（github.com/dimpurr/rainsorter），一个为 Raindrop.io 书签做 AI 分类的 web app。核心洞察相同：**用户有整理的意愿，缺的是执行的效率**。BiliSorter 将这个模式从书签迁移到 B 站视频收藏。

关键差异：RainSorter 是 web app + OAuth + 后端代理；BiliSorter 是纯浏览器扩展 + cookie 认证，零后端，更轻量。

---

## Document Hierarchy

This document defines **why** BiliSorter exists and its direction.

For **what** (architecture, data flow, features): see `HLD.md`
For **research backlog** (API surface, competitive analysis, initial explorations): see `research-log-n-suggestion.md`
For **discussion** (detailed tech/feature debates): see `initial-discussion-log.md`

---

*2026-02*
