# DSH 守岸人语音播报

这是一个 DeepSeek Harness（DSH）插件。每次 AI 正常完成一轮回复后，插件会用 Inworld 的守岸人音色朗读该轮最后一条回复。

## 准备

- macOS：音频通过运行 DSH 的 Mac 上的 `afplay` 播放。
- Node.js 24.9 或更高版本，以及 `tmux`。
- 一个可用于生成语音的 Inworld API key。它与 DSH 使用的 DeepSeek 模型 API key 是两个独立的 key。
- 能访问本私有仓库的 GitHub 账号和 Git SSH 配置。

## 安装

在终端克隆仓库并进入目录：

```sh
git clone git@github.com:musnows/dsh-shorekeeper-tts.git
cd dsh-shorekeeper-tts
```

插件无需安装额外的 npm 依赖。下面的启动命令会通过 npm 获取指定版本的官方 DSH。

## 启动

以下命令适用于 macOS 默认的 zsh。先在仓库目录里运行：

```sh
read -rs 'INWORLD_API_KEY?Inworld API key: '
printf '\n'
export INWORLD_API_KEY
tmux new-session -s dsh-shorekeeper -e INWORLD_API_KEY="$INWORLD_API_KEY" -e DSH_PLUGIN_DIR="$PWD"
```

输入 Inworld API key 时终端不会显示内容。`tmux` 会打开一个新会话；在该会话中继续运行：

```sh
npx --yes --package @deepseek-ai/dsh@0.2.2-rc.1 dsh web --patch "$DSH_PLUGIN_DIR/cordis.yml" --port 18080
```

如果 `18080` 已被占用，请把它替换为其他高于 10000 的空闲端口。首次运行可能需要下载 DSH，请等待启动完成。终端显示的本机地址包含访问令牌，在这台 Mac 的浏览器中打开该地址。

如果提示 `dsh-shorekeeper` 会话已存在，可以运行 `tmux attach -t dsh-shorekeeper` 回到已有会话。保持 DSH 运行时，可按 `Ctrl-b`，松开后按 `d` 离开 tmux；之后使用同一条 `tmux attach` 命令返回。

## 使用

1. 首次进入 DSH 时，按页面提示登录 DeepSeek 账号，或配置 DeepSeek 模型的 API key。
2. 在 DSH 中正常发送消息。
3. AI 正常结束回复后，等待守岸人自动朗读。音量由运行 DSH 的 Mac 的系统音量控制。

插件使用 `sunny-fern-4510__shorekeeper-pro` 音色、`inworld-tts-2` 模型和 1.0x 语速。它只播报正常完成的回合；取消或失败的回合不会播报。播报文本会发送至 Inworld，音频会写入系统临时目录，并在下一次播放时覆盖。

## 停止和重新启动

回到 DSH 所在的 tmux 会话后，按 `Ctrl-c` 停止 DSH，再输入 `exit` 结束该 tmux 会话。需要重新启动时，从“启动”步骤重新配置 Inworld key 并运行命令。不要把真实 key 写进源码、README 或提交到 GitHub。

## 遇到问题

- 没有声音：检查 Mac 的音量和输出设备，确认 DSH 是在本机运行，并查看 DSH 所在终端是否有 `[dsh-shorekeeper-tts]` 错误。
- 提示 `INWORLD_API_KEY is not configured`：在启动 DSH 的环境中设置 Inworld key，然后重启 DSH。
- AI 无法回复：检查 DSH 中的 DeepSeek 登录状态或模型 API key；它与 Inworld key 分开配置。
- 端口已被占用：启动 DSH 时换用其他高于 10000 的空闲端口。

## 验证插件

在本仓库目录中运行：

```sh
node --test test.mjs
```

这些测试使用模拟数据，不会请求 Inworld。验证真实播报时，请在 DSH 中发送一条简短消息并等待 AI 完成回复。
