# 帽帽 · GIF 聊天 Demo

这是一个可以本地运行、也可以部署到 Vercel 的聊天小程序。

它做了三件事：

1. 左边是聊天界面  
2. 右边是虚拟形象“帽帽”  
3. 帽帽会根据对话过程切换不同 GIF 状态

这个项目现在采用的是：

- Vite 前端
- Vercel Serverless API
- OpenAI Key 只保存在服务端环境变量里
- 本地可用 `npm run dev`
- 线上可用 Git 导入到 Vercel

---

# 先看效果是什么

这个程序里，帽帽是一只戴魔法帽的北长尾山雀，定位是陪伴型智能助手。

当你使用程序时，右边 GIF 会这样变化：

- 你开始打字：切到 `listening_attentive`
- 你点击发送：切到 `thinking_process`
- 模型回答完成：
  - 普通解释类：切到 `speaking_explain`
  - 轻松友好类：切到 `warm_friendly`
  - 夸赞鼓励类：切到 `positive_happy`
  - 共情安抚类：切到 `warm_friendly`

同时，同一个状态下不只一张 GIF，而是一个 **loop 池**。  
程序会随机选下一张，并尽量避免连续两次播放同一张。

---

# 本地启动只要 5 步

## 第 1 步：安装 Node.js

你电脑里需要先有 Node.js。

最简单的办法：

1. 打开 Node.js 官网
2. 下载 **LTS** 版本
3. 一路下一步安装

安装完成后，打开终端 / 命令行，输入：

```bash
node -v
npm -v
```

如果能看到版本号，就说明安装成功了。

---

## 第 2 步：解压这个 zip

把你下载的 zip 解压到一个你容易找到的文件夹，比如桌面。

解压后你会看到类似这些文件：

```txt
maomao-local-gif-chat/
  src/
  public/
  scripts/
  package.json
  README.md
```

---

## 第 3 步：配置环境变量

在项目根目录新建：

```txt
.env.local
```

内容可以直接参考：

```txt
.env.local.example
```

最少需要这两个值：

```txt
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4.1-mini
```

---

## 第 4 步：安装依赖

在这个项目根目录打开终端，然后运行：

```bash
npm install
```

第一次运行会安装项目需要的包，通常要几十秒到几分钟。

---

## 第 5 步：启动程序

继续在项目根目录运行：

```bash
npm run dev
```

成功后，终端里会出现一个本地网址，通常像这样：

```txt
http://localhost:5173/
```

把它复制到浏览器打开，就能看到程序了。  
本地开发时，Vite dev server 会直接挂载 `/api/chat`，所以不需要再单独起一个后端。

---

# 部署到 Vercel

推荐方式：**Git 导入**

## 1. 把项目放到 Git 仓库

如果你当前目录还不是 Git 仓库，在项目根目录执行：

```bash
git init
git add .
git commit -m "Prepare Vercel deployment"
```

然后把它推到 GitHub / GitLab。

## 2. 在 Vercel 里导入仓库

1. 打开 Vercel Dashboard
2. 点 `New Project`
3. 选择这个仓库
4. Framework Preset 选 `Vite`
5. Root Directory 保持项目根目录
6. Build Command 使用 `npm run build`
7. Output Directory 使用 `dist`

## 3. 配置 Vercel 环境变量

在 Vercel Project Settings -> Environment Variables 里添加：

```txt
OPENAI_API_KEY=你的真实 OpenAI Key
OPENAI_MODEL=gpt-4.1-mini
```

建议同时加到：

- Preview
- Production

## 4. 首次部署

配置完后直接点 Deploy。  
之后：

- 推送分支会生成 Preview Deployment
- 合并到生产分支会生成 Production Deployment

## 5. 本地对齐 Vercel 环境

如果你已经安装了 Vercel CLI，可以用：

```bash
vercel env pull .env.local
```

把 Vercel 里的开发环境变量拉回本地。

---

# 如果你只会一点点技术，也能这样理解这个项目

你可以把这个程序理解成 4 层。

## 第 1 层：聊天层

文件主要在：

```txt
src/features/chat/
```

这一层负责：

- 收集你的输入
- 把聊天记录发给 OpenAI
- 要求模型按固定 JSON 结构返回
- 把返回内容变成真正显示在聊天框里的文字

你不需要先看源码，只需要知道：

**这一层管“说什么”。**

---

## 第 2 层：语义层

模型不会只返回一句话，还会顺便返回：

- 这句回复是什么语气
- 现在帽帽应该进入哪个状态

比如模型可能返回类似这样的结构：

