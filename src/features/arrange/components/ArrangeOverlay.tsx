import { ArrowRight, Check, TriangleAlert, Wand2, X } from 'lucide-react'
import { getDeviceDefinition, type WorkspacePlan } from '../../../shared/models'
import { analyzeLayout } from '../../../shared/layoutRules'
import { CanvasStage } from '../../canvas/components/CanvasStage'
import type { ArrangeFailure, ItemMove } from '../arrangeViewModel'

interface ArrangeOverlayProps {
  currentPlan: WorkspacePlan
  suggestion: WorkspacePlan
  moves: ItemMove[]
  movedCount: number
  onCancel: () => void
  onAccept: () => void
}

interface ArrangeFailureOverlayProps {
  plan: WorkspacePlan
  failure: ArrangeFailure
  onClose: () => void
}

const clearAnalysis = { overlapIds: [], outOfBoundsIds: [], coveragePercent: 0, status: 'clear' as const }

export function ArrangeOverlay({ currentPlan, suggestion, moves, movedCount, onCancel, onAccept }: ArrangeOverlayProps) {
  const currentAnalysis = analyzeLayout(currentPlan)
  const issueCount = new Set([...currentAnalysis.overlapIds, ...currentAnalysis.outOfBoundsIds]).size
  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="arrange-title">
      <section className="preview-modal arrange-modal">
        <header className="preview-modal-header">
          <div>
            <span className="eyebrow">AUTO ARRANGE / 预览不会改动方案</span>
            <h2 id="arrange-title">一键整理 · 摆放建议</h2>
            <p>{currentPlan.deskWidthMm} × {currentPlan.deskHeightMm} mm · {suggestion.items.length} 件设备 · 建议中有 {movedCount} 件需要挪动</p>
          </div>
          <button className="close-preview" aria-label="关闭预览" onClick={onCancel} type="button"><X size={18} /></button>
        </header>
        <div className="arrange-compare">
          <figure className="arrange-pane">
            <figcaption>
              <span className="arrange-pane-tag tag-current">现在</span>
              <strong>{issueCount === 0 ? '当前布局' : `${issueCount} 处越界 / 重叠`}</strong>
            </figcaption>
            <CanvasStage plan={currentPlan} selectedItemId={null} analysis={currentAnalysis} onSelect={() => undefined} onMove={() => undefined} interactive={false} />
          </figure>
          <span className="arrange-arrow" aria-hidden="true"><ArrowRight size={20} /></span>
          <figure className="arrange-pane">
            <figcaption>
              <span className="arrange-pane-tag tag-suggested"><Check size={11} /> 建议</span>
              <strong>不越界、不重叠</strong>
            </figcaption>
            <CanvasStage plan={suggestion} selectedItemId={null} analysis={clearAnalysis} onSelect={() => undefined} onMove={() => undefined} interactive={false} ghostPlan={currentPlan} />
          </figure>
        </div>
        <div className="arrange-changes">
          <div className="arrange-changes-head"><span className="eyebrow">变化明细</span><span>虚线框 = 当前位置，实线 = 建议位置；仅位置会变，尺寸与角度保留</span></div>
          <ul className="arrange-change-list">
            {moves.map((move) => {
              const item = suggestion.items.find((candidate) => candidate.id === move.itemId)
              if (!item) return null
              const definition = getDeviceDefinition(item.type)
              return (
                <li className={move.moved ? 'has-moved' : ''} key={move.itemId}>
                  <span className="change-swatch" style={{ backgroundColor: definition.color }} />
                  <strong>{definition.label}</strong>
                  {move.moved
                    ? <span className="change-coords">({move.fromX}, {move.fromY}) <ArrowRight size={11} /> ({move.toX}, {move.toY})</span>
                    : <span className="change-coords change-kept">位置不变</span>}
                </li>
              )
            })}
          </ul>
        </div>
        <footer className="preview-footer arrange-footer">
          <span className="preview-check arrange-note"><Wand2 size={15} /> 仅为预览：不采纳就不会改动方案，也不会产生保存记录；采纳后仍可继续手动微调。</span>
          <div className="arrange-actions">
            <button className="preview-done arrange-cancel" onClick={onCancel} type="button">再看看</button>
            <button className="preview-done arrange-accept" onClick={onAccept} type="button"><Check size={15} /> 采纳这一版</button>
          </div>
        </footer>
      </section>
    </div>
  )
}

export function ArrangeFailureOverlay({ plan, failure, onClose }: ArrangeFailureOverlayProps) {
  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="arrange-fail-title">
      <section className="preview-modal arrange-fail-modal">
        <header className="preview-modal-header">
          <div>
            <span className="eyebrow">AUTO ARRANGE</span>
            <h2 id="arrange-fail-title" className="arrange-fail-title"><TriangleAlert size={22} /> 这版桌面放不下</h2>
          </div>
          <button className="close-preview" aria-label="关闭" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="arrange-fail-body">
          <p>{failure.message}</p>
          <small>桌面 {plan.deskWidthMm} × {plan.deskHeightMm} mm · 已放置 {plan.items.length} 件</small>
          <ul>
            <li>移除几件设备，或在右侧调小设备尺寸</li>
            <li>在“尺寸检查”里加大桌面宽 / 深</li>
            <li>调整后可以再次尝试一键整理</li>
          </ul>
        </div>
        <footer className="preview-footer">
          <span />
          <button className="preview-done" onClick={onClose} type="button">返回手动调整</button>
        </footer>
      </section>
    </div>
  )
}
