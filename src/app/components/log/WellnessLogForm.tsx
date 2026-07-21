import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { newId, saveWellness } from '../../lib/writers'
import {
  BRISTOL_INFO,
  BRISTOL_TYPES,
  CLEANUP_OPTIONS,
  CONTROL_LABELS,
  CONTROL_OPTIONS,
  DURATION_QUICK_MINUTES,
  FEEL_TAG_OPTIONS,
  PASSAGE_SYMPTOM_OPTIONS,
  PORTION_LABELS,
  PORTIONS,
  RED_FLAG_OPTIONS,
  STOOL_SWATCH_COLORS,
  URGENCY_LABELS,
  combineNotesAndFeelTags,
  computeGIBurdenScore,
  parseFeelTagsFromNotes,
} from '../../lib/gi'
import type {
  BowelControlStatus,
  BowelMovementEntry,
  BowelMovementSize,
  BowelSegment,
  BowelSegmentPortion,
  BristolType,
  EnergyEntry,
  MoodEntry,
  StoolColor,
  SymptomEntry,
  WellnessData,
  WellnessEntry,
  WellnessType,
} from '../../lib/types'

type Kind = WellnessType | 'checkin'

const STOOL_COLORS: StoolColor[] = [
  'brown',
  'darkBrown',
  'lightBrown',
  'yellow',
  'green',
  'black',
  'red',
  'clay',
]

const STOOL_COLOR_LABELS: Record<StoolColor, string> = {
  brown: 'Brown',
  darkBrown: 'Dark brown',
  lightBrown: 'Light brown',
  yellow: 'Yellow',
  green: 'Green',
  black: 'Black',
  red: 'Red',
  clay: 'Clay',
}

// Option strings match the iOS forms exactly (QuickWellnessLogView.swift /
// GutBrainCheckInView.swift) so records read identically on both platforms.
const MOOD_TAGS = ['Happy', 'Anxious', 'Calm', 'Stressed', 'Focused', 'Tired', 'Energetic', 'Irritable']
const ENERGY_TAGS = ['Morning', 'Afternoon dip', 'Post-meal crash', 'After caffeine', 'After exercise', 'Poor sleep', 'Well rested', 'Dehydrated']
const GI_SYMPTOMS = ['Bloating', 'Abdominal pain', 'Cramping', 'Nausea', 'Constipation', 'Diarrhea', 'Urgency', 'Gas / flatulence', 'Belching', 'Reflux / heartburn', 'Loss of appetite', 'Brain fog', 'Fatigue', 'Headache']
const BODY_AREAS = ['Upper abdomen', 'Lower abdomen', 'Whole abdomen', 'Chest', 'Head', 'Whole body']
const SYMPTOM_DURATIONS = ['< 30 min', '30–60 min', '1–3 hrs', 'Half day', 'All day', 'Ongoing']
const SYMPTOM_TRIGGERS = ['After eating', 'Specific food', 'Stress', 'Caffeine', 'Alcohol', 'Poor sleep', 'Menstrual', 'Medication', 'Exercise']
const CHECKIN_GI_SYMPTOMS = ['Bloating', 'Abdominal pain', 'Cramping', 'Nausea', 'Constipation', 'Diarrhea', 'Urgency', 'Gas', 'Reflux']

const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' }

type GutTab = 'type' | 'timing' | 'details'

interface WellnessLogFormProps {
  onSaved: (entry: WellnessEntry) => void
  initialEntry?: WellnessEntry
  onCancel?: () => void
}

