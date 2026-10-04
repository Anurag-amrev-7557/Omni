export interface GraphNode {
  id: string;
  name: string;
  type: string;
  description?: string;
  aliases?: string[];
  community_id: number;
  degree: number;
  pagerank: number;
  source_docs?: string[];
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphLink {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  weight: number;
  description?: string;
  source_doc: string;
  page_num?: number;
  snippet?: string;
}

export interface GraphCommunity {
  id: number;
  level: number;
  title: string;
  summary: string;
  key_entities: string[];
  findings: string[];
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  communities: GraphCommunity[];
  stats: {
    total_nodes: number;
    total_links: number;
    total_communities: number;
  };
}
