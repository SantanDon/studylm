import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

/**
 * Generate source-type specific fallback questions
 * These are used when AI generation fails - they should still encourage source-based answers
 */
function getSourceTypeQuestions(sourceType: string, title?: string): string[] {
  // Clean up title for use in questions
  const cleanTitle = title 
    ? title.replace(/^(Understanding|Introduction to|Guide to|The Basics of)\s+/i, '').trim()
    : null;
  const shortTitle = cleanTitle && cleanTitle.length > 40 ? cleanTitle.substring(0, 40) + '...' : cleanTitle;
  
  // If we have a title, create title-specific questions
  if (shortTitle) {
    return [
      `What are the main concepts covered in "${shortTitle}"?`,
      `Explain the key points about ${shortTitle}`,
      `What important details are mentioned about this topic?`,
      `How does the source explain ${shortTitle}?`,
      `What should I understand about ${shortTitle}?`
    ];
  }
  
  // Generic fallback by source type
  const questionsByType: Record<string, string[]> = {
    youtube: [
      "What are the main points discussed in this video?",
      "What key concepts does the speaker explain?",
      "What examples or cases are mentioned?",
      "What conclusions or recommendations are made?",
      "Summarize the most important information"
    ],
    website: [
      "What is the main topic of this article?",
      "What key facts or information are presented?",
      "What are the important points to understand?",
      "How does the article explain the main concepts?",
      "What are the key takeaways?"
    ],
    pdf: [
      "What is the main subject of this document?",
      "What are the key findings or points?",
      "Explain the main concepts covered",
      "What important details should I know?",
      "Summarize the document's main arguments"
    ],
    text: [
      "What is this content about?",
      "What are the main points covered?",
      "Explain the key ideas presented",
      "What important information is included?",
      "What should I understand from this?"
    ],
    audio: [
      "What topics are discussed?",
      "What are the main points made?",
      "What key information is shared?",
      "What conclusions are reached?",
      "Summarize the important content"
    ]
  };
  
  return questionsByType[sourceType] || questionsByType.text;
}

