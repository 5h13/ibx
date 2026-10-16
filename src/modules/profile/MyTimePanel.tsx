'use client';
// Build 120 — My Profile home: today's clock (in / break / out), my leave, my timekeeping.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { PopupAction, usePopupClose } from '@/core/ui/PopupAction';
import { myClockAction, myLeaveRequestAction, myLeaveCancelAction, myCorrectionAction, type ClockStep, type MyTimeData } from './myTime';

const TZ = 'Asia/Manila';
const tm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '—');
const hm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '');
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`);
const words = (s: string) => String(s ?? '').replaceAll('_', ' ');
const STATUS_TONE: Record<string, string> = {
  present: 'bg-emerald-100 text-emerald-800', late: 'bg-amber-100 text-amber-800', undertime: 'bg-amber-100 text-amber-800',
  incomplete: 'bg-slate-100 text-slate-700', absent: 'bg-red-100 text-red-800', leave: 'bg-sky-100 text-sky-800',
  prepared: 'bg-amber-100 text-amber-800', reviewed: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800', cancelled: 'bg-slate-100 text-slate-600',
};
const Badge = ({ s, label }: { s: string; label?: string }) => <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_TONE[s] ?? 'bg-slate-100 text-slate-700'}`}>{label ?? words(s)}</span>;
const pendingWord = (s: string) => (s === 'prepared' ? 'waiting for review' : s === 'reviewed' ? 'waiting for approval' : words(s));

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <div>
      <div className="text-3xl font-bold tabular-nums">{now ? now.toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ' '}</div>
      <div className="text-sm text-slate-500">{now ? now.toLocaleDateString('en-PH', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ' '}</div>
    </div>
  );
}

function TodayCard({ data }: { data: NonNullable<MyTimeData> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const r = data.record;
  const state = !r?.time_in ? 'out' : r.time_out ? 'done' : r.break_out && !r.break_in ? 'break' : 'in';
  const go = (step: ClockStep, ok: string) => start(async () => {
    setMsg(null);
    try { const res = await myClockAction(step); setMsg({ ok: true, text: `${ok} at ${res.at}.` }); router.refresh(); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); }
  });
  const big = 'rounded-xl px-5 py-4 text-lg font-semibold disabled:opacity-50';
  return (
    <section className="rounded-xl border bg-white p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <Clock />
          <p className="text-sm text-slate-600">
            {data.schedule ? <>Schedule today: <b>{data.schedule.text}</b> <span className="text-slate-400">({data.schedule.name})</span></> : 'No work schedule assigned — your times are recorded, but late / undertime are not computed. Ask your admin to assign one.'}
          </p>
          {r && ['leave', 'holiday', 'rest_day'].includes(r.status) && !r.time_in && <p className="text-sm text-sky-700">Today is marked <b>{words(r.status)}</b> on your attendance.</p>}
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {state === 'out' && <button className={`${big} bg-emerald-600 text-white`} disabled={pending} onClick={() => go('in', 'Clocked in')}>Clock in</button>}
          {state === 'in' && !r.break_out && <button className={`${big} border bg-white`} disabled={pending} onClick={() => go('break_out', 'Break started')}>Start break</button>}
          {state === 'break' && <button className={`${big} bg-amber-500 text-white`} disabled={pending} onClick={() => go('break_in', 'Break ended')}>End break</button>}
          {state === 'in' && <button className={`${big} bg-red-600 text-white`} disabled={pending} onClick={() => go('out', 'Clocked out')}>Clock out</button>}
          {state === 'done' && <span className="rounded-xl bg-slate-100 px-5 py-4 text-sm text-slate-600">Done for today</span>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
        {[['Clock in', tm(r?.time_in)], ['Break start', tm(r?.break_out)], ['Break end', tm(r?.break_in)], ['Clock out', tm(r?.time_out)],
          ['Status', r?.time_in ? (state === 'break' ? 'On break' : state === 'done' ? `${words(r.status)}` : Number(r.late_minutes) > 0 ? `In · ${mins(Number(r.late_minutes))} late` : 'In') : 'Not clocked in']].map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-slate-50 p-2"><div className="text-[11px] uppercase text-slate-500">{k}</div><div className="font-medium">{v}</div></div>
        ))}
      </div>
      {state === 'done' && <p className="mt-2 text-xs text-slate-500">Hours: {Number(r.regular_hours)} regular{Number(r.overtime_hours) ? `, ${Number(r.overtime_hours)} overtime` : ''}{Number(r.undertime_minutes) ? ` · ${mins(Number(r.undertime_minutes))} undertime` : ''}. A wrong time? Use “Request correction” below.</p>}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
    </section>
  );
}

