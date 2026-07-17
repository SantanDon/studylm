import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
// import { Trash2, Save, X, Wand2 } from "lucide-react"; // Removed Lucide imports
import { Note } from "@/hooks/useNotes";
import MarkdownRenderer from "@/components/chat/MarkdownRenderer";
import { Citation, MessageSegment } from "@/types/message";
import { parseJsonResponse } from "@/utils/jsonParser";

interface NoteEditorProps {
  note?: Note;
  onSave: (title: string, content: string) => void;
  onDelete?: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  onCitationClick?: (citation: Citation) => void;
}

const NoteEditor = ({
  note,
  onSave,
  onDelete,
  onCancel,
  isLoading,
  onCitationClick,
}: NoteEditorProps) => {
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  // AI response notes should NEVER be in edit mode - they're read-only
  const [isEditing, setIsEditing] = useState(
    !note || note.source_type === "user",
  );
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);

  useEffect(() => {
    setTitle(note?.title || "");
    setContent(note?.content || "");
    // AI response notes should NEVER be editable - they open in view mode
    setIsEditing(!note || note.source_type === "user");
  }, [note]);

  const handleSave = () => {
    if (title.trim() && content.trim()) {
      onSave(title.trim(), content.trim());
    }
  };

  const handleEdit = () => {
    // Only allow editing of user notes, not AI responses
    if (note?.source_type === "ai_response") {
      console.log("NoteEditor: Cannot edit AI response note");
      return;
    }
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (note) {
      setTitle(note.title);
      setContent(note.content);
      // AI response notes should return to view mode, user notes can be cancelled
      setIsEditing(note.source_type === "ai_response" ? false : false);
    } else {
      onCancel();
    }
  };

  const handleGenerateTitle = async () => {
    if (!note || note.source_type !== "ai_response") return;

    setIsGeneratingTitle(true);
    try {
      // Use local implementation with Ollama for title generation
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama3", // Use appropriate Ollama model
          prompt: `Generate a concise, descriptive title for the following note content. Return only the title, no additional text:\n\n${note.content}`,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate title from Ollama");
      }

      const data = await response.json();

      if (data.response) {
        const generatedTitle = data.response.trim().replace(/^["']|["']$/g, ""); // Remove quotes if present
        setTitle(generatedTitle);
      }
    } catch (error) {
      console.error("Error generating title:", error);
      // Fallback to a simple title if generation fails
      const fallbackTitle =
        note.content.length > 50
          ? note.content.substring(0, 47) + "..."
          : note.content;
      setTitle(fallbackTitle);
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  // Parse AI response content if it's structured
  interface ParsedNoteContent {
    segments: MessageSegment[];
    citations: Citation[];
  }
  
  const parseContent = (contentStr: string): string | ParsedNoteContent => {
    const parsed = parseJsonResponse<ParsedNoteContent>(
      contentStr,
      (obj): obj is ParsedNoteContent => {
        if (typeof obj !== 'object' || obj === null) return false;
        const r = obj as Record<string, unknown>;
        return Array.isArray(r.segments) && Array.isArray(r.citations);
      }
    );
    return parsed || contentStr;
  };

  const isAIResponse = note?.source_type === "ai_response";
  const parsedContent = isAIResponse ? parseContent(content) : content;

  if (!isEditing && note) {
    // View mode for existing notes
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-gray-900">
              {isAIResponse ? "AI Response" : "Note"}
            </h3>
            <div className="flex items-center space-x-2">
              {!isAIResponse && (
                <Button variant="ghost" size="sm" onClick={handleEdit}>
                  Edit
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onCancel}>
                <i className="fi fi-rr-cross h-4 w-4"></i>
              </Button>
            </div>
          </div>

          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 overflow-auto">
          {isAIResponse && typeof parsedContent === "object" ? (
            <MarkdownRenderer
              content={parsedContent}
              className="prose max-w-none"
              onCitationClick={onCitationClick}
            />
          ) : (
            <div className="whitespace-pre-wrap text-gray-700">
              {typeof parsedContent === "string" ? parsedContent : content}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex-shrink-0">
          <div className="flex justify-between">
            <div>
              {note && onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  disabled={isLoading}
                  className="text-red-600 hover:text-red-700"
                >
                  <i className="fi fi-rr-trash h-4 w-4 mr-2"></i>
                  Delete
                </Button>
              )}
            </div>
            <div className="text-xs text-gray-500">
              {note?.created_at &&
                new Date(note.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Edit mode (only for user notes or new notes)
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-gray-900">
            {note ? "Edit Note" : "New Note"}
          </h3>
          <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
            <i className="fi fi-rr-cross h-4 w-4"></i>
          </Button>
        </div>

        <div className="flex space-x-2 mb-4">
          <Input
            placeholder="Note title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1"
          />
          {isAIResponse && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateTitle}
              disabled={isGeneratingTitle}
            >
              <i className="fi fi-rr-magic-wand h-4 w-4 mr-2"></i>
              {isGeneratingTitle ? "Generating..." : "Generate Title"}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-hidden">
        <Textarea
          placeholder="Write your note here..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full h-full resize-none border-0 focus-visible:ring-0 p-0"
        />
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 flex-shrink-0">
        <div className="flex justify-between">
          <div>
            {note && onDelete && !isAIResponse && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                disabled={isLoading}
                className="text-red-600 hover:text-red-700"
              >
                <i className="fi fi-rr-trash h-4 w-4 mr-2"></i>
                Delete
              </Button>
            )}
          </div>
          <Button
            onClick={handleSave}
            disabled={!title.trim() || !content.trim() || isLoading}
            size="sm"
          >
            <i className="fi fi-rr-disk h-4 w-4 mr-2"></i>
            {isLoading ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NoteEditor;
