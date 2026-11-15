#!/usr/bin/env python3
"""深色模式层次与对比度生成器。

读取 src/themes.css 中每套主题的深色变量，按目标对比度计算：
  - 表面：背景不用纯黑；卡片对背景 ≈ 1.32:1；节点色块（tile）介于两者之间，做“凹下去”的层次
  - 文字：--tx-50/100/200（主文字）对卡片 ≈ 15:1，补齐此前缺失的正文色阶
结果写回 themes.css 末尾的标记区块（重复运行会覆盖）。用法：python3 scripts/dark-contrast.py
"""
import re, pathlib

CSS = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'themes.css'
BEGIN, END = '/* ===== 深色层次（scripts/dark-contrast.py 生成，勿手改） ===== */', '/* ===== 深色层次 结束 ===== */'
THEMES = ['default', 'nord', 'neutral', 'sakura', 'cyber', 'sunset']
PAGE_MIN_L = 0.0045      # 背景最低相对亮度：避免纯黑带来的光晕
CARD_ON_PAGE = 1.32      # 卡片 / 背景
TILE_POS = 0.55          # tile 在 卡片→背景 之间的位置（0 = 卡片，1 = 背景）
PRIMARY = 15.0           # 主文字 / 卡片（受主题最亮色限制）
SECONDARY = 7.0          # 说明文字（400）/ 卡片

def lum(c):
    f = lambda x: (x / 255) / 12.92 if x / 255 <= 0.03928 else (((x / 255) + 0.055) / 1.055) ** 2.4
    r, g, b = map(f, c); return 0.2126 * r + 0.7152 * g + 0.0722 * b
def cr(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True); return (la + 0.05) / (lb + 0.05)
def mix(a, b, t): return tuple(round(x + (y - x) * t) for x, y in zip(a, b))
def scale_to(c, target_l, toward=(255, 255, 255)):
    lo, hi = 0.0, 1.0
    for _ in range(40):
        m = (lo + hi) / 2
        (lo, hi) = (m, hi) if lum(mix(c, toward, m)) < target_l else (lo, m)
    return mix(c, toward, hi)

text = CSS.read_text()
text = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END) + r'\n?', '', text, flags=re.S)
blocks = re.findall(r'([^{}]+)\{([^{}]*)\}', text)
vars_of = lambda body: {k: tuple(map(int, v.split())) for k, v in re.findall(r'--([\w-]+):\s*([\d ]+);', body)}

out = [BEGIN, '/* 背景不用纯黑；卡片靠明度浮起；节点色块略低于卡片；补齐主文字色阶 --tx-50/100/200 */']
for t in THEMES:
    d = {}
    for sel, body in blocks:
        sels = [s.strip() for s in sel.split('*/')[-1].strip().split(',')]
        if (t == 'default' and ':root' in sels) or f"[data-theme='{t}']" in sels: d.update(vars_of(body))
    for sel, body in blocks:
        sels = [s.strip() for s in sel.split('*/')[-1].strip().split(',')]
        if f".dark[data-theme='{t}']" in sels or (t == 'default' and '.dark' in sels): d.update(vars_of(body))
    page, card = d['s-page'], d['s-card']
    if lum(page) < PAGE_MIN_L: page = scale_to(page, PAGE_MIN_L, toward=card)
    card = scale_to(card, CARD_ON_PAGE * (lum(page) + 0.05) - 0.05, toward=mix(card, (255, 255, 255), 0.5))
    tile = mix(card, page, TILE_POS)
    light = d['n-50']
    primary = scale_to(d['n-200'], PRIMARY * (lum(card) + 0.05) - 0.05, toward=light) if cr(light, card) > PRIMARY else light
    def text_at(ratio):  # 在卡片色与最亮色之间取对比度恰为 ratio 的颜色
        return scale_to(card, ratio * (lum(card) + 0.05) - 0.05, toward=light)
    p_ratio = cr(primary, card)
    second = text_at(p_ratio * 0.78)   # 300：次一级正文，明显低于主文字
    third = text_at(SECONDARY)         # 400：说明文字
    sel = ".dark, .dark[data-theme='default']" if t == 'default' else f".dark[data-theme='{t}']"
    rgb = lambda c: ' '.join(map(str, c))
    out.append(f"{sel} {{\n  --s-page: {rgb(page)};\n  --s-card: {rgb(card)};\n  --s-tile: {rgb(tile)};\n"
               f"  --tx-50: {rgb(light)};\n  --tx-100: {rgb(light)};\n  --tx-200: {rgb(primary)};\n"
               f"  --tx-300: {rgb(second)};\n  --tx-400: {rgb(third)};\n}}"
               f"  /* 主文字 {cr(primary, card):.1f}:1，300 {cr(second, card):.1f}:1，400 {cr(third, card):.1f}:1，"
               f"辅助(500) on tile {cr(d.get('tx-500', d['n-500']), tile):.1f}:1，卡片/背景 {cr(card, page):.2f} */")
out.append(END)
CSS.write_text(text.rstrip('\n') + '\n\n' + '\n'.join(out) + '\n')
print('\n'.join(out))
