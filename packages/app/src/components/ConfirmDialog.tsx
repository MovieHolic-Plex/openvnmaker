import { useEffect, useRef } from "react";

interface Props {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly testId: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** 취소 가능한 확인 창. Esc·배경 클릭은 취소다. 열리면 취소 버튼에 포커스를 두어 실수로 확정되지 않게 한다. */
export function ConfirmDialog({ title, message, confirmLabel, testId, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    cancelButton.current?.focus();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return (
    <dialog ref={dialog} className="panel confirm-dialog" aria-label={title} data-testid={testId} onCancel={event => { event.preventDefault(); onCancel(); }} onClick={event => event.stopPropagation()}>
      <header><h3>{title}</h3></header>
      <p className="confirm-message">{message}</p>
      <div className="confirm-actions">
        <button ref={cancelButton} type="button" data-testid={`${testId}-cancel`} onClick={onCancel}>계속 읽기</button>
        <button type="button" className="is-primary" data-testid={`${testId}-confirm`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
