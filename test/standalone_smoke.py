"""单文件页面测试：只有静态HTML，无后端API；加载后断网验证实际流程。
当前云环境的受管理浏览器禁止 file:// 导航，测试使用本机静态HTTP提供相同文件。
不修改或绕过浏览器管理策略；本测试不声称已验证此环境中的 file:// 双击入口。
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright,expect

root=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root/'dist')))
thread=Thread(target=server.serve_forever,daemon=True);thread.start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True)
  context=browser.new_context(viewport={'width':1440,'height':1000})
  page=context.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r:requests.append(r.url))
  url=f'http://127.0.0.1:{server.server_port}/千川研习社-双击打开.html'
  page.goto(url)
  expect(page.locator('.script-item')).to_have_count(20)
  assert len(requests)==1,requests
  context.set_offline(True)
  page.locator('[data-action="filter-scripts"][data-line="A"]').click()
  expect(page.locator('.script-item')).to_have_count(7)
  page.locator('[data-action="filter-scripts"][data-line="B"]').click()
  expect(page.locator('.script-item')).to_have_count(7)
  page.locator('[data-action="filter-scripts"][data-line="C"]').click()
  expect(page.locator('.script-item')).to_have_count(6)
  page.locator('[data-action="script-sources"]').first.click()
  expect(page.locator('dialog')).to_contain_text('尚未使用真实评论')
  expect(page.locator('dialog')).to_contain_text('产品资料依据')
  page.locator('dialog [data-action="close"]').click()
  page.locator('[data-action="edit-script"]').first.click()
  page.locator('dialog [name="voice_0"]').fill('离线测试：先把一个概念看清楚。')
  page.locator('dialog [type="submit"]').click()
  expect(page.locator('.script-item')).to_have_count(7)
  expect(page.locator('.script-item').first).to_contain_text('V2')
  page.locator('[data-action="add-review"]').first.click()
  page.locator('dialog [name="label"]').fill('离线测试批次')
  page.locator('dialog [name="ctr"]').fill('3')
  page.locator('dialog [name="baseline_ctr"]').fill('4')
  page.locator('dialog [type="submit"]').click()
  expect(page.locator('dialog')).not_to_be_visible()
  page.locator('.sidebar [data-page="reviews"]').click()
  expect(page.locator('.metric').nth(1)).to_contain_text('3.00%')
  page.locator('.sidebar [data-page="insights"]').click()
  page.locator('[data-action="add-comments"]').first.click()
  page.locator('dialog [name="source"]').fill('离线测试样本')
  page.locator('dialog [name="text"]').fill('作业太多没有时间复习\n错题本一直整理但是还是又错\n作业太多没有时间复习')
  page.locator('dialog [type="submit"]').click()
  expect(page.locator('#toast')).to_contain_text('新增 2 条')
  page.locator('[data-action="rules"]').click()
  expect(page.locator('[data-action="theme-detail"]').first).to_be_visible()
  page.locator('.sidebar [data-page="settings"]').click()
  expect(page.locator('.content')).to_contain_text('下载版直接通过你的浏览器连接服务商')
  page.locator('[name="key"]').fill('local-test-key-not-real')
  page.locator('[data-form="settings"] [type="submit"]').click()
  expect(page.locator('.connection')).to_contain_text('当前网页会话')
  stored=page.evaluate('localStorage.getItem("qianchuan.personal.workspace.v1")')
  assert 'local-test-key-not-real' not in stored
  assert len(json.loads(stored)['scripts'])==21
  with page.expect_download() as download_info:page.locator('[data-action="export"]').click()
  exported=Path(download_info.value.path()).read_text()
  assert 'local-test-key-not-real' not in exported
  assert len(json.loads(exported)['reviews'])==1
  assert len(requests)==1,'Local API operations must not make network requests'
  context.set_offline(False)
  page.reload()
  expect(page.locator('.connection')).to_contain_text('尚未配置模型密钥')
  page.locator('.sidebar [data-page="scripts"]').click()
  expect(page.locator('.script-item')).to_have_count(21)
  page.screenshot(path='/tmp/qianchuan-standalone-tested.png',full_page=False)
  page.set_viewport_size({'width':390,'height':844})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'mobile overflow'
  assert not errors,errors
  print('PASS: 20 scripts, A7/B7/C6 filters, source labels, offline editing/versioning/reviews/comment import, local persistence, key excluded from storage/export and cleared on reload, mobile layout; no backend/API requests.')
  browser.close()
finally:
 server.shutdown();server.server_close();thread.join(timeout=3)
