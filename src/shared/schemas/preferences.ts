/**
 * 阅读与写作偏好（ADR-0024、REQ-READ-*）：按人存服务端（`user_preferences.reading`），跨设备同步。
 * 默认值 = 改版前的记录页外观（MiSans 16px · 行高 1.75 · 段距 0.75em · 无纸纹）；版心默认满栏（ADR-0026，原 760）；
 * 目录自动编号默认开（ADR-0026，与正文章节编号分开）；正文章节编号默认开（ADR-0027）。
 * PATCH 只给要改的键，服务端按键合并（jsonb `||`），不需要 ifUpdatedAt（02 §4 例外：按键合并可交换、幂等）。
 */
import { z } from 'zod'

export const READING_FONTS = ['sans', 'wenkai', 'song', 'system', 'mono'] as const
export const READING_SIZES = ['sm', 'md', 'lg', 'xl'] as const
export const READING_LINE_HEIGHTS = ['compact', 'standard', 'loose'] as const
export const READING_WIDTHS = ['narrow', 'standard', 'wide', 'full'] as const
export const READING_PARAGRAPHS = ['compact', 'standard', 'loose'] as const
export const READING_PAPERS = ['plain', 'rice', 'grid', 'lines', 'dots', 'kraft'] as const
export const READING_TOC_DEPTHS = [2, 3, 4] as const
/** 代码块默认折叠行为（ADR-0032）：展开 / 折叠 / 超过 15 行自动折叠 */
export const READING_CODE_FOLDS = ['expanded', 'collapsed', 'auto'] as const
/** auto 模式的行数阈值 */
export const CODE_FOLD_AUTO_LINES = 15

export const readingPrefsSchema = z.object({
  font: z.enum(READING_FONTS),
  size: z.enum(READING_SIZES),
  lineHeight: z.enum(READING_LINE_HEIGHTS),
  width: z.enum(READING_WIDTHS),
  paragraph: z.enum(READING_PARAGRAPHS),
  /** 首行缩进 2em（顶层段落） */
  indent: z.boolean(),
  /** 两端对齐 */
  justify: z.boolean(),
  paper: z.enum(READING_PAPERS),
  /** 章节编号：显示层装饰，不写正文 */
  headingNumbers: z.boolean(),
  /** 右侧目录 / 目录块显示章节编号（ADR-0026；与正文编号 headingNumbers 分开） */
  tocNumbers: z.boolean(),
  /** 大纲 / 目录块显示到几级标题 */
  tocDepth: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  /** 代码块默认展开 / 折叠（只影响本人视图，不写正文） */
  codeFold: z.enum(READING_CODE_FOLDS),
})
export type ReadingPrefs = z.infer<typeof readingPrefsSchema>

export const DEFAULT_READING: ReadingPrefs = {
  font: 'sans',
  size: 'md',
  lineHeight: 'standard',
  width: 'full',
  paragraph: 'standard',
  indent: false,
  justify: false,
  paper: 'plain',
  headingNumbers: true,
  tocNumbers: true,
  tocDepth: 4,
  codeFold: 'expanded',
}

/** 库里存的是用户改过的键；读取时逐键校验，坏值 / 旧值回落默认（不因一个坏键整份作废）。 */
export function normalizeReading(raw: unknown): ReadingPrefs {
  const out: Record<string, unknown> = { ...DEFAULT_READING }
  if (raw && typeof raw === 'object')
    for (const [k, schema] of Object.entries(readingPrefsSchema.shape)) {
      const v = (raw as Record<string, unknown>)[k]
      if (v !== undefined && schema.safeParse(v).success) out[k] = v
    }
  return out as ReadingPrefs
}

export const patchPreferencesSchema = z
  .object({ reading: readingPrefsSchema.partial().strict() })
  .strict()
  .refine((v) => Object.keys(v.reading).length > 0, {
    message: '至少一个字段',
    path: ['reading'],
  })
