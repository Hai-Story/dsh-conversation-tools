# README 截图说明 / Screenshot notes

`images/readme/raw/` 中的 PNG 来自原版 DSH `0.2.2-rc.1` 上运行本插件的测试会话。模型响应由 `tests/fixtures/model.mjs` 提供，无需真实 API Key。保留的 JSON 记录浏览器窗口大小与目标元素的 `boundingBox()`，用于准确定位标注。

The PNGs in `images/readme/raw/` were captured from this plugin running in stock DSH `0.2.2-rc.1`. Responses came from the keyless fixture in `tests/fixtures/model.mjs`. Each JSON file records the viewport and the target elements' browser bounding boxes.

| 原图 / Original | 标注位置 / Callouts |
| --- | --- |
| `overview.png` | 星标、编辑、侧边标记 / Star, Edit, rail marker |
| `editor.png` | 原生输入区、权限、模型、发送 / Native composer, permissions, model, Send |
| `versions.png` | 版本选择器、旧回答 / Version selector, original reply |

`scripts/annotate-readme.py` 只裁剪截图、添加说明框线、编号和图注，不修改消息或控件。中文和英文标注图分别用于两份 README。原始 PNG 保持不变。

`scripts/annotate-readme.py` only crops the captures and adds explanatory outlines, numbers, and captions. It does not change messages or controls. Chinese and English outputs serve the two READMEs; raw PNGs remain unchanged.

## 重绘标注 / Regenerate annotations

需要 Pillow 与中文字体。建议把 Python 依赖装进项目虚拟环境：

Pillow and a CJK font are required. Keep Python dependencies in a project virtual environment:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install Pillow
.venv/bin/python scripts/annotate-readme.py
```

脚本会查找常用 macOS / Linux / Windows 字体路径。若找不到，可通过 `--font /path/to/cjk-font.ttc --english-font /path/to/font.ttf` 指定。更新原图时同时更新 JSON 坐标，并核对脚本中的裁剪范围与编号位置；生成后人工检查是否遮住文字或裁掉目标。

The script checks common macOS, Linux, and Windows font paths. Use `--font /path/to/cjk-font.ttc --english-font /path/to/font.ttf` to override them. When replacing captures, also update the region JSON and review the crop and callout positions in the script. Inspect the generated images for covered text or clipped targets.
