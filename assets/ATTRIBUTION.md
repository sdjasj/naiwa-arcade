# 奶蛙素材来源

本站中的奶蛙是互联网「大笑奶龙 / 奶蛙」二创梗形象：黄色身体、奶油色大肚皮、绿色眼白与小黑瞳。不是普通绿色青蛙，也不是官方授权产品。

## 随站点保存的素材

| 文件 | 来源 | 用途 |
| --- | --- | --- |
| `naifrog-sheet.webp` | [NaiLoong / 奶-hub 图集](https://github.com/lin-alg/NaiLoong/blob/main/assets/pet/naifrog-sheet.webp) · [下载地址](https://nai-hub.com/assets/pet/naifrog-sheet.webp) | 192×208 像素每格，8 列×9 行，奶蛙站立、动作及大笑动画。 |
| `nailong_laugh.mp3` | [NaiLoong / 奶-hub 笑声音频](https://github.com/lin-alg/NaiLoong/blob/main/assets/audio/nailong_laugh.mp3) · [下载地址](https://nai-hub.com/assets/audio/nailong_laugh.mp3) | 播放短片段，配合碰撞、发射和嘲笑反馈。来源站点将其标注为「咳哈哈哈哈~」。 |
| `animation/naiwa-motion-v1.webp` | 以原奶蛙图集为外形参考，使用内置 image_gen 工具生成 | 6 列×4 行，共 24 帧：呼吸待机、连续跑步、冲刺、捧腹大笑。 |
| `animation/naiwa-combat-v1.webp` | 同一角色参考，经 image_gen 生成 | 6 列×4 行，共 24 帧：轻拳、肚皮重击、受击、格挡。 |

来源项目：**[lin-alg/NaiLoong](https://github.com/lin-alg/NaiLoong)**，作者署名 **linalg**。素材于 2026-10-13 下载，随游戏本地提供；游戏运行时不会向素材站点发送请求。

三套新动作图集于 2026-10-13 生成，为保持透明通道的 WebP，共约 1.27 MiB；并非官方动作素材。源 PNG 和生成提示词保存在源代码仓库的 `output/imagegen/`，不包含在网站构建内。脚底锚点由透明轮廓计算，避免帧切换时人物上下抖动。新增笑声使用已有本地 MP3 的不同片段与轻微变调，未增加外部请求或新录音。

新增 `animation/naiwa-footwork-v1.webp` 由内置 image_gen 以战斗图集为角色参考生成：6 列×4 行，包含后退、跳跃、空中拳和空中脚共 24 帧。透明通道、单帧边界和脚底锚点均已校验。

## 新增奶家人角色与语音（v7.1）

奶蛋、奶狗与奶鼠的形象参考用户指定的 B 站 UP 主 [奶史_](https://space.bilibili.com/3707004881210316) 的公开视频：

- [选择奶蛋还是奶狗？](https://www.bilibili.com/video/BV14yto62ESb/)：无四肢的黄色奶蛋；黄身、棕色垂耳、奶油胸腹、四足和弯尾的奶狗。
- [选择奶鼠还是奶蛋？](https://www.bilibili.com/video/BV1WXgV66EjY/)：大圆耳、绿眼圈、短四肢和细长尾的黄色奶鼠。
- [选择奶蛋还是奶蛙？](https://www.bilibili.com/video/BV1aN8n6sEGP/)：核对奶蛋的眼圈、嘴形与连续蛋形轮廓。

`cast/naidan-v1.webp`、`cast/naigou-v1.webp`、`cast/naishu-v1.webp` 是参考上述形象、经内置 imagegen 生成的游戏动画图集；不直接使用视频封面作游戏精灵，也不表示原作者制作或授权这些动作帧。生成提示词与源 PNG 在源代码仓库的 `output/imagegen/`，网站仅部署优化后的透明 WebP。

`voices/kakatte.mp3` 为不知火舞语音合集的短录音片段。v7.1.1 的 `voices/andy-v2.mp3` 改为用户明确指定的奶史_ [《选择奶蛙还是奶蛋？》约 7 秒处](https://www.bilibili.com/video/BV1WGGN6XE2U/?t=7)的“安迪”，保留该视频中的音高与速度；已移除上一版采用其他语音合集的 `voices/andy.mp3`。详细来源、原台词和切点见 [语音来源](https://github.com/sdjasj/naiwa-arcade/blob/main/docs/voice-sources.md)。上述参考视频与完整音轨没有打包进网站。

## 既有素材授权说明

来源仓库 [README](https://github.com/lin-alg/NaiLoong#readme) 对代码与图片作了区分：代码采用 MIT；仓库自带图片注明来源即可使用；仓库引用的社区图片如用于商业项目，需要征得原作者同意。原始 MIT 文本保存在 [LICENSE-NaiLoong.txt](./LICENSE-NaiLoong.txt)。

该仓库未为笑声音频单独提供详细许可证，也未声明拥有原始角色或所有社区二创素材的权利。因此这里保留具体来源，不将第三方形象、图片及音频权利统一描述为 MIT。本站为非商业小游戏与技术练习，相关角色、图片和声音权利归各自权利人所有。

## 外形核对参考

- [奶-hub 奶蛙表情库](https://nai-hub.com/)
- [奶蛙摸肚子梗图](https://raw.githubusercontent.com/musemantic/NaiLoong/ab974a47c2a5e731a22ff9f5a7f23f60e62c3fd9/assets/memes/naiwa_0029.jpg)
- [奶蛙形象说明](https://neta.art/app/milk-frog-wiki)

以上参考图片未另行打包进游戏。
