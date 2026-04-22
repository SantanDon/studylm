/**
 * Content Validation Module for Hallucination Prevention
 * 
 * Provides utilities to validate document content quality and detect potential issues
 * that could lead to AI hallucinations.
 */

export interface ContentValidationResult {
  isValid: boolean;
  isHighQuality: boolean;
  issues: string[];
  confidenceScore: number;
  suggestions: string[];
}

/**
 * Validates document content to prevent hallucinations
 */
export async function validateDocumentContent(
  content: string,
  fileName: string = "document"
): Promise<ContentValidationResult> {
  const result: ContentValidationResult = {
    isValid: true,
    isHighQuality: true,
    issues: [],
    confidenceScore: 1.0,
    suggestions: []
  };

  // Check for basic content validity
  if (!content || content.trim().length === 0) {
    result.isValid = false;
    result.isHighQuality = false;
    result.issues.push("Document contains no content");
    result.confidenceScore = 0.0;
    return result;
  }

  // Special handling for PDF error messages that are designed to inform users
  // If content is clearly an error message rather than actual document content, mark it appropriately
  // This check needs to come BEFORE the general extraction error check to avoid false positives
  const pdfErrorIndicators = [
    "pdf extraction error: unable to extract text from",
    "this pdf may be:",
    "scanned images without ocr",
    "encrypted or password-protected",
    "corrupted or in an unsupported format",
    "pdf contains no extractable text",
    "extraction/ocr failed",
    "may be scanned images or extraction/ocr failed"
  ];

  const hasPdfError = pdfErrorIndicators.some(indicator =>
    content.toLowerCase().includes(indicator.toLowerCase())
  );

  if (hasPdfError) {
    // This is likely a system-generated error message, not user content
    // We should allow this through but note it for the user interface
    result.isValid = true; // It's valid as an error message
    result.isHighQuality = false;
    result.issues.push("PDF extraction resulted in an error message");
    result.confidenceScore = 0.1; // Very low confidence since it's an error
    result.suggestions.push("This PDF could not be processed. Try a different PDF or convert to text format.");
    return result;
  }

  // Check for general extraction error messages (only if not already identified as PDF error)
  const extractionErrorPatterns = [
    /extraction failed/i,
    /unable to extract text/i,
    /pdf contains no extractable text/i,
    /extraction\/ocr failed/i,
    /encrypted or password-protected/i,
    /corrupted or in an unsupported format/i,
    /no text extracted/i,
    /no text extracted from.*page/i,
    /no usable text/i
  ];

  for (const pattern of extractionErrorPatterns) {
    if (pattern.test(content)) {
      // Check if this is just an error message from the system or actual document content
      // If the content is very likely to be an error message (short, with specific error patterns), mark as invalid
      // INCREASED WORD THRESHOLD FOR ERROR DETECTION: System errors are rarely more than 40 words.
      const isLikelyErrorMessage = content.split(/\s+/).length < 40 &&
                                   (content.toLowerCase().includes("error") ||
                                    content.toLowerCase().includes("failed") ||
                                    content.toLowerCase().includes("unable") ||
                                    content.toLowerCase().includes("cannot"));

      if (isLikelyErrorMessage) {
        result.isValid = false;
        result.isHighQuality = false;
        result.issues.push("Document content indicates extraction failure");
        result.confidenceScore = 0.0;
        result.suggestions.push("Verify the original document is not password-protected, corrupted, or image-based without OCR");
        return result;
      } else {
        // If content is longer and might be actual document text, be more lenient
        // This allows for documents that might contain the words "extraction" or "failed" in normal context
        result.isHighQuality = false;
        result.issues.push("Content contains phrases often associated with system errors");
        result.confidenceScore = 0.8; // High confidence because it's long, despite the keywords
        break;
      }
    }
  }

  // Check for content quality
  const qualityIssues = checkContentQuality(content, fileName);
  
  if (qualityIssues.length > 0) {
    result.isHighQuality = false;
    result.issues.push(...qualityIssues);

    // More aggressive confidence reduction based on severity
    const issueCount = qualityIssues.length;

    // Check for critical quality issues that should invalidate the content
    const criticalIssues = qualityIssues.filter(issue =>
      issue.includes("binary") ||
      issue.includes("encoded data") ||
      issue.includes("only numbers or symbols") ||
      issue.includes("non-human text") ||
      issue.includes("control characters")
    );

    if (criticalIssues.length > 0) {
      // Determine if we should be lenient based on file type
      const isLenientType = fileName.toLowerCase().endsWith(".pdf") || 
                           fileName.toLowerCase().endsWith(".jpg") || 
                           fileName.toLowerCase().endsWith(".png");

      if (isLenientType) {
        // For PDFs and images, binary/control characters are often just formatting artifacts
        result.isHighQuality = false;
        result.confidenceScore = 0.3;
        result.suggestions.push("Content contains formatting artifacts (control characters); proceed with caution.");
        console.warn(`[Validator] Lenient validation for ${fileName}: Allowing ${criticalIssues.length} control artifacts.`);
      } else {
        // If there are critical issues in other types, mark as invalid
        result.isValid = false;
        result.confidenceScore = 0.0;
        result.suggestions.push("Content has critical quality issues. Please review and correct the source file.");
      }
    } else {
      // For non-critical issues, reduce confidence
      result.confidenceScore = Math.max(0.1, 1 - (issueCount * 0.15)); // Minimum 10% confidence

      // Add suggestions for quality issues
      qualityIssues.forEach(issue => {
        if (issue.includes("too repetitive")) {
          result.suggestions.push("Document may contain repeated text patterns; consider preprocessing to remove duplicates");
        } else if (issue.includes("too many special characters")) {
          result.suggestions.push("Document may contain non-text artifacts; consider cleaning the input");
        } else if (issue.includes("too short")) {
          result.suggestions.push("Document has very little content; consider adding more relevant information");
        } else if (issue.includes("contains only numbers")) {
          result.suggestions.push("Document appears to be primarily numeric; ensure it has meaningful text content");
        } else if (issue.includes("binary") || issue.includes("encoded")) {
          result.suggestions.push("Document appears to contain non-text content; verify the source file is proper text.");
        }
      });
    }
  }

  return result;
}

