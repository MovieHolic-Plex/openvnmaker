import type { MediaProvenance } from "@vnmaker/content";
import "./media-provenance.css";

export function MediaProvenanceEditor({ value, onChange }: { value?: MediaProvenance | undefined; onChange: (value: MediaProvenance) => void }) {
  const fields = { creator: "제작자", source: "출처·구매 내역", license: "이용 조건·라이선스", credit: "크레딧 표기문" } as const;
  return <details className="media-provenance"><summary>출처와 크레딧 {value?.creator?.trim() && value?.source?.trim() && value?.license?.trim() ? "· 기록됨" : "· 기록 필요"}</summary>
    <p>배포 파일에 함께 실리는 정보입니다. 계정 정보나 비공개 구매 키를 입력하지 마세요. 기록 여부는 이용 권한 확인 결과가 아닙니다.</p>
    <p>웹·네이티브 게임의 크레딧 화면에는 제작자, 이용 조건, 크레딧 표기문이 표시됩니다. 출처·구매 내역은 배포 문서와 원고 JSON에 포함됩니다.</p>
    {Object.entries(fields).map(([key, label]) => <label key={key}>{label}<textarea aria-label={label} rows={2} maxLength={4000} value={value?.[key as keyof MediaProvenance] ?? ""} onChange={event => onChange({ ...value, [key]: event.target.value })} /></label>)}
  </details>;
}
