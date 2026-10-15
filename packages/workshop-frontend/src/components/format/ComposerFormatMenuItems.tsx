// 中文在线剧作协作平台：输入框 `+` 菜单中的剧作方向与标准格式
import { DropdownMenu } from '@cloudflare/kumo'
import type { OutputFormatOffer } from '@gadgets/workshop-shared/api'
import {
  FilmReel as FilmReelIcon,
  Lightning as LightningIcon,
  ListBullets as ListBulletsIcon,
  MagnifyingGlass as MagnifyingGlassIcon,
  Television as TelevisionIcon,
  UserCircle as UserCircleIcon,
  type Icon,
} from '@phosphor-icons/react'
import { FormatGlyph } from './FormatVisuals'
import { useOutputFormats } from './useOutputFormats'

const COMPOSER_MENU_ITEM =
  '!h-auto rounded-xl !px-2 !py-1.5 text-[12px] leading-4 font-normal tracking-[-0.15px] ' +
  'text-kumo-subtle transition-colors data-highlighted:bg-kumo-tint/70 data-highlighted:text-kumo-default cursor-pointer'

export interface ScriptDirection {
  id: string
  name: string
  description: string
  icon: Icon
  prompt: string
  badgeColor?: string
}

export const SCRIPT_DIRECTIONS: ScriptDirection[] = [
  {
    id: 'drama-research',
    name: '剧目资料与口碑研报 (全网搜索)',
    description: '全网检索剧名/视频，查剧情梗概与观众口碑',
    icon: MagnifyingGlassIcon,
    badgeColor: 'text-cyan-600 dark:text-cyan-400',
    prompt:
      '【剧目全网资料与口碑研报 (联网搜索)】\n请联网检索以下剧集/视频的权威资讯、剧情简介与全网真实口碑，并整理为剧目全景卡（包含剧情梗概、核心人物关系、全网评分与观众核心爽点/槽点，以及对编剧二创的建议）：\n\n【目标剧名或视频名称】：\n（如：《墨雨云间》、《周处除三害》、某热门短剧名）\n\n【重点关注维度】：\n（如：观众最沉浸的爽点、是否有逻辑争议、出圈话题梗）',
  },
  {
    id: 'script-remake',
    name: '爆款拆解与重构 (A+C)',
    description: '逆向提取节拍爽点，换皮二创',
    icon: LightningIcon,
    badgeColor: 'text-amber-600 dark:text-amber-400',
    prompt:
      '【爆款剧本拆解与二创 (模式一：A + C)】\n请帮我深入拆解以下爆款剧本的主线、救猫咪15节拍与爽点公式（若仅提供剧名，请先联网检索其剧情），并按照漫剧节奏（黄金3秒、45秒反转、集尾悬念）进行新背景换皮重写：\n\n【对标剧名/剧本文本】：\n（可输入剧名如《墨雨云间》，或直接粘贴剧本文本）\n\n【拟替换新题材/背景】：\n（如：仙侠宗门夺嫡、古代权谋反杀、都市商战逆袭）',
  },
  {
    id: 'original-manga',
    name: '纯原创漫剧创作 (B+C)',
    description: '构思脑洞推演，漫剧快节奏分集',
    icon: TelevisionIcon,
    badgeColor: 'text-blue-600 dark:text-blue-400',
    prompt:
      '【纯原创漫剧创作工坊 (模式二：B + C)】\n请根据以下初始构思与题材方向，快速推演一句话高概念、核心戏剧鸿沟与人物冲突三角，并按照漫剧特定工业范式（黄金3秒、1.5分钟单集、中段反转、集尾悬念断点）生成分集大纲与剧本正文：\n\n【核心脑洞点子】：\n（请在此输入一句话灵感或人物核心设定）\n\n【参考题材与风格标签】：\n（如：悬疑奇幻、小人物反杀、双强博弈）',
  },
  {
    id: 'standard-script',
    name: '好莱坞分场剧本 (Script)',
    description: '标准 Fountain 格式与潜台词对白',
    icon: FilmReelIcon,
    badgeColor: 'text-emerald-600 dark:text-emerald-400',
    prompt:
      '【好莱坞工业分场剧本创作】\n请严格遵循工业剧本 Fountain 标准排版（规范场景标头 INT./EXT.、精炼客观动作描写、消除说明感潜台词对白），为以下场次编写剧本正文：\n\n【场次情境与戏剧目标】：\n',
  },
  {
    id: 'beat-sheet',
    name: '故事节拍大纲 (Beat Sheet)',
    description: '救猫咪 15 节拍与情绪极性反转',
    icon: ListBulletsIcon,
    badgeColor: 'text-purple-600 dark:text-purple-400',
    prompt:
      '【故事节拍大纲规划】\n请基于救猫咪 15 节拍法，为以下故事梳理全篇节拍大纲，标明所属幕次、核心事件、情绪转折极性(+/-)与场次规划：\n\n【故事前提与主线】：\n',
  },
  {
    id: 'character-bible',
    name: '人物小传与弧光设计',
    description: '欲望动机、致命创伤与动态关系网',
    icon: UserCircleIcon,
    badgeColor: 'text-rose-600 dark:text-rose-400',
    prompt:
      '【人物小传与弧光设计】\n请为以下角色打造立体的人物小传，包含：人物标签、核心动机(Desire)、致命盲点(Flaw)、台词音色风格、戏剧弧光变化与人物关系冲突网：\n\n【角色身份与初始设想】：\n',
  },
]

