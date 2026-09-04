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

const COMMUNITY_FALLBACK_COLORS = [
  '#FB923C', '#0284C7', '#8B5CF6', '#10B981', '#06B6D4', 
  '#F43F5E', '#F59E0B', '#6366F1', '#EC4899', '#14B8A6'
];

export const getNodeStyle = (type?: string, communityId: number = 0) => {
  const norm = (type || 'Concept').trim();
  for (const [key, val] of Object.entries(ENTITY_PALETTES)) {
    if (key.toLowerCase() === norm.toLowerCase()) {
      return val;
    }
  }
  // Deterministic open-domain HSL pastel generator for arbitrary domain concepts
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash << 5) - hash + norm.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  const bg = `hsl(${hue}, 75%, 48%)`;
  const border = `hsl(${hue}, 85%, 38%)`;
  return { bg, border, label: norm };
};

interface KnowledgeGraphViewProps {
  onInspectDoc?: (doc: { filename: string; page?: number; content?: string }) => void;
  className?: string;
}

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({
  onInspectDoc,
  className = '',
}) => {
  const { theme, currentConfig } = useTheme();
  const isDark = currentConfig?.category === 'Dark' || theme.includes('dark');

  const [graphData, setGraphData] = useState<KnowledgeGraphData>({
    nodes: [],
    links: [],
    communities: [],
    stats: { total_nodes: 0, total_links: 0, total_communities: 0 },
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [building, setBuilding] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [selectedDoc, setSelectedDoc] = useState<string>('All');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedLink, setSelectedLink] = useState<GraphLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [insightsOpen, setInsightsOpen] = useState<boolean>(false);
  const [filterCommunity, setFilterCommunity] = useState<number | null>(null);

  // Customization Settings
  const [showEdgeLabels, setShowEdgeLabels] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [physicsEnabled, setPhysicsEnabled] = useState<boolean>(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const animFrameRef = useRef<number>(0);

  const transformRef = useRef<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 });
  const isDraggingCanvasRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggedNodeRef = useRef<GraphNode | null>(null);

  // Fetch Knowledge Graph with Strict Link Deduplication
  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getGraph();
      
      const width = 800;
      const height = 600;
      const initializedNodes = (data.nodes || []).map((n: GraphNode, i: number) => {
        const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
        const radius = 130 + (n.community_id * 30) + Math.random() * 70;
        return {
          ...n,
          x: width / 2 + Math.cos(angle) * radius,
          y: height / 2 + Math.sin(angle) * radius,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
        };
      });

      // Strict Frontend Link Deduplication
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
  }, [loadGraph]);

  const handleRebuild = async () => {
    try {
      setBuilding(true);
      await api.buildGraph(true);
      
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        await loadGraph();
        if (attempts >= 6) {
          clearInterval(interval);
          setBuilding(false);
        }
      }, 2500);
    } catch (err) {
      console.error("Failed to trigger graph build", err);
      setBuilding(false);
    }
  };

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
      const matchType = selectedType === 'All' || n.type?.toLowerCase() === selectedType.toLowerCase() || (selectedType === 'Entity' && (!n.type || n.type === 'Concept' || n.type === 'Entity'));
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

    // Also include connected nodes for links belonging to selected doc
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

  const themeAccent = currentConfig?.previewColors?.accent || '#0284C7';
  const [docDropdownOpen, setDocDropdownOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return graphData.nodes
      .filter(n => n.name.toLowerCase().includes(q) || (n.type && n.type.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [graphData.nodes, searchQuery]);

  const centerOnNode = useCallback((node: GraphNode) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;
    const k = 1.4;
    transformRef.current = {
      x: centerX - (node.x || 0) * k,
      y: centerY - (node.y || 0) * k,
      k: k
    };
    setSelectedNode(node);
    setSelectedLink(null);
    setSearchFocused(false);
  }, []);

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

  // Main Canvas Rendering Engine
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
      ctx.scale(dpr, dpr);
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    // Physics Simulation Step (Spacious MiroFish Layout)
    const runSimulationStep = () => {
      if (!physicsEnabled) return;
      
      const nodes = nodesRef.current;
      const links = linksRef.current;
      const width = canvas.clientWidth || 800;
      const height = canvas.clientHeight || 600;
      const center = { x: width / 2, y: height / 2 };

      const nodeMap = new Map(nodes.map(n => [n.id, n]));

      // 1. Gentle Centering Gravity
      for (const n of nodes) {
        if (n === draggedNodeRef.current) continue;
        const dx = center.x - (n.x || 0);
        const dy = center.y - (n.y || 0);
        n.vx = (n.vx || 0) + dx * 0.00025;
        n.vy = (n.vy || 0) + dy * 0.00025;
      }

      // 2. Coulomb Node Repulsion (Spacious to prevent overlaps)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = (b.x || 0) - (a.x || 0);
          const dy = (b.y || 0) - (a.y || 0);
          const distSq = dx * dx + dy * dy + 120;
          const dist = Math.sqrt(distSq);
          const force = 540 / distSq;

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

      // 3. Link Spring Attraction (targetDist 120px for spacious legibility)
      for (const link of links) {
        const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        const src = nodeMap.get(srcId);
        const tgt = nodeMap.get(tgtId);

        if (src && tgt) {
          const dx = (tgt.x || 0) - (src.x || 0);
          const dy = (tgt.y || 0) - (src.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const targetDist = 120;
          const force = (dist - targetDist) * 0.012;

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
      const damping = 0.86;
      for (const n of nodes) {
        if (n === draggedNodeRef.current) continue;
        n.vx = (n.vx || 0) * damping;
        n.vy = (n.vy || 0) * damping;
        n.x = (n.x || 0) + (n.vx || 0);
        n.y = (n.y || 0) + (n.vy || 0);
      }
    };

    // Canvas Render Function: Pixel-Perfect MiroFish Style with Sufficient Curves & Theme Colors
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

      // MiroFish Subtle Dot Grid
      const gridSize = 42;
      const startX = Math.floor((-transform.x / transform.k) / gridSize) * gridSize - gridSize;
      const endX = startX + (width / transform.k) + gridSize * 2;
      const startY = Math.floor((-transform.y / transform.k) / gridSize) * gridSize - gridSize;
      const endY = startY + (height / transform.k) + gridSize * 2;
      
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)';
      for (let gx = startX; gx < endX; gx += gridSize) {
        for (let gy = startY; gy < endY; gy += gridSize) {
          ctx.beginPath();
          ctx.arc(gx, gy, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const nodes = nodesRef.current;
      const links = linksRef.current;
      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const isFilteringActive = selectedDoc !== 'All' || selectedType !== 'All' || filterCommunity !== null;

      // 1. Draw Links with Sufficient Elegant Curves
      const highlightedLinks: Array<{ link: GraphLink; src: GraphNode; tgt: GraphNode; ctrlX: number; ctrlY: number; labelX: number; labelY: number; dist: number }> = [];

      for (let idx = 0; idx < links.length; idx++) {
        const link = links[idx];
        const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        const src = nodeMap.get(srcId);
        const tgt = nodeMap.get(tgtId);

        if (!src || !tgt) continue;
        if (isFilteringActive && (!activeNodeIds.has(src.id) || !activeNodeIds.has(tgt.id))) continue;

        const isDirectlySelectedLink = selectedLink && (
          (selectedLink.id && link.id && selectedLink.id === link.id) ||
          ((typeof selectedLink.source === 'object' ? (selectedLink.source as any).id : selectedLink.source) === srcId &&
           (typeof selectedLink.target === 'object' ? (selectedLink.target as any).id : selectedLink.target) === tgtId)
        );

        const isConnectedToSelectedNode = selectedNode && (src.id === selectedNode.id || tgt.id === selectedNode.id);
        const isHighlighted = isDirectlySelectedLink || isConnectedToSelectedNode;

        const midX = ((src.x || 0) + (tgt.x || 0)) / 2;
        const midY = ((src.y || 0) + (tgt.y || 0)) / 2;
        const dx = (tgt.x || 0) - (src.x || 0);
        const dy = (tgt.y || 0) - (src.y || 0);
        const dist = Math.hypot(dx, dy) || 1;
        const normalX = -dy / dist;
        const normalY = dx / dist;

        // Sufficient smooth curvature
        const curveFactor = Math.min(30, Math.max(16, dist * 0.14));
        const curveSign = idx % 2 === 0 ? 1 : -1;
        const ctrlX = midX + normalX * curveFactor * curveSign;
        const ctrlY = midY + normalY * curveFactor * curveSign;

        // Exact midpoint on quadratic bezier curve
        const labelX = 0.25 * (src.x || 0) + 0.5 * ctrlX + 0.25 * (tgt.x || 0);
        const labelY = 0.25 * (src.y || 0) + 0.5 * ctrlY + 0.25 * (tgt.y || 0);

        if (isHighlighted) {
          highlightedLinks.push({ link, src, tgt, ctrlX, ctrlY, labelX, labelY, dist });
          continue;
        }

        // Standard MiroFish Smooth Curved Line (Subtle & Light)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(src.x || 0, src.y || 0);
        ctx.quadraticCurveTo(ctrlX, ctrlY, tgt.x || 0, tgt.y || 0);
        ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(203, 213, 225, 0.75)';
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.9;
        ctx.stroke();

        // Unclicked Edge Label Badge (Light Minimalist Pill)
        if (showEdgeLabels && transform.k > 0.45 && dist > 45) {
          const text = (link.type || '').toUpperCase().trim();
          ctx.font = '500 8px "JetBrains Mono", Inter, monospace';
          const textMetrics = ctx.measureText(text);
          const pad = 3.5;
          const boxW = textMetrics.width + pad * 2;
          const boxH = 12;
          
          ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.90)' : 'rgba(255, 255, 255, 0.95)';
          ctx.beginPath();
          ctx.roundRect(labelX - boxW / 2, labelY - boxH / 2, boxW, boxH, 3);
          ctx.fill();

          ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';
          ctx.lineWidth = 0.5;
          ctx.stroke();

          ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, labelX, labelY);
        }
        ctx.restore();
      }

      // 2. Draw Highlighted Edges for Clicked Node / Clicked Link (Soft, Elegant Accent)
      for (const { link, src, tgt, ctrlX, ctrlY, labelX, labelY, dist } of highlightedLinks) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(src.x || 0, src.y || 0);
        ctx.quadraticCurveTo(ctrlX, ctrlY, tgt.x || 0, tgt.y || 0);
        ctx.strokeStyle = themeAccent;
        ctx.lineWidth = 1.35;
        ctx.globalAlpha = 0.85;
        ctx.stroke();

        // Highlighted Edge Label Badge (Soft & Light Border)
        if (showEdgeLabels && transform.k > 0.4 && dist > 40) {
          const text = (link.type || '').toUpperCase().trim();
          ctx.font = '500 8.5px "JetBrains Mono", Inter, monospace';
          const textMetrics = ctx.measureText(text);
          const pad = 4.5;
          const boxW = textMetrics.width + pad * 2;
          const boxH = 14;
          
          ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.96)' : '#ffffff';
          ctx.beginPath();
          ctx.roundRect(labelX - boxW / 2, labelY - boxH / 2, boxW, boxH, 3.5);
          ctx.fill();

          // Soft, non-harsh micro-border
          ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
          ctx.lineWidth = 0.6;
          ctx.stroke();

          ctx.fillStyle = themeAccent;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, labelX, labelY);
        }
        ctx.restore();
      }

      // 3. Draw Nodes (MiroFish Flat Pastel Dots & Theme-Compatible Selection)
      for (const node of nodes) {
        if (isFilteringActive && !activeNodeIds.has(node.id)) continue;

        const isSelected = selectedNode?.id === node.id;
        const isHovered = hoveredNode?.id === node.id;
        const isConnectedToSelected = (selectedNode && links.some(l => {
          const sId = typeof l.source === 'object' ? (l.source as any).id : l.source;
          const tId = typeof l.target === 'object' ? (l.target as any).id : l.target;
          return (sId === selectedNode.id && tId === node.id) || (tId === selectedNode.id && sId === node.id);
        })) || (selectedLink && (
          (typeof selectedLink.source === 'object' ? (selectedLink.source as any).id : selectedLink.source) === node.id ||
          (typeof selectedLink.target === 'object' ? (selectedLink.target as any).id : selectedLink.target) === node.id
        ));

        const nodeStyle = getNodeStyle(node.type, node.community_id);
        const baseRadius = 5.2 + Math.min(2.5, (node.degree || 1) * 0.35);
        const radius = isSelected ? baseRadius + 1.8 : isConnectedToSelected ? baseRadius + 0.5 : baseRadius;

        ctx.save();
        ctx.globalAlpha = 1.0;

        // Solid Pastel Node Circle (Theme Compatible when selected)
        ctx.beginPath();
        ctx.arc(node.x || 0, node.y || 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? themeAccent : nodeStyle.bg;
        ctx.fill();

        // Active / Hovered / Default Border adhering directly to the node (Tight & Sticking to Perimeter)
        if (isSelected) {
          // Inner crisp white ring directly on perimeter
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.0;
          ctx.stroke();

          // Tight theme-compatible border sticking directly to the node (no spacing/gap)
          ctx.beginPath();
          ctx.arc(node.x || 0, node.y || 0, radius + 0.3, 0, Math.PI * 2);
          ctx.strokeStyle = themeAccent;
          ctx.lineWidth = 1.8;
          ctx.stroke();
        } else if (isHovered) {
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.0;
          ctx.stroke();

          // Tightly adhering soft hover border
          ctx.beginPath();
          ctx.arc(node.x || 0, node.y || 0, radius + 0.3, 0, Math.PI * 2);
          ctx.strokeStyle = nodeStyle.border;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else if (isConnectedToSelected) {
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.0;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(node.x || 0, node.y || 0, radius + 0.3, 0, Math.PI * 2);
          ctx.strokeStyle = `${nodeStyle.bg}AA`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        } else {
          // Clean White Border
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.0;
          ctx.stroke();
        }

        // Node Label Beside the Dot (Clean, No Blurry White Paint Clouds)
        if (showLabels && (transform.k > 0.45 || isHovered || isSelected || isConnectedToSelected)) {
          const displayName = node.name.length > 12 ? node.name.slice(0, 11) + '...' : node.name;
          ctx.font = `${(isSelected) ? 'bold 11px' : (isHovered) ? '600 10.5px' : '500 10px'} "JetBrains Mono", Inter, -apple-system, sans-serif`;
          
          const labelX = (node.x || 0) + radius + (isSelected ? 5.5 : 4.5);
          const labelY = (node.y || 0) + 0.5;

          // Subtle, clean contrast stroke
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.strokeStyle = isDark ? 'rgba(15, 23, 42, 0.90)' : 'rgba(255, 255, 255, 0.92)';
          ctx.lineWidth = 2.4;
          ctx.strokeText(displayName, labelX, labelY);

          // Solid theme-friendly label text
          ctx.fillStyle = isSelected 
            ? themeAccent 
            : isHovered 
              ? (isDark ? '#F8FAFC' : '#0F172A')
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

  // Non-passive wheel event listener to allow preventDefault for smooth zoom without browser console error
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

  // Auto-focus camera when filtering by document or entity type
  useEffect(() => {
    if (selectedDoc === 'All' && selectedType === 'All' && filterCommunity === null) return;
    if (!canvasRef.current || activeNodeIds.size === 0) return;
    
    const matchingNodes = nodesRef.current.filter(n => activeNodeIds.has(n.id));
    if (matchingNodes.length > 0) {
      const avgX = matchingNodes.reduce((acc, n) => acc + (n.x || 0), 0) / matchingNodes.length;
      const avgY = matchingNodes.reduce((acc, n) => acc + (n.y || 0), 0) / matchingNodes.length;
      const canvas = canvasRef.current;
      const centerX = canvas.clientWidth / 2;
      const centerY = canvas.clientHeight / 2;
      transformRef.current = {
        x: centerX - avgX * 1.15,
        y: centerY - avgY * 1.15,
        k: 1.15
      };
    }
  }, [selectedDoc, selectedType, filterCommunity, activeNodeIds]);

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

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Close open dropdowns on canvas click
    if (docDropdownOpen) setDocDropdownOpen(false);
    if (searchFocused) setSearchFocused(false);

    const world = screenToWorld(e.clientX, e.clientY);
    const isFilteringActive = selectedDoc !== 'All' || selectedType !== 'All' || filterCommunity !== null;
    
    // 1. Check Node Click
    const clickedNode = nodesRef.current.find((n) => {
      if (isFilteringActive && !activeNodeIds.has(n.id)) return false;
      const dx = (n.x || 0) - world.x;
      const dy = (n.y || 0) - world.y;
      return dx * dx + dy * dy < 280;
    });

    if (clickedNode) {
      draggedNodeRef.current = clickedNode;
      setSelectedNode(clickedNode);
      setSelectedLink(null);
      return;
    }

    // 2. Check Edge / Relationship Label Click (MiroFish Relationship View)
    const nodeMap = new Map(nodesRef.current.map(n => [n.id, n]));
    const clickedLink = linksRef.current.find((link) => {
      const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
      if (isFilteringActive && (!activeNodeIds.has(srcId) || !activeNodeIds.has(tgtId))) return false;
      const src = nodeMap.get(srcId);
      const tgt = nodeMap.get(tgtId);
      if (!src || !tgt) return false;

      // Check distance to midpoint / label
      const midX = ((src.x || 0) + (tgt.x || 0)) / 2;
      const midY = ((src.y || 0) + (tgt.y || 0)) / 2;
      const dMidSq = (midX - world.x) * (midX - world.x) + (midY - world.y) * (midY - world.y);
      if (dMidSq < 320) return true;

      // Distance to line segment
      const x1 = src.x || 0, y1 = src.y || 0, x2 = tgt.x || 0, y2 = tgt.y || 0;
      const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
      if (l2 === 0) return false;
      const t = Math.max(0, Math.min(1, ((world.x - x1) * (x2 - x1) + (world.y - y1) * (y2 - y1)) / l2));
      const projX = x1 + t * (x2 - x1);
      const projY = y1 + t * (y2 - y1);
      const dSegSq = (world.x - projX) * (world.x - projX) + (world.y - projY) * (world.y - projY);
      return dSegSq < 55;
    });

    if (clickedLink) {
      setSelectedLink(clickedLink);
      setSelectedNode(null);
      return;
    }

    // 3. Canvas Drag
    isDraggingCanvasRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setSelectedNode(null);
    setSelectedLink(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(e.clientX, e.clientY);
    const isFilteringActive = selectedDoc !== 'All' || selectedType !== 'All' || filterCommunity !== null;

    if (draggedNodeRef.current) {
      draggedNodeRef.current.x = world.x;
      draggedNodeRef.current.y = world.y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
    } else if (isDraggingCanvasRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      transformRef.current.x += dx;
      transformRef.current.y += dy;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    } else {
      const hoverNode = nodesRef.current.find((n) => {
        if (isFilteringActive && !activeNodeIds.has(n.id)) return false;
        const dx = (n.x || 0) - world.x;
        const dy = (n.y || 0) - world.y;
        return dx * dx + dy * dy < 250;
      });
      setHoveredNode(hoverNode || null);
    }
  };

  const handleMouseUp = () => {
    draggedNodeRef.current = null;
    isDraggingCanvasRef.current = false;
  };

  const handleZoom = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t = transformRef.current;
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;
    const newK = Math.max(0.2, Math.min(4.0, t.k * factor));

    t.x = centerX - (centerX - t.x) * (newK / t.k);
    t.y = centerY - (centerY - t.y) * (newK / t.k);
    t.k = newK;
  };

  const handleResetCamera = () => {
    transformRef.current = { x: 0, y: 0, k: 1 };
  };

  return (
    <div className={`relative w-full h-full flex flex-col bg-[var(--bg-main)] overflow-hidden select-none ${className}`}>
      {/* Top HUD Control Bar (Spacious, High-End Scale) */}
      <div className="absolute top-5 left-5 right-5 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Left: Search Bar with Suggestions & Custom Docs Selector */}
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Interactive Search Pill */}
          <div className="relative">
            <div className="relative flex items-center">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 pointer-events-none flex items-center justify-center text-[var(--text-muted)]">
                <Search size={16} />
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
                className="h-11 pl-11 pr-10 w-60 sm:w-80 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[13.5px] text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/20 shadow-md transition-all font-normal"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchFocused(false);
                  }}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Search Suggestions Dropdown */}
            {searchFocused && searchResults.length > 0 && (
              <div className="absolute left-0 mt-2.5 w-88 p-2 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-2xl z-50 flex flex-col gap-1 text-[13px] animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3.5 py-1.5 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                  Matching Entities ({searchResults.length})
                </div>
                {searchResults.map((node) => {
                  const style = getNodeStyle(node.type, node.community_id);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => centerOnNode(node)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] text-left transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-3 h-3 rounded-full flex-shrink-0 shadow-xs" style={{ backgroundColor: style.bg }} />
                        <span className="font-medium text-[13px] text-[var(--text-main)] truncate group-hover:text-[var(--accent-primary)] transition-colors">
                          {node.name}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--text-muted)] px-2 py-0.5 rounded-md bg-[var(--bg-sidebar)] flex-shrink-0 font-mono">
                        {node.type || 'Entity'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Custom Document Selector Dropdown */}
          {sourceDocs.length > 2 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setDocDropdownOpen(!docDropdownOpen)}
                className={`h-11 flex items-center gap-2.5 px-4 rounded-full bg-[var(--bg-card)] border text-[13.5px] font-medium shadow-md transition-all cursor-pointer ${
                  docDropdownOpen 
                    ? 'border-[var(--accent-primary)] text-[var(--accent-primary)] ring-2 ring-[var(--accent-primary)]/20' 
                    : 'border-[var(--border-color)] text-[var(--text-main)] hover:border-[var(--accent-primary)]/40 hover:bg-[var(--bg-hover)]'
                }`}
                title="Filter by vault document"
              >
                <FolderOpen size={16} className="text-[var(--accent-primary)] flex-shrink-0" />
                <span className="max-w-[150px] truncate">
                  {selectedDoc === 'All' ? 'All Vault Docs' : selectedDoc}
                </span>
                <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform duration-200 ${docDropdownOpen ? 'rotate-180 text-[var(--accent-primary)]' : ''}`} />
              </button>

              {docDropdownOpen && (
                <div className="absolute left-0 mt-2.5 w-64 max-h-64 overflow-y-auto p-2 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-2xl z-50 flex flex-col gap-1 text-[13px] animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-3.5 py-1.5 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                    Filter By Document
                  </div>
                  {sourceDocs.map((doc) => {
                    const isDocSelected = selectedDoc === doc;
                    return (
                      <button
                        key={doc}
                        type="button"
                        onClick={() => {
                          setSelectedDoc(doc);
                          setDocDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                          isDocSelected 
                            ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-bold' 
                            : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          {doc === 'All' ? (
                            <FolderOpen size={15} className="text-[var(--accent-primary)] flex-shrink-0" />
                          ) : (
                            <FileText size={15} className="text-[var(--text-muted)] flex-shrink-0" />
                          )}
                          <span className="truncate">{doc === 'All' ? 'All Vault Docs' : doc}</span>
                        </div>
                        {isDocSelected && <Check size={14} className="text-[var(--accent-primary)] flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Show Edge Labels Pill Toggle (Theme Compatible), Insights, Refresh */}
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Show Edge Labels Pill Toggler (Theme Compatible Active Color) */}
          <button
            type="button"
            onClick={() => setShowEdgeLabels(prev => !prev)}
            className="h-11 flex items-center gap-3 px-4 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] shadow-md hover:border-[var(--accent-primary)]/40 hover:bg-[var(--bg-hover)] transition-all cursor-pointer select-none"
            title="Toggle edge label visibility"
          >
            <div 
              className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out ${showEdgeLabels ? '' : 'bg-slate-300 dark:bg-slate-700'}`}
              style={{ backgroundColor: showEdgeLabels ? themeAccent : undefined }}
            >
              <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${showEdgeLabels ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <span className="text-[13.5px] font-medium text-[var(--text-main)] whitespace-nowrap">
              Show Edge Labels
            </span>
          </button>

          {/* Community Insights Modal Trigger */}
          <button
            type="button"
            onClick={() => setInsightsOpen(true)}
            className="h-11 flex items-center gap-2.5 px-4 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[13.5px] font-medium text-[var(--text-main)] hover:border-[var(--accent-primary)] hover:bg-[var(--bg-hover)] shadow-md transition-all cursor-pointer"
          >
            <Sparkles size={16} className="text-[var(--accent-primary)]" />
            <span className="hidden sm:inline">Insights</span>
            <span className="px-2 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[11px] font-bold">
              {graphData.communities.length}
            </span>
          </button>

          {/* Rebuild Graph Trigger */}
          <button
            type="button"
            onClick={handleRebuild}
            disabled={building}
            className="h-11 flex items-center gap-2.5 px-5 rounded-full bg-[var(--accent-primary)] text-white text-[13.5px] font-semibold hover:opacity-90 shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 active:scale-98"
          >
            <RefreshCw size={15} className={building ? 'animate-spin' : ''} />
            <span>{building ? 'Building...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Main Canvas Stage */}
      <div className="flex-1 relative w-full h-full cursor-grab active:cursor-grabbing">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <OrbitingOrbLoader size="lg" />
            <span className="text-xs text-[var(--text-muted)] font-mono">
              Loading Knowledge Graph...
            </span>
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center justify-center mb-3 text-[var(--accent-primary)] shadow-sm">
              <Network size={24} />
            </div>
            <h3 className="font-bold text-sm text-[var(--text-main)] mb-1">Knowledge Graph is Empty</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mb-4">
              Upload documents into your Knowledge Vault, then click "Refresh" to extract pastel entities and relationships.
            </p>
            <button
              onClick={handleRebuild}
              disabled={building}
              className="px-4 py-2 rounded-xl bg-[var(--accent-primary)] text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-md cursor-pointer"
            >
              {building ? 'Building Graph...' : 'Build Knowledge Graph Now'}
            </button>
          </div>
        ) : null}

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="w-full h-full block"
        />

        {/* MiroFish-Style Floating Entity Types Legend (Dynamic: Only Present Entity Types) */}
        {presentEntityTypes.length > 0 && (
          <div className="absolute bottom-4 left-4 z-20 p-3.5 sm:p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-xl flex flex-col gap-2.5 pointer-events-auto max-w-[calc(100vw-32px)]">
            <div 
              className="text-[11px] font-bold tracking-wider uppercase flex items-center justify-between gap-3"
              style={{ color: themeAccent }}
            >
              <span>ENTITY TYPES</span>
              {selectedType !== 'All' && (
                <button
                  onClick={() => setSelectedType('All')}
                  className="text-[9px] text-[var(--text-muted)] hover:text-[var(--accent-primary)] lowercase underline cursor-pointer"
                >
                  (reset)
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--text-main)] font-medium max-w-md">
              {presentEntityTypes.map((t) => {
                const isTypeActive = selectedType === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => setSelectedType(isTypeActive ? 'All' : t.name)}
                    className={`flex items-center gap-2 transition-all cursor-pointer ${
                      isTypeActive 
                        ? 'opacity-100 font-bold scale-105' 
                        : selectedType === 'All' 
                          ? 'opacity-90 hover:opacity-100' 
                          : 'opacity-40'
                    }`}
                  >
                    <span 
                      className="w-2.5 h-2.5 rounded-full shadow-sm flex-shrink-0" 
                      style={{ backgroundColor: t.bg }} 
                    />
                    <span className="text-[12px]">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Floating Zoom & Controls HUD (Sleek Horizontal Glassmorphic Dock) */}
        <div className="absolute bottom-5 right-5 z-20 flex items-center gap-1 bg-[var(--bg-card)] border border-[var(--border-color)] p-1.5 rounded-full shadow-2xl pointer-events-auto">
          <button
            type="button"
            onClick={() => handleZoom(1.2)}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(0.8)}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            onClick={handleResetCamera}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
            title="Center View"
          >
            <Maximize2 size={16} />
          </button>
          
          <div className="w-px h-5 bg-[var(--border-color)] mx-1" />
          
          <button
            type="button"
            onClick={() => setShowLabels(!showLabels)}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-all cursor-pointer ${
              showLabels 
                ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] shadow-2xs font-bold' 
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
            }`}
            title={showLabels ? "Hide Node Labels" : "Show Node Labels"}
          >
            {showLabels ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setPhysicsEnabled(!physicsEnabled)}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-all cursor-pointer ${
              physicsEnabled 
                ? 'bg-[var(--accent-subtle)] text-[var(--accent-primary)] shadow-2xs' 
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
            }`}
            title={physicsEnabled ? "Pause Physics Simulation" : "Resume Physics Simulation"}
          >
            {physicsEnabled ? <Pause size={16} /> : <Play size={16} />}
          </button>
        </div>
      </div>

      {/* Slide-out Node Details Inspector (MiroFish Style) */}
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

      {/* Slide-out Relationship Details Inspector (MiroFish Style) */}
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
