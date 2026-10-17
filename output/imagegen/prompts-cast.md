# 奶史角色动画图集生成记录

使用内置 `image_gen`，透明背景；参考图仅用于角色外观识别，不作为最终游戏精灵发布。

参考作者：[奶史_](https://space.bilibili.com/3707004881210316)。

- 奶蛋与奶狗：[选择奶蛋还是奶狗？](https://www.bilibili.com/video/BV14yto62ESb/)。参考文件名 `BV14yto62ESb-cover.jpg`。
- 奶鼠与奶蛋：[选择奶鼠还是奶蛋？](https://www.bilibili.com/video/BV1WXgV66EjY/)。参考文件名 `BV1WXgV66EjY-cover.jpg`。
- 奶蛋近景：[选择奶蛋还是奶蛙？](https://www.bilibili.com/video/BV1aN8n6sEGP/)。参考文件名 `BV1aN8n6sEGP-cover.jpg`。

## 所有角色的固定版式

Use case: stylized-concept. Asset type: production 2D game animation sprite atlas made from softly shaded 3D character renders. Create one square transparent RGBA PNG, preferably 1536 × 1536 pixels, with EXACTLY 6 equal-width columns and EXACTLY 6 equal-height rows, 36 distinct full-body poses. Each invisible 256 × 256 cell contains exactly one instance of ONLY the requested character. No extra inset examples. Do not draw the grid. No text, labels, numbers, logos, watermarks, scenery, ground planes, cast shadows, speed lines, props, particles, or background colors. Real alpha transparency between and around the characters. Preserve antialiased alpha edges.

Use the supplied image ONLY as a character identity reference. Ignore its other character, scenery, lighting, text and watermark. Keep one consistent model, materials, color, head/body proportion, and camera across all 36 cells. Camera is a readable three-quarter front view facing RIGHT, with both eyes visible. Soft neutral studio lighting from upper left, golden yellow softly smooth material. All body parts must remain inside their own cell, leaving at least 14 pixels transparent clearance on every side; no poses cross cell borders. Grounded poses have a consistent baseline around local y=232; centered around local x=128. Keep the character large and legible while leaving room for its widest action. Jump animation changes airborne height, not body scale. Every animation row must form a coherent sequence with subtle pose-to-pose continuity.

Row 1, six columns: idle breathing loop: neutral, inhale gently, expanded, relaxed exhale, slight blink, return neutral.
Row 2, six columns: six consecutive movement-cycle poses, progressing smoothly from contact through propulsion and recovery to the next contact.
Row 3, six columns: attack sequence: anticipate, wind up, accelerate, extended impact pose, recoil, recover to idle.
Row 4, first three columns: hit reaction—small flinch, compressed/recoiling body, recovering. Last three columns: defensive guard—prepare guard, hold guard, relax guard. No weapons or shields.
Row 5, six columns: jump sequence—crouch/compress, push off, rise, apex, descend, squash landing. Keep the entire character within the cell; don't put it on a platform.
Row 6, six columns: funny belly-laugh loop—smile, open laughing mouth, eyes squeezed shut, laugh peak, body jiggle, settle into grin. Mouth shows dark interior and restrained white teeth where appropriate. Character remains recognizably the same model.

## 奶蛋 / naidan

Reference image 1 (egg-and-dog cover): use ONLY the character on the LEFT. Reference image 2 (frog-and-egg cover): use ONLY the egg character on the RIGHT to verify the face. The requested character is 奶蛋: a single golden-yellow egg-shaped blob with a rounded broad base, gently narrowing rounded top, no separate head or neck, large round green-ringed eyes with black pupils high on its body, and a tiny horizontal soft mouth beneath the eyes. Its body is completely continuous and smooth. It has ABSOLUTELY NO arms, hands, legs, feet, ears, horns, tail, eggshell crack, shell rim, exposed yolk, or white eggshell. Do not turn it into the humanoid frog from reference 2.

All six movement poses use wobbling, rocking, squash-and-stretch gliding; do not invent legs or feet. The attack is a whole-body forward body-check, with backward anticipation, forward lean, compressed impact, and rounded recovery; do not invent fists. Guard means tightening and compressing its egg body, not raising arms. Jump is a whole-body elastic hop. Laugh means opening its little mouth wider and vibrating its belly, never holding a belly with nonexistent hands. Preserve green-ringed eyes whenever open. Keep body size and eye placement consistent in all frames.

Output target: `output/imagegen/naidan-cast-v1.png`.

## 奶狗 / naigou

Reference image (egg-and-dog cover): use ONLY the dog on the RIGHT. The requested character is 奶狗: a golden-yellow QUADRUPED dog, rounded sturdy body and short stocky legs, cream/light beige chest and underside, two brown floppy downward-folded ears, darker brown toes/paws, and a thick yellow tail curving upward. Rounded head joined to body by a short visible neck. The signature expression is a broad dark laughing mouth with a curved white upper tooth line and cheerful crescent eyes. When eyes open, keep a simple friendly round-eyed expression consistent with this stylized toy model. Preserve the dog muzzle and brow shape from the reference.

Keep the character a four-legged dog in every pose—never an upright bipedal humanoid, frog, bear, or egg. The movement row is a six-pose four-legged run/trot cycle with alternating forelegs and hindlegs and a bobbing tail. Attack is a short forward pounce and playful bite: head and neck reach forward, front paws extend for landing, then recover to four feet. Guard lowers the front body and tucks the head. Jump uses all four legs, and laugh stays on all four paws while the belly and shoulders jiggle, head tilts slightly back, eyes squeeze shut, and mouth opens like the reference. Always include both floppy ears, all four legs (with natural occlusion), and the full upward-curving tail within each cell.

Output target: `output/imagegen/naigou-cast-v1.png`.

## 奶鼠 / naishu

Reference image (mouse-and-egg cover): use ONLY the mouse on the LEFT. The requested character is 奶鼠: a golden-yellow/yellow-ochre upright chubby mouse, pear-shaped belly, small rounded head continuous with a narrow upper torso, two disproportionately LARGE ROUND mouse ears with warm orange-brown inner ears, green-ringed round eyes with black pupils, a small horizontal soft mouth, very short arms and short blunt feet, and a long thin curved yellow-brown mouse tail extending behind. Retain the reference's simple toy-like muzzle, not a pointed realistic rodent snout. No clothing, gloves, shoes, big added teeth, jewelry, props, or hat.

The movement row is a short-legged bipedal six-step running cycle, tiny arms pumping, large round ears subtly bobbing and thin tail following in a curve. Attack is a short two-handed belly-driven punch sequence, with tiny fists reaching forward. Guard is both little arms raised protectively before its belly/chest. Jump keeps the round ears and entire long tail within each cell. Laugh uses its short hands on the belly, round shoulders jiggling, mouth widening and eyes squeezing shut. Preserve the huge round ears, visible thin tail and green eye rings as the key identifiers throughout.

Output target: `output/imagegen/naishu-cast-v1.png`.

## 生成与导出结果

以上「固定版式」分别与各角色段落拼接，作为三次独立内置图像生成调用的完整提示词；均启用透明背景。

实际生成的三张原始 PNG 均为 1254 × 1254 RGBA，包含 36 个独立人物姿态。原图保存在上述输出位置。`scripts/prepare-cast-frames.mjs` 识别完整人物轮廓，保留原始前景透明度与三像素抗锯齿带，剔除与人物无关的离散低透明度杂点；逐角色使用同一缩放系数，把完整耳朵、尾巴和动作归位至 256 × 256 的标准格中。

最终文件为 `assets/cast/naidan-v1.webp`、`assets/cast/naigou-v1.webp`、`assets/cast/naishu-v1.webp`，均为 1536 × 1536，6 行 × 6 列。元数据为 `js/cast-atlas.js`，逐格脚底锚点与原奶蛙图集一致，六行 `scales` 均为 1。导出校验记录在 `output/imagegen/cast-frame-validation.json`；浅色与深色底的逐帧目视图为 `output/imagegen/cast-inspection-light-dark.png`。