/**
 * Performs detailed content quality checks
 */
function checkContentQuality(content: string, fileName: string): string[] {
  const issues: string[] = [];
  const lines = content.split('\n').filter(line => line.trim().length > 0);

  // Check document length
  const wordCount = content.split(/\s+/).filter(word => word.length > 0).length;
  if (wordCount < 10) {
    issues.push("Document is too short with only " + wordCount + " words");
  }

  // Check for repetitive content
  const uniqueLines = new Set(lines);
  if (uniqueLines.size < lines.length * 0.5) { // Less than 50% unique lines
    issues.push("Document contains too much repetitive content");
  }

  const uniqueChars = new Set(content);
  const charDiversity = uniqueChars.size / Math.max(1, content.length);
  if (charDiversity < 0.001) { // Reduced from 0.1 to 0.001 for long documents
    issues.push("Document has extremely low character diversity, may contain repetitive artifacts");
  }

  // Check if content appears to be primarily non-text
  const nonTextRegex = /[^a-zA-Z0-9\s.,;:!?'"()[\]{}\-_+=|\\/@#$%^&*~`<>\n\r\t]/g;
  const nonTextChars = content.match(nonTextRegex) || [];
  const nonTextRatio = nonTextChars.length / Math.max(1, content.length);

  // Check for sequences that look like binary or encoded content
  const longNumberSequences = content.match(/\d{20,}/g) || []; // Very long number sequences
  if (longNumberSequences.length > 0) {
    issues.push("Document contains long number sequences that may be encoded data");
  }

  // Check for potential base64 or encoded content patterns
  const potentialEncoded = content.match(/[A-Za-z0-9+/=]{50,}/g) || [];
  if (potentialEncoded.length > 0) {
    issues.push("Document may contain encoded content that needs decoding");
  }

  // Check for content that's mostly numbers
  const numberCount = (content.match(/\d/g) || []).length;
  const letterCount = (content.match(/[a-zA-Z]/g) || []).length;
  if (letterCount / Math.max(1, content.length) < 0.1) {
    issues.push("Document contains only numbers or symbols, not meaningful text");
  }

  const letterRatio = letterCount / Math.max(1, content.length);
  if (letterRatio < 0.05) { // Reduced from 0.15 to 0.05 for legal/technical docs
    issues.push("Document contains excessively high special character density");
  }

  // Check for potential binary content by checking for null bytes or control characters
  // eslint-disable-next-line no-control-regex
  const binaryChars = content.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || [];
  if (binaryChars.length > 0) {
    issues.push("Document contains binary or control characters");
  }

  // Check for readability using sentence structure
  const sentenceCount = content.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  if (wordCount > 50 && sentenceCount === 0) {
    issues.push("Document lacks proper sentence structure");
  }

  // Check for excessive line length (could indicate formatting issues)
  const longLines = lines.filter(line => line.length > 200);
  if (longLines.length > lines.length * 0.5) { // Increased threshold to 50% to be more lenient
    issues.push("Document has too many lines with excessive length, may be improperly formatted");
  }

  // Check for content that might be machine-generated or not human-readable
  const avgWordLength = content.split(/\s+/).reduce((sum, word) => sum + word.length, 0) / Math.max(1, content.split(/\s+/).length);
  if (avgWordLength > 50) { // Increased from 20 to 50 for legal/technical docs
    issues.push("Document has unusually long average word length, may contain technical data or non-human text");
  }

  // Additional check: if content has good amount of readable text, be more lenient
  // This helps with PDFs that might have some formatting artifacts but are still readable
  if (letterRatio > 0.5 && wordCount > 20) {
    // If content has mostly readable text, remove some of the formatting-related issues
    return issues.filter(issue =>
      !issue.includes("excessive length") &&
      !issue.includes("average word length") &&
      !issue.includes("special characters") // Keep this one but with more lenient threshold
    );
  }

  return issues;
}

/**
 * Validates if a query can be reliably answered from the given content
 */
export async function validateQueryContext(
  query: string,
  content: string,
  minRelevanceScore: number = 0.3
): Promise<{
  canBeAnswered: boolean;
  relevanceScore: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}> {
  // This would typically involve semantic similarity calculations
  // For now, we'll implement a basic keyword overlap approach
  // In a real implementation, this would use embedding similarity
  
  if (!content || content.trim().length === 0) {
    return {
      canBeAnswered: false,
      relevanceScore: 0,
      confidence: 'low',
      reason: 'No content available to answer the query'
    };
  }

  const queryTerms = new Set(
    query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2)
  );

  const contentLower = content.toLowerCase();
  let matchingTerms = 0;

  for (const term of queryTerms) {
    if (contentLower.includes(term)) {
      matchingTerms++;
    }
  }

  const relevanceScore = matchingTerms / Math.max(1, queryTerms.size);
  const confidence = relevanceScore >= minRelevanceScore ? 'high' : 
                    relevanceScore >= minRelevanceScore * 0.5 ? 'medium' : 'low';

  return {
    canBeAnswered: relevanceScore >= minRelevanceScore,
    relevanceScore,
    confidence,
    reason: relevanceScore >= minRelevanceScore 
      ? 'Content contains relevant terms to answer the query' 
      : 'Content lacks sufficient relevant terms to answer the query'
  };
}

