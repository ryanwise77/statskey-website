import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchFriendSocial, useFriendships, isConnected, type FriendSocial } from '../lib/data/useFriends'
import { useFriendMeals, useFriendToday, useFriendWorkouts } from '../lib/data/useFriendDetail'
import { mealDisplayName, mealTotal } from '../lib/aggregates'
import { WorkoutCard } from '../components/WorkoutCard'
import { EmptyState } from '../components/EmptyState'
import { NUTRIENT_KEYS, type Meal } from '../lib/types'

export function FriendDetail() {
  const { user } = useAuth()
  const { uid: friendUid } = useParams<{ uid: string }>()
  const { friendships, loading: fLoading } = useFriendships(user?.uid)
  const [social, setSocial] = useState<FriendSocial | null>(null)

  const isFriend = friendships.some(
    (f) => isConnected(f) && f.users.includes(friendUid ?? '') && f.users.includes(user?.uid ?? '')
  )

  const meals = useFriendMeals(isFriend ? friendUid : undefined, 15)
  const workouts = useFriendWorkouts(isFriend ? friendUid : undefined, 8)
  const today = useFriendToday(isFriend ? friendUid : undefined)

  useEffect(() => {
    if (!friendUid) return
    let cancelled = false
    fetchFriendSocial(friendUid).then((s) => {
      if (!cancelled) setSocial(s)
    })
    return () => {
      cancelled = true
    }
  }, [friendUid])

  const name = social?.displayName || social?.username || social?.email || friendUid?.slice(0, 8).toUpperCase() || 'Friend'

  if (!fLoading && !isFriend) {
    return (
      <div className="panel">
        <p className="text-text-secondary text-[14px]">
          You can only view profiles of accepted friends.
        </p>
        <Link to="/friends" className="link text-[13px] mt-3 inline-block">← Back to friends</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[760px]">
      <header>
        <Link to="/friends" className="text-text-muted hover:text-text-primary text-[12px]">← Friends</Link>
        <div className="flex items-center justify-between gap-3 mt-1">
          <div>
            <h1 className="font-display text-[26px] font-bold tracking-[-0.02em]">{name}</h1>
            {social?.username && <p className="text-text-secondary text-[13px] mt-0.5">@{social.username}</p>}
          </div>
          <Link to={`/messages/${friendUid}`} className="btn btn-secondary text-[12px] !py-1.5 !px-3">
            Message
          </Link>
        </div>
      </header>

      {(today.health.health || (today.water.water?.amount ?? 0) > 0) && (
        <section className="panel">
          <span className="card-title">Today</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-center">
            {today.health.health && (
              <>
                <Stat label="Steps" value={today.health.health.steps.toLocaleString()} />
                <Stat label="Active cal" value={Math.round(today.health.health.activeCalories)} />
                <Stat label="Exercise" value={`${today.health.health.exerciseMinutes}m`} />
              </>
            )}
            {(today.water.water?.amount ?? 0) > 0 && (
              <Stat label="Water" value={`${Math.round(today.water.water!.amount)} oz`} />
            )}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="card-title">Recent workouts</h2>
        {workouts.loading ? (
          <div className="panel"><p className="text-text-muted text-[13px]">Loading…</p></div>
        ) : workouts.workouts.length === 0 ? (
          <div className="panel"><EmptyState title="No workouts shared yet" /></div>
        ) : (
          workouts.workouts.map((w) => <WorkoutCard key={w.id} workout={w} />)
        )}
      </section>

      <section className="panel">
        <h2 className="card-title mb-2">Recent meals</h2>
        {meals.loading ? (
          <p className="text-text-muted text-[13px]">Loading…</p>
        ) : meals.error ? (
          <div className="error-banner">{meals.error}</div>
        ) : meals.meals.length === 0 ? (
          <EmptyState title="No meals shared yet" />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {meals.meals.map((m) => (
              <FriendMealRow key={m.id} meal={m} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function FriendMealRow({ meal }: { meal: Meal }) {
  const cal = Math.round(
    meal.totalNutrientsOverride?.[NUTRIENT_KEYS.calories] ?? mealTotal(meal, NUTRIENT_KEYS.calories)
  )
  const protein = Math.round(
    meal.totalNutrientsOverride?.[NUTRIENT_KEYS.protein] ?? mealTotal(meal, NUTRIENT_KEYS.protein)
  )
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] text-text-primary">{mealDisplayName(meal)}</div>
          <div className="card-subtext mt-0.5">
            {meal.date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {(meal.hiddenItemCount ?? 0) > 0 &&
              ` · ${meal.hiddenItemCount} item${meal.hiddenItemCount === 1 ? '' : 's'} hidden`}
          </div>
        </div>
        <div className="text-right card-subtext whitespace-nowrap">
          {cal > 0 && <div className="text-text-primary">{cal} cal</div>}
          {protein > 0 && <div>{protein}g protein</div>}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="card-subtext">{label}</div>
      <div className="card-number card-number-md mt-1">{value}</div>
    </div>
  )
}
