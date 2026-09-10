import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
export default async function globalSetup(): Promise<void> {
  const directory = resolve("e2e/.tmp");
  await mkdir(directory, { recursive: true });
  await rm(resolve(directory, "browser-e2e.db"), { force: true });
}
