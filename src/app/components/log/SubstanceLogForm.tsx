import { useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../../lib/auth'
import { newId, saveSubstanceEntry } from '../../lib/writers'
import type { SubstanceEntry, SubstanceKind, SubstanceMethod } from '../../lib/types'

const KINDS: Array<{
  id: SubstanceKind
  label: string
  placeholder: string
  units: string[]
  methods: SubstanceMethod[]
}> = [
  { id: 'nicotine', label: 'Nicotine', placeholder: 'e.g. Zyn pouch', units: ['mg', 'cigarettes', 'puffs', 'pouches'], methods: ['smoke', 'vape', 'pouch', 'chew', 'patch'] },
  { id: 'cannabis', label: 'Cannabis', placeholder: 'e.g. gummy, tincture', units: ['mg', 'g', 'puffs', 'doses'], methods: ['smoke', 'vape', 'edible', 'tincture', 'topical'] },
  { id: 'alcohol', label: 'Alcohol', placeholder: 'e.g. IPA, pinot noir', units: ['drinks', 'oz', 'ml', 'shots'], methods: ['drink'] },
  { id: 'caffeine', label: 'Caffeine', placeholder: 'e.g. cold brew, matcha', units: ['mg', 'cups', 'shots', 'oz'], methods: ['drink', 'pill'] },
  { id: 'psychedelic', label: 'Psychedelic', placeholder: 'e.g. psilocybin', units: ['mg', 'g', 'doses', 'tabs'], methods: ['oral', 'sublingual', 'nasal', 'smoke'] },
  { id: 'other', label: 'Other', placeholder: 'Describe what you used', units: ['doses', 'mg', 'g', 'ml'], methods: ['oral', 'drink', 'smoke', 'vape', 'pill', 'other'] },
]

const METHOD_LABELS: Record<SubstanceMethod, string> = {
  smoke: 'Smoke',
  vape: 'Vape',
  edible: 'Edible',
  drink: 'Drink',
  oral: 'Oral',
  sublingual: 'Sublingual',
  nasal: 'Nasal',
  chew: 'Chew',
  pouch: 'Pouch',
  patch: 'Patch',
  pill: 'Pill',
  tincture: 'Tincture',
  topical: 'Topical',
  injection: 'Injection',
  other: 'Other',
}

export function SubstanceLogForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth()
  const [kind, setKind] = useState<SubstanceKind>('nicotine')
  const [name, setName] = useState('')
  const [method, setMethod] = useState<SubstanceMethod | ''>('smoke')
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState('mg')
  const [customUnit, setCustomUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [date, setDate] = useState(new Date())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedKind = useMemo(() => KINDS.find((k) => k.id === kind) ?? KINDS[0], [kind])
  const displayMethods = Array.from(new Set([...selectedKind.methods, 'other' as SubstanceMethod]))

  function chooseKind(next: SubstanceKind) {
    const option = KINDS.find((k) => k.id === next) ?? KINDS[0]
    setKind(next)
    setMethod(option.methods[0] ?? '')
    setUnit(option.units[0] ?? '')
    setCustomUnit('')
  }

  async function save() {
    if (!user) return
    if (kind === 'other' && !name.trim()) {
      setError('Name is required for Other.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const parsedAmount = Number(amount)
      const entry: SubstanceEntry = {
        id: newId(),
        userId: user.uid,
        kind,
        name: name.trim() || undefined,
        method: method || undefined,
        amount: Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : undefined,
        unit: (customUnit.trim() || unit.trim()) || undefined,
        notes: notes.trim() || undefined,
        isPrivate,
        date,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await saveSubstanceEntry(user.uid, entry)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-[13px] text-text-secondary">
        Only you can see this by default. Private substance entries stay out of friends, reports, and AI context.
      </div>

      <div>
        <span className="card-title block mb-2">What did you use?</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {KINDS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={
                'btn ' + (kind === option.id ? 'btn-primary' : 'btn-secondary') + ' justify-start'
              }
              onClick={() => chooseKind(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <Field label={kind === 'other' ? 'Name' : 'Name (optional)'}>
        <input
          className="input"
          placeholder={selectedKind.placeholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div>
        <span className="card-title block mb-2">Method</span>
        <div className="flex flex-wrap gap-2">
          {displayMethods.map((option) => (
            <button
              key={option}
              type="button"
              className={'btn ' + (method === option ? 'btn-primary' : 'btn-secondary') + ' text-[12px]'}
              onClick={() => setMethod(method === option ? '' : option)}
            >
              {METHOD_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Amount (optional)">
          <input
            className="input"
            type="number"
            step="0.1"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Unit">
          <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {selectedKind.units.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </Field>
        <Field label="Custom unit">
          <input className="input" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)} />
        </Field>
      </div>

      <Field label="Date & time">
        <input
          className="input"
          type="datetime-local"
          value={toDatetimeLocal(date)}
          onChange={(e) => setDate(new Date(e.target.value))}
        />
      </Field>

      <Field label="Notes (optional)">
        <textarea
          className="input"
          rows={3}
          placeholder="Context, how you felt, triggers..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <label className="flex items-start gap-3 text-[13px] text-text-secondary">
        <input
          type="checkbox"
          className="mt-1"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
        />
        <span>Keep private.</span>
      </label>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save substance'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">{label}</span>
      {children}
    </label>
  )
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
