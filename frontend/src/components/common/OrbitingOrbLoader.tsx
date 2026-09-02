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
    // 1. LIQUID AURORA RIBBON (SMOOTH 3D HARMONIC HARMONY & COLOR BLOOM)
    // =========================================================================
    if (activeStyle === 'aurora') {
      const numPoints = 64;
      const renderAurora = () => {
        ctx.clearRect(0, 0, canvasPx, canvasPx);
        time += 0.035;

        // Ambient center glow
        const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, sphereRadius * 0.95);
        glow.addColorStop(0, formatRgba(themeAccentColor, 0.22));
        glow.addColorStop(0.6, formatRgba(themeAccentColor, 0.06));
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(centerX, centerY, sphereRadius * 0.95, 0, Math.PI * 2);
        ctx.fill();

        const points: Array<{ x: number; y: number; z: number; color: string; alpha: number; radius: number }> = [];

        for (let i = 0; i < numPoints; i++) {
          const t = (i / numPoints) * Math.PI * 2;
          const u = t + time * 0.8;

          // 3D Trefoil / Lissajous energy wave
          const r = sphereRadius * (0.85 + 0.15 * Math.sin(u * 3 + time));
          const x0 = Math.sin(u) * r;
          const y0 = Math.cos(u * 2) * (r * 0.55);
          const z0 = Math.sin(u * 3) * (r * 0.7);

          // 3D Isometric View Projection
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

        // Draw connected fluid energy ribbon
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

        // Draw glowing particle nodes
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
    // 2. COUNTER-ROTATING PLANETARY STRATA
    // =========================================================================
    else if (activeStyle === 'bands') {
      const numRows = 8;
      const rowElements: Array<{
        y0: number;
        ringRadius: number;
        direction: number;
        currentAngle: number;
        beads: Array<{ theta0: number; sizeMod: number; isAccent: boolean }>;
      }> = [];

      for (let j = 0; j < numRows; j++) {
        const y0 = 0.88 - (j / (numRows - 1)) * 1.76;
        const ringRadius = Math.sqrt(Math.max(0.04, 1 - y0 * y0));
        const direction = j % 2 === 0 ? 1 : -1;
        const count = Math.max(6, Math.round(5 + ringRadius * 11));
        const beads: Array<{ theta0: number; sizeMod: number; isAccent: boolean }> = [];

        for (let k = 0; k < count; k++) {
          beads.push({
            theta0: (k / count) * Math.PI * 2,
            sizeMod: 0.9 + Math.random() * 0.2,
            isAccent: (k + j) % 3 === 0,
          });
        }

        rowElements.push({
          y0,
          ringRadius,
          direction,
          currentAngle: 0,
          beads,
        });
      }

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
          row.currentAngle += 0.024 * row.direction;

          for (const b of row.beads) {
            const angle = b.theta0 + row.currentAngle;
            const x0 = Math.cos(angle) * row.ringRadius;
            const z0 = Math.sin(angle) * row.ringRadius;
            const y0 = row.y0;

            const x1 = x0 * cosTiltZ - y0 * sinTiltZ;
            const y1 = x0 * sinTiltZ + y0 * cosTiltZ;
            const y2 = y1 * cosTiltX - z0 * sinTiltX;
            const zNorm = y1 * sinTiltX + z0 * cosTiltX;

            projectedBeads.push({
              projX: centerX + x1 * sphereRadius,
              projY: centerY + y2 * sphereRadius,
              zNorm,
              sizeMod: b.sizeMod,
              color: b.isAccent ? themeAccentColor : themeTextColor,
            });
          }
        }

        projectedBeads.sort((a, b) => a.zNorm - b.zNorm);

        for (const p of projectedBeads) {
          const k = Math.max(0, Math.min(1, (p.zNorm + 1) / 2));
          const alpha = Math.max(0.16, Math.min(0.95, 0.2 + k * 0.75));
          const radius = (size === 'sm' ? 0.8 : size === 'lg' ? 1.6 : 1.1) * (0.65 + k * 0.8) * p.sizeMod;

          ctx.save();
          ctx.beginPath();
          ctx.arc(p.projX, p.projY, radius, 0, Math.PI * 2);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.restore();
        }

        animationFrameId = requestAnimationFrame(renderBands);
      };

      renderBands();
    }

    // =========================================================================
    // 3. FIBONACCI GOLDEN SPHERE (GEODESIC LATTICE)
    // =========================================================================
    else if (activeStyle === 'geodesic') {
      const numPoints = size === 'sm' ? 48 : size === 'xl' ? 96 : 68;
      const points: Array<{ x: number; y: number; z: number; isAccent: boolean }> = [];
      const goldenRatio = (1 + Math.sqrt(5)) / 2;

      for (let i = 0; i < numPoints; i++) {
        const theta = 2 * Math.PI * i / goldenRatio;
        const phi = Math.acos(1 - 2 * (i + 0.5) / numPoints);
        points.push({
          x: Math.cos(theta) * Math.sin(phi),
          y: Math.sin(theta) * Math.sin(phi),
          z: Math.cos(phi),
          isAccent: i % 4 === 0,
        });
      }

      const renderGeodesic = () => {
        ctx.clearRect(0, 0, canvasPx, canvasPx);
        angleY += 0.02;
        time += 0.03;

        const cosY = Math.cos(angleY);
        const sinY = Math.sin(angleY);
        const breath = 1 + 0.04 * Math.sin(time * 2);
        const curRadius = sphereRadius * breath;

        const projected = points.map(p => {
          const x1 = p.x * cosY - p.z * sinY;
          const z1 = p.x * sinY + p.z * cosY;
          const y2 = p.y * cosTiltX - z1 * sinTiltX;
          const z2 = p.y * sinTiltX + z1 * cosTiltX;

          return {
            projX: centerX + x1 * curRadius,
            projY: centerY + y2 * curRadius,
            zNorm: z2,
            color: p.isAccent ? themeAccentColor : themeTextColor,
          };
        });

        projected.sort((a, b) => a.zNorm - b.zNorm);

        for (const p of projected) {
          const k = Math.max(0, Math.min(1, (p.zNorm + 1) / 2));
          const alpha = Math.max(0.18, Math.min(0.95, 0.22 + k * 0.75));
          const dotRadius = (size === 'sm' ? 0.8 : size === 'lg' ? 1.6 : 1.1) * (0.65 + k * 0.8);

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
    // 4. QUANTUM ORBITAL RINGS (PRECESSING GYROSCOPE GIMBALS)
    // =========================================================================
    else if (activeStyle === 'gyroscope') {
      const renderGyro = () => {
        ctx.clearRect(0, 0, canvasPx, canvasPx);
        time += 0.028;

        // Subtle ambient glow
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

          // Draw orbital gimbal track
          ctx.beginPath();
          ctx.ellipse(0, 0, ring.radius, ring.radius * 0.42, angle * 0.4, 0, Math.PI * 2);
          ctx.strokeStyle = formatRgba(ring.color, 0.24);
          ctx.lineWidth = size === 'sm' ? 0.9 : 1.3;
          ctx.stroke();

          // Draw glowing orbiting comet bead
          const beadX = Math.cos(angle * 2) * ring.radius;
          const beadY = Math.sin(angle * 2) * (ring.radius * 0.42);
          ctx.beginPath();
          ctx.arc(beadX, beadY, size === 'sm' ? 1.3 : 2.0, 0, Math.PI * 2);
          ctx.fillStyle = ring.color;
          ctx.fill();
          ctx.restore();
        }

        // Central pulsating energy star
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

    // =========================================================================
    // 5. 3D CELESTIAL NEBULA & MONOCHROME STARDUST (VORTEX & VORTEX-PURE)
    // =========================================================================
    else {
      const isPure = activeStyle === 'vortex-pure';
      const numParticles = size === 'sm' ? 52 : size === 'xl' ? 110 : 78;
      const particles: Array<{ theta: number; phi: number; r: number; speed: number; isAccent: boolean }> = [];

      for (let i = 0; i < numParticles; i++) {
        particles.push({
          theta: Math.random() * Math.PI * 2,
          phi: (Math.random() - 0.5) * Math.PI * 0.9,
          r: 0.35 + Math.random() * 0.65,
          speed: 0.015 + Math.random() * 0.025,
          isAccent: !isPure && (i % 3 === 0),
        });
      }

      const renderVortex = () => {
        ctx.clearRect(0, 0, canvasPx, canvasPx);
        angleY += 0.022;

        const cosY = Math.cos(angleY);
        const sinY = Math.sin(angleY);

        const projected = particles.map(p => {
          p.theta += p.speed;
          const x0 = Math.cos(p.theta) * Math.cos(p.phi) * p.r;
          const y0 = Math.sin(p.phi) * p.r;
          const z0 = Math.sin(p.theta) * Math.cos(p.phi) * p.r;

          const x1 = x0 * cosY - z0 * sinY;
          const z1 = x0 * sinY + z0 * cosY;
          const y2 = y0 * cosTiltX - z1 * sinTiltX;
          const z2 = y0 * sinTiltX + z1 * cosTiltX;

          return {
            projX: centerX + x1 * sphereRadius,
            projY: centerY + y2 * sphereRadius,
            zNorm: z2,
            color: p.isAccent ? themeAccentColor : themeTextColor,
          };
        });

        projected.sort((a, b) => a.zNorm - b.zNorm);

        for (const p of projected) {
          const k = Math.max(0, Math.min(1, (p.zNorm + 1) / 2));
          const alpha = Math.max(0.18, Math.min(0.95, 0.22 + k * 0.75));
          const dotRadius = (size === 'sm' ? 0.85 : size === 'lg' ? 1.7 : 1.2) * (0.65 + k * 0.75);

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