```json
{
  "reply": {
    "text": "老板，我先给你结论，再拆步骤。",
    "language": "zh",
    "address_user_as": "老板"
  },
  "animation": {
    "semantic_intent": "instruction",
    "target_state": "speaking_explain",
    "tone": "calm_supportive",
    "should_hold": false
  }
}
```

也就是说：

- 左边聊天气泡用 `reply.text`
- 右边 GIF 状态机用 `animation.target_state`

**这一层管“此刻应该表现成什么感觉”。**

---

## 第 3 层：状态机层

文件主要在：

```txt
src/features/avatar/
```

这一层负责：

- 当前在什么状态
- 要去什么状态
- 先播过渡 GIF，还是直接切 loop
- 如果没有直接过渡，怎么 fallback
- 哪张 loop GIF 该先播，哪张后播

你可以把它理解成一个“动画交通指挥系统”。

例如：

- 当前是 `thinking_process`
- 目标是 `positive_happy`
- 如果没有直接过渡，就先尝试：
  - 走 `idle_neutral`
  - 或走更接近的中间状态
  - 还不行就直接切目标 loop

---

## 第 4 层：素材层

文件主要在：

```txt
public/avatar/
```

目录结构是这样：

```txt
public/avatar/
  loops/
    idle_neutral/
    warm_friendly/
    listening_attentive/
    thinking_process/
    speaking_explain/
    positive_happy/
    empathy_concern/

  transitions/

generated/avatar/
  reverse/
```

### loops
每个状态一个文件夹，里面可以放多张 GIF：

```txt
idle_neutral_01.gif
idle_neutral_02.gif
```

### transitions
这里放正向过渡：

```txt
tr_idle_neutral_to_warm_friendly.gif
tr_listening_attentive_to_thinking_process.gif
```

### generated/avatar/reverse
这里放脚本自动生成的反向派生资源：

```txt
tr_idle_neutral_to_warm_friendly__rev.gif
```

程序逻辑上仍然把这件事理解为：

**“反方向统一倒放”**

只是工程实现不是在浏览器里强行倒放 GIF，而是**提前准备好反向素材**。  
这样更稳定，也更容易控制。

---

# 这个项目里最重要的几个文件

## 1. `src/App.tsx`
整个页面入口。

你可以把它理解成“总导演”。

负责：

- 左边聊天 UI
- 右边状态展示
- 输入框联动 listening
- 点击发送联动 thinking
- 收到模型结果后联动最终状态

---

## 2. `src/features/chat/chatService.ts`
负责真正调用 OpenAI。

它会把聊天记录发过去，并要求模型返回结构化 JSON。

---

## 3. `src/features/chat/promptBuilder.ts`
这里定义了帽帽的人设。

以后你想改角色性格、称呼方式、语言风格，优先改这里。

---

## 4. `src/features/avatar/avatarController.ts`
这是动画状态机核心。

以后你要改：

- 状态切换逻辑
- fallback 路由逻辑
- 是否自动回 idle
- transition 是否不可中断

优先看这个文件。

---

## 5. `src/features/avatar/routePlanner.ts`
这里专门管“从 A 到 B 怎么走”。

它的优先级是：

1. 直接正向过渡  
2. 找反向资源，用 reverse  
3. 尝试经过 `idle_neutral`  
4. 尝试经过语义更接近的中间态  
5. 再不行就直接切目标 loop  

---

## 6. `src/features/avatar/loopScheduler.ts`
这里专门管 loop GIF 随机播放。

规则是：

- 同状态随机选
- 尽量避免连续两次同一张
- 如果池子里只有 1 张，就允许重复

---

## 7. `scripts/generate-avatar-manifest.mjs`
这是自动扫描素材的脚本。

它会扫描 `public/avatar/` 下的 GIF，然后生成：

```txt
src/features/avatar/avatarManifest.generated.ts
```

这个生成文件会告诉程序：

- 有哪些 loop
- 有哪些 transition
- 每个资源的路径是什么

所以你以后替换素材后，只要重新运行项目，脚本会自动刷新资源清单。

---

# 这个项目的状态有哪些

目前内置 6 个锚点状态：

```txt
idle_neutral
warm_friendly
listening_attentive
thinking_process
speaking_explain
positive_happy
```

它们的含义：

- `idle_neutral`：默认待机
- `warm_friendly`：温和友好
- `listening_attentive`：认真听你说话
- `thinking_process`：模型思考中
- `speaking_explain`：解释说明
- `positive_happy`：开心认可

---

# 为什么这里不用 p5.js 来倒放 GIF

这件事我已经按更稳的工程做法处理了。

原因很简单：

- 浏览器原生 GIF 本来就不好精确控制
- p5.js 虽然能手动控帧，但并没有一个现成、稳定的“直接倒放 GIF”方案
- 你的项目重点是聊天状态机，不是做 canvas 动画引擎