export const useNotebookGeneration = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useAuth();

  const generateNotebookContent = useMutation({
    mutationFn: async ({
      notebookId,
      filePath,
      sourceType,
    }: {
      notebookId: string;
      filePath?: string;
      sourceType: string;
    }) => {
      console.log("🚀 Ultra-fast notebook generation:", {
        notebookId,
        filePath,
        sourceType,
      });

      // Guard against missing notebook ID
      if (!notebookId) {
        throw new Error("Notebook ID is required for notebook generation");
      }

      // Mark notebook as generating so UI can reflect status
      if (!session?.access_token) {
        localStorageService.updateNotebook(notebookId, {
          generation_status: "processing",
        });
      }

      // 1. Instantly tap local storage cache to bypass any Vercel DB sync delays
      let cachedContent = "";
      let cachedTitle = "Untitled";

      try {
        if (filePath) {
          const cachedFileStr = localStorage.getItem(`file_${filePath}`);
          if (cachedFileStr) {
            const cachedFile = JSON.parse(cachedFileStr);
            cachedContent = cachedFile.content || "";
            cachedTitle = cachedFile.name || "Untitled";
          }
        }
      } catch (e) {
        // ignore
      }

      // 2. Try to match by file_path OR url from the cloud sources
      let sources: any[] = [];
      try {
        if (session?.access_token) {
          const res = await ApiService.fetchSources(notebookId, session.access_token);
          sources = Array.isArray(res) ? res : [];
        } else {
          const res = await localStorageService.getSources(notebookId);
          sources = Array.isArray(res) ? res : [];
        }
      } catch (err) {
        console.warn("Failed to fetch sources for generation:", err);
        sources = [];
      }
      
      let source = sources.find((s) => s.file_path === filePath) ||
                     sources.find((s) => s.url === filePath) ||
                     sources[0]; // Fallback to first source if no match

      // 3. Patch the race condition: Inject cached content if the cloud missed it
      if (!source) {
        source = { title: cachedTitle, content: cachedContent, type: sourceType };
      } else {
        source.content = source.content || cachedContent;
        source.title = source.title || cachedTitle;
      }

      console.log(`📄 Found source for generation: ${source?.title || 'None'}, type: ${source?.type || 'unknown'}`);

      let title = `Notebook: ${source?.title || "Untitled"}`;
      let description = `Generated from ${source?.type || "source"}`;
      let exampleQuestions: string[] = getSourceTypeQuestions(sourceType, source?.title);

      try {
        // Use enhanced Ollama service for ultra-fast generation
        const { generateTitle, chatCompletion, checkOllamaHealth } = await import('@/lib/ai/ollamaService');
        const { isOllamaEnabled } = await import('@/config/ollamaConfig');

        const isHealthy = await checkOllamaHealth();
        const canUseAI = isHealthy || !isOllamaEnabled();

        if (canUseAI && source?.content) {
          console.log("⚡ Generating with AI...");

          // Check if the content contains extraction error messages
          const hasExtractionError = source.content.includes("extraction failed") || 
                                   source.content.includes("Unable to extract text") ||
                                   source.content.includes("PDF contains no extractable text") ||
                                   source.content.includes("extraction/OCR failed") ||
                                   source.content.includes("encrypted or password-protected") ||
                                   source.content.includes("corrupted or in an unsupported format");
          
          // Only generate title from content if it's not an error message
          let generatedTitleResult: string | null = null;
          if (!hasExtractionError) {
            try {
              generatedTitleResult = await generateTitle(source.content);
            } catch (error) {
              console.warn("Title generation failed:", error);
              generatedTitleResult = null;
            }
          } else {
            console.log("⚠️ Skipping title generation from error content");
            generatedTitleResult = null;
          }

          // Generate other content as normal
          const [generatedDescription, generatedQuestions] = await Promise.all([
            chatCompletion({
              messages: [
                {
                  role: 'system',
                  content: hasExtractionError 
                    ? 'This source had content extraction errors. Provide a generic description related to the source type.' 
                    : 'Generate a brief 1-sentence description of this content. Be concise.',
                },
                {
                  role: 'user',
                  content: hasExtractionError 
                    ? `Source type: ${source.type}. Content extraction failed, so provide a generic description for a ${source.type} file.`
                    : source.content.substring(0, 1000),
                },
              ],
              temperature: 0.5,
            }).catch((err) => {
              console.warn("Summary generation failed, falling back to content snippet:", err);
              // Fallback to content snippet if AI fails
              if (source.content && source.content.length > 50 && !hasExtractionError) {
                return source.content.substring(0, 300).replace(/\s+/g, ' ').trim() + "...";
              }
              return description;
            }),
            // Generate example questions based on source content (skip if error content)
            hasExtractionError 
              ? Promise.resolve([
                  "What are the main topics covered?",
                  "Can you provide a summary?",
                  "What key concepts are discussed?"
                ])
              : chatCompletion({
                  messages: [
                    {
                      role: 'system',
                      content: `You are generating discussion questions for a study notebook. Generate 5 questions that are DIRECTLY related to and answerable from the source content.

STRICT RULES:
1. ONLY ask about topics, terms, concepts, or facts that are EXPLICITLY mentioned in the content
2. Extract key terms/concepts from the content and use them in your questions
3. Questions must be specific to THIS content - not generic questions that could apply to any document
4. If the content is about "Cyber Law", ask about cyber law. If it's about "Biology", ask about biology.
5. Keep questions under 80 characters
6. Return ONLY the questions, one per line, no numbering

FORMAT: Just the questions, nothing else.`,
                    },
                    {
                      role: 'user',
                      content: `Read this content carefully and generate 5 questions ONLY about topics mentioned in it:\n\n${source.content.substring(0, 4000)}`,
                    },
                  ],
                  temperature: 0.3, // Lower temperature for more focused output
                }).then(response => {
                  console.log("📝 Raw question generation response:", response);
                  
                  // Parse questions from response - more robust parsing
                  const questions = response
                    .split('\n')
                    .map(q => q.trim())
                    // Remove numbering, bullets, quotes, dashes at start
                    .map(q => q.replace(/^[\d.\-*•–—]+\s*/, '').replace(/^["']|["']$/g, '').trim())
                    // Filter valid questions (must have ? or be a command like "Explain...")
                    .filter(q => q.length > 15 && q.length < 100 && (q.includes('?') || q.toLowerCase().startsWith('explain')))
                    .slice(0, 5);
                  
                  console.log("📝 Parsed questions:", questions);
                  
                  // If we got good questions, return them
                  if (questions.length >= 3) {
                    return questions;
                  }
                  
                  // Fallback to content-aware generic questions based on source type
                  const sourceType = source.type || 'document';
                  const fallbackQuestions = getSourceTypeQuestions(sourceType, source.title);
                  return fallbackQuestions;
                }).catch((err) => {
                  console.error("Question generation failed:", err);
                  return getSourceTypeQuestions(source.type || 'document', source.title);
                }),
          ]);

          // Prioritize generated title, use fallback only if generation fails or is empty
          title = generatedTitleResult && generatedTitleResult.trim().length > 0 ? generatedTitleResult : title;
          description = generatedDescription;
          exampleQuestions = generatedQuestions;

          console.log("✅ Generated:", { title, description, exampleQuestions });
        }
      } catch (error) {
        console.error("Generation error (using fallback):", error);
      }

      // Update the notebook with title/description
      let updatedNotebook: any;
      if (session?.access_token) {
        updatedNotebook = await ApiService.updateNotebook(
          notebookId, 
          { 
            title, 
            description,
            example_questions: exampleQuestions || [],
            generation_status: 'completed'
          }, 
          session.access_token
        );
      } else {
        updatedNotebook = localStorageService.updateNotebook(notebookId, {
          title,
          description,
          example_questions: exampleQuestions || [],
          generation_status: 'completed',
        });
      }

      if (!updatedNotebook) {
        throw new Error(`Failed to update notebook with ID ${notebookId}`);
      }

      return {
        title,
        description,
        notebook: updatedNotebook,
      };
    },
    onSuccess: (data) => {
      console.log("Notebook generation successful:", data);

      // Invalidate relevant queries to refresh the UI
      // Use the specific notebook ID to ensure the correct notebook is refreshed
      queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      queryClient.invalidateQueries({ queryKey: ["notebook", data.notebook?.id] });
      // Also invalidate sources to ensure UI is updated
      queryClient.invalidateQueries({ queryKey: ["sources", data.notebook?.id] });

      toast({
        title: "Content Generated",
        description:
          "Notebook title and description have been generated successfully.",
      });
    },
    onError: (error: unknown) => {
      console.error("Notebook generation failed:", error);

      const err = error as {
        name?: string;
        message?: string;
        context?: unknown;
      };

      const errorMessage =
        err?.message ||
        "Failed to generate notebook content. Please try again.";

      toast({
        title: "Generation Failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  return {
    generateNotebookContent: generateNotebookContent.mutate,
    generateNotebookContentAsync: generateNotebookContent.mutateAsync,
    isGenerating: generateNotebookContent.isPending,
  };
};
