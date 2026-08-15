# Design: Composer 半透明磨砂质感与悬浮透出设计

## 1. 架构与布局策略 (Layout Strategy)

为了实现“内容滚动到下面时从 Composer 下方透出”，DOM 结构和滚动区域需要调整：

### 现状
```
<div className="relative flex flex-1 flex-col">
  <header />
  <ConversationPane className="flex-1 overflow-y-auto" /> {/* 滚动到底部只到这里 */}
  <Composer className="border-t bg-background" />        {/* 占位在下面 */}
</div>
```

### 目标架构
```
<div className="relative flex min-w-0 flex-1 flex-col bg-background overflow-hidden">
  <header />
  {/* 主视口工作区容器，占满剩余高度 */}
  <div className="relative flex-1 min-h-0 flex flex-col">
    {/* 滚动容器占满整个主视口高度，底部留出充足 padding 给悬浮 Composer */}
    <ConversationPane className="relative flex h-full flex-1 flex-col overflow-y-auto px-4 pt-6 pb-28 md:px-8" />
    
    {/* 悬浮磨砂底栏：绝对定位于底部，pointer-events-none 避免阻挡空白区域的滚动点击 */}
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background/80 via-background/50 to-transparent backdrop-blur-md px-4 pb-6 pt-6 md:px-8">
      {/* 输入框自身恢复 pointer-events-auto */}
      <Composer className="pointer-events-auto ..." />
    </div>
  </div>
</div>
```

对于空白对话（`isBlankConversation`），同样适配此布局，保证切换时无高度跳变。

---

## 2. 磨砂质感与配色方案 (Frosted Glass Aesthetics)

根据 `src/index.css` 的 OKLCH 主题定义：
- `--background`: 亮色为 `oklch(1 0 0)`，暗色为 `oklch(0.145 0 0)`
- `--card`: 亮色为 `oklch(1 0 0)`，暗色为 `oklch(0.205 0 0)`
- `--border` / `--input`: 亮色为 `oklch(0.922 0 0)`，暗色为 `oklch(0.269 0 0)`

### 磨砂材质组合：
1. **外层渐变遮罩 (Outer Gradient Mask)**：
   - 渐变色：`from-background/85 via-background/50 to-transparent`
   - 毛玻璃：`backdrop-blur-sm` 到 `backdrop-blur-md`
   - 目的：让滚动到底部的长文字自然淡出并模糊，避免突兀的硬切线。

2. **内层输入框卡片 (Inner Input Card)**：
   - 背景：`bg-card/75 dark:bg-card/70` 搭配 `backdrop-blur-lg`
   - 边框：`border border-border/80 dark:border-border/60`
   - 阴影：`shadow-sm dark:shadow-md`
   - 聚焦态：`focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 transition-all`
   - 目的：无论亮色还是暗色，卡片均具备晶莹的毛玻璃质感，输入文字高对比度且背景文字模糊透出。

---

## 3. 交互与无障碍细节 (Interactions & A11y)

1. **中文输入法（IME）兼容**：
   在 `onKeyDown` 中判断 `e.nativeEvent.isComposing || e.keyCode === 229`，避免拼音输入时按 Enter 选词发生误发送。
2. **文本框自适应与高度限制**：
   - 最小高度保持 `min-h-[38px]`，单行时高度紧凑。
   - 内容增多时随 `target.scrollHeight` 扩展至最大 `200px` 并出现平滑滚动条。
3. **滚动与焦点穿透**：
   外层包裹容器设置 `pointer-events-none`，使得用户点击或滚轮划过输入框卡片两侧的空白渐变区域时，仍能直接滚动下方的消息列表；输入框自身设置 `pointer-events-auto` 保证正常聚焦与点击。
