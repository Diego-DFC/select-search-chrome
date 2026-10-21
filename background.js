/**
 * Select Search Extension - Background Script
 * 
 * This script handles the browser action (toolbar button) click event
 * and opens the extension's options page.
 */
if (typeof browser === "undefined") {
  var browser = chrome;
}
// When the user clicks the toolbar button, open the options page
browser.browserAction.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});