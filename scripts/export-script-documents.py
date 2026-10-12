"""将人工审阅的结构化脚本导出为 Word、Excel、Markdown；不调用模型、不生成研究频次。"""
from pathlib import Path
import json
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

root=Path(__file__).resolve().parents[1]
out=root/'dist'
data=json.loads((out/'20条脚本数据.json').read_text())
definitions=data['definitions'];scripts=data['scripts'];batch=data['batch']
assert len(scripts)==20 and len({s['id'] for s in scripts})==20
green='2C5948';light='EAF0E2';muted='65735F'
doc=Document()
section=doc.sections[0]
section.top_margin=Inches(.7);section.bottom_margin=Inches(.65)
section.left_margin=Inches(.7);section.right_margin=Inches(.7)
normal=doc.styles['Normal'];normal.font.name='微软雅黑';normal.font.size=Pt(10)
normal._element.rPr.rFonts.set(qn('w:eastAsia'),'微软雅黑')
normal.paragraph_format.space_after=Pt(6)
normal.paragraph_format.line_spacing=1.15
for name,size in [('Title',25),('Heading 1',18),('Heading 2',12)]:
 style=doc.styles[name];style.font.name='微软雅黑';style.font.size=Pt(size);style.font.color.rgb=RGBColor.from_string(green)
 style._element.rPr.rFonts.set(qn('w:eastAsia'),'微软雅黑')
doc.add_heading('千川研习社\n教育类目 20 条可拍脚本',0)
doc.add_paragraph('9.9 元虚拟产品 · A 线 7 条 / B 线 7 条 / C 线 6 条\n创作日期：2026-10-12 · 目标时长约 55 秒 / 条')
doc.add_heading('这批脚本依据什么',1)
doc.add_paragraph(batch['basis'])
for item in batch['sources']:doc.add_paragraph(item,style='List Bullet')
doc.add_paragraph('由当前对话中的创作 Agent 直接撰写和审阅，未调用工作台的付费模型接口；未采集平台大盘，也没有虚构用户评论、统计频次或投放结果。脚本已内置到双击打开版，无需填写 API 密钥就能阅读、修改和导出。')
doc.add_heading('拍摄前准备',1)
for text in ['核对当前 9.9 元商品详情、真实权益及领取方式，不沿用旧文档的价格或实体书。','准备获准公开的匿名诊断报告、对应规划、真实课程目录和模型录屏。','具体模型内容与互动动作先实机确认，数学和物理讲解先做学科核验；没有对应模型时先调整创意。','家长与孩子出镜若为演员，明确属于情境演示，不作为真实成效案例。','所有台词为待投放的创作方案；题头的受众问题是创作假设，不代表平台高频结论。']:doc.add_paragraph(text,style='List Bullet')
doc.add_heading('20 条选题索引',1)
for s in definitions:doc.add_paragraph(f"{s['code']}｜{s['title']}")
markdown=['# 教育类目千川脚本 · 20 条\n','2026-10-12｜9.9 元纯虚拟方案｜A 线 7 条、B 线 7 条、C 线 6 条\n',batch['basis']+'\n']

def shade(cell,color):
 node=OxmlElement('w:shd');node.set(qn('w:fill'),color);cell._tc.get_or_add_tcPr().append(node)

for definition,entry in zip(definitions,scripts):
 r=entry['result'];doc.add_page_break();doc.add_heading(r['title'],1)
 doc.add_paragraph(f"主线：{definition['line']} 线　｜　目标时长：约 55 秒（按实际口播与演示节奏调整）")
 for label,key in [('目标人群','targetAudience'),('创作观点','angle'),('形式','format'),('结构','structure'),('待验证痛点','audienceHypothesis')]:
  p=doc.add_paragraph();p.add_run(label+'：').bold=True;p.add_run(r[key])
 doc.add_heading('完整口播',2)
 for shot in r['shots']:doc.add_paragraph(shot['voice'])
 doc.add_heading('拍摄分镜',2)
 table=doc.add_table(rows=1,cols=4);table.style='Table Grid'
 for c,text in zip(table.rows[0].cells,['时间','画面 / 操作','字幕','作用']):c.text=text;shade(c,light)
 for shot in r['shots']:
  cells=table.add_row().cells
  for c,key in zip(cells,['seconds','visual','overlay','purpose']):c.text=shot[key]
 for row in table.rows:
  for c in row.cells:
   for p in c.paragraphs:
    for run in p.runs:run.font.size=Pt(9)
 doc.add_heading('用户视角反推',2)
 doc.add_paragraph('可能的购买疑虑：'+definition['objection'])
 doc.add_paragraph('本稿如何回应：'+definition['response'])
 doc.add_paragraph('仍未验证：'+definition['unresolved'])
 doc.add_heading('素材与证据要求',2)
 for gap in r['evidenceGaps']:doc.add_paragraph(gap,style='List Bullet')
 doc.add_heading('第一轮对照测试',2);doc.add_paragraph(r['critique']['nextTest'])
 markdown.extend([f"\n## {r['title']}\n",f"人群：{r['targetAudience']}\n",f"观点：{r['angle']}\n",f"待验证假设：{r['audienceHypothesis']}\n",'### 口播与分镜\n'])
 for shot in r['shots']:markdown.append(f"**{shot['seconds']}**\n\n口播：{shot['voice']}\n\n画面：{shot['visual']}\n\n字幕：{shot['overlay']}\n")
 markdown.append('用户疑虑：'+definition['objection']+'\n\n回应：'+definition['response']+'\n\n仍需核验：'+definition['unresolved']+'\n')
 markdown.append('测试：'+r['critique']['nextTest']+'\n')
