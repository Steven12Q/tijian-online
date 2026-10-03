# 题笺 Online Cloud v1.1

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


## v1.1 更新

- 数学渲染由 KaTeX 改为 MathJax，兼容更多常见 LaTeX。
- 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`。
- 内置 `\vv{AB}` → 向量箭头，以及 `\bm{}` 常用宏。
- 普通正文中的 `\\` 自动作为换行处理；数学环境中的 `\\` 保留给 aligned/cases/matrix。
- 自动忽略整行 `%` 注释以及常见文档前导命令。
- 题干和解析均支持多张 PNG/JPG/WebP/SVG 配图。
- 图片随题目保存在 PostgreSQL 中；当前版本适合教师小团队题库。大规模使用时可迁移至对象存储。
- 数据库会自动迁移，不会删除已有题目。

注意：浏览器 MathJax 不是完整 TeX 编译器。TikZ、任意宏包、完整 `documentclass` 文档不能在网页中直接编译；这类图请先导出为 PNG/SVG 后上传。


## v1.2 双重分类
- 每道题同时保存“章节分类”和“来源试卷”。
- 左侧新增“按章节”“按试卷”入口。
- 按试卷浏览时按原试卷题号排序。
- 老数据自动把原“知识板块”作为章节初值，不会清空已有题库。
