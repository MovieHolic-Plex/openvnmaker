import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { readonly children: ReactNode }
interface State { readonly failed: boolean }

/** 렌더 오류가 앱 전체를 흰 화면으로 내리지 않게 잡는다. 플레이어는 자동 저장본으로 복귀할 수 있다. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  override componentDidCatch(error: unknown, info: ErrorInfo): void { console.error("플레이어 렌더 오류", error, info.componentStack); }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="vn-root">
        <section className="fatal-dialog">
          <p className="fatal">화면을 그리는 중 오류가 났습니다. 자동 저장된 위치에서 이어갈 수 있습니다.</p>
          <div className="fatal-actions">
            <button type="button" className="is-primary" onClick={() => window.location.reload()}>이어서 읽기</button>
          </div>
        </section>
      </main>
    );
  }
}
