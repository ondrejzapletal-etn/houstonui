import { useState } from 'react'
import AppLayout from '../components/layout/AppLayout'
import { useAiUsageReport } from '../hooks/useAiSettings'
import { useTimeSavedReport } from '../hooks/useTimeSaved'
import { useSettingsStore } from '../store/settingsStore'
import { TIME_SAVED_KINDS } from '@houston/shared-types'
import type { ReportGranularity, ReportRange, TimeSavedKind } from '@houston/shared-types'

const KIND_LABELS: Record<TimeSavedKind, string> = { scan: 'Scany', processed_message: 'Odeslané zprávy', auto_read: 'Automatické přečtení', mark_read: 'Ruční označení', worklog: 'Výkazy práce' }
const KIND_COLORS: Record<TimeSavedKind, string> = { scan: 'bg-cyan-400', processed_message: 'bg-emerald-400', auto_read: 'bg-yellow-400', mark_read: 'bg-rose-400', worklog: 'bg-blue-400' }

function day(date: Date): string { return date.toISOString().slice(0, 10) }
function daysAgo(days: number): string { const date = new Date(); date.setUTCDate(date.getUTCDate() - days); return day(date) }
function monthsAgo(months: number): string { const date = new Date(); date.setUTCMonth(date.getUTCMonth() - months); return day(date) }
function rangeFor(preset: string): ReportRange {
  if (preset.endsWith('m')) return { from: monthsAgo(Number(preset.slice(0, -1))), to: day(new Date()), granularity: 'monthly' }
  return { from: daysAgo(Number(preset.slice(0, -1)) - 1), to: day(new Date()), granularity: 'daily' }
}
function granularity(from: string, to: string): ReportGranularity { return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 30 ? 'monthly' : 'daily' }
function number(value: number): string { return new Intl.NumberFormat('cs-CZ').format(value) }
function dollars(value: number): string { return `$${value.toFixed(2)}` }
function minutes(value: number): string { return `${Math.round(value / 60)} min` }
function seconds(value: number): string { const hours = Math.floor(value / 3600); const minutes = Math.floor((value % 3600) / 60); return hours ? `${hours} h ${minutes} min` : minutes ? `${minutes} min` : `${value} s` }
function label(period: string): string { return new Date(`${period.length === 7 ? `${period}-01` : period}T00:00:00Z`).toLocaleDateString('cs-CZ', { day: period.length === 7 ? undefined : '2-digit', month: 'short', timeZone: 'UTC' }) }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="flex flex-col gap-5 rounded-lg border border-gray-800 bg-gray-900 p-6"><h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>{children}</section> }
function ChartGrid({ maximum, format }: { maximum: number; format: (value: number) => string }) {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 inset-y-4">
    {[25, 50, 75].map((percent) => <div key={percent} className="absolute inset-x-0 border-t border-dashed border-gray-700/70" style={{ bottom: `${percent}%` }} />)}
  </div>
}
function ChartYAxis({ maximum, format }: { maximum: number; format: (value: number) => string }) {
  return <div aria-hidden="true" className="relative h-40 text-right font-mono text-[10px] text-gray-500">
    {[25, 50, 75].map((percent) => <span key={percent} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${percent}%` }}>{format(maximum * percent / 100)}</span>)}
  </div>
}

export default function ReportsPage() {
  const [preset, setPreset] = useState('7d')
  const [reportRange, setReportRange] = useState<ReportRange>(() => rangeFor('7d'))
  const aiUsage = useAiUsageReport(reportRange)
  const timeSaved = useTimeSavedReport(reportRange)
  const settings = useSettingsStore()
  const coefficients: Record<TimeSavedKind, number> = { scan: settings.timeSavingsSecondsPerScan, processed_message: settings.timeSavingsSecondsPerMessage, auto_read: settings.timeSavingsSecondsPerAutoRead, mark_read: settings.timeSavingsSecondsPerMarkRead, worklog: settings.timeSavingsSecondsPerWorklog }
  const setDate = (field: 'from' | 'to', value: string) => setReportRange((current) => { const next = { ...current, [field]: value }; return { ...next, granularity: granularity(next.from, next.to) } })
  const usageBuckets = aiUsage.data?.buckets ?? []
  const totalTokens = usageBuckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0)
  const totalCost = usageBuckets.reduce((sum, bucket) => sum + bucket.costUsd, 0)
  const maxTokens = Math.max(...usageBuckets.map((bucket) => bucket.totalTokens), 1)
  const maxCost = Math.max(...usageBuckets.map((bucket) => bucket.costUsd), 0)
  const savedBuckets = timeSaved.data?.buckets ?? []
  const kindTotals = TIME_SAVED_KINDS.reduce((totals, kind) => ({ ...totals, [kind]: savedBuckets.reduce((sum, bucket) => sum + bucket.counts[kind], 0) }), {} as Record<TimeSavedKind, number>)
  const totalSeconds = TIME_SAVED_KINDS.reduce((sum, kind) => sum + kindTotals[kind] * coefficients[kind], 0)
  const bucketSeconds = (index: number) => TIME_SAVED_KINDS.reduce((sum, kind) => sum + savedBuckets[index].counts[kind] * coefficients[kind], 0)
  const maxSeconds = Math.max(...savedBuckets.map((_, index) => bucketSeconds(index)), 1)

  return <AppLayout><main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8"><h1 className="text-2xl font-bold text-white">Reporty</h1>
    <Section title="Období"><div className="flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1 text-xs text-gray-400">Období<select value={preset} onChange={(event) => { setPreset(event.target.value); if (event.target.value !== 'custom') setReportRange(rangeFor(event.target.value)) }} className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100"><option value="7d">Posledních 7 dní</option><option value="30d">Posledních 30 dní</option><option value="3m">Poslední 3 měsíce</option><option value="6m">Posledních 6 měsíců</option><option value="12m">Posledních 12 měsíců</option><option value="custom">Vlastní rozsah</option></select></label><label className="flex flex-col gap-1 text-xs text-gray-400">Od<input type="date" value={reportRange.from} onChange={(event) => { setPreset('custom'); setDate('from', event.target.value) }} className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100" /></label><label className="flex flex-col gap-1 text-xs text-gray-400">Do<input type="date" value={reportRange.to} onChange={(event) => { setPreset('custom'); setDate('to', event.target.value) }} className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100" /></label><span className="pb-2 text-xs text-gray-500">{reportRange.granularity === 'daily' ? 'Po dnech' : 'Po měsících'}</span></div></Section>
    <Section title="Spotřeba tokenů">{aiUsage.isLoading ? <p className="text-sm text-gray-500">Načítám spotřebu tokenů...</p> : aiUsage.error ? <p className="text-sm text-red-400">Spotřebu se nepodařilo načíst.</p> : <><div className="flex gap-8"><div><div className="text-xs text-gray-500">Celkem tokenů</div><div className="font-mono text-lg">{number(totalTokens)}</div></div><div><div className="text-xs text-gray-500">Cena</div><div className="font-mono text-lg">${totalCost.toFixed(2)}</div></div></div><div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2"><ChartYAxis maximum={maxCost} format={dollars} /><div><div className="relative flex h-40 items-end gap-1 border-b border-l border-gray-700 px-2 pt-4"><ChartGrid maximum={maxCost} format={dollars} />{usageBuckets.map((bucket) => { const height = maxCost === 0 ? 0 : bucket.costUsd / maxCost * 100; return <div key={bucket.period} className="relative z-10 flex h-full min-w-0 flex-1 flex-col justify-end"><span className="absolute left-0 right-0 z-20 -translate-y-1 truncate text-center font-mono text-[10px] text-gray-300" style={{ bottom: `calc(${height}% + 1rem)` }}>{dollars(bucket.costUsd)}</span><div className="bg-yellow-400" title={`${label(bucket.period)}: ${number(bucket.totalTokens)} tokenů, ${dollars(bucket.costUsd)}`} style={{ height: `${height}%` }} /></div> })}</div><div className="flex gap-1 px-2 pt-1">{usageBuckets.map((bucket) => <span key={bucket.period} className="min-w-0 flex-1 truncate text-center text-[10px] text-gray-500">{label(bucket.period)}</span>)}</div></div></div></>}</Section>
    <Section title="Úspora času">{timeSaved.isLoading ? <p className="text-sm text-gray-500">Načítám úsporu času...</p> : timeSaved.error ? <p className="text-sm text-red-400">Úsporu se nepodařilo načíst.</p> : <><div><div className="text-xs text-gray-500">Celková úspora</div><div className="font-mono text-lg">{seconds(totalSeconds)}</div></div><div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2"><ChartYAxis maximum={maxSeconds} format={seconds} /><div><div className="relative flex h-40 items-end gap-1 border-b border-l border-gray-700 px-2 pt-4"><ChartGrid maximum={maxSeconds} format={seconds} />{savedBuckets.map((bucket, index) => { const bucketTotal = bucketSeconds(index); const height = bucketTotal / maxSeconds * 100; return <div key={bucket.period} className="relative z-10 flex h-full min-w-0 flex-1 flex-col justify-end"><span className="absolute left-0 right-0 z-20 -translate-y-1 truncate text-center font-mono text-[10px] text-gray-300" style={{ bottom: `calc(${height}% + 1rem)` }}>{minutes(bucketTotal)}</span><div className="flex flex-col-reverse" title={`${label(bucket.period)}: ${seconds(bucketTotal)}`} style={{ height: `${height}%` }}>{TIME_SAVED_KINDS.map((kind) => <div key={kind} className={KIND_COLORS[kind]} style={{ height: bucketTotal ? `${bucket.counts[kind] * coefficients[kind] / bucketTotal * 100}%` : '0%' }} />)}</div></div> })}</div><div className="flex gap-1 px-2 pt-1">{savedBuckets.map((bucket) => <span key={bucket.period} className="min-w-0 flex-1 truncate text-center text-[10px] text-gray-500">{label(bucket.period)}</span>)}</div></div></div><div className="flex flex-wrap gap-3">{TIME_SAVED_KINDS.map((kind) => <span key={kind} className="flex items-center gap-1.5 text-xs text-gray-400"><span className={`h-2.5 w-2.5 ${KIND_COLORS[kind]}`} />{KIND_LABELS[kind]}: {number(kindTotals[kind])}</span>)}</div></>}</Section>
  </main></AppLayout>
}