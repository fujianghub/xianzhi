/** 日历 / 日程查询与写入（ADR-0009、02 §9）。写入后统一失效 ['calendar-events']。 */
import { keepPreviousData, type QueryClient } from '@tanstack/react-query'
import type {
  CalEditScope,
  CalendarOccurrence,
  CalendarView,
} from '../../shared/schemas/calendar.ts'
import { api, unwrap } from './api.ts'

export type { CalEditScope, CalendarOccurrence, CalendarView }

export const calendarsQuery = {
  queryKey: ['calendars'] as const,
  queryFn: () => unwrap<{ items: CalendarView[] }>(api.calendars.$get()).then((r) => r.items),
  staleTime: 60_000,
}

export const occurrencesQuery = (from: string, to: string) => ({
  queryKey: ['calendar-events', from, to] as const,
  queryFn: () =>
    unwrap<{ items: CalendarOccurrence[] }>(
      api['calendar-events'].$get({ query: { from, to } }),
    ).then((r) => r.items),
  placeholderData: keepPreviousData,
  staleTime: 30_000,
})

export interface EventDraft {
  calendarId: string
  title: string
  location?: string | null
  notes?: string | null
  url?: string | null
  allDay: boolean
  startAt: string
  endAt: string
  timezone: string
  rrule?: string | null
  alarms?: number[]
}

export const createEvent = (d: EventDraft) =>
  unwrap<CalendarOccurrence>(
    api['calendar-events'].$post(
      { json: d },
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    ),
  )

export const patchEvent = (
  occ: CalendarOccurrence,
  patch: Partial<EventDraft>,
  scope: CalEditScope = 'all',
) =>
  unwrap<CalendarOccurrence>(
    api['calendar-events'][':id'].$patch({
      param: { id: occ.id },
      json: {
        ...patch,
        ifUpdatedAt: occ.updatedAt,
        scope,
        ...(occ.occurrenceStart ? { occurrenceStart: occ.occurrenceStart } : {}),
      },
    }),
  )

export const deleteEvent = (occ: CalendarOccurrence, scope: CalEditScope = 'all') =>
  unwrap<void>(
    api['calendar-events'][':id'].$delete({
      param: { id: occ.id },
      query: {
        scope,
        ...(occ.occurrenceStart ? { occurrenceStart: occ.occurrenceStart } : {}),
      },
    }),
  )

export const invalidateCalendar = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ['calendar-events'] }),
    qc.invalidateQueries({ queryKey: ['calendars'] }),
  ])
