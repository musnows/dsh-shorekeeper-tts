# DSH 守岸人

给 DeepSeek Harness（`dsh` `0.2.2-rc.1`）加两个本地插件：

- **守岸人模拟**：插件一加载就进入守岸人人设，不需要再输入进入指令。
- **守岸人语音**：回复往外流的时候，只把屏幕上的正文送给 Inworld，用守岸人音色朗读。推理和工具参数不读。

人设材料来自 [SHOREKEEPER-AGENT](https://github.com/ArayaTouka1/SHOREKEEPER-AGENT)，没有整本照搬。文件名里带「越狱」的材料不会被读入。`{{char}}`、`{{user}}`、`{char}`、`{user}` 原样进入提示词，运行时不替换。

Inworld key 和 DeepSeek key 只放在进程环境或本机 `~/.dsh/` 下，不写进仓库。

推荐搭配的守岸人主题（线稿开屏 + 可换背景）用我们的 fork：[musnows/shorekeeper-theme](https://github.com/musnows/shorekeeper-theme)。相对上游补回了 `shell.overlay` 挂载，避免桌面端开场只剩黑屏；安装方式见该仓库 README / 安装教程。

## 网页

在仓库根目录启动。要走官方 npm 源，镜像源上可能没有 `@deepseek-ai/cordis-plugin-timer@1.2.0`：

```sh
npx --yes --registry https://registry.npmjs.org --package @deepseek-ai/dsh@0.2.2-rc.1 \
  dsh web --patch "$PWD/cordis.yml" --port 18080 --no-open
```

`cordis.yml` 会关掉 Harness 自带的编程助手开场（`includeHarnessIdentity: false`，`personaPrefix` 为空），并插入 `./plugin.mjs` 和 `./persona.mjs`。这两个文件再导出包里的实现。

可以用 tmux 保住进程，例如会话名 `dsh-shorekeeper`。重启会换掉地址里的 token，以终端里打印的地址为准。

## 桌面客户端

应用是 `/Applications/DeepSeek Harness.app`。桌面 profile 由 Electron 独占，不能用 `dsh --profile desktop` 从命令行改。配置在：

`~/.dsh/profiles/desktop/cordis.patch.yml`

把系统提示词的 Harness 身份关掉，并插入两个中文 id。中文 id 和语言包里的 `meta.title` 一致，设置页卡片才不会露出 `file:///` 或英文包名：

```yaml
- id: system-prompt
  config:
    includeHarnessIdentity: false
    personaPrefix: ''

- insert:
    - id: 守岸人语音
      name: '@dsh-local/shorekeeper-tts'
    - id: 守岸人模拟
      name: '@dsh-local/shorekeeper-persona'
```

依赖写在 `~/.dsh/profiles/desktop/package.json`，用 `file:` 指到本仓库的两个包。pnpm 会把包复制进自己的内容寻址仓库，改源码不会自动进到已经启动的客户端。改完人设或语音后，在桌面 profile 目录里对改过的那个包执行 `pnpm remove` 再 `pnpm add file:...`，然后重启 DeepSeek Harness。不要在 git 仓库根目录执行 `pnpm add`。

```sh
cd ~/.dsh/profiles/desktop
pnpm remove @dsh-local/shorekeeper-tts
pnpm add "file:/绝对路径/dsh-shorekeeper-tts/packages/shorekeeper-tts"
pnpm remove @dsh-local/shorekeeper-persona
pnpm add "file:/绝对路径/dsh-shorekeeper-tts/packages/shorekeeper-persona"
```

Inworld key 给 Dock 启动的客户端用：`~/.dsh/.env` 里的 `INWORLD_API_KEY`，模式 `600`。值如果以 `==` 结尾，必须加引号。插件先读进程环境，再读这个文件。DeepSeek key 在 `~/.dsh/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`。

## 语音

切分点只有中文句号「。」和代码块外面的换行。去掉空白后不超过起送字数时不送去合成；超过之后，下一个句号或换行才送出。起送字数默认 30，可在 20 到 50 之间按 5 调整。这一轮正文结束时，剩下的字仍会读完。Markdown 围栏里的内容不读。

语速默认 1.0x，可在 0.8x 到 1.5x 之间按 0.1 调整。朗读音量默认 1.0，可在 0 到 1 之间按 0.1 调整，只影响 `afplay -v`，不改系统音量。正在播的句子保持当时的音量，下一句再用新的。桌面客户端里，输入框下方的状态栏显示「语速 1.0x」，点开浮层后可以开关播报，并拖音量、语速和起送字数；侧边栏「插件」里「守岸人语音」这一行的配置页展开同一套控件，摘要是「语速 0.8x–1.5x · 音量 0–1 · 起送 20–50 字」。「关闭播报」会停下当前播放，之后的句子不再读；再点「打开播报」后，从新的句子继续。改完的下一句按新语速合成，已经合成、还在排队的句子保持原来的速度。

状态栏和插件页来自包里的 `client.js`。回复下方操作栏还有语音按钮：点击后停下当前播放，把该条回复的全部正文重新送去 TTS 并播一遍；关闭自动播报时也能用。网页用 `./plugin.mjs` 直接挂宿主时只合成语音，不带这套界面。桌面 profile 要重新 `pnpm add file:...` 并重启 DeepSeek Harness，浏览器模块才会换成新的。

浮层分隔线下面是桌面宠物。打开后会在本机 `18766` 端口拉起实时语音，并弹出无边框的守岸人窗口。收音阈值和麦克风条只在宠物开着时出现。宠物说话走自己的播放，不吃上面的音量滑条。桌宠资源随 TTS 包一起分发（`packages/shorekeeper-tts/realtime-demo`）；第一次打开时会在本机安装依赖并编译 `ShorekeeperPet.app`（需要 macOS 与 Xcode Command Line Tools）。关掉开关会停掉窗口和这个端口；用窗口上的关闭按钮关掉后，下次退出 Harness 不会再自动打开。问到网上的事时，桌宠会调用 DeepSeek 的搜索接口 `POST /v1/tools/search`，密钥和对话模型相同：先读进程里的 `DEEPSEEK_API_KEY`，再读 `~/.dsh/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`，最后读 `~/.dsh/.env`。

句子按顺序合成，也按顺序播放。下一句可以在上一句还在播的时候先去合成。打断有两个入口，都会停下当前播放并丢掉还没说的缓冲：

- `Control+Option+.`。第一次会向这个小程序要辅助功能权限，不给 DeepSeek Harness 本身。
- `/shush`

网页进程和桌面进程各自听自己的快捷键，只停自己那一份播放。

## 提示词

每轮都放人格本身。`06-世界.md` 的关键词段、角色卡里没有标成常驻的世界书，只有用户这一句碰到对应词才放进来。开场只取当前时段，好感例句只取「至交」，各随机最多 4 句。没有好感存档。

用户这一句来自当前 session 里最后一条人类 `user/message` 的 text 块。没有 session 时，关键词段不放。

## 验证

```sh
node --test test.mjs
```

测试不请求 Inworld。
