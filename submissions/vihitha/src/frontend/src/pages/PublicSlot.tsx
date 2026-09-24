import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Bell, CalendarClock, Clock, MapPin } from 'lucide-react'
import { api, ApiError, errMsg } from '../api/client'
import { clock, longDate } from '../lib/format'
import { cx, Spinner } from '../components/ui'

type Lang = 'en' | 'ml'
// Malayalam copy is a draft and needs a native-speaker review.
const T = {
  en: {
    find: 'Find your hearing', helper: 'Enter your case number to see your date and expected time.', caseNo: 'Case number', eg: 'For example: ST/611/2025',
    show: 'Show my slot', note: 'No login needed. Times are estimates. Please arrive 15 minutes early.', again: 'Search again',
    window: 'Be in court between', expected: 'Expected around', late: (n: number) => `Court running ${n} min late`, nowExp: 'Now expected',
    next: 'Next in line', before: (n: number) => (n === 1 ? '1 matter before yours' : `${n} matters before yours`), inCourt: 'Your matter is in court now',
    done: 'Your matter for this date is over.', bring: 'What to bring', address: 'Court address', maps: 'Open in Maps',
    sms: 'Get SMS if the time changes', smsDone: 'We will send an SMS if the time changes', notFound: 'We could not find this case. Please check the number.', onTime: 'Court is on time',
    queue: 'Your place in the queue', notToday: 'Not listed today. Your next date:', notScheduled: 'Your next date will be announced.',
  },
  ml: {
    find: 'നിങ്ങളുടെ കേസ് കണ്ടെത്തുക', helper: 'തീയതിയും പ്രതീക്ഷിത സമയവും അറിയാൻ കേസ് നമ്പർ നൽകുക.', caseNo: 'കേസ് നമ്പർ', eg: 'ഉദാഹരണം: ST/611/2025',
    show: 'എന്റെ സമയം കാണിക്കുക', note: 'ലോഗിൻ ആവശ്യമില്ല. സമയം ഏകദേശമാണ്. 15 മിനിറ്റ് നേരത്തെ എത്തുക.', again: 'വീണ്ടും തിരയുക',
    window: 'കോടതിയിൽ എത്തേണ്ട സമയം', expected: 'പ്രതീക്ഷിക്കുന്ന സമയം', late: (n: number) => `കോടതി ${n} മിനിറ്റ് വൈകി നടക്കുന്നു`, nowExp: 'ഇപ്പോൾ പ്രതീക്ഷിക്കുന്നത്',
    next: 'അടുത്തത് നിങ്ങളുടേത്', before: (n: number) => `നിങ്ങൾക്ക് മുമ്പ് ${n} കേസ്`, inCourt: 'നിങ്ങളുടെ കേസ് ഇപ്പോൾ കോടതിയിൽ',
    done: 'ഈ തീയതിയിലെ നിങ്ങളുടെ കേസ് കഴിഞ്ഞു.', bring: 'കൊണ്ടുവരേണ്ടവ', address: 'കോടതി വിലാസം', maps: 'മാപ്പിൽ തുറക്കുക',
    sms: 'സമയം മാറിയാൽ SMS ലഭിക്കാൻ', smsDone: 'സമയം മാറിയാൽ SMS അയയ്ക്കും', notFound: 'ഈ കേസ് കണ്ടെത്താനായില്ല. നമ്പർ പരിശോധിക്കുക.', onTime: 'കോടതി സമയത്ത് നടക്കുന്നു',
    queue: 'ക്യൂവിലെ നിങ്ങളുടെ സ്ഥാനം', notToday: 'ഇന്ന് ലിസ്റ്റ് ചെയ്തിട്ടില്ല. അടുത്ത തീയതി:', notScheduled: 'അടുത്ത തീയതി പിന്നീട് അറിയിക്കും.',
  },
}
const BRING_ML = ['തിരിച്ചറിയൽ രേഖ (ആധാർ അല്ലെങ്കിൽ വോട്ടർ ഐഡി)', 'ജാമ്യത്തിലാണെങ്കിൽ ജാമ്യ ബോണ്ട് രേഖകൾ', 'അഭിഭാഷകന്റെ ഫോൺ നമ്പർ']

