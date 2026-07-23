import { chatCompletion, FAST_MODELS } from '@/lib/ai/ollamaService';
import { ConceptNode, ConceptEdge } from '@/types/conceptMap';
import { cleanJsonResponse } from '@/utils/jsonParser';

const CONCEPT_MAP_SYSTEM_PROMPT = `You are an expert at extracting knowledge structures from educational content. Your job is to identify the key concepts and how they relate to each other.

CRITICAL RULES:
1. Extract ACTUAL CONCEPTS from the content - not document structure
2. NEVER use "Introduction", "Chapter 1", "Section A" as concept labels
3. NEVER create nodes for metadata like "Title", "Author", "Date"
4. Node labels should be meaningful terms: "Photosynthesis", "Cell Division", "Supply and Demand"
5. Relationships should show how concepts actually connect in the subject matter
6. Descriptions should explain what the concept means, not where it appears in the document

BAD NODES (DO NOT CREATE):
- "Introduction" / "Overview" / "Summary"
- "Section 1" / "Chapter 2" / "Part A"
- "Main Topic" / "Key Points" / "Conclusion"

GOOD NODES:
- "Mitochondria" - "Organelle that produces ATP through cellular respiration"
- "Natural Selection" - "Process where organisms with favorable traits survive and reproduce"
- "Supply and Demand" - "Economic principle relating price to availability and desire"`;

const CONCEPT_MAP_PROMPT_TEMPLATE = `Analyze this content and create a concept map showing the key concepts and their relationships.

CONTENT:
{content}

OUTPUT FORMAT - Valid JSON only:
{
  "nodes": [
    {"id": "n1", "label": "Main Concept Name", "type": "main", "description": "What this concept means"},
    {"id": "n2", "label": "Related Concept", "type": "subtopic", "description": "Brief explanation"},
    {"id": "n3", "label": "Key Term", "type": "term", "description": "Definition or explanation"},
    {"id": "n4", "label": "Specific Detail", "type": "detail", "description": "Important fact or example"}
  ],
  "edges": [
    {"id": "e1", "source": "n1", "target": "n2", "label": "relationship verb", "type": "part_of"},
    {"id": "e2", "source": "n2", "target": "n3", "label": "how they connect", "type": "related"}
  ]
}

Node types: main (1 central topic), subtopic (2-5 major themes), term (3-8 key terms), detail (2-6 specifics)
Edge types: related, explains, example, part_of

Generate 8-15 meaningful concept nodes with appropriate connections.`;

interface GeneratedConceptMap {
  nodes: Array<{
    id: string;
    label: string;
    type: 'main' | 'subtopic' | 'detail' | 'term';
    description?: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    type: 'related' | 'explains' | 'example' | 'part_of';
  }>;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function parseConceptMapResponse(response: string): GeneratedConceptMap | null {
  try {
    // Clean markdown code blocks and extract JSON
    const cleaned = cleanJsonResponse(response);
    
    if (!cleaned || (!cleaned.includes('nodes') && !cleaned.includes('edges'))) {
      console.warn('No JSON object found in response');
      return null;
    }

    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      console.warn('Invalid concept map structure: missing nodes or edges arrays');
      return null;
    }

    const validNodes = parsed.nodes.filter(
      (node: unknown): node is GeneratedConceptMap['nodes'][0] =>
        typeof node === 'object' &&
        node !== null &&
        typeof (node as Record<string, unknown>).id === 'string' &&
        typeof (node as Record<string, unknown>).label === 'string' &&
        ['main', 'subtopic', 'detail', 'term'].includes((node as Record<string, unknown>).type as string)
    );

    const nodeIds = new Set(validNodes.map((n: GeneratedConceptMap['nodes'][0]) => n.id));

    const validEdges = parsed.edges.filter(
      (edge: unknown): edge is GeneratedConceptMap['edges'][0] =>
        typeof edge === 'object' &&
        edge !== null &&
        typeof (edge as Record<string, unknown>).id === 'string' &&
        typeof (edge as Record<string, unknown>).source === 'string' &&
        typeof (edge as Record<string, unknown>).target === 'string' &&
        nodeIds.has((edge as Record<string, unknown>).source as string) &&
        nodeIds.has((edge as Record<string, unknown>).target as string)
    );

    if (validNodes.length === 0) {
      console.warn('No valid nodes found in response');
      return null;
    }

    return {
      nodes: validNodes,
      edges: validEdges,
    };
  } catch (error) {
    console.error('Failed to parse concept map response:', error);

    try {
      const lines = response.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.includes('nodes')) {
          const parsed = JSON.parse(trimmed);
          if (parsed.nodes && parsed.edges) {
            return parsed as GeneratedConceptMap;
          }
        }
      }
    } catch {
      console.error('Fallback parsing also failed');
    }

    return null;
  }
}