footer=section.footer.paragraphs[0];footer.alignment=2
footer.add_run('千川研习社 · 创作假设待真实投放验证  |  ')
field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');footer._p.append(field)
doc.save(out/'教育千川脚本20条.docx')
(out/'教育千川脚本20条.md').write_text('\n'.join(markdown))

wb=Workbook();overview=wb.active;overview.title='20条脚本总览'
overview.append(['编号','主线','标题','目标人群','待验证痛点','创作观点','视频形式','结构','完整口播','购买疑虑','回应方式','需准备素材','尚未验证','对照变量','A版本','B版本','主要指标','兼看指标','资料依据'])
shots=wb.create_sheet('100个拍摄分镜');shots.append(['编号','主线','标题','时间','完整口播','画面或操作','字幕','作用'])
for s,entry in zip(definitions,scripts):
 r=entry['result']
 overview.append([s['code'],s['line'],s['title'],s['audience'],s['hypothesis'],s['angle'],s['format'],s['structure'],'\n'.join(x['voice'] for x in r['shots']),s['objection'],s['response'],'\n'.join(s['proof']),s['unresolved'],*s['test'],batch['basis']])
 for shot in r['shots']:shots.append([s['code'],s['line'],s['title'],shot['seconds'],shot['voice'],shot['visual'],shot['overlay'],shot['purpose']])
notes=wb.create_sheet('先读说明');notes.append(['项目','说明'])
for row in [('研究口径',batch['basis']),('创作方式','当前对话 Agent 直接撰写；未使用真实平台样本或付费模型接口验证。'),('当前产品','9.9 元，全部虚拟交付；排除旧文档实体书和旧价格。'),('A线','诊断—规划—对应课程—模型学习—营期衔接，7条。'),('B线','先找到问题，再选择下一步，7条。'),('C线','数理动态模型现场演示，6条。'),('时长','约55秒；先试读，再按真实演示调整节奏。'),('来源1',batch['sources'][0]),('来源2',batch['sources'][1])]:notes.append(row)
for ws in wb:
 ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
 for cell in ws[1]:cell.fill=PatternFill('solid',fgColor=green);cell.font=Font(name='微软雅黑',bold=True,color='FFFFFF',size=11);cell.alignment=Alignment(wrap_text=True,vertical='center')
 ws.row_dimensions[1].height=30
 for row in ws.iter_rows(min_row=2):
  for cell in row:
   cell.font=Font(name='微软雅黑',size=10);cell.alignment=Alignment(vertical='top',wrap_text=True)
   if cell.row%2==0:cell.fill=PatternFill('solid',fgColor='F2F5ED')
 for i in range(1,ws.max_column+1):ws.column_dimensions[get_column_letter(i)].width=30
 for i in range(2,ws.max_row+1):ws.row_dimensions[i].height=95 if ws==shots else 125
overview.column_dimensions['A'].width=9;overview.column_dimensions['B'].width=7;overview.column_dimensions['C'].width=32;overview.column_dimensions['I'].width=85
shots.column_dimensions['A'].width=9;shots.column_dimensions['B'].width=7;shots.column_dimensions['D'].width=11;shots.column_dimensions['E'].width=60;shots.column_dimensions['F'].width=65
notes.column_dimensions['A'].width=18;notes.column_dimensions['B'].width=115
wb.save(out/'教育千川脚本20条.xlsx')
print('已生成 Word、Excel、Markdown：20条完整脚本、100个分镜；Excel总览20行，分镜100行。')
