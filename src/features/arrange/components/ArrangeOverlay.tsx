import { ArrowRight, Check, FileCheck2, Ruler, TriangleAlert, Wand2, X } from 'lucide-react'
import { analyzeLayout } from '../../../shared/layoutRules'
import type { DeskItem, WorkspacePlan } from '../../../shared/models'
import type { ArrangeResult, ArrangeSuccess } from '../arrangeViewModel'
import { CanvasStage } from '../../canvas/components/CanvasStage'

interface ArrangeOverlayProps {
  currentPlan: WorkspacePlan
  result: ArrangeResult
  onAdopt: () => void
  onClose: () => void
}

function formatArea(areaMm2: number): string {
  return `${(areaMm2 / 1_000_000).toFixed(2)} m²`
}

function issueCountOf(plan: WorkspacePlan): number {
  const analysis = analyzeLayout(plan)
  return new Set([...analysis.overlapIds, ...analysis.outOfBoundsIds]).size
}

function CompareBoard({ label, plan, issueCount, ghostItems }: {
  label: string
  plan: WorkspacePlan
  issueCount: number
  ghostItems: DeskItem[]
}) {
  return (
    <div className="arrange-board">
      <div className="arrange-board-heading">
        <strong>{label}</strong>
        <span className={`arrange-chip ${issueCount > 0 ? 'chip-attention' : 'chip-clear'}`}>
          {issueCount === 0 ? <FileCheck2 size={12} /> : <TriangleAlert size={12} />}
          {issueCount === 0 ? '不重叠 · 不越界' : `${issueCount} 处重叠 / 越界`}
        </span>
      </div>
      <CanvasStage
        plan={plan}
        selectedItemId={null}
        analysis={analyzeLayout(plan)}
        ghostItems={ghostItems}
        interactive={false}
        showToolbar={false}
        onSelect={() => undefined}
        onMove={() => undefined}
      />
    </div>
  )
}

function ArrangeSuccessView({ currentPlan, result }: { currentPlan: WorkspacePlan; result: ArrangeSuccess }) {
  // 建议画布上用虚线框标出设备原来的位置，一眼看出这一版和现在的差别
  const movedIds = new Set(result.items.filter((item) => item.moved).map((item) => item.id))
  const ghostItems = currentPlan.items.filter((item) => movedIds.has(item.id))
  return (
    <>
      <div className="arrange-summary">
        <Wand2 size={15} />
        <span>{result.message}。右图虚线框标出的是设备当前所在位置，可直接对比差别。</span>
      </div>
      <div className="arrange-compare">
        <CompareBoard label="当前摆放" plan={currentPlan} issueCount={issueCountOf(currentPlan)} ghostItems={[]} />
        <span className="arrange-arrow" aria-hidden="true"><ArrowRight size={22} /></span>
        <CompareBoard label="建议摆放" plan={result.plan} issueCount={0} ghostItems={ghostItems} />
      </div>
    </>
  )
}

function ArrangeFailureView({ result }: { result: Extract<ArrangeResult, { kind: 'failure' }> }) {
  return (
    <div className="arrange-failure">
      <span className="arrange-failure-icon"><TriangleAlert size={26} /></span>
      <h3>放不下这一版</h3>
      <p>{result.message}</p>
      {result.reason === 'item-too-large' && result.oversizedItems.length > 0 && (
        <ul className="arrange-oversized-list">
          {result.oversizedItems.map((item) => (
            <li key={item.id}>
              <span><Ruler size={13} /> {item.label}</span>
              <small>设备外接尺寸 {item.footprintWidth} × {item.footprintHeight} mm</small>
            </li>
          ))}
        </ul>
      )}
      {result.reason === 'cannot-fit' && (
        <p className="arrange-failure-area">
          设备投影总面积 {formatArea(result.totalAreaMm2)}，桌面可用面积 {formatArea(result.usableAreaMm2)}
        </p>
      )}
      <p className="arrange-failure-hint">{result.detail}</p>
    </div>
  )
}

export function ArrangeOverlay({ currentPlan, result, onAdopt, onClose }: ArrangeOverlayProps) {
  const isSuccess = result.kind === 'success'
  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="arrange-title">
      <section className="preview-modal arrange-modal">
        <header className="preview-modal-header">
          <div>
            <span className="eyebrow">ONE-CLICK ARRANGE</span>
            <h2 id="arrange-title">{isSuccess ? '一键整理 · 摆放建议' : '一键整理 · 无法完成'}</h2>
            <p>
              {isSuccess
                ? '建议只是预览，采纳前不会改动当前方案，也不会被保存；采纳后仍可继续手动微调。'
                : '不会强行摆放，当前方案保持不变。'}
            </p>
          </div>
          <button className="close-preview" aria-label="关闭整理预览" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="arrange-body">
          {isSuccess
            ? <ArrangeSuccessView currentPlan={currentPlan} result={result} />
            : <ArrangeFailureView result={result} />}
        </div>
        <footer className="preview-footer arrange-footer">
          {isSuccess ? (
            <>
              <span className="preview-check"><Check size={15} /> 建议摆放通过不越界、不重叠检查</span>
              <span className="arrange-footer-actions">
                <button className="arrange-secondary" onClick={onClose} type="button">再看看，不采纳</button>
                <button className="arrange-primary" onClick={onAdopt} type="button"><Check size={15} /> 采纳建议并继续微调</button>
              </span>
            </>
          ) : (
            <>
              <span className="preview-check arrange-check-warn"><TriangleAlert size={15} /> 没有生成任何摆放改动</span>
              <button className="preview-done" onClick={onClose} type="button">知道了</button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
