import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { 
  Network, 
  Sparkles, 
  Search, 
  RefreshCw, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Eye, 
  EyeOff, 
  Play, 
  Pause,
  FolderOpen,
  FileText,
  Check,
  ChevronDown,
  X
} from 'lucide-react';
import { api } from '../../services/api';
import { GraphNode, GraphLink, KnowledgeGraphData } from '../../types/graph';
import { EntityDetailDrawer } from './EntityDetailDrawer';
import { RelationshipDetailDrawer } from './RelationshipDetailDrawer';
import { CommunityInsightsModal } from './CommunityInsightsModal';
import { OrbitingOrbLoader } from '../common/OrbitingOrbLoader';
import { useTheme } from '../../context/ThemeContext';

// MiroFish-Style Pastel Color Palette by Entity Type
export const ENTITY_PALETTES: Record<string, { bg: string; border: string; label: string }> = {
  Entity: { bg: '#FB923C', border: '#EA580C', label: 'Entity' },
  Concept: { bg: '#FB923C', border: '#EA580C', label: 'Concept' },
  Person: { bg: '#0284C7', border: '#0369A1', label: 'Person' },
  Organization: { bg: '#8B5CF6', border: '#7C3AED', label: 'Organization' },
  University: { bg: '#F97316', border: '#EA580C', label: 'University' },
  Technology: { bg: '#10B981', border: '#059669', label: 'Technology' },
  System: { bg: '#06B6D4', border: '#0891B2', label: 'System' },
  Document: { bg: '#F43F5E', border: '#E11D48', label: 'Document' },
  Role: { bg: '#EC4899', border: '#DB2777', label: 'Role' },
  Profession: { bg: '#EC4899', border: '#DB2777', label: 'Profession' },
  Skill: { bg: '#14B8A6', border: '#0D9488', label: 'Skill' },
  Award: { bg: '#EAB308', border: '#CA8A04', label: 'Award' },
  Degree: { bg: '#F59E0B', border: '#D97706', label: 'Degree' },
  Process: { bg: '#F59E0B', border: '#D97706', label: 'Process' },
  Location: { bg: '#84CC16', border: '#65A30D', label: 'Location' },
  Domain: { bg: '#A855F7', border: '#9333EA', label: 'Domain' },
  Component: { bg: '#6366F1', border: '#4F46E5', label: 'Component' },
};

export const getNodeStyle = (type?: string, _communityId: number = 0) => {
  const norm = (type || 'Concept').trim();
  for (const [key, val] of Object.entries(ENTITY_PALETTES)) {
    if (key.toLowerCase() === norm.toLowerCase()) {
      return val;
    }
  }
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash << 5) - hash + norm.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return { 
    bg: `hsl(${hue}, 70%, 48%)`, 
    border: `hsl(${hue}, 80%, 38%)`, 
    label: norm 
  };
};

