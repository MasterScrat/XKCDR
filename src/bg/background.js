var NAME = "XKCD+R";

var lastTabId;
var enable = true;

// a tab is loaded
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if(validDomain(tab.url)) {
    if(changeInfo.status == 'complete') {

      console.info('loaded!');

      chrome.storage.sync.get('disabled', function(disabled) {
          console.log('enabled in storage: ' + !disabled.disabled);
          lastTabId = tabId;

          setEnabled(!disabled.disabled);
      });
    }
  }
});

// tab is selected due to window selection
chrome.windows.onFocusChanged.addListener(function(tab){
  chrome.tabs.query({active:true,currentWindow:true}, function(tabArray){
    if(validDomain(tabArray[0].url)) {
      console.info('window focused!');

      lastTabId = tabArray[0].id;
      console.log(tabArray[0]);
      setEnabled(enable);
    }
  });
});

// tab switched to from another tab
chrome.tabs.onActivated.addListener(function(tab){
  chrome.tabs.query({active:true,currentWindow:true}, function(tabArray){
    if(validDomain(tabArray[0].url)) {
      console.info('tab switched to!');

      lastTabId = tabArray[0].id;
      console.log(tabArray[0]);
      setEnabled(enable);
    }
  });
});

// user clicked the page action icon
chrome.pageAction.onClicked.addListener(function(tab) {
  enable = !enable;
  setEnabled(enable);
});

function validDomain(url) {
  return (url.indexOf('://xkcd.com') != -1);
}

function setEnabled(enabled) {
  console.log('setEnabled: ' + enabled);

  var iconSuffix = "";
  var titleSuffix = "";

  if(!enabled) {
    iconSuffix = "d";
    titleSuffix = " (disabled)";
  }

  chrome.tabs.executeScript(lastTabId, {code: "setEnable("+enabled+");"});
  chrome.pageAction.setIcon({path:"icons/icon38"+iconSuffix+".png", tabId: lastTabId});
  chrome.pageAction.setTitle({title:NAME + titleSuffix, tabId: lastTabId});
  chrome.pageAction.show(lastTabId);

  chrome.storage.sync.set({'disabled': !enabled});
  enable = enabled;
}

// Google Universal Analytics
(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
(i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
})(window,document,'script','https://www.google-analytics.com/analytics.js','ga');
 
ga('create', 'UA-36471625-3', 'auto');
ga('set', 'checkProtocolTask', function(){});
ga('require', 'displayfeatures');
ga('send', 'pageview', 'started');