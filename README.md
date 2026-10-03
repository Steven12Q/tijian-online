# 题笺 Online Cloud v1.0

这是面向 Render + PostgreSQL 的在线多人高中数学题库版本。

## 已包含

- 管理员、教师两种角色
- 管理员创建/停用教师账号
- 教师和管理员均可录入、编辑题目
- 管理员可删除题目
- LaTeX / KaTeX 数学公式显示
- 题目搜索、知识板块、题型、难度筛选
- 多人共享同一云端 PostgreSQL 题库
- 自动刷新共享题库
- 选题组卷、调整顺序
- 浏览器打印 / 保存 PDF
- Render Blueprint (`render.yaml`) 一键创建 Web Service + PostgreSQL

## 首次部署到 Render

推荐使用仓库根目录的 `render.yaml` 创建 Blueprint。

1. 把本项目所有文件上传到 GitHub 仓库根目录。
2. Render Dashboard 中选择 **New + → Blueprint**。
3. 连接/选择你的 GitHub 仓库 `tijian-online`。
4. Render 会读取 `render.yaml`，准备创建：
   - `tijian-online` Web Service
   - `tijian-db` PostgreSQL
5. Render 会要求填写 `ADMIN_PASSWORD`。请设置一个你自己能记住的强密码。
6. 点击 Apply / Deploy。
7. 部署完成后，打开 Render 给出的 `*.onrender.com` 地址。
8. 管理员用户名默认：`admin`；密码就是第 5 步设置的 `ADMIN_PASSWORD`。
9. 登录后进入 **教师账号** 页面，创建其他教师账号。

## 重要说明

- 不要把管理员密码写进 GitHub 文件。
- 教师可编辑共享题目；只有管理员可删除题目和管理教师账号。
- 题库数据保存在 PostgreSQL 中，不依赖某一台教师电脑。
- 当前组卷清单保存在当前浏览器本地；题库本身是云端共享的。
