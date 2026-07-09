# 🔮 Alchemist Relay Edition — 部署指南

## 架构概览

```
端口 3000 (用户前端)
  index.html → localStorage Device ID
  输入 Access Key → 请求 → http://localhost:5000/api/v1/chat/completions

端口 5000 (后端中继服务器)
  server.js + SQLite
  验证 Access Key → 查询真实 Key → 转发 DeepSeek → 扣减积分

端口 8080 (管理员后台)
  admin/admin.html
  仪表盘 / 密钥管理 / 策略审计 / 消费日志
```

## 快速开始

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 启动后端

```bash
cd server
npm start
```

启动后：
- 🔮 用户 API: http://localhost:5000
- 🛡️ 管理员后台: http://localhost:8080

### 3. 配置管理员

1. 打开 http://localhost:8080
2. 默认密码 `alchemist-admin` 登录
3. 在「真实 API 密钥」添加 DeepSeek Key
4. 在「密钥管理」生成 Access Key 分发给用户
5. 在「模型费率」配置积分规则

### 4. 启动用户前端

```bash
npx serve . -p 3000 --no-clipboard
# 或: python3 -m http.server 3000
```

## 数据库表

| 表名 | 用途 |
|------|------|
| admin_settings | 管理员密码等全局配置 |
| real_api_keys | 真实的 DeepSeek API Key |
| access_keys | 分发给用户的 Access Key + 积分余额 |
| model_rates | 不同模型的积分消耗率 |
| devices | Device ID 与 Access Key 绑定关系 |
| user_strategies | 用户上传的 System Prompt / Template / Few-Shot |
| usage_logs | 每次 API 调用的详细消费记录 |

## 安全注意事项

1. 生产环境请修改默认管理员密码
2. 设置强随机 JWT_SECRET
3. 考虑在反向代理后启用 HTTPS
4. SQLite 数据库 (alchemist.db) 内含真实 API Key，需妥善保管
