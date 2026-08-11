# Suchwasnot.com — E-Reader Static Site Generator

A Python-based static site generator that compiles Markdown stories, images, and slideshows into a single self-contained HTML file with an e-reader style paginated layout. Designed for publishing fiction and creative writing on the web with a clean, distraction-free reading experience.

See in action at <https://suchwasnot.com/>.

![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)

## AI Disclosure

This code is partly AI-generated.


## Features

- **Single-file output** — All stories, styles, and JavaScript are inlined into one `index.html`. Only images remain as external files.
- **E-reader pagination** — Content flows through CSS multi-column layout with touch/swipe/click/keyboard navigation, mimicking a native e-book reader.
- **Light & dark themes** — Automatic theme switching via `prefers-color-scheme`, including auto-generated dark-mode SVG variants.
- **Reading position persistence** — A cookie remembers where the reader left off, even across viewport size changes (position is stored as a fraction of total content, not a page number).
- **Drop caps** — The first letter of each story is automatically enlarged and styled. JS detects overflow edge cases.
- **Slideshows** — Define timed image sequences that auto-advance.
- **Table of contents** — Modal navigation with anchor links.
- **Share & follow** — Built-in share dialog (Bluesky, Mastodon, X, Facebook, Reddit, Tumblr, LinkedIn, Email) and social follow links.
- **SEO** — Open Graph tags, Twitter Cards, JSON-LD structured data.
- **Google Analytics** — Optional, tracks story views (not individual page turns).
- **Print/EPUB support** — Separate `print.scss` and `epub.scss` stylesheets for PDF and EPUB generation workflows.

## Quick start

### Prerequisites

- Python 3.9+
- A C compiler (for `libsass`)

### Installation

```bash
git clone https://github.com/smathot/suchwasnot-site-generator
cd suchwasnot-site-generator
pip install .
```

### Build the example

```bash
python build.py --content-dir example-content --output-dir example-output
```

Then open `example-output/index.html` in your browser.

## Usage

```bash
python build.py [OPTIONS]
```

### Options

| Option | Default | Description |
|---|---|---|
| `--content-dir` | `./content` | Directory containing `content.yaml`, `md/`, `jpg/`, and `resources/` |
| `--templates-dir` | `./templates` | Directory containing Jinja2 templates |
| `--styles-dir` | `./styles` | Directory containing SCSS files |
| `--static-dir` | `./static` | Directory containing static files (JavaScript) |
| `--output-dir` | `./output` | Target directory for the built site |

### Typical workflow

1. Write stories in Markdown (`content/md/*.md`)
2. Configure `content/content.yaml` with metadata and section ordering
3. Place images in `content/jpg/` and SVG decorations in `content/resources/`
4. Run `python build.py`
5. Deploy `output/` to your web host

## Content structure

```
content/
├── content.yaml      # Configuration & metadata
├── md/               # Markdown story files
│   ├── my-story.md
│   └── about.md
├── jpg/              # Image files
│   └── cover.jpg
└── resources/        # SVG decorations, icons, etc.
    ├── griffinfly.svg
    └── my-story.svg
```

### content.yaml

The configuration file has two parts: **metadata** and a **content** section.

#### Metadata

```yaml
meta_title: "My Book"
meta_description: "A collection of short stories."
author: "Jane Doe"
canonical_url: "https://example.com/"
og_image: "https://example.com/cover.jpg"
google_analytics_id: "G-XXXXXXXXXX"   # empty string to disable
share_title: "My Book"
share_text: "Read stories by Jane Doe"
copyright: >
  <p>Copyright © 2026 Jane Doe.</p>
  <p>All rights reserved.</p>
```

#### Content sections

Content is an ordered dictionary. Each entry is keyed by a slug (used in URLs and CSS) and can be one of three types:

**Markdown story:**

```yaml
my-story:
  source: md/my-story.md
  title: My Story           # appears in the TOC
```

**Image:**

```yaml
cover:
  source: jpg/cover.jpg     # any image extension
  title: Cover
```

**Slideshow:**

```yaml
title-sequence:
  - source: jpg/page-1.jpg
    duration: 3             # seconds
  - source: jpg/page-2.jpg
    duration: 3
  - source: jpg/page-3.jpg  # last slide has no duration
```

## Markdown features

The build script preprocesses Markdown before conversion:

- **Drop caps** — The first letter after the first heading is automatically wrapped in a `<span class="big-letter">` styled as a drop cap.
- **Dialogue dashes** — Lines starting with `— ` (em-dash) are converted to separate paragraphs with a thin space.
- **Section breaks** — A horizontal rule (`---`) renders as a decorative separator (𖧹).
- **Smarty typography** — Straight quotes are converted to curly quotes automatically.

Standard Markdown extensions enabled: `extra`, `attr_list`, `smarty`.

## Theming

### Light/dark mode

Colors are defined as CSS custom properties in `styles/reader.scss`. Dark mode is activated automatically via `@media (prefers-color-scheme: dark)`.

To customize colors, edit the `:root` and `@media (prefers-color-scheme: dark)` blocks:

```scss
:root {
    --reader-body:    #fdf9ed;   // page background
    --reader-text:    #002b36;   // body text
    --reader-accent:  #ce2714;   // headings, links, drop caps
    // ...
}
```

### SVG decorations

SVG files in `content/resources/` are processed at build time: black fills (`#000000`) are replaced with theme-appropriate colors. Two variants are generated:

- `foo.svg` — light mode fill
- `foo-dark.svg` — dark mode fill

Heading decorations are configured in `reader.scss`:

```scss
// Default decoration (applied to all h1 without a specific rule)
h1:after {
    content: url("griffinfly.svg");
}

// Per-story decorations
h1#my-story:after {
    content: url("my-story.svg");
}
```

## Templates

The Jinja2 template (`templates/story.html`) receives the following variables:

| Variable | Type | Description |
|---|---|---|
| `sections` | list | All content sections with `slug`, `title`, `html`, `is_image`, `is_slideshow` |
| `toc_entries` | list | Sections with explicit titles, for the TOC modal |
| `compiled_css` | string | Compiled CSS from `reader.scss` |
| `reader_js` | string | Contents of `static/reader.js` |
| `share_links` | list | Share platform links with `label` and `url` |
| `follow_links` | list | Follow platform links with `label` and `url` |
| `meta_title`, `meta_description`, `author`, etc. | string | Metadata from `content.yaml` |
| `publish_date` | string | ISO date of the build |
| `copyright_year` | int | Current year |

## Deployment

The build produces a static `output/` directory. Deploy it to any web host:

- **Static hosting** (GitHub Pages, Netlify, Vercel, etc.) — just upload `output/`
- **FTP** — upload `output/` to your server
- **No server-side processing required** — everything is client-side

## EPUB & PDF generation

This generator focuses on the web reading experience. For EPUB and PDF output, the project includes companion stylesheets:

- `styles/epub.scss` — Conservative reflowable EPUB stylesheet
- `styles/print.scss` — Print stylesheet with mirrored margins, running headers, and page numbers

These can be used with tools like [Pandoc](https://pandoc.org/) or [WeasyPrint](https://weasyprint.org/) to produce downloadable formats from the same Markdown source.

## License

Copyright © 2026 Sebastiaan Mathôt. Licensed under the [GNU General Public License v3](LICENSE).
