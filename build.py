#!/usr/bin/env python3
"""Build script for the e-reader static site.

Reads content.yaml, converts Markdown stories to HTML,
compiles SCSS, and renders a single self-contained reflowing
HTML page with an e-reader style paginated layout.
"""

import argparse
import re
import shutil
import uuid
from datetime import date
from pathlib import Path
from urllib.parse import quote
import yaml
import markdown
import sass
from jinja2 import Environment, FileSystemLoader

# --- Paths ---
ROOT = Path(__file__).parent
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp"}

# --- SVG theme colors ---
# These match the --reader-text values in reader.scss.
# Injected into SVG files at build time so decorations
# adapt to light/dark mode automatically.
SVG_LIGHT_FILL = "#002b36"
SVG_DARK_FILL = "#e8e0d0"

# --- Metadata keys expected at the top level of content.yaml ---
METADATA_KEYS = [
    "meta_title",
    "meta_description",
    "author",
    "canonical_url",
    "og_image",
    "google_analytics_id",
    "share_text",
    "share_title"
]

# --- Follow / share platform definitions ---
# Each tuple is (config_key, display_label).  Only platforms whose URL
# is present in content.yaml's `follow:` section will appear.
FOLLOW_PLATFORMS = [
    ("bluesky", "Bluesky"),
    ("mastodon", "Mastodon"),
    ("x", "X"),
    ("facebook", "Facebook"),
    ("instagram", "Instagram"),
    ("linkedin", "LinkedIn"),
    ("tumblr", "Tumblr"),
    ("reddit", "Reddit"),
    ("goodreads", "Goodreads"),
    ("rss", "RSS"),
]

# Share platforms.  Each entry produces a share URL.
SHARE_PLATFORMS = [
    ("Bluesky", "https://bsky.app/intent/compose?text={text}"),
    ("Mastodon", "https://mastodonshare.com/?text={text}&url={url}"),
    ("X", "https://twitter.com/intent/tweet?text={text}&url={url}"),
    ("Facebook", "https://www.facebook.com/sharer/sharer.php?u={url}"),
    ("Reddit", "https://www.reddit.com/submit?url={url}&title={title}"),
    ("Tumblr", "https://www.tumblr.com/widgets/share/tool?canonicalUrl={url}&title={title}"),
    ("LinkedIn", "https://www.linkedin.com/sharing/share-offsite/?url={url}"),
    ("Email", "mailto:?subject={title}&body={text}%0A%0A{url}"),
]


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Build the e-reader static site."
    )
    parser.add_argument(
        "--content-dir",
        type=Path,
        default=Path.cwd() / "content",
        help="Directory containing content.yaml and resources"
             "(default: current working directory/content).",
    )
    parser.add_argument(
        "--templates-dir",
        type=Path,
        default=ROOT / "templates",
        help="Directory containing Jinja2 templates"
             "(default: <script dir>/templates).",
    )
    parser.add_argument(
        "--styles-dir",
        type=Path,
        default=ROOT / "styles",
        help="Directory containing SCSS files"
             "(default: <script dir>/styles).",
    )
    parser.add_argument(
        "--static-dir",
        type=Path,
        default=ROOT / "static",
        help="Directory containing static files, such as javascript"
             "(default: <script dir>/static).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path.cwd() / "output",
        help="Target directory for rendered site"
             "(default: current working directory/output).",
    )
    return parser.parse_args()


def load_config(content_dir):
    """Load the content configuration from content.yaml.

    Validates that all required metadata keys are present and that
    a `content` section exists.
    """
    content_yaml = content_dir / "content.yaml"
    with open(content_yaml) as f:
        config = yaml.safe_load(f)

    missing = [k for k in METADATA_KEYS if k not in config]
    if missing:
        raise ValueError(
            f"content.yaml is missing required metadata keys: {', '.join(missing)}"
        )

    if "content" not in config:
        raise ValueError("content.yaml is missing the 'content' section.")

    return config


def extract_title(text, fallback):
    """Extract a title from the first '# Heading' in markdown, or use fallback."""
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def preprocess_md(md: str) -> str:
    # Ensure dialogue dashes are separated so they get their own paragraph.
    md = md.replace("\n\u2014 ", "\n\n\u2014&thinsp;")

    # If the first letter is followed by a straight quote, we turn it into a curly
    # closing quote. This is necessary, because the big-letter span will cause the
    # markdown smarty extension to treat it as an opening quote.
    md = re.sub(r"([A-Za-z])'", r"\1&rsquo;", md, count=1)

    # Wrap the first letter after a newline in a <span class="big-letter"> tag.
    md = re.sub(
        r"\n([A-Za-z])",
        r'\n<span class="big-letter">\1</span>',
        md,
        count=1,
    )

    def process_block(match):
        block = match.group(1)
        # Split into lines and strip empty lines from start/end
        lines = block.splitlines()
        # Remove empty lines from start
        while lines and not lines[0].strip():
            lines.pop(0)
        # Remove empty lines from end
        while lines and not lines[-1].strip():
            lines.pop()
        # Rejoin with newlines
        return "\n".join(["```"] + lines + ["```"])

    # Regex to match fenced code blocks (```content```)
    pattern = re.compile(r"```(.*?)```", re.DOTALL)
    return pattern.sub(process_block, md)


