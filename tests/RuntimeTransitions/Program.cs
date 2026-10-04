using System.Numerics;
using DjuiRuntime;
using GameUI.Control;
using GameUI.Struct;
using System.Text.Json;

var assertions = 0;
void Near(float actual, float expected, string label)
{
    assertions++;
    if (MathF.Abs(actual - expected) > 0.001f) throw new Exception($"{label}: {actual} != {expected}");
}
void Check(bool ok, string label) { assertions++; if (!ok) throw new Exception(label); }
void Tick(int ms) { foreach (var t in Game.Thinkers.ToArray()) t.Think(ms); }
DjuiTreeInstanceV6 Create(float width = 1080, float height = 2400)
{
    var t = new DjuiTreeInstanceV6();
    t.Root.Width = width; t.Root.Height = height;
    void Add(string id, Control c, DjuiNodeV6 model)
    {
        model.Id = id; c.Parent = t.Root; t.Root.ChildList.Add(c);
        t.Session.Controls.Add(id, c); t.Session.CurrentPage.Root.Children.Add(model);
    }
    Add("fixed", new Panel { Width = width, Height = height, Opacity = .4f }, new() { Stretch = new() { Style = "Both" }, Anchor = new() { Target = "parent" } });
    Add("sheet", new Panel { Width = 1000, Height = 1420, Position = new(40, 470) }, new());
    Add("hint", new Panel { Width = 300, Height = 60, Position = new(390, 2100), Rotation = 30 }, new());
    Add("hidden", new Panel { Width = width, Height = height, Visible = false, Opacity = 0 }, new() { Stretch = new() { Style = "Both" }, Anchor = new() { Target = "screen" } });
    return t;
}
Control Get(DjuiTreeInstanceV6 t, string id) => t.Session.Controls[id];
Vector2 Center(Control c) => new(c.Position.X + c.Width.Value / 2, c.Position.Y + c.Height.Value / 2);

// 约束判定不靠名字、颜色或参考分辨率尺寸；safe、image、非零边距、宽高比不属于全屏层。
Check(DjuiWindowTransitionV6.IsFixedLayer(new() { Stretch = new() { Style = "Both" } }), "省略 parent 和 margins");
foreach (var target in new[] { "safe", "image" })
    Check(!DjuiWindowTransitionV6.IsFixedLayer(new() { Anchor = new() { Target = target }, Stretch = new() { Style = "Both" } }), target);
Check(!DjuiWindowTransitionV6.IsFixedLayer(new() { Stretch = new() { Style = "Both", Margins = new(0, 0, 1, 0) } }), "非零边距");
Check(!DjuiWindowTransitionV6.IsFixedLayer(new() { Stretch = new() { Style = "Both" }, AspectRatio = new() { Mode = "FitInParent" } }), "宽高比");

var tree = Create();
var sheet = Get(tree, "sheet"); var hint = Get(tree, "hint"); var layer = Get(tree, "fixed");
var pivot = new Vector2(540, 1200);
var originalHintCenter = Center(hint); var originalSheetCenter = Center(sheet);
var done = 0;
var pop = DjuiTransitionPlayer.PlayWindow(tree, "pop_in", () => done++);
Near(tree.Root.Scale.X, 1, "根几何固定"); Near(layer.Scale.X, 1, "全屏不缩放");
Near(layer.Position.Y, 0, "全屏不偏移"); Near(layer.Opacity, .4f, "不写子层透明度");
Near(sheet.Scale.X, .85f, "内容起始比例");
var expectedHint = pivot + (originalHintCenter - pivot) * .85f;
Near(Center(hint).Y, expectedHint.Y, "提示共享中心");
Near((Center(hint) - Center(sheet)).Y, (originalHintCenter - originalSheetCenter).Y * .85f, "独立子树相对坐标");
Check(ReferenceEquals(hint.Parent, tree.Root), "不重挂树");
Tick(280);
Near(sheet.Scale.X, 1, "pop终帧归一"); Near(hint.Position.Y, 2100, "提示归一");
Check(done == 1 && tree.Session.SubscriberCount == 0, "完成一次并退订");
Check(!Get(tree, "hidden").Visible && Get(tree, "hidden").Opacity == 0, "隐藏概率层不显现");

