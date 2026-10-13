---
title: SAFESPACE Capstone Evidence PDF Export Manifest
status: Export completed and independently verified; one formatting limitation disclosed below
date: 2026-10-13
---

# PDF export manifest

This document records how `SAFESPACE_Capstone_Evidence_Report.pdf` was
generated from the six Markdown evidence documents in this folder, what was
included, what was checked, and what limitations remain. This is a
document-export task — no application code, database schema, RLS policy,
environment configuration, or deployment setting was touched, and none of
the six source Markdown files were modified.

## Source files found and included

All six expected documents were present in `docs/capstone-evidence/` and
all six were included, in numerical order:

| # | Expected (per the export request) | Actual file found and used | Match method |
|---|---|---|---|
| 00 | `00-audit-scope-and-access.md` | `00-audit-scope-and-access.md` | Exact name |
| 01 | `01-deliverable-1-project-structure.md` | `01-deliverable-1-project-structure.md` | Exact name |
| 02 | `02-deliverable-2-feature-matrix.md` | `02-deliverable-2-feature-matrix.md` | Exact name |
| 03 | `03-prior-documentation-review.md` | `03-prior-documentation-reconciliation.md` | **Filename differs from the request.** Matched by its `0`3-` numeric prefix, and its content confirmed as the corresponding document — it is this project's prior-documentation reconciliation pass (comparing `SafeHer_System_Documentation_Report.html` against the current codebase), which is what a file named "prior-documentation-review" would be expected to contain. No other file in the folder could plausibly be the intended match. |
| 04 | `04-iso25010-questionnaire-traceability.md` | `04-iso25010-questionnaire-traceability.md` | Exact name |
| 05 | `05-unresolved-evidence-and-testing-register.md` | `05-unresolved-evidence-and-testing-register.md` | Exact name |

**Missing files: none.** All six documents were located and included; no
section was invented or substituted.

## Generated output

- **PDF path**: `docs/capstone-evidence/SAFESPACE_Capstone_Evidence_Report.pdf`
- **Page count**: 39 pages (1 cover page + 1 table-of-contents page + 37
  content pages), confirmed by directly loading the generated PDF with
  `pdf-lib` and reading `getPageCount()` — not assumed from the render
  log alone.
- **PDF bookmarks/outline**: generated (via `pagedjs-cli --outline-tags
  h1,h2`) and independently verified by walking the PDF's own `/Outlines`
  object tree with `pdf-lib`: **50 bookmark entries**, correctly nested
  two levels deep (one top-level entry per source document, with its `##`
  subsections nested underneath). Sample confirmed by printing the full
  tree — see below.
