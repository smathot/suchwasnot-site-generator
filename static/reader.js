// E-Reader Pagination Controller
// Uses CSS multi-column layout for content reflow, with JS for navigation.
//
// Key fix: CSS column-width does NOT accept percentage values.
// We must set it dynamically in JS to the viewport width in pixels so the
// browser creates exactly the right number of columns (pages).

(function () {
    "use strict";

    const viewport = document.querySelector(".reader__viewport");
    const content = document.getElementById("reader-content");
    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    const indicator = document.getElementById("page-indicator");
    const pageTitleEl = document.getElementById("page-title");
    const storyProgressFill = document.getElementById("story-progress-fill");
    const tocBtn = document.getElementById("toc");
    const tocModal = document.getElementById("toc-modal");
    const tocClose = document.getElementById("toc-close");
    const copyrightBtn = document.getElementById("copyright");
    const copyrightModal = document.getElementById("copyright-modal");
    const copyrightClose = document.getElementById("copyright-close");

    let currentPage = 0;
    let pageCount = 1;
    let pageWidth = 0;
    let isAnimating = false;
    let initialPositionHandled = false;

    // --- COPYRIGHT modal ---
    function openCopyright() {
        copyrightModal.hidden = false;
    }

    function closeCopyright() {
        copyrightModal.hidden = true;
    }

    function isCopyrightOpen() {
        return !copyrightModal.hidden;
    }

    function toggleCopyright() {
        if (isCopyrightOpen()) {
            closeCopyright();
        } else {
            openCopyright();
        }
    }

    copyrightBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleCopyright();
    });

    copyrightClose.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeCopyright();
    });

    // Close modal when Escape is pressed
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && isCopyrightOpen()) {
            e.preventDefault();
            closeCopyright();
        }
    });

    // --- TOC modal ---

    function openToc() {
        tocModal.hidden = false;
    }

    function closeToc() {
        tocModal.hidden = true;
    }

    function isTocOpen() {
        return !tocModal.hidden;
    }

    function toggleToc() {
        if (isTocOpen()) {
            closeToc();
        } else {
            openToc();
        }
    }

    tocBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleToc();
    });

    tocClose.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeToc();
    });

    // Close modal when Escape is pressed
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && isTocOpen()) {
            e.preventDefault();
            closeToc();
        }
    });

    // Handle TOC link clicks: navigate to the section and close the modal
    tocModal.addEventListener("click", function (e) {
        var link = e.target.closest('a[href^="#"]');
        if (!link) return;

        var hash = link.getAttribute("href");
        if (!hash || hash === "#") return;

        e.preventDefault();
        closeToc();
        goToAnchor(hash);
    });

    // --- Cookie helpers ---

    var COOKIE_NAME = "readerPos";
    var COOKIE_DAYS = 365;

    function setCookie(name, value, days) {
        var expires = "";
        if (days) {
            var date = new Date();
            date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
            expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + encodeURIComponent(value) + expires + "; path=/; SameSite=Lax";
    }

    function getCookie(name) {
        var nameEQ = name + "=";
        var ca = document.cookie.split(";");
        for (var i = 0; i < ca.length; i++) {
            var c = ca[i].trim();
            if (c.indexOf(nameEQ) === 0) {
                return decodeURIComponent(c.substring(nameEQ.length));
            }
        }
        return null;
    }

    // --- Position persistence ---
    //
    // We store the reading position as a fraction of total content width
    // (0.0 to 1.0), not as a page number. This way, if the window is resized
    // or fonts load differently, the fraction still points to roughly the
    // same spot in the text stream.

    function savePosition() {
        if (pageWidth === 0 || pageCount <= 1) return;
        var fraction = (currentPage * pageWidth) / content.scrollWidth;
        setCookie(COOKIE_NAME, fraction, COOKIE_DAYS);
    }

    function restoreFromCookie() {
        var raw = getCookie(COOKIE_NAME);
        if (raw === null) return null;
        var fraction = parseFloat(raw);
        if (isNaN(fraction) || fraction < 0 || fraction > 1) return null;
        var pixelPos = fraction * content.scrollWidth;
        var page = Math.round(pixelPos / pageWidth);
        return Math.max(0, Math.min(page, pageCount - 1));
    }

    // --- Slideshow management ---

    var slideshows = [];

    function initSlideshows() {
        slideshows = [];
        var containers = document.querySelectorAll(".slideshow");
        for (var i = 0; i < containers.length; i++) {
            var slides = containers[i].querySelectorAll(".slideshow__slide");
            if (slides.length <= 1) continue;

            var slideshow = {
                slides: slides,
                current: 0,
                timer: null,
            };
            slideshows.push(slideshow);

            // Start the slideshow (advance from first slide)
            advanceSlideshow(slideshow);
        }
    }

    function advanceSlideshow(slideshow) {
        // If already on last slide, stop
        if (slideshow.current >= slideshow.slides.length - 1) return;

        var duration = parseFloat(
            slideshow.slides[slideshow.current].getAttribute("data-duration")
        );
        if (!duration || duration <= 0) duration = 2;

        slideshow.timer = setTimeout(function () {
            // Deactivate current slide
            slideshow.slides[slideshow.current].classList.remove("slideshow__slide--active");

            // Activate next slide
            slideshow.current++;
            slideshow.slides[slideshow.current].classList.add("slideshow__slide--active");

            // Continue if not on last slide
            if (slideshow.current < slideshow.slides.length - 1) {
                advanceSlideshow(slideshow);
            }
        }, duration * 1000);
    }

    // --- Page calculation helper ---
    //
    // Maps a pixel offset (relative to the content's left edge) to a page
    // index. A 1px epsilon is added before the floor division to absorb
    // sub-pixel rounding noise from getBoundingClientRect() at column
    // boundaries. Without this, an element at the very start of page N
    // might report an offset of N×pageWidth − 0.4, which floors to page
    // N−1 — causing wrong-page navigation and title visibility bugs.

    function pageOfOffset(offset) {
        return Math.floor((offset + 1) / pageWidth);
    }

    function recalculate() {
        // Measure the viewport width — this is our initial "page width"
        // estimate.
        pageWidth = viewport.clientWidth;
        if (pageWidth === 0) return;

        // Set column-width to exactly the viewport width in pixels.
        content.style.columnWidth = pageWidth + "px";

        // Wait for the browser to reflow, then measure
        requestAnimationFrame(function () {
            // Compute an approximate page count using our initial pageWidth
            // estimate. Use round instead of ceil to avoid creating a
            // spurious extra blank page from sub-pixel rounding noise.
            pageCount = Math.max(1, Math.round(content.scrollWidth / pageWidth));

            // Refine pageWidth to match the browser's ACTUAL column width.
            // The column-width property is only a suggestion; the browser
            // may use a slightly different value internally. Dividing the
            // real scrollWidth by pageCount gives us the true per-page width,
            // so our transforms align perfectly with column boundaries.
            if (pageCount > 0) {
                pageWidth = content.scrollWidth / pageCount;
            }

            if (currentPage >= pageCount) {
                currentPage = pageCount - 1;
            }

            applyTransform();
            updateIndicator();
            updateButtons();
            updatePageTitle();
            updateStoryProgress();

            // --- Initial position restore (runs only once) --->
            if (!initialPositionHandled) {
                initialPositionHandled = true;

                // Priority: cookie > URL hash > start
                var restoredPage = restoreFromCookie();
                if (restoredPage !== null) {
                    goToPage(restoredPage);
                } else if (location.hash) {
                    goToAnchor(location.hash);
                }

                // Clear any URL hash so it doesn't persist across reloads.
                // replaceState doesn't trigger a hashchange event.
                if (location.hash) {
                    history.replaceState(
                        null, null,
                        window.location.pathname + window.location.search
                    );
                }
            }

            savePosition();
        });
    }

    function applyTransform() {
        content.style.transform = "translateX(" + (-currentPage * pageWidth) + "px)";
    }

    function updateIndicator() {
        indicator.textContent = (currentPage + 1) + " / " + pageCount;
    }

    function updateButtons() {
        prevBtn.disabled = currentPage <= 0;
        nextBtn.disabled = currentPage >= pageCount - 1;
    }

    // --- Page title ---
    //
    // Shows the title of the story the user is currently reading in the
    // #page-title span. The "current story" is the last H1 that appears
    // on or before the current page. When the H1 itself is visible on the
    // current page, the span is made transparent (but still occupies space)
    // to avoid showing the title twice. If no H1 precedes the current page,
    // the default book title is shown transparently.

    function updatePageTitle() {
        if (!pageTitleEl) return;

        // Temporarily reset transform so getBoundingClientRect returns
        // true positions in the untransformed content flow.
        content.style.transform = "translateX(0)";

        var contentRect = content.getBoundingClientRect();
        var headings = content.querySelectorAll("h1");
        var titleText = "suchwasnot";
        var titleHidden = true;

        for (var i = 0; i < headings.length; i++) {
            var h1Rect = headings[i].getBoundingClientRect();
            var h1Left = h1Rect.left - contentRect.left;
            var h1Page = pageOfOffset(h1Left);

            if (h1Page < currentPage) {
                // H1 is on a previous page — remember it as current story title
                titleText = headings[i].textContent;
                titleHidden = false;
            } else if (h1Page === currentPage) {
                // H1 is visible on the current page — transparent to avoid duplication
                titleText = headings[i].textContent;
                titleHidden = true;
                break;
            } else {
                // H1 is on a future page — no need to look further
                break;
            }
        }

        // Restore the transform
        applyTransform();

        pageTitleEl.textContent = titleText.toUpperCase();
        if (titleHidden) {
            storyProgressFill.classList.add("fully-transparent");
            pageTitleEl.classList.add("fully-transparent");
        } else {
            storyProgressFill.classList.remove("fully-transparent");
            pageTitleEl.classList.remove("fully-transparent");
        }
    }

    // --- Story progress bar ---
    //
    // Fills the #story-progress bar to show how far along the current story
    // we are. The "current story" starts at the page of the last H1 on or
    // before the current page, and ends at the page before the next H1 (or
    // the last page if there is no next H1). If there is no preceding H1,
    // the bar is empty.

    function updateStoryProgress() {
        if (!storyProgressFill) return;
        if (pageWidth === 0) return;

        // Temporarily reset transform so getBoundingClientRect returns
        // true positions in the untransformed content flow.
        content.style.transform = "translateX(0)";

        var contentRect = content.getBoundingClientRect();
        var headings = content.querySelectorAll("h1");

        var startPage = -1;
        var endPage = pageCount - 1;

        for (var i = 0; i < headings.length; i++) {
            var h1Rect = headings[i].getBoundingClientRect();
            var h1Left = h1Rect.left - contentRect.left;
            var h1Page = pageOfOffset(h1Left);

            if (h1Page <= currentPage) {
                // This H1 is on or before the current page — it's our story start
                startPage = h1Page;
            } else {
                // This H1 is on a future page — the story ends just before it
                endPage = h1Page - 1;
                break;
            }
        }

        // Restore the transform
        applyTransform();

        var progress = 0;

        if (startPage >= 0) {
            if (endPage <= startPage) {
                // Single-page story — we're on it, so 100%
                progress = 100;
            } else {
                progress = ((currentPage - startPage) / (endPage - startPage)) * 100;
                progress = Math.max(0, Math.min(100, progress));
            }
        }

        storyProgressFill.style.width = progress + "%";
    }

    function goToPage(n) {
        if (isAnimating) return;
        var target = Math.max(0, Math.min(n, pageCount - 1));
        if (target === currentPage) return;

        isAnimating = true;
        currentPage = target;
        applyTransform();
        updatePageTitle();
        updateStoryProgress();

        setTimeout(function () {
            isAnimating = false;
        }, 300);

        updateIndicator();
        updateButtons();
        savePosition();
    }

    function goToAnchor(hash) {
        if (!hash || hash === "#" || pageWidth === 0) return;

        var id = hash.substring(1);
        var el = document.getElementById(id);
        if (!el) return;

        // Temporarily reset the transform so getBoundingClientRect returns
        // the element's true position in the untransformed content flow.
        content.style.transform = "translateX(0)";

        var elRect = el.getBoundingClientRect();
        var contentRect = content.getBoundingClientRect();
        var offset = elRect.left - contentRect.left;
        var page = pageOfOffset(offset);

        // Restore the transform
        applyTransform();

        if (page < 0) page = 0;
        if (page >= pageCount) page = pageCount - 1;

        goToPage(page);
    }

    function goToHome() {
        goToPage(0);
    }

    function nextPage() {
        goToPage(currentPage + 1);
    }

    function prevPage() {
        goToPage(currentPage - 1);
    }

    // --- Button clicks ---
    prevBtn.addEventListener("click", prevPage);
    nextBtn.addEventListener("click", nextPage);

    // --- Keyboard navigation ---
    document.addEventListener("keydown", function (e) {
        // Skip keyboard navigation when TOC modal is open (except Escape,
        // which is handled by its own listener above).
        if (isTocOpen()) return;

        if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
            e.preventDefault();
            nextPage();
        } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
            e.preventDefault();
            prevPage();
        } else if (e.key === "Home") {
            e.preventDefault();
            goToPage(0);
        } else if (e.key === "End") {
            e.preventDefault();
            goToPage(pageCount - 1);
        }
    });

    // --- Anchor link click interception ---
    // Intercept clicks on in-page anchor links (href="#...") to prevent the
    // browser's default scroll-to behavior, which interferes with our
    // transform-based pagination. We navigate to the correct page and save
    // the position in a cookie — the URL hash is NOT updated.
    content.addEventListener("click", function (e) {
        var link = e.target.closest('a[href^="#"]');
        if (!link) return;

        var hash = link.getAttribute("href");
        if (!hash || hash === "#") return;

        e.preventDefault();
        goToAnchor(hash);
    });

    // --- Hash change (external sources only) ---
    // Handles cases where the hash is changed by something other than our
    // own click handler — e.g. the user manually edits the URL, or navigates
    // here from an external link with a hash.
    window.addEventListener("hashchange", function () {
        if (location.hash) {
            goToAnchor(location.hash);
        }
    });

    // --- Click / tap to advance ---
    //
    // A click or tap on the viewport that is NOT part of a drag/swipe
    // advances to the next page. The dragOccurred flag is set by the
    // mouse/touch handlers below when a drag or swipe is detected, so
    // this handler can safely skip those cases.
    var dragOccurred = false;

    viewport.addEventListener("click", function (e) {
        if (dragOccurred) return;
        // Don't advance when clicking links (handled by anchor interception)
        if (e.target.closest("a")) return;
        // Don't advance when the TOC modal is open
        if (isTocOpen()) return;
        nextPage();
    });

    // --- Touch / swipe navigation ---
    var touchStartX = 0;
    var touchStartY = 0;
    var touchActive = false;

    viewport.addEventListener("touchstart", function (e) {
        if (isTocOpen()) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchActive = true;
        dragOccurred = false;
    }, { passive: true });

    viewport.addEventListener("touchend", function (e) {
        if (!touchActive) return;
        touchActive = false;

        var endX = e.changedTouches[0].clientX;
        var endY = e.changedTouches[0].clientY;
        var dx = endX - touchStartX;
        var dy = endY - touchStartY;

        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            dragOccurred = true;
            if (dx < 0) {
                nextPage();
            } else {
                prevPage();
            }
        }
    }, { passive: true });

    // --- Mouse drag navigation ---
    var mouseStartX = 0;
    var mouseActive = false;

    viewport.addEventListener("mousedown", function (e) {
        if (isTocOpen()) return;
        if (e.target.closest(".reader__controls")) return;
        mouseStartX = e.clientX;
        mouseActive = true;
        dragOccurred = false;
    });

    document.addEventListener("mouseup", function (e) {
        if (!mouseActive) return;
        mouseActive = false;

        var dx = e.clientX - mouseStartX;
        if (Math.abs(dx) > 50) {
            dragOccurred = true;
            if (dx < 0) {
                nextPage();
            } else {
                prevPage();
            }
        }
    });

    // --- Mouse wheel navigation ---
    var wheelTimeout = null;
    viewport.addEventListener("wheel", function (e) {
        if (isTocOpen()) return;
        e.preventDefault();
        if (isAnimating || wheelTimeout) return;

        var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta !== 0) {
            if (delta > 0) {
                nextPage();
            } else {
                prevPage();
            }
            wheelTimeout = setTimeout(function () {
                wheelTimeout = null;
            }, 400);
        }
    }, { passive: false });

    // --- Window resize: recalculate pages ---
    var resizeTimeout = null;
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(recalculate, 150);
    });

    // --- Initialise ---
    initSlideshows();

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(recalculate);
    } else {
        setTimeout(recalculate, 100);
    }

    recalculate();
})();