var slide = DjuiTransitionPlayer.PlayWindow(tree, "slide_up_in");
Near(sheet.Position.Y, 530, "绝对定位实际滑动"); Near(hint.Position.Y, 2160, "提示同位移");
Near(layer.Position.Y, 0, "slide遮罩固定"); Near(tree.Root.Position.Y, 0, "slide根固定");
tree.Session.Relayout(() => { tree.Root.Width = 2400; tree.Root.Height = 1080; sheet.Position = new(700, -170); hint.Position = new(1050, 960); layer.Width = 2400; layer.Height = 1080; });
Near(sheet.Position.Y, -110, "转屏续同进度"); Near(layer.Scale.X, 1, "转屏固定层");
DjuiTransitionPlayer.Stop(slide);
Near(sheet.Position.Y, -170, "取消恢复新布局"); Near(hint.Position.Y, 960, "取消提示新布局");
Check(tree.Session.SubscriberCount == 0, "取消退订");

// 中途改变隐藏/透明度，以及直接挂根的运行期克隆，均保持原有业务状态。
pop = DjuiTransitionPlayer.PlayWindow(tree, "pop_out"); Tick(80);
sheet.Visible = false; sheet.Opacity = 0;
var clone = new Panel { Width = 100, Height = 100, Position = new(300, 200), Parent = tree.Root };
tree.Root.ChildList.Add(clone); Tick(1);
Check(clone.Scale.X < 1, "新挂根克隆接入共享变换");
DjuiTransitionPlayer.Stop(tree.Root);
Near(clone.Position.X, 300, "克隆取消恢复"); Near(clone.Scale.X, 1, "克隆缩放恢复");
Check(!sheet.Visible && sheet.Opacity == 0, "业务改动不被恢复");

for (var i = 0; i < 5; i++)
{
    DjuiTransitionPlayer.PlayWindow(tree, "pop_out"); Tick(160);
    DjuiTransitionPlayer.PlayWindow(tree, "pop_in"); Tick(280);
    Near(sheet.Scale.X, 1, "多次复用无比例残留"); Near(tree.Root.Opacity, 1, "多次复用无透明残留");
}
tree.Root.Opacity = 0;
DjuiTransitionPlayer.PlayWindow(tree, "fade_in"); Tick(250);
Near(tree.Root.Opacity, 0, "根透明度零不唤醒");
Check(DjuiTransitionPlayer.PlayWindow(tree, "none") == -1, "none同步交由manager摘栈");

var full = Create(); full.Session.CurrentPage.Window!.Mode = "fullscreen";
DjuiTransitionPlayer.PlayWindow(full, "pop_in");
Near(full.Root.Scale.X, .85f, "fullscreen保留整根行为");
Check(full.Session.SubscriberCount == 0, "fullscreen不分组"); DjuiTransitionPlayer.Stop(full.Root);

var shooting = Create();
shooting.Session.CurrentPage.Root.Children.First(x => x.Id == "sheet").Stretch = new() { Style = "Both" };
DjuiTransitionPlayer.PlayWindow(shooting, "slide_up_in");
Near(Get(shooting,"sheet").Position.Y, 470, "全屏sheet仅淡入"); DjuiTransitionPlayer.Stop(shooting.Root);

// 无效根清理、完成回调停止另一动画/开启新动画：不能留下订阅或破坏本帧遍历。
var invalid = Create(); DjuiTransitionPlayer.PlayWindow(invalid, "pop_in"); invalid.Root.IsValid = false; Tick(1);
Check(invalid.Session.SubscriberCount == 0, "销毁退订");
var a = Create(); var b = Create(); var c = Create();
DjuiTransitionPlayer.PlayWindow(a, "pop_in", () => done++);
DjuiTransitionPlayer.PlayWindow(b, "fade_in", () => { DjuiTransitionPlayer.Stop(a.Root); DjuiTransitionPlayer.PlayWindow(c, "fade_in"); });
Tick(250); Tick(250);
Check(a.Session.SubscriberCount == 0 && b.Session.SubscriberCount == 0 && c.Session.SubscriberCount == 0, "回调重入安全");
Console.WriteLine($"RuntimeTransitions: {assertions} assertions passed");

