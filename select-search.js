/**
 * Select Search Extension
 * Adds search functionality to large <select> lists.
 *
 * Approach: instead of wrapping every <select> in the DOM, we use ONE
 * delegated listener and ONE popup (input + results) that is attached to
 * <body> and positioned over the clicked select. The native dropdown is
 * prevented from opening, so you never see two lists.
 */
(function () {
  'use strict';

  // Guard against the script being injected twice
  if (window.__selectSearchLoaded) return;
  window.__selectSearchLoaded = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;

  let settings = {
    minOptions: 20,
    maxResults: 10,
    websiteMode: 'all', // all | include | exclude
    websites: []
  };
  let enabled = true;

  // ---------- Settings ----------

  function loadSettings(callback) {
    const defaults = { ...settings };
    let done = false;
    const finish = (items) => {
      if (done) return;
      done = true;
      settings = { ...defaults, ...(items || {}) };
      // Stored values may be strings, 0, or garbage: sanitize them
      const max = parseInt(settings.maxResults, 10);
      const min = parseInt(settings.minOptions, 10);
      settings.maxResults = Number.isNaN(max) || max < 1 ? 10 : max;
      settings.minOptions = Number.isNaN(min) || min < 0 ? 20 : min;
      if (!Array.isArray(settings.websites)) settings.websites = [];
      callback();
    };
    try {
      // Callback style works in both Chrome MV2/MV3 and Firefox (with polyfill)
      const maybePromise = api.storage.sync.get(defaults, finish);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(finish).catch(() => finish(null));
      }
    } catch (e) {
      finish(null);
    }
  }

  function shouldRunOnCurrentWebsite() {
    if (settings.websiteMode === 'all') return true;
    const host = window.location.hostname;
    const isInList = (settings.websites || []).some((site) => {
      const clean = site.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      return clean && (host === clean || host.endsWith('.' + clean));
    });
    return settings.websiteMode === 'include' ? isInList : !isInList;
  }

  // ---------- Eligibility ----------

  function isCustomDropdown(select) {
    if (
      select.hasAttribute('data-action') ||
      select.getAttribute('role') === 'combobox' ||
      select.classList.contains('a-native-dropdown')
    ) {
      return true;
    }
    const parent = select.parentElement;
    if (parent) {
      if (
        parent.querySelector('.a-button-dropdown') ||
        parent.classList.contains('a-dropdown-container') ||
        parent.classList.contains('custom-select') ||
        parent.classList.contains('select2-container') ||
        parent.classList.contains('chosen-container')
      ) {
        return true;
      }
    }
    return false;
  }

  function isEligible(select) {
    return (
      select instanceof HTMLSelectElement &&
      !select.multiple &&
      select.size <= 1 &&
      !select.disabled &&
      select.options.length >= settings.minOptions &&
      !isCustomDropdown(select)
    );
  }

  // ---------- Popup UI (single instance) ----------

  let popup = null;
  let input = null;
  let list = null;
  let currentSelect = null;
  let matches = [];
  let activeIndex = -1;
  let listMax = 240; // max height (px) of the results list, set in positionPopup()

  function injectStyles() {
    if (document.getElementById('select-search-styles')) return;
    const style = document.createElement('style');
    style.id = 'select-search-styles';
    style.textContent = `
      .sx-ss-popup {
        position: fixed;
        z-index: 2147483647;
        box-sizing: border-box;
        background: #fff;
        color: #111;
        border: 1px solid #888;
        border-radius: 4px;
        box-shadow: 0 4px 14px rgba(0,0,0,.25);
        font: 14px/1.4 system-ui, sans-serif;
        display: block;
        overflow: hidden;
      }
      .sx-ss-input {
        box-sizing: border-box !important;
        display: block !important;
        position: static !important;
        width: 100% !important;
        height: 34px !important;
        min-height: 34px !important;
        margin: 0 !important;
        padding: 6px 8px !important;
        border: 0 !important;
        border-bottom: 2px solid #1a73e8 !important;
        border-radius: 0 !important;
        outline: none !important;
        font: 14px/1.4 system-ui, sans-serif !important;
        color: #111 !important;
        background: #fff !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
      /* !important so site CSS can't hide or recolor the results */
      .sx-ss-results { display: block !important; overflow-y: auto !important; flex: 1 1 auto; min-height: 0; background: #fff !important; }
      .sx-ss-result { display: block !important; padding: 5px 8px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #111 !important; background: #fff !important; }
      .sx-ss-result.active { background: #1a73e8 !important; color: #fff !important; }
      .sx-ss-result.selected { font-weight: 600; }
      .sx-ss-empty, .sx-ss-more { display: block !important; padding: 5px 8px; color: #777 !important; font-size: 12px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function createPopup() {
    injectStyles();

    popup = document.createElement('div');
    popup.className = 'sx-ss-popup';

    input = document.createElement('input');
    input.type = 'text';
    input.className = 'sx-ss-input';
    input.placeholder = 'Search...';
    input.autocomplete = 'off';
    input.spellcheck = false;

    list = document.createElement('div');
    list.className = 'sx-ss-results';

    popup.appendChild(input);
    popup.appendChild(list);

    input.addEventListener('input', renderResults);
    // Note: keydown for the input is handled in shieldPopupEvents() (window capture)

    // mousedown (not click) so the input never loses focus / triggers outside-close
    list.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const item = e.target.closest('.sx-ss-result');
      if (item) chooseOption(matches[Number(item.dataset.index)]);
    });
    list.addEventListener('mousemove', (e) => {
      const item = e.target.closest('.sx-ss-result');
      if (item) setActive(Number(item.dataset.index), false);
    });
  }

  function positionPopup() {
    if (!currentSelect || !popup) return;
    const rect = currentSelect.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(rect.width, 220);
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);

    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;

    popup.style.left = left + 'px';
    popup.style.width = width + 'px';

    if (openUp) {
      popup.style.top = '';
      popup.style.bottom = window.innerHeight - rect.top + 'px';
      popup.style.maxHeight = Math.max(120, spaceAbove) + 'px';
    } else {
      popup.style.bottom = '';
      popup.style.top = rect.bottom + 'px';
      popup.style.maxHeight = Math.max(120, spaceBelow) + 'px';
    }
    // Plain block layout: cap the results list explicitly (popup height minus the 34px input)
    const popupMax = parseInt(popup.style.maxHeight, 10) || 300;
    listMax = Math.max(60, popupMax - 36);
    list.style.setProperty('max-height', listMax + 'px', 'important');
  }

  function openPopup(select) {
    if (!popup) createPopup();
    if (currentSelect === select && popup.isConnected) {
      input.focus();
      return;
    }
    currentSelect = select;
    input.value = '';
    // Inside a modal <dialog> everything outside it is inert, so attach there
    (select.closest('dialog') || document.body).appendChild(popup);
    positionPopup();
    renderResults();
    input.focus();
  }

  function closePopup(refocus) {
    if (!popup || !popup.isConnected) return;
    popup.remove();
    const select = currentSelect;
    currentSelect = null;
    matches = [];
    activeIndex = -1;
    if (refocus && select) select.focus({ preventScroll: true });
  }

  function renderResults() {
    if (!currentSelect) return;
    // Case- and accent-insensitive ("peru" matches "Perú")
    const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const query = norm(input.value.trim());
    const all = Array.from(currentSelect.options).filter((o) => !o.disabled && !o.hidden);
    const filtered = query
      ? all.filter((o) => norm(o.text || o.label || '').includes(query))
      : all;
    console.debug('[select-search] query:', JSON.stringify(query), 'options:', all.length, 'matches:', filtered.length);

    matches = filtered.slice(0, settings.maxResults);
    list.textContent = '';

    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'sx-ss-empty';
      empty.textContent = 'No results';
      list.appendChild(empty);
      activeIndex = -1;
      return;
    }

    matches.forEach((option, index) => {
      const item = document.createElement('div');
      item.className = 'sx-ss-result';
      if (option.selected) item.classList.add('selected');
      item.textContent = option.text || '\u00a0';
      item.title = option.text;
      item.dataset.index = String(index);
      list.appendChild(item);
    });

    if (filtered.length > matches.length) {
      const more = document.createElement('div');
      more.className = 'sx-ss-more';
      more.textContent = `${filtered.length - matches.length} more… keep typing to narrow down`;
      list.appendChild(more);
    }

    // Guarantee the list can't collapse: ~28px per row, capped at the available space
    const wanted = Math.min(matches.length * 28 + (filtered.length > matches.length ? 24 : 0), listMax);
    list.style.setProperty('min-height', wanted + 'px', 'important');

    setActive(0, true);
    console.debug(
      '[select-search] layout: popup', popup.offsetWidth + 'x' + popup.offsetHeight,
      'list', list.offsetWidth + 'x' + list.offsetHeight,
      'rows', list.children.length, 'listMax', listMax
    );
  }

  function setActive(index, scroll) {
    const items = list.querySelectorAll('.sx-ss-result');
    if (!items.length) return;
    index = Math.max(0, Math.min(index, items.length - 1));
    if (activeIndex >= 0 && items[activeIndex]) items[activeIndex].classList.remove('active');
    activeIndex = index;
    items[index].classList.add('active');
    if (scroll) items[index].scrollIntoView({ block: 'nearest' });
  }

  function chooseOption(option) {
    if (!option || !currentSelect) return;
    const select = currentSelect;
    select.selectedIndex = option.index;
    // Frameworks (React, Vue, Angular) listen to these
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    closePopup(true);
  }

  function onInputKeydown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(activeIndex + 1, true);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(activeIndex - 1, true);
        break;
      case 'Enter':
        e.preventDefault();
        if (matches[activeIndex]) chooseOption(matches[activeIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        closePopup(true);
        break;
      case 'Tab':
        closePopup(false);
        break;
    }
    // Don't let the page's own shortcuts react to typing in our input
    e.stopPropagation();
  }

  // ---------- Global (delegated) listeners ----------

  function onMouseDown(e) {
    if (!enabled) return;

    // Click inside our popup: handled by the popup itself
    if (popup && popup.contains(e.target)) return;

    const select = e.target instanceof Element ? e.target.closest('select') : null;

    if (select && isEligible(select)) {
      if (e.button !== 0) return;
      // Stop the native dropdown from opening. This MUST be on mousedown;
      // by the time "click" fires the native list is already open.
      e.preventDefault();
      if (currentSelect === select && popup && popup.isConnected) {
        closePopup(true); // second click toggles it closed
      } else {
        openPopup(select);
      }
      return;
    }

    // Click anywhere else closes the popup
    closePopup(false);
  }

  function onKeyDown(e) {
    if (!enabled) return;
    if (popup && popup.contains(e.target)) return;
    const select = e.target;
    if (!(select instanceof HTMLSelectElement) || !isEligible(select)) return;

    // Keyboard users: Enter / Space / Alt+Down open the search instead of the native list
    if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) {
      e.preventDefault();
      openPopup(select);
    }
  }

  function onViewportChange(e) {
    if (!popup || !popup.isConnected) return;
    // Scrolling inside our own results list must not close/move the popup
    if (e && e.target && popup.contains(e.target)) return;
    positionPopup();
  }

  // Many sites trap focus (modals) or bind global hotkeys. Listening on window in
  // capture phase puts us first in line, so we can hide the popup's events from the page.
  function isPopupTarget(e) {
    return popup && e.target instanceof Node && popup.contains(e.target);
  }

  function shieldPopupEvents() {
    ['focusin', 'focusout', 'focus', 'blur'].forEach((type) => {
      window.addEventListener(
        type,
        (e) => {
          if (isPopupTarget(e)) e.stopImmediatePropagation();
        },
        true
      );
    });

    window.addEventListener(
      'keydown',
      (e) => {
        if (!isPopupTarget(e)) return;
        if (e.target === input) onInputKeydown(e);
        e.stopImmediatePropagation(); // typing still works; the page just doesn't see it
      },
      true
    );

    ['keypress', 'keyup'].forEach((type) => {
      window.addEventListener(
        type,
        (e) => {
          if (isPopupTarget(e)) e.stopImmediatePropagation();
        },
        true
      );
    });
  }

  function init() {
    if (!shouldRunOnCurrentWebsite()) {
      enabled = false;
      return;
    }
    shieldPopupEvents();
    // Capture phase so we run before the page's own handlers
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('blur', () => closePopup(false));
  }

  loadSettings(init);
})();