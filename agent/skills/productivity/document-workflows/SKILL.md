---
name: document-workflows
description: "Use when extracting, editing, or transforming office documents and PDFs across OCR, PDF patching, and document-processing workflows."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [documents, pdf, ocr, extraction, office, productivity]
    related_skills: [google-workspace, powerpoint]
---

# Document Workflows

## Overview

This is the class-level umbrella for **document handling workflows**: extracting text from PDFs and scans, making targeted PDF edits, and deciding which toolchain to use before touching the file.

Detailed absorbed playbooks live in:
- `references/nano-pdf.md`
- `references/ocr-and-documents.md`
- `scripts/extract_pymupdf.py`
- `scripts/extract_marker.py`

`powerpoint` remains standalone because it is a full presentation-authoring package with a much larger support surface.

## When to Use

Load this skill when the user asks to:
- extract text from a PDF, scan, or document image
- choose between lightweight text extraction and OCR-heavy pipelines
- patch or fix text inside a PDF
- decide whether a document task needs `web_extract`, local PDF parsing, or an editing CLI

Do **not** use this as the primary skill for `.pptx` authoring/editing; use `powerpoint` for slide decks.

## Decision Table

| Need | Preferred path | Detailed reference |
|---|---|---|
| URL-accessible PDF or paper | `web_extract` first | `references/ocr-and-documents.md` |
| Local text-based PDF extraction | PyMuPDF / pymupdf4llm | `references/ocr-and-documents.md` |
| Scanned PDF / OCR / equations / layout recovery | marker-pdf | `references/ocr-and-documents.md` |
| Small targeted text edits in an existing PDF | `nano-pdf` | `references/nano-pdf.md` |

## Workflow

1. Determine whether the source is remote or local.
2. Prefer the lightest tool that can actually solve the task.
3. Preserve the distinction between **extraction** and **editing**.
4. Verify the output file or extracted text before reporting success.
5. Escalate to heavier OCR only when the lightweight path is inadequate.

## Lightweight Extraction Path

Use the lightweight path for ordinary text-based PDFs:
- try `web_extract` first when a URL exists
- otherwise use PyMuPDF helpers for local extraction
- extract only the needed pages when possible
- keep batch processing scripts reusable rather than ad hoc

## Heavy OCR Path

Use the OCR path only when the document is scanned, equation-heavy, or layout-sensitive:
- check disk/resource requirements first
- warn when the heavier install is likely to be excessive for the task
- prefer structured markdown or JSON outputs when the downstream task needs reasoning

## PDF Editing Path

For narrow text/title fixes inside existing PDFs:
- use `nano-pdf` when the requested change fits the tool’s natural-language edit model
- verify the output PDF after editing
- if layout surgery is needed, escalate rather than pretending the simple tool is enough

## Common Pitfalls

1. Installing the heavyweight OCR stack before trying `web_extract` or PyMuPDF.
2. Treating scanned PDFs like text PDFs; the wrong extractor wastes time and returns junk.
3. Conflating document extraction with document authoring; `.pptx` and rich office-editing tasks belong elsewhere.
4. Declaring success after an edit without validating the output file.

## Verification Checklist

- [ ] Remote-vs-local decision made explicitly
- [ ] Light vs heavy extraction path chosen intentionally
- [ ] Output text or edited file verified
- [ ] Heavy dependencies installed only when justified