def load_story(content_dir, source):
    """Load a markdown file and convert it to HTML. Returns (title, html).

    The source path is resolved relative to the project root.
    """
    md_path = content_dir / source
    with open(md_path) as f:
        text = f.read()

    slug_title = md_path.stem.replace("-", " ").title()
    title = extract_title(text, slug_title)
    html = markdown.markdown(
        preprocess_md(text),
        extensions=["extra", "attr_list", "smarty"],
    )
    return title, html


def load_image(content_dir, output_dir, source, slug):
    """Build an <img> tag for an image source, copying the file to output.

    Returns (title, html).
    """
    img_path = content_dir / source
    title = img_path.stem.replace("-", " ").title()
    ext = img_path.suffix
    dest_filename = f"{slug}{ext}"
    dest_path = output_dir / dest_filename
    shutil.copy2(img_path, dest_path)

    html = f'<img src="{dest_filename}" alt="{title}" />'
    return title, html


def load_slideshow(content_dir, output_dir, slides_config, slug):
    """Build HTML for a slideshow from a list of slide configs.

    Each slide except the last has 'source' and 'duration'.
    The last slide only has 'source'.
    Returns (title, html).
    """
    title = slug.replace("-", " ").title()
    slide_parts = []
    for i, slide in enumerate(slides_config):
        img_path = content_dir / slide["source"]
        ext = img_path.suffix
        dest_filename = f"{slug}-{i}{ext}"
        dest_path = output_dir / dest_filename
        shutil.copy2(img_path, dest_path)

        duration_attr = ""
        if "duration" in slide:
            duration_attr = f' data-duration="{slide["duration"]}"'

        active_class = " slideshow__slide--active" if i == 0 else ""
        slide_parts.append(
            f'<img class="slideshow__slide{active_class}" '
            f'src="{dest_filename}" alt="{title}"{duration_attr} />'
        )

    html = '<div class="slideshow">\n' + "\n".join(slide_parts) + "\n</div>"
    return title, html


def patch_svg_fill(svg_text, fill_color):
    """Replace all black fill colors in an SVG with the given color.

    Handles both CSS-style fill (#000000 in style attributes) and
    XML-style fill (fill="#000000" as standalone attributes).
    """
    # Replace fill:#000000 (in style attributes)
    patched = svg_text.replace("fill:#000000", f"fill:{fill_color}")
    # Replace fill="#000000" (as standalone attribute, if any)
    patched = patched.replace('fill="#000000"', f'fill="{fill_color}"')
    return patched


def copy_resources(resources_dir, output_dir):
    """Copy resource files to the output directory.

    SVG files are written twice: once with the light-mode fill color
    (e.g. ``foo.svg``) and once with the dark-mode fill color
    (e.g. ``foo-dark.svg``). All other files are copied as-is.
    """
    for src in resources_dir.iterdir():
        if src.is_dir():
            continue
        if src.suffix.lower() == ".svg":
            with open(src) as f:
                svg_text = f.read()
            # Light variant: foo.svg
            with open(output_dir / src.name, "w") as f:
                f.write(patch_svg_fill(svg_text, SVG_LIGHT_FILL))
            # Dark variant: foo-dark.svg
            stem = src.stem
            dark_name = f"{stem}-dark{src.suffix}"
            with open(output_dir / dark_name, "w") as f:
                f.write(patch_svg_fill(svg_text, SVG_DARK_FILL))
        else:
            shutil.copy2(src, output_dir / src.name)


def compile_scss(styles_dir):
    """Compile reader.scss to CSS."""
    scss_path = styles_dir / "reader.scss"
    with open(scss_path) as f:
        scss = f.read()
    return sass.compile(string=scss, output_style="expanded")


def load_js(static_dir):
    """Load the reader JavaScript."""
    js_path = static_dir / "reader.js"
    with open(js_path) as f:
        return f.read()


def inject_h1_id(html, slug):
    """Add an id attribute to the first <h1> in the HTML string."""
    return html.replace("<h1>", f'<h1 id="{slug}">', 1)