export default function ComposerFormatMenuItems({
  onSelect,
  onSelectPrompt,
}: {
  onSelect: (format: OutputFormatOffer) => void
  onSelectPrompt?: (prompt: string) => void
}) {
  const { formats, creating, create } = useOutputFormats()

  function handleSelectDirection(direction: ScriptDirection) {
    if (onSelectPrompt) {
      onSelectPrompt(direction.prompt)
    }
  }

  function handleChooseFormat(format: OutputFormatOffer) {
    if (format.requiresSetup) {
      create(format)
    } else {
      onSelect(format)
    }
  }

  return (
    <>
      <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase leading-4 tracking-[0.06em] text-kumo-inactive">
        选择剧作方向 (START WITH)
      </p>
      {SCRIPT_DIRECTIONS.map((direction) => {
        const IconComponent = direction.icon
        return (
          <DropdownMenu.Item
            key={direction.id}
            className={COMPOSER_MENU_ITEM}
            onClick={() => handleSelectDirection(direction)}
          >
            <span
              className={[
                'mr-2 inline-flex h-4 w-4 items-center justify-center',
                direction.badgeColor || 'text-kumo-brand',
              ].join(' ')}
            >
              <IconComponent size={14} weight="bold" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-kumo-default">
                {direction.name}
              </span>
            </div>
          </DropdownMenu.Item>
        )
      })}

      {formats.length > 0 && (
        <>
          <div className="my-1 border-t border-kumo-line/70" />
          <p className="px-2 pb-0.5 pt-1 text-[9px] font-medium uppercase leading-3 tracking-[0.06em] text-kumo-inactive">
            通用产物格式
          </p>
          {formats.map((format) => (
            <DropdownMenu.Item
              key={format.blueprintId}
              className={COMPOSER_MENU_ITEM}
              disabled={creating !== null}
              onClick={() => handleChooseFormat(format)}
            >
              <span className="mr-2 inline-flex h-4 w-4 items-center justify-center text-kumo-inactive">
                <FormatGlyph
                  output={format.output}
                  size="md"
                  className={creating === format.blueprintId ? 'animate-pulse' : undefined}
                />
              </span>
              <span className="flex-1 truncate">
                {creating === format.blueprintId ? 'Creating…' : format.output.noun}
              </span>
            </DropdownMenu.Item>
          ))}
        </>
      )}
      <div className="my-1 border-t border-kumo-line/70" />
    </>
  )
}

