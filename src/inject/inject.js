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
var COLUMN_GAP = 20;
var commentVerticalSpacing = 15;

// slide in animation length
var slideIn = 25;
var transitionTime = 300;

var shown = false;
var cachedComments = null;

function comicImage() {
  return document.querySelector("#comic img");
}

// root page: find latest comic from "prev" link
function comicUrl() {
  if (window.location.pathname == "/") {
    var prev = document.querySelector("a[rel=prev]");
    var num = prev.pathname.replace(/\//g, "") * 1 + 1;
    return window.location.origin + "/" + num + "/";
  }
  return window.location.href;
}

function worthy(comment) {
  return comment.body &&
    comment.body != "[deleted]" &&
    comment.body != "[removed]" &&
    comment.body.length <= COMMENT_LENGTH_THRESHOLD &&
    comment.score >= COMMENT_THRESHOLD &&
    blockedUsernames.indexOf(comment.author) == -1;
}

// Reddit's body_html is entity-escaped, sanitized markdown output. Decode it,
// then keep only text and simple formatting, with absolute links.
var ALLOWED_TAGS = ["P", "A", "EM", "STRONG", "DEL", "CODE", "PRE", "BLOCKQUOTE", "UL", "OL", "LI", "BR", "SUP"];

function renderBody(bodyHtml) {
  var decoded = new DOMParser().parseFromString(bodyHtml, "text/html").documentElement.textContent;
  var doc = new DOMParser().parseFromString(decoded, "text/html");

  function clean(node) {
    Array.from(node.childNodes).forEach(function(child) {
      if (child.nodeType != Node.ELEMENT_NODE) return;
      clean(child);
      if (ALLOWED_TAGS.indexOf(child.tagName) == -1) {
        child.replaceWith.apply(child, Array.from(child.childNodes));
        return;
      }
      var href = child.getAttribute("href");
      Array.from(child.attributes).forEach(function(a) { child.removeAttribute(a.name); });
      if (child.tagName == "A" && href) {
        var url;
        try { url = new URL(href, REDDIT_URL); } catch (e) { return; }
        if (url.protocol == "https:" || url.protocol == "http:") {
          child.setAttribute("href", url.href);
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener");
        }
      }
    });
  }

  clean(doc.body);
  var fragment = document.createDocumentFragment();
  Array.from(doc.body.childNodes).forEach(function(n) { fragment.appendChild(document.importNode(n, true)); });
  return fragment;
}

function displayComments(comments) {
  var img = comicImage();
  if (!img) return;

  var rect = img.getBoundingClientRect();
  var top = rect.top + window.scrollY;
  var leftEdge = rect.left + window.scrollX;
  var rightEdge = rect.right + window.scrollX;
  var height = Math.max(rect.height, 300);

  var column = 0;
  var previous = 0;

  for (var comment of comments.filter(worthy)) {
    if (column > 1) break;

    var div = document.createElement("div");
    div.className = "box xkcdr";
    div.style.width = COLUMN_WIDTH + "px";
    div.appendChild(renderBody(comment.bodyHtml));

    var link = document.createElement("small");
    link.className = "xkcdr-author";
    var a = document.createElement("a");
    a.href = comment.permalink;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = comment.author + " · " + comment.score;
    link.appendChild(a);
    div.appendChild(link);

    // measure before placing
    div.style.visibility = "hidden";
    document.body.appendChild(div);
    var h = div.offsetHeight;

    if (previous > 0 && previous + h > height) {
      column++;
      previous = 0;
      if (column > 1) {
        div.remove();
        break;
      }
    }

    var wobble = Math.sin((previous / height) * Math.PI) * 30 + (Math.random() - 0.5) * 40;
    var left = column == 0
      ? leftEdge - COLUMN_GAP - COLUMN_WIDTH - wobble
      : rightEdge + COLUMN_GAP + wobble;

    div.style.top = (top + previous) + "px";
    div.style.left = left + "px";
    div.style.setProperty("--xkcdr-slide", (column == 0 ? -slideIn : slideIn) + "px");
    div.style.setProperty("--xkcdr-duration", transitionTime + "ms");
    div.style.visibility = "";
    div.classList.add("xkcdr-in");

    previous += h + commentVerticalSpacing;
  }
}

function show() {
  if (shown) return;
  shown = true;

  if (cachedComments) {
    displayComments(cachedComments);
    return;
  }

  var img = comicImage();
  chrome.runtime.sendMessage({
    type: "getComments",
    comicUrl: comicUrl(),
    imgUrl: img ? img.getAttribute("src") : null
  }, function(response) {
    if (!response || response.error) {
      console.warn("XKCD+R: couldn't load Reddit comments. Are you logged into reddit.com?",
        response && response.error);
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

chrome.storage.onChanged.addListener(function(changes, area) {
  if (area == "sync" && changes.disabled) setEnable(!changes.disabled.newValue);
});