interface KnowledgeGraphViewProps {
  onInspectDoc?: (doc: { filename: string; page?: number; content?: string }) => void;
  vaultVersion?: number;
}

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({ onInspectDoc, vaultVersion = 0 }) => {
  const { theme, currentConfig } = useTheme();
  const isDark = theme === 'dark';
  const themeAccent = currentConfig?.previewColors?.accent || '#0284C7';

  // Data State
  const [graphData, setGraphData] = useState<KnowledgeGraphData>({
    nodes: [],
    links: [],
    communities: [],
    stats: { total_nodes: 0, total_links: 0, total_communities: 0 },
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [building, setBuilding] = useState<boolean>(false);

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDoc, setSelectedDoc] = useState<string>('All');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [filterCommunity, setFilterCommunity] = useState<number | null>(null);

  // Inspection Drawers & Modals
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedLink, setSelectedLink] = useState<GraphLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [insightsOpen, setInsightsOpen] = useState<boolean>(false);

  // View Settings
  const [showEdgeLabels, setShowEdgeLabels] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [physicsEnabled, setPhysicsEnabled] = useState<boolean>(true);
  const [docDropdownOpen, setDocDropdownOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  // Canvas References
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const animFrameRef = useRef<number>(0);
  const alphaRef = useRef<number>(1.0); // Simulation temperature / cooling

  // Camera & Interaction
  const transformRef = useRef<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 });
  const isDraggingCanvasRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggedNodeRef = useRef<GraphNode | null>(null);

  // Load Graph Data
  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getGraph();
      
      const width = canvasRef.current?.clientWidth || 800;
      const height = canvasRef.current?.clientHeight || 600;
      
      // Retain previous coordinates if nodes existed, otherwise distribute evenly
      const existingPos = new Map(nodesRef.current.map(n => [n.id, { x: n.x, y: n.y }]));
      
      const initializedNodes = (data.nodes || []).map((n: GraphNode, i: number) => {
        const prev = existingPos.get(n.id);
        if (prev && prev.x !== undefined && prev.y !== undefined) {
          return { ...n, x: prev.x, y: prev.y, vx: 0, vy: 0 };
        }
        const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
        const radius = 100 + (n.community_id * 25) + ((i % 5) * 20);
        return {
          ...n,
          x: width / 2 + Math.cos(angle) * radius,
          y: height / 2 + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
        };
      });

      // Deduplicate Links
      const seenPair = new Set<string>();
      const dedupedLinks: GraphLink[] = [];
      for (const l of (data.links || [])) {
        const s = typeof l.source === 'object' ? (l.source as any).id : String(l.source);
        const t = typeof l.target === 'object' ? (l.target as any).id : String(l.target);
        const relType = (l.type || '').toUpperCase().trim();
        const pairKey = `${s < t ? s : t}--${s < t ? t : s}--${relType}`;
        if (!seenPair.has(pairKey)) {
          seenPair.add(pairKey);
          dedupedLinks.push(l);
        }
      }

      nodesRef.current = initializedNodes;
      linksRef.current = dedupedLinks;
      alphaRef.current = 1.0; // Heat simulation for new layout

      setGraphData({
        nodes: initializedNodes,
        links: dedupedLinks,
        communities: data.communities || [],
        stats: {
          total_nodes: initializedNodes.length,
          total_links: dedupedLinks.length,
          total_communities: (data.communities || []).length,
        },
      });
    } catch (err) {
      console.error("Failed to load knowledge graph", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph, vaultVersion]);

  // Trigger Rebuild
  const handleRebuild = async () => {
    try {
      setBuilding(true);
      await api.buildGraph(true);
      let checks = 0;
      const poll = setInterval(async () => {
        checks++;
        await loadGraph();
        if (checks >= 4) {
          clearInterval(poll);
          setBuilding(false);
        }
      }, 2500);
    } catch (err) {
      console.error("Failed to trigger graph build", err);
      setBuilding(false);
    }
  };

  // Filter calculations
  const sourceDocs = useMemo(() => {
    const docs = new Set<string>(['All']);
    graphData.nodes.forEach(n => {
      (n.source_docs || []).forEach(d => {
        if (d && d.trim()) docs.add(d.trim());
      });
    });
    graphData.links.forEach(l => {
      if (l.source_doc && l.source_doc.trim()) {
        docs.add(l.source_doc.trim());
      }
    });
    return Array.from(docs);
  }, [graphData.nodes, graphData.links]);

  const activeNodeIds = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const targetDoc = selectedDoc.trim().toLowerCase();
    const set = new Set<string>();
    
    nodesRef.current.forEach((n) => {
      const matchType = selectedType === 'All' || n.type?.toLowerCase() === selectedType.toLowerCase();
      const matchQuery = !q || n.name.toLowerCase().includes(q) || (n.description || '').toLowerCase().includes(q);
      const matchCommunity = filterCommunity === null || n.community_id === filterCommunity;
      const matchDoc = selectedDoc === 'All' || (n.source_docs || []).some(d => {
        const cleanD = (d || '').trim().toLowerCase();
        return cleanD === targetDoc || cleanD.includes(targetDoc) || targetDoc.includes(cleanD);
      });

      if (matchType && matchQuery && matchCommunity && matchDoc) {
        set.add(n.id);
      }
    });

    if (selectedDoc !== 'All') {
      linksRef.current.forEach(l => {
        const linkDoc = (l.source_doc || '').trim().toLowerCase();
        if (linkDoc && (linkDoc === targetDoc || linkDoc.includes(targetDoc) || targetDoc.includes(linkDoc))) {
          const sId = typeof l.source === 'object' ? (l.source as any).id : String(l.source);
          const tId = typeof l.target === 'object' ? (l.target as any).id : String(l.target);
          set.add(sId);
          set.add(tId);
        }
      });
    }

    return set;
  }, [graphData.nodes, graphData.links, searchQuery, selectedType, selectedDoc, filterCommunity]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return graphData.nodes
      .filter(n => n.name.toLowerCase().includes(q) || (n.type && n.type.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [graphData.nodes, searchQuery]);

  const presentEntityTypes = useMemo(() => {
    const types = new Map<string, { bg: string; label: string }>();
    (graphData.nodes || []).forEach(n => {
      const style = getNodeStyle(n.type, n.community_id);
      const typeKey = (n.type || 'Entity').trim();
      if (!types.has(typeKey)) {
        types.set(typeKey, { bg: style.bg, label: typeKey });
      }
    });
    return Array.from(types.entries()).map(([key, val]) => ({
      name: key,
      bg: val.bg,
    }));
  }, [graphData.nodes]);

  const centerOnNode = useCallback((node: GraphNode) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;
    const k = 1.35;
    transformRef.current = {
      x: centerX - (node.x || 0) * k,
      y: centerY - (node.y || 0) * k,
      k: k
    };
    setSelectedNode(node);
    setSelectedLink(null);
    setSearchFocused(false);
  }, []);

  // Screen to World coordinates
  const screenToWorld = useCallback((screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const transform = transformRef.current;
    return {
      x: (screenX - rect.left - transform.x) / transform.k,
      y: (screenY - rect.top - transform.y) / transform.k,
    };
  }, []);

  // Camera Controls
  const handleZoom = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;
    const t = transformRef.current;
    const newK = Math.max(0.2, Math.min(4.0, t.k * factor));
    t.x = centerX - (centerX - t.x) * (newK / t.k);
    t.y = centerY - (centerY - t.y) * (newK / t.k);
    t.k = newK;
  };

  const handleResetCamera = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nodes = nodesRef.current;
    if (nodes.length === 0) {
      transformRef.current = { x: 0, y: 0, k: 1 };
      return;
    }
    const xs = nodes.map(n => n.x || 0);
    const ys = nodes.map(n => n.y || 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(100, maxX - minX);
    const spanY = Math.max(100, maxY - minY);
    const pad = 120;
    const scaleX = (canvas.clientWidth - pad * 2) / spanX;
    const scaleY = (canvas.clientHeight - pad * 2) / spanY;
    const k = Math.max(0.4, Math.min(1.4, Math.min(scaleX, scaleY)));
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    transformRef.current = {
      x: canvas.clientWidth / 2 - midX * k,
      y: canvas.clientHeight / 2 - midY * k,
      k,
    };
    alphaRef.current = 0.4;
  };

  // Convergent Kinetic Simulation & High-DPI Rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;

    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    // Convergent Force Simulation Step (Stable, bounded, decaying)
    const runSimulationStep = () => {
      if (!physicsEnabled || alphaRef.current < 0.005) return;
      
      const nodes = nodesRef.current;
      const links = linksRef.current;
      const width = canvas.clientWidth || 800;
      const height = canvas.clientHeight || 600;
      const center = { x: width / 2, y: height / 2 };
      const alpha = alphaRef.current;
      const nodeMap = new Map(nodes.map(n => [n.id, n]));

      // 1. Soft Centering Gravity
      for (const n of nodes) {
        if (n === draggedNodeRef.current) continue;
        const dx = center.x - (n.x || 0);
        const dy = center.y - (n.y || 0);
        n.vx = (n.vx || 0) + dx * 0.0004 * alpha;
        n.vy = (n.vy || 0) + dy * 0.0004 * alpha;
      }

      // 2. Coulomb Node Repulsion (Clamped distance to prevent explosive forces)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = (b.x || 0) - (a.x || 0);
          const dy = (b.y || 0) - (a.y || 0);
          const distSq = dx * dx + dy * dy;
          const dist = Math.max(18, Math.sqrt(distSq));
          const force = (alpha * 420) / (dist * dist);

          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (a !== draggedNodeRef.current) {
            a.vx = (a.vx || 0) - fx;
            a.vy = (a.vy || 0) - fy;
          }
          if (b !== draggedNodeRef.current) {
            b.vx = (b.vx || 0) + fx;
            b.vy = (b.vy || 0) + fy;
          }
        }
      }

      // 3. Link Spring Attraction
      for (const link of links) {
        const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        const src = nodeMap.get(srcId);
        const tgt = nodeMap.get(tgtId);

        if (src && tgt) {
          const dx = (tgt.x || 0) - (src.x || 0);
          const dy = (tgt.y || 0) - (src.y || 0);
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const targetDist = 110;
          const force = (dist - targetDist) * 0.015 * alpha;

          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (src !== draggedNodeRef.current) {
            src.vx = (src.vx || 0) + fx;
            src.vy = (src.vy || 0) + fy;
          }
          if (tgt !== draggedNodeRef.current) {
            tgt.vx = (tgt.vx || 0) - fx;
            tgt.vy = (tgt.vy || 0) - fy;
          }
        }
      }

      // 4. Velocity Damping & Integration
      const damping = 0.84;
      for (const n of nodes) {
        if (n === draggedNodeRef.current) continue;
        n.vx = (n.vx || 0) * damping;
        n.vy = (n.vy || 0) * damping;
        n.x = (n.x || 0) + (n.vx || 0);
        n.y = (n.y || 0) + (n.vy || 0);
      }

      // Thermal Decay (gradually cool down and settle completely)
      alphaRef.current *= 0.985;
    };

    // Render Canvas Frame
    const render = () => {
      if (!isRunning) return;
      runSimulationStep();

      const width = canvas.clientWidth || 800;
      const height = canvas.clientHeight || 600;
      ctx.clearRect(0, 0, width, height);

      const transform = transformRef.current;
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      // Subtle Dot Grid
      const gridSize = 40;
      const startX = Math.floor((-transform.x / transform.k) / gridSize) * gridSize - gridSize;
      const endX = startX + (width / transform.k) + gridSize * 2;
      const startY = Math.floor((-transform.y / transform.k) / gridSize) * gridSize - gridSize;
      const endY = startY + (height / transform.k) + gridSize * 2;
      
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';
      for (let gx = startX; gx < endX; gx += gridSize) {
        for (let gy = startY; gy < endY; gy += gridSize) {
          ctx.beginPath();
          ctx.arc(gx, gy, 0.85, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const nodes = nodesRef.current;
      const links = linksRef.current;
      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const isFilteringActive = selectedDoc !== 'All' || selectedType !== 'All' || filterCommunity !== null;

      // 1. Draw Links
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        const src = nodeMap.get(srcId);
        const tgt = nodeMap.get(tgtId);

        if (!src || !tgt) continue;
        if (isFilteringActive && (!activeNodeIds.has(src.id) || !activeNodeIds.has(tgt.id))) continue;

        const isDirectlySelected = selectedLink && (
          (selectedLink.id && link.id && selectedLink.id === link.id) ||
          ((typeof selectedLink.source === 'object' ? (selectedLink.source as any).id : selectedLink.source) === srcId &&
           (typeof selectedLink.target === 'object' ? (selectedLink.target as any).id : selectedLink.target) === tgtId)
        );
        const isConnectedToSelectedNode = selectedNode && (src.id === selectedNode.id || tgt.id === selectedNode.id);
        const isHighlighted = isDirectlySelected || isConnectedToSelectedNode;

        const x1 = src.x || 0;
        const y1 = src.y || 0;
        const x2 = tgt.x || 0;
        const y2 = tgt.y || 0;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const dist = Math.hypot(x2 - x1, y2 - y1) || 1;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        if (isHighlighted) {
          ctx.strokeStyle = themeAccent;
          ctx.lineWidth = 1.6;
          ctx.globalAlpha = 0.95;
        } else {
          ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.28)' : 'rgba(203, 213, 225, 0.85)';
          ctx.lineWidth = 1.0;
          ctx.globalAlpha = 0.75;
        }
        ctx.stroke();

        // Edge Label Badge
        if (showEdgeLabels && (isHighlighted || (transform.k > 0.5 && dist > 45))) {
          const text = (link.type || 'RELATES_TO').toUpperCase().trim();
          ctx.font = isHighlighted ? '600 8.5px "JetBrains Mono", monospace' : '500 8px "JetBrains Mono", monospace';
          const textWidth = ctx.measureText(text).width;
          const pad = 4;
          const boxW = textWidth + pad * 2;
          const boxH = 13;

          ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.96)';
          ctx.beginPath();
          ctx.roundRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH, 3.5);
          ctx.fill();

          ctx.strokeStyle = isHighlighted ? themeAccent : (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)');
          ctx.lineWidth = 0.6;
          ctx.stroke();

          ctx.fillStyle = isHighlighted ? themeAccent : (isDark ? '#94A3B8' : '#64748B');
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, midX, midY);
        }

        ctx.restore();
      }

      // 2. Draw Nodes
      for (const node of nodes) {
        if (isFilteringActive && !activeNodeIds.has(node.id)) continue;

        const isSelected = selectedNode?.id === node.id;
        const isHovered = hoveredNode?.id === node.id;
        const isConnectedToSelected = selectedNode && links.some(l => {
          const sId = typeof l.source === 'object' ? (l.source as any).id : l.source;
          const tId = typeof l.target === 'object' ? (l.target as any).id : l.target;
          return (sId === selectedNode.id && tId === node.id) || (tId === selectedNode.id && sId === node.id);
        });

        const nodeStyle = getNodeStyle(node.type, node.community_id);
        const baseRadius = 5.5 + Math.min(3.0, (node.degree || 1) * 0.4);
        const radius = isSelected ? baseRadius + 2.5 : isHovered ? baseRadius + 1.2 : baseRadius;

        ctx.save();

        // Active Theme Glow for Selected Node
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(node.x || 0, node.y || 0, radius + 5, 0, Math.PI * 2);
          ctx.fillStyle = `${themeAccent}25`;
          ctx.fill();
        }

        // Main Node Body
        ctx.beginPath();
        ctx.arc(node.x || 0, node.y || 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? themeAccent : nodeStyle.bg;
        ctx.fill();

        // Crisp Border
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = isSelected ? 1.8 : 1.2;
        ctx.stroke();

        // Node Label
        if (showLabels && (transform.k > 0.45 || isHovered || isSelected || isConnectedToSelected)) {
          const displayName = node.name.length > 14 ? node.name.slice(0, 13) + '…' : node.name;
          ctx.font = `${isSelected ? 'bold 11px' : isHovered ? '600 10.5px' : '500 10px'} "JetBrains Mono", -apple-system, sans-serif`;
          
          const labelX = (node.x || 0) + radius + 5;
          const labelY = (node.y || 0);

          // Dark / Light Halo
          ctx.lineJoin = 'round';
          ctx.strokeStyle = isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)';
          ctx.lineWidth = 2.6;
          ctx.strokeText(displayName, labelX, labelY);

          // Label Text
          ctx.fillStyle = isSelected 
            ? themeAccent 
            : isHovered 
              ? (isDark ? '#FFFFFF' : '#0F172A') 
              : (isDark ? '#E2E8F0' : '#1E293B');
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(displayName, labelX, labelY);
        }

        ctx.restore();
      }

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      isRunning = false;
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [activeNodeIds, selectedNode, selectedLink, hoveredNode, showLabels, showEdgeLabels, physicsEnabled, isDark, themeAccent, selectedDoc, selectedType, filterCommunity]);

  // Smooth Non-Passive Wheel Zoom with cursor anchoring
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomDelta = -e.deltaY * 0.0015;
      const zoomFactor = Math.exp(Math.max(-0.25, Math.min(0.25, zoomDelta)));
      const t = transformRef.current;
      const newK = Math.max(0.2, Math.min(4.0, t.k * zoomFactor));

      t.x = mouseX - (mouseX - t.x) * (newK / t.k);
      t.y = mouseY - (mouseY - t.y) * (newK / t.k);
      t.k = newK;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Mouse Interaction Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (docDropdownOpen) setDocDropdownOpen(false);
    if (searchFocused) setSearchFocused(false);

    const world = screenToWorld(e.clientX, e.clientY);
    const isFilteringActive = selectedDoc !== 'All' || selectedType !== 'All' || filterCommunity !== null;
    
    // 1. Check Node Click
    const clickedNode = nodesRef.current.find((n) => {
      if (isFilteringActive && !activeNodeIds.has(n.id)) return false;
      const dx = (n.x || 0) - world.x;
      const dy = (n.y || 0) - world.y;
      return dx * dx + dy * dy < 260;
    });

    if (clickedNode) {
      draggedNodeRef.current = clickedNode;
      setSelectedNode(clickedNode);
      setSelectedLink(null);
      alphaRef.current = 0.25; // Reheat physics smoothly
      return;
    }

    // 2. Check Edge Click (Perpendicular segment distance)
    const nodeMap = new Map(nodesRef.current.map(n => [n.id, n]));
    const clickedLink = linksRef.current.find((link) => {
      const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
      if (isFilteringActive && (!activeNodeIds.has(srcId) || !activeNodeIds.has(tgtId))) return false;
      const src = nodeMap.get(srcId);
      const tgt = nodeMap.get(tgtId);
      if (!src || !tgt) return false;

      const x1 = src.x || 0, y1 = src.y || 0, x2 = tgt.x || 0, y2 = tgt.y || 0;
      const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
      if (l2 === 0) return false;
      const t = Math.max(0, Math.min(1, ((world.x - x1) * (x2 - x1) + (world.y - y1) * (y2 - y1)) / l2));
      const projX = x1 + t * (x2 - x1);
      const projY = y1 + t * (y2 - y1);
      const dSq = (world.x - projX) * (world.x - projX) + (world.y - projY) * (world.y - projY);
      return dSq < 64; // Within 8px of link segment
    });

    if (clickedLink) {
      setSelectedLink(clickedLink);
      setSelectedNode(null);
      return;
    }

    // 3. Canvas Pan
    isDraggingCanvasRef.current = true;
    dragStartRef.current = { x: e.clientX - transformRef.current.x, y: e.clientY - transformRef.current.y };
    setSelectedNode(null);
    setSelectedLink(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(e.clientX, e.clientY);

    // Node Dragging
    if (draggedNodeRef.current) {
      draggedNodeRef.current.x = world.x;
      draggedNodeRef.current.y = world.y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
      alphaRef.current = 0.2;
      return;
    }

    // Canvas Panning
    if (isDraggingCanvasRef.current) {
      transformRef.current.x = e.clientX - dragStartRef.current.x;
      transformRef.current.y = e.clientY - dragStartRef.current.y;
      return;
    }

    // Node Hovering
    const isFilteringActive = selectedDoc !== 'All' || selectedType !== 'All' || filterCommunity !== null;
    const found = nodesRef.current.find((n) => {
      if (isFilteringActive && !activeNodeIds.has(n.id)) return false;
      const dx = (n.x || 0) - world.x;
      const dy = (n.y || 0) - world.y;
      return dx * dx + dy * dy < 220;
    });
    setHoveredNode(found || null);
  };

  const handleMouseUp = () => {
    draggedNodeRef.current = null;
    isDraggingCanvasRef.current = false;
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[var(--bg-main)] overflow-hidden select-none">
      {/* Top Floating Control Bar */}
      <div className="absolute top-5 left-5 right-5 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Left: Search & Document Selector */}
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Search Pill */}
          <div className="relative">
            <div className="relative flex items-center">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 pointer-events-none text-[var(--text-muted)]">
                <Search size={15} />
              </div>
              <input
                type="text"
                placeholder="Search entities, concepts..."
                value={searchQuery}
                onFocus={() => setSearchFocused(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchFocused(true);
                }}
                className="h-10 pl-10 pr-9 w-56 sm:w-72 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[13px] text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/20 shadow-sm transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchFocused(false);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Suggestions Dropdown */}
            {searchFocused && searchResults.length > 0 && (
              <div className="absolute left-0 mt-2 w-80 p-2 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-2xl z-50 flex flex-col gap-1 text-[13px] animate-in fade-in duration-100">
                <div className="px-3 py-1 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Matching Entities ({searchResults.length})
                </div>
                {searchResults.map((node) => {
                  const style = getNodeStyle(node.type, node.community_id);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => centerOnNode(node)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-[var(--bg-hover)] text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: style.bg }} />
                        <span className="truncate font-medium text-[var(--text-main)]">{node.name}</span>
                      </div>
                      <span className="text-[11px] font-mono text-[var(--text-muted)]">{node.type}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Document Filter Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setDocDropdownOpen(!docDropdownOpen)}
              className="h-10 flex items-center gap-2 px-3.5 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[13px] font-medium text-[var(--text-main)] hover:border-[var(--accent-primary)] hover:bg-[var(--bg-hover)] shadow-sm transition-all cursor-pointer"
            >
              <FolderOpen size={14} className="text-[var(--accent-primary)]" />
              <span className="max-w-[140px] sm:max-w-[200px] truncate">
                {selectedDoc === 'All' ? 'All Documents' : selectedDoc}
              </span>
              <ChevronDown size={14} className="text-[var(--text-muted)]" />
            </button>

            {docDropdownOpen && (
              <div className="absolute left-0 mt-2 w-72 max-h-80 overflow-y-auto p-2 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-2xl z-50 flex flex-col gap-1 text-[13px] animate-in fade-in duration-100">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Filter by Document
                </div>
                {sourceDocs.map((docName) => (
                  <button
                    key={docName}
                    type="button"
                    onClick={() => {
                      setSelectedDoc(docName);
                      setDocDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                      selectedDoc === docName ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-medium' : 'hover:bg-[var(--bg-hover)] text-[var(--text-main)]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={14} className={selectedDoc === docName ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'} />
                      <span className="truncate text-xs">{docName === 'All' ? 'All Documents (Entire Vault)' : docName}</span>
                    </div>
                    {selectedDoc === docName && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Edge Labels, Insights, Rebuild */}
        <div className="flex items-center gap-2.5 pointer-events-auto">
          {/* Toggle Edge Labels */}
          <button
            type="button"
            onClick={() => setShowEdgeLabels(!showEdgeLabels)}
            className={`h-10 flex items-center gap-2 px-3.5 rounded-full border text-[12.5px] font-medium transition-all shadow-sm cursor-pointer ${
              showEdgeLabels
                ? 'bg-[var(--bg-card)] border-[var(--accent-primary)] text-[var(--accent-primary)]'
                : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            {showEdgeLabels ? <Eye size={14} /> : <EyeOff size={14} />}
            <span className="hidden sm:inline">Edge Labels</span>
          </button>

          {/* Insights Trigger */}
          <button
            type="button"
            onClick={() => setInsightsOpen(true)}
            className="h-10 flex items-center gap-2 px-3.5 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[12.5px] font-medium text-[var(--text-main)] hover:border-[var(--accent-primary)] hover:bg-[var(--bg-hover)] shadow-sm transition-all cursor-pointer"
          >
            <Sparkles size={15} className="text-[var(--accent-primary)]" />
            <span className="hidden sm:inline">Insights</span>
            <span className="px-1.5 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[10.5px] font-bold">
              {graphData.communities.length}
            </span>
          </button>

          {/* Rebuild Trigger */}
          <button
            type="button"
            onClick={handleRebuild}
            disabled={building}
            className="h-10 flex items-center gap-2 px-4 rounded-full bg-[var(--accent-primary)] text-[var(--accent-contrast-text)] text-[12.5px] font-semibold hover:opacity-90 shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={building ? 'animate-spin' : ''} />
            <span>{building ? 'Building...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Main Canvas Stage */}
      <div className="flex-1 relative w-full h-full cursor-grab active:cursor-grabbing">
        {loading || (building && graphData.nodes.length === 0) ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[var(--bg-main)]/65 backdrop-blur-xs select-none animate-in fade-in duration-200">
            <div className="relative flex items-center justify-center">
              <div className="absolute w-24 h-24 rounded-full bg-[var(--accent-primary)]/15 blur-xl animate-pulse pointer-events-none" />
              <OrbitingOrbLoader size="lg" />
            </div>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <span className="text-[13px] font-medium text-[var(--text-main)] tracking-wide flex items-center gap-1.5">
                <span>{building ? 'Building Knowledge Graph' : 'Loading Knowledge Graph'}</span>
                <span className="inline-flex gap-1 items-center">
                  <span className="w-1 h-1 rounded-full bg-[var(--accent-primary)] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 rounded-full bg-[var(--accent-primary)] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 rounded-full bg-[var(--accent-primary)] animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </span>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                {building ? 'Synthesizing entities and cross-document links...' : 'Loading interactive network visualization...'}
              </span>
            </div>
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center justify-center mb-3 text-[var(--accent-primary)] shadow-sm">
              <Network size={26} />
            </div>
            <h3 className="font-bold text-sm text-[var(--text-main)] mb-1">Knowledge Graph is Empty</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mb-4">
              Upload documents into your Knowledge Vault, then click "Build Knowledge Graph" to extract entities and cross-document relationships.
            </p>
            <button
              onClick={handleRebuild}
              disabled={building}
              className="px-5 py-2.5 rounded-xl bg-[var(--accent-primary)] text-[var(--accent-contrast-text)] text-xs font-semibold hover:opacity-90 transition-all shadow-md cursor-pointer disabled:opacity-50 active:scale-98 flex items-center gap-2"
            >
              <Sparkles size={14} />
              <span>{building ? 'Building Graph...' : 'Build Knowledge Graph Now'}</span>
            </button>
          </div>
        ) : null}

        {building && graphData.nodes.length > 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-5 py-2 rounded-full bg-[var(--bg-card)]/95 border border-[var(--border-color)] shadow-xl backdrop-blur-md flex items-center gap-2.5 animate-pulse pointer-events-none">
            <RefreshCw size={13} className="animate-spin text-[var(--accent-primary)]" />
            <span className="text-xs font-medium text-[var(--text-main)]">
              Synthesizing Knowledge Graph updates...
            </span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="w-full h-full block"
        />

        {/* Entity Types Legend */}
        {presentEntityTypes.length > 0 && (
          <div className="absolute bottom-4 left-4 z-20 p-3 sm:p-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-lg flex flex-col gap-2 pointer-events-auto max-w-[calc(100vw-32px)]">
            <div 
              className="text-[11px] font-semibold tracking-wider uppercase flex items-center justify-between gap-3"
              style={{ color: themeAccent }}
            >
              <span>Entity Types</span>
              {selectedType !== 'All' && (
                <button
                  onClick={() => setSelectedType('All')}
                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-primary)] lowercase underline cursor-pointer"
                >
                  (reset)
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-[var(--text-main)] font-medium max-w-sm sm:max-w-md">
              {presentEntityTypes.map((t) => {
                const isTypeActive = selectedType === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => setSelectedType(isTypeActive ? 'All' : t.name)}
                    className={`flex items-center gap-1.5 transition-all cursor-pointer ${
                      isTypeActive 
                        ? 'opacity-100 font-bold scale-105' 
                        : selectedType === 'All' 
                          ? 'opacity-85 hover:opacity-100' 
                          : 'opacity-40'
                    }`}
                  >
                    <span 
                      className="w-2.5 h-2.5 rounded-full shadow-xs flex-shrink-0" 
                      style={{ backgroundColor: t.bg }} 
                    />
                    <span className="text-[11.5px]">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Floating Zoom & Controls HUD */}
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1 bg-[var(--bg-card)] border border-[var(--border-color)] p-1 rounded-full shadow-xl pointer-events-auto">
          <button
            type="button"
            onClick={() => handleZoom(1.2)}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn size={15} />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(0.8)}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut size={15} />
          </button>
          <button
            type="button"
            onClick={handleResetCamera}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
            title="Center View"
          >
            <Maximize2 size={15} />
          </button>
          
          <div className="w-px h-4 bg-[var(--border-color)] mx-0.5" />
          
          <button
            type="button"
            onClick={() => setShowLabels(!showLabels)}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all cursor-pointer ${
              showLabels 
                ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-bold' 
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
            }`}
            title={showLabels ? "Hide Node Labels" : "Show Node Labels"}
          >
            {showLabels ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
          <button
            type="button"
            onClick={() => {
              setPhysicsEnabled(!physicsEnabled);
              if (!physicsEnabled) alphaRef.current = 0.8;
            }}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all cursor-pointer ${
              physicsEnabled 
                ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)]' 
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
            }`}
            title={physicsEnabled ? "Pause Physics Simulation" : "Resume Physics Simulation"}
          >
            {physicsEnabled ? <Pause size={15} /> : <Play size={15} />}
          </button>
        </div>
      </div>

      {/* Node Details Inspector */}
      {selectedNode && (
        <EntityDetailDrawer
          entity={selectedNode}
          links={graphData.links}
          allNodes={graphData.nodes}
          onClose={() => setSelectedNode(null)}
          onSelectNode={(node) => {
            setSelectedNode(node);
            setSelectedLink(null);
          }}
          onInspectDoc={onInspectDoc}
        />
      )}

      {/* Relationship Details Inspector */}
      {selectedLink && (
        <RelationshipDetailDrawer
          link={selectedLink}
          allNodes={graphData.nodes}
          onClose={() => setSelectedLink(null)}
          onSelectNode={(node) => {
            setSelectedNode(node);
            setSelectedLink(null);
          }}
          onInspectDoc={onInspectDoc}
        />
      )}

      {/* Community Insights Modal */}
      <CommunityInsightsModal
        isOpen={insightsOpen}
        communities={graphData.communities}
        onClose={() => setInsightsOpen(false)}
        onSelectCommunity={(cid) => setFilterCommunity(cid)}
      />
    </div>
  );
};
