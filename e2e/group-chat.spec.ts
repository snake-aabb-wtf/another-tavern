import { expect, test, type APIRequestContext } from "@playwright/test";

const SERVER_URL = "http://127.0.0.1:3001";

function cardJson(name: string): string {
  return JSON.stringify({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name,
      description: `${name} 的 E2E 测试角色。`,
      personality: "友好",
      scenario: "夜晚的旅店",
      first_mes: `${name} 的开场白。`,
      mes_example: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: ["e2e"],
      creator: "another-tavern-e2e",
      character_version: "1",
      extensions: {},
    },
  });
}

async function importCard(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post(`${SERVER_URL}/api/characters/import`, {
    multipart: {
      file: {
        name: `${name}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(cardJson(name), "utf8"),
      },
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

test("群聊核心浏览器 E2E：创建、配置、生成与刷新恢复", async ({ page, request }) => {
  const ariaId = await importCard(request, "Aria");
  const lisaId = await importCard(request, "Lisa");
  const noelId = await importCard(request, "Noel");

  const settings = await request.put(`${SERVER_URL}/api/settings`, {
    data: {
      baseUrl: "http://127.0.0.1:4010/v1",
      apiKey: "e2e-only",
      model: "e2e-model",
    },
  });
  expect(settings.status()).toBe(200);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "＋ 新建群聊" })).toBeVisible();
  await page.getByRole("button", { name: "＋ 新建群聊" }).click();

  const createDialog = page.getByTestId("group-create-dialog");
  await expect(createDialog).toBeVisible();
  await createDialog.getByPlaceholder("群聊名称（可选）").fill("夜谈小队");
  await createDialog.getByLabel("Aria", { exact: true }).check();
  await createDialog.getByLabel("Lisa", { exact: true }).check();
  await createDialog.getByLabel("Noel", { exact: true }).check();
  await createDialog.getByRole("button", { name: "创建群聊" }).click();
  await expect(createDialog).toBeHidden();
  await expect(page.getByText("夜谈小队", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "成员设置" }).click();
  const settingsDialog = page.getByTestId("group-settings-dialog");
  await expect(settingsDialog).toBeVisible();

  const lisaRow = page.getByTestId(`group-member-${lisaId}`);
  await lisaRow.getByRole("button", { name: "上移" }).click();
  await lisaRow.getByRole("checkbox").check();
  await settingsDialog.getByRole("button", { name: "保存群聊设置" }).click();
  await expect(settingsDialog).toBeHidden();

  await page.getByRole("button", { name: "成员设置" }).click();
  await expect(page.getByTestId(`group-member-${lisaId}`)).toHaveAttribute(
    "data-testid",
    `group-member-${lisaId}`,
  );
  await expect(page.getByTestId(`group-member-${lisaId}`).getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: "取消" }).click();

  const speaker = page.getByLabel("当前发言角色：");
  await speaker.selectOption(ariaId);
  await page.getByPlaceholder(/输入消息/).fill("请开始 E2E 对话。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("E2E 回复", { exact: true })).toBeVisible();

  await speaker.selectOption(lisaId);
  await page.getByLabel("允许静音角色发言").check();
  await page.getByPlaceholder(/输入消息/).fill("请让静音角色强制回复。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("E2E 回复", { exact: true }).last()).toBeVisible();

  await page.reload();
  await expect(page.getByText("夜谈小队", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("E2E 回复", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Lisa", { exact: true }).last()).toBeVisible();

  // 确认第三个成员仍存在，避免只验证了当前 speaker。
  await page.getByRole("button", { name: "成员设置" }).click();
  await expect(page.getByTestId(`group-member-${noelId}`)).toBeVisible();
});
