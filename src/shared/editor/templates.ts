/**
 * 按 kind 的正文模板（03 §6）：onLoadDocument 发现 fragment 为空且 ydoc_version=0 时注入。
 * 文本走 i18n key；服务端按用户 locale 取值（一期只有 zh-CN）。
 */
import type { EntryKind } from '../schemas/enums.ts'
import type { PmNode } from '../schemas/pm.ts'
import { builtinTemplate, fillTemplateVars, KIND_DEFAULT_TEMPLATE } from './builtin-templates.ts'

const STRINGS: Record<string, Record<string, string>> = {
  'zh-CN': {
    'entry.template.decision.background': '背景',
    'entry.template.decision.options': '候选方案',
    'entry.template.decision.option': '方案',
    'entry.template.decision.pros': '优点',
    'entry.template.decision.cons': '缺点',
    'entry.template.decision.decision': '决定',
    'entry.template.decision.consequences': '后果',
    'entry.template.decision.references': '参考',
    'entry.template.bug.symptom': '症状',
    'entry.template.bug.repro': '复现步骤',
    'entry.template.bug.rootCause': '根因',
    'entry.template.bug.fix': '修复',
    'entry.template.bug.verify': '验证',
    'entry.template.iteration.goals': '目标',
    'entry.template.iteration.done': '已完成',
    'entry.template.iteration.undone': '未完成',
    'entry.template.iteration.next': '下一步',
    'entry.template.iteration.notes': '备注',
    'entry.template.changelog.added': '新增',
    'entry.template.changelog.changed': '变更',
    'entry.template.changelog.fixed': '修复',
    'entry.template.changelog.removed': '移除',
    'entry.template.review.highlights': '亮点',
    'entry.template.review.problems': '问题',
    'entry.template.review.lessons': '教训',
    'entry.template.review.nextFocus': '下期重点',
    'entry.template.review.data': '数据',
    'entry.template.review.dataHint': '本周期完成任务数由系统填入',
  },
}

export function templateText(key: string, locale = 'zh-CN'): string {
  return STRINGS[locale]?.[key] ?? STRINGS['zh-CN']?.[key] ?? key
}

const text = (t: string): PmNode => ({ type: 'text', text: t })
const h2 = (t: string): PmNode => ({ type: 'heading', attrs: { level: 2 }, content: [text(t)] })
const p = (): PmNode => ({ type: 'paragraph' })
const cell = (type: 'tableHeader' | 'tableCell', t?: string): PmNode => ({
  type,
  content: [t ? { type: 'paragraph', content: [text(t)] } : p()],
})

/** 返回 PM JSON 文档；journal / note 为空文档（编辑器显示 placeholder）。 */
export function entryTemplate(kind: EntryKind, locale = 'zh-CN'): PmNode {
  const k = (key: string) => templateText(`entry.template.${key}`, locale)
  const sections = (keys: string[]) => keys.flatMap((key) => [h2(k(key)), p()])
  switch (kind) {
    case 'decision':
      return {
        type: 'doc',
        content: [
          h2(k('decision.background')),
          p(),
          h2(k('decision.options')),
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  cell('tableHeader', k('decision.option')),
                  cell('tableHeader', k('decision.pros')),
                  cell('tableHeader', k('decision.cons')),
                ],
              },
              {
                type: 'tableRow',
                content: [cell('tableCell'), cell('tableCell'), cell('tableCell')],
              },
            ],
          },
          ...sections(['decision.decision', 'decision.consequences', 'decision.references']),
        ],
      }
    case 'bug':
      return {
        type: 'doc',
        content: [
          h2(k('bug.symptom')),
          p(),
          h2(k('bug.repro')),
          { type: 'orderedList', content: [{ type: 'listItem', content: [p()] }] },
          ...sections(['bug.rootCause', 'bug.fix', 'bug.verify']),
        ],
      }
    case 'iteration':
      return {
        type: 'doc',
        content: [
          h2(k('iteration.goals')),
          p(),
          h2(k('iteration.done')),
          {
            type: 'taskList',
            content: [{ type: 'taskItem', attrs: { checked: false }, content: [p()] }],
          },
          ...sections(['iteration.undone', 'iteration.next', 'iteration.notes']),
        ],
      }
    case 'changelog':
      return {
        type: 'doc',
        content: sections([
          'changelog.added',
          'changelog.changed',
          'changelog.fixed',
          'changelog.removed',
        ]),
      }
    case 'review':
      return {
        type: 'doc',
        content: [
          ...sections([
            'review.highlights',
            'review.problems',
            'review.lessons',
            'review.nextFocus',
          ]),
          h2(k('review.data')),
          {
            type: 'callout',
            attrs: { kind: 'info' },
            content: [{ type: 'paragraph', content: [text(k('review.dataHint'))] }],
          },
        ],
      }
    case 'optimize':
    case 'plan': {
      // ADR-0011 §3：新 kind 的默认骨架即对应内置模板
      const tpl = builtinTemplate(KIND_DEFAULT_TEMPLATE[kind] ?? '')
      return tpl
        ? fillTemplateVars(tpl.body, { date: new Date().toISOString().slice(0, 10) })
        : empty()
    }
    default:
      return empty()
  }
}

const empty = (): PmNode => ({ type: 'doc', content: [] })
