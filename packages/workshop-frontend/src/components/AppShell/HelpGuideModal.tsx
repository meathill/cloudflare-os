import { useState } from 'react'
import { Dialog } from '@cloudflare/kumo'
import {
  Blueprint,
  BookOpen,
  CheckCircle,
  FilmReel,
  FolderSimple,
  Lightbulb,
  Lightning,
  Sparkle,
  Stack,
  UsersThree,
  X,
} from '@phosphor-icons/react'

export interface HelpGuideModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type TabKey = 'scenarios' | 'workflow' | 'glossary'

export default function HelpGuideModal({ open, onOpenChange }: HelpGuideModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('scenarios')

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab)
  }

  function handleClose() {
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog
        className="!z-[1000] !w-[min(780px,calc(100vw-32px))] max-h-[85vh] overflow-hidden rounded-xl border border-kumo-line bg-kumo-base p-0 shadow-2xl !top-[8%] !-translate-y-0 flex flex-col"
        size="lg"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-kumo-line px-6 py-4 bg-kumo-elevated">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-kumo-tint text-kumo-brand">
              <FilmReel size={20} weight="bold" />
            </div>
            <div>
              <Dialog.Title className="text-[17px] font-semibold tracking-[-0.3px] text-kumo-default">
                编剧创作指南与实战手册
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] leading-4 text-kumo-subtle">
                中文在线剧本创作协作平台 · 面向编剧团队的工业化协作指南
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
                <X size={16} />
              </button>
            )}
          />
        </div>

        {/* Navigation Tabs - 业务场景放第一个，核心名词放最后 */}
        <div className="flex shrink-0 border-b border-kumo-line bg-kumo-base px-6 pt-2">
          <button
            type="button"
            onClick={() => handleTabChange('scenarios')}
            className={[
              'flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
              activeTab === 'scenarios'
                ? 'border-kumo-brand text-kumo-strong'
                : 'border-transparent text-kumo-subtle hover:text-kumo-default',
            ].join(' ')}
          >
            <Lightbulb size={16} />
            <span>🎬 编剧日常业务场景（该怎么用）</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('workflow')}
            className={[
              'flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
              activeTab === 'workflow'
                ? 'border-kumo-brand text-kumo-strong'
                : 'border-transparent text-kumo-subtle hover:text-kumo-default',
            ].join(' ')}
          >
            <CheckCircle size={16} />
            <span>🔄 创作全流程运转全景</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('glossary')}
            className={[
              'flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
              activeTab === 'glossary'
                ? 'border-kumo-brand text-kumo-strong'
                : 'border-transparent text-kumo-subtle hover:text-kumo-default',
            ].join(' ')}
          >
            <BookOpen size={16} />
            <span>📖 核心概念人话速查</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 sidebar-scroll">
          {/* TAB 1: 业务场景答疑与使用指引（默认展示） */}
          {activeTab === 'scenarios' && (
            <div className="space-y-4">
              {/* Scenario 1: 开新剧 */}
              <div className="rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <FolderSimple size={16} weight="bold" />
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[14px] font-semibold text-kumo-default">
                        场景一：从零立项一部新剧本（立项开本）
                      </h4>
                      <span className="rounded bg-kumo-fill px-1.5 py-0.5 text-[11px] font-medium text-kumo-brand">
                        用 Workspace
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-kumo-default">
                      <b>做法：</b>每开一部新戏，新建一个 <b>Workspace（工作区）</b>，比如命名为《哈利波特大战葫芦娃》或《锦衣卫奇案录》。
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-kumo-subtle">
                      <b>编剧视角：</b>这就是该剧目的<b>专属项目工作目录 / 剧组会议室</b>。这里保存这部剧全部的人物小传、世界观设定、对话推演与素材文件。不同剧目之间完全隔离，再也不用担心都市剧设定混进仙侠本里。
                    </p>
                  </div>
                </div>
              </div>

              {/* Scenario 2: 爆款拆解重写流 (A + C) */}
              <div className="rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Lightning size={16} weight="bold" />
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[14px] font-semibold text-kumo-default">
                        场景二：对标爆款剧本，拆解结构并换皮二创（模式一：A + C）
                      </h4>
                      <span className="rounded bg-kumo-fill px-1.5 py-0.5 text-[11px] font-medium text-kumo-brand">
                        爆款换皮流
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-kumo-default">
                      <b>做法：</b>在左侧侧边栏点击 <b>“剧作工坊”</b>（或在对话框输入 <code className="text-kumo-brand">/script-deconstructor</code>），粘贴参考爆款剧本。
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-kumo-subtle">
                      <b>编剧视角：</b>模块 A（拆解 Agent）利用 Gemini 3.8 Flash 百万上下文快速提取主线、救猫咪 15 节拍与爽点公式；随后输入你拟替换的新题材（如：商战重生换皮为仙侠宗门），由模块 C 自动按照漫剧特定卡点（黄金 3 秒、1.5 分钟、集尾悬念）产出全新分集剧本。
                    </p>
                  </div>
                </div>
              </div>

              {/* Scenario 3: 原创选题漫剧工坊 (B + C) */}
              <div className="rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <Blueprint size={16} weight="bold" />
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[14px] font-semibold text-kumo-default">
                        场景三：纯原创构思，漫剧节奏大纲与多人精修（模式二：B + C）
                      </h4>
                      <span className="rounded bg-kumo-fill px-1.5 py-0.5 text-[11px] font-medium text-kumo-brand">
                        原创工坊流
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-kumo-default">
                      <b>做法：</b>输入一段灵感或题材构思（或在对话框输入 <code className="text-kumo-brand">/concept-incubator</code>），模块 B 快速推演 Logline 与世界观冲突网。
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-kumo-subtle">
                      <b>编剧视角：</b>无需具体的对标剧本，系统直接按漫剧节奏拉出分集；在多人协作聊天室中随时输入 <code className="text-kumo-brand">/dialogue-polisher</code> 精修台词，或邀请搭档编剧进房共同推敲改戏。
                    </p>
                  </div>
                </div>
              </div>

              {/* Scenario 4: 多人实时合编 */}
              <div className="rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <UsersThree size={16} weight="bold" />
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[14px] font-semibold text-kumo-default">
                        场景四：双人或多人合写一部戏（主编与跟组编剧同台）
                      </h4>
                      <span className="rounded bg-kumo-fill px-1.5 py-0.5 text-[11px] font-medium text-kumo-brand">
                        多人实时协作
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-kumo-default">
                      <b>做法：</b>在任意剧目的 Workspace 里点击右上角分享，将链接发给编剧搭档。
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-kumo-subtle">
                      <b>编剧视角：</b>就像两人坐在同一个白板前写戏：一人写分场动作，一人润色对白潜台词，AI 编剧在旁边随时解答世界观设定与法宝克制，所有编辑光标毫秒级实时同步，不用再互相传 Word 搞版本冲突。
                    </p>
                  </div>
                </div>
              </div>

              {/* Scenario 5: 打包定稿输出 */}
              <div className="rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <Stack size={16} weight="bold" />
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[14px] font-semibold text-kumo-default">
                        场景五：多轮推敲调整后，彻底打包定稿（最终交付）
                      </h4>
                      <span className="rounded bg-kumo-fill px-1.5 py-0.5 text-[11px] font-medium text-kumo-brand">
                        成为 Output
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-kumo-default">
                      <b>做法：</b>初稿在工作区中经过团队沟通调整、好莱坞 5 维工业质检后，彻底定稿保存并打包。
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-kumo-subtle">
                      <b>编剧视角：</b>沟通聊天只是草稿过程，打包出来的才是<b>真正的剧本交付成果（Output）</b>！它会自动沉淀在左侧的“Outputs 成果库”中，排版规范、干净无冗余，可随时导出为工业 Fountain 格式或 PDF 发给制片人与导演。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 剧本创作流转全景 */}
          {activeTab === 'workflow' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <h4 className="text-[14px] font-semibold text-kumo-default mb-1">
                  剧本工业化协作四步流转链
                </h4>
                <p className="text-[12px] text-kumo-subtle mb-4">
                  从成熟方法论母版，到剧组现场协同推敲，最后打包交付正片剧本：
                </p>

                <div className="space-y-3">
                  <div className="flex items-start gap-3 rounded-md bg-kumo-base p-3.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-[13px] font-bold text-blue-600 dark:text-blue-400">
                      1
                    </span>
                    <div>
                      <div className="text-[13px] font-semibold text-kumo-default">
                        📐 选拔或定制工作流母版（Blueprint）
                      </div>
                      <div className="mt-1 text-[12px] leading-4 text-kumo-subtle">
                        资深编剧沉淀成熟的戏份套路（如“武打戏流”、“短剧黄金三秒爽点流”），固化为可复用的蓝图母版。
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-md bg-kumo-base p-3.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-[13px] font-bold text-amber-600 dark:text-amber-400">
                      2
                    </span>
                    <div>
                      <div className="text-[13px] font-semibold text-kumo-default">
                        🏢 建立剧目独立工作目录（Workspace）
                      </div>
                      <div className="mt-1 text-[12px] leading-4 text-kumo-subtle">
                        立项《哈利波特大战葫芦娃》，输入核心创意，调用选好的工作流自动铺开故事大纲与人物小传骨架。
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-md bg-kumo-base p-3.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-[13px] font-bold text-emerald-600 dark:text-emerald-400">
                      3
                    </span>
                    <div>
                      <div className="text-[13px] font-semibold text-kumo-default">
                        👥 编剧搭档与 AI 工业技能深度打磨
                      </div>
                      <div className="mt-1 text-[12px] leading-4 text-kumo-subtle">
                        拉入组内编剧协同改戏，调用中文在线 6 大专有编剧技能（台词打磨、潜台词提炼、节拍校验、5维防崩质检）。
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-md bg-kumo-base p-3.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-500/10 text-[13px] font-bold text-purple-600 dark:text-purple-400">
                      4
                    </span>
                    <div>
                      <div className="text-[13px] font-semibold text-kumo-default">
                        📦 彻底打包定稿剧本（Output）
                      </div>
                      <div className="mt-1 text-[12px] leading-4 text-kumo-subtle">
                        脱离杂乱的沟通聊天流，将定稿成果一键打包为符合工业规范的成文剧本，归档在 Outputs 库中直接交付。
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 核心名词人话速查（放最后，纯编剧通俗人话） */}
          {activeTab === 'glossary' && (
            <div className="space-y-4">
              {/* Workspace */}
              <div className="rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-center gap-2 text-kumo-default">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <FolderSimple size={16} weight="bold" />
                  </span>
                  <h4 className="text-[14px] font-semibold">Workspace（剧本工作区 / 项目工作目录）</h4>
                  <span className="ml-auto rounded bg-kumo-fill px-1.5 py-0.5 text-[11px] font-medium text-kumo-subtle">
                    一部剧 = 一个工作区
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-5 text-kumo-default">
                  <b>人话解释：</b>这就是某部剧的<b>专属筹备室与工作文件夹</b>。
                </p>
                <div className="mt-2 rounded-md bg-kumo-base p-2.5 text-[12px] leading-4 text-kumo-subtle">
                  比如写《哈利波特大战葫芦娃》就建一个。这本剧的所有人物卡片、分场草稿、搭档编剧讨论完全封存在这里，干净清爽，绝不串戏，支持多人像在同一个白板上打字一样实时协作。
                </div>
              </div>

              {/* Blueprint */}
              <div className="rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-center gap-2 text-kumo-default">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <Blueprint size={16} weight="bold" />
                  </span>
                  <h4 className="text-[14px] font-semibold">Blueprint（剧作蓝图 / 工业流模版）</h4>
                  <span className="ml-auto rounded bg-kumo-fill px-1.5 py-0.5 text-[11px] font-medium text-kumo-subtle">
                    现成的戏份与结构模具
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-5 text-kumo-default">
                  <b>人话解释：</b>一套固化好套路与步骤的<b>成熟创作工作流</b>。
                </p>
                <div className="mt-2 rounded-md bg-kumo-base p-2.5 text-[12px] leading-4 text-kumo-subtle">
                  比如“武打戏工作流”、“反转短剧大纲流”。母版只带走“怎么写好一场戏的规则”，不包含任何人的私密剧本。任何人只要基于这个模版输入剧情核心设想，系统就能顺畅流转出一套规范初稿。
                </div>
              </div>

              {/* Output */}
              <div className="rounded-lg border border-kumo-line bg-kumo-elevated p-4">
                <div className="flex items-center gap-2 text-kumo-default">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <Stack size={16} weight="bold" />
                  </span>
                  <h4 className="text-[14px] font-semibold">Output（最终剧本成果 / 交付件）</h4>
                  <span className="ml-auto rounded bg-kumo-fill px-1.5 py-0.5 text-[11px] font-medium text-kumo-subtle">
                    彻底定稿打包的作品
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-5 text-kumo-default">
                  <b>人话解释：</b>聊天是推敲过程，Output 才是<b>可以发给制片人和导演的正式剧本实体</b>。
                </p>
                <div className="mt-2 rounded-md bg-kumo-base p-2.5 text-[12px] leading-4 text-kumo-subtle">
                  所有的修改推敲在工作区完成并确认后，彻底打包出来的成果文档（如 100 集分场大纲、标准 Fountain 剧本）汇总在左侧“Outputs 成果库”中，可直接送审、打印或导出。
                </div>
              </div>

              {/* Gatekeepers (编剧技能与 A/B/C 模块) */}
              <div className="rounded-lg border border-kumo-line bg-kumo-elevated p-3.5">
                <div className="flex items-center gap-2 text-kumo-default">
                  <Sparkle size={15} className="text-kumo-brand" />
                  <span className="text-[13px] font-semibold">中文在线 9 大工业编剧技能与 A/B/C 生产矩阵</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-5 text-kumo-subtle">
                  内置好莱坞工业方法论与爆款漫剧范式：<b>模块 A</b> 爆款逆向拆解 (<code className="text-kumo-brand">/script-deconstructor</code>)、<b>模块 B</b> 原创选题孵化 (<code className="text-kumo-brand">/concept-incubator</code>)、<b>模块 C</b> 漫剧节奏分集精调 (<code className="text-kumo-brand">/manga-drama-tuner</code>)；并配合人物小传、节拍大纲、分场写作、潜台词打磨、工业排版与 5 维工业质检。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-kumo-line bg-kumo-elevated px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-kumo-inactive">
              快捷键：按 <kbd className="rounded border border-kumo-line bg-kumo-base px-1 py-0.5 text-[11px]">Esc</kbd> 快速关闭
            </span>
            <span className="rounded border border-kumo-line bg-kumo-base px-2 py-0.5 text-[11px] font-mono text-kumo-subtle shadow-xs">
              v1.2.2 (Build 2026-10-16 16:55)
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 cursor-pointer items-center justify-center rounded-md bg-kumo-fill px-4 text-[13px] font-medium text-kumo-strong transition-colors hover:bg-kumo-tint"
          >
            我知道了
          </button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
