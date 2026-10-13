"""Three inputs, one-click generation and repeated buyer review in actual Chromium.
Provider responses are mocked; no real paid model or conversion result is claimed.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
from playwright.sync_api import sync_playwright,expect

root=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root/'dist')))
thread=Thread(target=server.serve_forever,daemon=True);thread.start()
calls=[];audits=0
def respond(route):
 global audits
 task,raw=route.request.post_data_json['messages'][1]['content'].split('\n\n下面是素材 JSON：\n',1)
 data=json.loads(raw);calls.append(task)
 if task.startswith('简洁创作：先学习'):
  r={'audience':'高中家长','requirementsSummary':'一条45秒，主打诊断','count':1,'angles':['诊断先于加量'],'productFacts':[{'claim':'提供诊断','quote':'学情诊断'}],'referenceLessons':[{'quote':'先看问题','lesson':'问题先行'}]}
 elif task.startswith('简洁创作：现在换成'):
  audits+=1
  if audits==2:
   route.fulfill(status=429,content_type='application/json',body='{}');return
  r={'persuasive':audits>1,'reason':'我还不信' if audits==1 else '现在能看清诊断如何交付，愿意进一步了解','issues':['增加具体演示'] if audits==1 else [],'purchaseBarriers':[],'blockingEvidence':[],'nextTest':'测试不同开头'}
 else:
  r={'script':{'title':'先看孩子卡在哪里','angle':'把诊断说具体','structure':'问题 → 演示 → 引导','sourceCommentIds':[],'sourceVideoIds':[],'shots':[{'seconds':f'{i*10}–{i*10+10}s','voice':'修改后：展示具体诊断步骤。' if data['audit'] else '初稿：先找问题。','visual':'报告演示','overlay':'诊断','purpose':'明确交付'} for i in range(3)],'critique':{'strengths':['有场景'],'weaknesses':[],'nextTest':'测试开头'},'evidenceGaps':[]},'changes':['增加报告操作画面'] if data['audit'] else []}
 route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'message':{'content':json.dumps(r)},'finish_reason':'stop'}]}))
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True)
  context=browser.new_context(viewport={'width':1440,'height':1000})
  context.route('https://api.deepseek.com/**',respond)
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/千川研习社-双击打开.html')
  expect(page.locator('[data-form="simple"] textarea')).to_have_count(3)
  expect(page.locator('.sidebar [data-page="insights"]')).to_have_count(0)
  page.locator('[name="product"]').fill('9.9元虚拟产品，提供学情诊断和学习规划。')
  page.locator('[name="requirements"]').fill('给高中家长写1条45秒口播，主打诊断。')
  page.locator('[name="references"]').fill('先看问题，再告诉你怎么做。')
  page.locator('[data-form="simple"] [type="submit"]').click()
  expect(page.locator('#toast')).to_contain_text('请先连接 AI')
  assert not calls
  page.locator('.sidebar [data-page="settings"]').click()
  page.locator('[name="key"]').fill('simple-browser-test-not-real')
  page.locator('[data-form="settings"] [type="submit"]').click()
  expect(page.locator('.connection')).to_contain_text('当前网页会话')
  page.locator('.sidebar [data-page="simple"]').click()
  expect(page.locator('[name="requirements"]')).to_have_value('给高中家长写1条45秒口播，主打诊断。')
  page.locator('[data-action="simple-resume"]').click()
  expect(page.locator('.simple-task')).to_contain_text('创作暂时中断')
  saved=json.loads(page.evaluate('localStorage.getItem("qianchuan.personal.workspace.v1")'))
  assert len(saved['comments'])==0
  assert saved['simpleTasks'][0]['stage']=='audit'
  assert saved['simpleTasks'][0]['revision']==1
  assert 'simple-browser-test-not-real' not in json.dumps(saved)
  page.locator('[data-action="simple-resume"]').click()
  expect(page.locator('.simple-result')).to_have_count(1)
  expect(page.locator('.simple-result')).to_contain_text('用户视角自检通过')
  expect(page.locator('.simple-voice')).to_contain_text('修改后')
  assert audits==3
  assert sum('写一条新脚本' in t for t in calls)==1
  assert sum('重新修改' in t for t in calls)==1
  page.reload()
  expect(page.locator('.simple-result')).to_have_count(1)
  expect(page.locator('[name="requirements"]')).to_have_value('给高中家长写1条45秒口播，主打诊断。')
  page.screenshot(path='/tmp/qianchuan-simple-tested.png',full_page=True)
  page.set_viewport_size({'width':390,'height':844})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  browser.close()
  print('PASS: three-input default page, hidden advanced tools, saved inputs without key/comments, mocked learn-draft-audit-revise-reaudit, resume failed review without rewriting, persisted final result, key isolation and mobile layout.')
finally:
 server.shutdown();server.server_close();thread.join(timeout=3)
