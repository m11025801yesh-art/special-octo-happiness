"""使用隔离数据目录验证浏览器完整流程，不污染用户的工作台。
需要 Python Playwright 和 Chromium；运行 python3 test/browser_smoke.py。
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

with tempfile.TemporaryDirectory(prefix='qianchuan-browser-') as data_dir:
    proc = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT,
        env={**os.environ, 'DATA_DIR': data_dir, 'PORT': '0', 'HOST': '127.0.0.1', 'QIANCHUAN_AI_KEY': '', 'QIANCHUAN_NO_CATALOG': '1'},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = proc.stdout.readline()
        assert '127.0.0.1:' in line, line
        url = 'http://' + line.strip().split()[-1]
        errors = []
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True)
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(url+'#materials')
            expect(page.locator('h1').first).to_contain_text('把资料放进来')
            page.locator('.sidebar [data-page="home"]').click()
            expect(page.locator('h1').first).to_contain_text('今天')
            page.locator('.sidebar [data-page="product"]').click()
            expect(page.locator('[name="price"]')).to_have_value('9.9 元（以用户最新说明为准；具体权益以当前购买页面为准）')
            assert '实体书' in page.locator('[name="boundaries"]').input_value()
            page.locator('.sidebar [data-page="insights"]').click()
            page.locator('[data-action="add-comments"]').first.click()
            page.locator('dialog [name="source"]').fill('浏览器测试 · 虚构样本')
            page.locator('dialog [name="text"]').fill('错题本写了很多，考试还是又错\n刷题到半夜，换个问法就不会做\n作业太多没有时间安排复习\n错题本写了很多，考试还是又错')
            page.locator('dialog [type="submit"]').click()
            expect(page.locator('dialog')).not_to_be_visible()
            expect(page.locator('#toast')).to_contain_text('新增 3 条')
            page.locator('[data-action="rules"]').click()
            expect(page.locator('[data-action="theme-detail"]').first).to_be_visible()
            page.locator('[data-action="theme-detail"]').first.click()
            expect(page.locator('dialog .quote').first).to_be_visible()
            page.locator('dialog [data-action="use-theme"]').click()
            page.locator('[name="line"]').select_option('C')
            page.locator('[data-action="template"]').click()
            expect(page.locator('.script-item')).to_have_count(1)
            expect(page.locator('.script-item h2')).to_contain_text('C线')
            page.locator('[data-action="edit-script"]').click()
            page.locator('dialog [name="voice_0"]').fill('测试开头：先看看这道题到底错在哪一步。')
            page.locator('dialog [type="submit"]').click()
            expect(page.locator('.script-item')).to_have_count(2)
            expect(page.locator('.script-item').first).to_contain_text('V2')
            page.locator('[data-action="add-review"]').first.click()
            page.locator('dialog [name="label"]').fill('虚构测试投放')
            page.locator('dialog [name="ctr"]').fill('3.5')
            page.locator('dialog [name="cvr"]').fill('2')
            page.locator('dialog [name="hold3"]').fill('35')
            page.locator('dialog [name="baseline_ctr"]').fill('5')
            page.locator('dialog [type="submit"]').click()
            expect(page.locator('dialog')).not_to_be_visible()
            page.locator('.sidebar [data-page="reviews"]').click()
            expect(page.locator('.metric').nth(1)).to_contain_text('3.50%')
            expect(page.locator('.recommendation').first).to_contain_text('优先测试')
            page.locator('[data-action="iterate"]').click()
            expect(page.locator('[name="mode"]')).to_have_value('iterate')
            page.locator('.sidebar [data-page="videos"]').click()
            page.locator('[data-action="add-video"]').first.click()
            page.locator('dialog [name="title"]').fill('跨类目结构测试')
            page.locator('dialog [name="transcript"]').fill('事情做得多，就代表做对了吗？先看看步骤。把重复的去掉，留下真正需要的。')
            page.locator('dialog [name="structure"]').fill('反常识 → 操作演示 → 行动引导')
            page.locator('dialog [type="submit"]').click()
            expect(page.locator('.video-card')).to_have_count(1)
            page.locator('[data-action="video-detail"]').click()
            expect(page.locator('dialog')).to_contain_text('尚未 AI 拆解')
            page.locator('dialog [data-action="close"]').click()
            page.locator('.sidebar [data-page="insights"]').click()
            page.locator('[data-action="add-comments"]').first.click()
            page.locator('dialog [name="source"]').fill('CSV 测试')
            page.locator('dialog [name="file"]').set_input_files({'name': '评论.csv', 'mimeType': 'text/csv', 'buffer': '评论,来源\n"第一句\n第二句",测试来源\n"字里有""引号""",测试来源'.encode('utf-8')})
            page.locator('dialog [type="submit"]').click()
            expect(page.locator('dialog')).not_to_be_visible()
            expect(page.locator('#toast')).to_contain_text('新增 2 条')
            page.locator('[data-action="ai-themes"]').click()
            expect(page.locator('#toast')).to_contain_text('尚未连接 AI')
            page.locator('.sidebar [data-page="mapping"]').click()
            page.locator('[data-action="manual-mapping"]').first.click()
            page.locator('dialog [name="themeId"]').select_option(index=1)
            page.locator('dialog [name="mechanism"]').fill('用真实错因报告展示学习薄弱项，待产品样例核验。')
            page.locator('dialog [type="submit"]').click()
            expect(page.locator('.mapping')).to_have_count(1)
            page.locator('.sidebar [data-page="settings"]').click()
            page.locator('[name="provider"]').select_option('openai')
            expect(page.locator('[name="model"]')).to_have_value('gpt-4.1-mini')
            page.locator('[name="key"]').fill('browser-test-placeholder-key')
            page.locator('form[data-form="settings"] [type="submit"]').click()
            expect(page.locator('.connection')).to_contain_text('已配置')
            with page.expect_download() as download_info:
                page.locator('[data-action="export"]').click()
            export = json.loads(Path(download_info.value.path()).read_text())
            assert 'browser-test-placeholder-key' not in json.dumps(export)
            assert len(export['comments']) == 5 and len(export['scripts']) == 2
            page.reload()
            expect(page.locator('.connection')).to_contain_text('已配置')
            page.locator('.sidebar [data-page="scripts"]').click()
            expect(page.locator('.script-item')).to_have_count(2)
            page.screenshot(path='/tmp/qianchuan-script-test.png', full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            page.goto(url + '/#home')
            expect(page.locator('h1').first).to_contain_text('今天')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile horizontal overflow'
            page.locator('[data-action="menu"]').click()
            page.locator('.sidebar [data-page="product"]').click()
            expect(page.locator('[name="price"]')).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Product mobile horizontal overflow'
            page.screenshot(path='/tmp/qianchuan-mobile-test.png', full_page=True)
            assert not errors, errors
            browser.close()
        print('PASS: 产品资料、评论粘贴去重、CSV多行引号、主题引用、C线骨架、人工新版本、投放复盘、视频资料、手动匹配、缺失密钥提示、设置、导出密钥隔离、刷新持久化、手机布局。')
    finally:
        proc.terminate()
        proc.wait(timeout=5)
