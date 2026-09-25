/**
 * 内置模板（ADR-0011 §2、REQ-TPL-001）：面向开发（Bug 修复与迭代、产品优化）与学习（计划 / 笔记 / 周复盘 / 读书笔记）。
 * 代码常量不入表；id 形如 `builtin:<key>`。正文是 PM JSON，只在「新建记录」时作为初始正文写入一次（不变量 1 不受影响）。
 * 占位符 `{{date}}` `{{user}}` `{{space}}` 在创建时替换（fillTemplateVars）。一期只有 zh-CN。
 */
import type { EntryKind, SpaceKind } from '../schemas/enums.ts'
import type { PmNode } from '../schemas/pm.ts'

export type TemplateGroup = 'dev' | 'learning'

export interface BuiltinTemplate {
  id: `builtin:${string}`
  group: TemplateGroup
  name: string
  description: string
  kind: EntryKind
  /** 推荐的空间类型（新建对话框按当前空间排序） */
  spaceKinds: SpaceKind[]
  fields?: Record<string, unknown>
  body: PmNode
}

// ---------- PM 构造小工具 ----------
const tx = (t: string): PmNode => ({ type: 'text', text: t })
const bold = (t: string): PmNode => ({ type: 'text', text: t, marks: [{ type: 'bold' }] })
const para = (...c: (string | PmNode)[]): PmNode =>
  c.length
    ? { type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? tx(x) : x)) }
    : { type: 'paragraph' }
