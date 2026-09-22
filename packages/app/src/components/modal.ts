/** <dialog>.showModal() 을 안전하게 연다 — 미지원·이미 open 상태면 open 속성으로 물러난다. */
export function openModal(node: HTMLDialogElement | null): void {
  if (!node) return;
  if (typeof node.showModal === "function") {
    try {
      node.showModal();
      return;
    } catch { /* 이미 모달로 열려 있거나 지원하지 않는 상태 */ }
  }
  node.setAttribute("open", "");
}
