/**
 * Another Tavern —— 无头引擎（headless engine）。
 *
 * 职责：角色卡解析、世界书引擎、Prompt 组装器、tokenizer 接口。
 * 约束：零 UI 依赖、不发网络请求、不碰数据库。
 *
 * 当前为 M0 脚手架，仅暴露版本常量，用于验证构建与测试链路。
 */

export const ENGINE_VERSION = "0.1.0";
