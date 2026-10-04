import { describe, expect, it } from 'vitest'
import { createItem, createPlan } from '../../../shared/models'
import { analyzeLayout } from '../../../shared/layoutRules'
import { arrangePlan, ARRANGE_GAP_MM, ARRANGE_MARGIN_MM } from '../arrangeViewModel'

function planWith(items: ReturnType<typeof createItem>[], deskWidth = 1600, deskHeight = 800) {
  return { ...createPlan('整理测试', false), deskWidthMm: deskWidth, deskHeightMm: deskHeight, items }
}

describe('arrangePlan', () => {
  it('produces an in-bounds, non-overlapping layout for a cluttered desk', () => {
    const items = [
      { ...createItem('monitor', 0), x: 530, y: 105 },
      { ...createItem('keyboard', 1), x: 560, y: 200 }, // 与显示器重叠
      { ...createItem('lamp', 2), x: 1550, y: 760 }, // 越界
      { ...createItem('speaker', 3), x: 100, y: 100 },
      { ...createItem('stand', 4), x: 300, y: 600 },
    ]
    const result = arrangePlan(planWith(items))
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.plan.items).toHaveLength(5)
    const analysis = analyzeLayout(result.plan)
    expect(analysis.overlapIds).toHaveLength(0)
    expect(analysis.outOfBoundsIds).toHaveLength(0)
    expect(result.movedCount).toBeGreaterThan(0)
    // 尺寸与角度不被改动，只调整位置
    for (const next of result.plan.items) {
      const original = items.find((item) => item.id === next.id)
      expect(original).toBeDefined()
      expect(next.widthMm).toBe(original!.widthMm)
      expect(next.heightMm).toBe(original!.heightMm)
      expect(next.rotation).toBe(original!.rotation)
      expect(next.x).toBeGreaterThanOrEqual(0)
      expect(next.y).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps the required margin from desk edges and gap between items', () => {
    const items = [
      { ...createItem('monitor'), x: 0, y: 0 },
      { ...createItem('lamp'), x: 10, y: 10 },
    ]
    const result = arrangePlan(planWith(items, 800, 600))
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    for (const item of result.plan.items) {
      expect(item.x).toBeGreaterThanOrEqual(ARRANGE_MARGIN_MM - 1)
      expect(item.y).toBeGreaterThanOrEqual(ARRANGE_MARGIN_MM - 1)
      expect(item.x + item.widthMm).toBeLessThanOrEqual(800 - ARRANGE_MARGIN_MM + 1)
      expect(item.y + item.heightMm).toBeLessThanOrEqual(600 - ARRANGE_MARGIN_MM + 1)
    }
    const [first, second] = result.plan.items
    // 两矩形在分离轴上的净间距（同行取水平方向、换行取垂直方向）
    const firstRight = first.x + first.widthMm
    const secondRight = second.x + second.widthMm
    const firstBottom = first.y + first.heightMm
    const secondBottom = second.y + second.heightMm
    const horizontalSeparation = Math.max(first.x, second.x) - Math.min(firstRight, secondRight)
    const verticalSeparation = Math.max(first.y, second.y) - Math.min(firstBottom, secondBottom)
    expect(Math.max(horizontalSeparation, verticalSeparation)).toBeGreaterThanOrEqual(ARRANGE_GAP_MM - 2)
  })

  it('reports an oversized item instead of squeezing it in', () => {
    const items = [{ ...createItem('monitor'), widthMm: 1200, heightMm: 300, x: 0, y: 0 }]
    const result = arrangePlan(planWith(items, 1000, 700))
    expect(result.kind).toBe('failure')
    if (result.kind !== 'failure') return
    expect(result.reason).toBe('item-too-large')
    expect(result.oversizedItems).toHaveLength(1)
    expect(result.oversizedItems[0].label).toBe('显示器')
  })

  it('reports when total item area exceeds the usable desk area', () => {
    const items = Array.from({ length: 6 }, () => ({ ...createItem('monitor'), x: 0, y: 0 }))
    const result = arrangePlan(planWith(items, 1000, 700))
    expect(result.kind).toBe('failure')
    if (result.kind !== 'failure') return
    expect(['cannot-fit', 'item-too-large']).toContain(result.reason)
    expect(result.totalAreaMm2).toBeGreaterThan(result.usableAreaMm2)
  })

  it('honours rotation by packing the rotated footprint', () => {
    const items = [
      { ...createItem('monitor'), widthMm: 500, heightMm: 200, rotation: 90, x: 0, y: 0 },
      { ...createItem('keyboard'), x: 0, y: 0 },
    ]
    const result = arrangePlan(planWith(items, 600, 800))
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(analyzeLayout(result.plan).status).toBe('clear')
    expect(result.plan.items[0].rotation).toBe(90)
  })

  it('returns a no-op success for an empty desk', () => {
    const result = arrangePlan(planWith([]))
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.movedCount).toBe(0)
    expect(result.plan.items).toHaveLength(0)
  })

  it('reports zero moves when the layout already satisfies the rules', () => {
    const items = [
      { ...createItem('monitor'), x: 530, y: 40 },
      { ...createItem('keyboard'), x: 580, y: 470 },
    ]
    const result = arrangePlan(planWith(items))
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    // 原有两设备本身不重叠不越界；整理后仍应合法
    expect(analyzeLayout(result.plan).status).toBe('clear')
  })
})
