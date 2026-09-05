const paths = {
  spark: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z M20 2v4m-2-2h4",
  play: "m8 5 11 7-11 7V5Z",
  plus: "M12 5v14M5 12h14",
  scenes: "M4 4h16v16H4zM4 9h16M9 9v11",
  graph: "M3 3h6v5H3zM15 16h6v5h-6zM3 16h6v5H3zM6 8v4h12v4M6 12v4",
  image: "M3 4h18v16H3zM3 16l5-5 5 5 3-3 5 5M15 8h.01",
  users: "M15 21v-3a5 5 0 0 0-10 0v3M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M19 15a4 4 0 0 1 3 4v2",
  undo: "M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12",
  redo: "m15 4 5 5-5 5M20 9H10a6 6 0 0 0 0 12",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  chevron: "m9 5 7 7-7 7",
  left: "m15 5-7 7 7 7",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  search: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 6 6",
  music: "M9 18V5l11-2v13M9 7l11-2M9 18c0 4-7 4-7 0s7-4 7 0ZM20 16c0 4-7 4-7 0s7-4 7 0Z",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  file: "M14 2H4v20h16V8l-6-6v6h6M8 13h8M8 17h5",
  warning: "m12 3 10 18H2L12 3ZM12 9v5m0 3v.1",
  stop: "M5 5h14v14H5z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2",
  home: "M3 11 12 3l9 8M5 9v12h14V9M9 21v-7h6v7",
  expand: "M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6",
  layers: "m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
