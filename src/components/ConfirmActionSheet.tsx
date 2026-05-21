import { createPortal } from 'react-dom'

type ConfirmActionSheetProps = {
  open: boolean
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmActionSheet({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmActionSheetProps) {
  if (!open) {
    return null
  }

  return createPortal(
    <div className="ledger-receipt-sheet-layer" role="presentation">
      <button
        type="button"
        className="ledger-receipt-sheet-backdrop"
        aria-label={cancelText}
        onClick={onCancel}
        disabled={busy}
      />
      <section
        className="ledger-receipt-sheet confirm-action-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-action-sheet-title"
      >
        <div className="ledger-receipt-review-head">
          <h3 id="confirm-action-sheet-title">{title}</h3>
          <button
            type="button"
            className="ledger-receipt-sheet-close"
            aria-label={cancelText}
            onClick={onCancel}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <p className="muted confirm-action-sheet-description">{description}</p>
        <div className="ledger-receipt-sheet-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button type="button" className="primary-button confirm-action-sheet-danger" onClick={onConfirm} disabled={busy}>
            {busy ? '处理中...' : confirmText}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
