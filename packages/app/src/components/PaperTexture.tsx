/** 종이 결. 외부 이미지 없이 SVG 필터로만 만든다. */
export function PaperTexture() {
  return (
    <svg className="paper-defs" aria-hidden="true" focusable="false">
      <filter id="paper-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" seed="7" result="noise" />
        <feColorMatrix in="noise" type="saturate" values="0" />
      </filter>
      <filter id="edge-wobble">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="19" result="w" />
        <feDisplacementMap in="SourceGraphic" in2="w" scale="7" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