export async function generateConceptMap(
  content: string,
  _title: string,
  model?: string,
  onProgress?: (message: string) => void
): Promise<{ nodes: ConceptNode[]; edges: ConceptEdge[] }> {
  if (!content || content.trim().length < 50) {
    throw new Error('Content is too short to generate a concept map');
  }

  const maxContentLength = 4000;
  const truncatedContent =
    content.length > maxContentLength
      ? content.substring(0, maxContentLength) + '...'
      : content;

  const prompt = CONCEPT_MAP_PROMPT_TEMPLATE.replace('{content}', truncatedContent);

  onProgress?.('Analyzing content for concepts...');

  try {
    const response = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: CONCEPT_MAP_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: model || FAST_MODELS.summarize,
      temperature: 0.4, // Lower temperature for more accurate concept extraction
    });

    onProgress?.('Parsing concept map...');

    const generatedMap = parseConceptMapResponse(response);

    if (!generatedMap) {
      throw new Error('Failed to parse concept map from the response');
    }

    const nodes: ConceptNode[] = generatedMap.nodes.map((node) => ({
      id: generateId(),
      label: node.label.trim(),
      type: node.type,
      description: node.description?.trim(),
    }));

    const idMapping = new Map<string, string>();
    generatedMap.nodes.forEach((node, index) => {
      idMapping.set(node.id, nodes[index].id);
    });

    const edges: ConceptEdge[] = generatedMap.edges
      .map((edge) => {
        const sourceId = idMapping.get(edge.source);
        const targetId = idMapping.get(edge.target);

        if (!sourceId || !targetId) {
          return null;
        }

        return {
          id: generateId(),
          source: sourceId,
          target: targetId,
          label: edge.label?.trim(),
          type: edge.type || 'related',
        } as ConceptEdge;
      })
      .filter((edge): edge is ConceptEdge => edge !== null);

    onProgress?.(`Generated concept map with ${nodes.length} concepts and ${edges.length} connections`);

    return { nodes, edges };
  } catch (error) {
    console.error('Error generating concept map:', error);
    throw new Error(
      error instanceof Error
        ? `Failed to generate concept map: ${error.message}`
        : 'Failed to generate concept map'
    );
  }
}

export async function generateConceptMapFromMultipleSources(
  sources: Array<{ id: string; title: string; content: string }>,
  onProgress?: (message: string) => void
): Promise<{ nodes: ConceptNode[]; edges: ConceptEdge[] }> {
  const allNodes: ConceptNode[] = [];
  const allEdges: ConceptEdge[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    onProgress?.(`Processing source ${i + 1}/${sources.length}: ${source.title}`);

    try {
      const { nodes, edges } = await generateConceptMap(
        source.content,
        source.title,
        undefined,
        undefined
      );

      const nodesWithSource = nodes.map((node) => ({
        ...node,
        sourceId: source.id,
      }));

      allNodes.push(...nodesWithSource);
      allEdges.push(...edges);
    } catch (error) {
      console.warn(`Failed to generate concept map for source ${source.title}:`, error);
    }
  }

  return { nodes: allNodes, edges: allEdges };
}
