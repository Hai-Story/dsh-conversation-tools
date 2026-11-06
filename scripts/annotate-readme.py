"""Add numbered callouts to unmodified browser captures for the bilingual README.

Requires Pillow and a CJK font. Region JSON files come from browser bounding boxes.
Raw screenshots stay unchanged; output images contain explanatory annotations.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / 'docs/images/readme'
RED = '#d6294c'
INK = '#182235'
MUTED = '#536176'
HEADER = 84

SCENES = {
    'overview': {
        'crop': (280, 0, 1440, 535),
        'targets': [('star', (845, 205), 4), ('edit', (994, 205), 4), ('rail', (1060, 435), 8)],
        'zh': ('星标与编辑入口', [('星标重点问答', '复制旁点击 ☆ / ★，标记或取消'), ('编辑已发送消息', '包括第一条消息，生成中也能编辑'), ('侧边轨道标记', '在轮次预览中定位已星标的问答')]),
        'en': ('Star and edit controls', [('Star an exchange', 'Click the star next to Copy'), ('Edit a sent message', 'Even the first one, while generating'), ('Find starred turns', 'Spot the mark on the navigation rail')]),
    },
    'editor': {
        'crop': (280, 800, 1440, 1000),
        'targets': [('draft', (155, 97), 4), ('permission', (292, 185), 3), ('model', (835, 185), 3), ('submit', (1000, 145), 3)],
        'zh': ('复用原生输入框，发送时才中断', [('原生输入框', '先编辑，原任务继续运行'), ('权限选择', '沿用原生权限菜单'), ('模型选择', '新版本采用当前选择'), ('原生发送', '点击或按 Enter 才中断')]),
        'en': ('Edit in the original composer', [('Native composer', 'Edit without stopping'), ('Permissions', 'Native access presets'), ('Model selection', 'Use the selected model'), ('Native Send', 'Interrupt only on submit')]),
    },
    'versions': {
        'crop': (280, 0, 1440, 515),
        'targets': [('versions', (965, 56), 5), ('oldReply', (162, 458), 5)],
        'zh': ('切换历史版本，回看原对话', [('历史版本选择器', '编辑后打开新版本，也可切回旧版'), ('原对话仍在', '旧回答和后续消息完整保留')]),
        'en': ('Switch versions. Keep the original.', [('Conversation versions', 'Open the new version or return to an old one'), ('The original is preserved', 'Earlier replies and later messages remain')]),
    },
}


def font_path(requested: str | None, candidates: list[str]) -> str:
    for value in ([requested] if requested else []) + candidates:
        if value and Path(value).is_file():
            return value
    raise SystemExit('No suitable font found. Pass --font (CJK) and --english-font.')


def draw_scene(name: str, spec: dict, language: str, font_file: str) -> None:
    raw = Image.open(IMAGES / 'raw' / f'{name}.png').convert('RGB')
    metadata = json.loads((IMAGES / 'raw' / f'{name}.json').read_text())
    assert raw.size == (metadata['viewport']['width'], metadata['viewport']['height'])
    left, top, right, bottom = spec['crop']
    capture = raw.crop((left, top, right, bottom))
    width, height = capture.size
    canvas = Image.new('RGB', (width, HEADER + height + 150), 'white')
    canvas.paste(capture, (0, HEADER))
    draw = ImageDraw.Draw(canvas)
    font = lambda size: ImageFont.truetype(font_file, size)
    title, legends = spec[language]
    draw.text((24, 13), 'DSH CONVERSATION TOOLS', font=font(13), fill=MUTED)
    draw.text((24, 34), title, font=font(27), fill=INK)
    draw.line((0, HEADER - 1, width, HEADER - 1), fill='#e2e8f0', width=1)

    for number, (key, (badge_x, badge_y), padding) in enumerate(spec['targets'], 1):
        region = metadata['regions'][key]
        assert region is not None, f'Missing browser region: {name}/{key}'
        x = region['x'] - left
        y = region['y'] - top + HEADER
        box = (x - padding, y - padding, x + region['width'] + padding, y + region['height'] + padding)
        assert box[0] >= 0 and box[1] >= HEADER and box[2] <= width and box[3] <= HEADER + height
        badge_y += HEADER
        end_x = max(box[0], min(badge_x, box[2]))
        end_y = max(box[1], min(badge_y, box[3]))
        draw.line((badge_x, badge_y, end_x, end_y), fill=RED, width=2)
        draw.rounded_rectangle(box, radius=7, outline=RED, width=3)
        draw.ellipse((badge_x - 15, badge_y - 15, badge_x + 15, badge_y + 15), fill=RED, outline='white', width=2)
        draw.text((badge_x, badge_y - 1), str(number), font=font(18), anchor='mm', fill='white')

    footer_top = HEADER + height + 13
    gap = 12
    cell = (width - 48 - gap * (len(legends) - 1)) / len(legends)
    for index, (label, detail) in enumerate(legends):
        x = 24 + index * (cell + gap)
        draw.rounded_rectangle((x, footer_top, x + cell, footer_top + 94), radius=12, fill='#f5f7fa')
        draw.ellipse((x + 14, footer_top + 15, x + 42, footer_top + 43), fill=RED)
        draw.text((x + 28, footer_top + 28), str(index + 1), font=font(17), anchor='mm', fill='white')
        draw.text((x + 52, footer_top + 13), label, font=font(21), fill=INK)
        detail_font = font(17)
        assert draw.textlength(detail, font=detail_font) < cell - 28, f'Legend too wide: {detail}'
        draw.text((x + 14, footer_top + 56), detail, font=detail_font, fill=MUTED)
    note = '测试会话实拍；编号与框线为说明标注' if language == 'zh' else 'Captured from a test conversation; numbers and outlines are documentation annotations.'
    draw.text((24, footer_top + 110), note, font=font(13), fill=MUTED)
    output = IMAGES / f'{name}.{language}.png'
    canvas.save(output, optimize=True)
    print(f'{output.relative_to(ROOT)}: {canvas.width} × {canvas.height}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font', help='Path to a font supporting Simplified Chinese')
    parser.add_argument('--english-font', help='Path to the English font')
    args = parser.parse_args()
    cjk = font_path(args.font, ['/System/Library/Fonts/STHeiti Medium.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'C:/Windows/Fonts/msyh.ttc'])
    english = font_path(args.english_font, ['/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', cjk])
    for name, spec in SCENES.items():
        for language, selected in [('zh', cjk), ('en', english)]:
            draw_scene(name, spec, language, selected)


if __name__ == '__main__':
    main()
