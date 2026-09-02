import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { 
  Network, 
  Sparkles, 
  Search, 
  RefreshCw, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Layers, 
  SlidersHorizontal,
  Info,
  ChevronRight
} from 'lucide-react';
import { api } from '../../services/api';
import { GraphNode, GraphLink, GraphCommunity, KnowledgeGraphData } from '../../types/graph';
import { EntityDetailDrawer } from './EntityDetailDrawer';
import { CommunityInsightsModal } from './CommunityInsightsModal';
import { OrbitingOrbLoader } from '../common/OrbitingOrbLoader';

// Color palette for community clusters
const COMMUNITY_COLORS = [
  '#da7756', // Terracotta Accent
  '#3b82f6', // Electric Blue
  '#8b5cf6', // Violet
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#84cc16', // Lime
];

interface KnowledgeGraphViewProps {
  onInspectDoc?: (doc: { filename: string; page?: number; content?: string }) => void;
  className?: string;
}

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({
  onInspectDoc,
  className = '',
}) => {
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
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [insightsOpen, setInsightsOpen] = useState<boolean>(false);
  const [filterCommunity, setFilterCommunity] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const animFrameRef = useRef<number>(0);

  // Camera Pan & Zoom Transform
  const transformRef = useRef<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 });
  const isDraggingCanvasRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggedNodeRef = useRef<GraphNode | null>(null);

  // Fetch Knowledge Graph
  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getGraph();
      
      // Initialize physics coordinates in a circular cluster layout
      const width = 800;
      const height = 600;
      const initializedNodes = (data.nodes || []).map((n: GraphNode, i: number) => {
        const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
        const radius = 120 + (n.community_id * 35) + Math.random() * 80;
        return {
          ...n,
          x: width / 2 + Math.cos(angle) * radius,
          y: height / 2 + Math.sin(angle) * radius,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
        };
      });

      nodesRef.current = initializedNodes;
      linksRef.current = data.links || [];

      setGraphData({
        nodes: initializedNodes,
        links: data.links || [],
        communities: data.communities || [],
        stats: data.stats || { total_nodes: 0, total_links: 0, total_communities: 0 },
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

  // Handle Trigger Rebuild with auto-polling
  const handleRebuild = async () => {
    try {
      setBuilding(true);
      await api.buildGraph();
      
      // Poll every 2.5s for updated graph data
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        await loadGraph();
        if (attempts >= 4) {
          clearInterval(interval);
          setBuilding(false);
        }
      }, 2500);
    } catch (err) {
      console.error("Failed to trigger graph build", err);
      setBuilding(false);
    }
  };

  // Filtered nodes based on Type, Search, and Community
  const activeNodeIds = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const set = new Set<string>();
    
    nodesRef.current.forEach((n) => {
      const matchType = selectedType === 'All' || n.type === selectedType;
      const matchQuery = !q || n.name.toLowerCase().includes(q) || (n.description || '').toLowerCase().includes(q);
      const matchCommunity = filterCommunity === null || n.community_id === filterCommunity;

      if (matchType && matchQuery && matchCommunity) {
        set.add(n.id);
      }
    });
    return set;
  }, [searchQuery, selectedType, filterCommunity]);

  // Unique Entity Types
  const entityTypes = useMemo(() => {
    const types = new Set<string>(['All']);
    graphData.nodes.forEach(n => {
      if (n.type) types.add(n.type);
    });
    return Array.from(types);
  }, [graphData.nodes]);

  // High-performance 2.5D Force-Directed Simulation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;

    // Responsive Canvas Resizing
    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    // Physics Simulation Step
    const runSimulationStep = () => {
      const nodes = nodesRef.current;
      const links = linksRef.current;
      const width = canvas.clientWidth || 800;
      const height = canvas.clientHeight || 600;
      const center = { x: width / 2, y: height / 2 };

      // Node map for fast lookups
      const nodeMap = new Map(nodes.map(n => [n.id, n]));

      // 1. Central Gravity Well
      for (const n of nodes) {
        if (n === draggedNodeRef.current) continue;
        const dx = center.x - (n.x || 0);
        const dy = center.y - (n.y || 0);
        n.vx = (n.vx || 0) + dx * 0.0004;
        n.vy = (n.vy || 0) + dy * 0.0004;
      }

      // 2. Coulomb Repulsion between nodes
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = (b.x || 0) - (a.x || 0);
          const dy = (b.y || 0) - (a.y || 0);
          const distSq = dx * dx + dy * dy + 100;
          const dist = Math.sqrt(distSq);
          const force = 380 / distSq;

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

      // 3. Hooke Spring Attraction along Links
      for (const link of links) {
        const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        const src = nodeMap.get(srcId);
        const tgt = nodeMap.get(tgtId);

        if (src && tgt) {
          const dx = (tgt.x || 0) - (src.x || 0);
          const dy = (tgt.y || 0) - (src.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const targetDist = 75;
          const force = (dist - targetDist) * 0.015;

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

      // 4. Velocity Damping & Position Update
      const damping = 0.88;
      for (const n of nodes) {
        if (n === draggedNodeRef.current) continue;
        n.vx = (n.vx || 0) * damping;
        n.vy = (n.vy || 0) * damping;
        n.x = (n.x || 0) + (n.vx || 0);
        n.y = (n.y || 0) + (n.vy || 0);
      }
    };

    // Canvas Render Function
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

      const nodes = nodesRef.current;
      const links = linksRef.current;
      const nodeMap = new Map(nodes.map(n => [n.id, n]));

      // 1. Draw Links
      for (const link of links) {
        const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        const src = nodeMap.get(srcId);
        const tgt = nodeMap.get(tgtId);

        if (src && tgt) {
          const isHighlighted = (selectedNode && (src.id === selectedNode.id || tgt.id === selectedNode.id)) ||
                                (hoveredNode && (src.id === hoveredNode.id || tgt.id === hoveredNode.id));
          const isDimmed = (selectedNode || hoveredNode) && !isHighlighted;

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(src.x || 0, src.y || 0);
          ctx.lineTo(tgt.x || 0, tgt.y || 0);
          ctx.strokeStyle = isHighlighted ? '#da7756' : isDimmed ? 'rgba(150,150,150,0.1)' : 'rgba(150,150,150,0.22)';
          ctx.lineWidth = isHighlighted ? 2.2 : 1.0;
          ctx.stroke();

          // Link relation label if highlighted
          if (isHighlighted && transform.k > 0.8) {
            const midX = ((src.x || 0) + (tgt.x || 0)) / 2;
            const midY = ((src.y || 0) + (tgt.y || 0)) / 2;
            ctx.font = '10px monospace';
            ctx.fillStyle = '#da7756';
            ctx.textAlign = 'center';
            ctx.fillText(link.type, midX, midY - 3);
          }
          ctx.restore();
        }
      }

      // 2. Draw Nodes
      for (const node of nodes) {
        const isActive = activeNodeIds.has(node.id);
        const isSelected = selectedNode?.id === node.id;
        const isHovered = hoveredNode?.id === node.id;
        const isDimmed = !isActive || ((selectedNode || hoveredNode) && !isSelected && !isHovered);

        const commColor = COMMUNITY_COLORS[node.community_id % COMMUNITY_COLORS.length] || '#da7756';
        const baseRadius = Math.max(5, Math.min(18, 5 + (node.degree || 1) * 1.6 + (node.pagerank || 1) * 2));
        const radius = isSelected || isHovered ? baseRadius * 1.3 : baseRadius;

        ctx.save();
        
        // Community Glow Halo
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(node.x || 0, node.y || 0, radius + 8, 0, Math.PI * 2);
          ctx.fillStyle = `${commColor}33`;
          ctx.fill();
        }

        // Main Node Body
        ctx.beginPath();
        ctx.arc(node.x || 0, node.y || 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = isDimmed ? 'rgba(120,120,120,0.3)' : commColor;
        ctx.globalAlpha = isDimmed ? 0.35 : 1.0;
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(0,0,0,0.3)';
        ctx.lineWidth = isSelected ? 2.5 : 1.0;
        ctx.stroke();

        // Node Label (Visible if zoomed in or highlighted)
        if (transform.k > 0.65 || isSelected || isHovered) {
          ctx.font = `${isSelected ? 'bold 12px' : '11px'} Inter, sans-serif`;
          ctx.fillStyle = isDimmed ? 'rgba(150,150,150,0.4)' : '#e4e4e7';
          ctx.textAlign = 'center';
          ctx.fillText(node.name, node.x || 0, (node.y || 0) + radius + 13);
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
  }, [activeNodeIds, selectedNode, hoveredNode]);

  // Coordinate Conversion: Screen to World
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

  // Mouse / Touch Interaction Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(e.clientX, e.clientY);
    
    // Check if clicking a node
    const clicked = nodesRef.current.find(n => {
      const dx = (n.x || 0) - world.x;
      const dy = (n.y || 0) - world.y;
      const r = 12 + (n.degree || 1);
      return dx * dx + dy * dy <= r * r;
    });

    if (clicked) {
      draggedNodeRef.current = clicked;
      setSelectedNode(clicked);
    } else {
      isDraggingCanvasRef.current = true;
      dragStartRef.current = { x: e.clientX - transformRef.current.x, y: e.clientY - transformRef.current.y };
      setSelectedNode(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(e.clientX, e.clientY);

    if (draggedNodeRef.current) {
      draggedNodeRef.current.x = world.x;
      draggedNodeRef.current.y = world.y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
    } else if (isDraggingCanvasRef.current) {
      transformRef.current.x = e.clientX - dragStartRef.current.x;
      transformRef.current.y = e.clientY - dragStartRef.current.y;
    } else {
      // Hover detection
      const hovered = nodesRef.current.find(n => {
        const dx = (n.x || 0) - world.x;
        const dy = (n.y || 0) - world.y;
        const r = 12 + (n.degree || 1);
        return dx * dx + dy * dy <= r * r;
      });
      setHoveredNode(hovered || null);
    }
  };

  const handleMouseUp = () => {
    draggedNodeRef.current = null;
    isDraggingCanvasRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const newK = Math.max(0.2, Math.min(4.0, transformRef.current.k * zoomFactor));

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    transformRef.current.x = mouseX - (mouseX - transformRef.current.x) * (newK / transformRef.current.k);
    transformRef.current.y = mouseY - (mouseY - transformRef.current.y) * (newK / transformRef.current.k);
    transformRef.current.k = newK;
  };

  // Zoom Controls
  const handleZoom = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.clientWidth / 2;
    const cy = canvas.clientHeight / 2;
    const newK = Math.max(0.2, Math.min(4.0, transformRef.current.k * factor));
    transformRef.current.x = cx - (cx - transformRef.current.x) * (newK / transformRef.current.k);
    transformRef.current.y = cy - (cy - transformRef.current.y) * (newK / transformRef.current.k);
    transformRef.current.k = newK;
  };

  const handleResetCamera = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    transformRef.current = { x: 0, y: 0, k: 1 };
  };

  return (
    <div className={`relative w-full h-full flex flex-col bg-[var(--bg-main)] overflow-hidden select-none ${className}`}>
      {/* Top Floating Control Bar */}
      <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Left: Search & Filter Controls */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="relative flex items-center">
            <Search size={14} className="absolute left-3 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search knowledge graph..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 w-48 sm:w-64 rounded-xl bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--border-color)] text-xs text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] shadow-md"
            />
          </div>

          {/* Type Filter Dropdown */}
          <div className="flex items-center gap-1 bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--border-color)] p-1 rounded-xl shadow-md">
            {entityTypes.slice(0, 4).map((t) => (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  selectedType === t
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Stats & Action Buttons */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Community Insights Modal Trigger */}
          <button
            onClick={() => setInsightsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--border-color)] text-xs font-medium text-[var(--text-main)] hover:border-[var(--accent-primary)] shadow-md transition-all cursor-pointer"
          >
            <Sparkles size={13} className="text-[var(--accent-primary)]" />
            <span>Community Insights</span>
            <span className="px-1.5 py-0.2 rounded bg-[var(--accent-subtle)] text-[var(--accent-primary)] font-mono text-[10px]">
              {graphData.communities.length}
            </span>
          </button>

          {/* Rebuild Graph Trigger */}
          <button
            onClick={handleRebuild}
            disabled={building}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--accent-primary)] text-white text-xs font-medium hover:opacity-90 shadow-md transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={building ? 'animate-spin' : ''} />
            <span>{building ? 'Extracting...' : 'Build Graph'}</span>
          </button>
        </div>
      </div>

      {/* Main Canvas Stage */}
      <div className="flex-1 relative w-full h-full cursor-grab active:cursor-grabbing">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <OrbitingOrbLoader size="lg" />
            <span className="text-xs text-[var(--text-muted)] font-mono">
              Loading 2.5D Knowledge Graph...
            </span>
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center justify-center mb-3 text-[var(--accent-primary)] shadow-sm">
              <Network size={24} />
            </div>
            <h3 className="font-bold text-sm text-[var(--text-main)] mb-1">Knowledge Graph is Empty</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mb-4">
              Upload documents into your Knowledge Vault, then click "Build Graph" to automatically extract entities and relationships.
            </p>
            <button
              onClick={handleRebuild}
              disabled={building}
              className="px-4 py-2 rounded-xl bg-[var(--accent-primary)] text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-md"
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
          onWheel={handleWheel}
          className="w-full h-full block"
        />

        {/* Floating Zoom & Pan HUD */}
        <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1.5 bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--border-color)] p-1.5 rounded-xl shadow-lg">
          <button
            onClick={() => handleZoom(1.2)}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn size={15} />
          </button>
          <button
            onClick={() => handleZoom(0.8)}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut size={15} />
          </button>
          <button
            onClick={handleResetCamera}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            title="Center View"
          >
            <Maximize2 size={15} />
          </button>
        </div>

        {/* Floating Bottom Stats Pill */}
        <div className="absolute bottom-4 left-4 z-20 px-3 py-1.5 rounded-xl bg-[var(--bg-card)]/90 backdrop-blur-md border border-[var(--border-color)] shadow-md text-[11px] text-[var(--text-muted)] flex items-center gap-3 font-mono">
          <span>{graphData.stats.total_nodes} Entities</span>
          <span>·</span>
          <span>{graphData.stats.total_links} Relations</span>
          <span>·</span>
          <span>{graphData.stats.total_communities} Communities</span>
        </div>
      </div>

      {/* Slide-out Entity Detail Inspector */}
      {selectedNode && (
        <EntityDetailDrawer
          entity={selectedNode}
          links={graphData.links}
          allNodes={graphData.nodes}
          onClose={() => setSelectedNode(null)}
          onSelectNode={(node) => setSelectedNode(node)}
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
