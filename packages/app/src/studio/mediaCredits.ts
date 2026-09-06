import type { VnScript } from "@vnmaker/content";

export function mediaCredits(script: VnScript, paths: readonly string[]) {
  const registered = [...(script.assets ?? []), ...(script.audioAssets ?? [])];
  const files = [...new Set(paths)].sort().map(path => {
    const records = registered.filter(asset => asset.url === path).map(asset => ({ id: asset.id, name: asset.name, ...asset.provenance }));
    return { path, status: records.length > 0 && records.every(record => record.creator?.trim() && record.source?.trim() && record.license?.trim()) ? "recorded" : "needs-record", records };
  });
  const scope = "Author-supplied media records. Recorded does not mean rights verified. Software licenses are listed separately.";
  return {
    files,
    json: JSON.stringify({ version: 1, title: script.title, scope, files }, null, 2),
    text: `${script.title} — 소재 출처와 크레딧\n\n입력한 정보를 그대로 옮긴 목록입니다. ‘기록됨’은 이용 권한 검증을 뜻하지 않습니다. 소프트웨어 라이선스는 별도 고지를 확인하세요.\n\n${files.map(file => `${file.path} · ${file.status === "recorded" ? "기록됨" : "기록 필요"}\n${file.records.map(record => `${record.name}\n제작자: ${record.creator || "미기록"}\n출처: ${record.source || "미기록"}\n이용 조건: ${record.license || "미기록"}\n크레딧: ${record.credit || "미기록"}`).join("\n\n")}`).join("\n\n---\n\n")}\n`,
  };
}