export function WellnessLogForm({ onSaved, initialEntry, onCancel }: WellnessLogFormProps) {
  const { user } = useAuth()
  const isEditing = initialEntry != null
  const initialKind: Kind = initialEntry ? kindFromEntry(initialEntry) : 'checkin'
  const initialBowel = initialEntry?.data.kind === 'bowelMovement' ? initialEntry.data.entry : undefined
  const initialDuration = initialBowel?.durationInSeconds ?? 0
  // iOS folds "How did it feel?" tags into the notes string — parse them out.
  const parsedBowelNotes = parseFeelTagsFromNotes(initialBowel?.notes ?? (initialEntry?.data.kind === 'bowelMovement' ? initialEntry?.notes : undefined))
  const parsedSymptom = parseSymptomString(
    initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.symptom : ''
  )

  const [kind, setKind] = useState<Kind>(initialKind)
  const [date, setDate] = useState(initialEntry?.date ?? new Date())
  const [notes, setNotes] = useState(
    initialEntry?.data.kind === 'bowelMovement' ? parsedBowelNotes.notes : initialEntry?.notes ?? ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // MARK: - Check-in state (mirrors GutBrainCheckInView)
  const [checkinMood, setCheckinMood] = useState(3)
  const [checkinStress, setCheckinStress] = useState(3)
  const [checkinSymptoms, setCheckinSymptoms] = useState<string[]>([])
  const [checkinSeverity, setCheckinSeverity] = useState(4)

  // MARK: - Mood / energy / symptom state
  const [mood, setMood] = useState<MoodEntry>(
    initialEntry?.data.kind === 'mood' ? initialEntry.data.entry : { rating: 3, tags: [], notes: undefined }
  )
  const [energy, setEnergy] = useState<EnergyEntry>(
    initialEntry?.data.kind === 'energy' ? initialEntry.data.entry : { level: 3, tags: [], notes: undefined }
  )
  const [symptomChips, setSymptomChips] = useState<string[]>(parsedSymptom.chips)
  const [symptomText, setSymptomText] = useState(parsedSymptom.text)
  const [symptom, setSymptom] = useState<SymptomEntry>({
    symptom: initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.symptom : '',
    severity: initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.severity : 5,
    duration: initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.duration : undefined,
    bodyArea: initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.bodyArea : undefined,
    triggers: initialEntry?.data.kind === 'symptom' ? initialEntry.data.entry.triggers : [],
  })

  // MARK: - Gut check state (mirrors BowelLogView)
  const [gutTab, setGutTab] = useState<GutTab>('type')
  const [segments, setSegments] = useState<BowelSegment[]>(
    initialBowel && initialBowel.segments.length > 0
      ? initialBowel.segments
      : [{ id: newId(), bristolType: initialBowel?.bristolType ?? 4, portion: 'all' }]
  )
  const [bowel, setBowel] = useState({
    color: initialBowel?.color,
    urgency: initialBowel?.urgency,
    estimatedSize: initialBowel?.estimatedSize,
    control: initialBowel?.control,
    // iOS-only private photo attachment — preserved across web edits.
    photoStoragePath: initialBowel?.photoStoragePath,
    photoCreatedAt: initialBowel?.photoCreatedAt,
  })
  const [passage, setPassage] = useState<string[]>(initialBowel?.passageSymptoms ?? [])
  const [cleanup, setCleanup] = useState<string[]>(initialBowel?.cleanup ?? [])
  const [redFlags, setRedFlags] = useState<string[]>(initialBowel?.redFlags ?? [])
  const [feelTags, setFeelTags] = useState<string[]>(parsedBowelNotes.tags)
  const [bowelDurationMinutes, setBowelDurationMinutes] = useState(Math.floor(initialDuration / 60))
  const [bowelDurationSeconds, setBowelDurationSeconds] = useState(initialDuration % 60)
  const [showInDashboardTimeline, setShowInDashboardTimeline] = useState(
    initialEntry?.showInDashboardTimeline ?? false
  )

  const primaryType = segments[0]?.bristolType ?? 4
  const isMixed = segments.length > 1

  const liveBurden = computeGIBurdenScore({
    bristolType: primaryType,
    segments: normalizeSegments(segments),
    urgency: bowel.urgency,
    passageSymptoms: passage,
    control: bowel.control,
    cleanup,
    redFlags,
  })

  function setPrimaryType(type: BristolType) {
    setSegments((prev) => prev.map((s, i) => (i === 0 ? { ...s, bristolType: type } : s)))
  }

  function updateSegment(id: string, patch: Partial<BowelSegment>) {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function addSegment() {
    setSegments((prev) => {
      // Converting a single episode into phases: give the existing phase a
      // real share first so the portions start meaningful.
      const base = prev.length === 1 ? [{ ...prev[0], portion: 'most' as BowelSegmentPortion }] : prev
      return [...base, { id: newId(), bristolType: primaryType, portion: 'some' }]
    })
  }

  function removeSegment(id: string) {
    setSegments((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((s) => s.id !== id)
      // Back to a single episode → the whole movement is that one form.
      return next.length === 1 ? [{ ...next[0], portion: 'all' }] : next
    })
  }

  async function save() {
    if (!user) return
    setSaving(true)
    setError(null)
    try {
      if (kind === 'checkin') {
        await saveCheckin()
        return
      }

      let data: WellnessData
      let entryNotes: string | undefined = notes.trim() || undefined

      switch (kind) {
        case 'mood':
          data = { kind: 'mood', entry: mood }
          break
        case 'energy':
          data = { kind: 'energy', entry: energy }
          break
        case 'symptom': {
          // Mirror QuickWellnessLogView: chips + typed text joined, "General" fallback.
          const typed = symptomText.trim()
          const primary = symptomChips.length
            ? [...symptomChips, ...(typed ? [typed] : [])].join(', ')
            : typed || 'General'
          data = { kind: 'symptom', entry: { ...symptom, symptom: primary } }
          break
        }
        case 'bowelMovement': {
          const durationInSeconds = bowelDurationMinutes * 60 + bowelDurationSeconds
          // iOS folds feel tags into the notes string: "notes | tag, tag".
          const allNotes = combineNotesAndFeelTags(notes, [...feelTags].sort())
          const normalized = normalizeSegments(segments)
          const entry: BowelMovementEntry = {
            bristolType: normalized[0]?.bristolType ?? primaryType,
            color: bowel.color,
            urgency: bowel.urgency,
            durationInSeconds: durationInSeconds > 0 ? durationInSeconds : undefined,
            notes: allNotes || undefined,
            estimatedSize: bowel.estimatedSize,
            photoStoragePath: bowel.photoStoragePath,
            photoCreatedAt: bowel.photoCreatedAt,
            segments: normalized,
            passageSymptoms: [...passage].sort(),
            control: bowel.control,
            cleanup: [...cleanup].sort(),
            redFlags: [...redFlags].sort(),
          }
          entry.giBurdenScore = computeGIBurdenScore(entry).score
          data = { kind: 'bowelMovement', entry }
          entryNotes = allNotes || undefined
          break
        }
      }

      const entry: WellnessEntry = {
        id: initialEntry?.id ?? newId(),
        userId: user.uid,
        type: kind,
        data,
        notes: entryNotes,
        showInDashboardTimeline: kind === 'bowelMovement' ? showInDashboardTimeline : undefined,
        date,
        createdAt: initialEntry?.createdAt ?? new Date(),
      }
      await saveWellness(user.uid, entry)
      onSaved(entry)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Gut-Brain Check-In — mirrors GutBrainCheckInView.save(): a mood entry
   * (valence + stress), plus a linked symptom entry at the same timestamp when
   * gut symptoms are flagged; stress ≥ 6 auto-tags "Stress" as the trigger.
   */
  async function saveCheckin() {
    if (!user) return
    try {
      const moodEntry: WellnessEntry = {
        id: newId(),
        userId: user.uid,
        type: 'mood',
        data: { kind: 'mood', entry: { rating: checkinMood, stress: checkinStress, tags: [] } },
        notes: notes.trim() || undefined,
        date,
        createdAt: new Date(),
      }
      await saveWellness(user.uid, moodEntry)

      if (checkinSymptoms.length > 0) {
        const symptomEntry: WellnessEntry = {
          id: newId(),
          userId: user.uid,
          type: 'symptom',
          data: {
            kind: 'symptom',
            entry: {
              symptom: [...checkinSymptoms].sort().join(', '),
              severity: checkinSeverity,
              triggers: checkinStress >= 6 ? ['Stress'] : [],
            },
          },
          date,
          createdAt: new Date(),
        }
        await saveWellness(user.uid, symptomEntry)
      }
      onSaved(moodEntry)
    } finally {
      setSaving(false)
    }
  }

  const kinds: Array<{ id: Kind; label: string }> = isEditing
    ? [{ id: initialKind, label: kindLabel(initialKind) }]
    : [
        { id: 'checkin', label: 'Check-in' },
        { id: 'mood', label: 'Mood' },
        { id: 'energy', label: 'Energy' },
        { id: 'symptom', label: 'Symptom' },
        { id: 'bowelMovement', label: 'Gut check' },
      ]

  return (
    <div className="space-y-5">
      <div>
        <span className="card-title block mb-2">Type</span>
        <div className="tab-strip">
          {kinds.map((k) => (
            <button
              key={k.id}
              className={kind === k.id ? 'active' : ''}
              onClick={() => setKind(k.id)}
              disabled={isEditing}
              title={isEditing ? 'Create a new entry to change type.' : undefined}
            >
              {k.label}
            </button>
          ))}
        </div>
        {isEditing && (
          <p className="text-text-muted text-[12px] mt-2">
            Entry type is fixed when editing, matching the iOS journal flow.
          </p>
        )}
        {kind === 'checkin' && (
          <p className="text-text-muted text-[12px] mt-2">
            Mood, stress &amp; gut in 15 seconds — records a mood entry, plus a linked symptom entry
            when you flag anything.
          </p>
        )}
      </div>

      {kind === 'checkin' && (
        <div className="space-y-4">
          <div>
            <span className="card-title block mb-2">How's your mood?</span>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  type="button"
                  className={
                    'btn flex-1 !py-2 text-[22px] ' +
                    (checkinMood === level ? 'btn-primary' : 'btn-secondary opacity-60')
                  }
                  onClick={() => setCheckinMood(level)}
                  aria-label={`Mood ${level} of 5`}
                >
                  {MOOD_EMOJI[level]}
                </button>
              ))}
            </div>
          </div>

          <StressSlider value={checkinStress} onChange={setCheckinStress} />

          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              Any gut symptoms right now? {checkinSymptoms.length === 0 ? '(optional)' : ''}
            </span>
            <ChipRow options={CHECKIN_GI_SYMPTOMS} selected={checkinSymptoms} onChange={setCheckinSymptoms} />
            {checkinStress >= 6 && checkinSymptoms.length > 0 && (
              <p className="text-amber-200/80 text-[12px] mt-2">
                Stress ≥ 6 — "Stress" will be tagged as a trigger on the symptom entry.
              </p>
            )}
          </div>

          {checkinSymptoms.length > 0 && (
            <NumberScale
              label="How bad?"
              max={10}
              value={checkinSeverity}
              onChange={setCheckinSeverity}
            />
          )}
        </div>
      )}

      {kind === 'mood' && (
        <div className="space-y-4">
          <RatingRow
            label="Mood"
            value={mood.rating}
            labels={['Very bad', 'Bad', 'Neutral', 'Good', 'Great']}
            onChange={(v) => setMood({ ...mood, rating: v })}
          />
          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              Stress (0–10) {mood.stress != null ? '' : '(not recorded)'}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 11 }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  className={
                    'btn !px-3 !py-1.5 text-[12px] ' +
                    (mood.stress === n ? 'btn-primary' : 'btn-secondary')
                  }
                  onClick={() => setMood({ ...mood, stress: mood.stress === n ? undefined : n })}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-text-muted text-[12px] mt-1.5">
              Stress is the gut-brain axis's central mediator — recording it with mood powers gut correlations.
            </p>
          </div>
          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              What's driving it?
            </span>
            <ChipRow
              options={MOOD_TAGS}
              selected={mood.tags}
              onChange={(tags) => setMood({ ...mood, tags })}
            />
          </div>
        </div>
      )}

      {kind === 'energy' && (
        <div className="space-y-4">
          <RatingRow
            label="Energy"
            value={energy.level}
            labels={['Exhausted', 'Low', 'Moderate', 'Good', 'Excellent']}
            onChange={(v) => setEnergy({ ...energy, level: v })}
          />
          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              Any context?
            </span>
            <ChipRow
              options={ENERGY_TAGS}
              selected={energy.tags ?? []}
              onChange={(tags) => setEnergy({ ...energy, tags })}
            />
          </div>
        </div>
      )}

      {kind === 'symptom' && (
        <div className="space-y-4">
          <NumberScale
            label="Severity (0 = none, 10 = very severe)"
            max={10}
            value={symptom.severity}
            onChange={(v) => setSymptom({ ...symptom, severity: v })}
          />
          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              What's bothering you?
            </span>
            <ChipRow options={GI_SYMPTOMS} selected={symptomChips} onChange={setSymptomChips} />
            <input
              className="input mt-2"
              placeholder="Something else? Type it here"
              value={symptomText}
              onChange={(e) => setSymptomText(e.target.value)}
            />
          </div>
          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              Body area {symptom.bodyArea ? '' : '(optional)'}
            </span>
            <SingleChipRow
              options={BODY_AREAS}
              selected={symptom.bodyArea}
              onChange={(v) => setSymptom({ ...symptom, bodyArea: v })}
            />
          </div>
          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              How long has it lasted? {symptom.duration ? '' : '(optional)'}
            </span>
            <SingleChipRow
              options={SYMPTOM_DURATIONS}
              selected={symptom.duration}
              onChange={(v) => setSymptom({ ...symptom, duration: v })}
            />
          </div>
          <div>
            <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
              Likely triggers
            </span>
            <ChipRow
              options={SYMPTOM_TRIGGERS}
              selected={symptom.triggers}
              onChange={(triggers) => setSymptom({ ...symptom, triggers })}
            />
          </div>
        </div>
      )}

      {kind === 'bowelMovement' && (
        <div className="space-y-4">
          {/* Live GI burden — computed with the app's exact model as you record. */}
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
            <div>
              <span className="block text-[13px] font-medium text-text-primary">
                GI burden {liveBurden.score}/10
              </span>
              <span className="block text-[11.5px] text-text-muted mt-0.5">
                {liveBurden.hasRedFlags
                  ? 'Red flags floor the score at 8 — they always surface in reports.'
                  : liveBurden.breakdown.map((row) => `${row.label} (${row.amount})`).join(' · ')}
              </span>
            </div>
            <span
              className="text-[20px] font-bold font-display tabular-nums"
              style={{ color: burdenColor(liveBurden.score) }}
            >
              {liveBurden.score}
            </span>
          </div>

          <div className="tab-strip">
            {(['type', 'timing', 'details'] as GutTab[]).map((t) => (
              <button key={t} className={gutTab === t ? 'active' : ''} onClick={() => setGutTab(t)}>
                {t === 'type' ? 'Type' : t === 'timing' ? 'Timing' : 'Details'}
              </button>
            ))}
          </div>

          {gutTab === 'type' && (
            <div className="space-y-4">
              <div>
                <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
                  Bristol type
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {BRISTOL_TYPES.map((t) => {
                    const info = BRISTOL_INFO[t]
                    const on = primaryType === t && !isMixed
                    return (
                      <button
                        key={t}
                        type="button"
                        className={
                          'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ' +
                          (on || (isMixed && segments.some((s) => s.bristolType === t))
                            ? 'border-accent/60 bg-accent/10'
                            : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]')
                        }
                        onClick={() => setPrimaryType(t)}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: info.color, boxShadow: `0 0 8px ${info.color}66` }}
                        />
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-medium text-text-primary">
                            Type {t} — {info.name}
                            {info.isIdeal && (
                              <span className="ml-1.5 rounded-full border border-emerald-400/40 px-1.5 py-px text-[9px] uppercase tracking-wider text-emerald-300">
                                ideal
                              </span>
                            )}
                          </span>
                          <span className="block text-[11.5px] text-text-muted">{info.description}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-text-primary">Mixed episode</span>
                  <span className="text-[11.5px] text-text-muted">
                    {isMixed ? `${segments.length} parts` : 'Single'}
                  </span>
                </div>
                <p className="text-[12px] text-text-muted">
                  Keep it quick with one type, or add phases if the same movement changed form.
                </p>
                {isMixed &&
                  segments.map((segment, index) => (
                    <div key={segment.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase tracking-wider text-text-muted">
                          Phase {index + 1}
                        </span>
                        <button
                          type="button"
                          className="text-[11.5px] text-red-300/80 hover:text-red-300"
                          onClick={() => removeSegment(segment.id)}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="flex gap-1">
                        {BRISTOL_TYPES.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={
                              'flex-1 rounded-md border py-1.5 text-[12px] font-medium transition-colors ' +
                              (segment.bristolType === t
                                ? 'border-accent/60 bg-accent/15 text-text-primary'
                                : 'border-white/10 text-text-secondary hover:bg-white/[0.05]')
                            }
                            style={segment.bristolType === t ? { color: BRISTOL_INFO[t].color } : undefined}
                            onClick={() => updateSegment(segment.id, { bristolType: t })}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        {PORTIONS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={
                              'flex-1 rounded-md border py-1.5 text-[11.5px] transition-colors ' +
                              (segment.portion === p
                                ? 'border-accent/60 bg-accent/15 text-text-primary'
                                : 'border-white/10 text-text-secondary hover:bg-white/[0.05]')
                            }
                            onClick={() => updateSegment(segment.id, { portion: p })}
                          >
                            {PORTION_LABELS[p]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                <button type="button" className="btn btn-secondary text-[12px]" onClick={addSegment}>
                  + Add a phase
                </button>
              </div>
            </div>
          )}

          {gutTab === 'timing' && (
            <GutTimingSection
              minutes={bowelDurationMinutes}
              seconds={bowelDurationSeconds}
              onChange={(m, s) => {
                setBowelDurationMinutes(m)
                setBowelDurationSeconds(s)
              }}
            />
          )}

          {gutTab === 'details' && (
            <div className="space-y-4">
              <div>
                <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
                  Approximate size {bowel.estimatedSize ? '' : '(not recorded)'}
                </span>
                <div className="flex flex-wrap gap-2">
                  {(['small', 'medium', 'large', 'veryLarge'] as BowelMovementSize[]).map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={
                        'btn ' + (bowel.estimatedSize === size ? 'btn-primary' : 'btn-secondary') + ' text-[12px]'
                      }
                      onClick={() =>
                        setBowel({ ...bowel, estimatedSize: bowel.estimatedSize === size ? undefined : size })
                      }
                    >
                      {size === 'veryLarge' ? 'Very large' : size[0].toUpperCase() + size.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
                  Color {bowel.color ? '' : '(not recorded)'}
                </span>
                <div className="flex flex-wrap gap-2">
                  {STOOL_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={
                        'btn ' + (bowel.color === c ? 'btn-primary' : 'btn-secondary') + ' text-[12px] !gap-2'
                      }
                      onClick={() => setBowel({ ...bowel, color: bowel.color === c ? undefined : c })}
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-white/25"
                        style={{ background: STOOL_SWATCH_COLORS[c] }}
                      />
                      {STOOL_COLOR_LABELS[c]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
                  Urgency {bowel.urgency != null ? `— ${URGENCY_LABELS[bowel.urgency]}` : '(not recorded)'}
                </span>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={'btn ' + (bowel.urgency === level ? 'btn-primary' : 'btn-secondary') + ' text-[12px]'}
                      onClick={() => setBowel({ ...bowel, urgency: bowel.urgency === level ? undefined : level })}
                    >
                      {level} · {URGENCY_LABELS[level]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
                  Control {bowel.control ? '' : '(not recorded)'}
                </span>
                <div className="flex flex-wrap gap-2">
                  {CONTROL_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={'btn ' + (bowel.control === c ? 'btn-primary' : 'btn-secondary') + ' text-[12px]'}
                      onClick={() =>
                        setBowel({ ...bowel, control: bowel.control === c ? undefined : (c as BowelControlStatus) })
                      }
                    >
                      {CONTROL_LABELS[c]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
                  How it passed
                </span>
                <ChipRow options={PASSAGE_SYMPTOM_OPTIONS} selected={passage} onChange={setPassage} />
              </div>

              <div>
                <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
                  Cleanup &amp; comfort
                </span>
                <p className="text-text-muted text-[12px] mb-1.5">
                  Bidet, rinsing, wiping burden, and irritation are useful comfort signals.
                </p>
                <ChipRow options={CLEANUP_OPTIONS} selected={cleanup} onChange={setCleanup} />
              </div>

              <div>
                <span className="text-[11px] uppercase tracking-wider block mb-1.5 text-red-300/90">
                  Worth flagging
                </span>
                <p className="text-text-muted text-[12px] mb-1.5">
                  These do not diagnose anything, but they make a clinician summary clearer.
                </p>
                <ChipRow options={RED_FLAG_OPTIONS} selected={redFlags} onChange={setRedFlags} accent="red" />
              </div>

              <div>
                <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
                  How did it feel?
                </span>
                <ChipRow options={FEEL_TAG_OPTIONS} selected={feelTags} onChange={setFeelTags} />
              </div>
            </div>
          )}

          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[13px] text-text-secondary">
            <input
              type="checkbox"
              className="mt-1"
              checked={showInDashboardTimeline}
              onChange={(e) => setShowInDashboardTimeline(e.target.checked)}
            />
            <span>
              <span className="block font-medium text-text-primary">Show on today's timeline</span>
              <span className="block mt-1">
                Off by default for privacy. Gut checks stay available in history and detail views.
              </span>
            </span>
          </label>
        </div>
      )}

      <Field label="Date & time">
        <input
          className="input"
          type="datetime-local"
          value={toDatetimeLocal(date)}
          onChange={(e) => setDate(fromDatetimeLocal(e.target.value))}
        />
      </Field>

      <Field label="Notes (optional)">
        <textarea
          className="input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any other details"
        />
      </Field>

      {error && <div className="error-banner">{error}</div>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : isEditing ? 'Save changes' : kind === 'checkin' ? 'Save check-in' : 'Save entry'}
        </button>
      </div>
    </div>
  )
}

// MARK: - Timing (quick select / exact entry / live timer, mirrors BowelLogView)

function GutTimingSection({
  minutes,
  seconds,
  onChange,
}: {
  minutes: number
  seconds: number
  onChange: (minutes: number, seconds: number) => void
}) {
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerElapsed, setTimerElapsed] = useState(0)
  const timerStartRef = useRef<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  function startTimer() {
    timerStartRef.current = Date.now() - timerElapsed * 1000
    setTimerRunning(true)
    intervalRef.current = setInterval(() => {
      if (timerStartRef.current != null) {
        setTimerElapsed(Math.floor((Date.now() - timerStartRef.current) / 1000))
      }
    }, 500)
  }

  function stopTimer() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setTimerRunning(false)
    const exact =
      timerStartRef.current != null
        ? Math.round((Date.now() - timerStartRef.current) / 1000)
        : timerElapsed
    onChange(Math.floor(exact / 60), exact % 60)
    // Hand the display back to the recorded duration fields.
    setTimerElapsed(0)
    timerStartRef.current = null
  }

  function resetTimer() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setTimerRunning(false)
    setTimerElapsed(0)
    timerStartRef.current = null
  }

  const display = timerRunning ? timerElapsed : minutes * 60 + seconds

  return (
    <div className="space-y-4">
      <div>
        <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
          Quick select
        </span>
        <div className="flex flex-wrap gap-2">
          {DURATION_QUICK_MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              className={
                'btn ' + (minutes === m && seconds === 0 ? 'btn-primary' : 'btn-secondary') + ' text-[12px]'
              }
              onClick={() => onChange(m, 0)}
            >
              {m}m
            </button>
          ))}
          <button type="button" className="btn btn-secondary text-[12px]" onClick={() => onChange(0, 0)}>
            Clear
          </button>
        </div>
      </div>

      <div>
        <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
          Enter time {minutes || seconds ? '' : '(not recorded)'}
        </span>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minutes">
            <input
              className="input"
              type="number"
              min={0}
              max={59}
              inputMode="numeric"
              value={minutes}
              onChange={(e) => onChange(clampDurationPart(e.target.value, 59), seconds)}
            />
          </Field>
          <Field label="Seconds">
            <input
              className="input"
              type="number"
              min={0}
              max={59}
              inputMode="numeric"
              value={seconds}
              onChange={(e) => onChange(minutes, clampDurationPart(e.target.value, 59))}
            />
          </Field>
        </div>
      </div>

      <div>
        <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">
          Use timer
        </span>
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <span className="font-mono text-[24px] tabular-nums text-text-primary min-w-[86px]">
            {formatClock(display)}
          </span>
          <div className="flex gap-2 ml-auto">
            {!timerRunning ? (
              <button type="button" className="btn btn-primary text-[12px]" onClick={startTimer}>
                Start
              </button>
            ) : (
              <button type="button" className="btn btn-primary text-[12px]" onClick={stopTimer}>
                Stop
              </button>
            )}
            <button type="button" className="btn btn-secondary text-[12px]" onClick={resetTimer}>
              Reset
            </button>
          </div>
        </div>
        <p className="text-text-muted text-[12px] mt-1.5">
          Stop the timer to fill the duration automatically.
        </p>
      </div>
    </div>
  )
}

// MARK: - Small shared controls

function ChipRow({
  options,
  selected,
  onChange,
  accent,
}: {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  accent?: 'red'
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const on = selected.includes(opt)
        const cls = on
          ? accent === 'red'
            ? 'border-red-400/60 bg-red-400/15 text-red-200'
            : 'btn-primary'
          : 'btn-secondary'
        return (
          <button
            key={opt}
            type="button"
            className={'btn text-[12px] ' + cls}
            onClick={() =>
              onChange(on ? selected.filter((s) => s !== opt) : [...selected, opt])
            }
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

function SingleChipRow({
  options,
  selected,
  onChange,
}: {
  options: string[]
  selected: string | undefined
  onChange: (next: string | undefined) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={'btn text-[12px] ' + (selected === opt ? 'btn-primary' : 'btn-secondary')}
          onClick={() => onChange(selected === opt ? undefined : opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function NumberScale({
  label,
  max,
  value,
  onChange,
}: {
  label: string
  max: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: max + 1 }, (_, n) => (
          <button
            key={n}
            type="button"
            className={'btn !px-3 !py-1.5 text-[12px] ' + (value === n ? 'btn-primary' : 'btn-secondary')}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

function StressSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-text-muted text-[11px] uppercase tracking-wider">Stress right now</span>
        <span className="text-accent text-[13px] font-semibold tabular-nums">{value}/10</span>
      </div>
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
        aria-label="Stress, 0 to 10"
      />
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-text-muted mt-1">
        <span>Calm</span>
        <span>Tense</span>
      </div>
    </div>
  )
}

function RatingRow({
  label,
  value,
  labels,
  onChange,
}: {
  label: string
  value: number
  labels: string[]
  onChange: (v: number) => void
}) {
  return (
    <div>
      <span className="card-title block mb-2">{label}</span>
      <div className="flex gap-2">
        {labels.map((l, i) => {
          const n = i + 1
          return (
            <button
              key={n}
              type="button"
              className={'btn ' + (value === n ? 'btn-primary' : 'btn-secondary') + ' flex-1'}
              onClick={() => onChange(n)}
            >
              <span className="text-[11px]">{l}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-text-muted text-[11px] uppercase tracking-wider block mb-1.5">{label}</span>
      {children}
    </label>
  )
}

// MARK: - Helpers

/** Mirrors BowelLogView.normalizedBowelSegments(): a single phase is the whole episode. */
function normalizeSegments(segments: BowelSegment[]): BowelSegment[] {
  if (segments.length === 1) {
    return [{ ...segments[0], portion: 'all' }]
  }
  return segments
}

function burdenColor(score: number): string {
  if (score <= 2) return '#51CF66'
  if (score <= 4) return '#FFCE6B'
  if (score <= 7) return '#FFA94D'
  return '#FF6B6B'
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function clampDurationPart(value: string, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(max, Math.max(0, Math.floor(parsed)))
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(s: string): Date {
  return new Date(s)
}

/** Splits an iOS symptom string ("Bloating, Cramping, custom text") back into
 *  known chips + the free-text remainder for editing. */
function parseSymptomString(value: string): { chips: string[]; text: string } {
  if (!value) return { chips: [], text: '' }
  const known = new Set(GI_SYMPTOMS)
  const chips: string[] = []
  const rest: string[] = []
  for (const piece of value.split(', ')) {
    const trimmed = piece.trim()
    if (!trimmed || trimmed === 'General') continue
    if (known.has(trimmed)) {
      if (!chips.includes(trimmed)) chips.push(trimmed)
    } else {
      rest.push(trimmed)
    }
  }
  return { chips, text: rest.join(', ') }
}

function kindLabel(kind: Kind): string {
  switch (kind) {
    case 'checkin':
      return 'Check-in'
    case 'bowelMovement':
      return 'Gut check'
    default:
      return kind[0].toUpperCase() + kind.slice(1)
  }
}

function kindFromEntry(entry: WellnessEntry): WellnessType {
  switch (entry.data.kind) {
    case 'mood':
    case 'energy':
    case 'symptom':
    case 'bowelMovement':
      return entry.data.kind
    default:
      return entry.type
  }
}