/**
 * Validates AI response against source content to detect potential hallucinations
 */
export async function validateAIResponse(
  response: string,
  sourceContents: string[],
  query: string
): Promise<{
  isGrounded: boolean;
  hallucinationRisk: 'low' | 'medium' | 'high';
  issues: string[];
  confidenceScore: number;
}> {
  const issues: string[] = [];
  let confidenceScore = 1.0;

  // Check if response contains obvious hallucinations
  if (response.toLowerCase().includes("i don't know") ||
      response.toLowerCase().includes("i'm not sure")) {
    // These are not hallucinations, they're honest responses
    return {
      isGrounded: true,
      hallucinationRisk: 'low',
      issues: [],
      confidenceScore: 0.9
    };
  }

  // Check for certainty claims without evidence
  const certaintyPhrases = [
    /absolutely certain/i,
    /definitely states/i,
    /clearly indicates/i,
    /unequivocally shows/i
  ];

  for (const phrase of certaintyPhrases) {
    if (phrase.test(response)) {
      issues.push("Response contains unwarranted certainty claims");
      confidenceScore -= 0.2;
    }
  }

  // Check response against source content
  let hasSourceSupport = false;
  const responseLower = response.toLowerCase();

  for (const source of sourceContents) {
    const sourceLower = source.toLowerCase();

    // Check for overlap in key terms
    const responseTerms = responseLower
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 4); // Only check longer terms

    let matchingTerms = 0;
    for (const term of responseTerms) {
      if (sourceLower.includes(term)) {
        matchingTerms++;
      }
    }

    if (matchingTerms / Math.max(1, responseTerms.length) > 0.1) { // 10% overlap
      hasSourceSupport = true;
      break;
    }
  }

  if (!hasSourceSupport && sourceContents.some(content => content.trim().length > 0)) {
    issues.push("Response appears to lack direct support from source content");
    confidenceScore = Math.max(0, confidenceScore - 0.4);
  }

  // Determine hallucination risk
  const riskLevel: 'low' | 'medium' | 'high' = confidenceScore >= 0.8 ? 'low' :
                                       confidenceScore >= 0.5 ? 'medium' : 'high';

  return {
    isGrounded: riskLevel !== 'high',
    hallucinationRisk: riskLevel,
    issues,
    confidenceScore: Math.max(0, confidenceScore)
  };
}

