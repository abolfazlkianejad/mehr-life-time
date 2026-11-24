import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Flame,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  Utensils,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toDateKey } from '@/lib/date-key'
import { formatJalaliDateKey } from '@/lib/jalali'
import {
  deleteMealLog,
  getMealLogs,
  saveMealLog,
  updateMealLog,
  type MealLog,
} from '@/services/db'
import {
  deleteCardioLog,
  getCardioLogs,
  saveCardioLog,
  type CardioLog,
} from '@/services/nutrition'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { HeaderActions } from '@/components/header-actions'
import { JalaliDatePicker } from '@/components/jalali-date-picker'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { isAiConfigured, requestAiJson } from '@/features/ai/client'
import {
  buildMealEstimatePrompt,
  estimateBurnedCalories,
  estimateMealLocally,
  summarizeNutrition,
  type MealEstimate,
} from '@/features/nutrition/nutrition-utils'

const MEAL_KINDS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
type MealKind = (typeof MEAL_KINDS)[number]

export function NutritionPage() {
  const { t } = useTranslation()
  const [date, setDate] = useState(() => toDateKey(new Date()))
  const [meals, setMeals] = useState<MealLog[]>([])
  const [cardio, setCardio] = useState<CardioLog[]>([])
  const [kind, setKind] = useState<MealKind>('breakfast')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [estimate, setEstimate] = useState<MealEstimate | null>(null)
  const [approved, setApproved] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const [activity, setActivity] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [burned, setBurned] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)

  const dayKey = date

  const load = async () => {
    const [savedMeals, savedCardio] = await Promise.all([
      getMealLogs(dayKey),
      getCardioLogs(dayKey),
    ])
    setMeals(savedMeals)
    setCardio(savedCardio)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB loaders update state after an async read
    setLoading(true)
    void load()
      .catch(() => setError(t('nutrition.errors.load')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only depends on the day and the translator
  }, [dayKey, t])

  const summary = useMemo(
    () => summarizeNutrition(meals, cardio),
    [meals, cardio]
  )

  const resetMealForm = () => {
    setDescription('')
    setQuantity('')
    setCalories('')
    setProtein('')
    setCarbs('')
    setFat('')
    setEstimate(null)
    setApproved(false)
  }

  const estimateCalories = async () => {
    setError('')
    setNotice('')
    if (!description.trim()) {
      setError(t('nutrition.errors.foodRequired'))
      return
    }
    setEstimating(true)
    try {
      let result: MealEstimate
      if (isAiConfigured()) {
        try {
          const payload = await requestAiJson<{
            calories?: number
            protein?: number
            carbs?: number
            fat?: number
            food?: string
          }>(buildMealEstimatePrompt(description, quantity))
          const aiCalories = Number(payload.calories)
          if (!Number.isFinite(aiCalories) || aiCalories < 0)
            throw new Error('invalid answer')
          result = {
            calories: Math.round(aiCalories),
            protein: Math.round(Number(payload.protein) || 0),
            carbs: Math.round(Number(payload.carbs) || 0),
            fat: Math.round(Number(payload.fat) || 0),
            source: 'ai',
            ...(payload.food ? { matchedFood: payload.food } : {}),
          }
        } catch {
          result = estimateMealLocally(description, quantity)
          setNotice(t('nutrition.aiFallback'))
        }
      } else {
        result = estimateMealLocally(description, quantity)
        setNotice(t('nutrition.aiUnavailable'))
      }
      setEstimate(result)
      setApproved(false)
      setCalories(String(result.calories))
      setProtein(String(result.protein))
      setCarbs(String(result.carbs))
      setFat(String(result.fat))
    } finally {
      setEstimating(false)
    }
  }

  const saveMeal = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setNotice('')
    const caloriesValue = Number(calories)
    if (
      !description.trim() ||
      !Number.isSafeInteger(caloriesValue) ||
      caloriesValue < 0
    ) {
      setError(t('nutrition.errors.invalid'))
      return
    }
    if (estimate && !approved) {
      setError(t('nutrition.errors.approvalRequired'))
      return
    }
    try {
      const saved = await saveMealLog({
        kind,
        description: description.trim(),
        calories: caloriesValue,
        caloriesConfirmed: true,
        ...(quantity.trim() ? { quantity: quantity.trim() } : {}),
        ...(protein.trim() ? { protein: Number(protein) || 0 } : {}),
        ...(carbs.trim() ? { carbs: Number(carbs) || 0 } : {}),
        ...(fat.trim() ? { fat: Number(fat) || 0 } : {}),
        source: estimate ? estimate.source : 'manual',
        date: dayKey,
      })
      setMeals((all) => [...all, saved])
      resetMealForm()
    } catch {
      setError(t('nutrition.errors.save'))
    }
  }

  const confirmMeal = async (meal: MealLog) => {
    try {
      const updated = await updateMealLog(meal.id, { caloriesConfirmed: true })
      setMeals((all) =>
        all.map((row) => (row.id === updated.id ? updated : row))
      )
    } catch {
      setError(t('nutrition.errors.save'))
    }
  }

  const removeMeal = async (meal: MealLog) => {
    try {
      await deleteMealLog(meal.id)
      setMeals((all) => all.filter((row) => row.id !== meal.id))
    } catch {
      setError(t('nutrition.errors.save'))
    }
  }

  const addCardio = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const minutesValue = Number(minutes)
    if (
      !activity.trim() ||
      !Number.isInteger(minutesValue) ||
      minutesValue < 1
    ) {
      setError(t('nutrition.errors.invalidActivity'))
      return
    }
    const estimated = estimateBurnedCalories(activity, minutesValue, 70)
    const caloriesValue = burned.trim() ? Number(burned) : estimated
    if (!Number.isSafeInteger(caloriesValue) || caloriesValue < 0) {
      setError(t('nutrition.errors.invalidActivity'))
      return
    }
    try {
      const saved = await saveCardioLog({
        activity: activity.trim(),
        minutes: minutesValue,
        calories: caloriesValue,
        caloriesEstimated: !burned.trim(),
        date: dayKey,
      })
      setCardio((all) => [...all, saved])
      setActivity('')
      setMinutes('30')
      setBurned('')
    } catch {
      setError(t('nutrition.errors.save'))
    }
  }

  const removeCardio = async (session: CardioLog) => {
    try {
      await deleteCardioLog(session.id)
      setCardio((all) => all.filter((row) => row.id !== session.id))
    } catch {
      setError(t('nutrition.errors.save'))
    }
  }

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div>
          <h2 className='text-2xl font-bold'>{t('nutrition.title')}</h2>
          <p className='text-muted-foreground'>{t('nutrition.subtitle')}</p>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm font-medium'>{t('nutrition.date')}</span>
          <JalaliDatePicker
            value={dayKey}
            onChange={(next) => setDate(next)}
            ariaLabel={t('nutrition.date')}
            className='w-44'
          />
        </div>

        {error ? (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {notice}
          </p>
        ) : null}

        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          <Card>
            <CardHeader className='pb-2'>
              <CardDescription>{t('nutrition.summary.intake')}</CardDescription>
            </CardHeader>
            <CardContent className='text-2xl font-semibold tabular-nums'>
              {summary.intake} kcal
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='pb-2'>
              <CardDescription>{t('nutrition.summary.burned')}</CardDescription>
            </CardHeader>
            <CardContent className='text-2xl font-semibold tabular-nums'>
              {summary.burned} kcal
              {summary.hasEstimatedBurn ? (
                <span className='ms-2 text-xs font-normal text-muted-foreground'>
                  {t('nutrition.summary.estimated')}
                </span>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='pb-2'>
              <CardDescription>{t('nutrition.summary.net')}</CardDescription>
            </CardHeader>
            <CardContent className='text-2xl font-semibold tabular-nums'>
              {summary.net} kcal
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='pb-2'>
              <CardDescription>{t('nutrition.summary.macros')}</CardDescription>
            </CardHeader>
            <CardContent className='text-sm font-semibold tabular-nums'>
              {t('nutrition.macros.protein')}: {summary.protein}g ·{' '}
              {t('nutrition.macros.carbs')}: {summary.carbs}g ·{' '}
              {t('nutrition.macros.fat')}: {summary.fat}g
            </CardContent>
          </Card>
        </div>

        {summary.pendingEstimates > 0 ? (
          <p className='rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm'>
            {t('nutrition.summary.pending', {
              count: summary.pendingEstimates,
            })}
          </p>
        ) : null}

        <div className='grid gap-4 xl:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Utensils className='size-5' />
                {t('nutrition.mealTitle')}
              </CardTitle>
              <CardDescription>{t('nutrition.mealHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className='grid gap-3 md:grid-cols-2'
                onSubmit={(event) => void saveMeal(event)}
              >
                <select
                  aria-label={t('nutrition.mealKind')}
                  className='h-9 rounded-md border bg-background px-3 text-sm'
                  value={kind}
                  onChange={(event) => setKind(event.target.value as MealKind)}
                >
                  {MEAL_KINDS.map((item) => (
                    <option key={item} value={item}>
                      {t(`nutrition.kinds.${item}`)}
                    </option>
                  ))}
                </select>
                <Input
                  required
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value)
                    setEstimate(null)
                    setApproved(false)
                  }}
                  placeholder={t('nutrition.foodPlaceholder')}
                />
                <Input
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value)
                    setEstimate(null)
                    setApproved(false)
                  }}
                  placeholder={t('nutrition.quantityPlaceholder')}
                />
                <div className='flex items-center gap-2'>
                  <Button
                    type='button'
                    variant='outline'
                    disabled={estimating}
                    onClick={() => void estimateCalories()}
                  >
                    {estimating ? (
                      <LoaderCircle className='me-2 size-4 animate-spin' />
                    ) : (
                      <Sparkles className='me-2 size-4' />
                    )}
                    {t('nutrition.estimate')}
                  </Button>
                  {estimate ? (
                    <Badge variant='secondary'>
                      {estimate.source === 'ai'
                        ? t('nutrition.source.ai')
                        : t('nutrition.source.local')}
                    </Badge>
                  ) : null}
                </div>
                <Input
                  type='number'
                  min='0'
                  aria-label={t('nutrition.calories')}
                  value={calories}
                  onChange={(event) => setCalories(event.target.value)}
                  placeholder={t('nutrition.calories')}
                />
                <Input
                  type='number'
                  min='0'
                  aria-label={t('nutrition.macros.protein')}
                  value={protein}
                  onChange={(event) => setProtein(event.target.value)}
                  placeholder={t('nutrition.macros.protein')}
                />
                <Input
                  type='number'
                  min='0'
                  aria-label={t('nutrition.macros.carbs')}
                  value={carbs}
                  onChange={(event) => setCarbs(event.target.value)}
                  placeholder={t('nutrition.macros.carbs')}
                />
                <Input
                  type='number'
                  min='0'
                  aria-label={t('nutrition.macros.fat')}
                  value={fat}
                  onChange={(event) => setFat(event.target.value)}
                  placeholder={t('nutrition.macros.fat')}
                />
                {estimate ? (
                  <label className='flex items-center gap-2 text-sm md:col-span-2'>
                    <Checkbox
                      checked={approved}
                      onCheckedChange={(checked) =>
                        setApproved(checked === true)
                      }
                    />
                    {t('nutrition.approve')}
                  </label>
                ) : null}
                <div className='flex gap-2 md:col-span-2'>
                  <Button type='submit'>
                    <Plus className='me-2 size-4' />
                    {t('nutrition.saveMeal')}
                  </Button>
                  <Button type='button' variant='ghost' onClick={resetMealForm}>
                    {t('nutrition.reset')}
                  </Button>
                </div>
              </form>
              <p className='mt-3 text-xs text-muted-foreground'>
                {t('nutrition.approvalHint')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Flame className='size-5' />
                {t('nutrition.activityTitle')}
              </CardTitle>
              <CardDescription>{t('nutrition.activityHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <form
                className='grid gap-2 sm:grid-cols-[1fr_110px_140px_auto]'
                onSubmit={(event) => void addCardio(event)}
              >
                <Input
                  required
                  value={activity}
                  onChange={(event) => setActivity(event.target.value)}
                  placeholder={t('nutrition.activityPlaceholder')}
                />
                <Input
                  type='number'
                  min='1'
                  aria-label={t('nutrition.minutes')}
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
                <Input
                  type='number'
                  min='0'
                  aria-label={t('nutrition.burned')}
                  value={burned}
                  onChange={(event) => setBurned(event.target.value)}
                  placeholder={t('nutrition.burned')}
                />
                <Button type='submit'>{t('nutrition.addActivity')}</Button>
              </form>
              <p className='text-xs text-muted-foreground'>
                {t('nutrition.activityFormula')}
              </p>
              <div className='space-y-2'>
                {cardio.length ? (
                  cardio.map((session) => (
                    <div
                      key={session.id}
                      className='flex items-center justify-between gap-2 border-b py-2 text-sm'
                    >
                      <span>
                        {session.activity} · {session.minutes}{' '}
                        {t('nutrition.minutes')} · {session.calories} kcal
                        {session.caloriesEstimated ? (
                          <span className='ms-2 text-xs text-muted-foreground'>
                            {t('nutrition.summary.estimated')}
                          </span>
                        ) : null}
                      </span>
                      <Button
                        size='icon'
                        variant='ghost'
                        aria-label={t('nutrition.deleteActivity')}
                        onClick={() => void removeCardio(session)}
                      >
                        <Trash2 className='size-4' />
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t('nutrition.noActivity')}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('nutrition.mealsOfDay')}</CardTitle>
            <CardDescription>{formatJalaliDateKey(dayKey)}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            {loading ? (
              <p role='status' className='text-sm text-muted-foreground'>
                {t('nutrition.loading')}
              </p>
            ) : meals.length ? (
              meals.map((meal) => (
                <div
                  key={meal.id}
                  className='flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm'
                >
                  <div>
                    <span className='font-medium'>{meal.description}</span>
                    {meal.quantity ? (
                      <span className='ms-2 text-xs text-muted-foreground'>
                        {meal.quantity}
                      </span>
                    ) : null}
                    <span className='ms-2 text-xs text-muted-foreground'>
                      {t(`nutrition.kinds.${meal.kind}`)} · {meal.calories} kcal
                    </span>
                  </div>
                  <div className='flex items-center gap-2'>
                    {meal.caloriesConfirmed === false ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => void confirmMeal(meal)}
                      >
                        {t('nutrition.confirm')}
                      </Button>
                    ) : (
                      <Badge variant='secondary'>
                        {t('nutrition.confirmed')}
                      </Badge>
                    )}
                    <Button
                      size='icon'
                      variant='ghost'
                      aria-label={t('nutrition.deleteMeal')}
                      onClick={() => void removeMeal(meal)}
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('nutrition.noMeals')}
              </p>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