// 可选：直接读取 Movie 的当前源页，复用真实模板展开/宽屏 resolver/布局 solver。
// 不修改页面或业务发布镜像。调用：dotnet run --project ... -- <pages-directory>
if (args.Length > 0)
{
    var pages = Directory.GetFiles(args[0], "*.json").Select(path => JsonSerializer.Deserialize<DjuiPageV6>(File.ReadAllText(path))!).ToDictionary(p => p.PageId);
    var project = new DjuiProjectV6 { Canvas = new() { ReferenceWidth = 1080, ReferenceHeight = 2400, Mode = "Contain" } };
    var popupCount = 0; var fullscreenCount = 0; var cases = 0;
    foreach (var source in pages.Values.Where(p => p.Kind == "window"))
    {
        if (source.Window?.Mode == "popup") popupCount++; else fullscreenCount++;
        foreach (var (vw, vh) in new[] { (1080, 2400), (2400, 1080), (900, 1600), (1600, 900), (1080, 2600) })
        {
            var plan = DjuiCanvasV6.CreatePlan(vw, vh, new(16, 40, 16, 32), project);
            var page = DjuiResponsiveResolverV6.Resolve(DjuiTemplateExpanderV6.Expand(source, pages), plan.Wide);
            var solved = DjuiLayoutSolverV6.SolveV6(page, plan);
            foreach (var presetName in new[] { "pop_in", "pop_out", "slide_up_in", "slide_down_out", "fade_in", "fade_out" })
            {
                var t = new DjuiTreeInstanceV6(); t.Session.CurrentPage = page;
                t.Root.Width = plan.CanvasRect.Width; t.Root.Height = plan.CanvasRect.Height;
                foreach (var node in page.Root.Children)
                {
                    var rect = solved[node.Id];
                    var c1 = new Panel { Parent = t.Root, Width = rect.Width, Height = rect.Height, Position = new(rect.X, rect.Y), Visible = node.Basic?.Visible ?? true, Opacity = node.Transform?.Opacity ?? 1 };
                    t.Root.ChildList.Add(c1); t.Session.Controls[node.Id] = c1;
                }
                if (page.Window?.Mode != "popup")
                {
                    DjuiTransitionPlayer.PlayWindow(t, presetName);
                    Check(t.Session.SubscriberCount == 0, "Movie fullscreen不分组");
                    DjuiTransitionPlayer.Stop(t.Root); cases++; continue;
                }
                DjuiTransitionRegistry.TryGet(presetName, out var preset);
                using var transition = new DjuiWindowTransitionV6(t, preset);
                transition.Apply(.3f);
                Near(t.Root.Scale.X, 1, "Movie根固定"); Near(t.Root.Position.Y, 0, "Movie根不滑动");
                foreach (var node in page.Root.Children)
                {
                    var ctrl = t.Session.Controls[node.Id]; var r = solved[node.Id];
                    if (DjuiWindowTransitionV6.IsFixedLayer(node))
                    {
                        Near(ctrl.Position.X, r.X, "Movie固定层X"); Near(ctrl.Position.Y, r.Y, "Movie固定层Y");
                        Near(ctrl.Scale.X, 1, "Movie固定层比例"); Near(r.Width, plan.CanvasRect.Width, "Movie全屏宽"); Near(r.Height, plan.CanvasRect.Height, "Movie全屏高");
                    }
                    Check(ctrl.Visible == (node.Basic?.Visible ?? true), "Movie业务显隐不变");
                    Near(ctrl.Opacity, node.Transform?.Opacity ?? 1, "Movie子层透明度不变");
                }
                transition.Restore();
                foreach (var node in page.Root.Children)
                {
                    var ctrl = t.Session.Controls[node.Id]; var r = solved[node.Id];
                    Near(ctrl.Position.X, r.X, "Movie恢复X"); Near(ctrl.Position.Y, r.Y, "Movie恢复Y"); Near(ctrl.Scale.X, 1, "Movie恢复比例");
                }
                cases++;
            }
        }
    }
    Console.WriteLine($"Movie current-source audit: popup={popupCount}, fullscreen={fullscreenCount}, cases={cases}, assertions={assertions}");
}
