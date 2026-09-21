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
