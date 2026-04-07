import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConceptMap, ConceptNode, ConceptEdge, NodeType } from '@/types/conceptMap';
import { cn } from '@/lib/utils';
import { 
  ReactFlow, 
  Controls, 
  Background, 
  useNodesState, 
  useEdgesState, 
  Panel,
  MarkerType,
  Handle,
  Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NODE_COLORS, EDGE_COLORS } from '@/lib/conceptMap/constants';
import { calculateNodePositions } from '@/lib/conceptMap/layoutUtils';
import { motion } from 'framer-motion';

// --- Custom Node Implementation ---
const CustomNode = ({ data, id, isConnectable }: any) => {
  const { node, isDarkMode } = data;
  const colors = NODE_COLORS[node.type as NodeType];
  
  return (
    <motion.div 
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={cn(
        "px-4 py-2 shadow-lg rounded-2xl border-2 transition-transform duration-200 cursor-grab active:cursor-grabbing",
      )}
      style={{
        backgroundColor: isDarkMode ? colors.bgDark : colors.bg,
        borderColor: isDarkMode ? colors.borderDark : colors.border,
        color: isDarkMode ? colors.textDark : colors.text,
      }}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" isConnectable={isConnectable} />
      <div className="font-semibold text-center text-xs tracking-wide">
        {node.label}
      </div>
      <div 
        className="absolute -top-1 -right-1 w-3 h-3 rounded-full border border-white/50 shadow-sm"
        style={{ backgroundColor: isDarkMode ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.5)' }}
      />
      <Handle type="source" position={Position.Bottom} className="opacity-0" isConnectable={isConnectable} />
    </motion.div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

// --- Main Component ---
interface ConceptMapViewProps {
  conceptMap: ConceptMap | null;
  isLoading?: boolean;
  onNodeClick?: (node: ConceptNode) => void;
}

const ConceptMapView: React.FC<ConceptMapViewProps> = ({
  conceptMap,
  isLoading = false,
  onNodeClick,
}) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => setIsDarkMode(document.documentElement.classList.contains('dark'));
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    if (!conceptMap) return;

    const positions = calculateNodePositions(conceptMap.nodes, conceptMap.edges);
    
    const flowNodes = conceptMap.nodes.map((node) => ({
      id: node.id,
      type: 'custom',
      position: positions.get(node.id) || { x: Math.random() * 500, y: Math.random() * 500 },
      data: { node, isDarkMode },
    }));

    const flowEdges = conceptMap.edges.map((edge) => {
      const edgeColor = EDGE_COLORS[edge.type] || EDGE_COLORS.related;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: true,
        style: { stroke: isDarkMode ? edgeColor.strokeDark : edgeColor.stroke, strokeWidth: 2 },
        labelStyle: { fill: isDarkMode ? '#9ca3af' : '#6b7280', fontWeight: 600 },
        labelBgStyle: { fill: isDarkMode ? 'rgba(31,41,55,0.9)' : 'rgba(255,255,255,0.9)' },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isDarkMode ? edgeColor.strokeDark : edgeColor.stroke,
        },
      };
    });

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [conceptMap, isDarkMode, setNodes, setEdges]);

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center h-[500px] bg-card">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="relative">
            <i className="fi fi-rr-spinner h-10 w-10 animate-spin text-primary"></i>
            <i className="fi fi-rr-sparkles h-4 w-4 absolute -top-1 -right-1 text-yellow-500 animate-pulse"></i>
          </div>
          <p className="text-sm font-medium">Generating magic map...</p>
        </div>
      </Card>
    );
  }

  if (!conceptMap || conceptMap.nodes.length === 0) {
    return (
      <Card className="flex items-center justify-center h-[500px] bg-card">
        <div className="text-center text-muted-foreground">
          <i className="fi fi-rr-map h-12 w-12 mx-auto mb-3 opacity-50"></i>
          <p className="font-medium">No concept map available</p>
        </div>
      </Card>
    );
  }

  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);

  return (
    <Card 
      ref={containerRef}
      className={cn(
        "relative overflow-hidden transition-all duration-300",
        isDarkMode ? "bg-gray-900" : "bg-slate-50",
        isFullscreen ? "fixed inset-0 z-50 rounded-none h-screen bg-background" : "h-[500px]"
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(e, node) => onNodeClick && onNodeClick(node.data.node as ConceptNode)}
        fitView
        className="touch-none"
      >
        <Background gap={24} size={1.5} color={isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'} />
        <Controls className="backdrop-blur-md bg-background/50 rounded-lg shadow-xl border-none overflow-hidden" />
        
        <Panel position="top-right" className="flex gap-2 m-4">
          <Button variant="outline" size="icon" onClick={toggleFullscreen} className="bg-background/80 backdrop-blur-sm shadow-sm ring-1 ring-white/10">
            {isFullscreen ? <i className="fi fi-rr-compress"></i> : <i className="fi fi-rr-expand"></i>}
          </Button>
        </Panel>

        <Panel position="bottom-center" className="mb-4 pointer-events-none">
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex gap-2 flex-wrap justify-center pointer-events-auto"
          >
            {(['main', 'subtopic', 'detail', 'term'] as NodeType[]).map((type) => (
              <Badge
                key={type}
                className="text-white shadow-sm"
                style={{ backgroundColor: NODE_COLORS[type].bg }}
              >
                {type}
              </Badge>
            ))}
          </motion.div>
        </Panel>
      </ReactFlow>
    </Card>
  );
};

export default ConceptMapView;
