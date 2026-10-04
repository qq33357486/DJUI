# Runtime v6 图片同步回归

执行 `dotnet run --project tests/RuntimeVisuals/RuntimeVisuals.csproj`（.NET 9 SDK）。不访问业务项目，不启动引擎，无第三方测试包。

项目链接生产的 v6 协议模型、布局求解、响应式解析、建树/克隆、图片与进度条绘制层、按钮状态机及 WindowManager。EngineStubs 仅提供控件属性/父子树、帧调度和不相关的行为/音效/转场替身；Width/Height setter 故意不触发事件，确保隐藏和未挂树克隆也能同步。

断言实际绘制子层的图片、位置、尺寸、裁剪、九宫格边距和染色；覆盖 contain/cover/stretch、多组尺寸与零尺寸恢复、sourceSize 缺失降级、焦点、隐藏再显示、克隆局部坐标、立即递归刷新及单节点刷新、按钮按压与禁用状态、换图染色共存、线性进度条和销毁清理。未变化的尺寸不能产生重复矩形写入。

这是源码执行回归，不包含纹理解码、引擎实际九宫格渲染、原生布局/输入或截图验证。实机验收需由业务会话同步 Runtime 后验证。
