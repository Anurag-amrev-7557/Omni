import React, { useEffect, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { OrbStyle } from '../../types/theme';

interface OrbitingOrbLoaderProps {
  style?: OrbStyle;
  text?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

// Convert CSS color (hex / rgb / rgba) to rgba with custom alpha
function formatRgba(colorStr: string, alpha: number): string {
  const c = colorStr.trim();
  if (c.startsWith('#')) {
    let hex = c.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(x => x + x).join('');
    }
    const num = parseInt(hex, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (c.startsWith('rgb(')) {
    return c.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  if (c.startsWith('rgba(')) {
    return c.replace(/[\d.]+\)$/, `${alpha})`);
  }
  return c;
}

export const OrbitingOrbLoader: React.FC<OrbitingOrbLoaderProps> = ({
  style: propStyle,
  size = 'md',
  className = '',
}) => {
  const { theme, currentConfig, orbStyle: contextOrbStyle } = useTheme();
  const activeStyle: OrbStyle = propStyle || contextOrbStyle || 'vortex';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const canvasPx = size === 'sm' ? 28 : size === 'lg' ? 56 : size === 'xl' ? 76 : 40;
  const sphereRadius = canvasPx * (
    activeStyle === 'bands' ? 0.40 :
    activeStyle === 'geodesic' ? 0.38 :
    activeStyle === 'aurora' ? 0.42 : 0.41
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Retina 2x/3x DPI Scaling
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasPx * dpr;
    canvas.height = canvasPx * dpr;
    ctx.scale(dpr, dpr);

    let animationFrameId: number;
    let time = 0;
    let angleY = 0;

    const tiltX = 0.42;
    const tiltZ = 0.22;
    const cosTiltX = Math.cos(tiltX);
    const sinTiltX = Math.sin(tiltX);
    const cosTiltZ = Math.cos(tiltZ);
    const sinTiltZ = Math.sin(tiltZ);

    const centerX = canvasPx / 2;
    const centerY = canvasPx / 2;

    const themeTextColor = currentConfig?.previewColors?.text || '#27272a';
    const themeAccentColor = currentConfig?.previewColors?.accent || '#da7756';

    // =========================================================================
    // 1. COUNTER-ROTATING STRATA (3D SPHERICAL RINGS IN ALTERNATING ORBIT)
    // =========================================================================
    if (activeStyle === 'bands') {
      const numRows = 9;
      const rowElements: Array<{
        rowIndex: number;
        y0: number;
        ringRadius: number;
        direction: number;
        currentAngle: number;
        beads: Array<{ theta0: number; sizeMod: number; isAccent: boolean }>;
      }> = [];

      for (let j = 0; j < numRows; j++) {
        const y0 = 0.92 - (j / (numRows - 1)) * 1.84;
        const ringRadius = Math.sqrt(Math.max(0.02, 1 - y0 * y0));
        const direction = j % 2 === 0 ? 1 : -1;
        const count = Math.max(5, Math.round(4 + ringRadius * 10));
        const beads: Array<{ theta0: number; sizeMod: number; isAccent: boolean }> = [];

        for (let k = 0; k < count; k++) {
          beads.push({
            theta0: (k / count) * Math.PI * 2,
            sizeMod: 0.88 + Math.random() * 0.24,
            isAccent: (k + j) % 3 === 0,
          });
        }

        rowElements.push({
          rowIndex: j,
          y0,
          ringRadius,
          direction,
          currentAngle: 0,
          beads,
        });
      }

      const minDotRadius = size === 'sm' ? 0.25 : size === 'lg' ? 0.45 : size === 'xl' ? 0.60 : 0.32;
      const maxDotRadius = size === 'sm' ? 0.95 : size === 'lg' ? 1.65 : size === 'xl' ? 2.20 : 1.25;

      const renderBands = () => {
        ctx.clearRect(0, 0, canvasPx, canvasPx);

        const projectedBeads: Array<{
          projX: number;
          projY: number;
          zNorm: number;
          sizeMod: number;
          color: string;
        }> = [];

        for (const row of rowElements) {
          row.currentAngle += 0.022 * row.direction;

          for (const bead of row.beads) {
            const theta = bead.theta0 + row.currentAngle;
            const x = row.ringRadius * Math.cos(theta);
            const z = row.ringRadius * Math.sin(theta);
            const y = row.y0;

            const y2 = y * cosTiltX - z * sinTiltX;
            const z2 = y * sinTiltX + z * cosTiltX;

            const beadColor = bead.isAccent && z2 > 0 ? themeAccentColor : themeTextColor;

            projectedBeads.push({
              projX: centerX + x * sphereRadius,
              projY: centerY - y2 * sphereRadius,
              zNorm: z2,
              sizeMod: bead.sizeMod,
              color: beadColor,
            });
          }
        }

        projectedBeads.sort((a, b) => a.zNorm - b.zNorm);

        for (const bead of projectedBeads) {
          const k = Math.max(0, Math.min(1, (bead.zNorm + 1) / 2));
          const dotRadius = (minDotRadius + (maxDotRadius - minDotRadius) * Math.pow(k, 1.8)) * bead.sizeMod;
          const alpha = 0.14 + 0.84 * Math.pow(k, 1.3);

          ctx.save();
          ctx.beginPath();
          ctx.arc(bead.projX, bead.projY, dotRadius, 0, Math.PI * 2);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = bead.color;
          ctx.fill();
          ctx.restore();
        }

        animationFrameId = requestAnimationFrame(renderBands);
      };

      renderBands();
    }

    // =========================================================================
    // 2. RESTORED 3D CELESTIAL LOGARITHMIC VORTEX SIMULATION (VORTEX & VORTEX-PURE)
    // =========================================================================
    else if (activeStyle === 'vortex' || activeStyle === 'vortex-pure') {
      const isChromatic = activeStyle === 'vortex';
      const numParticles = size === 'sm' ? 72 : size === 'xl' ? 148 : 100;
      const numStreams = 8;
      const particles: Array<{
        streamId: number;
        tOffset: number;
        baseSpeed: number;
        sheath: 'outer' | 'inner';
        rScale: number;
        sizeCategory: 'micro' | 'medium' | 'large';
        baseRadius: number;
        phase: number;
      }> = [];

      for (let i = 0; i < numParticles; i++) {
        const streamId = i % numStreams;
        const tOffset = Math.random();
        const sheath = i % 3 === 0 ? 'inner' : 'outer';
        const rScale = sheath === 'inner' ? (0.72 + Math.random() * 0.10) : (0.90 + Math.random() * 0.10);
        const baseSpeed = 0.0035 + Math.random() * 0.0025;

        const randType = Math.random();
        let sizeCategory: 'micro' | 'medium' | 'large' = 'micro';
        let baseRadius = 0.32;

        if (randType > 0.84) {
          sizeCategory = 'large';
          baseRadius = (size === 'sm' ? 0.95 : size === 'xl' ? 1.95 : 1.30) + Math.random() * 0.2;
        } else if (randType > 0.64) {
          sizeCategory = 'medium';
          baseRadius = (size === 'sm' ? 0.58 : size === 'xl' ? 1.15 : 0.78) + Math.random() * 0.15;
        } else {
          sizeCategory = 'micro';
          baseRadius = (size === 'sm' ? 0.25 : size === 'xl' ? 0.48 : 0.32) + Math.random() * 0.10;
        }

        particles.push({
          streamId,
          tOffset,
          baseSpeed,
          sheath,
          rScale,
          sizeCategory,
          baseRadius,
          phase: Math.random() * Math.PI * 2,
        });
      }

      const renderVortex = () => {
        ctx.clearRect(0, 0, canvasPx, canvasPx);
        time += 0.022;

        const projected: Array<{
          projX: number;
          projY: number;
          zNorm: number;
          baseRadius: number;
          sizeCategory: 'micro' | 'medium' | 'large';
          color: string;
          hasTrail: boolean;
          trailPoints: Array<{ x: number; y: number }>;
        }> = [];

        for (let i = 0; i < numParticles; i++) {
          const p = particles[i];

          const u = Math.sin(p.tOffset * Math.PI * 2);
          const phi = Math.acos(Math.max(-0.96, Math.min(0.96, u)));
          const sinPhi = Math.sin(phi);
          const cosPhi = Math.cos(phi);

          const accel = 1.0 + 0.7 * Math.pow(Math.abs(cosPhi), 1.6);
          p.tOffset = (p.tOffset + p.baseSpeed * accel) % 1.0;

          const streamBaseAngle = p.streamId * (Math.PI * 2 / numStreams);
          const theta = streamBaseAngle + (p.tOffset * Math.PI * 3.6) + (time * 0.55);

          const r = sphereRadius * p.rScale;
          const x = r * sinPhi * Math.cos(theta);
          const z = r * sinPhi * Math.sin(theta);
          const y = r * cosPhi;

          const y2 = y * cosTiltX - z * sinTiltX;
          const z2 = y * sinTiltX + z * cosTiltX;

          const x3 = x * cosTiltZ - y2 * sinTiltZ;
          const y3 = x * sinTiltZ + y2 * cosTiltZ;

          const zNorm = z2 / sphereRadius;

          const hasTrail = p.sizeCategory === 'large' && zNorm > 0.4;
          const trailPoints: Array<{ x: number; y: number }> = [];

          if (hasTrail) {
            for (const offset of [0.012, 0.024]) {
              const prevT = (p.tOffset - offset + 1.0) % 1.0;
              const prevU = Math.sin(prevT * Math.PI * 2);
              const prevPhi = Math.acos(Math.max(-0.96, Math.min(0.96, prevU)));
              const prevTheta = streamBaseAngle + (prevT * Math.PI * 3.6) + (time * 0.55);

              const px = r * Math.sin(prevPhi) * Math.cos(prevTheta);
              const pz = r * Math.sin(prevPhi) * Math.sin(prevTheta);
              const py = r * Math.cos(prevPhi);

              const py2 = py * cosTiltX - pz * sinTiltX;
              const px3 = px * cosTiltZ - py2 * sinTiltZ;
              const py3 = px * sinTiltZ + py2 * cosTiltZ;

              trailPoints.push({
                x: centerX + px3,
                y: centerY + py3,
              });
            }
          }

          let pointColor = themeTextColor;
          if (isChromatic && (p.sizeCategory === 'medium' || p.sheath === 'inner') && zNorm > 0.1) {
            pointColor = themeAccentColor;
          }

          projected.push({
            projX: centerX + x3,
            projY: centerY + y3,
            zNorm,
            baseRadius: p.baseRadius,
            sizeCategory: p.sizeCategory,
            color: pointColor,
            hasTrail,
            trailPoints,
          });
        }

        projected.sort((a, b) => a.zNorm - b.zNorm);

        for (let i = 0; i < projected.length; i++) {
          const p = projected[i];
          const k = Math.max(0, Math.min(1, (p.zNorm + 1) / 2));

          let dotRadius = p.baseRadius;
          if (p.sizeCategory === 'large') {
            dotRadius = p.baseRadius * (0.55 + 0.65 * Math.pow(k, 1.4));
          } else if (p.sizeCategory === 'medium') {
            dotRadius = p.baseRadius * (0.65 + 0.55 * Math.pow(k, 1.2));
          } else {
            dotRadius = p.baseRadius * (0.75 + 0.45 * k);
          }

          const alpha = 0.14 + 0.83 * Math.pow(k, 1.3);

          if (p.hasTrail && p.trailPoints.length > 0) {
            p.trailPoints.forEach((tp, idx) => {
              const trailAlpha = alpha * (idx === 0 ? 0.35 : 0.15);
              const trailRadius = dotRadius * (idx === 0 ? 0.65 : 0.40);
              ctx.save();
              ctx.beginPath();
              ctx.arc(tp.x, tp.y, trailRadius, 0, Math.PI * 2);
              ctx.globalAlpha = trailAlpha;
              ctx.fillStyle = p.color;
              ctx.fill();
              ctx.restore();
            });
          }

          ctx.save();
          ctx.beginPath();
          ctx.arc(p.projX, p.projY, dotRadius, 0, Math.PI * 2);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.restore();
        }

        animationFrameId = requestAnimationFrame(renderVortex);
      };

      renderVortex();
    }

    // =========================================================================
    // 3. GEODESIC FIBONACCI POINT LATTICE
    // =========================================================================
    else if (activeStyle === 'geodesic') {
      const numParticles = size === 'sm' ? 52 : size === 'xl' ? 92 : 68;
      const phiAngle = Math.PI * (3 - Math.sqrt(5));
      const particles: Array<{ y0: number; radiusAtY: number; theta0: number; sizeMod: number; isAccent: boolean }> = [];

      for (let i = 0; i < numParticles; i++) {
        const y0 = 1 - (i / (numParticles - 1)) * 2;
        const radiusAtY = Math.sqrt(Math.max(0, 1 - y0 * y0));
        const theta0 = i * phiAngle;
        const sizeMod = 0.85 + Math.random() * 0.3;
        particles.push({ y0, radiusAtY, theta0, sizeMod, isAccent: i % 4 === 0 });
      }

      const minDotRadius = size === 'sm' ? 0.25 : size === 'xl' ? 0.60 : 0.32;
      const maxDotRadius = size === 'sm' ? 0.95 : size === 'xl' ? 2.20 : 1.25;

      const renderGeodesic = () => {
        ctx.clearRect(0, 0, canvasPx, canvasPx);
        angleY += 0.018;

        const projected = particles.map(p => {
          const theta = p.theta0 + angleY;
          const x1 = p.radiusAtY * Math.cos(theta);
          const z1 = p.radiusAtY * Math.sin(theta);
          const y1 = p.y0;

          const y2 = y1 * cosTiltX - z1 * sinTiltX;
          const z2 = y1 * sinTiltX + z1 * cosTiltX;

          const x3 = x1 * cosTiltZ - y2 * sinTiltZ;
          const y3 = x1 * sinTiltZ + y2 * cosTiltZ;

          const beadColor = p.isAccent && z2 > 0.2 ? themeAccentColor : themeTextColor;

          return {
            projX: centerX + x3 * sphereRadius,
            projY: centerY + y3 * sphereRadius,
            zNorm: z2,
            sizeMod: p.sizeMod,
            color: beadColor,
          };
        });

        projected.sort((a, b) => a.zNorm - b.zNorm);

        for (let i = 0; i < projected.length; i++) {
          const p = projected[i];
          const k = Math.max(0, Math.min(1, (p.zNorm + 1) / 2));
          const dotRadius = (minDotRadius + (maxDotRadius - minDotRadius) * Math.pow(k, 1.8)) * p.sizeMod;
          const alpha = 0.14 + 0.84 * Math.pow(k, 1.3);

          ctx.save();
          ctx.beginPath();
          ctx.arc(p.projX, p.projY, dotRadius, 0, Math.PI * 2);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.restore();
        }

        animationFrameId = requestAnimationFrame(renderGeodesic);
      };

      renderGeodesic();
    }

    // =========================================================================
    // 4. LIQUID AURORA RIBBON (SMOOTH 3D HARMONIC HARMONY)
    // =========================================================================
    else if (activeStyle === 'aurora') {
      const numPoints = 64;
      const renderAurora = () => {
        ctx.clearRect(0, 0, canvasPx, canvasPx);
        time += 0.035;

        // Ambient center glow
        const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, sphereRadius * 0.95);
        glow.addColorStop(0, formatRgba(themeAccentColor, 0.20));
        glow.addColorStop(0.6, formatRgba(themeAccentColor, 0.05));
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(centerX, centerY, sphereRadius * 0.95, 0, Math.PI * 2);
        ctx.fill();

        const points: Array<{ x: number; y: number; z: number; color: string; alpha: number; radius: number }> = [];

        for (let i = 0; i < numPoints; i++) {
          const t = (i / numPoints) * Math.PI * 2;
          const u = t + time * 0.8;

          const r = sphereRadius * (0.85 + 0.15 * Math.sin(u * 3 + time));
          const x0 = Math.sin(u) * r;
          const y0 = Math.cos(u * 2) * (r * 0.55);
          const z0 = Math.sin(u * 3) * (r * 0.7);

          const x1 = x0 * cosTiltZ - y0 * sinTiltZ;
          const y1 = (x0 * sinTiltZ + y0 * cosTiltZ) * cosTiltX - z0 * sinTiltX;
          const zNorm = (x0 * sinTiltZ + y0 * cosTiltZ) * sinTiltX + z0 * cosTiltX;

          const depthK = (zNorm / sphereRadius + 1) / 2;
          const isAccent = (i % 2 === 0);
          const ptColor = isAccent ? themeAccentColor : themeTextColor;

          points.push({
            x: centerX + x1,
            y: centerY + y1,
            z: zNorm,
            color: ptColor,
            alpha: Math.max(0.18, Math.min(0.95, 0.25 + depthK * 0.7)),
            radius: (size === 'sm' ? 0.9 : size === 'lg' ? 2.0 : 1.4) * (0.65 + depthK * 0.7),
          });
        }

        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.strokeStyle = formatRgba(themeAccentColor, 0.35);
        ctx.lineWidth = size === 'sm' ? 1.0 : 1.6;
        ctx.stroke();
        ctx.restore();

        points.sort((a, b) => a.z - b.z);
        for (const p of points) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha;
          ctx.fill();
          ctx.restore();
        }

        animationFrameId = requestAnimationFrame(renderAurora);
      };

      renderAurora();
    }

    // =========================================================================
    // 5. QUANTUM ORBITAL RINGS (PRECESSING GYROSCOPE GIMBALS)
    // =========================================================================
    else if (activeStyle === 'gyroscope') {
      const renderGyro = () => {
        ctx.clearRect(0, 0, canvasPx, canvasPx);
        time += 0.028;

        const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, sphereRadius);
        glow.addColorStop(0, formatRgba(themeAccentColor, 0.16));
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(centerX, centerY, sphereRadius, 0, Math.PI * 2);
        ctx.fill();

        const rings = [
          { speed: 1.0, radius: sphereRadius * 0.95, color: themeAccentColor, tilt: 0.3 },
          { speed: -1.2, radius: sphereRadius * 0.78, color: themeTextColor, tilt: 1.2 },
          { speed: 0.8, radius: sphereRadius * 0.60, color: themeAccentColor, tilt: 2.1 },
        ];

        for (const ring of rings) {
          const angle = time * ring.speed;
          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate(ring.tilt);

          ctx.beginPath();
          ctx.ellipse(0, 0, ring.radius, ring.radius * 0.42, angle * 0.4, 0, Math.PI * 2);
          ctx.strokeStyle = formatRgba(ring.color, 0.24);
          ctx.lineWidth = size === 'sm' ? 0.9 : 1.3;
          ctx.stroke();

          const beadX = Math.cos(angle * 2) * ring.radius;
          const beadY = Math.sin(angle * 2) * (ring.radius * 0.42);
          ctx.beginPath();
          ctx.arc(beadX, beadY, size === 'sm' ? 1.3 : 2.0, 0, Math.PI * 2);
          ctx.fillStyle = ring.color;
          ctx.fill();
          ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, (size === 'sm' ? 1.4 : 2.2) * (0.8 + 0.2 * Math.sin(time * 3.5)), 0, Math.PI * 2);
        ctx.fillStyle = themeAccentColor;
        ctx.fill();
        ctx.restore();

        animationFrameId = requestAnimationFrame(renderGyro);
      };

      renderGyro();
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [canvasPx, sphereRadius, size, activeStyle, theme, currentConfig]);

  return (
    <div className={`inline-flex items-center justify-center select-none fade-in ${className}`}>
      <canvas
        ref={canvasRef}
        style={{
          width: `${canvasPx}px`,
          height: `${canvasPx}px`,
        }}
        className="block"
      />
    </div>
  );
};
