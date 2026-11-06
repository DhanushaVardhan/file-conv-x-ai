/* Alembic · summary
 * Prompts for summarizing a digest (see readers.js) and answering questions about it.
 */
(function () {
  'use strict';
  const A = window.Alembic;

  const MODES = {
    summary: {
      label: 'Summary',
      task: 'Write these sections:\n## TL;DR\nOne or two sentences.\n## Key points\n4 to 8 bullets.\n## Details\nA few ### subsections for the main topics, each with 2 to 4 bullets.\n## Numbers and dates\nBullets, only if the file contains important figures or dates.\n## Action items\nBullets, only if the file asks someone to do something.',
    },
    keypoints: {
      label: 'Key points',
      task: 'Write only:\n## Key points\n6 to 12 short bullets, most important first. Start each bullet with the key idea in **bold**.',
    },
    study: {
      label: 'Study notes',
      task: 'Write study notes for a student revising this material:\n## Overview\n2 or 3 sentences.\n## Key concepts\nBullets in the form **Term**: clear explanation.\n## Facts and formulas to remember\nBullets.\n## Quick quiz\n5 numbered questions. Put "Answer:" and the answer on the line after each question.',
    },
    actions: {
      label: 'Action items',
      task: 'Find what needs to be done:\n## Action items\nA Markdown table with the columns Task | Owner | Due | Notes. Write "—" when the file does not say.\n## Decisions and deadlines\nBullets.\nIf the file contains no tasks, say so in one sentence, then give its 3 most important points as bullets.',
    },
    simple: {
      label: 'Explain simply',
      task: 'Explain the file to a curious 12-year-old:\n## In one sentence\n## What it is about\nShort paragraphs with everyday examples.\n## Why it matters\n2 or 3 bullets.',
    },
  };
  const LENGTHS = { short: { label: 'Short', words: 120 }, medium: { label: 'Medium', words: 300 }, long: { label: 'Detailed', words: 650 } };
  const LANGUAGES = ['Same as file', 'English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Bengali', 'Marathi', 'Spanish', 'French', 'German', 'Japanese'];

  const GUIDE = {
    sheet: 'This is spreadsheet data. Explain what the data tracks, the overall totals, the biggest and smallest values, trends over time and anything unusual. Use the statistics computed by the app; they are exact.',
    slides: 'This is a slide deck. Follow the story the slides tell, in order, and use the speaker notes where they add detail.',
    video: 'This is a video. Describe what happens over time with timestamps (mm:ss), any text shown on screen, and what is said if you can hear it.',
    audio: 'This is an audio recording. Summarize what is said, who seems to be speaking, and the main points in order, with timestamps (mm:ss) where helpful.',
    image: 'This is an image. Describe what it shows, read any text in it, and explain what it means. For charts or tables, read the values.',
    pdf: 'This is a PDF document. Page markers like [Page 3] show where text came from; cite pages for important points when it helps.',
    docx: 'This is a Word document.',
    text: 'This is a text file.',
  };

  function fileHeader(d) {
    const facts = d.facts.filter(([k]) => k !== 'Type').map(([k, v]) => k + ': ' + v).join('; ');
    return 'File: "' + d.name + '" (' + d.typeLabel + (facts ? '; ' + facts : '') + ')';
  }
  function kindGuide(d) {
    if (d.code) return 'This is ' + d.typeLabel + '. Explain what the code does, its main parts, how they fit together, and any bugs or risks you notice.';
    if (d.scanned) return 'This is a scanned PDF. Read the text from the attached page images.';
    return GUIDE[d.kind] || '';
  }
  function languageLine(lang) {
    return !lang || lang === 'Same as file' ? 'Write in the same language as the file.' : 'Write in ' + lang + ', even if the file is in another language.';
  }
  function fileBlock(d, maxChars) {
    const text = d.text.length > maxChars ? d.text.slice(0, maxChars) + '\n[... cut to fit ...]' : d.text;
    return '<file>\n' + text + '\n</file>' + (d.imageNote ? '\n' + d.imageNote : '');
  }

  function summaryPrompt(d, { mode = 'summary', length = 'medium', language } = {}) {
    const m = MODES[mode] || MODES.summary;
    const l = LENGTHS[length] || LENGTHS.medium;
    return [
      'You summarize files accurately for busy people.',
      fileHeader(d),
      kindGuide(d),
      'Task: ' + m.task,
      'Length: about ' + l.words + ' words in total.',
      languageLine(language),
      'Rules: Use only what is in the file. Never invent names, numbers or facts. If something important is unreadable or missing, say so in one line at the end. Reply in Markdown (headings, bullets, bold, tables) with no preamble and no closing remarks.',
      fileBlock(d, 140000),
    ].filter(Boolean).join('\n\n');
  }

  function chatContext(d, summaryText, language) {
    return [
      'You answer questions about one file. Use only the file. If the answer is not in it, say so plainly and suggest what to look for instead.',
      fileHeader(d),
      kindGuide(d),
      languageLine(language),
      'Keep answers short and specific (under 180 words unless the question needs more). Quote exact numbers, names and dates from the file. Markdown is fine.',
      fileBlock(d, 100000),
      summaryText ? 'A summary you already wrote:\n' + summaryText.slice(0, 6000) : '',
    ].filter(Boolean).join('\n\n');
  }

  /** Uploads a video/audio file once per digest, so Gemini can watch or hear it. */
  async function mediaFiles(d, { signal, onStage } = {}) {
    if (!d.media) return null;
    if (d.uploaded && Date.now() - d.uploaded.at < 40 * 3600 * 1000) return [d.uploaded.ref];
    onStage && onStage('Uploading the ' + d.kind + ' for the AI · 0%');
    const ref = await A.ai.upload(d.media, {
      signal,
      onProgress: (p) => onStage && onStage((p < 1 ? 'Uploading the ' + d.kind + ' for the AI · ' + Math.round(p * 100) + '%' : 'The AI is processing the ' + d.kind + '…')),
    });
    d.uploaded = { ref: { uri: ref.uri, mime: ref.mime }, at: Date.now() };
    return [d.uploaded.ref];
  }

  async function summarize(d, opts, { onText, signal, onStage, fresh } = {}) {
    const files = await mediaFiles(d, { signal, onStage });
    onStage && onStage('Reading the file…');
    return A.ai.text(summaryPrompt(d, opts), { images: d.images, files, onText, signal, cache: fresh ? false : undefined });
  }

  /** history: [{role:'user'|'assistant', content}] of earlier questions and answers. */
  async function ask(d, summaryText, history, question, { language, onText, signal, onStage } = {}) {
    const files = await mediaFiles(d, { signal, onStage });
    // The file goes in the first turn; a short reply keeps user/assistant turns alternating for every provider.
    const turns = [
      { role: 'user', content: chatContext(d, summaryText, language) },
      { role: 'assistant', content: 'I have read the file. What would you like to know?' },
    ];
    for (const h of history.slice(-8)) turns.push({ role: h.role, content: h.content });
    turns.push({ role: 'user', content: question });
    return A.ai.text(turns, { images: d.images, files, onText, signal, cache: false });
  }

  const SUGGESTIONS = {
    sheet: ['Which month or category did best?', 'What trends do you see?', 'Is anything unusual in the data?'],
    slides: ['What is the main message of the deck?', 'Which slide is the most important?', 'What questions might an audience ask?'],
    video: ['What happens in the first minute?', 'List the main moments with timestamps', 'What text appears on screen?'],
    audio: ['What are the main points?', 'List any decisions or to-dos', 'Who is speaking?'],
    image: ['What text is in the image?', 'Describe the image in detail', 'What is the most important part?'],
    code: ['How do I run this?', 'Are there any bugs?', 'Explain the hardest part simply'],
    default: ['What are the main conclusions?', 'List every date and deadline', 'Explain the hardest part simply'],
  };
  function suggestions(d) {
    return d.code ? SUGGESTIONS.code : SUGGESTIONS[d.kind] || SUGGESTIONS.default;
  }

  A.summary = { MODES, LENGTHS, LANGUAGES, summaryPrompt, summarize, ask, suggestions };
})();
