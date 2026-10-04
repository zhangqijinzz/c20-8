import { analyzeLayout, getItemBounds, rectanglesOverlap } from '../../shared/layoutRules'
import { getDeviceDefinition, type DeskItem, type WorkspacePlan } from '../../shared/models'

/** 建议布局与桌面边缘之间预留的走线缓冲。 */
export const ARRANGE_MARGIN_MM = 40
/** 紧凑模式下使用的最小边距，常规边距放不下时再退化到这一档。 */
const ARRANGE_TIGHT_MARGIN_MM = 12
const ARRANGE_GAP_MM = 24
const ARRANGE_TIGHT_GAP_MM = 10

export type ArrangeFailureReason = 'oversized' | 'no-space'

export interface ArrangeFailure {
  ok: false
  reason: ArrangeFailureReason
  message: string
  oversizedItemIds: string[]
}

export interface ItemMove {
  itemId: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  moved: boolean
}

export interface ArrangeSuccess {
  ok: true
  plan: WorkspacePlan
  moves: ItemMove[]
  movedCount: number
}

export type ArrangeSuggestion = ArrangeSuccess | ArrangeFailure

interface PackRect {
  id: string
  width: number
  height: number
}

interface PackAttempt {
  positions: Map<string, { x: number; y: number }>
  packedWidth: number
  packedHeight: number
  placedCount: number
}

interface ShelfRecord {
  start: number
  cursor: number
  thickness: number
}

const EPSILON = 1e-6

/**
 * 沿一条轴排设备、沿另一条轴换“层”的货架装箱：
 * 设备沿 along 轴依次摆放，当前层塞不下就沿 cross 轴新开一层（FFD 思路）。
 * direction = 'rows' 时沿 X 排、向 Y 换层；'columns' 反之。
 * 任何一件放不下都会返回 null，并带上当时已放下的数量。
 */
function packShelves(
  rects: PackRect[],
  alongCap: number,
  crossCap: number,
  gap: number,
  direction: 'rows' | 'columns',
): PackAttempt | null {
  const shelves: ShelfRecord[] = []
  const canonical = new Map<string, { along: number; cross: number }>()

  for (const rect of rects) {
    const alongSize = direction === 'rows' ? rect.width : rect.height
    const crossSize = direction === 'rows' ? rect.height : rect.width
    let placed = false

    for (const shelf of shelves) {
      if (crossSize > shelf.thickness + EPSILON) continue
      const start = shelf.cursor === 0 ? 0 : shelf.cursor
      if (start + alongSize <= alongCap + EPSILON) {
        canonical.set(rect.id, { along: start, cross: shelf.start })
        shelf.cursor = start + alongSize + gap
        shelf.thickness = Math.max(shelf.thickness, crossSize)
        placed = true
        break
      }
    }

    if (placed) continue

    const crossStart = shelves.reduce((total, shelf) => total + shelf.thickness, 0) + shelves.length * gap
    if (crossStart + crossSize > crossCap + EPSILON) {
      return null
    }
    shelves.push({ start: crossStart, cursor: alongSize + gap, thickness: crossSize })
    canonical.set(rect.id, { along: 0, cross: crossStart })
  }

  const positions = new Map<string, { x: number; y: number }>()
  for (const rect of rects) {
    const point = canonical.get(rect.id)
    if (!point) continue
    positions.set(rect.id, direction === 'rows'
      ? { x: point.along, y: point.cross }
      : { x: point.cross, y: point.along })
  }
  const packedWidth = direction === 'rows'
    ? Math.max(0, ...shelves.map((shelf) => shelf.cursor - gap))
    : shelves.reduce((total, shelf) => total + shelf.thickness, 0) + Math.max(0, shelves.length - 1) * gap
  const packedHeight = direction === 'rows'
    ? shelves.reduce((total, shelf) => total + shelf.thickness, 0) + Math.max(0, shelves.length - 1) * gap
    : Math.max(0, ...shelves.map((shelf) => shelf.cursor - gap))
  return { positions, packedWidth, packedHeight, placedCount: canonical.size }
}

function orderedCopies(rects: PackRect[]): PackRect[][] {
  const byHeight = [...rects].sort((a, b) => b.height - a.height || b.width - a.width)
  const byWidth = [...rects].sort((a, b) => b.width - a.width || b.height - a.height)
  const byArea = [...rects].sort((a, b) => b.width * b.height - a.width * a.height)
  return [byHeight, byWidth, byArea, rects]
}

/** 用现有的规则复核一遍：不越界、不重叠才算数，避免任何硬塞。 */
function verifySuggestion(plan: WorkspacePlan): boolean {
  const analysis = analyzeLayout(plan)
  if (analysis.overlapIds.length > 0 || analysis.outOfBoundsIds.length > 0) return false
  const boundsById = new Map(plan.items.map((item) => [item.id, getItemBounds(item)]))
  for (let index = 0; index < plan.items.length; index += 1) {
    for (let next = index + 1; next < plan.items.length; next += 1) {
      const first = boundsById.get(plan.items[index].id)
      const second = boundsById.get(plan.items[next].id)
      if (first && second && rectanglesOverlap(first, second)) return false
    }
  }
  return true
}

function buildSuccess(plan: WorkspacePlan, items: DeskItem[]): ArrangeSuccess {
  const nextPlan: WorkspacePlan = { ...plan, items }
  const moves: ItemMove[] = items.map((item) => {
    const previous = plan.items.find((candidate) => candidate.id === item.id)
    const toX = Math.round(item.x)
    const toY = Math.round(item.y)
    const fromX = Math.round(previous?.x ?? item.x)
    const fromY = Math.round(previous?.y ?? item.y)
    return { itemId: item.id, fromX, fromY, toX, toY, moved: fromX !== toX || fromY !== toY }
  })
  return { ok: true, plan: nextPlan, moves, movedCount: moves.filter((move) => move.moved).length }
}

