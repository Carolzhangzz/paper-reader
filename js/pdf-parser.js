// ===== PDF.js Text Extraction =====

let pdfjsLib = null;

async function ensurePdfJs() {
  if (pdfjsLib) return pdfjsLib;

  // PDF.js loaded as ES module via CDN
  pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
  return pdfjsLib;
}

/**
 * Extract text from a PDF ArrayBuffer.
 * Returns { pages: string[], fullText: string, sections: Section[] }
 */
export async function extractTextFromPdf(buffer) {
  const lib = await ensurePdfJs();
  const pdf = await lib.getDocument({ data: buffer }).promise;
  const numPages = pdf.numPages;
  const pages = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => {
      // Detect line breaks by checking Y position gaps
      return item.str;
    });
    pages.push(strings.join(' '));
  }

  const fullText = pages.join('\n\n');
  const sections = detectSections(fullText);

  return { pages, fullText, sections, numPages };
}

/**
 * Heuristic section detection based on common academic paper headings.
 */
function detectSections(text) {
  const lines = text.split('\n');
  const sections = [];
  let currentSection = { heading: 'Header', content: '' };

  // Common section heading patterns
  const headingPatterns = [
    /^(?:\d+\.?\s+)?(Abstract|Introduction|Related Work|Background|Methodology|Methods?|Approach|Model|Experiments?|Results?|Discussion|Conclusion|Acknowledgments?|References|Appendix|Evaluation|Implementation|System Overview|Problem (?:Statement|Definition|Formulation)|Proposed (?:Method|Approach|Framework|System)|Experimental (?:Setup|Results|Evaluation)|Limitations?|Future Work|Data(?:set)?s?|Training|Analysis|Summary)\b/i,
    /^(?:[\dIVXivx]+\.?\s+)[A-Z][A-Za-z\s]{2,50}$/,
    /^\d+\.\d*\s+[A-Z][A-Za-z\s]{2,50}$/,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      currentSection.content += '\n';
      continue;
    }

    const isHeading = headingPatterns.some(p => p.test(trimmed)) && trimmed.length < 80;

    if (isHeading) {
      if (currentSection.content.trim()) {
        sections.push({ ...currentSection, content: currentSection.content.trim() });
      }
      currentSection = { heading: trimmed, content: '' };
    } else {
      currentSection.content += trimmed + ' ';
    }
  }

  if (currentSection.content.trim()) {
    sections.push({ ...currentSection, content: currentSection.content.trim() });
  }

  // If no sections detected, create one big section
  if (sections.length === 0) {
    sections.push({ heading: 'Full Text', content: text.trim() });
  }

  return sections;
}

/**
 * Chunk text to fit within a token limit (rough estimate: 1 token ≈ 4 chars).
 */
export function chunkText(text, maxTokens = 12000) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return [text];

  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';

  for (const para of paragraphs) {
    if ((current + para).length > maxChars && current) {
      chunks.push(current.trim());
      current = '';
    }
    current += para + '\n\n';
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
