"""Actual Chromium UI + shared browser engine; provider replies are explicitly mocked.
No paid model calls. Static server serves only the built standalone artifact.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root/'dist')))
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()
calls = []
script_calls = 0
failed = False

def model(route):
    global script_calls, failed
    body = route.request.post_data_json
    task, raw = body['messages'][1]['content'].split('\n\n下面是素材 JSON：\n', 1)
    data = json.loads(raw)
    calls.append(task)
    if task.startswith('按用户表达'):
        result = {'themes': [{'label': '具体的学习卡点', 'need': '找到卡住的步骤', 'keywords': ['错题'], 'commentIds': [c['id'] for c in data['comments']]}]}
    elif task.startswith('分析该视频'):
        result = {'structure':'场景问题 → 操作演示', 'hook':'问题开头', 'transfer':'参考节奏', 'style':['对话'], 'beats':[{'quote':data['transcript'][:5], 'part':'场景问题', 'mechanism':'待验证'}], 'hypotheses':['演示有助于理解'], 'limits':['没有表现数据']}
    elif task.startswith('评估痛点'):
        result = {'mappings':[{'themeId':data['themes'][0]['id'], 'fit':'部分对应', 'feature':'学情诊断', 'mechanism':'定位薄弱环节', 'demonstration':'展示报告', 'evidence':'待补材料', 'gap':'待确认适用范围', 'competitorLearning':'补充竞品样例'}]}
    elif task.startswith('安排教育脚本'):
        result = {'briefs':[{'line':s['line'], 'themeId':data['themes'][0]['id'], 'videoId':data['videos'][0]['id'], 'direction':f"浏览器模拟选题 {s['index']+1}，演示报告并保留适用边界", 'rationale':'根据测试样本选择，非真实调研'} for s in data['slots']]}
    elif task.startswith('作为持怀疑'):
        result = {'needsRevision':False, 'issues':[], 'purchaseBarriers':['核验真实演示素材'], 'nextTest':'只改开头对照'}
    else:
        script_calls += 1
        if script_calls == 2 and not failed:
            failed = True
            route.fulfill(status=429, content_type='application/json', body='{}')
            return
        result = {'title':f'浏览器模拟成稿 {script_calls}', 'angle':'观察孩子卡在哪一步', 'structure':'问题 → 演示 → 引导', 'sourceCommentIds':[data['comments'][0]['id']], 'sourceVideoIds':[data['reference']['id']], 'shots':[{'seconds':f'{i*10}–{(i+1)*10}s', 'visual':'展示测试报告画面', 'voice':'这是浏览器测试用的模拟台词。', 'overlay':'测试素材', 'purpose':'核验演示流程'} for i in range(3)], 'critique':{'strengths':['有具体动作'], 'weaknesses':['需真实材料'], 'nextTest':'只改开头做对照'}, 'evidenceGaps':['缺少实拍'], 'status':'模拟结果'}
    route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices':[{'message':{'content':json.dumps(result)}, 'finish_reason':'stop'}]}))

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
        context = browser.new_context(viewport={'width':1440,'height':1000})
        context.route('https://api.deepseek.com/**', model)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/千川研习社-双击打开.html#agent')
        expect(page.locator('h1')).to_contain_text('交代任务')
        page.locator('[data-form="agent"] [type="submit"]').click()
        expect(page.locator('.form-error')).to_contain_text('先导入真实评论')
        assert not calls
        page.locator('.sidebar [data-page="insights"]').click()
        page.locator('[data-action="add-comments"]').first.click()
        page.locator('dialog [name="source"]').fill('浏览器虚构测试样本')
        page.locator('dialog [name="text"]').fill('错题老是又错\n空间向量看不懂\n不知道先复习什么')
        page.locator('dialog [type="submit"]').click()
        expect(page.locator('dialog')).not_to_be_visible()
        page.locator('.sidebar [data-page="videos"]').click()
        page.locator('[data-action="add-video"]').first.click()
        page.locator('dialog [name="title"]').fill('模拟参考视频')
        page.locator('dialog [name="transcript"]').fill('先看一看问题在哪里，再演示一个动作。')
        page.locator('dialog [type="submit"]').click()
        expect(page.locator('dialog')).not_to_be_visible()
        page.locator('.sidebar [data-page="agent"]').click()
        page.locator('[name="videoIds"]').check()
        page.locator('[data-form="agent"] [type="submit"]').click()
        expect(page.locator('.agent-task')).to_have_count(1)
        page.locator('[data-action="agent-run"]').click()
        expect(page.locator('#toast')).to_contain_text('配置并测试模型')
        assert not calls
        page.locator('.sidebar [data-page="settings"]').click()
        page.locator('[name="key"]').fill('browser-fixture-not-real')
        page.locator('[data-form="settings"] [type="submit"]').click()
        expect(page.locator('.connection')).to_contain_text('当前网页会话')
        page.locator('.sidebar [data-page="agent"]').click()
        page.locator('[data-action="agent-run"]').click()
        expect(page.locator('.agent-task')).to_contain_text('本步骤失败，可重试')
        expect(page.locator('.agent-progress')).to_contain_text('成稿 1 / 3')
        stored = page.evaluate('localStorage.getItem("qianchuan.personal.workspace.v1")')
        assert 'browser-fixture-not-real' not in stored
        page.reload()
        expect(page.locator('.agent-task')).to_contain_text('本步骤失败，可重试')
        page.locator('.sidebar [data-page="settings"]').click()
        page.locator('[name="key"]').fill('browser-fixture-not-real')
        page.locator('[data-form="settings"] [type="submit"]').click()
        expect(page.locator('.connection')).to_contain_text('当前网页会话')
        page.locator('.sidebar [data-page="agent"]').click()
        page.locator('[data-action="agent-run"]').click()
        expect(page.locator('.agent-progress')).to_contain_text('成稿 3 / 3')
        expect(page.locator('[data-action="agent-run"]')).to_have_count(0)
        assert sum(t.startswith('按用户表达') for t in calls) == 1
        assert sum(t.startswith('分析该视频') for t in calls) == 1
        assert sum(t.startswith('安排教育脚本') for t in calls) == 1
        page.locator('[data-action="agent-results"]').click()
        expect(page.locator('dialog .script-item')).to_have_count(3)
        page.locator('dialog [data-action="close"]').click()
        page.screenshot(path='/tmp/qianchuan-agent-tested.png', full_page=True)
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'mobile overflow'
        assert not errors, errors
        browser.close()
        print('PASS: Agent UI readiness, plan without calls, mocked research/generation/audit, provider failure, persisted checkpoint, reload and resume without repeated research, three outputs, no stored key, mobile layout. Real provider not tested.')
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)
