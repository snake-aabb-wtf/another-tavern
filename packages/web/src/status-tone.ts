/**
 * 状态文案 → 呈现色调（纯展示分类，不含任何行为逻辑）。
 * 失败（命中失败前缀）= ember；进行中（命中进行中前缀）与空文案 = ink；
 * 其余（成功态，如带 ✓ 的常量）= moss。
 */
export function statusTone(
  status: string,
  failedPrefixes: readonly string[],
  pendingPrefixes: readonly string[] = [],
): string {
  if (status === "") {
    return "text-ink-400";
  }
  if (failedPrefixes.some((prefix) => status.startsWith(prefix))) {
    return "text-ember-400";
  }
  if (pendingPrefixes.some((prefix) => status.startsWith(prefix))) {
    return "text-ink-400";
  }
  return "text-moss-500";
}
