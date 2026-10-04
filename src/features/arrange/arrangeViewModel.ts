import { analyzeLayout, getItemBounds } from '../../shared/layoutRules'
import { getDeviceDefinition, type DeskItem, type WorkspacePlan } from '../../shared/models'

/** 一键整理时设备与桌面边缘保留的安全边距（mm） */
export const ARRANGE_MARGIN_MM = 20
/** 一键整理时设备之间的最小间距（mm） */
export const ARRANGE_GAP_MM = 24
/** 判定设备位置是否被挪动的阈值（mm，中心点位移） */
const MOVE_EPSILON_MM = 1

export interface ArrangedItem {
  id: string
  x: number
  y: number
  moved: boolean
}

export interface OversizedItem {
  id: string
  label: string
  footprintWidth: number
  footprintHeight: number
}

export type ArrangeFailureReason = 'desk-too-small' | 'item-too-large' | 'cannot-fit'

export interface ArrangeSuccess {
  kind: 'success'
  sourcePlanId: string
  plan: WorkspacePlan
  items: ArrangedItem[]
  movedCount: number
  message: string
}

export interface ArrangeFailure {
  kind: 'failure'
  sourcePlanId: string
  reason: ArrangeFailureReason
  message: string
  detail: string
  oversizedItems: OversizedItem[]
  itemCount: number
  totalAreaMm2: number
  usableAreaMm2: number
}

export type ArrangeResult = ArrangeSuccess | ArrangeFailure

interface Footprint {
  item: DeskItem
  width: number
  height: number
}

interface Placement {
  item: DeskItem
  x: number
  y: number
}

/** 设备在当前旋转角度下的外接矩形（摆放只平移、不改角度与尺寸） */
function getFootprint(item: DeskItem): Footprint {
  const bounds = getItemBounds(item)
  return { item, width: bounds.width, height: bounds.height }
}

function itemLabel(item: DeskItem): string {
  return getDeviceDefinition(item.type).label
}

function formatArea(areaMm2: number): string {
  return `${(areaMm2 / 1_000_000).toFixed(2)} m²`
}

/**
 * 按固定行高的货架装箱：设备逐行从左向右排列，放不下就换行。
 * 整体水平居中、顶部对齐。放不下（超宽或超高）时返回 null。
 */
function shelfPack(
  footprints: Footprint[],
  usableWidth: number,
  usableHeight: number,
  margin: number,
  gap: number,
  round: boolean,
): Placement[] | null {
  if (footprints.some((footprint) => footprint.width > usableWidth + 0.01 || footprint.height > usableHeight + 0.01)) {
    return null
  }

  interface Row { footprints: Footprint[]; width: number; height: number }
  const rows: Row[] = []
  let current: Row = { footprints: [], width: 0, height: 0 }

  for (const footprint of footprints) {
    const extra = current.footprints.length === 0 ? 0 : gap
    if (current.width + extra + footprint.width > usableWidth + 0.01 && current.footprints.length > 0) {
      rows.push(current)
      current = { footprints: [], width: 0, height: 0 }
    }
    const addGap = current.footprints.length === 0 ? 0 : gap
    current.footprints.push(footprint)
    current.width += addGap + footprint.width
    current.height = Math.max(current.height, footprint.height)
  }
  if (current.footprints.length > 0) rows.push(current)

  const totalGap = gap * (rows.length - 1)
  const contentHeight = rows.reduce((sum, row) => sum + row.height, totalGap)
  if (contentHeight > usableHeight + 0.01) return null

  const placements: Placement[] = []
  let cursorY = margin
  for (const row of rows) {
    const startX = margin + Math.max(0, (usableWidth - row.width) / 2)
    let cursorX = startX
    for (const { item, width, height } of row.footprints) {
      const x = cursorX + width / 2 - item.widthMm / 2
      const y = cursorY + height / 2 - item.heightMm / 2
      placements.push({ item, x: round ? Math.round(x) : x, y: round ? Math.round(y) : y })
      cursorX += width + gap
    }
    cursorY += row.height + gap
  }
  return placements
}

function buildPlan(plan: WorkspacePlan, placements: Placement[]): WorkspacePlan {
  const positions = new Map(placements.map((placement) => [placement.item.id, placement]))
  return {
    ...plan,
    items: plan.items.map((item) => {
      const placement = positions.get(item.id)
      return placement ? { ...item, x: placement.x, y: placement.y } : item
    }),
  }
}