function LeaveForm({ data }: { data: NonNullable<MyTimeData> }) {
  const router = useRouter();
  const close = usePopupClose();
  const [f, setF] = useState({ leave_type_id: data.leave[0]?.id ?? '', start_date: data.today, end_date: data.today, day_type: 'full_day', reason: '' });
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const t = data.leave.find((x) => x.id === f.leave_type_id);
  const n = f.start_date && f.end_date && f.end_date >= f.start_date ? Math.round((Date.parse(f.end_date) - Date.parse(f.start_date)) / 86400000) + 1 : 0;
  const days = f.day_type === 'full_day' ? n : n === 1 ? 0.5 : Math.max(0, n - 0.5);
  const over = t?.left != null && days > t.left - t.pending;
  const save = () => start(async () => {
    setErr('');
    try { await myLeaveRequestAction(f); close(); router.refresh(); } catch (e) { setErr(errorText(e)); }
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-3 text-sm">
      <label className="block"><span className="text-slate-600">Type of leave</span>
        <select className="input mt-1" value={f.leave_type_id} onChange={set('leave_type_id')}>
          {data.leave.map((x) => <option key={x.id} value={x.id}>{x.name}{x.left != null ? ` — ${x.left} left` : ''}{x.paid ? '' : ' (unpaid)'}</option>)}
        </select></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="text-slate-600">First day</span><input className="input mt-1" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date })} /></label>
        <label className="block"><span className="text-slate-600">Last day</span><input className="input mt-1" type="date" min={f.start_date} value={f.end_date} onChange={set('end_date')} /></label>
      </div>
      <label className="block"><span className="text-slate-600">Whole or half day</span>
        <select className="input mt-1" value={f.day_type} onChange={set('day_type')}>
          <option value="full_day">Whole day{n > 1 ? 's' : ''}</option>
          <option value="first_half">{n > 1 ? 'Half day on the first day' : 'Half day (morning)'}</option>
          <option value="second_half">{n > 1 ? 'Half day on the last day' : 'Half day (afternoon)'}</option>
        </select></label>
      <label className="block"><span className="text-slate-600">Reason</span><textarea className="input mt-1 min-h-[4rem]" value={f.reason} onChange={set('reason')} /></label>
      <p className="text-xs text-slate-600">{days > 0 ? `${days} day${days === 1 ? '' : 's'} (calendar days, as counted by HR).` : 'Check the dates.'}
        {over && <span className="text-amber-700"> More than your balance left after pending requests — HR decides.</span>}</p>
      <button className="button" disabled={pending || !f.leave_type_id || days <= 0 || !f.reason.trim()} onClick={save}>{pending ? 'Sending…' : 'Send leave request'}</button>
      {err && <p className="text-red-700">{err}</p>}
    </div>
  );
}

