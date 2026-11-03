import { useMemo } from 'react'
import {
  CheckCircle,
  FilmReel,
  Lightning,
  Sparkle,
  Television,
  type Icon,
} from '@phosphor-icons/react'

type TaskSuggestion = {
  id: string
  label: string
  description: string
  prompt: string
  icon: Icon
}

const SUGGESTIONS: TaskSuggestion[] = [
  {
    id: 'script-remake',
    label: '爆款剧本拆解与二创 (A+C)',
    description: '逆向提取爆款短剧的 15 节拍与爽点，换皮为新题材',
    icon: Lightning,
    prompt:
      '请帮我深入拆解以下爆款剧本的主线、救猫咪 15 节拍与爽点公式，并按照漫剧节奏进行新背景换皮重写：\n\n【对标剧本原文/梗概】：\n（请在此粘贴爆款剧本文本）\n\n【拟替换新题材/背景】：\n（如：仙侠宗门夺嫡、古代权谋反杀、都市商战逆袭）',
  },
  {
    id: 'original-manga',
    label: '纯原创漫剧创作工坊 (B+C)',
    description: '构思脑洞推演，生成符合漫剧黄金节奏的分集大纲',
    icon: Television,
    prompt:
      '请根据以下构思与题材方向，快速推演一句话高概念、核心戏剧鸿沟与人物冲突三角，并按照漫剧特定工业范式（黄金 3 秒、1.5 分钟单集、中段反转、集尾悬念断点）生成分集大纲与首集剧本：\n\n【核心脑洞点子】：\n（请在此输入一句话灵感或人物设定）\n\n【参考题材与风格标签】：\n（如：悬疑奇幻、小人物反杀、双强博弈）',
  },
  {
    id: 'standard-script',
    label: '好莱坞工业分场剧本写作',
    description: '标准场景标头、动作指示与高张力潜台词对白',
    icon: FilmReel,
    prompt:
      '请严格遵循好莱坞工业剧本 Fountain 标准排版（规范场景标头 INT./EXT.、精炼客观动作描写、消除说明感潜台词对白），为以下场次编写剧本正文：\n\n【场次情境与戏剧目标】：\n',
  },
  {
    id: 'dialogue-polisher',
    label: '潜台词提炼与对白声线打磨',
    description: '消除说明性白开水台词，注入权力攻防与阶层声线',
    icon: Sparkle,
    prompt:
      '请作为台词指导大师（Dialogue Doctor），消除以下剧本对白中的“信息说明感”，注入权力攻防、人物独特声线与丰富潜台词（Subtext）：\n\n【待打磨对白与人物情境】：\n',
  },
  {
    id: 'script-reviewer',
    label: '全方位 5 维工业剧本质检',
    description: '剧情逻辑、人设一致性、节奏张力与格式合规扫描',
    icon: CheckCircle,
    prompt:
      '请作为剧本审读总监（Script Doctor），对提交的剧本进行剧情连贯性、人设防崩、对白质感、节奏张力及格式合规 5 维工业质检，输出 P0-P3 问题清单与打分：\n\n【待质检剧本正文】：\n',
  },
]


// One row, shared by every suggestion so the list reads as one kind of offer.
function SuggestionRow({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  description: string
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="press group flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-kumo-tint"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-kumo-fill text-kumo-subtle transition-colors group-hover:text-kumo-default">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-kumo-default">
            {label}
          </span>
          <span className="block truncate text-[12px] leading-4 tracking-[-0.2px] text-kumo-subtle">
            {description}
          </span>
        </span>
      </button>
    </li>
  )
}

// How many of the suggestions above to show at once. The list is longer than the page should be:
// four rows is inspiration, seven is a menu to read. Which three appear is chosen per visit, so the
// ones below the fold still get seen -- and so Home doesn't look like it only does one thing.
const VISIBLE_SUGGESTIONS = 3

function pickSuggestions(): TaskSuggestion[] {
  let shuffled = [...SUGGESTIONS]
  for (let i = shuffled.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, VISIBLE_SUGGESTIONS)
}

export default function HomeTaskSuggestions({
  onPick,
}: {
  onPick: (prompt: string) => void
}) {
  // Chosen once per mount: re-rolling on every render would shuffle the list under the pointer.
  const visible = useMemo(pickSuggestions, [])

  return (
    <section aria-label="Example tasks" className="flex flex-col gap-1">
      <h3 className="px-1 pb-1 text-[12px] font-medium uppercase tracking-[0.06em] text-kumo-inactive">
        剧作灵感与起步推荐
      </h3>
      <ul className="flex flex-col gap-0.5">
        {visible.map((suggestion) => (
          <SuggestionRow
            key={suggestion.id}
            icon={<suggestion.icon size={16} />}
            label={suggestion.label}
            description={suggestion.description}
            onClick={() => onPick(suggestion.prompt)}
          />
        ))}
      </ul>
    </section>
  )
}