function buildOversizedFailure(plan: WorkspacePlan, oversizedItemIds: string[]): ArrangeFailure {
  const labels = [...new Set(oversizedItemIds.map((id) => {
    const item = plan.items.find((candidate) => candidate.id === id)
    return item ? getDeviceDefinition(item.type).label : '设备'
  }))]
  const nameList = labels.join('、')
  return {
    ok: false,
    reason: 'oversized',
    message: `放不下：${nameList}本身就比 ${plan.deskWidthMm} × ${plan.deskHeightMm} mm 的桌面还大，怎么排都会越界。请调小设备尺寸，或加大桌面。`,
    oversizedItemIds,
  }
}

function buildNoSpaceFailure(plan: WorkspacePlan, placedCount: number, total: number): ArrangeFailure {
  const occupiedArea = plan.items.reduce((sum, item) => sum + item.widthMm * item.heightMm, 0)
  const deskArea = plan.deskWidthMm * plan.deskHeightMm
  const coverage = Math.round((occupiedArea / deskArea) * 100)
  return {
    ok: false,
    reason: 'no-space',
    message: `${plan.deskWidthMm} × ${plan.deskHeightMm} mm 的桌面放不下全部设备：当前最多只能排下 ${placedCount} / ${total} 件（设备占地约为桌面的 ${coverage}%）。请减少设备、调小尺寸或加大桌面，不要硬塞。`,
    oversizedItemIds: [],
  }
}

/**
 * 根据桌面尺寸和已放下的设备，算一版不越界、不重叠的摆放建议。
 * 只调整 x / y，保留设备尺寸、旋转角度与 id；入参不会被修改。
 * 放不下时返回 ok:false 并如实说明原因，而不是返回带冲突的结果。
 */
export function buildArrangeSuggestion(plan: WorkspacePlan): ArrangeSuggestion {
  if (plan.items.length === 0) {
    return { ok: true, plan: { ...plan, items: [] }, moves: [], movedCount: 0 }
  }

  // 旋转后设备的外接轴对齐矩形才是真正占地方的轮廓，装箱按外接矩形来算。
  const rects: PackRect[] = plan.items.map((item) => {
    const bounds = getItemBounds(item)
    return { id: item.id, width: bounds.width, height: bounds.height }
  })

  const hardOversized = plan.items
    .filter((item) => {
      const rect = rects.find((candidate) => candidate.id === item.id)
      return !!rect && (rect.width > plan.deskWidthMm + EPSILON || rect.height > plan.deskHeightMm + EPSILON)
    })
    .map((item) => item.id)
  if (hardOversized.length > 0) return buildOversizedFailure(plan, hardOversized)

  const presets = [
    { margin: ARRANGE_MARGIN_MM, gap: ARRANGE_GAP_MM },
    { margin: ARRANGE_TIGHT_MARGIN_MM, gap: ARRANGE_TIGHT_GAP_MM },
  ]
  let bestPlacedCount = 0

  for (const { margin, gap } of presets) {
    const usableWidth = plan.deskWidthMm - margin * 2
    const usableHeight = plan.deskHeightMm - margin * 2
    const candidates: PackAttempt[] = []

    for (const orderedRects of orderedCopies(rects)) {
      for (const direction of ['rows', 'columns'] as const) {
        const alongCap = direction === 'rows' ? usableWidth : usableHeight
        const crossCap = direction === 'rows' ? usableHeight : usableWidth
        const attempt = packShelves(orderedRects, alongCap, crossCap, gap, direction)
        if (attempt) {
          candidates.push(attempt)
        } else {
          bestPlacedCount = Math.max(bestPlacedCount, orderedRects.length - 1)
        }
      }
    }

    const fitting = candidates
      .filter((attempt) => attempt.packedWidth <= usableWidth + EPSILON && attempt.packedHeight <= usableHeight + EPSILON)
      .sort((a, b) => {
        const scoreA = Math.max(a.packedWidth / usableWidth, a.packedHeight / usableHeight)
        const scoreB = Math.max(b.packedWidth / usableWidth, b.packedHeight / usableHeight)
        return scoreA - scoreB || a.packedWidth * a.packedHeight - b.packedWidth * b.packedHeight
      })

    for (const candidate of fitting) {
      const offsetX = margin + (usableWidth - candidate.packedWidth) / 2
      const offsetY = margin + (usableHeight - candidate.packedHeight) / 2
      const nextItems = plan.items.map((item) => {
        const rect = rects.find((candidateRect) => candidateRect.id === item.id)
        const point = candidate.positions.get(item.id)
        if (!rect || !point) return item
        const left = offsetX + point.x
        const top = offsetY + point.y
        // 装箱坐标是外接矩形左上角，换算回设备自身未旋转时的左上角（旋转中心不变）。
        return {
          ...item,
          x: Math.round(left + (rect.width - item.widthMm) / 2),
          y: Math.round(top + (rect.height - item.heightMm) / 2),
        }
      })
      const candidatePlan: WorkspacePlan = { ...plan, items: nextItems }
      if (verifySuggestion(candidatePlan)) {
        return buildSuccess(plan, nextItems)
      }
    }
  }

  return buildNoSpaceFailure(plan, bestPlacedCount, plan.items.length)
}