function centerDistance(first: DeskItem, second: DeskItem): number {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

/**
 * 根据当前桌面尺寸和已放置设备，生成一版不越界、互不重叠的摆放建议。
 * 建议只包含新的 x / y，设备尺寸与旋转角度保持不变。
 * 任何无法容纳的情况都返回 failure，绝不硬塞。
 */
export function arrangePlan(
  plan: WorkspacePlan,
  options: { margin?: number; gap?: number } = {},
): ArrangeResult {
  const margin = options.margin ?? ARRANGE_MARGIN_MM
  const gap = options.gap ?? ARRANGE_GAP_MM
  const usableWidth = plan.deskWidthMm - margin * 2
  const usableHeight = plan.deskHeightMm - margin * 2
  const usableArea = Math.max(0, usableWidth * usableHeight)

  const failureBase = { sourcePlanId: plan.id, itemCount: plan.items.length, totalAreaMm2: 0, usableAreaMm2: Math.round(usableArea) }

  if (plan.items.length === 0) {
    return {
      kind: 'success',
      sourcePlanId: plan.id,
      plan,
      items: [],
      movedCount: 0,
      message: '当前桌面还没有设备，无需整理',
    }
  }

  if (usableWidth <= 0 || usableHeight <= 0) {
    return {
      ...failureBase,
      kind: 'failure',
      reason: 'desk-too-small',
      message: `桌面只有 ${plan.deskWidthMm} × ${plan.deskHeightMm} mm，扣除 ${margin} mm 边距后已没有可用空间`,
      detail: '先在右侧把桌面宽深调大，再尝试一键整理。',
      oversizedItems: [],
    }
  }

  const footprints = plan.items.map(getFootprint)
  const totalArea = footprints.reduce((sum, footprint) => sum + footprint.width * footprint.height, 0)
  failureBase.totalAreaMm2 = Math.round(totalArea)

  const oversizedItems: OversizedItem[] = []
  for (const footprint of footprints) {
    if (footprint.width > usableWidth + 0.01 || footprint.height > usableHeight + 0.01) {
      oversizedItems.push({
        id: footprint.item.id,
        label: itemLabel(footprint.item),
        footprintWidth: Math.round(footprint.width),
        footprintHeight: Math.round(footprint.height),
      })
    }
  }
  if (oversizedItems.length > 0) {
    return {
      ...failureBase,
      kind: 'failure',
      reason: 'item-too-large',
      message: `有 ${oversizedItems.length} 件设备本身就比桌面可用区域（${Math.round(usableWidth)} × ${Math.round(usableHeight)} mm）还大`,
      detail: '设备无法旋转或缩小来适配，请先更换更小的设备或调大桌面。',
      oversizedItems,
    }
  }

  if (totalArea > usableArea + 0.01) {
    return {
      ...failureBase,
      kind: 'failure',
      reason: 'cannot-fit',
      message: `设备投影总面积 ${formatArea(totalArea)} 已超过桌面可用面积 ${formatArea(usableArea)}，怎么排都放不下`,
      detail: '可以减少设备数量，或调大桌面尺寸后再试。',
      oversizedItems: [],
    }
  }

  const orderings: Footprint[][] = [
    footprints,
    [...footprints].sort((a, b) => b.height - a.height),
    [...footprints].sort((a, b) => b.width - a.width),
    [...footprints].sort((a, b) => b.width * b.height - a.width * a.height),
  ]

  interface Candidate { plan: WorkspacePlan; movement: number; packedHeight: number }
  const candidates: Candidate[] = []
  for (const ordering of orderings) {
    // 先用整数坐标尝试；若取整后出现重叠/越界，再退回精确坐标
    for (const round of [true, false] as const) {
      const placements = shelfPack(ordering, usableWidth, usableHeight, margin, gap, round)
      if (!placements) continue
      const candidatePlan = buildPlan(plan, placements)
      const analysis = analyzeLayout(candidatePlan)
      if (analysis.status !== 'clear') continue
      const nextById = new Map(candidatePlan.items.map((item) => [item.id, item]))
      const movement = plan.items.reduce((sum, item) => {
        const next = nextById.get(item.id)
        return next ? sum + centerDistance(item, next) : sum
      }, 0)
      const packedHeight = candidatePlan.items.reduce(
        (max, item) => Math.max(max, getItemBounds(item).bottom),
        0,
      )
      candidates.push({ plan: candidatePlan, movement, packedHeight })
      break
    }
  }

  if (candidates.length === 0) {
    return {
      ...failureBase,
      kind: 'failure',
      reason: 'cannot-fit',
      message: `现有 ${plan.items.length} 件设备无法在 ${plan.deskWidthMm} × ${plan.deskHeightMm} mm 的桌面上做到不越界、互不重叠`,
      detail: '可以减少设备数量，或调大桌面尺寸后再试。',
      oversizedItems: [],
    }
  }

  candidates.sort((a, b) => (a.movement - b.movement) || (a.packedHeight - b.packedHeight))
  const best = candidates[0].plan
  const items: ArrangedItem[] = best.items.map((item) => {
    const original = plan.items.find((current) => current.id === item.id)
    const moved = original ? centerDistance(original, item) > MOVE_EPSILON_MM : false
    return { id: item.id, x: item.x, y: item.y, moved }
  })
  const movedCount = items.filter((item) => item.moved).length

  return {
    kind: 'success',
    sourcePlanId: plan.id,
    plan: best,
    items,
    movedCount,
    message: movedCount === 0
      ? '当前布局已经很舒展，没有需要挪动的设备'
      : `一键整理建议已生成，${movedCount} 件设备会挪动位置`,
  }
}
