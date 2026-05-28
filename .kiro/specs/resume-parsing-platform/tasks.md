# Implementation Plan (3-Day MVP)

> **范围说明**：本计划压缩到 3 天可交付的最小闭环。砍掉了多简历、异步队列、OSS、Redis、多模型路由、PBT、加密、限流等非核心能力。所有删减项已在 design.md 中保留接口，便于后续 v2 扩展。
>
> **MVP 闭环目标**：用户上传 PDF/DOCX/图片简历 → 平台同步调用一个 VLM 解析为结构化 JSON → 通过 API 拉取 → 插件提交表单字段调用智能填写接口 → 返回填写方案。
>
> **状态**：✅ 已完成。26 项自动化测试全部通过。

---

## Day 1：骨架 + 契约 + 适配层

- [x] 1. 项目骨架与依赖
- [x] 2. 配置、日志、异常
- [x] 3. 数据库与 ORM
- [x] 4. 核心 Schema（与插件端的契约）
  - [x] 4.1 ResumeData
  - [x] 4.2 FillPlan
  - [x] 4.3 API 请求/响应模型
- [x] 5. 存储抽象（仅本地实现）
- [x] 6. 模型适配器（OpenAI 兼容 → 同时支持 GLM/Qwen）
- [x] 7. 文档预处理（PDF/DOCX/图片）

## Day 2：业务逻辑 + API

- [x] 8. Prompt 模板（parse_resume / fill_form）
- [x] 9. Repository 层
- [x] 10. 安全与认证（API Key + SHA256）
- [x] 11. 业务服务（4 个 Service）
  - [x] 11.1 UserService
  - [x] 11.2 ResumeService（同步上传+解析+去重+patch+delete）
  - [x] 11.3 ParsingService（含失败重试）
  - [x] 11.4 FillService（含缓存命中校验）
- [x] 12. API 路由
  - [x] 12.1 错误处理中间件
  - [x] 12.2 用户路由
  - [x] 12.3 简历路由（含 PATCH 缓存清理）
  - [x] 12.4 填写方案路由
  - [x] 12.5 健康检查
  - [x] 12.6 主应用入口

## Day 3：联调 + 测试 + 文档

- [x] 13. 端到端冒烟测试（已 26 项全部通过）
  - [x] 13.1 注册 + 上传 + 修正
  - [x] 13.2 填写方案缓存命中/失效
  - [x] 13.3 用户隔离（403）+ 认证（401）
  - [x] 13.4 内容哈希去重、删除级联
- [x] 14. ARCHITECTURE.md
- [x] 15. README.md + examples/form_fields.json

## v2 路线（3 天后再做）

- 多模型路由 + 降级
- 异步任务队列（RQ/arq）
- OSS/S3 存储
- Redis 缓存
- 敏感字段加密 + 日志脱敏完整方案
- 用户当日成本限额
- Hypothesis 基于属性的测试（design.md 中的 7 条 Property）
- 多简历管理 + 默认简历切换
- 速率限制