/**
 * Validates citations in AI response against source documents
 */
export async function validateCitations(
  response: string,
  sources: Array<{ id: string; title: string; content: string }>,
  strictMode: boolean = false
): Promise<{
  isValid: boolean;
  issues: string[];
  verifiedCitations: { citation: string; sourceId: string; found: boolean }[];
  confidenceScore: number;
}> {
  const issues: string[] = [];
  const verifiedCitations: { citation: string; sourceId: string; found: boolean }[] = [];

  // Extract citation patterns like [1], [2], [3], etc. or Source: X
  const citationPattern = /\[(\d+)\]|[Ss]ource:\s*(\w+)/g;
  const matches = [...response.matchAll(citationPattern)];

  if (matches.length === 0) {
    return {
      isValid: !strictMode, // If strict mode, no citations is problematic; otherwise OK
      issues: strictMode ? ["AI response contains no citations"] : [],
      verifiedCitations: [],
      confidenceScore: strictMode ? 0.5 : 0.8
    };
  }

  // Map sources by their likely citation identifiers
  const sourceMap = new Map<string, { id: string; title: string; content: string }>();
  sources.forEach((source, index) => {
    // Add numeric citation (for [1], [2], etc.)
    sourceMap.set((index + 1).toString(), source);
    // Add ID-based citation
    sourceMap.set(source.id, source);
    // Add title-based citation (simplified)
    const titleKey = source.title.toLowerCase().replace(/\s+/g, '');
    sourceMap.set(titleKey, source);
  });

  // Validate each citation
  for (const match of matches) {
    const citationNumber = match[1]; // For [X] format
    const citationText = match[2]; // For Source: X format
    const citation = citationNumber || citationText;

    if (!citation) continue;

    const source = sourceMap.get(citation);
    if (source) {
      // Check if the cited source content actually supports the context around the citation
      const found = response.toLowerCase().includes(source.title.toLowerCase()) ||
                   (source.content.toLowerCase().length > 0);

      verifiedCitations.push({
        citation: match[0],
        sourceId: source.id,
        found: found
      });
    } else {
      issues.push(`Citation "${match[0]}" does not match any available source`);
      verifiedCitations.push({
        citation: match[0],
        sourceId: '',
        found: false
      });
    }
  }

  // Calculate validity based on citation verification
  const validCitations = verifiedCitations.filter(c => c.found).length;
  const totalCitations = verifiedCitations.length;
  const citationAccuracy = totalCitations > 0 ? validCitations / totalCitations : 1;

  let confidenceScore = citationAccuracy;
  if (issues.length > 0) {
    confidenceScore = Math.max(0, confidenceScore - (issues.length * 0.1));
  }

  const isValid = confidenceScore > 0.5 || (totalCitations === 0 && !strictMode);

  if (totalCitations > 0 && validCitations === 0) {
    issues.push("No citations could be verified against available sources");
  }

  return {
    isValid,
    issues,
    verifiedCitations,
    confidenceScore
  };
}