def cache_bust(html):
    """Append a cache-busting query parameter to local resource URLs.

    Finds all src="..." and href="..." attributes pointing to local files
    (not http/https/data/mailto/anchor URLs) and appends ?v=<key> so that
    browsers reload resources when a new build is deployed.
    """
    key = uuid.uuid4().hex[:8]

    def replacer(match):
        attr = match.group(1)
        url = match.group(2)
        # Skip external URLs, data URIs, anchors, mailto, protocol-relative
        if url.startswith(("http://", "https://", "data:", "#", "mailto:", "//")):
            return match.group(0)
        # Replace existing ?v= param or add a new one
        if "?v=" in url:
            url = re.sub(r"\?v=[^&]*", f"?v={key}", url)
        else:
            url = f"{url}?v={key}"
        return f'{attr}="{url}"'

    html = re.sub(r'(src|href)="([^"]*)"', replacer, html)
    return html


def build_share_links(canonical_url, share_title, share_text):
    """Build a list of share-link dicts for the share dialog.

    Each dict has keys 'label' and 'url'. Uses URL encoding.
    """
    enc_url = quote(canonical_url, safe="")
    enc_title = quote(share_title, safe="")
    enc_text = quote(share_text, safe="")

    links = []
    for label, template in SHARE_PLATFORMS:
        url = template.format(
            url=enc_url,
            title=enc_title,
            text=enc_text,
        )
        links.append({"label": label, "url": url})
    return links


def build_follow_links(config):
    """Build a list of follow-link dicts from the 'follow' section of content.yaml.

    Only platforms with a non-empty URL appear in the list.
    """
    follow_cfg = config.get("follow", {})
    links = []
    for key, label in FOLLOW_PLATFORMS:
        url = follow_cfg.get(key)
        if url:
            links.append({"label": label, "url": url})
    return links


def build(content_dir, templates_dir, styles_dir, static_dir, output_dir):
    """Build the complete static site as a single reflowing document."""
    print("Building e-reader site...")

    resources_dir = content_dir / "resources"
    config = load_config(content_dir)
    metadata = {k: config[k] for k in METADATA_KEYS}
    today = date.today()
    metadata["publish_date"] = today.isoformat()
    metadata["copyright_year"] = today.year
    content = config["content"]
    compiled_css = compile_scss(styles_dir)
    reader_js = load_js(static_dir)

    # Build share and follow link lists
    share_links = build_share_links(
        metadata["canonical_url"], metadata["share_title"], metadata["share_text"]
    )
    follow_links = build_follow_links(config)

    # Set up Jinja2
    env = Environment(loader=FileSystemLoader(str(templates_dir)), autoescape=True)
    template = env.get_template("story.html")

    # Clean and recreate output directory
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)

    # Build all content sections
    sections = []
    for slug, entry in content.items():
        if isinstance(entry, list):
            # Slideshow
            title, html = load_slideshow(content_dir, output_dir, entry, slug)
            sections.append({
                "slug": slug,
                "title": title,
                "html": html,
                "is_image": False,
                "is_slideshow": True,
            })
            print(f"  ✓ {slug} (slideshow, {len(entry)} slides)")
        else:
            source = entry["source"]
            ext = Path(source).suffix.lower()
            if ext in IMAGE_EXTS:
                title, html = load_image(content_dir, output_dir, source, slug)
                sections.append({
                    "slug": slug,
                    "title": title,
                    "html": html,
                    "is_image": True,
                    "is_slideshow": False,
                })
            else:
                title, html = load_story(content_dir, source)
                html = inject_h1_id(html, slug)
                sections.append({
                    "slug": slug,
                    "title": title,
                    "html": html,
                    "is_image": False,
                    "is_slideshow": False,
                })
            print(f"  ✓ {slug} ({source})")

    # Build TOC entries from sections that have an explicit title in content.yaml
    toc_entries = []
    for slug, entry in content.items():
        if isinstance(entry, dict) and "title" in entry:
            toc_entries.append({
                "slug": slug,
                "title": entry["title"],
            })

    # Render the single combined page
    html = template.render(
        sections=sections,
        toc_entries=toc_entries,
        compiled_css=compiled_css,
        reader_js=reader_js,
        share_links=share_links,
        follow_links=follow_links,
        **metadata,
    )

    # Cache-bust local resource URLs
    html = cache_bust(html)

    output_path = output_dir / "index.html"
    with open(output_path, "w") as f:
        f.write(html)

    # Copy images to output
    copy_resources(resources_dir, output_dir)

    print(f"\nDone! {len(sections)} section(s) built to {output_path.relative_to(ROOT)}")


if __name__ == "__main__":
    args = parse_args()
    build(args.content_dir, args.templates_dir, args.styles_dir, args.static_dir,
          args.output_dir)
