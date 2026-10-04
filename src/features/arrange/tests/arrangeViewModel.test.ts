import { describe, expect, it } from 'vitest'
import { createItem, createPlan } from '../../../shared/models'
import { analyzeLayout } from '../../../shared/layoutRules'
import { ARRANGE_MARGIN_MM, buildArrangeSuggestion } from '../arrangeViewModel'

function emptyPlan(widthMm = 1600, heightMm = 800) {
  return { ...createPlan('test', false), deskWidthMm: widthMm, deskHeightMm: heightMm }
}

function planWith(items: ReturnType<typeof createItem>[], widthMm = 1600, heightMm = 800) {
  return { ...emptyPlan(widthMm, heightMm), items }
}

describe('arrange suggestion engine', () => {
  it('keeps every fitted item inside the desk without overlaps', () => {
    const items = [
      { ...createItem('monitor', 0), x: -120, y: 760 },
      { ...createItem('keyboard', 1), x: 560, y: 120 },
      { ...createItem('lamp', 2), x: 540, y: 110 },
      { ...createItem('speaker', 3), x: 520, y: 100 },
      { ...createItem('stand', 4), x: 900, y: 300 },
    ]
    const plan = planWith(items)
    const result = buildArrangeSuggestion(plan)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const analysis = analyzeLayout(result.plan)
    expect(analysis.overlapIds).toHaveLength(0)
    expect(analysis.outOfBoundsIds).toHaveLength(0)
    expect(result.movedCount).toBe(items.length)
  })

  it('respects the edge margin and centers the packed block', () => {
    const items = [{ ...createItem('speaker'), x: 1000, y: 600 }]
    const result = buildArrangeSuggestion(planWith(items, 600, 500))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const only = result.plan.items[0]
    expect(only.x).toBeGreaterThanOrEqual(ARRANGE_MARGIN_MM - 1)
    expect(only.y).toBeGreaterThanOrEqual(ARRANGE_MARGIN_MM - 1)
    expect(only.x + only.widthMm).toBeLessThanOrEqual(600 - ARRANGE_MARGIN_MM + 1)
    expect(only.y + only.heightMm).toBeLessThanOrEqual(500 - ARRANGE_MARGIN_MM + 1)
  })

  it('reports oversized devices honestly instead of squeezing them in', () => {
    const huge = { ...createItem('monitor'), x: 0, y: 0, widthMm: 1800, heightMm: 300 }
    const result = buildArrangeSuggestion(planWith([huge], 1600, 800))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('oversized')
    expect(result.oversizedItemIds).toEqual([huge.id])
    expect(result.message).toContain('放不下')
  })

  it('reports no-space when the desk cannot hold everything', () => {
    const items = [
      { ...createItem('monitor'), x: 0, y: 0, widthMm: 540, heightMm: 210 },
      { ...createItem('monitor'), x: 0, y: 0, widthMm: 540, heightMm: 210 },
      { ...createItem('keyboard'), x: 0, y: 0, widthMm: 440, heightMm: 150 },
      { ...createItem('stand'), x: 0, y: 0, widthMm: 500, heightMm: 500 },
    ]
    const result = buildArrangeSuggestion(planWith(items, 600, 600))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no-space')
    expect(result.message).toContain('600')
  })

  it('preserves rotation, dimensions and ids while only changing positions', () => {
    const rotated = { ...createItem('monitor'), x: 40, y: 40, rotation: 90 }
    const result = buildArrangeSuggestion(planWith([rotated], 800, 600))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const moved = result.plan.items[0]
    expect(moved.id).toBe(rotated.id)
    expect(moved.rotation).toBe(90)
    expect(moved.widthMm).toBe(rotated.widthMm)
    expect(moved.heightMm).toBe(rotated.heightMm)
    const analysis = analyzeLayout(result.plan)
    expect(analysis.status).toBe('clear')
  })

  it('does not mutate the source plan', () => {
    const item = { ...createItem('lamp'), x: 900, y: 700 }
    const plan = planWith([item])
    const snapshot = JSON.parse(JSON.stringify(plan)) as typeof plan
    const result = buildArrangeSuggestion(plan)
    expect(result.ok).toBe(true)
    expect(plan).toEqual(snapshot)
  })

  it('is deterministic and succeeds for an empty desk', () => {
    const items = [
      { ...createItem('monitor'), x: 0, y: 0 },
      { ...createItem('keyboard'), x: 10, y: 10 },
      { ...createItem('lamp'), x: 50, y: 50 },
    ]
    const plan = planWith(items)
    const first = buildArrangeSuggestion(plan)
    const second = buildArrangeSuggestion(plan)
    expect(first).toEqual(second)
    const empty = buildArrangeSuggestion(planWith([]))
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.moves).toHaveLength(0)
  })
})
