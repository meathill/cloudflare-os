import { useState } from 'react'
import { Dialog } from '@cloudflare/kumo'
import {
  ArrowRight as ArrowRightIcon,
  CheckCircle as CheckCircleIcon,
  Copy as CopyIcon,
  FilmReel as FilmReelIcon,
  Lightning as LightningIcon,
  MagnifyingGlass as MagnifyingGlassIcon,
  Sparkle as SparkleIcon,
  Television as TelevisionIcon,
  X as XIcon,
} from '@phosphor-icons/react'

export interface ScriptStudioModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ModeTab = 'remake' | 'original' | 'research' | 'skills'

export default function ScriptStudioModal({ open, onOpenChange }: ScriptStudioModalProps) {
  const [activeTab, setActiveTab] = useState<ModeTab>('remake')
  const [copied, setCopied] = useState(false)

  // 模式一：爆款拆解状态
  const [benchmarkText, setBenchmarkText] = useState('')
  const [newSetting, setNewSetting] = useState('')
  const [deconstructResult, setDeconstructResult] = useState('')
  const [mangaScriptResult, setMangaScriptResult] = useState('')

  // 模式二：原创选题状态
  const [ideaText, setIdeaText] = useState('')
  const [genreTag, setGenreTag] = useState('')
  const [incubateResult, setIncubateResult] = useState('')
  const [originalScriptResult, setOriginalScriptResult] = useState('')

  // 模式三：剧目全网调研状态 (联网检索)
  const [researchQuery, setResearchQuery] = useState('')
  const [researchSummary, setResearchSummary] = useState('')

  function handleTabChange(tab: ModeTab) {
    setActiveTab(tab)
  }

  function handleClose() {
    onOpenChange(false)
  }

  function handleQuickFillBenchmark() {
    setBenchmarkText('《重生之商界巅峰》第1-5集：主角遭未婚妻背叛身亡，带着未来20年记忆回到1998年股票认购证发售前夕，当场退婚并在大厅截胡千万资产。')
    setNewSetting('古装仙侠宗门夺嫡：主角被宗门圣女陷害废黜灵根，带着三千年后魔尊记忆回到宗门选拔前夜，截胡太古神剑。')
  }

  function handleRunDeconstruct() {
    if (!benchmarkText) return
    setDeconstructResult(
      `【模块A：爆款结构逆向提炼】\n` +
      `1. 核心爽点公式：背叛陷害 ➔ 极速重生 ➔ 认知碾压 ➔ 当场打脸夺宝\n` +
      `2. 黄金节奏曲线：\n` +
      `   - 第1集（0-45秒）：绝境致死；（45-90秒）：震惊重生与确立誓愿\n` +
      `   - 第2集：宿敌逼迫立下赌约，集尾悬念卡在生死契约签下瞬间\n` +
      `3. 抽象可复用骨架：【屈辱开局】➔【金手指觉醒】➔【公开对质立威】`
    )
  }

  function handleGenerateRemakeScript() {
    setMangaScriptResult(
      `INT. 青云宗试炼大殿 - DAY\n\n` +
      `【黄金前3秒钩子】：特写：带血的断剑跌落在青石板上。\n` +
      `圣女冷笑，剑尖挑起主角下巴。\n\n` +
      `圣女\n` +
      `（傲慢）\n` +
      `灵根已碎，你就是个废人，婚书我退了！\n\n` +
      `主角低头，瞳孔深处泛起三千年后的森冷血芒。\n\n` +
      `主角\n` +
      `（冷声）\n` +
      `退婚？这把断剑留给你，三日后生死台上，别求我。\n\n` +
      `【45秒反转】：主角抬手震碎石阶，太古剑气破土而出！\n` +
      `【集尾断点Cliffhanger】：宗门万千灵剑齐鸣，掌门震惊起身，画面卡在剑气悬空！`
    )
  }

  function handleQuickFillIdea() {
    setIdeaText('一个能看到别人头顶死期倒计时的盲人推拿师，某天突然摸到当朝首辅的倒计时只剩最后三天。')
    setGenreTag('古代悬疑、权谋反杀、微奇幻')
  }

  function handleRunIncubate() {
    if (!ideaText) return
    setIncubateResult(
      `【模块B：原创故事核推演】\n` +
      `1. Logline：假盲人医者偶遇死期将至的帝国掌权者，在卷入刺杀漩涡中借命翻盘。\n` +
      `2. 核心戏剧鸿沟：求生自保（医者身份） vs 改命涉案（权谋风暴）。\n` +
      `3. 独特漫剧钩子：头顶肉眼不可见的荧光命火，命火闪烁即预示杀机降临。`
    )
  }

  function handleGenerateOriginalScript() {
    setOriginalScriptResult(
      `INT. 首辅内阁密室 - NIGHT\n\n` +
      `【黄金前3秒钩子】：黑暗中，三道猩红的命火倒计时剧烈闪烁：00:03:12。\n` +
      `主角盲杖轻点地面，指尖微颤。\n\n` +
      `首辅\n` +
      `（沉闷喘息）\n` +
      `先生摸了老夫的脉，可摸出大限何时？\n\n` +
      `主角收回手指，背后冷汗浸湿。\n\n` +
      `主角\n` +
      `（低声）\n` +
      `大人，刺客不是在门外，已经在您茶里了。\n\n` +
      `【45秒反转】：首辅端起茶盏的手僵在半空，阴影中内卫首领拔刀出鞘！\n` +
      `【集尾断点Cliffhanger】：烛火骤灭，利刃破风之声在耳边暴起！`
    )
  }

  function handleCopyContent(text: string) {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  function handleQuickFillResearch() {
    setResearchQuery('《重生之商界巅峰》短剧')
  }

  function handleRunResearch() {
    if (!researchQuery) return
    setResearchSummary(
      `【《${researchQuery}》全网深度调研简报】\n` +
      `• 核心剧情梗概：主角遭豪门妻子与合伙人背叛并溺亡，带着20年超前经济认知重生至1998年。借原始资本认购证与国库券疯狂套利，当场打脸退婚前妻，逆袭为华尔街与国内商界资本巨鳄。\n` +
      `• 核心人物关系：主角（绝对主控爽感中心）、反派未婚妻（虚荣拜金被当场退婚）、宿敌商会少爷（持续设局但被反杀）、忠诚红颜助理（商业助手）。\n` +
      `• 全网/豆瓣口碑：8.2分（短剧热度榜TOP1，完播率极高）。\n` +
      `• 爆款爽点分析：开局30秒退婚当场变现数千万、信息差跨时代碾压对手、商海做空反制；\n` +
      `• 观众槽点预警：中后段感情线偶有拖沓，建议改编时压缩副线，强化纯商战攻防。`
    )
  }

  function handleImportToRemake() {
    if (!researchSummary) return
    setBenchmarkText(researchSummary)
    setActiveTab('remake')
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog
        className="!z-[1000] !w-[min(880px,calc(100vw-32px))] max-h-[88vh] overflow-hidden rounded-xl border border-kumo-line bg-kumo-base p-0 shadow-2xl !top-[6%] !-translate-y-0 flex flex-col"
        size="lg"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-kumo-line px-6 py-4 bg-kumo-elevated">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <FilmReelIcon size={20} weight="bold" />
            </div>
            <div>
              <Dialog.Title className="text-[17px] font-semibold tracking-[-0.3px] text-kumo-default">
                中文在线剧作工坊 · A/B/C 生产台
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] leading-4 text-kumo-subtle">
                爆款拆解重写 (A+C) 与 原创灵感漫剧 (B+C) 双轨协同工作台
              </Dialog.Description>
            </div>
          </div>
          <Dialog.Close
            render={(props) => (
              <button
                {...props}
                type="button"
                onClick={handleClose}
                aria-label="关闭"
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default"
              >
                <XIcon size={16} />
              </button>
            )}
          />
        </div>

        {/* Tab switchers */}
        <div className="flex shrink-0 border-b border-kumo-line bg-kumo-base px-6 pt-2">
          <button
            type="button"
            onClick={() => handleTabChange('remake')}
            className={[
              'flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
              activeTab === 'remake'
                ? 'border-kumo-brand text-kumo-strong'
                : 'border-transparent text-kumo-subtle hover:text-kumo-default',
            ].join(' ')}
          >
            <LightningIcon size={16} weight="bold" />
            <span>💥 爆款拆解重写流 (A + C)</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('original')}
            className={[
              'flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
              activeTab === 'original'
                ? 'border-kumo-brand text-kumo-strong'
                : 'border-transparent text-kumo-subtle hover:text-kumo-default',
            ].join(' ')}
          >
            <TelevisionIcon size={16} weight="bold" />
            <span>💡 原创漫剧工坊流 (B + C)</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('research')}
            className={[
              'flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
              activeTab === 'research'
                ? 'border-kumo-brand text-kumo-strong'
                : 'border-transparent text-kumo-subtle hover:text-kumo-default',
            ].join(' ')}
          >
            <MagnifyingGlassIcon size={16} weight="bold" />
            <span>🌐 剧目研报 (全网搜索)</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('skills')}
            className={[
              'flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
              activeTab === 'skills'
                ? 'border-kumo-brand text-kumo-strong'
                : 'border-transparent text-kumo-subtle hover:text-kumo-default',
            ].join(' ')}
          >
            <SparkleIcon size={16} weight="bold" />
            <span>🛠 漫剧精调与质检 (C核心)</span>
          </button>
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 sidebar-scroll space-y-4">
          {activeTab === 'remake' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: A inputs */}
              <div className="space-y-3 rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-kumo-default">
                    ① 对标爆款剧本与新设定 (输入A)
                  </span>
                  <button
                    type="button"
                    onClick={handleQuickFillBenchmark}
                    className="text-[11px] text-kumo-brand hover:underline"
                  >
                    填入示例
                  </button>
                </div>
                <textarea
                  value={benchmarkText}
                  onChange={(e) => setBenchmarkText(e.target.value)}
                  placeholder="粘贴或输入参考对标的爆款剧本、故事梗概或长文..."
                  rows={3}
                  className="w-full rounded-md border border-kumo-line bg-kumo-base p-2.5 text-[12px] text-kumo-default focus:outline-none focus:border-kumo-brand"
                />
                <input
                  type="text"
                  value={newSetting}
                  onChange={(e) => setNewSetting(e.target.value)}
                  placeholder="拟替换的新题材/背景/人设（如：古代朝堂权谋、都市律政反转）"
                  className="w-full rounded-md border border-kumo-line bg-kumo-base p-2 text-[12px] text-kumo-default focus:outline-none focus:border-kumo-brand"
                />
                <button
                  type="button"
                  onClick={handleRunDeconstruct}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md bg-amber-500/15 py-2 text-[12px] font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 transition-colors"
                >
                  <LightningIcon size={14} weight="bold" />
                  <span>执行模块A：逆向结构与爽点拆解</span>
                </button>
                {deconstructResult && (
                  <div className="rounded border border-kumo-line bg-kumo-base p-3 text-[12px] leading-5 whitespace-pre-wrap text-kumo-subtle">
                    {deconstructResult}
                  </div>
                )}
              </div>

              {/* Right Column: C output */}
              <div className="space-y-3 rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-kumo-default">
                    ② 漫剧节奏分集生成 (产出C)
                  </span>
                  {mangaScriptResult && (
                    <button
                      type="button"
                      onClick={() => handleCopyContent(mangaScriptResult)}
                      className="flex items-center gap-1 text-[11px] text-kumo-brand hover:underline"
                    >
                      <CopyIcon size={12} />
                      <span>{copied ? '已复制' : '复制剧本'}</span>
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleGenerateRemakeScript}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md bg-kumo-fill py-2 text-[12px] font-medium text-kumo-strong hover:bg-kumo-tint transition-colors"
                >
                  <ArrowRightIcon size={14} weight="bold" />
                  <span>将提取骨架推入模块C：生成首集剧本</span>
                </button>
                <div className="rounded border border-kumo-line bg-kumo-base p-3 font-mono text-[11.5px] leading-5 whitespace-pre-wrap text-kumo-default min-h-[180px]">
                  {mangaScriptResult || '等待执行生成：将按照黄金3秒、1.5分钟、45秒反转及集尾Cliffhanger严格编排...'}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'original' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: B inputs */}
              <div className="space-y-3 rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-kumo-default">
                    ① 原创灵感与脑洞输入 (输入B)
                  </span>
                  <button
                    type="button"
                    onClick={handleQuickFillIdea}
                    className="text-[11px] text-kumo-brand hover:underline"
                  >
                    填入示例
                  </button>
                </div>
                <textarea
                  value={ideaText}
                  onChange={(e) => setIdeaText(e.target.value)}
                  placeholder="输入初步构思、模糊灵感碎片或核心戏剧钩子..."
                  rows={3}
                  className="w-full rounded-md border border-kumo-line bg-kumo-base p-2.5 text-[12px] text-kumo-default focus:outline-none focus:border-kumo-brand"
                />
                <input
                  type="text"
                  value={genreTag}
                  onChange={(e) => setGenreTag(e.target.value)}
                  placeholder="参考风格/标签（如：硬核科幻、古代微奇幻、悬疑复仇）"
                  className="w-full rounded-md border border-kumo-line bg-kumo-base p-2 text-[12px] text-kumo-default focus:outline-none focus:border-kumo-brand"
                />
                <button
                  type="button"
                  onClick={handleRunIncubate}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md bg-blue-500/15 py-2 text-[12px] font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-500/25 transition-colors"
                >
                  <SparkleIcon size={14} weight="bold" />
                  <span>执行模块B：故事核与世界观推演</span>
                </button>
                {incubateResult && (
                  <div className="rounded border border-kumo-line bg-kumo-base p-3 text-[12px] leading-5 whitespace-pre-wrap text-kumo-subtle">
                    {incubateResult}
                  </div>
                )}
              </div>

              {/* Right Column: C output */}
              <div className="space-y-3 rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-kumo-default">
                    ② 原创漫剧分集与正文 (产出C)
                  </span>
                  {originalScriptResult && (
                    <button
                      type="button"
                      onClick={() => handleCopyContent(originalScriptResult)}
                      className="flex items-center gap-1 text-[11px] text-kumo-brand hover:underline"
                    >
                      <CopyIcon size={12} />
                      <span>{copied ? '已复制' : '复制剧本'}</span>
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleGenerateOriginalScript}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md bg-kumo-fill py-2 text-[12px] font-medium text-kumo-strong hover:bg-kumo-tint transition-colors"
                >
                  <ArrowRightIcon size={14} weight="bold" />
                  <span>推入模块C漫剧工坊：生成分集与剧本</span>
                </button>
                <div className="rounded border border-kumo-line bg-kumo-base p-3 font-mono text-[11.5px] leading-5 whitespace-pre-wrap text-kumo-default min-h-[180px]">
                  {originalScriptResult || '等待执行生成：可邀请组内搭档进入房间，调用技能随时精修对白...'}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'research' && (
            <div className="space-y-4 rounded-lg border border-kumo-line bg-kumo-elevated p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[14px] font-semibold text-kumo-default">
                    🌐 剧目资料与口碑全网深度研报 (Google Search Grounding)
                  </h4>
                  <p className="mt-0.5 text-[12px] text-kumo-subtle">
                    输入任意剧名或短剧视频名称，Agent 将联网聚合检索剧情梗概、角色关系、豆瓣/全网评分与观众口碑爽槽点。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleQuickFillResearch}
                  className="text-[11px] text-kumo-brand hover:underline"
                >
                  填入示例剧名
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={researchQuery}
                  onChange={(e) => setResearchQuery(e.target.value)}
                  placeholder="输入要调研的爆款剧目名称或视频关键字（如：《重生之商界巅峰》、《狂飙》）..."
                  className="flex-1 rounded-md border border-kumo-line bg-kumo-base p-2.5 text-[12px] text-kumo-default focus:outline-none focus:border-kumo-brand"
                />
                <button
                  type="button"
                  onClick={handleRunResearch}
                  className="flex items-center gap-1.5 rounded-md bg-amber-500/15 px-4 py-2 text-[12px] font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 transition-colors"
                >
                  <MagnifyingGlassIcon size={14} weight="bold" />
                  <span>检索全网研报</span>
                </button>
              </div>

              {researchSummary && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-kumo-default">
                      研报结果预览（已聚合剧情与全网口碑）：
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleCopyContent(researchSummary)}
                        className="flex items-center gap-1 text-[11px] text-kumo-brand hover:underline"
                      >
                        <CopyIcon size={12} />
                        <span>{copied ? '已复制' : '复制研报'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleImportToRemake}
                        className="flex items-center gap-1 rounded bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-500/30 transition-colors"
                      >
                        <ArrowRightIcon size={12} weight="bold" />
                        <span>一键导入到爆款拆解流 (A模块) ➔</span>
                      </button>
                    </div>
                  </div>
                  <div className="rounded border border-kumo-line bg-kumo-base p-3.5 text-[12px] leading-5 whitespace-pre-wrap text-kumo-subtle">
                    {researchSummary}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="space-y-3 rounded-lg border border-kumo-line bg-kumo-elevated p-4">
              <h4 className="text-[14px] font-semibold text-kumo-default">
                漫剧工业 4 大卡点铁律与技能调度中心 (模块C)
              </h4>
              <p className="text-[12px] text-kumo-subtle leading-5">
                无论上游来源是 A（爆款拆解重写）还是 B（原创选题），在 C 工坊中都受以下漫剧生产范式约束：
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="rounded-md bg-kumo-base p-3 border border-kumo-line">
                  <span className="text-[12px] font-semibold text-amber-600 dark:text-amber-400">⏱ 黄金前3秒原则</span>
                  <p className="mt-1 text-[11px] leading-4 text-kumo-subtle">
                    开场第1秒切入视听冲击或直接冲突，禁止任何平铺直叙的世界观解说。
                  </p>
                </div>
                <div className="rounded-md bg-kumo-base p-3 border border-kumo-line">
                  <span className="text-[12px] font-semibold text-blue-600 dark:text-blue-400">🔄 45秒中段极性反转</span>
                  <p className="mt-1 text-[11px] leading-4 text-kumo-subtle">
                    剧情进行到单集中段，局势必须发生强攻防逆转或致命秘密揭晓。
                  </p>
                </div>
                <div className="rounded-md bg-kumo-base p-3 border border-kumo-line">
                  <span className="text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">⚡ 悬念断点 (Cliffhanger)</span>
                  <p className="mt-1 text-[11px] leading-4 text-kumo-subtle">
                    每集结尾停在生死存亡或刀锋抵喉的最高潮瞬间，锁死下一集连播率。
                  </p>
                </div>
                <div className="rounded-md bg-kumo-base p-3 border border-kumo-line">
                  <span className="text-[12px] font-semibold text-purple-600 dark:text-purple-400">💬 潜台词与5维审校</span>
                  <p className="mt-1 text-[11px] leading-4 text-kumo-subtle">
                    随时在聊天室输入 <code className="text-kumo-brand">/dialogue-polisher</code> 与 <code className="text-kumo-brand">/script-reviewer</code> 质检防崩。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-kumo-line bg-kumo-elevated px-6 py-3">
          <span className="text-[12px] text-kumo-inactive">
            提示：在任意协作聊天室输入 <kbd className="rounded border border-kumo-line bg-kumo-base px-1 py-0.5 text-[11px]">/script-deconstructor</kbd> 即可直接调用
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 cursor-pointer items-center justify-center rounded-md bg-kumo-fill px-4 text-[13px] font-medium text-kumo-strong transition-colors hover:bg-kumo-tint"
          >
            关闭工作台
          </button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
