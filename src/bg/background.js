// Background service worker: owns the enabled/disabled toggle and fetches
// Reddit comments.
//
// Reddit itself now blocks API calls without app credentials, so comments come
// from Arctic Shift (https://github.com/ArthurHeitmann/arctic_shift), a free
// archive of Reddit data. It's volunteer-run, so keep the request count low.

var NAME = "XKCD+R";
var REDDIT_URL = "https://www.reddit.com";
var ARCTIC_SHIFT_API = "https://arctic-shift.photon-reddit.com/api";

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

// ---- Reddit (via Arctic Shift) ----

// re-fetch a comic's comments at most once a day
var CACHE_TTL = 24 * 3600 * 1000;

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// Arctic Shift answers "Timeout. Maybe slow down a bit" under load; retry once.
async function archiveGet(path, params, retried) {
  var response = await fetch(ARCTIC_SHIFT_API + path + "?" + new URLSearchParams(params));
  var json = await response.json();
  if (!response.ok || json.error) {
    if (!retried) {
      await sleep(2000);
      return archiveGet(path, params, true);
    }
    throw new Error("Arctic Shift: " + (json.error || response.status) + " for " + path);
  }
  return json.data;
}

// URL search is a prefix match, so these also catch "?…" and "#…" suffixes.
// Results are filtered back to this exact comic afterwards.
function urlQueries(comicNum, imgUrl) {
  var queries = ["https://xkcd.com/" + comicNum + "/", "http://xkcd.com/" + comicNum + "/"];
  if (imgUrl) {
    var img = imgUrl.replace(/^https?:/, "");
    queries.push("https:" + img, "http:" + img);
  }
  return queries;
}

function isComicUrl(url, comicNum, imgUrl) {
  var img = imgUrl ? imgUrl.replace(/^https?:/, "") : null;
  return new RegExp("^https?://xkcd\\.com/" + comicNum + "/([?#].*)?$").test(url) ||
    (img && url.replace(/^https?:/, "").indexOf(img) == 0);
}

async function findSubmissions(comicNum, imgUrl) {
  var seen = {};
  var submissions = [];
  var failures = 0;
  var queries = urlQueries(comicNum, imgUrl);
  for (var url of queries) {
    var posts;
    try {
      posts = await archiveGet("/posts/search", { url: url, limit: 100, fields: "id,url,subreddit,score,num_comments" });
    } catch (e) {
      console.warn(e);
      failures++;
      continue;
    }
    posts.forEach(function(s) {
      if (!seen[s.id] && isComicUrl(s.url, comicNum, imgUrl)) {
        seen[s.id] = true;
        submissions.push(s);
      }
    });
  }
  if (failures == queries.length) {
    throw new Error("Arctic Shift unreachable");
  }
  return submissions;
}

async function fetchComments(comicNum, imgUrl) {
  var submissions = (await findSubmissions(comicNum, imgUrl)).filter(function(s) {
    return s.num_comments > 0 &&
      s.score >= SUBMISSION_THRESHOLD &&
      typicalSubs.indexOf(s.subreddit.toLowerCase()) != -1;
  });
  console.info(submissions.length + " relevant submissions for xkcd " + comicNum);

  var comments = [];
  for (var s of submissions) {
    var tree;
    try {
      // top-level comments only; replies make little sense out of context
      tree = await archiveGet("/comments/tree", { link_id: s.id, limit: NB_RETRIEVED_COMMENTS });
    } catch (e) {
      console.warn(e);
      continue;
    }
    tree.forEach(function(c) {
      if (c.kind != "t1") return; // "more" link
      comments.push({
        id: c.data.id,
        author: c.data.author,
        score: c.data.score,
        body: c.data.body,
        // archived permalinks are malformed for older threads; build our own
        permalink: REDDIT_URL + "/r/" + s.subreddit + "/comments/" + s.id + "/_/" + c.data.id + "/"
      });
    });
  }

  comments.sort(function(a, b) { return b.score - a.score; });
  return comments;
}

async function getComments(comicNum, imgUrl) {
  var key = "comments:" + comicNum;
  var cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return cached.comments;
  }

  var comments = await fetchComments(comicNum, imgUrl);
  await chrome.storage.local.set({ [key]: { at: Date.now(), comments: comments } });
  return comments;
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type != "getComments") return;

  getComments(message.comicNum, message.imgUrl)
    .then(function(comments) { sendResponse({ comments: comments }); })
    .catch(function(e) {
      console.warn(e);
      sendResponse({ error: String(e) });
    });

  return true; // async response
});
