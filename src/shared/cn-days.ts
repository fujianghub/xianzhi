/**
 * 中国节假日 / 调休 / 农历 / 节气（ADR-0009 §3、REQ-CAL-007）：数据来自 npm `chinese-days`（离线内置，
 * 国务院办公厅每年 11 月前后发布次年安排，升级依赖即更新；目前覆盖到 2026 年）。只在日历路由里被引用
 * （放在 shared：节日白名单是数据而非界面文案，不受 check-i18n 约束）。
 */
import { getDayDetail, getLunarDate, getLunarFestivals, getSolarTerms } from 'chinese-days'
import { formatLocalDate, type LocalDate } from './tz.ts'

export interface DayMeta {
  /** 法定假日（休）：节日名 */
  off?: string
  /** 调休上班（班）：对应节日名 */
  work?: string
  /** 农历日（初一显示月名）；leap = 闰月初一，界面加「闰」前缀 */
  lunar: string
  leap?: boolean
  /** 完整农历日期（如「八月十五」「闰六月初三」）与干支生肖年（「丙午马年」） */
  lunarFull?: string
  yearName?: string
  /** 农历节日（春节 / 中秋…） */
  festival?: string
  /** 节气（白露 / 秋分…） */
  term?: string
}

/** 只显示主要传统节日（数据源另含大量民俗诞辰，月格里太吵）；值 = 显示名。 */
const MAJOR_FESTIVALS: Record<string, string> = {
  除夕: '除夕',
  春节: '春节',
  元宵节: '元宵节',
  春龙节: '龙抬头',
  上巳节: '上巳节',
  寒食节: '寒食节',
  端午节: '端午节',
  乞巧节: '七夕',
  '中元(鬼)节': '中元节',
  中秋节: '中秋节',
  重阳节: '重阳节',
  寒衣节: '寒衣节',
  下元节: '下元节',
  腊八节: '腊八节',
  民间送灶: '小年',
}

const cache = new Map<string, DayMeta>()
const termsByYear = new Map<number, Map<string, string>>()

function termsOf(y: number): Map<string, string> {
  let m = termsByYear.get(y)
  if (!m) {
    m = new Map()
    try {
      for (const t of getSolarTerms(`${y}-01-01`, `${y}-12-31`)) m.set(t.date, t.name)
    } catch {
      /* 超出数据范围：无节气 */
    }
    termsByYear.set(y, m)
  }
  return m
}

export function dayMeta(d: LocalDate): DayMeta {
  const key = formatLocalDate(d)
  const hit = cache.get(key)
  if (hit) return hit
  const meta: DayMeta = { lunar: '' }
  try {
    const detail = getDayDetail(key)
    // 节假日条目的 name 形如 "National Day,国庆节,3"；普通日为星期英文名
    const parts = detail.name.split(',')
    if (parts.length >= 2) {
      if (detail.work) meta.work = parts[1]
      else meta.off = parts[1]
    }
  } catch {
    /* 超出数据范围 */
  }
  try {
    const l = getLunarDate(key)
    meta.lunar = l.lunarDay === 1 ? l.lunarMonCN : l.lunarDayCN
    if (l.lunarDay === 1 && l.isLeap) meta.leap = true
    const names = getLunarFestivals(key, key)[0]?.name ?? []
    const fest = names.map((n) => MAJOR_FESTIVALS[n]).find(Boolean)
    if (fest) meta.festival = fest
    meta.lunarFull = `${l.isLeap ? '闰' : ''}${l.lunarMonCN}${l.lunarDayCN}`
    meta.yearName = `${l.yearCyl}${l.zodiac}年`
  } catch {
    /* ignore */
  }
  const term = termsOf(d.y).get(key)
  if (term) meta.term = term
  cache.set(key, meta)
  return meta
}

/** 日期格右侧的一行小字：节日 > 节气 > 农历。 */
export function dayCaption(m: DayMeta): { text: string; accent: boolean; leap?: boolean } {
  if (m.festival) return { text: m.festival, accent: true }
  if (m.off && !m.term) return { text: m.off, accent: true }
  if (m.term) return { text: m.term, accent: true }
  return { text: m.lunar, accent: false, leap: m.leap }
}
