const APP_PAGE = "app/index.html";

function openAppPage() {
  chrome.tabs.create({
    url: chrome.runtime.getURL(APP_PAGE),
  });
}

chrome.action.onClicked.addListener(() => {
  openAppPage();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    openAppPage();
  }
});
