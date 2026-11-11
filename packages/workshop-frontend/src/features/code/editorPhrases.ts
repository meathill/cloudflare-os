import { EditorState } from '@codemirror/state'

export const editorPhrases = EditorState.phrases.of({
  'Find': '查找',
  'Replace': '替换',
  'next': '下一个',
  'previous': '上一个',
  'all': '全部',
  'match case': '区分大小写',
  'regexp': '正则表达式',
  'by word': '全词匹配',
  'replace': '替换',
  'replace all': '全部替换',
  'close': '关闭',
  'Go to line': '跳转到行',
  'go': '跳转',
  'current match': '当前匹配',
  'on line': '所在行',
  'replaced match on line $': '已替换第 $ 行的匹配项',
  'replaced $ matches': '已替换 $ 个匹配项',
  'Control character': '控制字符',
})
