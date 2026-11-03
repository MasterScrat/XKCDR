// Background service worker: owns the enabled/disabled toggle and all Reddit
// requests (content scripts can't make cross-origin requests in MV3).
//
// Requests are made with the user's Reddit session cookies, since Reddit
// rejects unauthenticated API calls. If the user isn't logged into Reddit,
// requests fail and the content script shows nothing.

var NAME = "XKCD+R";
var REDDIT_URL = "https://www.reddit.com";

// minimum of points for a submission for its comments to be considered
var SUBMISSION_THRESHOLD = 2;

// max number of comments to retrieve per submission
var NB_RETRIEVED_COMMENTS = 200;

// only get comments from these subs
var typicalSubs = ["comics", "xkcd", "xkcdcomic", "funny"];

// ---- enable toggle ----

function updateIcon(enabled) {
  chrome.action.setIcon({ path: "/icons/icon38" + (enabled ? "" : "d") + ".png" });
  chrome.action.setTitle({ title: NAME + (enabled ? "" : " (disabled)") });
}

chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.sync.get("disabled", function(s) { updateIcon(!s.disabled); });
});

chrome.runtime.onStartup.addListener(function() {
  chrome.storage.sync.get("disabled", function(s) { updateIcon(!s.disabled); });
});

// user clicked the toolbar icon; content scripts react via storage.onChanged
chrome.action.onClicked.addListener(function() {
  chrome.storage.sync.get("disabled", function(s) {
    var disabled = !s.disabled;
    chrome.storage.sync.set({ disabled: disabled });
    updateIcon(!disabled);
  });
});

// ---- Reddit ----

async function redditGet(path) {
  var response = await fetch(REDDIT_URL + path, { credentials: "include" });
  if (!response.ok) {
    throw new Error("Reddit returned " + response.status + " for " + path);
  }
  return response.json();
}

// All the URL spellings a submission for this comic could have used.
function urlVariants(comicUrl, imgUrl) {
  var path = new URL(comicUrl).pathname.replace(/\/$/, "");
  var variants = [];
  ["https://", "http://"].forEach(function(scheme) {
    ["xkcd.com", "www.xkcd.com", "m.xkcd.com"].forEach(function(host) {
      variants.push(scheme + host + path + "/");
      variants.push(scheme + host + path);
    });
  });
  if (imgUrl) {
    var img = imgUrl.replace(/^https?:/, "");
    variants.push("https:" + img, "http:" + img);
  }
  return variants;
}

async function findSubmissions(comicUrl, imgUrl) {
  var seen = {};
  var submissions = [];
  for (var url of urlVariants(comicUrl, imgUrl)) {
    var listing = await redditGet("/api/info.json?url=" + encodeURIComponent(url));
    listing.data.children.forEach(function(child) {
      var s = child.data;
      if (!seen[s.id]) {
        seen[s.id] = true;
        submissions.push(s);
      }
    });
  }
  return submissions;
}

async function getComments(comicUrl, imgUrl) {
  var submissions = (await findSubmissions(comicUrl, imgUrl)).filter(function(s) {
    return s.num_comments > 0 &&
      s.score >= SUBMISSION_THRESHOLD &&
      typicalSubs.indexOf(s.subreddit.toLowerCase()) != -1;
  });
  console.info(submissions.length + " relevant submissions for " + comicUrl);

  var comments = [];
  for (var s of submissions) {
    var thread = await redditGet(s.permalink + ".json?sort=top&limit=" + NB_RETRIEVED_COMMENTS);
    thread[1].data.children.forEach(function(c) {
      if (c.kind != "t1") return; // "more" link
      comments.push({
        id: c.data.id,
        author: c.data.author,
        score: c.data.score,
        body: c.data.body,
        bodyHtml: c.data.body_html,
        permalink: REDDIT_URL + s.permalink + c.data.id + "/"
      });
    });
  }

  comments.sort(function(a, b) { return b.score - a.score; });
  return comments;
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type != "getComments") return;

  getComments(message.comicUrl, message.imgUrl)
    .then(function(comments) { sendResponse({ comments: comments }); })
    .catch(function(e) {
      console.warn(e);
      sendResponse({ error: String(e) });
    });

  return true; // async response
});