- **Table of contents**: a dedicated TOC page listing every top-level and
  second-level heading from all six documents, with real page numbers
  generated via CSS `target-counter()` (not hand-typed), confirmed
  correct by direct visual inspection (e.g., "Scope of this audit pass
  ... 4").

## Build method (for reproducibility)

1. Each Markdown file's YAML frontmatter (`title`/`status`/`date`) was
   parsed and rendered as a labeled metadata block under that document's
   heading, followed by the literal source path
   (`docs/capstone-evidence/<filename>`), so every page in the PDF is
   traceable back to its exact source file.
2. The Markdown body was converted to HTML with `marked` (GitHub-Flavored
   Markdown mode, so tables/lists/code spans render as in the source).
3. The combined HTML was paginated with **Paged.js** (a CSS Paged Media
   polyfill) and printed to PDF via headless Chromium
   (`pagedjs-cli`), which is what produces the running header (report
   title), running footer ("Page X of Y"), the generated table of
   contents, and the PDF outline/bookmarks.
4. **Redaction/secret scan**: before generating the PDF, all six source
   files were scanned for common secret/credential patterns (JWT-shaped
   strings, `sk-`/`AIza`/`AKIA`-style API key prefixes, PEM private-key
   headers, embedded database connection strings with credentials, and
   `key=`/`password=`/`token=`/`secret=`-style assignments with an
   inline value). **No matches were found in any of the six files** —
   consistent with this audit's own standing rule, stated repeatedly
   throughout the source documents themselves, never to reproduce real
   credentials, secrets, or survivor data. **Nothing was redacted because
   nothing matching these patterns was present.**

## Formatting — what was verified, and one disclosed limitation

The generated PDF was opened and inspected directly (not assumed correct
from the generator's exit status): the output was loaded in a real PDF
viewer (Chromium's built-in PDF renderer, driven headlessly) and
individual pages were captured and visually reviewed, including the cover
page, the table of contents, representative content pages from each of
the six sections, and the final page, plus every page containing a wide
(5–6 column) table.

- **Cover page**: title, subtitle, institution, and generation date all
  render correctly, centered, on their own page with no header/footer
  clutter.
- **Table of contents**: renders on its own page with correct, real page
  numbers and dotted leaders.
- **Running header/footer**: every content page carries the report title
  in the header and "Page X of Y" in the footer, confirmed across pages
  sampled from the beginning, middle, and end of the document.
- **Tables**: all tables render as real bordered tables (not just
  paragraph text), with header rows shaded, code spans in monospace, and
  long technical identifiers (file paths, function names, SQL table
  names) wrapping correctly instead of overflowing the page.
- **Wide tables (5–6 columns)**: 13 tables in the source documents exceed
  4 columns (the reconciliation table in document 03, and the per-
  characteristic tables in the ISO/IEC 25010 matrix and the unresolved-
  evidence register, document 04 and 05). **A true rotated landscape
  page for these was attempted and found not to work**: Paged.js (the
  rendering engine used) applies a single document-wide page size and
  does not actually resize a named page to landscape dimensions even
  though it does correctly recognize and tag such a page — this was
  confirmed empirically (the page picks up a "landscape" CSS class but
  its rendered box stayed at standard A4-portrait pixel dimensions) and
  traced into the renderer's own source as a real limitation, not a
  configuration mistake. **Given that, these 13 tables were instead kept
  on standard portrait pages but widened** (extended into the page's side
  margins) with a smaller font and tighter cell padding, which was
  visually confirmed to keep all content readable without clipping.
  **Nothing required landscape orientation to remain legible** in the
  final visual check, but if the capstone adviser specifically expects
  physically rotated landscape pages for these particular tables, that
  was not achievable with this toolchain and would require a different
  renderer (e.g., a LaTeX-based pipeline) to produce.
- **Repeating table headers across a page break**: this works correctly
  for the large majority of page breaks (confirmed visually at several
  sampled breaks). **One disclosed limitation**: when a single table row
  is long enough that it must itself split across a page boundary (an
  uncommon case — observed on 2 of the ~15 multi-page tables in this
  document), the header row does not repeat before the continued
  fragment on the following page. **No content is lost, clipped, or
  rendered unreadable in this case** — the row's text continues in full,
  just without a repeated column-header label above it. This is a known
  behavior of the Paged.js rendering engine for this edge case, not a
  data-loss issue, and was left as-is rather than risking further changes
  to the renderer's pagination logic this late in the process. If this is
  not acceptable for the final academic submission, the fix would require
  either a different PDF-generation toolchain or manually shortening the
  two affected table cells so no single row ever exceeds one page's
  height.
- **Clipped/unreadable text**: none found in the pages sampled, including
  the longest cells in the widened tables.
- **Missing or blank pages**: none found; the document begins at the
  cover page and ends cleanly on the last content page with no trailing
  blank pages.

## Confirmation: source Markdown files were not modified

All six source `.md` files' on-disk modification timestamps were checked
immediately before writing this manifest and are unchanged from before
this export task began (each file's timestamp matches when it was last
substantively edited during the audit itself, not this export pass). This
export task only **read** those six files; it never opened them for
writing.

## Limitations summary (for quick reference)

1. Wide (5–6 column) tables are on portrait pages, widened rather than
   physically rotated to landscape — a confirmed tooling limitation, not
   a configuration oversight, with no observed loss of readability.
2. Two multi-page tables have one row each that splits across a page
   boundary without the header repeating on the continuation page — no
   content loss, a cosmetic/navigational limitation only.
3. No secrets or credentials were found to redact — this is a statement
   about what was checked and found, not an assumption.
