import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  checkOllamaHealth,
  getAvailableModels,
  pullModel,
} from "@/lib/ai/ollamaService";

const OLLAMA_BASE_URL =
  import.meta.env.VITE_OLLAMA_URL || "http://localhost:11434";

export interface ModelInfo {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface RecommendedModel {
  name: string;
  displayName: string;
  description: string;
  size: string;
  category: "chat" | "embedding" | "code" | "vision";
  recommended: boolean;
  lowEndFriendly: boolean;
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    name: "tinyllama",
    displayName: "TinyLlama",
    description: "Ultra-fast 1.1B model, perfect for quick responses on any hardware",
    size: "637 MB",
    category: "chat",
    recommended: true,
    lowEndFriendly: true,
  },
  {
    name: "phi3:mini",
    displayName: "Phi-3 Mini",
    description: "Microsoft's efficient 3.8B model with strong reasoning capabilities",
    size: "2.3 GB",
    category: "chat",
    recommended: true,
    lowEndFriendly: true,
  },
  {
    name: "gemma2:2b",
    displayName: "Gemma 2 (2B)",
    description: "Google's lightweight 2B model optimized for efficiency",
    size: "1.6 GB",
    category: "chat",
    recommended: true,
    lowEndFriendly: true,
  },
  {
    name: "llama3.2:1b",
    displayName: "Llama 3.2 (1B)",
    description: "Meta's compact 1B model for fast local inference",
    size: "1.3 GB",
    category: "chat",
    recommended: true,
    lowEndFriendly: true,
  },
  {
    name: "llama3.2:3b",
    displayName: "Llama 3.2 (3B)",
    description: "Meta's balanced 3B model with good performance",
    size: "2.0 GB",
    category: "chat",
    recommended: false,
    lowEndFriendly: true,
  },
  {
    name: "nomic-embed-text",
    displayName: "Nomic Embed Text",
    description: "High-quality text embeddings for semantic search",
    size: "274 MB",
    category: "embedding",
    recommended: true,
    lowEndFriendly: true,
  },
  {
    name: "all-minilm",
    displayName: "All-MiniLM",
    description: "Lightweight embedding model, great for resource-constrained systems",
    size: "46 MB",
    category: "embedding",
    recommended: true,
    lowEndFriendly: true,
  },
  {
    name: "phi:2.7b",
    displayName: "Phi-2 (2.7B)",
    description: "Microsoft's efficient model optimized for code and reasoning",
    size: "1.7 GB",
    category: "code",
    recommended: false,
    lowEndFriendly: true,
  },
  {
    name: "codellama:7b",
    displayName: "Code Llama (7B)",
    description: "Meta's specialized code generation model",
    size: "3.8 GB",
    category: "code",
    recommended: false,
    lowEndFriendly: false,
  },
];

const DEFAULTS_STORAGE_KEY = "ollama-default-models";

interface DefaultModels {
  chat: string;
  embedding: string;
  code: string;
}

export function useOllamaModels() {
  const queryClient = useQueryClient();
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());

  const {
    data: isHealthy = false,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = useQuery({
    queryKey: ["ollama-health"],
    queryFn: checkOllamaHealth,
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const {
    data: installedModels = [],
    isLoading: modelsLoading,
    refetch: refetchModels,
  } = useQuery({
    queryKey: ["ollama-models"],
    queryFn: getAvailableModels,
    enabled: isHealthy,
    staleTime: 30000,
  });

  const {
    data: modelDetails = [],
    isLoading: detailsLoading,
    refetch: refetchDetails,
  } = useQuery({
    queryKey: ["ollama-model-details"],
    queryFn: async (): Promise<ModelInfo[]> => {
      if (!isHealthy) return [];
      try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
        if (!response.ok) throw new Error("Failed to fetch model details");
        const data = await response.json();
        return data.models || [];
      } catch {
        return [];
      }
    },
    enabled: isHealthy,
    staleTime: 30000,
  });

  const [defaultModels, setDefaultModels] = useState<DefaultModels>(() => {
    try {
      const stored = localStorage.getItem(DEFAULTS_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      // Ignore errors when loading stored defaults
    }
    return {
      chat: "llama3.2:1b",
      embedding: "nomic-embed-text",
      code: "phi:2.7b",
    };
  });

  useEffect(() => {
    localStorage.setItem(DEFAULTS_STORAGE_KEY, JSON.stringify(defaultModels));
  }, [defaultModels]);

  const pullModelMutation = useMutation({
    mutationFn: async (modelName: string) => {
      setDownloadingModels((prev) => new Set(prev).add(modelName));
      setDownloadProgress((prev) => ({ ...prev, [modelName]: 0 }));

      await pullModel(modelName, (progress) => {
        setDownloadProgress((prev) => ({ ...prev, [modelName]: progress }));
      });

      setDownloadingModels((prev) => {
        const next = new Set(prev);
        next.delete(modelName);
        return next;
      });
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[modelName];
        return next;
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ollama-models"] });
      queryClient.invalidateQueries({ queryKey: ["ollama-model-details"] });
    },
    onError: (_, modelName) => {
      setDownloadingModels((prev) => {
        const next = new Set(prev);
        next.delete(modelName);
        return next;
      });
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[modelName];
        return next;
      });
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: async (modelName: string) => {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName }),
      });
      if (!response.ok) {
        throw new Error(`Failed to delete model: ${response.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ollama-models"] });
      queryClient.invalidateQueries({ queryKey: ["ollama-model-details"] });
    },
  });

  const getModelInfo = useCallback(
    async (modelName: string): Promise<ModelInfo | null> => {
      try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelName }),
        });
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    },
    []
  );

  const isModelInstalled = useCallback(
    (modelName: string): boolean => {
      const baseName = modelName.split(":")[0];
      return installedModels.some(
        (m) => m === modelName || m.startsWith(baseName + ":")
      );
    },
    [installedModels]
  );

  const setDefaultModel = useCallback(
    (task: keyof DefaultModels, modelName: string) => {
      setDefaultModels((prev) => ({ ...prev, [task]: modelName }));
    },
    []
  );

  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }, []);

  return {
    isHealthy,
    healthLoading,
    installedModels,
    modelsLoading,
    modelDetails,
    detailsLoading,
    recommendedModels: RECOMMENDED_MODELS,
    defaultModels,
    downloadProgress,
    downloadingModels,
    pullModel: pullModelMutation.mutate,
    isPulling: pullModelMutation.isPending,
    deleteModel: deleteModelMutation.mutate,
    isDeleting: deleteModelMutation.isPending,
    getModelInfo,
    isModelInstalled,
    setDefaultModel,
    formatBytes,
    refetchHealth,
    refetchModels,
    refetchDetails,
  };
}
