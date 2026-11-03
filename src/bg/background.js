var NAME = "XKCD+R";

// browser started or extension installed: show the stored state on the icon
chrome.runtime.onStartup.addListener(restoreEnabled);
chrome.runtime.onInstalled.addListener(restoreEnabled);

function restoreEnabled() {
  chrome.storage.sync.get('disabled', function(disabled) {
      console.log('enabled in storage: ' + !disabled.disabled);

      setEnabled(!disabled.disabled);
  });
}

// user clicked the toolbar icon
chrome.action.onClicked.addListener(function(tab) {
  chrome.storage.sync.get('disabled', function(disabled) {
    setEnabled(disabled.disabled);
  });
});

// content scripts in every xkcd tab follow the stored state (storage.onChanged)
function setEnabled(enabled) {
  console.log('setEnabled: ' + enabled);

  var iconSuffix = "";
  var titleSuffix = "";

  if(!enabled) {
    iconSuffix = "d";
    titleSuffix = " (disabled)";
  }

  chrome.action.setIcon({path:"/icons/icon38"+iconSuffix+".png"});
  chrome.action.setTitle({title:NAME + titleSuffix});

  chrome.storage.sync.set({'disabled': !enabled});
}

// Arctic Shift requests from content scripts go through here, so that tabs
// share one request per URL, and results are kept while this worker is alive.
// Chrome stops the worker after ~30s idle, which clears the cache.
var ARCTIC_SHIFT_API = "https://arctic-shift.photon-reddit.com/api/";

var cache = new Map();

function get(url) {
  if(!cache.has(url)) {
    var request = fetchJson(url);
    request.catch(function() { cache.delete(url); }); // retry failures next time
    cache.set(url, request);
  }
  return cache.get(url);
}

// Arctic Shift answers "Timeout. Maybe slow down a bit" under load; retry once.
async function fetchJson(url, retried) {
  var response = await fetch(url);
  var json = await response.json();
  if(!response.ok || json.error) {
    if(!retried) {
      await new Promise(function(resolve) { setTimeout(resolve, 2000); });
      return fetchJson(url, true);
    }
    throw new Error("Arctic Shift: " + (json.error || response.status) + " for " + url);
  }
  return json.data;
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if(message.type != "get" || message.url.indexOf(ARCTIC_SHIFT_API) != 0) return;

  get(message.url)
    .then(function(data) { sendResponse({data: data}); })
    .catch(function(e) {
      console.warn(e);
      sendResponse({error: String(e)});
    });

  return true; // async response
});