function CorrectionForm({ data, date: d0, rec }: { data: NonNullable<MyTimeData>; date?: string; rec?: any }) {
  const router = useRouter();
  const close = usePopupClose();
  const [f, setF] = useState({ date: d0 ?? data.today, time_in: hm(rec?.time_in), break_out: hm(rec?.break_out), break_in: hm(rec?.break_in), time_out: hm(rec?.time_out), reason: '' });
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = () => start(async () => {
    setErr('');
    try { await myCorrectionAction(f); close(); router.refresh(); } catch (e) { setErr(errorText(e)); }
  });
  return (
    <div className="space-y-3 text-sm">
      <label className="block"><span className="text-slate-600">Day</span><input className="input mt-1" type="date" max={data.today} value={f.date} disabled={!!d0} onChange={set('date')} /></label>
      <div className="grid grid-cols-2 gap-2">
        {([['time_in', 'Clock in'], ['break_out', 'Break start'], ['break_in', 'Break end'], ['time_out', 'Clock out']] as const).map(([k, l]) => (
          <label key={k} className="block"><span className="text-slate-600">{l}</span><input className="input mt-1" type="time" value={f[k]} onChange={set(k)} /></label>
        ))}
      </div>
      <p className="text-xs text-slate-500">Put the right times; blanks keep what is recorded. Times are Philippine time.</p>
      <label className="block"><span className="text-slate-600">What happened</span><textarea className="input mt-1 min-h-[3.5rem]" placeholder='e.g. "Forgot to clock out", "No signal at the site"' value={f.reason} onChange={set('reason')} /></label>
      <button className="button" disabled={pending || !f.reason.trim()} onClick={save}>{pending ? 'Sending…' : 'Send correction'}</button>
      {err && <p className="text-red-700">{err}</p>}
    </div>
  );
}

function LeaveCard({ data }: { data: NonNullable<MyTimeData> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const cancel = (id: string) => start(async () => { setErr(''); try { await myLeaveCancelAction(id); router.refresh(); } catch (e) { setErr(errorText(e)); } });
  return (
    <section className="rounded-xl border bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">My leave <span className="text-sm font-normal text-slate-500">({data.year})</span></h2>
        {data.leave.length > 0 && <PopupAction label="Request leave" title="Request leave">{() => <LeaveForm data={data} />}</PopupAction>}
      </div>
      {data.leave.length === 0 ? <p className="text-sm text-slate-500">No leave types are set up yet.</p> : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {data.leave.map((l) => (
            <div key={l.id} className="rounded-lg border bg-slate-50 p-2 text-sm">
              <div className="text-[11px] uppercase text-slate-500">{l.name}</div>
              {l.set_up ? <><div className="text-xl font-semibold">{l.left}<span className="text-xs font-normal text-slate-500"> of {l.entitlement} left</span></div>
                <div className="text-[11px] text-slate-500">{l.used} used{l.pending ? ` · ${l.pending} pending` : ''}</div></>
                : <div className="text-xs text-slate-500">Not set up for you{l.default_days != null ? ` (usual: ${l.default_days} days)` : ''}{l.pending ? ` · ${l.pending} pending` : ''}</div>}
            </div>
          ))}
        </div>
      )}
      {data.requests.length > 0 && (
        <table className="m-cards mt-4 w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-1">Leave</th><th className="p-1">Dates</th><th className="p-1">Days</th><th className="p-1">Status</th><th className="p-1"></th></tr></thead>
          <tbody>{data.requests.map((r: any) => (
            <tr key={r.id} className="border-b align-top">
              <td className="p-1" data-label="Leave">{r.type}<div className="text-[11px] text-slate-500">{r.reason}</div></td>
              <td className="p-1" data-label="Dates">{r.start_date === r.end_date ? dayLabel(r.start_date) : `${dayLabel(r.start_date)} – ${dayLabel(r.end_date)}`}{r.day_type !== 'full_day' ? ' (half day)' : ''}</td>
              <td className="p-1" data-label="Days">{Number(r.days)}</td>
              <td className="p-1" data-label="Status"><Badge s={r.status} label={pendingWord(r.status)} />{r.rejection_reason && <div className="text-[11px] text-red-700">{r.rejection_reason}</div>}</td>
              <td className="p-1" data-m="actions">{['prepared', 'reviewed'].includes(r.status) && <button className="text-xs underline" disabled={pending} onClick={() => cancel(r.id)}>Cancel</button>}</td>
            </tr>))}
          </tbody>
        </table>
      )}
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
    </section>
  );
}

