#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""make_pptx.py <spec.json> <out.pptx> —— 把 /comic 的「版式规格」拼成**原生可编辑** pptx。

设计口径（2026-11-10 与用户实测敲定，别再回退到 SVG 烤底图那条）：
  - WPS/Office 的 SVG 导入器拒绝内嵌大 base64 栅格、且不认 text-anchor → 面向 WPS 的可编辑图走原生 pptx。
  - 底图=原生 picture 铺满；旁白框/气泡=原生形状**自带文本框**（改字即改气泡内文、垂直居中）；
    对齐用原生 PP_ALIGN（WPS 自己管居中，绕开 SVG text-anchor 的坑）。
  - 字号 px→pt 按 ×0.75 换算（1024×1536 幻灯片 96dpi，9525 EMU/px，保证渲染尺寸和 /comic 画布一致）。
  - 中文必须显式写 a:ea（python-pptx 只写 a:latin），否则 WPS 可能回退字体。

spec.json 结构：
  { "canvas": {"w":1024,"h":1536},
    "base": "<底图 png 绝对路径，可缺省/null>",
    "fontFamily": "Microsoft YaHei",           // 可缺省
    "layers": [ { "kind":"narration"|"bubble",
                  "shape":"roundrect"|"ellipse"|"rect"|"whisper",
                  "box": {"x":..,"y":..,"w":..,"h":..},
                  "fill":"#rrggbb", "stroke":"#rrggbb", "strokeOpacity":0.18,
                  "opacity":0.94, "lines":["..",".."], "align":"center"|"left"|"right",
                  "fontSizePx":32, "fontColor":"#15181c", "bold":false } ] }
"""
import sys, json, os
from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR, MSO_AUTO_SIZE
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from pptx.oxml.ns import qn

PXEMU = 9525          # EMU per px @ 96dpi
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
def px(v): return Emu(int(round(float(v) * PXEMU)))
def pt_from_px(pxv): return Pt(round(float(pxv) * 0.75, 1))
def rgb(hexs):
    h = str(hexs).lstrip('#')
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

SHAPE_MAP = {
    'ellipse': MSO_SHAPE.OVAL, 'roundrect': MSO_SHAPE.ROUNDED_RECTANGLE,
    'rect': MSO_SHAPE.RECTANGLE, 'whisper': MSO_SHAPE.ROUNDED_RECTANGLE,
}
ALIGN_MAP = {'center': PP_ALIGN.CENTER, 'left': PP_ALIGN.LEFT, 'right': PP_ALIGN.RIGHT}

def _set_alpha(color_parent_elm, opacity):
    """给 solidFill / ln 下的 srgbClr 追加 a:alpha（opacity 0~1；1=不加）。"""
    if opacity is None or opacity >= 0.999:
        return
    srgb = color_parent_elm.find('.//' + qn('a:srgbClr'))
    if srgb is None:
        return
    for ex in srgb.findall(qn('a:alpha')):
        srgb.remove(ex)
    alpha = srgb.makeelement(qn('a:alpha'), {'val': str(int(round(opacity * 100000)))})
    srgb.append(alpha)

def set_cjk(run, name):
    rPr = run._r.get_or_add_rPr()
    for tag in ('a:latin', 'a:ea', 'a:cs'):
        el = rPr.find(qn(tag))
        if el is None:
            el = rPr.makeelement(qn(tag), {}); rPr.append(el)
        el.set('typeface', name)

def add_layer(slide, L, font_family):
    box = L['box']
    sp = slide.shapes.add_shape(
        SHAPE_MAP.get(L.get('shape', 'roundrect'), MSO_SHAPE.ROUNDED_RECTANGLE),
        px(box['x']), px(box['y']), px(box['w']), px(box['h']))
    # 填充
    sp.fill.solid(); sp.fill.fore_color.rgb = rgb(L.get('fill', '#ffffff'))
    _set_alpha(sp.fill._xPr, L.get('opacity', 1))
    # 描边
    stroke = L.get('stroke')
    if stroke and L.get('strokeOpacity', 1) > 0.001:
        sp.line.color.rgb = rgb(stroke); sp.line.width = Pt(2)
        _set_alpha(sp.line._get_or_add_ln(), L.get('strokeOpacity', 1))
        if L.get('opacity', 1) < 0.999:
            _set_alpha(sp.line._get_or_add_ln(), L.get('opacity', 1))
    else:
        sp.line.fill.background()
    # 阴影关掉，避免 WPS 给默认投影
    try:
        sp.shadow.inherit = False
    except Exception:
        pass
    # 文本
    tf = sp.text_frame
    tf.word_wrap = True
    try: tf.auto_size = MSO_AUTO_SIZE.NONE
    except Exception: pass
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    for m in ('margin_left', 'margin_right', 'margin_top', 'margin_bottom'):
        setattr(tf, m, Emu(int(round(float(L.get('padPx', 6)) * PXEMU))))
    tf.clear()
    lines = L.get('lines') or [L.get('text', '')]
    align = ALIGN_MAP.get(L.get('align', 'center'), PP_ALIGN.CENTER)
    size = pt_from_px(L.get('fontSizePx', 32))
    color = rgb(L.get('fontColor', '#15181c'))
    bold = bool(L.get('bold', False))
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        r = p.add_run(); r.text = str(ln)
        r.font.size = size; r.font.bold = bold; r.font.color.rgb = color
        set_cjk(r, font_family)
        if L.get('opacity', 1) < 0.999:
            _set_alpha(r._r.get_or_add_rPr(), L.get('opacity', 1))
    return sp

def main():
    if len(sys.argv) < 3:
        print('用法: make_pptx.py <spec.json> <out.pptx>', file=sys.stderr); sys.exit(2)
    spec = json.load(open(sys.argv[1], encoding='utf-8'))
    out = sys.argv[2]
    cw = spec.get('canvas', {}).get('w', 1024)
    ch = spec.get('canvas', {}).get('h', 1536)
    font_family = spec.get('fontFamily', 'Microsoft YaHei')

    prs = Presentation()
    prs.slide_width = px(cw); prs.slide_height = px(ch)
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank

    base = spec.get('base')
    if base and os.path.exists(base):
        slide.shapes.add_picture(base, px(0), px(0), width=px(cw), height=px(ch))

    for L in spec.get('layers', []):
        add_layer(slide, L, font_family)

    prs.save(out)
    print(f'[make_pptx] 写出 {out} · 幻灯片 {cw}x{ch}px · 底图{"有" if (base and os.path.exists(base)) else "无"} · 层数 {len(spec.get("layers", []))}')

if __name__ == '__main__':
    main()