所以这里用的是更稳的方式：

- 正向 GIF 放在 `transitions/`
- 反向派生资源由脚本生成到 `generated/avatar/reverse/`
- 程序逻辑上仍然保留 `playDirection = forward / reverse`

这样你后续如果升级成：

- WebM
- 序列帧
- sprite sheet

上层逻辑都不用重写。

---

# 以后如果你要替换成你自己的 GIF，要怎么做

## 替换 loop

假设你要替换 `warm_friendly`：

把你的 GIF 放进：

```txt
public/avatar/loops/warm_friendly/
```

命名成：

```txt
warm_friendly_01.gif
warm_friendly_02.gif
warm_friendly_03.gif
```

程序会自动把它们当成这个状态的 loop 池。

---

## 替换 transition

例如你有：

```txt
tr_idle_neutral_to_warm_friendly.gif
```

就放到：

```txt
public/avatar/transitions/
```

然后运行：

```bash
npm run gen:avatar
```

脚本会自动在：

```txt
generated/avatar/reverse/
```

里生成对应的：

```txt
tr_idle_neutral_to_warm_friendly__rev.gif
```

注意：  
这里的 `__rev` 不是状态方向名字，而是“这个文件是给 reverse 播放用的派生资源”。

---

# 如果你想改帽帽的人设，改哪里

改这里：

```txt
src/features/chat/promptBuilder.ts
```

你可以改：

- 默认称呼
- 说话语气
- 是否更活泼
- 是否更克制
- 是否更强调陪伴感

---

# 如果你想加新的状态，改哪里

需要一起改这几处：

## 1. 类型定义
```txt
src/features/avatar/types.ts
```

## 2. 状态配置
```txt
src/features/avatar/avatarConfig.ts
```

## 3. 新状态的 loop 素材目录
```txt
public/avatar/loops/你的新状态名/
```

## 4. 如果要新增过渡，再放 transition 素材
```txt
public/avatar/transitions/
generated/avatar/reverse/
```

---

# 常见报错怎么处理

## 1. 页面提示 Chat API 不可用
优先检查：

- `.env.local` 里有没有 `OPENAI_API_KEY`
- 本地是不是用项目根目录启动的 `npm run dev`
- Vercel 上有没有正确配置 `OPENAI_API_KEY`

---

## 2. `npm install` 失败
通常是：

- Node.js 没装好
- 网络问题
- npm 版本过旧

先试：

```bash
node -v
npm -v
```

确认是否正常。

---

## 3. 发送消息时报错
优先检查这几件事：

1. `OPENAI_API_KEY` 是否正确  
2. `OPENAI_MODEL` 是否正确  
3. 网络是否可访问 OpenAI  
4. 账户是否有可用额度  
5. Vercel Function 日志里是否有报错  

模型名默认是：

```ts
gpt-4.1-mini
```

你也可以在 `.env.local` 或 Vercel Environment Variables 里改成别的模型。

---

## 4. 右边 GIF 不动
优先检查：

- 素材路径是否正确
- 文件命名是否符合规则
- 是否成功生成了 `avatarManifest.generated.ts`

你可以重新运行：

```bash
npm run gen:manifest
```

---

# 这个项目适合什么，不适合什么

## 适合
- 你自己本地试验
- 做角色聊天 demo
- 验证 GIF 状态机流程
- 后续替换成你自己的正式素材

## 不适合
- 把 API Key 写回前端代码
- 绕过 `/api/chat` 让浏览器直连 OpenAI
- 不配环境变量就直接上线
- 在没有日志和限额控制的情况下多人共享

---

# 一句话总结程序架构

你可以把它理解成：

**聊天文本由服务端 OpenAI 调用决定，动画路线由前端状态机决定，素材文件由 manifest 自动扫描，最终一起组成一个能“边聊天边变表情”的可部署 demo。**

---

# 建议你第一次运行时这样测试

你可以按这个顺序试：

1. 输入：  
   `你好，先介绍一下你自己`

2. 输入：  
   `帮我把做一个问卷拆成三步`

3. 输入：  
   `我今天有点焦虑`

4. 输入英文：  
   `Can you answer me in English?`

观察右侧状态有没有跟着变化。

---

# 最后提醒

这个项目现在已经改成：

- 前端只调用 `/api/chat`
- OpenAI Key 只放在服务端环境变量里
- 可以安全地用 Git 导入到 Vercel

如果以后你想，我下一步最合适的升级方向是：

- 把占位 GIF 替换成你自己的正式 GIF
- 给 `/api/chat` 加登录、限流和日志
- 再考虑打包成 Electron 桌面版
