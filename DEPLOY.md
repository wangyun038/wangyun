# 谁是卧底 · Render 部署版

在 Render 创建 Web Service，选择 Git Provider 并连接本项目的 GitHub 仓库。部署设置如下。

| 设置 | 值 |
|---|---|
| Runtime | Node |
| Instance Type | Free |
| Build Command | npm run build |
| Start Command | npm start |
| Health Check Path | /healthz |

部署完成后，在浏览器打开 Render 分配的公网网址。裁判填昵称建房，玩家从邀请链接加入。

房间状态保存在当前服务实例的内存中。实例休眠、重启或重新部署后，需要新建房间。
