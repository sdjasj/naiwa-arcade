# 奶蛙摸鱼乐园

三款以互联网「大笑奶蛙」为主角的浏览器小游戏。角色采用黄色梨形身体、奶油大肚皮、绿眼小黑瞳的奶蛙动画图集，搭配对应笑声音频。

**在线游玩：<https://sdjasj.github.io/naiwa-arcade/>**

| 游戏 | 玩法 | 操作 |
| --- | --- | --- |
| 奶蛙飞不动 | 拍翅穿水管，碰撞挤扁后大笑，难度渐进 | 点击 / 触屏 / 空格 / ↑ |
| 愤怒的奶蛙 | 三关弹弓挑战，每关三发，建筑坍塌和奶蛙反弹 | 向后拖动松手；↑↓ 角度，←→ 力度，空格发射 |
| 暴打奶蛙 | 九个洞、30 秒挑战、表情切换、连击奖励和逃脱嘲笑 | 点击 / 触屏 / 数字 1–9 |

支持暂停续玩、重开、浏览器全屏、声音开关，以及每款游戏独立的本机最高分。切换页面或窗口失焦时自动暂停；拖动弹弓中断时不消耗弹药。

## 本地运行

纯 HTML、CSS、原生 JavaScript 和 Canvas 2D，无前端运行时依赖或后端服务。所有游戏素材均随仓库保存。

```sh
python3 -m http.server 8080
```

访问 <http://localhost:8080>。请通过 HTTP 打开，以便浏览器加载 ES 模块及音频。

## 验证与构建

```sh
npm ci
npm test
npm run test:browser
npm run build
```

浏览器测试使用 Playwright Chromium。新环境先执行 `npx playwright install chromium`；也可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定现有 Chromium 路径。测试覆盖电脑与手机输入、游戏切换、胜负计分、暂停、重开和本地存储。构建结果在 `dist/`，只包含公开网页及游戏素材。

## GitHub Pages

源代码位于 `main` 分支，网站构建产物位于 `gh-pages` 分支。GitHub Pages 的发布源设置为 `gh-pages` 的根目录。部署后的访问路径为 `/naiwa-arcade/`，资源路径均为相对路径，无需修改域名配置。

更新时运行构建，将 `dist/` 的内容发布到 `gh-pages` 并推送。无需令牌写入源代码、网页或构建产物。

## 结构

```text
index.html              页面与玩法说明
styles.css              自适应布局
js/app.js               游戏切换、输入、暂停、计分与帧循环
js/frog.js              奶蛙帧动画、封面与翅膀
js/audio.js             本地笑声与交互音效
js/games/               三款游戏的独立逻辑与渲染
assets/                 本地图集、音频及来源说明
tests/                  逻辑与浏览器验收测试
scripts/build.mjs       静态发布目录生成
```

## 素材来源

奶蛙动画与笑声来自 [NaiLoong / linalg](https://github.com/lin-alg/NaiLoong)（[奶-hub](https://nai-hub.com/)）。完整来源与授权说明见 [assets/ATTRIBUTION.md](assets/ATTRIBUTION.md)。页面也保留来源链接。游戏为非商业同人作品；未使用经典游戏原版图片、角色、关卡或音频。

游戏成绩和音效偏好仅保存在浏览器 `localStorage`，不收集个人信息，不需要注册或登录。