function TimekeepingCard({ data }: { data: NonNullable<MyTimeData> }) {
  const router = useRouter();
  const t = data.totals;
  const openCorr = new Set(data.corrections.filter((c) => ['draft', 'prepared', 'reviewed'].includes(c.status)).map((c) => c.date));
  return (
    <section className="rounded-xl border bg-white p-5">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h2 className="font-semibold">My timekeeping</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input md:w-auto" value={data.range.key} onChange={(e) => router.push(`/profile?tk=${encodeURIComponent(e.target.value)}`)}>
            {data.choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <PopupAction label="Request correction" variant="secondary" title="Request a time correction">{() => <CorrectionForm data={data} />}</PopupAction>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-6">
        {[['Days worked', t.days_worked], ['Regular hours', t.regular_hours], ['Overtime hours', t.overtime_hours], ['Late', t.late_days ? `${t.late_days}× · ${mins(t.late_minutes)}` : '0'],
          ['Undertime', mins(t.undertime_minutes)], ['Absent / leave', `${t.absent} / ${t.leave}`]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border bg-slate-50 p-2"><div className="text-[11px] uppercase text-slate-500">{k}</div><div className="font-semibold">{v}</div></div>
        ))}
      </div>
      {t.no_clock_out > 0 && <p className="mt-2 text-sm text-amber-700">{t.no_clock_out} day{t.no_clock_out === 1 ? '' : 's'} with no clock-out — send a correction so the hours count.</p>}
      {data.days.length === 0 ? <p className="mt-3 text-sm text-slate-500">No attendance recorded for {data.range.label}.</p> : (
        <div className="mt-3 max-h-[60vh] overflow-auto">
          <table className="m-cards w-full text-sm">
            <thead className="sticky top-0 bg-white"><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-1">Day</th><th className="p-1">In</th><th className="p-1">Break</th><th className="p-1">Out</th><th className="p-1">Hours</th><th className="p-1">Late / under</th><th className="p-1">Status</th><th className="p-1"></th></tr></thead>
            <tbody>{data.days.map((d: any) => (
              <tr key={d.id} className="border-b">
                <td className="p-1" data-label="Day">{dayLabel(d.attendance_date)}</td>
                <td className="p-1" data-label="In">{tm(d.time_in)}</td>
                <td className="p-1" data-label="Break">{d.break_out ? `${tm(d.break_out)} – ${tm(d.break_in)}` : '—'}</td>
                <td className="p-1" data-label="Out">{d.time_in && !d.time_out && d.attendance_date < data.today ? <span className="text-amber-700">missing</span> : tm(d.time_out)}</td>
                <td className="p-1" data-label="Hours">{Number(d.regular_hours)}{Number(d.overtime_hours) ? ` + ${Number(d.overtime_hours)} OT` : ''}</td>
                <td className="p-1" data-label="Late / under">{Number(d.late_minutes) ? mins(Number(d.late_minutes)) : '—'} / {Number(d.undertime_minutes) ? mins(Number(d.undertime_minutes)) : '—'}</td>
                <td className="p-1" data-label="Status"><Badge s={d.status} /></td>
                <td className="p-1" data-m="actions">{openCorr.has(d.attendance_date) ? <span className="text-[11px] text-amber-700">correction sent</span>
                  : <PopupAction label="Correct" variant="secondary" title={`Correct ${dayLabel(d.attendance_date)}`}>{() => <CorrectionForm data={data} date={d.attendance_date} rec={d} />}</PopupAction>}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {data.corrections.length > 0 && (
        <details className="mt-3 text-sm"><summary className="cursor-pointer text-slate-600">My correction requests ({data.corrections.length})</summary>
          <ul className="mt-2 space-y-1">{data.corrections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">{c.date ? dayLabel(c.date) : '—'} · {c.reason} <Badge s={c.status} label={pendingWord(c.status)} />{c.rejection_reason && <span className="text-xs text-red-700">{c.rejection_reason}</span>}</li>))}
          </ul></details>
      )}
    </section>
  );
}

export function MyTimePanel({ data, greeting }: { data: NonNullable<MyTimeData>; greeting: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{greeting}</h1>
      <TodayCard data={data} />
      <LeaveCard data={data} />
      <TimekeepingCard data={data} />
    </div>
  );
}
