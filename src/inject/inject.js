// Content script: asks the background worker for the comic's Reddit comments
// and lays the best ones out in two columns on each side of the strip.

var REDDIT_URL = "https://www.reddit.com";

// minimum of point for a comment to appear
var COMMENT_THRESHOLD = 4;

// maximum length of a comment to appear
var COMMENT_LENGTH_THRESHOLD = 350;

// dont display comments from these bots
var blockedUsernames = ["xkcd_bot", "xkcdcomic_bot", "rss_feed", "AutoModerator"];

var COLUMN_WIDTH = 250;
var MIN_COLUMN_WIDTH = 160;

// how far columns overlap the comic's white box, and how far above the comic
// image they start (about level with the navigation buttons)
var BOX_OVERLAP = 7;
var TOP_OFFSET = 55;

// horizontal padding + borders of a comment box, on top of its width
var BOX_CHROME = 7;

// keep comments at least this far from the window edges
var PAGE_MARGIN = 8;
var commentVerticalSpacing = 15;

// slide in animation length
var slideIn = 25;
var transitionTime = 300;

var shown = false;
var cachedComments = null;

function comicImage() {
  return document.querySelector("#comic img");
}

// comic number from the URL; on the root page, deduce it from the "prev" link
function comicNum() {
  var match = window.location.pathname.match(/^\/(\d+)\/?$/);
  if (match) return match[1] * 1;
  var prev = document.querySelector("a[rel=prev]");
  return prev ? prev.pathname.replace(/\//g, "") * 1 + 1 : null;
}

function worthy(comment) {
  return comment.body &&
    comment.body != "[deleted]" &&
    comment.body != "[removed]" &&
    comment.body.length <= COMMENT_LENGTH_THRESHOLD &&
    comment.score >= COMMENT_THRESHOLD &&
    blockedUsernames.indexOf(comment.author) == -1;
}

// Comment bodies are Reddit markdown with &, < and > entity-escaped. Render a
// small safe subset: paragraphs, quotes, links, bold and italics. Everything
// else stays plain text; nothing is ever parsed as HTML.
function decodeEntities(text) {
  return text.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

function safeUrl(href) {
  try {
    var url = new URL(href, REDDIT_URL);
    return (url.protocol == "https:" || url.protocol == "http:") ? url.href : null;
  } catch (e) {
    return null;
  }
}

var INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function renderInline(parent, text) {
  var last = 0;
  var m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    var el;
    var href = m[1] ? safeUrl(m[2]) : m[3] ? safeUrl(m[3]) : null;
    if (href) {
      el = document.createElement("a");
      el.href = href;
      el.target = "_blank";
      el.rel = "noopener";
      el.textContent = m[1] || m[3];
    } else if (m[4] || m[5]) {
      el = document.createElement(m[4] ? "strong" : "em");
      el.textContent = m[4] || m[5];
    } else {
      el = document.createTextNode(m[0]);
    }
    parent.appendChild(el);
    last = INLINE.lastIndex;
  }
  parent.appendChild(document.createTextNode(text.slice(last)));
}

function renderBody(body) {
  var fragment = document.createDocumentFragment();
  decodeEntities(body).split(/\n\s*\n/).forEach(function(block) {
    block = block.trim();
    if (!block) return;
    var quote = /^>/.test(block);
    var p = document.createElement(quote ? "blockquote" : "p");
    renderInline(p, quote ? block.replace(/^>\s?/gm, "") : block);
    fragment.appendChild(p);
  });
  return fragment;
}

function displayComments(comments) {
  var img = comicImage();
  var box = document.getElementById("middleContainer");
  if (!img || !box) return;

  // xkcd's <body> is a positioned, centered container, so absolute coordinates
  // are relative to it rather than to the page. Place everything inside a
  // zero-size layer and measure from that layer's own position instead.
  var layer = document.getElementById("xkcdr-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "xkcdr-layer";
    document.body.appendChild(layer);
  }
  var origin = layer.getBoundingClientRect();
  var imgRect = img.getBoundingClientRect();
  var boxRect = box.getBoundingClientRect();
  var viewportWidth = document.documentElement.clientWidth;

  // As in the original layout: columns hug the comic's white box, slightly
  // overlapping its edges, and move inwards for narrow comics.
  var inset = Math.max(0, (boxRect.width - imgRect.width) / 3) + BOX_OVERLAP;
  var top = imgRect.top - origin.top - TOP_OFFSET;
  var height = Math.max(imgRect.height, 300);

  // each column gets up to COLUMN_WIDTH, less if the window edge is closer;
  // a column with too little room is skipped
  var leftEdge = boxRect.left + inset;
  var rightEdge = boxRect.right - inset;
  var columns = [
    { side: -1, edge: leftEdge, width: Math.min(COLUMN_WIDTH, leftEdge - PAGE_MARGIN - BOX_CHROME) },
    { side: 1, edge: rightEdge, width: Math.min(COLUMN_WIDTH, viewportWidth - rightEdge - PAGE_MARGIN - BOX_CHROME) }
  ].filter(function(c) { return c.width >= MIN_COLUMN_WIDTH; });

  if (!columns.length) {
    console.info("XKCD+R: window too narrow to show comments next to the comic.");
    return;
  }
  columns.forEach(function(c) { c.filled = 0; c.full = false; });

  for (var comment of comments.filter(worthy)) {
    // alternate sides, so a handful of comments doesn't all end up on the left
    var open = columns.filter(function(c) { return !c.full; });
    if (!open.length) break;
    var col = open.reduce(function(a, b) { return b.filled < a.filled ? b : a; });

    var div = document.createElement("div");
    div.className = "box xkcdr";
    div.style.width = col.width + "px";
    div.appendChild(renderBody(comment.body));

    var link = document.createElement("small");
    link.className = "xkcdr-author";
    var a = document.createElement("a");
    a.href = comment.permalink;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = comment.author;
    link.appendChild(a);
    div.appendChild(link);

    // measure before placing
    div.style.visibility = "hidden";
    layer.appendChild(div);
    var outerWidth = div.offsetWidth;
    var h = div.offsetHeight;

    if (col.filled > 0 && col.filled + h > height) {
      col.full = true;
      div.remove();
      continue;
    }

    // drift away from the comic in a gentle arc, but never past the window edge
    var wobble = Math.sin((col.filled / height) * Math.PI) * 30 + (Math.random() - 0.5) * 40;
    var left = col.side < 0
      ? Math.max(PAGE_MARGIN, col.edge - outerWidth - wobble)
      : Math.min(viewportWidth - PAGE_MARGIN - outerWidth, col.edge + wobble);

    div.style.top = (top + col.filled) + "px";
    div.style.left = (left - origin.left) + "px";
    div.style.setProperty("--xkcdr-slide", (col.side * slideIn) + "px");
    div.style.setProperty("--xkcdr-duration", transitionTime + "ms");
    div.style.visibility = "";
    div.classList.add("xkcdr-in");

    col.filled += h + commentVerticalSpacing;
  }
}

function show() {
  if (shown) return;
  shown = true;

  if (cachedComments) {
    displayComments(cachedComments);
    return;
  }

  var num = comicNum();
  if (!num) return;

  var img = comicImage();
  chrome.runtime.sendMessage({
    type: "getComments",
    comicNum: num,
    imgUrl: img ? img.getAttribute("src") : null
  }, function(response) {
    if (!response || response.error) {
      console.warn("XKCD+R: couldn't load Reddit comments.", response && response.error);
      return;
    }
    cachedComments = response.comments;
    if (shown) displayComments(cachedComments);
  });
}

function hide() {
  shown = false;
  document.querySelectorAll(".xkcdr").forEach(function(el) {
    el.classList.remove("xkcdr-in");
    el.addEventListener("transitionend", function() { el.remove(); }, { once: true });
    setTimeout(function() { el.remove(); }, transitionTime + 100);
  });
}

function setEnable(enabled) {
  if (enabled) show(); else hide();
}

chrome.storage.sync.get("disabled", function(s) { setEnable(!s.disabled); });

// columns depend on the window width, so lay comments out again on resize
var resizeTimer;
window.addEventListener("resize", function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function() {
    if (!shown || !cachedComments) return;
    document.querySelectorAll(".xkcdr").forEach(function(el) { el.remove(); });
    displayComments(cachedComments);
  }, 200);
});

chrome.storage.onChanged.addListener(function(changes, area) {
  if (area == "sync" && changes.disabled) setEnable(!changes.disabled.newValue);
});
