# DSH 守岸人语音播报

最小 DSH 插件：每轮 AI 正常结束后，把该轮最后一条 assistant 可见文本通过 Inworld TTS 合成为 MP3，并在 macOS 上播放。使用 `sunny-fern-4510__shorekeeper-pro`，语速 1.0x。

## 启用

需要 macOS、Node.js 和 DeepSeek Harness。在启动 DSH 前，将 Inworld API key 配置到启动进程的环境变量 `INWORLD_API_KEY`，不要把真实 key 写进仓库。

在本仓库目录中启动 DSH Web，并将 `cordis.yml` 作为 overlay 加载：

```sh
npx --yes --package @deepseek-ai/dsh@0.2.2-rc.1 dsh web --patch "$(pwd)/cordis.yml" --port 18080
```

如果端口已被占用，请换一个高于 10000 的空闲端口。打开 DSH 输出的本机地址，正常发送消息即可。AI 回复结束后会自动播放语音。

插件使用 macOS 自带的 `afplay` 播放生成的 MP3。它只播报 `turn/end` 原因是 `completed` 的轮次；取消或失败的轮次不会播报。

## 验证

在本目录运行：

```sh
node --test test.mjs
```
