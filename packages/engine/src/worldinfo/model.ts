/**
 * 世界书引擎数据模型。
 *
 * 与 docs/world-info-spec.md §2 一一对应；修改任一侧必须同步另一侧。
 */

/** 注入位置。前三项 v1 实现；其余为已识别不实现（world-info-spec §9）。
 *  数字编码映射见 world-info-spec §8.2。 */
export type WorldInfoPosition =
  | "beforeChar"
  | "afterChar"
  | "atDepth"
  | "anTop"
  | "anBottom"
  | "beforeExample"
  | "afterExample"
  | "outlet";

/** 副关键词组合逻辑。数值对齐 ST world_info_logic：andAny=0, notAll=1, notAny=2, andAll=3。 */
export type SelectiveLogic = "andAny" | "andAll" | "notAny" | "notAll";

/** atDepth 注入使用的消息角色。 */
export type InjectionRole = "system" | "user" | "assistant";

/** 单条世界书条目（规范化形态；V2 字段直映，ST 扩展从 entry.extensions.* 读出）。 */
export interface WorldInfoEntry {
  /** 稳定唯一 id（映射自 V2 id，缺失时导入器生成）。 */
  id: string;
  /** 备注/标题，不进 prompt。 */
  comment: string;
  /** 主关键词；任一命中即触发。空数组 + constant=false ⇒ 永不激活。 */
  keys: string[];
  /** 副关键词，仅 selective=true 时参与判定。 */
  secondaryKeys: string[];
  /** true 时要求主/副组合满足 logic；false 时忽略 secondaryKeys。 */
  selective: boolean;
  /** selective=true 时的组合逻辑；默认 andAny。 */
  logic: SelectiveLogic;
  /** 激活后注入的正文。 */
  content: string;
  /** false = 禁用状态：任何阶段不激活、不占预算、不触发递归。 */
  enabled: boolean;
  /** 常驻：无视关键词恒候选（仍受预算限制）。 */
  constant: boolean;
  /** 插入顺序：值小 = 更靠 prompt 上方。默认 100。 */
  insertionOrder: number;
  /** 注入位置；默认 afterChar。 */
  position: WorldInfoPosition;
  /** position=atDepth 时生效；null 按 4 处理（ST DEFAULT_DEPTH）。其余位置为 null。 */
  depth: number | null;
  /** position=atDepth 时的消息角色；null 按 system 处理。其余位置为 null。 */
  role: InjectionRole | null;
  /** 逐条覆盖全局扫描深度；null=继承。 */
  scanDepth: number | null;
  /** 逐条覆盖大小写敏感；null=继承。 */
  caseSensitive: boolean | null;
  /** 逐条覆盖整词匹配；null=继承。 */
  matchWholeWords: boolean | null;
  /** true = 本条目 content 不再触发其它条目的递归激活。 */
  preventRecursion: boolean;
  /** true = 本条目不能被递归激活（仅初始扫描可命中）。 */
  excludeRecursion: boolean;
  /** 未知扩展原样保留（cards-spec §7）；未支持特性均落在此处。 */
  extensions: Record<string, unknown>;
}

/** 一本世界书（V2 character_book 的规范化形态）。 */
export interface WorldInfoBook {
  id: string;
  name: string | null;
  description: string | null;
  /** 书级扫描深度（V2 scan_depth）；null=用全局。 */
  scanDepth: number | null;
  /** 书级 token 预算（V2 token_budget）；null=用全局百分比预算。 */
  tokenBudget: number | null;
  /** 书级递归开关（V2 recursive_scanning）；null=用全局默认（false）。 */
  recursiveScanning: boolean | null;
  entries: WorldInfoEntry[];
  extensions: Record<string, unknown>;
}
