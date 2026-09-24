import { useSearchParams } from 'react-router-dom'
import { PageHeader, Tabs } from '../components/ui'
import RosterTab from './settings/RosterTab'
import CalendarTab from './settings/CalendarTab'
import RulesetsTab from './settings/RulesetsTab'
import ReferenceTab from './settings/ReferenceTab'
import GeneralTab from './settings/GeneralTab'
import ResetTab from './settings/ResetTab'

const TABS = [
  { value: 'roster', label: 'Roster' },
  { value: 'calendar', label: 'Calendar and leave' },
  { value: 'rules', label: 'Rule sets' },
  { value: 'reference', label: 'Reference data' },
  { value: 'general', label: 'Settings' },
  { value: 'reset', label: 'Reset demo' },
] as const
type Tab = (typeof TABS)[number]['value']

export default function Settings() {
  const [sp, setSp] = useSearchParams()
  const tab = (TABS.find((t) => t.value === sp.get('tab'))?.value ?? 'roster') as Tab
  return (
    <>
      <PageHeader title="Settings" sub="Roster, court calendar, rules and demo controls." />
      <Tabs label="Settings sections" value={tab} onChange={(v) => setSp({ tab: v })} options={[...TABS]} />
      <div role="tabpanel" className="flex flex-col gap-6">
        {tab === 'roster' && <RosterTab />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'rules' && <RulesetsTab />}
        {tab === 'reference' && <ReferenceTab />}
        {tab === 'general' && <GeneralTab />}
        {tab === 'reset' && <ResetTab />}
      </div>
    </>
  )
}
