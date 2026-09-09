"""M7 发布截图：对运行中的发布包（server 静态托管 UI）截图。"""

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3001"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})

    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(500)

    # 各页面
    page.get_by_text("角色卡", exact=True).click()
    page.wait_for_timeout(500)
    page.screenshot(path="docs/screenshots/characters.png")

    page.get_by_text("世界书", exact=True).click()
    page.wait_for_timeout(500)
    page.screenshot(path="docs/screenshots/lorebooks.png")

    page.get_by_text("计划", exact=True).click()
    page.wait_for_timeout(500)
    page.screenshot(path="docs/screenshots/plans.png")

    page.get_by_text("设置", exact=True).click()
    page.wait_for_timeout(500)
    page.screenshot(path="docs/screenshots/settings.png")

    # 聊天页（有 greeting 消息的会话）
    page.get_by_text("聊天", exact=True).click()
    page.wait_for_timeout(500)
    page.screenshot(path="docs/screenshots/chat.png")

    browser.close()
    print("screenshots written")