export default function PublicSlot() {
  const [lang, setLang] = useState<Lang>(() => { try { return (localStorage.getItem('vihitha.lang') as Lang) || 'en' } catch { return 'en' } })
  useEffect(() => {
    document.documentElement.lang = lang
    try { localStorage.setItem('vihitha.lang', lang) } catch { /* ignore */ }
    return () => { document.documentElement.lang = 'en' }
  }, [lang])
  const t = T[lang]
  return (
    <div className={cx('min-h-screen bg-bg', lang === 'ml' && 'font-ml')}>
      <div className="max-w-[390px] mx-auto min-h-screen bg-bg flex flex-col">
        <header className="h-14 bg-navy text-white flex items-center px-4 gap-2">
          <span className="text-lg font-bold font-sans">Vihitha</span><span className="font-ml text-sm text-white/70">വിഹിത</span>
          <button className="ml-auto min-h-[44px] px-3 rounded-[12px] bg-white/10 text-sm font-semibold" onClick={() => setLang(lang === 'en' ? 'ml' : 'en')}
            aria-label={lang === 'en' ? 'Switch to Malayalam' : 'Switch to English'}>
            {lang === 'en' ? <>English ⇄ <span className="font-ml" lang="ml">മലയാളം</span></> : <><span lang="en" className="font-sans">English</span> ⇄ മലയാളം</>}
          </button>
        </header>
        <main className="p-4 flex flex-col gap-4">
          <Routes>
            <Route index element={<Search t={t} />} />
            <Route path="slot" element={<Slot t={t} lang={lang} />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function Search({ t }: { t: typeof T.en }) {
  const nav = useNavigate()
  const [v, setV] = useState('')
  return (
    <form className="flex flex-col gap-4 pt-4" onSubmit={(e) => { e.preventDefault(); v.trim() && nav(`/public/slot?case=${encodeURIComponent(v.trim().toUpperCase())}`) }}>
      <h1 className="text-2xl font-bold">{t.find}</h1>
      <p className="text-muted">{t.helper}</p>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">{t.caseNo}</span>
        <input className="input text-xl h-14 num font-sans uppercase" inputMode="text" autoComplete="off" placeholder="ST/611/2025" value={v} onChange={(e) => setV(e.target.value)} aria-describedby="eg" />
        <span id="eg" className="text-sm text-muted">{t.eg}</span>
      </label>
      <button className="btn-primary h-14 text-base">{t.show}</button>
      <p className="text-sm text-muted flex gap-2"><Clock size={18} strokeWidth={1.8} className="shrink-0" />{t.note}</p>
    </form>
  )
}

function Slot({ t, lang }: { t: typeof T.en; lang: Lang }) {
  const [sp] = useSearchParams()
  const cn = sp.get('case') ?? ''
  const q = useQuery({ queryKey: ['public', cn], queryFn: () => api.publicSlot(cn), refetchInterval: 60_000, enabled: !!cn })
  const [sms, setSms] = useState(false)
  const back = <Link to="/public" className="link inline-flex items-center gap-1 min-h-[44px]"><ArrowLeft size={18} strokeWidth={1.8} />{t.again} · <span className="num font-sans">{cn}</span></Link>
  if (q.isLoading) return <>{back}<div className="card p-8 flex justify-center"><Spinner /></div></>
  if (q.error) return <>{back}<div className="card p-5 text-red-text">{q.error instanceof ApiError && q.error.status === 404 ? t.notFound : errMsg(q.error)}</div></>
  const s = q.data
  if (!s) return back
  const msg = lang === 'ml' ? s.message_ml || s.message_en : s.message_en
  const Address = (
    <section className="card p-5 flex flex-col gap-3">
      <h2 className="font-bold">{t.address}</h2>
      <p className="flex gap-2 text-sm"><MapPin size={18} strokeWidth={1.8} className="shrink-0 text-muted" />{s.court_address}</p>
      <a className="btn-secondary" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.court_address)}`} target="_blank" rel="noreferrer">{t.maps}</a>
    </section>
  )

  if (s.status === 'NOT_SCHEDULED') {
    return <>{back}
      <section className="card p-5 flex flex-col gap-2">
        <p className="text-sm text-muted num font-sans">{s.case_number} · {s.court_name}</p>
        <p className="text-lg font-semibold flex gap-2"><CalendarClock size={22} className="text-blue shrink-0" />{t.notScheduled}</p>
        {msg && <p className="text-sm text-muted">{msg}</p>}
      </section>{Address}</>
  }
  if (s.status === 'NOT_LISTED_TODAY') {
    return <>{back}
      <section className="card p-5 flex flex-col gap-2">
        <p className="text-sm text-muted num font-sans">{s.case_number} · {s.court_name}</p>
        <p className="font-semibold">{t.notToday}</p>
        {s.date && <p className="text-2xl font-bold num font-sans">{longDate(s.date)}</p>}
        {s.window_start && <p className="num font-sans">{t.window} <b>{clock(s.window_start, true)} – {clock(s.window_end, true)}</b></p>}
        {msg && <p className="text-sm text-muted">{msg}</p>}
      </section>{Address}</>
  }

  const pos = s.queue_position ?? 0
  const delay = s.delay_minutes ?? 0
  const late = s.status === 'RUNNING_LATE' || delay > 0
  return (
    <>
      {back}
      <section className="card p-5 flex flex-col gap-4">
        <p className="text-sm text-muted">{s.court_name} · <span className="num font-sans">{longDate(s.date)}</span></p>
        <div>
          <p className="text-sm font-semibold text-muted">{t.window}</p>
          <p className="text-[36px] leading-[44px] font-bold num font-sans">{clock(s.window_start)}–{clock(s.window_end, true)}</p>
          {s.eta && <p className="text-sm font-sans num mt-1"><span className="text-muted">{late ? t.nowExp : t.expected}</span> <b>{clock(s.eta, true)}</b></p>}
        </div>
        {s.status === 'DONE' ? <div role="status" className="rounded-btn px-3 py-2.5 text-sm border-l-4 bg-grey-bg text-grey-text border-grey">{t.done}</div> : (
          <div role="status" className={cx('rounded-btn px-3 py-2.5 text-sm border-l-4', late ? 'bg-amber-bg text-amber-text border-amber' : 'bg-green-bg text-green-text border-green')}>
            {late ? <><strong>{t.late(delay)}</strong>{s.eta && <> · {t.nowExp} <span className="num font-sans">{clock(s.eta, true)}</span></>}</> : <strong>{t.onTime}</strong>}
          </div>
        )}
        {s.status !== 'DONE' && s.queue_position != null && (
          <div>
            <p className="font-semibold">{s.status === 'IN_PROGRESS' ? t.inCourt : pos === 0 ? t.next : t.before(pos)}</p>
            <div className="grid grid-cols-5 gap-1 mt-2" aria-label={t.queue}>
              {[0, 1, 2, 3, 4].map((i) => <span key={i} className={cx('h-2 rounded-full', i < Math.max(1, 5 - pos) ? 'bg-teal' : 'bg-[#E9EEF4]')} />)}
            </div>
          </div>
        )}
        {msg && <p className="text-sm text-muted">{msg}</p>}
      </section>
      {s.what_to_bring.length > 0 && (
        <section className="card p-5">
          <h2 className="font-bold mb-2">{t.bring}</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1">{(lang === 'ml' ? BRING_ML : s.what_to_bring).map((b) => <li key={b}>{b}</li>)}</ul>
        </section>
      )}
      {Address}
      <button className={cx('h-14 text-base', sms ? 'btn-secondary text-green-text' : 'btn-primary')} onClick={() => setSms(true)} disabled={sms}>
        <Bell size={18} strokeWidth={1.8} />{sms ? t.smsDone : t.sms}
      </button>
    </>
  )
}
