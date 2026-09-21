import { useMemo } from "react";
import type { WeatherEffect } from "@vnmaker/content";

/** 입자 수 — 비는 빽빽하게, 벚꽃은 성기게. */
const PARTICLES: Record<WeatherEffect, number> = { rain: 64, snow: 44, petals: 18, embers: 26, dust: 30 };

/** 입자마다 결정적인 난수 — 리렌더해도 위치가 흔들리지 않는다. */
function rand(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * 장면 위에 얹는 입자 연출. DOM 한 겹 + CSS 애니메이션만 쓴다 — 캔버스·JS 프레임 루프 없이
 * 저전력 기기에서도 프레임을 안 먹는다. 껐다 켜도 같은 입자 배치로 돌아온다.
 */
export function Weather({ effect }: { readonly effect: WeatherEffect }) {
  const particles = useMemo(() => {
    const count = PARTICLES[effect];
    return Array.from({ length: count }, (_, index) => ({
      left: `${(rand(index, 1) * 104 - 2).toFixed(2)}%`,
      // 먼지는 떨어지지 않고 공중에 떠 있으므로 세로 위치도 입자마다 다르게 흩뿌린다.
      top: effect === "dust" ? `${(rand(index, 7) * 92).toFixed(2)}%` : undefined,
      delay: `${(-rand(index, 2) * 14).toFixed(2)}s`,
      duration: `${(rand(index, 3) * (effect === "rain" ? 0.7 : effect === "embers" ? 5 : 8) + (effect === "rain" ? 0.55 : effect === "snow" ? 6 : effect === "petals" ? 9 : effect === "embers" ? 4 : 10)).toFixed(2)}s`,
      size: `${(rand(index, 4) * (effect === "petals" ? 9 : 5) + (effect === "petals" ? 6 : effect === "snow" ? 3 : 2)).toFixed(1)}px`,
      drift: `${((rand(index, 5) - 0.5) * (effect === "rain" ? 6 : 34)).toFixed(1)}vw`,
      alpha: (0.35 + rand(index, 6) * 0.5).toFixed(2),
    }));
  }, [effect]);
  return (
    <div className={`weather weather-${effect}`} aria-hidden="true">
      {particles.map((particle, index) => (
        <i
          key={index}
          style={{
            left: particle.left,
            ...(particle.top !== undefined ? { top: particle.top } : {}),
            animationDelay: particle.delay,
            animationDuration: particle.duration,
            width: particle.size,
            height: effect === "rain" ? `calc(${particle.size} * 9)` : particle.size,
            opacity: particle.alpha,
            ["--drift" as string]: particle.drift,
          }}
        />
      ))}
    </div>
  );
}