const h2 = (t: string): PmNode => ({ type: 'heading', attrs: { level: 2 }, content: [tx(t)] })
const h3 = (t: string): PmNode => ({ type: 'heading', attrs: { level: 3 }, content: [tx(t)] })
const bullets = (...items: string[]): PmNode => ({
  type: 'bulletList',
  content: items.map((t) => ({ type: 'listItem', content: [t ? para(t) : para()] })),
})
const ordered = (...items: string[]): PmNode => ({
  type: 'orderedList',
  attrs: { start: 1 },
  content: items.map((t) => ({ type: 'listItem', content: [t ? para(t) : para()] })),
})
const todos = (...items: string[]): PmNode => ({
  type: 'taskList',
  content: items.map((t) => ({
    type: 'taskItem',
    attrs: { checked: false },
    content: [t ? para(t) : para()],
  })),
})
const callout = (kind: 'info' | 'tip' | 'warn' | 'danger', ...c: (string | PmNode)[]): PmNode => ({
  type: 'callout',
  attrs: { kind },
  content: [para(...c)],
})
const quote = (): PmNode => ({ type: 'blockquote', content: [para()] })
const table = (head: string[], ...rows: string[][]): PmNode => ({
  type: 'table',
  content: [
    {
      type: 'tableRow',
      content: head.map((h) => ({ type: 'tableHeader', content: [para(h)] })),
    },
    ...rows.map((r) => ({
      type: 'tableRow',
      content: head.map((_, i) => ({
        type: 'tableCell',
        content: [r[i] ? para(r[i] as string) : para()],
      })),
    })),
  ],
})
const doc = (...content: PmNode[]): PmNode => ({ type: 'doc', content })

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'builtin:bug-fix',
    group: 'dev',
    name: '产品 Bug 修复与迭代',
    description: '从现象、复现到根因与验证，修复后跟进迭代与变更记录',
    kind: 'bug',
    spaceKinds: ['project', 'work'],
    fields: { severity: 'medium', status: 'open' },
    body: doc(
      callout(
        'info',
        '严重度与状态在标题下方「字段」里维护；修复合入后用 ',
        bold('[['),
        ' 链接对应的迭代与变更记录。',
      ),
      h2('问题概述'),
      table(
        ['项', '内容'],
        ['发现日期', '{{date}}'],
        ['记录人', '{{user}}'],
        ['影响版本', ''],
        ['影响范围', ''],
      ),
      h2('现象'),
      para(),
      h2('复现步骤'),
      ordered('', '', ''),
      h2('期望与实际'),
      table(['期望', '实际'], ['', '']),
      h2('根因分析'),
      para(),
      h3('为什么会发生（连问五个为什么）'),
      ordered('', ''),
      h2('修复方案'),
      para(),
      todos('代码修改', '补充 / 修正测试', '更新相关文档'),
      h2('验证'),
      todos('按复现步骤已不再出现', '单元 / 集成测试通过', '回归测试通过', '线上验证'),
      h2('回归风险与回滚'),
      para(),
      h2('迭代跟进'),
      todos('纳入迭代计划', '写入变更记录（发布说明）', '经验沉淀：踩坑记录 / 规范更新'),
    ),
  },
  {
    id: 'builtin:product-optimize',
    group: 'dev',
    name: '产品优化',
    description: '用证据说明问题，定指标、比方案、拆实施，上线后复盘',
    kind: 'optimize',
    spaceKinds: ['project', 'work'],
    fields: { status: 'proposed' },
    body: doc(
      h2('背景与问题'),
      para(),
      h2('证据'),
      bullets('数据：', '用户反馈：', '竞品 / 参考：'),
      h2('目标与衡量指标'),
      table(['指标', '当前', '目标', '衡量方式'], ['', '', '', '']),
      h2('方案对比'),
      table(['方案', '收益', '成本', '风险'], ['A', '', '', ''], ['B', '', '', '']),
      h2('决定'),
      para(),
      h2('实施拆分'),
      todos('', '', ''),
      h2('验收标准'),
      bullets(''),
      h2('上线后复盘'),
      table(['指标', '上线前', '上线后', '结论'], ['', '', '', '']),
      para(),
    ),
  },
  {
    id: 'builtin:learning-plan',
    group: 'learning',
    name: '学习计划',
    description: '可检验的目标、资源、里程碑与每周节奏',
    kind: 'plan',
    spaceKinds: ['learning'],
    fields: { status: 'active' },
    body: doc(
      callout('tip', '先写一个可检验的目标：学完之后，我能做成什么？'),
      h2('学习目标'),
      para(),
      h2('为什么学'),
      para(),
      h2('现状与差距'),
      para(),
      h2('资源清单'),
      todos('书：', '课程：', '官方文档：'),
      h2('里程碑'),
      table(
        ['阶段', '内容', '截止日期', '完成标准'],
        ['第 1 阶段', '', '', ''],
        ['第 2 阶段', '', '', ''],
        ['第 3 阶段', '', '', ''],
      ),
      h2('每周节奏'),
      bullets('投入时间：每周 小时', '固定时段：', '输出形式：笔记 / 代码 / 分享'),
      h2('检验方式'),
      todos('完成一个小项目', '给别人讲一遍', '做一套练习题'),
      h2('复盘记录'),
      para(),
    ),
  },
  {
    id: 'builtin:study-note',
    group: 'learning',
    name: '学习笔记',
    description: '概念、要点、例子与疑问，最后用自己的话复述',
    kind: 'note',
    spaceKinds: ['learning'],
    body: doc(
      h2('主题'),
      para(),
      h2('核心概念'),
      bullets(''),
      h2('要点'),
      bullets('', ''),
      h2('例子'),
      para(),
      h2('疑问'),
      todos(''),
      h2('用自己的话复述'),
      callout('tip', '假装讲给一个新手听；讲不清楚的地方就是还没懂的地方。'),
      para(),
      h2('延伸阅读'),
      bullets(''),
    ),
  },
  {
    id: 'builtin:learning-weekly',
    group: 'learning',
    name: '学习周复盘',
    description: '本周完成、投入、收获与卡点，定下周计划',
    kind: 'journal',
    spaceKinds: ['learning'],
    body: doc(
      para('本周：{{date}} 所在周'),
      h2('本周完成'),
      todos(''),
      h2('投入时间'),
      table(['日期', '内容', '时长'], ['', '', '']),
      h2('收获'),
      bullets(''),
      h2('卡点与求助'),
      bullets(''),
      h2('下周计划'),
      todos('', ''),
    ),
  },
  {
    id: 'builtin:reading-note',
    group: 'learning',
    name: '读书笔记',
    description: '一句话总结、核心观点、摘录与行动项',
    kind: 'note',
    spaceKinds: ['learning'],
    body: doc(
      h2('书籍信息'),
      table(['书名', '作者', '读完日期'], ['', '', '{{date}}']),
      h2('一句话总结'),
      para(),
      h2('核心观点'),
      bullets('', ''),
      h2('摘录'),
      quote(),
      h2('我的思考'),
      para(),
      h2('行动项'),
      todos(''),
    ),
  },
]

export const builtinTemplate = (id: string) => BUILTIN_TEMPLATES.find((t) => t.id === id)

/** 新增 kind 的默认正文（新建时未选模板、首次打开注入）：取对应内置模板。 */
export const KIND_DEFAULT_TEMPLATE: Partial<Record<EntryKind, string>> = {
  optimize: 'builtin:product-optimize',
  plan: 'builtin:learning-plan',
}

/** 占位符替换：只动文本节点，其余结构原样。 */
export function fillTemplateVars(node: PmNode, vars: Record<string, string>): PmNode {
  if (node.type === 'text' && node.text)
    return {
      ...node,
      text: node.text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m),
    }
  return node.content
    ? { ...node, content: node.content.map((c) => fillTemplateVars(c, vars)) }
    : node
}
